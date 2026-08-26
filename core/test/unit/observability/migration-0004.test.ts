import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { openDatabase, runMigrations, type DatabaseSync } from "../../../src/observability/sqlite.ts";

const CHILD_TABLES = [
  "transitions",
  "phases",
  "events",
  "envelopes",
  "gate_results",
  "processes",
  "agent_sessions",
] as const;

function rows(db: DatabaseSync): Record<string, unknown>[] {
  return (db.prepare("SELECT * FROM sessions ORDER BY session_id").all() as Record<string, unknown>[])
    .map((row) => ({ ...row }));
}

function scalar(db: DatabaseSync, sql: string, key: string): number {
  const row = db.prepare(sql).get() as Record<string, number>;
  return row[key] ?? -1;
}

function seedVersion3Database(root: string): DatabaseSync {
  const migrationsDir = join(root, "migrations-v3");
  mkdirSync(migrationsDir);
  for (const name of [
    "0001-initial.sql",
    "0002-agent-launch-evidence.sql",
    "0003-owner-reentries.sql",
  ]) {
    writeFileSync(
      join(migrationsDir, name),
      readFileSync(resolve("core/src/observability/migrations", name), "utf8"),
    );
  }

  const db = openDatabase(join(root, "awsf.db"), { migrationsDir });
  assert.equal(scalar(db, "PRAGMA user_version", "user_version"), 3);

  db.prepare(`INSERT INTO sessions (
    session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected,
    lifecycle_state, request_text, base_sha, head_sha, candidate_sha,
    worker_provider, worker_model_requested, worker_model_resolved, review_provider,
    review_verdict, call_ceiling, calls_reserved, calls_spent, corrections_auto,
    corrections_owner, input_tokens, output_tokens, cache_read_tokens,
    cache_write_tokens, reasoning_tokens, total_tokens, reasoning_relation,
    usage_authority, estimated_cost_usd, cost_authority, cost_partial,
    observability_degraded, archived, started_at, updated_at, ended_at,
    state_revision, last_projected_seq, config_snapshot_json, journal_path,
    owner_reentries
  ) VALUES (${Array.from({ length: 43 }, () => "?").join(",")})`).run(
    "session-full", "project", "T14-full", 2, "build-review", 2, 1,
    "LANDED", "preserve every session column", "a".repeat(40), "b".repeat(40), "c".repeat(40),
    "provider", "requested", "resolved", "review-provider", "accept",
    9, 1, 7, 2, 3, 101, 102, 103, 104, 105, 515,
    "additive", "provider", 1.25, "provider", 1, 1, 1,
    "2026-08-24T00:00:00.000Z", "2026-08-25T00:00:00.000Z", "2026-08-25T00:01:00.000Z",
    17, 19, "{\"snapshot\":true}", "journal/full.jsonl", 4,
  );
  db.prepare(`INSERT INTO sessions
    (session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected,
     lifecycle_state, request_text, call_ceiling, started_at, updated_at,
     config_snapshot_json, journal_path)
    VALUES ('session-minimal','project','T14-minimal',1,'build',0,0,
            'DRAFT','preserve defaults',1,'start','update','{}','journal/minimal.jsonl')`).run();

  db.exec(`
    INSERT INTO transitions
      (transition_id, session_id, seq, from_state, to_state, actor, edge_id,
       reason_source, reason_code, reason_detail, spawn_site, at)
    VALUES ('transition-1','session-full',1,'LANDING','LANDED','host','L23',
            'git',NULL,'landed',0,'at');

    INSERT INTO phases
      (phase_id, session_id, ordinal, phase_key, name, kind, owner, description,
       status, correction_count, max_corrections, created_at)
    VALUES ('phase-1','session-full',1,'build','Build','agent','builder','build it',
            'SUCCEEDED',0,1,'at');

    INSERT INTO events
      (event_id, session_id, phase_id, first_source_seq, last_source_seq, type,
       name, payload_json, started_at)
    VALUES ('event-1','session-full','phase-1',1,1,'run.completed','done','{}','at');

    INSERT INTO envelopes
      (envelope_id, session_id, phase_id, agent, schema_id, correction_round,
       valid, producer_status, payload_json, violations_json, file_path, created_at)
    VALUES ('envelope-1','session-full','phase-1','builder','awsf/build-output/v1',0,
            1,'success','{}','[]','envelope.json','at');

    INSERT INTO gate_results
      (gate_result_id, session_id, phase_id, correction_round, gate_id, gate_kind,
       candidate_sha, passed, checks_json, violations_json, started_at, ended_at)
    VALUES ('gate-1','session-full','phase-1',0,'unit','pure',NULL,1,'[]','[]','at','at');

    INSERT INTO processes
      (process_id, session_id, phase_id, run_id, adapter_id, role, transport,
       status, command_json, cwd_display, registered_at)
    VALUES ('process-1','session-full','phase-1','run-1','fixture','builder','fixture',
            'EXITED','[]','repo','at');

    INSERT INTO agent_sessions
      (session_id, agent, adapter_id, provider, requested_model, sandbox_badge,
       sandbox_mechanism, created_at, last_used_at)
    VALUES ('session-full','builder','fixture','fixture','model','os-enforced',
            'linux-bwrap','at','at');
  `);
  return db;
}

