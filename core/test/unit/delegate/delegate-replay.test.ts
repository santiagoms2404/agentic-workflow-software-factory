// Finding B2-25: in projectSwitch(), when catalogPath is omitted, derive
// the default catalog path from repository (using path.join(status.repository,
// "awsf.project.yaml") or placement) instead of unconditionally returning "on".

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  delegateReplayCommand,
  projectSwitch,
} from "../../../src/cli/commands/delegate-replay.ts";
import type { AttemptEvent, AttemptStatus } from "../../../src/cli/commands/attempt.ts";
import { Journal } from "../../../src/persistence/journal.ts";
import { writePlacement } from "../../../src/registry/placement.ts";
import { recordingTerminal } from "./_replay-fixture.ts";

function scratch(label: string): { root: string; close: () => void; write: (file: string, text: string) => string } {
  const root = mkdtempSync(join(tmpdir(), `awsf-b2-25-${label}-`));
  return {
    root,
    close: () => rmSync(root, { recursive: true, force: true }),
    write: (file: string, text: string) => {
      const full = join(root, file);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text, "utf8");
      return full;
    },
  };
}

function validCatalog(jev?: "on" | "off"): string {
  const jevLine = jev !== undefined ? `\ndecision:\n  jev: ${jev}` : "";
  return `version: awsf.project/v1
project:
  slug: demo
repositories:
  app:
    role: plan
    default_branch: main
plans:
  root: specs
  format: awsf-plan-html/v1${jevLine}
`;
}

test("B2-25: projectSwitch derives catalog path from status.repository when catalogPath is omitted", async () => {
  const box = scratch("status-repo");
  try {
    const repoOff = join(box.root, "repo-off");
    box.write("repo-off/awsf.project.yaml", validCatalog("off"));

    const statusOff = { repository: repoOff } as AttemptStatus;
    const swOff = await projectSwitch(undefined, statusOff);
    assert.equal(swOff, "off");

    // When catalog sets jev: on
    const repoOn = join(box.root, "repo-on");
    box.write("repo-on/awsf.project.yaml", validCatalog("on"));
    const statusOn = { repository: repoOn } as AttemptStatus;
    assert.equal(await projectSwitch(undefined, statusOn), "on");

    // When catalog omits decision.jev, defaults to "on"
    const repoDefault = join(box.root, "repo-default");
    box.write("repo-default/awsf.project.yaml", validCatalog());
    const statusDefault = { repository: repoDefault } as AttemptStatus;
    assert.equal(await projectSwitch(undefined, statusDefault), "on");

    // Missing awsf.project.yaml (ENOENT) defaults to "on"
    const emptyRepo = join(box.root, "empty-repo");
    mkdirSync(emptyRepo, { recursive: true });
    const statusEmpty = { repository: emptyRepo } as AttemptStatus;
    assert.equal(await projectSwitch(undefined, statusEmpty), "on");

    // Malformed yaml falls back to "off"
    box.write("bad-repo/awsf.project.yaml", "not: [valid: yaml: {{");
    const statusBad = { repository: join(box.root, "bad-repo") } as AttemptStatus;
    assert.equal(await projectSwitch(undefined, statusBad), "off");
  } finally {
    box.close();
  }
});

test("B2-25: projectSwitch derives catalog path from repository string when catalogPath is omitted", async () => {
  const box = scratch("repo-str");
  try {
    const repoDir = join(box.root, "repo");
    box.write("repo/awsf.project.yaml", validCatalog("off"));

    const sw = await projectSwitch(undefined, repoDir);
    assert.equal(sw, "off");
  } finally {
    box.close();
  }
});

test("B2-25: projectSwitch derives catalog path from placement when catalogPath and repository are omitted", async () => {
  const box = scratch("placement");
  try {
    const stateRoot = join(box.root, "state");
    const repoDir = join(box.root, "repo");
    box.write("repo/awsf.project.yaml", validCatalog("off"));

    await writePlacement(stateRoot, "test-proj", {
      version: "awsf.placement/v1",
      project: "test-proj",
      repositories: {
        primary: { path: repoDir },
      },
    });

    const sw = await projectSwitch(undefined, undefined, stateRoot, "test-proj");
    assert.equal(sw, "off");

    const swMissing = await projectSwitch(undefined, undefined, stateRoot, "nonexistent");
    assert.equal(swMissing, "on");
  } finally {
    box.close();
  }
});

