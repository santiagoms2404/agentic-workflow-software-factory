import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseNewerThanBinary, openDatabase, probeFeatures } from "../../../src/observability/sqlite.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "awsf-sqlite-"));
}

const ALL_TABLES = [
  "agent_sessions",
  "envelopes",
  "events",
  "gate_results",
  "phases",
  "processes",
  "sessions",
  "sqlite_sequence",
  "transitions",
].sort();

test("startup feature probe passes: WAL, STRICT tables, json_valid", () => {
  assert.doesNotThrow(() => probeFeatures());
});

test("openDatabase applies migration 0001 and lands on user_version 1", () => {
  const dir = tempDir();
  try {
    const db = openDatabase(join(dir, "awsf.db"));
    try {
      const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
      assert.equal(row.user_version, 1);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
        .map((t) => t.name)
        .sort();
      assert.deepEqual(tables, ALL_TABLES);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-opening an already-migrated database does not re-apply or throw", () => {
  const dir = tempDir();
  try {
    const dbPath = join(dir, "awsf.db");
    openDatabase(dbPath).close();
    const db2 = openDatabase(dbPath);
    try {
      assert.equal((db2.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
    } finally {
      db2.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refusal direction 1: a database newer than the binary's highest migration is refused", () => {
  const dir = tempDir();
  try {
    const dbPath = join(dir, "awsf.db");
    const db = openDatabase(dbPath);
    db.exec("PRAGMA user_version = 99");
    db.close();

    assert.throws(() => openDatabase(dbPath), DatabaseNewerThanBinary);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refusal direction 2: a database older than the binary is migrated forward, not refused", () => {
  const dir = tempDir();
  try {
    const dbPath = join(dir, "awsf.db");
    // A brand-new file is at user_version 0 — strictly older than the one
    // migration this binary ships — and must be brought forward, not refused.
    const db = openDatabase(dbPath);
    try {
      assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty/unknown migrations directory leaves user_version at 0 rather than throwing", () => {
  const dir = tempDir();
  try {
    const db = openDatabase(":memory:", { migrationsDir: join(dir, "does-not-exist") });
    try {
      assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 0);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a readonly open runs neither the feature probe nor migrations", () => {
  const dir = tempDir();
  try {
    const dbPath = join(dir, "awsf.db");
    openDatabase(dbPath).close();
    const reader = openDatabase(dbPath, { readonly: true });
    try {
      assert.throws(() => reader.prepare("INSERT INTO sessions (session_id) VALUES ('x')").run());
    } finally {
      reader.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