test("migration 0004 preserves sessions, child constraints, and is a no-op on its second run", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-migration-0004-"));
  const db = seedVersion3Database(root);
  try {
    const sessionsBefore = rows(db);
    assert.equal(sessionsBefore.length, 2);

    runMigrations(db);

    assert.equal(scalar(db, "PRAGMA user_version", "user_version"), 4);
    assert.deepEqual(rows(db), sessionsBefore, "every session row and column survived the rebuild");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(scalar(db, "PRAGMA foreign_keys", "foreign_keys"), 1, "the runner restored enforcement");

    const childSql = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    );
    for (const table of CHILD_TABLES) {
      const row = childSql.get(table) as { sql: string } | undefined;
      assert.ok(row, `${table} remains in sqlite_master`);
      assert.match(
        row.sql,
        /session_id\s+TEXT\s+NOT NULL\s+REFERENCES sessions\(session_id\) ON DELETE RESTRICT/,
        `${table} still restricts deletion of its sessions parent`,
      );
    }

    assert.doesNotThrow(() => db.prepare(`INSERT INTO sessions
      (session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected,
       lifecycle_state, request_text, call_ceiling, started_at, updated_at,
       config_snapshot_json, journal_path)
      VALUES ('session-published','project','T14-published',1,'build',1,0,
              'PUBLISHED','published row',3,'start','update','{}','journal/published.jsonl')`).run());

    assert.throws(() => db.prepare(`INSERT INTO transitions
      (transition_id, session_id, seq, from_state, to_state, actor, edge_id,
       reason_source, spawn_site, at)
      VALUES ('orphan','missing-session',1,'LANDED','PUBLISHED','human','L27','human',0,'at')`).run());

    const schemaVersion = scalar(db, "PRAGMA schema_version", "schema_version");
    const totalChanges = scalar(db, "SELECT total_changes() AS total_changes", "total_changes");
    const schema = (db.prepare(`SELECT type, name, tbl_name, rootpage, sql
      FROM sqlite_master ORDER BY type, name`).all() as Record<string, unknown>[])
      .map((row) => ({ ...row }));
    const sessionsAfterFirstRun = rows(db);

    runMigrations(db);

    assert.equal(scalar(db, "PRAGMA user_version", "user_version"), 4);
    assert.equal(scalar(db, "PRAGMA schema_version", "schema_version"), schemaVersion);
    assert.equal(scalar(db, "SELECT total_changes() AS total_changes", "total_changes"), totalChanges);
    assert.deepEqual(
      (db.prepare(`SELECT type, name, tbl_name, rootpage, sql
        FROM sqlite_master ORDER BY type, name`).all() as Record<string, unknown>[])
        .map((row) => ({ ...row })),
      schema,
    );
    assert.deepEqual(rows(db), sessionsAfterFirstRun);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
