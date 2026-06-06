import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { randomInt } from 'node:crypto';
import { all, get, getStorageInfo, initDatabase, insert, run } from './db.js';
import { createNicknameKey, parseTags, sanitizeDisplayText, validateNicknameInput } from './nickname.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const configuredAdminToken = String(process.env.ADMIN_TOKEN || '').trim();
const adminToken = configuredAdminToken || 'admin123';
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

app.get('/api/storage/status', (req, res) => {
  res.json(getStorageInfo());
});

app.post('/api/auth/register', async (req, res) => {
  const nicknameValidation = validateNicknameInput(req.body?.nickname);
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const confirmPassword = String(req.body?.confirmPassword || '');

  if (!nicknameValidation.ok) {
    res.status(400).json({ message: nicknameValidation.message });
    return;
  }

  if (!isEmail(email) || password.length < 6) {
    res.status(400).json({ message: '닉네임, 이메일, 6자 이상 비밀번호가 필요합니다.' });
    return;
  }

  if (password !== confirmPassword) {
    res.status(400).json({ message: '비밀번호 확인이 일치하지 않습니다.' });
    return;
  }

  if (get('SELECT id FROM users WHERE email = ?', [email])) {
    res.status(409).json({ message: '이미 가입된 이메일입니다.' });
    return;
  }

  if (get('SELECT id FROM users WHERE nickname_key = ? OR LOWER(nickname) = ?', [nicknameValidation.key, nicknameValidation.key])) {
    res.status(409).json({ message: '이미 사용 중인 닉네임입니다.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  let id;
  try {
    id = insert(
      `
      INSERT INTO users (nickname, nickname_key, email, password_hash, provider)
      VALUES (?, ?, ?, ?, 'local')
      `,
      [nicknameValidation.nickname, nicknameValidation.key, email, passwordHash]
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ message: '이미 사용 중인 이메일 또는 닉네임입니다.' });
      return;
    }
    console.error(error);
    res.status(500).json({ message: '회원가입 중 오류가 발생했습니다.' });
    return;
  }

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

app.post('/api/auth/password-reset/request', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const genericMessage = '가입된 이메일이면 비밀번호 재설정 코드가 발급됩니다.';

  if (!isEmail(email)) {
    res.status(400).json({ message: '올바른 이메일을 입력하세요.' });
    return;
  }

  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !user.password_hash) {
    res.json({ message: genericMessage });
    return;
  }

  const recent = get(
    `
    SELECT created_at
    FROM password_reset_tokens
    WHERE user_id = ? AND created_at >= datetime('now', '-60 seconds')
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [user.id]
  );
  if (recent) {
    res.status(429).json({ message: '비밀번호 재설정 코드는 1분에 한 번만 요청할 수 있습니다.' });
    return;
  }

  const resetCode = String(randomInt(100000, 1000000));
  const tokenHash = await bcrypt.hash(resetCode, 10);
  run('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL', [user.id]);
  insert(
    `
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (?, ?, datetime('now', '+15 minutes'))
    `,
    [user.id, tokenHash]
  );

  const emailSent = await sendPasswordResetEmail(email, resetCode);
  const response = { message: genericMessage };
  if (emailSent) {
    response.message = '비밀번호 재설정 코드를 이메일로 보냈습니다. 15분 안에 사용하세요.';
  } else if (process.env.NODE_ENV !== 'production' || process.env.PASSWORD_RESET_EXPOSE_CODE === 'true') {
    response.resetCode = resetCode;
    response.message = '메일 서버가 없어 화면에 재설정 코드를 표시합니다. 15분 안에 사용하세요.';
  } else {
    response.message = '메일 서버 설정이 없어 재설정 코드를 보낼 수 없습니다. Render 환경변수 SMTP_HOST, SMTP_USER, SMTP_PASS를 설정하세요.';
  }
  res.json(response);
});

app.post('/api/auth/password-reset/confirm', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const resetCode = String(req.body?.resetCode || req.body?.code || '').trim();
  const password = String(req.body?.password || '');

  if (!isEmail(email) || !/^\d{6}$/.test(resetCode) || password.length < 6) {
    res.status(400).json({ message: '이메일, 6자리 코드, 6자 이상 새 비밀번호가 필요합니다.' });
    return;
  }

  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !user.password_hash) {
    res.status(400).json({ message: '재설정 코드가 올바르지 않거나 만료되었습니다.' });
    return;
  }

  const tokens = all(
    `
    SELECT *
    FROM password_reset_tokens
    WHERE user_id = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
    ORDER BY created_at DESC
    LIMIT 5
    `,
    [user.id]
  );
  let matchedToken = null;
  for (const token of tokens) {
    if (await bcrypt.compare(resetCode, token.token_hash)) {
      matchedToken = token;
      break;
    }
  }

  if (!matchedToken) {
    res.status(400).json({ message: '재설정 코드가 올바르지 않거나 만료되었습니다.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  run('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
  run('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [matchedToken.id]);
  res.json({ message: '비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요.' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get('/api/stages', (req, res) => {
  const filters = createSearchFilters(req.query, 's', 'u');
  const stages = all(
    `
    SELECT s.*, u.nickname AS creator_nickname
    FROM stages s
    LEFT JOIN users u ON u.id = s.creator_id
    WHERE (s.is_official = 1 OR s.is_public = 1)
      ${filters.where}
    ORDER BY s.is_official DESC, s.level ASC
    `,
    filters.params
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
  const filters = createSearchFilters(req.query, 's', 'u');
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
      ${filters.where}
    GROUP BY s.id
    ORDER BY s.created_at DESC
    `,
    filters.params
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
  const filters = createSearchFilters(req.query, 'b', 'u');
  const blocks = all(
    `
    SELECT b.*, u.nickname AS creator_nickname
    FROM custom_blocks b
    JOIN users u ON u.id = b.user_id
    WHERE b.is_public = 1
      ${filters.where}
    ORDER BY b.downloads DESC, b.created_at DESC
    `,
    filters.params
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
    INSERT INTO custom_blocks (user_id, name, tile, color, effect, tags, move_cost, message, code_data, is_public)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      req.user.id,
      block.name,
      block.tile,
      block.color,
      block.effect,
      JSON.stringify(block.tags),
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
    SET name = ?, tile = ?, color = ?, effect = ?, tags = ?, move_cost = ?, message = ?, code_data = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      block.name,
      block.tile,
      block.color,
      block.effect,
      JSON.stringify(block.tags),
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
  if (payload.creatorClearVerified !== true) {
    res.status(400).json({ message: '맵을 업로드하기 전에 제작자가 이 맵을 1회 클리어해야 합니다.' });
    return;
  }

  const generatedLevel = get('SELECT COALESCE(MAX(level), 999) + 1 AS level FROM stages WHERE is_official = 0 OR level >= 1000').level;
  const id = insert(
    `
    INSERT INTO stages (level, title, board_data, move_limit, difficulty, tags, creator_id, is_official, is_public, creator_clear_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 1)
    `,
    [
      generatedLevel,
      payload.title,
      JSON.stringify({ board: payload.board, customBlocks: payload.customBlocks, visionRadius: payload.visionRadius, clearHash: payload.clearHash }),
      payload.moveLimit,
      payload.difficulty,
      JSON.stringify(payload.tags),
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
  if (payload.creatorClearVerified !== true) {
    res.status(400).json({ message: '수정한 맵을 업로드하기 전에 제작자가 다시 1회 클리어해야 합니다.' });
    return;
  }

  run(
    `
    UPDATE stages
    SET title = ?, board_data = ?, move_limit = ?, difficulty = ?, tags = ?, is_public = ?, creator_clear_verified = 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `,
    [
      payload.title,
      JSON.stringify({ board: payload.board, customBlocks: payload.customBlocks, visionRadius: payload.visionRadius, clearHash: payload.clearHash }),
      payload.moveLimit,
      payload.difficulty,
      JSON.stringify(payload.tags),
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
  const nicknameValue = String(req.user?.nickname || body.nickname || '');
  const nicknameValidation = validateNicknameInput(nicknameValue, { allowAdmin: req.user?.provider === 'admin' });
  const stageId = Number(body.stageId);
  const clearTime = Number(body.clearTime);
  const moveUsed = Number(body.moveUsed);

  if (!nicknameValidation.ok) {
    res.status(400).json({ message: nicknameValidation.message });
    return;
  }

  if (!Number.isFinite(stageId) || !Number.isFinite(clearTime) || !Number.isFinite(moveUsed)) {
    res.status(400).json({ message: '기록 저장에 필요한 값이 부족합니다.' });
    return;
  }

  const stage = get('SELECT * FROM stages WHERE id = ? AND (is_official = 1 OR is_public = 1)', [stageId]);
  if (!stage) {
    res.status(404).json({ message: '스테이지를 찾을 수 없습니다.' });
    return;
  }

  if (clearTime < 0.05 || clearTime > 21600 || !Number.isInteger(moveUsed) || moveUsed < 0 || moveUsed > stage.move_limit) {
    res.status(400).json({ message: '기록 값이 올바르지 않습니다.' });
    return;
  }

  const existingNicknameOwner = get('SELECT id, provider FROM users WHERE nickname_key = ?', [nicknameValidation.key]);
  if (!req.user && existingNicknameOwner && existingNicknameOwner.provider !== 'guest') {
    res.status(401).json({ message: '등록된 닉네임으로 기록을 저장하려면 로그인해야 합니다.' });
    return;
  }

  const userId = req.user?.id || findOrCreateUser(nicknameValidation);
  const normalizedClearTime = Number(clearTime.toFixed(4));
  const score = calculateScore(stage.level, stage.move_limit, normalizedClearTime, moveUsed);
  const existingRecord = get('SELECT * FROM records WHERE user_id = ? AND stage_id = ?', [userId, stageId]);
  let saved;

  if (!existingRecord) {
    const id = insert(
      `
      INSERT INTO records (user_id, stage_id, clear_time, move_used, score)
      VALUES (?, ?, ?, ?, ?)
      `,
      [userId, stageId, normalizedClearTime, moveUsed, score]
    );
    saved = getRecordById(id);
  } else if (isBetterRecord({ score, clear_time: normalizedClearTime, move_used: moveUsed }, existingRecord)) {
    run(
      `
      UPDATE records
      SET clear_time = ?, move_used = ?, score = ?, created_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [normalizedClearTime, moveUsed, score, existingRecord.id]
    );
    saved = getRecordById(existingRecord.id);
  } else {
    saved = getRecordById(existingRecord.id);
  }

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
  const nicknameKey = createNicknameKey(req.params.nickname || '');
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
    WHERE u.nickname_key = ?
    ORDER BY s.level ASC, r.score DESC, r.clear_time ASC
    `,
    [nicknameKey]
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

app.post('/api/admin/login', requireAdmin, async (req, res) => {
  const adminEmail = String(req.body?.email || '').trim().toLowerCase();
  const adminPassword = String(req.body?.password || '');

  if (!isEmail(adminEmail) || adminPassword.length < 6) {
    res.status(400).json({ message: 'Admin 이메일과 6자 이상 비밀번호가 필요합니다.' });
    return;
  }

  try {
    const user = await setAdminLogin(adminEmail, adminPassword);
    res.json({ user: publicUser(user) });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.post('/api/admin/stages', requireAdmin, (req, res) => {
  const validation = validateStagePayload(req.body);
  if (!validation.ok) {
    res.status(400).json({ message: validation.message });
    return;
  }

  try {
    const payload = validation.stage;
    const adminId = getAdminUserId();
    const id = insert(
      `
      INSERT INTO stages (level, title, board_data, move_limit, difficulty, tags, creator_id, is_official, is_public, creator_clear_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1)
      `,
      [
        payload.level,
        payload.title,
        JSON.stringify({ board: payload.board, customBlocks: payload.customBlocks, visionRadius: payload.visionRadius }),
        payload.moveLimit,
        payload.difficulty,
        JSON.stringify(payload.tags),
        adminId
      ]
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
      SET level = ?, title = ?, board_data = ?, move_limit = ?, difficulty = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [
        payload.level,
        payload.title,
        JSON.stringify({ board: payload.board, customBlocks: payload.customBlocks, visionRadius: payload.visionRadius }),
        payload.moveLimit,
        payload.difficulty,
        JSON.stringify(payload.tags),
        id
      ]
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

initDatabase().then(async () => {
  await ensureConfiguredAdminLogin();
  app.listen(port, () => {
    console.log(`Puzzle Tower API listening on port ${port}`);
  });
});

function requireAdmin(req, res, next) {
  const providedToken = String(req.header('x-admin-token') || '').trim();
  if (providedToken !== adminToken) {
    const tokenHint = configuredAdminToken
      ? 'Render Environment에 설정한 ADMIN_TOKEN 값을 입력하세요.'
      : '현재 서버는 기본 관리자 토큰 admin123을 사용합니다.';
    res.status(401).json({ message: `관리자 토큰이 올바르지 않습니다. ${tokenHint}` });
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

function findOrCreateUser(nicknameValidation) {
  const existing = get('SELECT id FROM users WHERE nickname_key = ?', [nicknameValidation.key]);
  if (existing) {
    return existing.id;
  }
  try {
    return insert('INSERT INTO users (nickname, nickname_key, provider) VALUES (?, ?, ?)', [
      nicknameValidation.nickname,
      nicknameValidation.key,
      'guest'
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const createdByParallelRequest = get('SELECT id FROM users WHERE nickname_key = ?', [nicknameValidation.key]);
      if (createdByParallelRequest) {
        return createdByParallelRequest.id;
      }
    }
    throw error;
  }
}

function isUniqueConstraintError(error) {
  return /unique|constraint/i.test(String(error?.message || error));
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

function getAdminUserId() {
  const admin = get('SELECT id FROM users WHERE nickname_key = ?', ['admin']);
  return admin?.id || null;
}

async function ensureConfiguredAdminLogin() {
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = String(process.env.ADMIN_PASSWORD || '');

  if (!adminEmail && !adminPassword) {
    return;
  }
  if (!isEmail(adminEmail) || adminPassword.length < 6) {
    console.warn('ADMIN_EMAIL and ADMIN_PASSWORD must be set to enable Admin account login.');
    return;
  }

  await setAdminLogin(adminEmail, adminPassword);
}

async function setAdminLogin(adminEmail, adminPassword) {
  const admin = get('SELECT * FROM users WHERE nickname_key = ?', ['admin']);
  if (!admin) {
    throw new Error('Admin 계정을 찾을 수 없습니다.');
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const emailOwner = get('SELECT * FROM users WHERE email = ?', [adminEmail]);

  if (emailOwner && emailOwner.id !== admin.id) {
    const fallback = findAvailableFallbackNickname(admin.id);
    run('UPDATE stages SET creator_id = ? WHERE creator_id = ?', [emailOwner.id, admin.id]);
    run('UPDATE users SET nickname = ?, nickname_key = ?, email = NULL, provider = ? WHERE id = ?', [
      fallback.nickname,
      fallback.key,
      'guest',
      admin.id
    ]);
    run('UPDATE users SET nickname = ?, nickname_key = ?, password_hash = ?, provider = ? WHERE id = ?', [
      'Admin',
      'admin',
      passwordHash,
      'admin',
      emailOwner.id
    ]);
    return getUserById(emailOwner.id);
  }

  run('UPDATE users SET email = ?, password_hash = ?, provider = ? WHERE id = ?', [
    adminEmail,
    passwordHash,
    'admin',
    admin.id
  ]);
  return getUserById(admin.id);
}

function findAvailableFallbackNickname(userId) {
  for (let index = 0; index < 1000; index += 1) {
    const nickname = index === 0 ? `player${userId}` : `player${userId}x${index}`;
    const key = createNicknameKey(nickname);
    const taken = get('SELECT id FROM users WHERE nickname_key = ? AND id != ?', [key, userId]);
    if (!taken) {
      return { nickname, key };
    }
  }

  throw new Error('Admin 계정 전환에 사용할 임시 닉네임을 만들 수 없습니다.');
}

function createSearchFilters(query, entityAlias, userAlias) {
  const clauses = [];
  const params = [];
  const q = sanitizeDisplayText(query?.q || query?.search, 40, '').toLowerCase();
  const creator = sanitizeDisplayText(query?.creator || query?.maker, 32, '').toLowerCase();
  const tag = parseTags(query?.tag || query?.tags || '', 1)[0] || '';

  if (q) {
    const likeQ = `%${escapeLike(q)}%`;
    if (entityAlias === 'b') {
      clauses.push(`(
        LOWER(${entityAlias}.name) LIKE ? ESCAPE '\\'
        OR LOWER(${entityAlias}.effect) LIKE ? ESCAPE '\\'
        OR LOWER(${entityAlias}.tile) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(${entityAlias}.message, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(${entityAlias}.code_data, '')) LIKE ? ESCAPE '\\'
        OR LOWER(${entityAlias}.tags) LIKE ? ESCAPE '\\'
      )`);
      params.push(...Array(6).fill(likeQ));
    } else {
      clauses.push(`(
        LOWER(${entityAlias}.title) LIKE ? ESCAPE '\\'
        OR LOWER(${entityAlias}.difficulty) LIKE ? ESCAPE '\\'
        OR LOWER(${entityAlias}.tags) LIKE ? ESCAPE '\\'
      )`);
      params.push(...Array(3).fill(likeQ));
    }
  }

  if (creator) {
    clauses.push(`LOWER(${userAlias}.nickname) LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeLike(creator)}%`);
  }

  if (tag) {
    clauses.push(`LOWER(${entityAlias}.tags) LIKE ?`);
    params.push(`%"${tag}"%`);
  }

  return {
    where: clauses.length ? `AND ${clauses.join(' AND ')}` : '',
    params
  };
}

function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, (char) => `\\${char}`);
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

function isBetterRecord(next, previous) {
  if (!previous) {
    return true;
  }
  if (next.score !== previous.score) {
    return next.score > previous.score;
  }
  if (next.clear_time !== previous.clear_time) {
    return next.clear_time < previous.clear_time;
  }
  return next.move_used < previous.move_used;
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
    visionRadius: normalizeVisionRadius(parsed.visionRadius ?? parsed.vision_radius ?? ''),
    moveLimit: row.move_limit,
    difficulty: row.difficulty,
    tags: safeParseJson(row.tags, []),
    creatorId: row.creator_id,
    creatorNickname: row.creator_nickname,
    isOfficial: row.is_official !== 0,
    isPublic: row.is_public !== 0,
    creatorClearVerified: row.creator_clear_verified !== 0,
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
    tags: safeParseJson(row.tags, []),
    moveCost: row.move_cost,
    description: code.description || '',
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
  const tags = parseTags(body?.tags || body?.tagList || '');
  const stage = {
    level: body?.level === undefined ? undefined : Number(body.level),
    title: sanitizeDisplayText(body?.title, 40, ''),
    difficulty: sanitizeDisplayText(body?.difficulty, 20, ''),
    moveLimit: Number(body?.moveLimit ?? body?.move_limit),
    board: body?.board,
    customBlocks: customBlockValidation.blocks,
    visionRadius: normalizeVisionRadius(body?.visionRadius ?? body?.vision_radius ?? ''),
    tags,
    clearHash: sanitizeDisplayText(body?.clearHash, 120, ''),
    creatorClearVerified: body?.creatorClearVerified === true
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
  const allowedEffects = new Set(['slow', 'wall', 'bounce', 'goal', 'key', 'lock', 'floor', 'force', 'oneway', 'gameover']);
  const reservedTiles = new Set(['.', '#', 'P', 'G', 'K', 'L', 'A', 'B']);

  for (const rawBlock of blocks.slice(0, 12)) {
    const code = typeof rawBlock?.code === 'string' ? safeParseJson(rawBlock.code, null) : rawBlock?.code || rawBlock;
    if (!code || typeof code !== 'object') {
      return { ok: false, message: '블록 코드는 JSON 객체여야 합니다.' };
    }

    const tile = String(code.tile || rawBlock?.tile || '').trim().slice(0, 1);
    const name = sanitizeDisplayText(code.name || rawBlock?.name, 24, '');
    const effect = String(code.effect || rawBlock?.effect || 'slow').trim().toLowerCase();
    const color = String(code.color || rawBlock?.color || '#a78bfa').trim();
    const tags = parseTags(code.tags || rawBlock?.tags || '');
    const moveCost = clamp(Number(code.moveCost ?? rawBlock?.moveCost ?? rawBlock?.move_cost ?? 2), 1, 9);
    const description = sanitizeDisplayText(code.description || code.tooltip || rawBlock?.description || rawBlock?.tooltip, 160, '');
    const message = sanitizeDisplayText(code.message || rawBlock?.message, 80, '');
    const failMessage = sanitizeDisplayText(code.failMessage || rawBlock?.failMessage, 80, '');
    const exitFailMessage = sanitizeDisplayText(code.exitFailMessage || rawBlock?.exitFailMessage, 80, '');
    const outDirection = normalizeDirection(code.outDirection || code.exitDirection || rawBlock?.outDirection || rawBlock?.exitDirection || '');
    const image = normalizeBlockImage(code.image || code.imageData || rawBlock?.image || rawBlock?.imageData || '');
    const requires = normalizeCondition(code.requires || code.require || rawBlock?.requires || rawBlock?.require || null);
    const rules = normalizeRules(code.if || code.rules || rawBlock?.if || rawBlock?.rules || []);
    const spawn = normalizeSpawns(code.spawn || code.spawns || code.change || code.changes || rawBlock?.spawn || rawBlock?.spawns || rawBlock?.change || rawBlock?.changes || []);
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
    if (!spawn.ok) {
      return { ok: false, message: spawn.message };
    }

    usedTiles.add(tile);
    const codeData = {
      name,
      tile,
      color,
      effect,
      tags,
      moveCost,
      description,
      message,
      failMessage,
      exitFailMessage,
      image,
      outDirection,
      requires: requires.condition,
      consumeOnUse,
      giveKey,
      takeKey,
      spawn: spawn.items,
      if: rules.rules
    };
    normalized.push({
      name,
      tile,
      color,
      effect,
      tags,
      moveCost,
      description,
      message,
      failMessage,
      exitFailMessage,
      image,
      outDirection,
      requires: requires.condition,
      consumeOnUse,
      giveKey,
      takeKey,
      spawn: spawn.items,
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
  const allowedEffects = new Set(['slow', 'wall', 'bounce', 'goal', 'key', 'lock', 'floor', 'force', 'oneway', 'gameover']);

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
    const spawn = normalizeSpawns(rule.spawn || rule.spawns || rule.change || rule.changes || []);

    if (effect !== undefined && !allowedEffects.has(effect)) {
      return { ok: false, message: 'if 규칙에 지원하지 않는 효과가 있습니다.' };
    }
    if ((effect === 'force' || effect === 'oneway') && !outDirection) {
      return { ok: false, message: 'if 규칙의 force/oneway 효과에는 outDirection이 필요합니다.' };
    }
    if (!spawn.ok) {
      return { ok: false, message: spawn.message };
    }

    normalized.push({
      when: when.condition,
      ...(effect === undefined ? {} : { effect }),
      ...(rule.moveCost === undefined ? {} : { moveCost: clamp(Number(rule.moveCost), 1, 9) }),
      ...(outDirection ? { outDirection } : {}),
      ...(rule.message === undefined ? {} : { message: sanitizeDisplayText(rule.message, 80, '') }),
      ...(rule.failMessage === undefined ? {} : { failMessage: sanitizeDisplayText(rule.failMessage, 80, '') }),
      ...(rule.exitFailMessage === undefined ? {} : { exitFailMessage: sanitizeDisplayText(rule.exitFailMessage, 80, '') }),
      ...(rule.consumeOnUse === undefined ? {} : { consumeOnUse: rule.consumeOnUse === true }),
      ...(rule.giveKey === undefined ? {} : { giveKey: rule.giveKey === true }),
      ...(rule.takeKey === undefined ? {} : { takeKey: rule.takeKey === true }),
      ...(spawn.items.length ? { spawn: spawn.items } : {})
    });
  }

  return { ok: true, rules: normalized };
}

function normalizeSpawns(spawn) {
  const items = Array.isArray(spawn) ? spawn : spawn ? [spawn] : [];
  if (items.length > 12) {
    return { ok: false, message: 'spawn은 최대 12개까지만 넣을 수 있습니다.' };
  }

  const normalized = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, message: 'spawn 항목은 객체여야 합니다.' };
    }

    const tile = normalizeSpawnTile(item.tile || item.to || item.place);
    const targetTile = normalizeSpawnTile(item.targetTile || item.replaceTile || item.from);
    const row = Number(item.row);
    const col = Number(item.col);
    const relativeValue = String(item.relative || item.direction || '').trim().toLowerCase();
    const relative = relativeValue === 'current' ? 'current' : normalizeDirection(relativeValue);
    const distance = clamp(Number(item.distance || 1), 1, 9);
    const afterSeconds = clamp(Number(item.afterSeconds ?? item.after ?? 0), 0, 99);

    if (!tile) {
      return { ok: false, message: 'spawn의 tile은 ., #, G, K, L 또는 C~Z 한 글자여야 합니다. P는 사용할 수 없습니다.' };
    }

    if ((item.row !== undefined || item.col !== undefined) && (!Number.isFinite(row) || !Number.isFinite(col) || row < 1 || col < 1)) {
      return { ok: false, message: 'spawn의 row와 col은 1 이상의 숫자여야 합니다.' };
    }

    if ((item.relative !== undefined || item.direction !== undefined) && !relative) {
      return { ok: false, message: 'spawn의 relative는 current, up, down, left, right 중 하나여야 합니다.' };
    }
    if ((item.afterSeconds !== undefined || item.after !== undefined) && !Number.isFinite(Number(item.afterSeconds ?? item.after))) {
      return { ok: false, message: 'spawn의 afterSeconds는 0~99 사이 숫자여야 합니다.' };
    }

    if (!targetTile && !(Number.isFinite(row) && Number.isFinite(col)) && !relative) {
      return { ok: false, message: 'spawn에는 targetTile, row/col, relative 중 하나가 필요합니다.' };
    }

    normalized.push({
      tile,
      ...(targetTile ? { targetTile } : {}),
      ...(Number.isFinite(row) && Number.isFinite(col) ? { row: Math.round(row), col: Math.round(col) } : {}),
      ...(relative ? { relative } : {}),
      distance,
      afterSeconds
    });
  }

  return { ok: true, items: normalized };
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
      const value = Number(condition[key]);
      if (!Number.isFinite(value)) {
        normalized.__error = '이동 횟수 조건은 숫자여야 합니다.';
        return;
      }
      normalized[key] = clamp(value, 0, 99);
    }
  });

  ['elapsedSeconds', 'time', 'seconds'].forEach((key) => {
    if (condition[key] !== undefined) {
      const comparison = normalizeComparison(condition[key]);
      if (!comparison.ok) {
        normalized.__error = comparison.message;
      } else if (comparison.value) {
        normalized.elapsedSeconds = comparison.value;
      }
    }
  });

  if (normalized.__error) {
    return { ok: false, message: normalized.__error };
  }

  return { ok: true, condition: Object.keys(normalized).length ? normalized : null };
}

function normalizeComparison(value) {
  if (Number.isFinite(Number(value))) {
    return { ok: true, value: { '<=': clamp(Number(value), 0, 999) } };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: '시간 조건은 숫자 또는 비교 객체여야 합니다.' };
  }

  const normalized = {};
  for (const operator of ['>', '>=', '<', '<=']) {
    if (value[operator] !== undefined) {
      const number = Number(value[operator]);
      if (!Number.isFinite(number)) {
        return { ok: false, message: '시간 비교값은 숫자여야 합니다.' };
      }
      normalized[operator] = clamp(number, 0, 999);
    }
  }

  return { ok: true, value: Object.keys(normalized).length ? normalized : null };
}

function normalizeDirection(value) {
  const direction = String(value || '').trim().toLowerCase();
  return ['up', 'down', 'left', 'right'].includes(direction) ? direction : '';
}

function normalizeSpawnTile(value) {
  const tile = String(value || '').trim().slice(0, 1).toUpperCase();
  if (tile !== 'P' && (tile === '.' || tile === '#' || ['G', 'K', 'L'].includes(tile) || /^[C-Z]$/.test(tile))) {
    return tile;
  }
  return '';
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
  return Math.max(Math.round(levelWeight * 1000 + remainingMoves * 120 - clearTime * 8), levelWeight * 100);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}

function normalizeVisionRadius(value) {
  if (value === '' || value === null || value === undefined) {
    return '';
  }
  const radius = Number(value);
  if (!Number.isFinite(radius) || radius <= 0) {
    return '';
  }
  return clamp(radius, 1, 10);
}

async function sendPasswordResetEmail(email, resetCode) {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();

  if (!host || !user || !pass) {
    return false;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true' ||
    port === 465;

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass }
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || user,
      to: email,
      subject: 'Puzzle Tower 비밀번호 재설정 코드',
      text: `Puzzle Tower 비밀번호 재설정 코드: ${resetCode}\n\n이 코드는 15분 뒤 만료됩니다. 본인이 요청하지 않았다면 이 메일을 무시하세요.`
    });
    return true;
  } catch (error) {
    console.warn('Password reset email failed:', error.message);
    return false;
  }
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
