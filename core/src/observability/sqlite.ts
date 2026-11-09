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

/** A migration set the runner cannot apply in a defined order (B4-27). */
export class InvalidMigrationSet extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMigrationSet";
  }
}

/**
 * Every `.sql` file in the directory, ordered by version. A missing or
 * unreadable directory throws with its real errno: an empty list would open a
 * fresh database at user_version 0 with no tables (B4-28). A `.sql` name that
 * does not match `NNNN-name.sql` is refused rather than dropped, and two files
 * sharing a version are refused rather than applied in readdir order (B4-27).
 */
function loadMigrations(migrationsDir: string): MigrationFile[] {
  const files: MigrationFile[] = [];
  const seen = new Map<number, string>();
  for (const name of readdirSync(migrationsDir).sort()) {
    if (!name.endsWith(".sql")) continue;
    const match = MIGRATION_FILENAME.exec(name);
    if (match === null) {
      throw new InvalidMigrationSet(`${name}: a migration file must be named NNNN-<name>.sql`);
    }
    const version = Number.parseInt(match[1] ?? "0", 10);
    const earlier = seen.get(version);
    if (earlier !== undefined) {
      throw new InvalidMigrationSet(`${name} and ${earlier} both claim migration version ${version}`);
    }
    seen.set(version, name);
    const path = join(migrationsDir, name);
    files.push({ version, path, sql: readFileSync(path, "utf8") });
  }
  return files.sort((a, b) => a.version - b.version);
}

/**
 * Rolls back the open transaction after a failed write. SQLite can roll a
 * transaction back on its own (a full disk does), and then an explicit ROLLBACK
 * throws "no transaction is active", which replaced the cause the caller was
 * about to rethrow (B4-26). A connection that reports no open transaction is
 * left alone; otherwise a ROLLBACK that fails is ignored, because the caller
 * rethrows its own error, which is the one that matters.
 */
export function rollbackAfterFailure(db: DatabaseSync): void {
  if (db.isTransaction === false) return;
  try {
    db.exec("ROLLBACK");
  } catch {
    // SQLite already rolled the transaction back; the caller's error is the cause.
  }
}

/**
 * The statement's code after any leading comments and whitespace. A PRAGMA
 * behind a comment is still a PRAGMA: the splitter keeps the comment in the
 * chunk, so an anchored test on the raw chunk misclassified it (B4-29).
 */
