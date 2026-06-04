import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import { all, get, initDatabase, insert, run } from './db.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const adminToken = process.env.ADMIN_TOKEN || 'admin123';
const jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';

app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Puzzle Tower API',
    timestamp: new Date().toISOString()
  });
});

app.post('/api/auth/register', async (req, res) => {
  const nickname = String(req.body?.nickname || '').trim().slice(0, 18);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!nickname || !isEmail(email) || password.length < 6) {
    res.status(400).json({ message: '닉네임, 이메일, 6자 이상 비밀번호가 필요합니다.' });
    return;
  }

  if (get('SELECT id FROM users WHERE email = ?', [email])) {
    res.status(409).json({ message: '이미 가입된 이메일입니다.' });
    return;
  }

  if (get('SELECT id FROM users WHERE nickname = ?', [nickname])) {
    res.status(409).json({ message: '이미 사용 중인 닉네임입니다.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const id = insert(
    `
    INSERT INTO users (nickname, email, password_hash, provider)
    VALUES (?, ?, ?, 'local')
    `,
    [nickname, email, passwordHash]
  );

  const user = getUserById(id);
  res.status(201).json({ token: createAuthToken(user), user: publicUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = get('SELECT * FROM users WHERE email = ?', [email]);

  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    return;
  }

  res.json({ token: createAuthToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/stages', (req, res) => {
  const stages = all(
    `
    SELECT s.*, u.nickname AS creator_nickname
    FROM stages s
    LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.is_official = 1 OR s.is_public = 1
    ORDER BY s.is_official DESC, s.level ASC
    `
  ).map(toStage);
  res.json(stages);
});

app.get('/api/stages/:level', (req, res) => {
  const stage = get(
    `
    SELECT s.*, u.nickname AS creator_nickname
    FROM stages s
    LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.level = ? AND (s.is_official = 1 OR s.is_public = 1)
    `,
    [Number(req.params.level)]
  );
  if (!stage) {
    res.status(404).json({ message: '스테이지를 찾을 수 없습니다.' });
    return;
  }
  res.json(toStage(stage));
});

app.get('/api/community/stages', (req, res) => {
  const stages = all(
    `
    SELECT
      s.*,
      u.nickname AS creator_nickname,
      COUNT(r.id) AS play_count
    FROM stages s
    JOIN users u ON u.id = s.creator_id
    LEFT JOIN records r ON r.stage_id = s.id
    WHERE s.is_official = 0 AND s.is_public = 1
    GROUP BY s.id
    ORDER BY s.created_at DESC
    `
  ).map(toStage);
  res.json(stages);
});

app.get('/api/me/stages', requireAuth, (req, res) => {
  const stages = all(
    `
    SELECT s.*, u.nickname AS creator_nickname
    FROM stages s
    LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.creator_id = ?
    ORDER BY s.created_at DESC
    `,
    [req.user.id]
  ).map(toStage);
  res.json(stages);
});

app.get('/api/blocks', (req, res) => {
  const blocks = all(
    `
    SELECT b.*, u.nickname AS creator_nickname
    FROM custom_blocks b
    JOIN users u ON u.id = b.user_id
    WHERE b.is_public = 1
    ORDER BY b.downloads DESC, b.created_at DESC
    `
  ).map(toCustomBlock);
  res.json(blocks);
});

app.get('/api/me/blocks', requireAuth, (req, res) => {
  const blocks = all(
    `
    SELECT b.*, u.nickname AS creator_nickname
    FROM custom_blocks b
    JOIN users u ON u.id = b.user_id
    WHERE b.user_id = ?
    ORDER BY b.created_at DESC
    `,
    [req.user.id]
  ).map(toCustomBlock);
  res.json(blocks);
});

app.post('/api/blocks', requireAuth, (req, res) => {
  const validation = validateCustomBlockPayload(req.body);
  if (!validation.ok) {
    res.status(400).json({ message: validation.message });
    return;
  }

  const block = validation.block;
  const id = insert(
    `
    INSERT INTO custom_blocks (user_id, name, tile, color, effect, move_cost, message, code_data, is_public)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      req.user.id,
      block.name,
      block.tile,
      block.color,
      block.effect,
      block.moveCost,
      block.message,
      JSON.stringify(block.code),
      block.isPublic ? 1 : 0
    ]
  );

  res.status(201).json(toCustomBlock(getCustomBlockById(id)));
});

app.put('/api/blocks/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = get('SELECT * FROM custom_blocks WHERE id = ?', [id]);
  if (!existing) {
    res.status(404).json({ message: '커스텀 블록을 찾을 수 없습니다.' });
    return;
  }
  if (existing.user_id !== req.user.id) {
    res.status(403).json({ message: '본인이 만든 블록만 수정할 수 있습니다.' });
    return;
  }

  const validation = validateCustomBlockPayload(req.body);
  if (!validation.ok) {
    res.status(400).json({ message: validation.message });
    return;
  }

  const block = validation.block;
  run(
    `
    UPDATE custom_blocks
    SET name = ?, tile = ?, color = ?, effect = ?, move_cost = ?, message = ?, code_data = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      block.name,
      block.tile,
      block.color,
      block.effect,
      block.moveCost,
      block.message,
      JSON.stringify(block.code),
      block.isPublic ? 1 : 0,
      id
    ]
  );

  res.json(toCustomBlock(getCustomBlockById(id)));
});

app.delete('/api/blocks/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = get('SELECT * FROM custom_blocks WHERE id = ?', [id]);
  if (!existing) {
    res.status(404).json({ message: '커스텀 블록을 찾을 수 없습니다.' });
    return;
  }
  if (existing.user_id !== req.user.id) {
    res.status(403).json({ message: '본인이 만든 블록만 삭제할 수 있습니다.' });
    return;
  }

  run('DELETE FROM custom_blocks WHERE id = ?', [id]);
  res.json({ ok: true });
});

app.post('/api/blocks/:id/download', (req, res) => {
  const id = Number(req.params.id);
  const existing = getCustomBlockById(id);
  if (!existing || existing.is_public === 0) {
    res.status(404).json({ message: '공개 블록을 찾을 수 없습니다.' });
    return;
  }

  run('UPDATE custom_blocks SET downloads = downloads + 1 WHERE id = ?', [id]);
  res.json(toCustomBlock(getCustomBlockById(id)));
});

app.post('/api/community/stages', requireAuth, (req, res) => {
  const validation = validateStagePayload(req.body, { requireLevel: false });
  if (!validation.ok) {
    res.status(400).json({ message: validation.message });
    return;
  }

  const payload = validation.stage;
  const generatedLevel = get('SELECT COALESCE(MAX(level), 999) + 1 AS level FROM stages WHERE is_official = 0 OR level >= 1000').level;
  const id = insert(
    `
    INSERT INTO stages (level, title, board_data, move_limit, difficulty, creator_id, is_official, is_public)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)
    `,
    [
      generatedLevel,
      payload.title,
      JSON.stringify({ board: payload.board, customBlocks: payload.customBlocks }),
      payload.moveLimit,
      payload.difficulty,
      req.user.id
    ]
  );

  const stage = getStageById(id);
  res.status(201).json(toStage(stage));
});

app.put('/api/community/stages/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = get('SELECT * FROM stages WHERE id = ? AND is_official = 0', [id]);

  if (!existing) {
    res.status(404).json({ message: '커뮤니티 맵을 찾을 수 없습니다.' });
    return;
  }
  if (existing.creator_id !== req.user.id) {
    res.status(403).json({ message: '본인이 만든 맵만 수정할 수 있습니다.' });
    return;
  }

  const validation = validateStagePayload(req.body, { requireLevel: false });
  if (!validation.ok) {
    res.status(400).json({ message: validation.message });
    return;
  }

  const payload = validation.stage;
  run(
    `
    UPDATE stages
    SET title = ?, board_data = ?, move_limit = ?, difficulty = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      payload.title,
      JSON.stringify({ board: payload.board, customBlocks: payload.customBlocks }),
      payload.moveLimit,
      payload.difficulty,
      req.body?.isPublic === false ? 0 : 1,
      id
    ]
  );

  res.json(toStage(getStageById(id)));
});

app.delete('/api/community/stages/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const existing = get('SELECT * FROM stages WHERE id = ? AND is_official = 0', [id]);

  if (!existing) {
    res.status(404).json({ message: '커뮤니티 맵을 찾을 수 없습니다.' });
    return;
  }
  if (existing.creator_id !== req.user.id) {
    res.status(403).json({ message: '본인이 만든 맵만 삭제할 수 있습니다.' });
    return;
  }

  run('DELETE FROM records WHERE stage_id = ?', [id]);
  run('DELETE FROM stages WHERE id = ?', [id]);
  res.json({ ok: true });
});

app.post('/api/records', optionalAuth, (req, res) => {
  const body = req.body || {};
  const nickname = String(body.nickname || req.user?.nickname || '').trim().slice(0, 18);
  const stageId = Number(body.stageId);
  const clearTime = Number(body.clearTime);
  const moveUsed = Number(body.moveUsed);

  if (!nickname || !Number.isFinite(stageId) || !Number.isFinite(clearTime) || !Number.isFinite(moveUsed)) {
    res.status(400).json({ message: '기록 저장에 필요한 값이 부족합니다.' });
    return;
  }

  const stage = get('SELECT * FROM stages WHERE id = ? AND (is_official = 1 OR is_public = 1)', [stageId]);
  if (!stage) {
    res.status(404).json({ message: '스테이지를 찾을 수 없습니다.' });
    return;
  }

  if (clearTime < 0 || moveUsed < 0 || moveUsed > stage.move_limit) {
    res.status(400).json({ message: '기록 값이 올바르지 않습니다.' });
    return;
  }

  const userId = req.user?.id || findOrCreateUser(nickname);
  const score = calculateScore(stage.level, stage.move_limit, clearTime, moveUsed);
  const id = insert(
    `
    INSERT INTO records (user_id, stage_id, clear_time, move_used, score)
    VALUES (?, ?, ?, ?, ?)
    `,
    [userId, stageId, Math.round(clearTime), Math.round(moveUsed), score]
  );

  const saved = getRecordById(id);
  res.status(201).json(saved);
});

app.get('/api/rankings', (req, res) => {
  const limit = clamp(Number(req.query.limit || 20), 1, 100);
  const stageId = req.query.stageId ? Number(req.query.stageId) : null;
  const params = stageId ? [stageId, limit] : [limit];
  const filter = stageId ? 'WHERE r.stage_id = ?' : '';

  const rankings = all(
    `
    SELECT
      r.id,
      u.nickname,
      s.id AS stage_id,
      s.level,
      s.title,
      s.is_official,
      r.clear_time,
      r.move_used,
      r.score,
      r.created_at
    FROM records r
    JOIN users u ON u.id = r.user_id
    JOIN stages s ON s.id = r.stage_id
    ${filter}
    ORDER BY r.score DESC, r.clear_time ASC, r.move_used ASC
    LIMIT ?
    `,
    params
  );

  res.json(rankings);
});

app.get('/api/users/:nickname/best', (req, res) => {
  const nickname = String(req.params.nickname || '').trim();
  const rows = all(
    `
    SELECT
      r.id,
      s.level,
      s.title,
      r.clear_time,
      r.move_used,
      r.score,
      r.created_at
    FROM records r
    JOIN users u ON u.id = r.user_id
    JOIN stages s ON s.id = r.stage_id
    WHERE u.nickname = ?
    ORDER BY s.level ASC, r.score DESC, r.clear_time ASC
    `,
    [nickname]
  );

  const bestByStage = Object.values(
    rows.reduce((acc, row) => {
      if (!acc[row.level]) {
        acc[row.level] = row;
      }
      return acc;
    }, {})
  );

  res.json(bestByStage);
});

app.post('/api/admin/stages', requireAdmin, (req, res) => {
  const validation = validateStagePayload(req.body);
  if (!validation.ok) {
    res.status(400).json({ message: validation.message });
    return;
  }

  try {
    const payload = validation.stage;
    const id = insert(
      `
      INSERT INTO stages (level, title, board_data, move_limit, difficulty, is_official, is_public)
      VALUES (?, ?, ?, ?, ?, 1, 1)
      `,
      [payload.level, payload.title, JSON.stringify({ board: payload.board }), payload.moveLimit, payload.difficulty]
    );
    res.status(201).json(toStage(getStageById(id)));
  } catch (error) {
    res.status(409).json({ message: '이미 존재하는 레벨입니다.' });
  }
});

app.put('/api/admin/stages/:id', requireAdmin, (req, res) => {
  const validation = validateStagePayload(req.body);
  const id = Number(req.params.id);

  if (!validation.ok) {
    res.status(400).json({ message: validation.message });
    return;
  }

  const existing = get('SELECT * FROM stages WHERE id = ?', [id]);
  if (!existing) {
    res.status(404).json({ message: '스테이지를 찾을 수 없습니다.' });
    return;
  }

  try {
    const payload = validation.stage;
    run(
      `
      UPDATE stages
      SET level = ?, title = ?, board_data = ?, move_limit = ?, difficulty = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [payload.level, payload.title, JSON.stringify({ board: payload.board }), payload.moveLimit, payload.difficulty, id]
    );
    res.json(toStage(getStageById(id)));
  } catch (error) {
    res.status(409).json({ message: '이미 존재하는 레벨입니다.' });
  }
});

