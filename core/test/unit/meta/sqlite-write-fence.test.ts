import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

const ALLOWED_PREFIXES = [
  "core/src/observability/sqlite.ts",
  "core/src/observability/projector.ts",
  "core/src/observability/migrations/",
];

const NODE_SQLITE_IMPORT = /(['"])node:sqlite\1/;
const SQL_WRITE_PATTERN = /\b(INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+TABLE|CREATE\s+TABLE|ALTER\s+TABLE|REPLACE\s+INTO)\b/i;
const SQLITE_HANDLE_WRITE = /\b(?:db|database(?:\(\))?)\s*\.\s*(?:exec|run)\s*\(|\.(?:prepare|exec)\s*\([^)]*\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE)\b/i;
const PREPARED_RUN = /\.prepare\s*\([^)]*\)\s*\.run\s*\(/;

export function isSqliteWriteOffender(src: string): boolean {
  if (NODE_SQLITE_IMPORT.test(src)) return true;
  return SQL_WRITE_PATTERN.test(src) || SQLITE_HANDLE_WRITE.test(src) || PREPARED_RUN.test(src);
}

test("SQLite is written only by the observability driver, projector, and migrations", () => {
  const files = walkFiles(join(repoRoot(), "core", "src"), [".ts"]);
  const offenders = files
    .map(relRepo)
    .filter((f) => !ALLOWED_PREFIXES.some((p) => f === p || f.startsWith(p)))
    .filter((f) => isSqliteWriteOffender(readFileSync(join(repoRoot(), f), "utf8")));
  assert.deepEqual(offenders, []);
});

test("sqlite-write predicate flags handle writes without node:sqlite import", () => {
  const handleInsert = 'import { openDatabase } from "../observability/sqlite.ts";\nconst db = openDatabase();\ndb.prepare("INSERT INTO events VALUES (1)").run();';
  assert.equal(isSqliteWriteOffender(handleInsert), true);

  const handleExecDelete = 'import { openDatabase } from "../observability/sqlite.ts";\nconst db = openDatabase();\ndb.exec("DELETE FROM events");';
  assert.equal(isSqliteWriteOffender(handleExecDelete), true);

  const directImport = 'import { DatabaseSync } from "node:sqlite";\nconst db = new DatabaseSync(":memory:");';
  assert.equal(isSqliteWriteOffender(directImport), true);

  const handleSelect = 'import { openDatabase } from "../observability/sqlite.ts";\nconst db = openDatabase();\nconst rows = db.prepare("SELECT * FROM events").all();';
  assert.equal(isSqliteWriteOffender(handleSelect), false);
});
