import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import initSqlJs from 'sql.js';
import { ADMIN_NICKNAME, ADMIN_NICKNAME_KEY, createNicknameKey, isReservedNicknameKey } from './nickname.js';
import { seedStages } from './stages.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlWasmPath = path.resolve(__dirname, '../node_modules/sql.js/dist');
const dataDir = path.resolve(
  process.env.PUZZLE_TOWER_DATA_DIR ||
    process.env.DATA_DIR ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH ||
    path.resolve(__dirname, '../data')
);
const dbPath = path.join(dataDir, 'puzzle-tower.sqlite');
const postgresUrl = String(process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || '').trim();
const requestedDriver = String(process.env.DB_DRIVER || '').trim().toLowerCase();
const usePostgres = Boolean(postgresUrl) && requestedDriver !== 'sqlite';

let db;
let pool;

export async function initDatabase() {
  if (usePostgres) {
    pool = new Pool({
      connectionString: postgresUrl,
      ssl: getPostgresSsl()
    });
    await pool.query('SELECT 1');
    await migratePostgres();
    await seed();
    return;
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(sqlWasmPath, file)
  });

  db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  migrateSqlite();
  await backfillNicknameKeys();
  await ensureUniqueIndexes();
  await seed();
  persist();
}

export function getStorageInfo() {
  if (usePostgres) {
    return {
      driver: 'postgres',
      databaseConfigured: true,
      railway: Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID),
      railwayVolume: false,
      render: false,
      warning: false,
      message: 'Railway Postgres DATABASE_URL에 계정, 비밀번호, 맵, 블록, 기록 데이터를 저장 중입니다.'
    };
  }

  const configuredDataDir = String(
    process.env.PUZZLE_TOWER_DATA_DIR || process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || ''
  ).trim();
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

export async function all(sql, params = []) {
  if (usePostgres) {
    const result = await pool.query(toPostgresSql(sql), params);
    return result.rows;
  }

  const statement = db.prepare(sql);
  statement.bind(params);
  const rows = [];

  while (statement.step()) {
    rows.push(statement.getAsObject());
  }

  statement.free();
  return rows;
}

export async function get(sql, params = []) {
  return (await all(sql, params))[0] || null;
}

export async function run(sql, params = []) {
  if (usePostgres) {
    await pool.query(toPostgresSql(sql), params);
    return;
  }

  db.run(sql, params);
  persist();
}

export async function insert(sql, params = []) {
  if (usePostgres) {
    const result = await pool.query(toPostgresSql(sql, { returningId: true }), params);
    return result.rows[0]?.id;
  }

  db.run(sql, params);
  const id = (await get('SELECT last_insert_rowid() AS id')).id;
  persist();
  return id;
}

