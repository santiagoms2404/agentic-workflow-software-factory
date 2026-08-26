import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stageCommand } from "../../../src/cli/commands/stage.ts";
import { main } from "../../../src/cli/main.ts";
import { openDatabase } from "../../../src/observability/sqlite.ts";
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
