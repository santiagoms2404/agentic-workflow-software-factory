import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

test("openDatabase applies additive migrations and lands on user_version 2", () => {
  const dir = tempDir();
  try {
    const db = openDatabase(join(dir, "awsf.db"));
    try {
      const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
      assert.equal(row.user_version, 2);
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
      assert.equal((db2.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 2);
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
      assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 2);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migration 0002 preserves legacy agent rows as explicit null sandbox evidence", () => {
  const dir = tempDir();
  try {
    const dbPath = join(dir, "awsf.db");
    const legacyMigrations = join(dir, "legacy-migrations");
    mkdirSync(legacyMigrations);
    writeFileSync(
      join(legacyMigrations, "0001-initial.sql"),
      readFileSync(resolve("core/src/observability/migrations/0001-initial.sql"), "utf8"),
    );
    const legacy = openDatabase(dbPath, { migrationsDir: legacyMigrations });
    legacy.prepare(`INSERT INTO sessions
      (session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected,
       lifecycle_state, request_text, call_ceiling, started_at, updated_at, config_snapshot_json, journal_path)
      VALUES ('legacy','p','T',1,'build',1,0,'RUNNING','request',3,'t','t','{}','journal')`).run();
    legacy.prepare(`INSERT INTO agent_sessions
      (session_id, agent, adapter_id, provider, requested_model, created_at, last_used_at)
      VALUES ('legacy','builder','pi-codex','openai-codex','gpt','t','t')`).run();
    legacy.close();

    const migrated = openDatabase(dbPath);
    try {
      const row = migrated.prepare("SELECT sandbox_badge, sandbox_mechanism FROM agent_sessions WHERE session_id='legacy'").get() as {
        sandbox_badge: string | null; sandbox_mechanism: string | null;
      };
      assert.deepEqual({ ...row }, { sandbox_badge: null, sandbox_mechanism: null });
      assert.equal((migrated.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 2);
    } finally { migrated.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sandbox evidence columns reject values outside the broker vocabulary", () => {
  const db = openDatabase(":memory:");
  try {
    db.prepare(`INSERT INTO sessions
      (session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected,
       lifecycle_state, request_text, call_ceiling, started_at, updated_at, config_snapshot_json, journal_path)
      VALUES ('s','p','T',1,'build',1,0,'RUNNING','request',3,'t','t','{}','journal')`).run();
    assert.throws(() => db.prepare(`INSERT INTO agent_sessions
      (session_id, agent, adapter_id, provider, requested_model, sandbox_badge, created_at, last_used_at)
      VALUES ('s','builder','pi-codex','openai-codex','gpt','sandboxed','t','t')`).run());
  } finally { db.close(); }
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
