import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type DatabaseSync } from "../../../src/observability/sqlite.ts";
import { createSession } from "../../../src/observability/projector.ts";
import type { ResolvedPlanSource } from "../../../src/registry/plan-source.ts";
import { validConfig } from "../config/fixture.ts";

export function apiFixture(): {
  readonly path: string;
  readonly config: ReturnType<typeof validConfig>;
  readonly writer: DatabaseSync;
  readonly planSources: readonly ResolvedPlanSource[];
  close(): void;
} {
  const root = mkdtempSync(join(tmpdir(), "awsf-api-"));
  const path = join(root, "awsf.db");
  const writer = openDatabase(path);
  const ticketDirectory = join(root, "tickets");
  const spineTickets = join(ticketDirectory, "fixture-plan");
  const deepTickets = join(ticketDirectory, "fixture-w01-deep");
  mkdirSync(spineTickets, { recursive: true });
  mkdirSync(deepTickets, { recursive: true });
  writeFileSync(join(spineTickets, "T01.md"), `---\nid: T01\ntitle: First\nmilestone: M1\ntier: 0\nstate: done\ndepends_on: []\nworkflow: intake\noutcome: First\ncontext: [First]\nacceptance: [First]\nnon_goals: [First]\n---\nspine-source-only-marker\n`);
  writeFileSync(join(spineTickets, "T02.md"), `---\nid: T02\ntitle: Second\nmilestone: M1\ntier: 1\nstate: todo\ndepends_on: [T01]\nworkflow: build\noutcome: Second\ncontext: [Second]\nacceptance: [Second]\nnon_goals: [Second]\n---\nsecond-source-only-marker\n`);
  writeFileSync(join(deepTickets, "T01.md"), `---\nid: T01\ntitle: Deep first\nmilestone: M2\nstate: wip\ndepends_on: []\nserves: [AC-1]\n---\ndeep-source-only-marker\n`);
  const planSources: readonly ResolvedPlanSource[] = [
    {
      project: "test-project",
      repositoryId: "fixture",
      planPath: join(root, "fixture-plan.html"),
      promptsPath: join(root, "fixture-plan-build-prompts.md"),
      ticketsPath: spineTickets,
      format: "awsf-plan-html/v1",
    },
    {
      project: "test-project",
      repositoryId: "fixture",
      planPath: join(root, "fixture-w01-deep.html"),
      promptsPath: join(root, "fixture-w01-deep-build-prompts.md"),
      ticketsPath: deepTickets,
      format: "awsf-plan-html/v1",
    },
  ];
  createSession(writer, {
    sessionId: "session-1",
    projectSlug: "test-project",
    taskId: "T23",
    continuesTask: null,
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
  writer.prepare(`UPDATE sessions SET lifecycle_state = 'AWAITING_OWNER', state_revision = 3,
    worker_provider = 'openai-codex', worker_model_requested = 'codex:gpt-5.6-sol',
    total_tokens = 123, usage_authority = 'provider', updated_at = '2026-08-08T12:12:00.000Z'
    WHERE session_id = 'session-1'`).run();
  writer.prepare(`INSERT INTO phases
    (phase_id, session_id, ordinal, phase_key, name, kind, owner, description, status,
     correction_count, max_corrections, started_at, ended_at, created_at)
    VALUES ('phase-1','session-1',1,'builder','Build','agent','builder',
      'Implement the read surface','SUCCEEDED',0,1,'2026-08-08T12:00:01.000Z',
      '2026-08-08T12:10:00.000Z','2026-08-08T12:00:00.000Z')`).run();
  writer.prepare(`INSERT INTO agent_sessions
    (session_id, agent, adapter_id, provider, color, requested_model, resolved_model,
     model_provenance, host_continuity_ref, call_count, cost_authority, sandbox_badge,
     sandbox_mechanism, created_at, last_used_at)
    VALUES ('session-1','builder','pi-codex','openai-codex','#22D3EE','codex:gpt-5.6-sol',
      'gpt-5.6-sol','route-attributed','private://continuity-1',1,'catalog-estimate',
      'tool-policy','adapter-tool-policy','2026-08-08T12:00:00.000Z','2026-08-08T12:00:01.000Z')`).run();
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
     command_json, cwd_display, registered_at, released_at, ended_at, exit_code)
    VALUES ('process-1','session-1','phase-1','run-1','pi-codex','worker','process','EXITED',
      '["/usr/bin/pi","--append-system-prompt","/home/operator/.local/state/awsf/private/system-prompt.md"]',
      '/home/operator/.local/state/awsf/worktrees/session-1','2026-08-08T12:00:01.000Z',
      '2026-08-08T12:00:02.000Z','2026-08-08T12:10:00.000Z',0)`).run();
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
  const eventTimes = [
    "2026-08-08T12:00:01.000Z",
    "2026-08-08T12:05:00.000Z",
    "2026-08-08T12:10:00.000Z",
  ];
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
        eventTimes[index - 1]!, // index is 1..3 over a 3-element literal
        index === 3 ? "private-ref" : "public",
      );
  }

  return {
    path,
    config: validConfig(),
    writer,
    planSources,
    close(): void {
      writer.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
