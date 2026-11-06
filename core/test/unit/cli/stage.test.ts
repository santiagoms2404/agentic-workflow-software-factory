import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stageCommand } from "../../../src/cli/commands/stage.ts";
import { main } from "../../../src/cli/main.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
import { stageEnvelopesForProject } from "../../../src/observability/queries.ts";
import { writePlacement } from "../../../src/registry/placement.ts";

const SLUG = "stage-readout";

async function cannedProjection(): Promise<{ root: string; catalogPath: string; stateRoot: string }> {
  const root = mkdtempSync(join(tmpdir(), "awsf-stage-readout-"));
  const stateRoot = join(root, "state");
  const repository = join(root, "plans");
  const catalogPath = join(repository, "awsf.project.yaml");
  mkdirSync(repository, { recursive: true });
  writeFileSync(catalogPath, `version: awsf.project/v1
project:
  slug: ${SLUG}
repositories:
  plans:
    role: plan
    default_branch: main
plans:
  root: specs
  format: awsf-plan-html/v1
`);
  await writePlacement(stateRoot, SLUG, {
    version: "awsf.placement/v1",
    project: SLUG,
    repositories: { plans: { path: repository } },
  });

  const db = openDatabase(join(stateRoot, "awsf.db"));
  try {
    db.prepare(`INSERT INTO sessions (
      session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected,
      lifecycle_state, request_text, call_ceiling, started_at, updated_at,
      config_snapshot_json, journal_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        "canned-stage-session", SLUG, "canned-stage-task", 1, "design-to-plan", 1, 0,
        "AWAITING_OWNER", "canned projection", 0, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z",
        "{}", join(root, "private", "journal.jsonl"),
      );
  } finally {
    db.close();
  }
  return { root, catalogPath, stateRoot };
}

test("stage readout renders a canned projection without an absolute path", async () => {
  const fixture = await cannedProjection();
  try {
    const output = await stageCommand({ catalogPath: fixture.catalogPath, stateRoot: fixture.stateRoot });
    const rendered = output.join("\n");

    assert.match(rendered, /at: design-to-plan/);
    assert.match(rendered, /owner types: awsf new --workflow plan-build-test/);
    assert.doesNotMatch(rendered, new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(rendered, /(?:^|\s)(?:\/|[A-Za-z]:[\\/]|\\\\|~\/|file:)/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("stage envelope reads are project-scoped and omit payload bodies", async () => {
  const fixture = await cannedProjection();
  const db = openDatabase(join(fixture.stateRoot, "awsf.db"));
  try {
    db.prepare(`INSERT INTO sessions (
      session_id, project_slug, task_id, attempt, workflow_id, risk_tier, is_protected,
      lifecycle_state, request_text, call_ceiling, started_at, updated_at,
      config_snapshot_json, journal_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("other-stage-session", "other-project", "other-task", 1, "design-to-plan", 1, 0,
        "AWAITING_OWNER", "other", 0, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "{}", "other-journal");
    db.prepare(`INSERT INTO phases (phase_id, session_id, ordinal, phase_key, name, kind, owner, description, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("stage-phase", "canned-stage-session", 1, "design", "Design", "agent", "planner", "Plan", "SUCCEEDED", "2026-01-01T00:00:00.000Z");
    db.prepare(`INSERT INTO envelopes (envelope_id, session_id, phase_id, agent, schema_id, correction_round, valid,
      producer_status, payload_json, violations_json, file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("stage-envelope", "canned-stage-session", "stage-phase", "planner", "awsf.plan/v1", 0, 1,
        "success", "{\"private\":true}", "[]", "private-envelope", "2026-01-01T00:00:01.000Z");
    db.prepare(`INSERT INTO phases (phase_id, session_id, ordinal, phase_key, name, kind, owner, description, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("other-phase", "other-stage-session", 1, "design", "Design", "agent", "planner", "Plan", "SUCCEEDED", "2026-01-01T00:00:00.000Z");
    db.prepare(`INSERT INTO envelopes (envelope_id, session_id, phase_id, agent, schema_id, correction_round, valid,
      producer_status, payload_json, violations_json, file_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("other-envelope", "other-stage-session", "other-phase", "planner", "awsf.plan/v1", 0, 1,
        "success", "{}", "[]", "private-envelope", "2026-01-01T00:00:01.000Z");

    const rows = stageEnvelopesForProject(db, SLUG);
    assert.deepEqual({ ...rows[0] }, { envelope_id: "stage-envelope", schema_id: "awsf.plan/v1", correction_round: 0, valid: 1,
      created_at: "2026-01-01T00:00:01.000Z", session_id: "canned-stage-session", phase_id: "stage-phase" });
    assert.equal("payload_json" in rows[0]!, false);
    assert.equal("violations_json" in rows[0]!, false);
  } finally {
    db.close();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("stage command exposes no acting flag", async () => {
  for (const flag of ["advance", "next", "run"]) {
    const errors: string[] = [];
    const code = await main({
      argv: ["stage", `--${flag}`, "now"],
      writeOut: () => {},
      writeError: (line) => { errors.push(line); },
    });

    assert.equal(code, 1, flag);
    assert.deepEqual(errors, ["Error: usage: awsf stage [--catalog PATH] [--state-root PATH]"]);
  }
});
