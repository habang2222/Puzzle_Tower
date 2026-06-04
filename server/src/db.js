import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { seedStages } from './stages.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sqlWasmPath = path.resolve(__dirname, '../node_modules/sql.js/dist');
const dataDir = path.resolve(__dirname, '../data');
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
      creator_id INTEGER,
      is_official INTEGER NOT NULL DEFAULT 1,
      is_public INTEGER NOT NULL DEFAULT 1,
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
  addColumnIfMissing('users', 'password_hash', 'TEXT');
  addColumnIfMissing('users', 'provider', "TEXT NOT NULL DEFAULT 'local'");
  addColumnIfMissing('stages', 'creator_id', 'INTEGER');
  addColumnIfMissing('stages', 'is_official', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('stages', 'is_public', 'INTEGER NOT NULL DEFAULT 1');
}

function seed() {
  const existing = get('SELECT COUNT(*) AS count FROM stages');
  if (existing.count > 0) {
    return;
  }

  seedStages.forEach((stage) => {
    insert(
      `
      INSERT INTO stages (level, title, board_data, move_limit, difficulty)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        stage.level,
        stage.title,
        JSON.stringify({ board: stage.board }),
        stage.moveLimit,
        stage.difficulty
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
