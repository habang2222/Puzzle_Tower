import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { ADMIN_NICKNAME, ADMIN_NICKNAME_KEY, createNicknameKey, isReservedNicknameKey } from './nickname.js';
import { seedStages } from './stages.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlWasmPath = path.resolve(__dirname, '../node_modules/sql.js/dist');
const dataDir = path.resolve(process.env.PUZZLE_TOWER_DATA_DIR || process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.resolve(__dirname, '../data'));
const dbPath = path.join(dataDir, 'puzzle-tower.sqlite');

let db;

export async function initDatabase() {
  fs.mkdirSync(dataDir, { recursive: true });
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(sqlWasmPath, file)
  });

  db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  migrate();
  seed();
  persist();
}

export function getStorageInfo() {
  const configuredDataDir = String(process.env.PUZZLE_TOWER_DATA_DIR || process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
  const isRailway = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_VOLUME_MOUNT_PATH);
  const isRender = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID || process.env.RENDER_EXTERNAL_URL);
  const usesVarData = path.resolve(dataDir).startsWith(path.resolve('/var/data'));
  const warning = isRender || (isRailway && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !process.env.PUZZLE_TOWER_DATA_DIR && !process.env.DATA_DIR);
  const message = isRailway
    ? process.env.RAILWAY_VOLUME_MOUNT_PATH
      ? `Railway Volume에 SQLite 데이터를 저장 중입니다: ${dataDir}`
      : 'Railway 앱 서비스에 Volume이 연결되지 않았습니다. SQLite 데이터가 재배포 때 사라질 수 있습니다.'
    : isRender
    ? usesVarData
      ? 'Render에서는 /var/data Persistent Disk가 서비스에 실제로 연결되어 있어야 계정, 비밀번호, 맵, 블록 데이터가 유지됩니다. Free 인스턴스만 쓰면 재배포 때 SQLite 데이터가 사라질 수 있습니다.'
      : 'Render 서버에서 영구 저장 위치가 설정되지 않았습니다. 계정, 비밀번호, 맵, 블록 데이터가 재배포 때 사라질 수 있습니다.'
    : '로컬 SQLite 파일에 저장 중입니다. 서버 data 폴더를 지우지 않으면 데이터가 유지됩니다.';

  return {
    driver: 'sqlite',
    dataDir,
    configuredDataDir: configuredDataDir || null,
    railway: isRailway,
    railwayVolume: Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH),
    render: isRender,
    usesVarData,
    warning,
    message
  };
}

export function all(sql, params = []) {
  const statement = db.prepare(sql);
  statement.bind(params);
  const rows = [];

  while (statement.step()) {
    rows.push(statement.getAsObject());
  }

  statement.free();
  return rows;
}

export function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

export function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

export function insert(sql, params = []) {
  db.run(sql, params);
  const id = get('SELECT last_insert_rowid() AS id').id;
  persist();
  return id;
}

