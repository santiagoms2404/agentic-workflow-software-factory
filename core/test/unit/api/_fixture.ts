import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type DatabaseSync } from "../../../src/observability/sqlite.ts";
import { createSession } from "../../../src/observability/projector.ts";
import { validConfig } from "../config/fixture.ts";

export function apiFixture(): {
  readonly path: string;
  readonly config: ReturnType<typeof validConfig>;
  readonly writer: DatabaseSync;
  close(): void;
} {
  const root = mkdtempSync(join(tmpdir(), "awsf-api-"));
  const path = join(root, "awsf.db");
  const writer = openDatabase(path);
  createSession(writer, {
    sessionId: "session-1",
    projectSlug: "test-project",
    taskId: "T23",
    attempt: 1,
    workflowId: "plan-build-test",
    riskTier: 1,
    isProtected: false,
    requestText: "Build the API",
    callCeiling: 3,
    configSnapshotJson: JSON.stringify(validConfig()),
    journalPath: "state://journal.jsonl",
    startedAt: "2026-08-08T12:00:00.000Z",
  });
  writer.prepare(`UPDATE sessions SET lifecycle_state = 'RUNNING', state_revision = 3,
    worker_provider = 'openai-codex', worker_model_requested = 'codex:gpt-5.6-sol',
    total_tokens = 123, usage_authority = 'provider' WHERE session_id = 'session-1'`).run();
  writer.prepare(`INSERT INTO phases
    (phase_id, session_id, ordinal, phase_key, name, kind, owner, description, status,
     correction_count, max_corrections, started_at, created_at)
    VALUES ('phase-1','session-1',1,'builder','Build','agent','builder',
      'Implement the read surface','RUNNING',0,1,'2026-08-08T12:00:01.000Z','2026-08-08T12:00:00.000Z')`).run();
  writer.prepare(`INSERT INTO agent_sessions
    (session_id, agent, adapter_id, provider, color, requested_model, resolved_model,
     model_provenance, host_continuity_ref, call_count, cost_authority, created_at, last_used_at)
    VALUES ('session-1','builder','pi-codex','openai-codex','#22D3EE','codex:gpt-5.6-sol',
      'gpt-5.6-sol','route-attributed','private://continuity-1',1,'catalog-estimate',
      '2026-08-08T12:00:00.000Z','2026-08-08T12:00:01.000Z')`).run();
  writer.prepare(`INSERT INTO transitions
    (transition_id, session_id, seq, from_state, to_state, actor, edge_id, reason_source,
     reason_detail, spawn_site, at)
    VALUES ('transition-1','session-1',1,'PREPARED','RUNNING','host','L4','record',
      'provider released',1,'2026-08-08T12:00:01.000Z')`).run();
  writer.prepare(`INSERT INTO gate_results
    (gate_result_id, session_id, phase_id, correction_round, gate_id, gate_kind,
     passed, checks_json, violations_json, started_at, ended_at)
    VALUES ('gate-1','session-1','phase-1',0,'test','subprocess',1,
      '[{"name":"tests","passed":true}]','[]','2026-08-08T12:00:02.000Z','2026-08-08T12:00:03.000Z')`).run();
  writer.prepare(`INSERT INTO processes
    (process_id, session_id, phase_id, run_id, adapter_id, role, transport, status,
     command_json, cwd_display, registered_at)
    VALUES ('process-1','session-1','phase-1','run-1','pi-codex','worker','process','RUNNING',
      '["pi"]','worktree','2026-08-08T12:00:01.000Z')`).run();
  writer.prepare(`INSERT INTO envelopes
    (envelope_id, session_id, phase_id, agent, schema_id, correction_round, valid,
     producer_status, payload_json, violations_json, file_path, created_at)
    VALUES ('envelope-1','session-1','phase-1','builder','awsf.build-output/v1',0,1,
      'success','{"summary":"done","raw_provider_log":"must-not-leak"}','[]',
      'private/envelope.json','2026-08-08T12:00:03.000Z')`).run();
  writer.prepare(`INSERT INTO envelopes
    (envelope_id, session_id, phase_id, agent, schema_id, correction_round, valid,
     producer_status, payload_json, violations_json, file_path, created_at)
    VALUES ('envelope-2','session-1','phase-1','builder','awsf.build-output/v1',1,0,
      'failure','{"summary":"invalid round retained"}','["missing evidence"]',
      'private/envelope-invalid.json','2026-08-08T12:00:04.000Z')`).run();
  for (let index = 1; index <= 3; index += 1) {
    writer.prepare(`INSERT INTO events
      (event_id, session_id, phase_id, run_id, first_source_seq, last_source_seq, type,
       payload_json, started_at, redaction_level)
      VALUES (?, 'session-1','phase-1','run-1',?,?, 'tool_call', ?, ?, ?)`)
      .run(
        `event-${index}`,
        index,
        index,
        JSON.stringify(index === 1
          ? { name: "read", raw_provider_log: "must-not-leak", host_continuity_ref: "private://ref" }
          : { name: `event-${index}` }),
        `2026-08-08T12:00:0${index}.000Z`,
        index === 3 ? "private-ref" : "public",
      );
  }

  return {
    path,
    config: validConfig(),
    writer,
    close(): void {
      writer.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