app.delete('/api/admin/stages/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = get('SELECT * FROM stages WHERE id = ?', [id]);
  if (!existing) {
    res.status(404).json({ message: '스테이지를 찾을 수 없습니다.' });
    return;
  }

  run('DELETE FROM records WHERE stage_id = ?', [id]);
  run('DELETE FROM stages WHERE id = ?', [id]);
  res.json({ ok: true });
});

app.use((req, res) => {
  res.status(404).json({ message: 'API 경로를 찾을 수 없습니다.' });
});

initDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Puzzle Tower API listening on port ${port}`);
  });
});

function requireAdmin(req, res, next) {
  if (req.header('x-admin-token') !== adminToken) {
    res.status(401).json({ message: '관리자 토큰이 올바르지 않습니다.' });
    return;
  }
  next();
}

function optionalAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    const user = getUserById(payload.sub);
    if (user) {
      req.user = user;
    }
  } catch (error) {
    // Optional auth should not block anonymous record saves.
  }
  next();
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ message: '로그인이 필요합니다.' });
    return;
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
    const user = getUserById(payload.sub);
    if (!user) {
      res.status(401).json({ message: '사용자를 찾을 수 없습니다.' });
      return;
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: '로그인이 만료되었습니다.' });
  }
}

function getBearerToken(req) {
  const header = req.header('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

function findOrCreateUser(nickname) {
  const existing = get('SELECT id FROM users WHERE nickname = ?', [nickname]);
  if (existing) {
    return existing.id;
  }
  return insert('INSERT INTO users (nickname, provider) VALUES (?, ?)', [nickname, 'guest']);
}

function getUserById(id) {
  return get('SELECT * FROM users WHERE id = ?', [Number(id)]);
}

function getStageById(id) {
  return get(
    `
    SELECT s.*, u.nickname AS creator_nickname
    FROM stages s
    LEFT JOIN users u ON u.id = s.creator_id
    WHERE s.id = ?
    `,
    [id]
  );
}

function getCustomBlockById(id) {
  return get(
    `
    SELECT b.*, u.nickname AS creator_nickname
    FROM custom_blocks b
    JOIN users u ON u.id = b.user_id
    WHERE b.id = ?
    `,
    [id]
  );
}

function createAuthToken(user) {
  return jwt.sign({ sub: String(user.id), nickname: user.nickname }, jwtSecret, { expiresIn: '7d' });
}

function publicUser(user) {
  return {
    id: user.id,
    nickname: user.nickname,
    email: user.email,
    provider: user.provider,
    createdAt: user.created_at
  };
}

function getRecordById(id) {
  return get(
    `
    SELECT
      r.id,
      u.nickname,
      s.id AS stage_id,
      s.level,
      s.title,
      r.clear_time,
      r.move_used,
      r.score,
      r.created_at
    FROM records r
    JOIN users u ON u.id = r.user_id
    JOIN stages s ON s.id = r.stage_id
    WHERE r.id = ?
    `,
    [id]
  );
}

function toStage(row) {
  const parsed = JSON.parse(row.board_data);
  const customBlockResult = normalizeCustomBlocks(parsed.customBlocks || parsed.blocks || []);
  return {
    id: row.id,
    level: row.level,
    title: row.title,
    board: parsed.board || parsed,
    customBlocks: customBlockResult.ok ? customBlockResult.blocks : [],
    moveLimit: row.move_limit,
    difficulty: row.difficulty,
    creatorId: row.creator_id,
    creatorNickname: row.creator_nickname,
    isOfficial: row.is_official !== 0,
    isPublic: row.is_public !== 0,
    playCount: row.play_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toCustomBlock(row) {
  const code = safeParseJson(row.code_data, {});
  return {
    id: row.id,
    userId: row.user_id,
    creatorNickname: row.creator_nickname,
    name: row.name,
    tile: row.tile,
    color: row.color,
    effect: row.effect,
    moveCost: row.move_cost,
    message: row.message || '',
    code,
    isPublic: row.is_public !== 0,
    downloads: row.downloads || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateStagePayload(body, options = {}) {
  const customBlockValidation = normalizeCustomBlocks(body?.customBlocks || body?.blocks || []);
  if (!customBlockValidation.ok) {
    return { ok: false, message: customBlockValidation.message };
  }

  const requireLevel = options.requireLevel !== false;
  const stage = {
    level: body?.level === undefined ? undefined : Number(body.level),
    title: String(body?.title || '').trim().slice(0, 40),
    difficulty: String(body?.difficulty || '').trim().slice(0, 20),
    moveLimit: Number(body?.moveLimit ?? body?.move_limit),
    board: body?.board,
    customBlocks: customBlockValidation.blocks
  };

  if (requireLevel && (!Number.isInteger(stage.level) || stage.level < 1)) {
    return { ok: false, message: 'level은 1 이상의 정수여야 합니다.' };
  }
  if (!stage.title || !stage.difficulty) {
    return { ok: false, message: 'title과 difficulty가 필요합니다.' };
  }
  if (!Number.isInteger(stage.moveLimit) || stage.moveLimit < 1 || stage.moveLimit > 99) {
    return { ok: false, message: 'moveLimit은 1~99 사이의 정수여야 합니다.' };
  }
  if (!Array.isArray(stage.board) || stage.board.length === 0 || stage.board.length > 10) {
    return { ok: false, message: 'board는 1~10줄 문자열 배열이어야 합니다.' };
  }

  const width = stage.board[0]?.length;
  const flat = stage.board.join('');
  const customTiles = stage.customBlocks.map((block) => block.tile).join('');
  const validTileSet = new Set(['.', '#', 'P', 'G', 'K', 'L', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...customTiles.split('')]);

  if (!width || width > 10 || stage.board.some((row) => typeof row !== 'string' || row.length !== width)) {
    return { ok: false, message: 'board의 모든 줄은 같은 길이여야 하며 최대 10칸까지 가능합니다.' };
  }
  if (flat.split('').some((tile) => !validTileSet.has(tile))) {
    return { ok: false, message: 'board에 사용할 수 없는 타일이 있습니다.' };
  }
  if ((flat.match(/P/g) || []).length !== 1 || (flat.match(/G/g) || []).length !== 1) {
    return { ok: false, message: 'board에는 P와 G가 각각 하나씩 있어야 합니다.' };
  }

  return { ok: true, stage };
}

function validateCustomBlockPayload(body) {
  const normalized = normalizeCustomBlocks([body]);
  if (!normalized.ok) {
    return { ok: false, message: normalized.message };
  }
  return { ok: true, block: normalized.blocks[0] };
}

function normalizeCustomBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    return { ok: false, message: 'customBlocks는 배열이어야 합니다.' };
  }

  const usedTiles = new Set();
  const normalized = [];
  const allowedEffects = new Set(['slow', 'wall', 'bounce', 'goal', 'key', 'lock', 'floor', 'force', 'oneway']);
  const reservedTiles = new Set(['.', '#', 'P', 'G', 'K', 'L', 'A', 'B']);

  for (const rawBlock of blocks.slice(0, 12)) {
    const code = typeof rawBlock?.code === 'string' ? safeParseJson(rawBlock.code, null) : rawBlock?.code || rawBlock;
    if (!code || typeof code !== 'object') {
      return { ok: false, message: '블록 코드는 JSON 객체여야 합니다.' };
    }

    const tile = String(code.tile || rawBlock?.tile || '').trim().slice(0, 1);
    const name = String(code.name || rawBlock?.name || '').trim().slice(0, 24);
    const effect = String(code.effect || rawBlock?.effect || 'slow').trim().toLowerCase();
    const color = String(code.color || rawBlock?.color || '#a78bfa').trim();
    const moveCost = clamp(Number(code.moveCost ?? rawBlock?.moveCost ?? rawBlock?.move_cost ?? 2), 1, 9);
    const message = String(code.message || rawBlock?.message || '').trim().slice(0, 80);
    const failMessage = String(code.failMessage || rawBlock?.failMessage || '').trim().slice(0, 80);
    const exitFailMessage = String(code.exitFailMessage || rawBlock?.exitFailMessage || '').trim().slice(0, 80);
    const outDirection = normalizeDirection(code.outDirection || code.exitDirection || rawBlock?.outDirection || rawBlock?.exitDirection || '');
    const image = normalizeBlockImage(code.image || code.imageData || rawBlock?.image || rawBlock?.imageData || '');
    const requires = normalizeCondition(code.requires || code.require || rawBlock?.requires || rawBlock?.require || null);
    const rules = normalizeRules(code.if || code.rules || rawBlock?.if || rawBlock?.rules || []);
    const consumeOnUse = code.consumeOnUse === true || rawBlock?.consumeOnUse === true;
    const giveKey = code.giveKey === true || rawBlock?.giveKey === true;
    const takeKey = code.takeKey === true || rawBlock?.takeKey === true;
    const isPublic = rawBlock?.isPublic !== false && rawBlock?.is_public !== 0;

    if (!/^[C-Z]$/.test(tile) || reservedTiles.has(tile)) {
      return { ok: false, message: '커스텀 블록 문자는 C~Z 중 예약되지 않은 한 글자여야 합니다.' };
    }
    if (usedTiles.has(tile)) {
      return { ok: false, message: '커스텀 블록 문자가 중복되었습니다.' };
    }
    if (!name) {
      return { ok: false, message: '블록 이름이 필요합니다.' };
    }
    if (!allowedEffects.has(effect)) {
      return { ok: false, message: '지원하지 않는 블록 효과입니다.' };
    }
    if ((effect === 'force' || effect === 'oneway') && !outDirection) {
      return { ok: false, message: 'force/oneway 효과에는 outDirection이 필요합니다.' };
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      return { ok: false, message: '블록 색상은 #RRGGBB 형식이어야 합니다.' };
    }
    if (image === null) {
      return { ok: false, message: '이미지는 180KB 이하의 png, jpg, webp, gif data URL만 사용할 수 있습니다.' };
    }
    if (!requires.ok) {
      return { ok: false, message: requires.message };
    }
    if (!rules.ok) {
      return { ok: false, message: rules.message };
    }

    usedTiles.add(tile);
    const codeData = {
      name,
      tile,
      color,
      effect,
      moveCost,
      message,
      failMessage,
      exitFailMessage,
      image,
      outDirection,
      requires: requires.condition,
      consumeOnUse,
      giveKey,
      takeKey,
      if: rules.rules
    };
    normalized.push({
      name,
      tile,
      color,
      effect,
      moveCost,
      message,
      failMessage,
      exitFailMessage,
      image,
      outDirection,
      requires: requires.condition,
      consumeOnUse,
      giveKey,
      takeKey,
      rules: rules.rules,
      isPublic,
      code: codeData
    });
  }

  return { ok: true, blocks: normalized };
}

function normalizeRules(rules) {
  if (!Array.isArray(rules)) {
    return { ok: false, message: 'if는 배열이어야 합니다.' };
  }

  const normalized = [];
  const allowedEffects = new Set(['slow', 'wall', 'bounce', 'goal', 'key', 'lock', 'floor', 'force', 'oneway']);

  for (const rule of rules.slice(0, 8)) {
    if (!rule || typeof rule !== 'object') {
      return { ok: false, message: 'if 규칙은 객체여야 합니다.' };
    }

    const when = normalizeCondition(rule.when || rule.condition || {});
    if (!when.ok) {
      return when;
    }

    const effect = rule.effect === undefined ? undefined : String(rule.effect).trim().toLowerCase();
    const outDirection = normalizeDirection(rule.outDirection || rule.exitDirection || '');

    if (effect !== undefined && !allowedEffects.has(effect)) {
      return { ok: false, message: 'if 규칙에 지원하지 않는 효과가 있습니다.' };
    }
    if ((effect === 'force' || effect === 'oneway') && !outDirection) {
      return { ok: false, message: 'if 규칙의 force/oneway 효과에는 outDirection이 필요합니다.' };
    }

    normalized.push({
      when: when.condition,
      ...(effect === undefined ? {} : { effect }),
      ...(rule.moveCost === undefined ? {} : { moveCost: clamp(Number(rule.moveCost), 1, 9) }),
      ...(outDirection ? { outDirection } : {}),
      ...(rule.message === undefined ? {} : { message: String(rule.message).trim().slice(0, 80) }),
      ...(rule.failMessage === undefined ? {} : { failMessage: String(rule.failMessage).trim().slice(0, 80) }),
      ...(rule.exitFailMessage === undefined ? {} : { exitFailMessage: String(rule.exitFailMessage).trim().slice(0, 80) }),
      ...(rule.consumeOnUse === undefined ? {} : { consumeOnUse: rule.consumeOnUse === true }),
      ...(rule.giveKey === undefined ? {} : { giveKey: rule.giveKey === true }),
      ...(rule.takeKey === undefined ? {} : { takeKey: rule.takeKey === true })
    });
  }

  return { ok: true, rules: normalized };
}

function normalizeCondition(condition) {
  if (!condition) {
    return { ok: true, condition: null };
  }
  if (typeof condition !== 'object' || Array.isArray(condition)) {
    return { ok: false, message: '조건은 객체여야 합니다.' };
  }

  const normalized = {};
  const direction = condition.direction;

  if (condition.hasKey !== undefined) {
    normalized.hasKey = condition.hasKey === true;
  }
  if (direction !== undefined) {
    const directions = Array.isArray(direction) ? direction : [direction];
    const normalizedDirections = directions.map(normalizeDirection);
    if (normalizedDirections.some((item) => !item)) {
      return { ok: false, message: 'direction은 up, down, left, right 중 하나여야 합니다.' };
    }
    normalized.direction = Array.isArray(direction) ? normalizedDirections : normalizedDirections[0];
  }

  ['movesUsedAtLeast', 'movesUsedAtMost', 'movesRemainingAtLeast', 'movesRemainingAtMost'].forEach((key) => {
    if (condition[key] !== undefined) {
      normalized[key] = clamp(Number(condition[key]), 0, 99);
    }
  });

  return { ok: true, condition: Object.keys(normalized).length ? normalized : null };
}

function normalizeDirection(value) {
  const direction = String(value || '').trim().toLowerCase();
  return ['up', 'down', 'left', 'right'].includes(direction) ? direction : '';
}

function normalizeBlockImage(value) {
  const image = String(value || '').trim();
  if (!image) {
    return '';
  }
  if (image.length > 180000) {
    return null;
  }
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(image) ? image : null;
}

function calculateScore(level, moveLimit, clearTime, moveUsed) {
  const remainingMoves = Math.max(moveLimit - moveUsed, 0);
  const levelWeight = Math.min(level, 30);
  return Math.max(levelWeight * 1000 + remainingMoves * 120 - Math.round(clearTime) * 8, levelWeight * 100);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeParseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}