function migrate() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL UNIQUE,
      nickname_key TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      provider TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      board_data TEXT NOT NULL,
      move_limit INTEGER NOT NULL,
      difficulty TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      creator_id INTEGER,
      is_official INTEGER NOT NULL DEFAULT 1,
      is_public INTEGER NOT NULL DEFAULT 1,
      creator_clear_verified INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      stage_id INTEGER NOT NULL,
      clear_time REAL NOT NULL,
      move_used INTEGER NOT NULL,
      score INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (stage_id) REFERENCES stages(id)
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS custom_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      tile TEXT NOT NULL,
      color TEXT NOT NULL,
      effect TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      move_cost INTEGER NOT NULL DEFAULT 1,
      message TEXT,
      code_data TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 1,
      downloads INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  addColumnIfMissing('users', 'email', 'TEXT');
  addColumnIfMissing('users', 'nickname_key', 'TEXT');
  addColumnIfMissing('users', 'password_hash', 'TEXT');
  addColumnIfMissing('users', 'provider', "TEXT NOT NULL DEFAULT 'local'");
  addColumnIfMissing('stages', 'tags', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing('stages', 'creator_id', 'INTEGER');
  addColumnIfMissing('stages', 'is_official', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('stages', 'is_public', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('stages', 'creator_clear_verified', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('custom_blocks', 'tags', "TEXT NOT NULL DEFAULT '[]'");
  backfillNicknameKeys();
  ensureUniqueIndexes();
}

function seed() {
  const adminId = ensureAdminUser();

  seedStages.forEach((stage) => {
    const existing = get('SELECT id FROM stages WHERE level = ?', [stage.level]);
    if (existing) {
      return;
    }

    insert(
      `
      INSERT INTO stages (level, title, board_data, move_limit, difficulty, tags, creator_id, is_official, is_public, creator_clear_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1)
      `,
      [
        stage.level,
        stage.title,
        JSON.stringify({ board: stage.board, customBlocks: stage.customBlocks || [] }),
        stage.moveLimit,
        stage.difficulty,
        JSON.stringify(stage.tags || []),
        stage.creatorNickname === ADMIN_NICKNAME ? adminId : null
      ]
    );
  });
}

function persist() {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function addColumnIfMissing(table, column, definition) {
  const result = db.exec(`PRAGMA table_info(${table})`);
  const columns = result[0]?.values.map((row) => row[1]) || [];

  if (!columns.includes(column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function backfillNicknameKeys() {
  const users = all('SELECT id, nickname, nickname_key, provider FROM users');
  users.forEach((user) => {
    let nickname = user.nickname;
    let key = user.nickname_key || createNicknameKey(user.nickname);

    if (user.provider !== 'admin' && isReservedNicknameKey(key)) {
      nickname = `player${user.id}`;
      key = createNicknameKey(nickname);
    }

    if (!user.nickname_key) {
      db.run('UPDATE users SET nickname = ?, nickname_key = ? WHERE id = ?', [nickname, key, user.id]);
    } else if (nickname !== user.nickname) {
      db.run('UPDATE users SET nickname = ?, nickname_key = ? WHERE id = ?', [nickname, key, user.id]);
    }
  });
}

function ensureAdminUser() {
  const existing =
    get('SELECT id FROM users WHERE nickname_key = ?', [ADMIN_NICKNAME_KEY]) ||
    get('SELECT id FROM users WHERE LOWER(nickname) = ?', [ADMIN_NICKNAME_KEY]);

  if (existing) {
    db.run('UPDATE users SET nickname = ?, nickname_key = ?, provider = ? WHERE id = ?', [
      ADMIN_NICKNAME,
      ADMIN_NICKNAME_KEY,
      'admin',
      existing.id
    ]);
    return existing.id;
  }

  db.run('INSERT INTO users (nickname, nickname_key, provider) VALUES (?, ?, ?)', [
    ADMIN_NICKNAME,
    ADMIN_NICKNAME_KEY,
    'admin'
  ]);
  return get('SELECT last_insert_rowid() AS id').id;
}

function ensureUniqueIndexes() {
  dedupeRecords();
  createIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_key ON users(nickname_key) WHERE nickname_key IS NOT NULL');
  createIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL');
  createIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_records_user_stage ON records(user_id, stage_id)');
  createIndex('CREATE INDEX IF NOT EXISTS idx_records_ranking ON records(stage_id, score DESC, clear_time ASC, move_used ASC)');
  createIndex('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, expires_at)');
}

function createIndex(sql) {
  try {
    db.run(sql);
  } catch (error) {
    console.warn(`Could not create index: ${sql}`);
  }
}

function dedupeRecords() {
  const records = all(
    `
    SELECT *
    FROM records
    ORDER BY user_id ASC, stage_id ASC, score DESC, clear_time ASC, move_used ASC, created_at ASC
    `
  );
  const seen = new Set();

  records.forEach((record) => {
    const key = `${record.user_id}:${record.stage_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      return;
    }
    db.run('DELETE FROM records WHERE id = ?', [record.id]);
  });
}
