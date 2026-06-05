import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { ADMIN_NICKNAME, ADMIN_NICKNAME_KEY, createNicknameKey, isReservedNicknameKey } from './nickname.js';
import { seedStages } from './stages.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlWasmPath = path.resolve(__dirname, '../node_modules/sql.js/dist');
const dataDir = path.resolve(process.env.PUZZLE_TOWER_DATA_DIR || process.env.DATA_DIR || path.resolve(__dirname, '../data'));
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
      clear_time INTEGER NOT NULL,
      move_used INTEGER NOT NULL,
      score INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (stage_id) REFERENCES stages(id)
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
  try {
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_key ON users(nickname_key) WHERE nickname_key IS NOT NULL');
  } catch (error) {
    console.warn('Could not create nickname key index. Existing duplicate nicknames may need cleanup.');
  }
}