async function migratePostgres() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nickname TEXT NOT NULL UNIQUE,
      nickname_key TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      provider TEXT NOT NULL DEFAULT 'local',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stages (
      id SERIAL PRIMARY KEY,
      level INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      board_data TEXT NOT NULL,
      move_limit INTEGER NOT NULL,
      difficulty TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      creator_id INTEGER REFERENCES users(id),
      is_official INTEGER NOT NULL DEFAULT 1,
      is_public INTEGER NOT NULL DEFAULT 1,
      creator_clear_verified INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS records (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      stage_id INTEGER NOT NULL REFERENCES stages(id),
      clear_time REAL NOT NULL,
      move_used INTEGER NOT NULL,
      score INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS custom_blocks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await addPostgresColumnIfMissing('users', 'email', 'TEXT');
  await addPostgresColumnIfMissing('users', 'nickname_key', 'TEXT');
  await addPostgresColumnIfMissing('users', 'password_hash', 'TEXT');
  await addPostgresColumnIfMissing('users', 'provider', "TEXT NOT NULL DEFAULT 'local'");
  await addPostgresColumnIfMissing('stages', 'tags', "TEXT NOT NULL DEFAULT '[]'");
  await addPostgresColumnIfMissing('stages', 'creator_id', 'INTEGER REFERENCES users(id)');
  await addPostgresColumnIfMissing('stages', 'is_official', 'INTEGER NOT NULL DEFAULT 1');
  await addPostgresColumnIfMissing('stages', 'is_public', 'INTEGER NOT NULL DEFAULT 1');
  await addPostgresColumnIfMissing('stages', 'creator_clear_verified', 'INTEGER NOT NULL DEFAULT 1');
  await addPostgresColumnIfMissing('custom_blocks', 'tags', "TEXT NOT NULL DEFAULT '[]'");
  await backfillNicknameKeys();
  await ensureUniqueIndexes();
}

function migrateSqlite() {
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

  addSqliteColumnIfMissing('users', 'email', 'TEXT');
  addSqliteColumnIfMissing('users', 'nickname_key', 'TEXT');
  addSqliteColumnIfMissing('users', 'password_hash', 'TEXT');
  addSqliteColumnIfMissing('users', 'provider', "TEXT NOT NULL DEFAULT 'local'");
  addSqliteColumnIfMissing('stages', 'tags', "TEXT NOT NULL DEFAULT '[]'");
  addSqliteColumnIfMissing('stages', 'creator_id', 'INTEGER');
  addSqliteColumnIfMissing('stages', 'is_official', 'INTEGER NOT NULL DEFAULT 1');
  addSqliteColumnIfMissing('stages', 'is_public', 'INTEGER NOT NULL DEFAULT 1');
  addSqliteColumnIfMissing('stages', 'creator_clear_verified', 'INTEGER NOT NULL DEFAULT 1');
  addSqliteColumnIfMissing('custom_blocks', 'tags', "TEXT NOT NULL DEFAULT '[]'");
}

async function seed() {
  const adminId = await ensureAdminUser();

  for (const stage of seedStages) {
    const existing = await get('SELECT id FROM stages WHERE level = ?', [stage.level]);
    if (existing) {
      continue;
    }

    await insert(
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
  }
}

function persist() {
  if (!db) {
    return;
  }
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function addSqliteColumnIfMissing(table, column, definition) {
  const result = db.exec(`PRAGMA table_info(${table})`);
  const columns = result[0]?.values.map((row) => row[1]) || [];

  if (!columns.includes(column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function addPostgresColumnIfMissing(table, column, definition) {
  await pool.query(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN IF NOT EXISTS ${quoteIdentifier(column)} ${definition}`);
}

async function backfillNicknameKeys() {
  const users = await all('SELECT id, nickname, nickname_key, provider FROM users');
  for (const user of users) {
    let nickname = user.nickname;
    let key = user.nickname_key || createNicknameKey(user.nickname);

    if (user.provider !== 'admin' && isReservedNicknameKey(key)) {
      nickname = `player${user.id}`;
      key = createNicknameKey(nickname);
    }

    if (!user.nickname_key) {
      await run('UPDATE users SET nickname = ?, nickname_key = ? WHERE id = ?', [nickname, key, user.id]);
    } else if (nickname !== user.nickname) {
      await run('UPDATE users SET nickname = ?, nickname_key = ? WHERE id = ?', [nickname, key, user.id]);
    }
  }
}

async function ensureAdminUser() {
  const existing =
    (await get('SELECT id FROM users WHERE nickname_key = ?', [ADMIN_NICKNAME_KEY])) ||
    (await get('SELECT id FROM users WHERE LOWER(nickname) = ?', [ADMIN_NICKNAME_KEY]));

  if (existing) {
    await run('UPDATE users SET nickname = ?, nickname_key = ?, provider = ? WHERE id = ?', [
      ADMIN_NICKNAME,
      ADMIN_NICKNAME_KEY,
      'admin',
      existing.id
    ]);
    return existing.id;
  }

  return await insert('INSERT INTO users (nickname, nickname_key, provider) VALUES (?, ?, ?)', [
    ADMIN_NICKNAME,
    ADMIN_NICKNAME_KEY,
    'admin'
  ]);
}

async function ensureUniqueIndexes() {
  await dedupeRecords();
  await createIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_key ON users(nickname_key) WHERE nickname_key IS NOT NULL');
  await createIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL');
  await createIndex('CREATE UNIQUE INDEX IF NOT EXISTS idx_records_user_stage ON records(user_id, stage_id)');
  await createIndex('CREATE INDEX IF NOT EXISTS idx_records_ranking ON records(stage_id, score DESC, clear_time ASC, move_used ASC)');
  await createIndex('CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, expires_at)');
}

async function createIndex(sql) {
  try {
    await run(sql);
  } catch (error) {
    console.warn(`Could not create index: ${sql}`);
  }
}

async function dedupeRecords() {
  const records = await all(
    `
    SELECT *
    FROM records
    ORDER BY user_id ASC, stage_id ASC, score DESC, clear_time ASC, move_used ASC, created_at ASC
    `
  );
  const seen = new Set();

  for (const record of records) {
    const key = `${record.user_id}:${record.stage_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    await run('DELETE FROM records WHERE id = ?', [record.id]);
  }
}

function toPostgresSql(sql, options = {}) {
  let parameterIndex = 0;
  let transformed = String(sql)
    .replace(/datetime\('now',\s*'-60 seconds'\)/gi, "(CURRENT_TIMESTAMP - INTERVAL '60 seconds')")
    .replace(/datetime\('now',\s*'\+15 minutes'\)/gi, "(CURRENT_TIMESTAMP + INTERVAL '15 minutes')")
    .replace(/\?/g, () => `$${++parameterIndex}`);

  if (options.returningId && /^\s*INSERT\b/i.test(transformed) && !/\bRETURNING\b/i.test(transformed)) {
    transformed = `${transformed.trim().replace(/;$/, '')} RETURNING id`;
  }

  return transformed;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function getPostgresSsl() {
  const mode = String(process.env.PGSSLMODE || process.env.DATABASE_SSL || '').trim().toLowerCase();
  if (['require', 'true', '1', 'verify-ca', 'verify-full'].includes(mode)) {
    return { rejectUnauthorized: false };
  }
  if (postgresUrl.includes('sslmode=require')) {
    return { rejectUnauthorized: false };
  }
  return false;
}
