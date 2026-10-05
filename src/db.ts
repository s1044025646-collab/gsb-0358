import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

export const MAX_PLAYERS = 1000;
export const MAX_MATCHES_PER_VERSION = 100000;

export function dataDir(): string {
  return process.env.ELO_DATA_DIR || path.join(process.cwd(), "data");
}

export function openDb(file?: string): DatabaseSync {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(file || path.join(dir, "elo.db"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    k REAL NOT NULL,
    initial REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    seq INTEGER NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES versions(id),
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS matches (
    version_id INTEGER NOT NULL REFERENCES versions(id),
    match_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    a TEXT NOT NULL REFERENCES players(id),
    b TEXT NOT NULL REFERENCES players(id),
    result TEXT NOT NULL CHECK (result IN ('A','D','B')),
    rules_id INTEGER NOT NULL REFERENCES rules(id),
    PRIMARY KEY (version_id, match_id),
    UNIQUE (version_id, seq)
  );
  CREATE TABLE IF NOT EXISTS reports (
    version_id INTEGER NOT NULL,
    match_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    a TEXT NOT NULL,
    b TEXT NOT NULL,
    result TEXT NOT NULL,
    rules_id INTEGER NOT NULL,
    ra_pre REAL NOT NULL,
    rb_pre REAL NOT NULL,
    ea REAL NOT NULL,
    eb REAL NOT NULL,
    sa REAL NOT NULL,
    sb REAL NOT NULL,
    da REAL NOT NULL,
    db REAL NOT NULL,
    ra_post REAL NOT NULL,
    rb_post REAL NOT NULL,
    PRIMARY KEY (version_id, match_id)
  );
  `);
}