function leadingCodeOf(statement: string): string {
  let rest = statement;
  for (;;) {
    rest = rest.trimStart();
    if (rest.startsWith("--")) {
      const newline = rest.indexOf("\n");
      if (newline === -1) return "";
      rest = rest.slice(newline + 1);
    } else if (rest.startsWith("/*")) {
      const close = rest.indexOf("*/", 2);
      if (close === -1) return "";
      rest = rest.slice(close + 2);
    } else {
      return rest;
    }
  }
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
// SQLite refuses to change journal_mode or synchronous from inside a
// transaction, so they run ahead of `BEGIN IMMEDIATE`. foreign_keys must join
// them for table rebuilds: measured, leaving it on fails at DROP with `FOREIGN
// KEY constraint failed`, and defer_foreign_keys inside the transaction fails
// identically because SQLite's RESTRICT is not deferrable. Its previous value
// is restored after the migration so constraints stay enabled for the process.
const TRANSACTION_UNSAFE_PRAGMA = /^PRAGMA\s+(journal_mode|synchronous|foreign_keys)\s*=/i;
const FOREIGN_KEYS_PRAGMA = /^PRAGMA\s+foreign_keys\s*=/i;

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | "\"" | "`" | null = null;
  let inBracketIdentifier = false;
  let inLineComment = false;
  let inBlockComment = false;

  const append = (end: number): void => {
    const statement = sql.slice(start, end).trim();
    if (statement.length > 0) statements.push(statement);
  };

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (inLineComment) {
      if (char === "\n" || char === "\r") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (char === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }
    if (inBracketIdentifier) {
      if (char === "]") {
        if (next === "]") index += 1;
        else inBracketIdentifier = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      inLineComment = true;
      index += 1;
    } else if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
    } else if (char === "'" || char === "\"" || char === "`") {
      quote = char;
    } else if (char === "[") {
      inBracketIdentifier = true;
    } else if (char === ";") {
      append(index);
      start = index + 1;
    }
  }
  append(sql.length);
  return statements;
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
    const preamble = statements.filter((s) => TRANSACTION_UNSAFE_PRAGMA.test(leadingCodeOf(s)));
    const transactional = statements.filter((s) => !TRANSACTION_UNSAFE_PRAGMA.test(leadingCodeOf(s)));
    const changesForeignKeys = preamble.some((s) => FOREIGN_KEYS_PRAGMA.test(leadingCodeOf(s)));
    const previousForeignKeys = changesForeignKeys
      ? (db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys
      : null;

    try {
      for (const stmt of preamble) db.exec(stmt);

      db.exec("BEGIN IMMEDIATE");
      try {
        // The pending list above was read before this connection took the write
        // lock. Another writer may have applied this migration in the gap, so the
        // decision is made again under the lock (B4-36).
        if (getUserVersion(db) < migration.version) {
          for (const stmt of transactional) db.exec(stmt);
        }
        db.exec("COMMIT");
      } catch (err) {
        rollbackAfterFailure(db);
        throw err;
      }
    } finally {
      if (previousForeignKeys !== null) {
        db.exec(`PRAGMA foreign_keys = ${previousForeignKeys === 0 ? "OFF" : "ON"}`);
      }
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
  try {
    // busy_timeout belongs to the connection, not the database file. Migration
    // 0001 alone only configures the creating writer; later writers and readers
    // need the same bounded wait, including while acquiring migration locks.
    db.exec("PRAGMA busy_timeout = 5000");
    if (!readOnly) {
      probeFeatures();
      runMigrations(db, opts.migrationsDir);
    }
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}

/** The dashboard process's sole mutation, kept inside the SQLite write boundary. */
export function setSessionArchived(db: DatabaseSync, sessionId: string): boolean {
  const result = db.prepare("UPDATE sessions SET archived = 1 WHERE session_id = ?").run(sessionId);
  return Number(result.changes) > 0;
}

/**
 * `PRAGMA integrity_check`, as the list of problems it found — empty when the
 * file is sound. A database too broken to answer the question at all reports
 * the driver's own error as the problem, because "it would not tell us" is
 * not the same as "it is fine", and a rebuild must never be swapped in on the
 * strength of a question that failed to run.
 */
export function integrityProblems(db: DatabaseSync): string[] {
  try {
    const rows = db.prepare("PRAGMA integrity_check").all() as { integrity_check?: string }[];
    return rows.map((row) => row.integrity_check ?? "").filter((value) => value !== "ok");
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }
}

/** What closing a connection achieved for its WAL. */
export interface CloseOutcome {
  /** `false` when committed pages may still sit in the `-wal` beside the file. */
  readonly checkpointed: boolean;
  /** Why the checkpoint did not complete, or `null` when it did. */
  readonly detail: string | null;
}

/**
 * Checkpoints the WAL back into the main file, then closes, and says whether
 * the checkpoint completed.
 *
 * A rebuild's freshly written candidate is swapped in as ONE file; anything
 * still sitting in its `-wal` at rename time would be silently dropped. This
 * is the only correct way to finish writing a database that is about to be
 * moved, so a rebuild must refuse the swap when `checkpointed` is false
 * (B4-37). The connection is closed either way.
 */
export function closeDatabase(db: DatabaseSync): CloseOutcome {
  let outcome: CloseOutcome;
  try {
    const row = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy: number | bigint };
    outcome = Number(row.busy) === 0
      ? { checkpointed: true, detail: null }
      : { checkpointed: false, detail: "a reader still holds the WAL, so the checkpoint could not finish" };
  } catch (err) {
    // A database too corrupt to checkpoint is reported, not hidden: the rebuild
    // treats it as a candidate it cannot swap in.
    outcome = { checkpointed: false, detail: err instanceof Error ? err.message : String(err) };
  }
  db.close();
  return outcome;
}

/**
 * Brings a disposable projection forward, checkpoints it, and releases the
 * writer before a dashboard API reader opens it. This is the dashboard's only
 * schema-readiness operation; its long-lived router remains readonly.
 */
export function prepareDatabaseForReadonly(path: string): void {
  const db = openDatabase(path);
  closeDatabase(db);
}
