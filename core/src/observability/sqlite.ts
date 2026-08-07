// The `node:sqlite` driver boundary — invariant: nothing outside this file,
// `projector.ts`, and `migrations/` may call `.exec`/`.run`/`.prepare` on a
// SQLite handle (enforced by `core/test/unit/meta/sqlite-write-fence.test.ts`).
// `node:sqlite` is young enough (Node 22.5+, still experimental) that its
// relative immaturity is contained to this one module, and a corrupt DB is
// disposable by design — `rebuild.ts` (T8) regenerates it from the journal.

import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type { DatabaseSync } from "node:sqlite";

export const DEFAULT_MIGRATIONS_DIR = join(import.meta.dirname, "migrations");

/** Thrown when this binary's SQLite build lacks a feature the schema requires. */
export class UnsupportedSqliteFeatures extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(`this node:sqlite build is missing required features: ${missing.join(", ")}`);
    this.name = "UnsupportedSqliteFeatures";
    this.missing = missing;
  }
}

/** Thrown when a database's `user_version` is newer than any migration this binary knows. */
export class DatabaseNewerThanBinary extends Error {
  readonly dbVersion: number;
  readonly maxKnownVersion: number;

  constructor(dbVersion: number, maxKnownVersion: number) {
    super(
      `database is at user_version ${dbVersion}, newer than this binary's highest known ` +
        `migration (${maxKnownVersion}); refusing to open it — upgrade the binary first`,
    );
    this.name = "DatabaseNewerThanBinary";
    this.dbVersion = dbVersion;
    this.maxKnownVersion = maxKnownVersion;
  }
}

export interface OpenDatabaseOptions {
  /** Opens on a `readonly: true` connection — the API's read path, per the Concurrency rule. */
  readonly?: boolean;
  /** Overridable for tests; defaults to the real `migrations/` directory next to this file. */
  migrationsDir?: string;
}

interface MigrationFile {
  version: number;
  path: string;
  sql: string;
}

const MIGRATION_FILENAME = /^(\d{4})-.+\.sql$/;

function loadMigrations(migrationsDir: string): MigrationFile[] {
  let entries: string[];
  try {
    entries = readdirSync(migrationsDir);
  } catch {
    return [];
  }
  return entries
    .map((name) => ({ name, match: MIGRATION_FILENAME.exec(name) }))
    .filter((e): e is { name: string; match: RegExpExecArray } => e.match !== null)
    .map(({ name, match }) => {
      const path = join(migrationsDir, name);
      const version = Number.parseInt(match[1] ?? "0", 10);
      return { version, path, sql: readFileSync(path, "utf8") };
    })
    .sort((a, b) => a.version - b.version);
}

/**
 * Verifies the three schema-load-bearing SQLite features are present:
 * WAL, `STRICT` tables, and `json_valid()`. Runs once at startup against a
 * scratch, in-memory connection so a missing feature is caught before any
 * real database file is touched.
 */
export function probeFeatures(): void {
  const missing: string[] = [];
  const probe = new DatabaseSync(":memory:");
  try {
    try {
      probe.exec("CREATE TABLE __probe_strict (id INTEGER PRIMARY KEY, j TEXT CHECK (json_valid(j))) STRICT;");
      probe.exec("INSERT INTO __probe_strict (j) VALUES ('{}');");
    } catch {
      missing.push("STRICT tables + json_valid()");
    }
    try {
      const row = probe.prepare("PRAGMA journal_mode = WAL").get() as { journal_mode?: string } | undefined;
      if (row?.journal_mode !== "wal" && row?.journal_mode !== "memory") {
        missing.push("WAL journal mode");
      }
    } catch {
      missing.push("WAL journal mode");
    }
  } finally {
    probe.close();
  }
  if (missing.length > 0) {
    throw new UnsupportedSqliteFeatures(missing);
  }
}

function getUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

/**
 * Applies every pending migration, each inside its own `BEGIN IMMEDIATE`
 * transaction (an exclusive write lock from the first statement, so no other
 * connection can race a schema change in). Refuses outright if the database
 * is already newer than the highest migration this binary ships — the
 * explicit fix for SSSF's marker-less additive `ALTER` list.
 */
// SQLite refuses to change these two ("safety level") pragmas from inside a
// transaction, so they run once, ahead of `BEGIN IMMEDIATE`, per migration
// file; every other statement — including the trailing `PRAGMA user_version`
// — runs inside the transaction exactly as the schema specifies.
const TRANSACTION_UNSAFE_PRAGMA = /^PRAGMA\s+(journal_mode|synchronous)\s*=/i;

function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function runMigrations(db: DatabaseSync, migrationsDir: string = DEFAULT_MIGRATIONS_DIR): void {
  const migrations = loadMigrations(migrationsDir);
  const maxKnownVersion = migrations.reduce((max, m) => Math.max(max, m.version), 0);
  const currentVersion = getUserVersion(db);

  if (currentVersion > maxKnownVersion) {
    throw new DatabaseNewerThanBinary(currentVersion, maxKnownVersion);
  }

  for (const migration of migrations.filter((m) => m.version > currentVersion)) {
    const statements = splitStatements(migration.sql);
    const preamble = statements.filter((s) => TRANSACTION_UNSAFE_PRAGMA.test(s));
    const transactional = statements.filter((s) => !TRANSACTION_UNSAFE_PRAGMA.test(s));

    for (const stmt of preamble) db.exec(stmt);

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const stmt of transactional) db.exec(stmt);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

/**
 * Opens a database connection. Non-readonly opens run the feature probe and
 * pending migrations before returning; readonly opens (the API's read path)
 * do neither — a reader never mutates schema, and the one writer per process
 * (the projector) has already brought the file forward.
 */
export function openDatabase(path: string, opts: OpenDatabaseOptions = {}): DatabaseSync {
  const readOnly = opts.readonly === true;
  const db = new DatabaseSync(path, { readOnly, enableForeignKeyConstraints: true });
  if (!readOnly) {
    probeFeatures();
    runMigrations(db, opts.migrationsDir);
  }
  return db;
}
