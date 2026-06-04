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
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || `http://localhost:${port}/api/auth/google/callback`;

app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Puzzle Tower API',
    googleLogin: Boolean(googleClientId && googleClientSecret),
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

app.get('/api/auth/google/start', (req, res) => {
  const redirect = safeRedirect(req.query.redirect);

  if (!googleClientId || !googleClientSecret) {
    res.redirect(appendQuery(redirect, { auth_error: 'google-not-configured' }));
    return;
  }

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', googleClientId);
  authUrl.searchParams.set('redirect_uri', googleCallbackUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('prompt', 'select_account');
  authUrl.searchParams.set('state', encodeState({ redirect }));
  res.redirect(authUrl.toString());
});

app.get('/api/auth/google/callback', async (req, res) => {
  const state = decodeState(req.query.state);
  const redirect = safeRedirect(state.redirect);
  const code = String(req.query.code || '');

  if (!code) {
    res.redirect(appendQuery(redirect, { auth_error: 'google-code-missing' }));
    return;
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: googleCallbackUrl,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Google token exchange failed');
    }

    const tokenData = await tokenResponse.json();
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    if (!profileResponse.ok) {
      throw new Error('Google profile request failed');
    }

    const profile = await profileResponse.json();
    const user = upsertGoogleUser(profile);
    res.redirect(appendQuery(redirect, { token: createAuthToken(user), auth: 'google' }));
  } catch (error) {
    res.redirect(appendQuery(redirect, { auth_error: 'google-login-failed' }));
  }
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
    [generatedLevel, payload.title, JSON.stringify({ board: payload.board }), payload.moveLimit, payload.difficulty, req.user.id]
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
      JSON.stringify({ board: payload.board }),
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

function upsertGoogleUser(profile) {
  const googleId = String(profile.sub || '');
  const email = String(profile.email || '').toLowerCase();
  const fallbackNickname = makeUniqueNickname(String(profile.name || email.split('@')[0] || 'google-player').slice(0, 18));
  const existing = get('SELECT * FROM users WHERE google_id = ? OR email = ?', [googleId, email]);

  if (existing) {
    run(
      `
      UPDATE users
      SET google_id = ?, email = ?, avatar_url = ?, provider = ?
      WHERE id = ?
      `,
      [googleId, email, profile.picture || null, existing.password_hash ? 'local_google' : 'google', existing.id]
    );
    return getUserById(existing.id);
  }

  const id = insert(
    `
    INSERT INTO users (nickname, email, provider, google_id, avatar_url)
    VALUES (?, ?, 'google', ?, ?)
    `,
    [fallbackNickname, email, googleId, profile.picture || null]
  );
  return getUserById(id);
}

function makeUniqueNickname(base) {
  const normalized = base.replace(/[^a-zA-Z0-9가-힣_-]/g, '').slice(0, 18) || 'player';
  let candidate = normalized;
  let index = 1;

  while (get('SELECT id FROM users WHERE nickname = ?', [candidate])) {
    const suffix = String(index);
    candidate = `${normalized.slice(0, 18 - suffix.length)}${suffix}`;
    index += 1;
  }

  return candidate;
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
    avatarUrl: user.avatar_url,
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
  return {
    id: row.id,
    level: row.level,
    title: row.title,
    board: parsed.board || parsed,
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

function validateStagePayload(body, options = {}) {
  const requireLevel = options.requireLevel !== false;
  const stage = {
    level: body?.level === undefined ? undefined : Number(body.level),
    title: String(body?.title || '').trim().slice(0, 40),
    difficulty: String(body?.difficulty || '').trim().slice(0, 20),
    moveLimit: Number(body?.moveLimit ?? body?.move_limit),
    board: body?.board
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
  const validTiles = /^[.#PGKLA-Z]+$/;

  if (!width || width > 10 || stage.board.some((row) => typeof row !== 'string' || row.length !== width)) {
    return { ok: false, message: 'board의 모든 줄은 같은 길이여야 하며 최대 10칸까지 가능합니다.' };
  }
  if (!validTiles.test(flat)) {
    return { ok: false, message: 'board에 사용할 수 없는 타일이 있습니다.' };
  }
  if ((flat.match(/P/g) || []).length !== 1 || (flat.match(/G/g) || []).length !== 1) {
    return { ok: false, message: 'board에는 P와 G가 각각 하나씩 있어야 합니다.' };
  }

  return { ok: true, stage };
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

function encodeState(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeState(value) {
  try {
    return JSON.parse(Buffer.from(String(value || ''), 'base64url').toString('utf8'));
  } catch (error) {
    return {};
  }
}

function safeRedirect(value) {
  const fallback = clientUrl;
  const target = String(value || fallback);

  try {
    const url = new URL(target);
    const allowedOrigins = new Set([new URL(clientUrl).origin, 'http://localhost:5173', 'http://127.0.0.1:5173']);
    return allowedOrigins.has(url.origin) ? url.toString() : fallback;
  } catch (error) {
    return fallback;
  }
}

function appendQuery(target, params) {
  const url = new URL(target);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}
