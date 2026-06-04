import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { all, get, initDatabase, insert, run } from './db.js';

const app = express();
const port = Number(process.env.PORT || 4000);
const adminToken = process.env.ADMIN_TOKEN || 'admin123';

app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Puzzle Tower API',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/stages', (req, res) => {
  const stages = all('SELECT * FROM stages ORDER BY level ASC').map(toStage);
  res.json(stages);
});

app.get('/api/stages/:level', (req, res) => {
  const stage = get('SELECT * FROM stages WHERE level = ?', [Number(req.params.level)]);
  if (!stage) {
    res.status(404).json({ message: '스테이지를 찾을 수 없습니다.' });
    return;
  }
  res.json(toStage(stage));
});

app.post('/api/records', (req, res) => {
  const body = req.body || {};
  const nickname = String(body.nickname || '').trim().slice(0, 18);
  const stageId = Number(body.stageId);
  const clearTime = Number(body.clearTime);
  const moveUsed = Number(body.moveUsed);

  if (!nickname || !Number.isFinite(stageId) || !Number.isFinite(clearTime) || !Number.isFinite(moveUsed)) {
    res.status(400).json({ message: '기록 저장에 필요한 값이 부족합니다.' });
    return;
  }

  const stage = get('SELECT * FROM stages WHERE id = ?', [stageId]);
  if (!stage) {
    res.status(404).json({ message: '스테이지를 찾을 수 없습니다.' });
    return;
  }

  if (clearTime < 0 || moveUsed < 0 || moveUsed > stage.move_limit) {
    res.status(400).json({ message: '기록 값이 올바르지 않습니다.' });
    return;
  }

  const userId = findOrCreateUser(nickname);
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
      INSERT INTO stages (level, title, board_data, move_limit, difficulty)
      VALUES (?, ?, ?, ?, ?)
      `,
      [payload.level, payload.title, JSON.stringify({ board: payload.board }), payload.moveLimit, payload.difficulty]
    );
    res.status(201).json(toStage(get('SELECT * FROM stages WHERE id = ?', [id])));
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
    res.json(toStage(get('SELECT * FROM stages WHERE id = ?', [id])));
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

function findOrCreateUser(nickname) {
  const existing = get('SELECT id FROM users WHERE nickname = ?', [nickname]);
  if (existing) {
    return existing.id;
  }
  return insert('INSERT INTO users (nickname) VALUES (?)', [nickname]);
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateStagePayload(body) {
  const stage = {
    level: Number(body?.level),
    title: String(body?.title || '').trim(),
    difficulty: String(body?.difficulty || '').trim(),
    moveLimit: Number(body?.moveLimit ?? body?.move_limit),
    board: body?.board
  };

  if (!Number.isInteger(stage.level) || stage.level < 1) {
    return { ok: false, message: 'level은 1 이상의 정수여야 합니다.' };
  }
  if (!stage.title || !stage.difficulty) {
    return { ok: false, message: 'title과 difficulty가 필요합니다.' };
  }
  if (!Number.isInteger(stage.moveLimit) || stage.moveLimit < 1) {
    return { ok: false, message: 'moveLimit은 1 이상의 정수여야 합니다.' };
  }
  if (!Array.isArray(stage.board) || stage.board.length === 0) {
    return { ok: false, message: 'board는 문자열 배열이어야 합니다.' };
  }

  const width = stage.board[0]?.length;
  const flat = stage.board.join('');
  const validTiles = /^[.#PGKLA-Z]+$/;

  if (!width || stage.board.some((row) => typeof row !== 'string' || row.length !== width)) {
    return { ok: false, message: 'board의 모든 줄은 같은 길이여야 합니다.' };
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
  return Math.max(level * 1000 + remainingMoves * 120 - Math.round(clearTime) * 8, level * 100);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}