test("B2-25: projectSwitch uses explicit catalogPath over repository status", async () => {
  const box = scratch("explicit-override");
  try {
    const repoDir = join(box.root, "repo");
    box.write("repo/awsf.project.yaml", validCatalog("off"));
    const customCatalog = box.write("custom/awsf.project.yaml", validCatalog("on"));

    const status = { repository: repoDir } as AttemptStatus;
    const sw = await projectSwitch(customCatalog, status);
    assert.equal(sw, "on");

    // When everything is omitted, returns "on"
    assert.equal(await projectSwitch(), "on");
  } finally {
    box.close();
  }
});

test("B2-25: delegateReplayCommand resolves catalog path from attempt repository status when catalogPath is omitted", async () => {
  const box = scratch("command-status-resolution");
  try {
    const stateRoot = join(box.root, "state");
    const repoDir = join(box.root, "repo");
    // Write catalog in attempt's repository with jev: off
    box.write("repo/awsf.project.yaml", validCatalog("off"));

    // Create a minimal attempt with a stop in stateRoot
    const attemptDir = join(stateRoot, "projects", "demo", "tasks", "task-1", "1");
    mkdirSync(attemptDir, { recursive: true });

    const status: AttemptStatus = {
      schema: "awsf/attempt-status/v1",
      sessionId: "sess-1",
      project: "demo",
      taskId: "task-1",
      continuesTask: null,
      groupId: null,
      planRef: null,
      attempt: 1,
      repository: repoDir,
      worktree: null,
      workflow: "shift",
      tier: 1,
      request: "synthetic test request",
      configSnapshotJson: "{}",
      lifecycleState: "BLOCKED",
      baseSha: "0".repeat(40),
      candidateSha: "0".repeat(40),
      phase: null,
      budget: {
        attempt: 1,
        callsSpent: 1,
        callsReserved: 0,
        correctionsAuto: 0,
        correctionsOwner: 0,
        ownerReentries: 0,
        allowance: { auto: 2, owner: 1, ownerReentries: 1 },
      },
      ceilingGrants: [],
      routeOverrides: {},
      reviewDegradation: null,
      model: null,
      lastActivityAt: "2026-04-01T00:00:00.000Z",
      lastActivity: "blocked",
      nextAction: "wait",
      gatesPass: false,
      requiredReviewPresent: false,
      journeyApproved: false,
      protectedApprovalsValid: false,
      process: null,
      landingApproval: null,
      blocker: { code: "phase-abort", detail: "stop", ahead: null, behind: null, source: "gate" },
      recovery: null,
      revision: 1,
      lastSourceSeq: 1,
    };

    const journal = new Journal<AttemptEvent>(join(attemptDir, "journal.jsonl"));
    await journal.append({
      kind: "attempt.updated",
      next: status,
      evidence: {
        type: "transition",
        id: "t-1",
        seq: 1,
        from: "RUNNING",
        to: "BLOCKED",
        actor: "host",
        edgeId: "L8",
        reasonSource: "gate",
        reasonCode: "phase-abort",
        reasonDetail: null,
        spawnSite: false,
        at: "2026-04-01T00:00:00.000Z",
      },
    });
    await journal.close();
    writeFileSync(join(attemptDir, "status.json"), JSON.stringify(status));

    // Live replay without transport and without catalogPath:
    // It should derive the catalog from status.repository, see jev: off, and get refused-by-switch.
    const term = recordingTerminal(true, true);
    const result = await delegateReplayCommand({
      stateRoot,
      live: true,
      terminal: term.terminal,
      env: {},
    });

    assert.equal(result.recorded.length, 1);
    assert.equal(result.recorded[0]!.decision.outcome, "refused-by-switch");
  } finally {
    box.close();
  }
});
