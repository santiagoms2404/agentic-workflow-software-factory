// Regression tests for Batch 2 Decision & Jev fixes (B2-25, B2-26, B2-27, B2-36, B2-37).

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { projectSwitch } from "../../../src/cli/commands/delegate-replay.ts";
import { decide, type DecideContext } from "../../../src/decision/decide.ts";
import { JEV_TRANSPORT_FILE, jevFenceStatus } from "../../../src/decision/jev-doctor.ts";
import {
  ContractError,
  JEV_DEFAULT_MODEL,
  JevTransport,
  QuestionValidationError,
  validateJevResponse,
  type JevQuestions,
  type JevState,
} from "../../../src/decision/jev-transport.ts";
import { STOP_JUDGMENT } from "../../../src/decision/question-sets/stop-judgment.ts";
import { writePlacement } from "../../../src/registry/placement.ts";
import { taskRoot } from "../../../src/cli/commands/attempt.ts";

function scratch(label: string): { root: string; close: () => void; write: (file: string, text: string) => string } {
  const root = mkdtempSync(join(tmpdir(), `awsf-b2-decision-${label}-`));
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

// ---------------------------------------------------------------------------
// 1. B2-25: projectSwitch derives catalog from repository or placement
// ---------------------------------------------------------------------------

test("B2-25: projectSwitch derives catalog path from repository when catalogPath is omitted", async () => {
  const box = scratch("b2-25-repo");
  try {
    const repoDir = join(box.root, "repo");
    box.write("repo/awsf.project.yaml", "project:\n  slug: demo\ndecision:\n  jev: off\n");

    // With status object
    const switchFromStatus = await projectSwitch(undefined, { repository: repoDir });
    assert.equal(switchFromStatus, "off");

    // With repository string
    const switchFromRepo = await projectSwitch(undefined, repoDir);
    assert.equal(switchFromRepo, "off");

    // Absent catalog file defaults to "on"
    const emptyRepo = join(box.root, "empty-repo");
    mkdirSync(emptyRepo, { recursive: true });
    const switchEmpty = await projectSwitch(undefined, { repository: emptyRepo });
    assert.equal(switchEmpty, "on");
  } finally {
    box.close();
  }
});

test("B2-25: projectSwitch derives catalog path from placement when catalogPath and repository are omitted", async () => {
  const box = scratch("b2-25-placement");
  try {
    const stateRoot = join(box.root, "state");
    const repoDir = join(box.root, "repo");
    box.write("repo/awsf.project.yaml", "project:\n  slug: test-proj\ndecision:\n  jev: off\n");

    await writePlacement(stateRoot, "test-proj", {
      version: "awsf.placement/v1",
      project: "test-proj",
      repositories: {
        primary: { path: repoDir },
      },
    });

    const sw = await projectSwitch(undefined, undefined, stateRoot, "test-proj");
    assert.equal(sw, "off");

    // No project source is not permission to assume the catalog's on default.
    const swMissing = await projectSwitch(undefined, undefined, stateRoot, "nonexistent");
    assert.equal(swMissing, "off");
  } finally {
    box.close();
  }
});

test("B2-25: projectSwitch uses explicit catalogPath when provided", async () => {
  const box = scratch("b2-25-explicit");
  try {
    const catPath = box.write("custom/catalog.yaml", "project:\n  slug: custom\ndecision:\n  jev: off\n");
    const sw = await projectSwitch(catPath);
    assert.equal(sw, "off");

    // Without an identified project catalog, the resolver fails closed.
    const swDefault = await projectSwitch();
    assert.equal(swDefault, "off");
  } finally {
    box.close();
  }
});

// ---------------------------------------------------------------------------
// 2. B2-26: decide() records transport's configured model on refused-by-switch
// ---------------------------------------------------------------------------

test("B2-26: decide() records transport's configured model on refused-by-switch", async () => {
  const box = scratch("b2-26");
  try {
    const stateRoot = join(box.root, "state");
    const PROJECT = "demo-proj";
    const tRoot = taskRoot(stateRoot, PROJECT, "task-1");

    // Transport stub with a configured model
    const stubTransport = {
      model: "custom-configured-model-v1",
      ask: async () => ({
        outcome: "refused-by-switch" as const,
        detail: "Jev is switched off for this project (decision.jev: off).",
      }),
    };

    const ctx: DecideContext<any> = {
      transport: stubTransport,
      taskRoot: tRoot,
      project: PROJECT,
      taskId: "task-1",
      attempt: 1,
      caller: { kind: "stop", name: "ceiling-pause" },
      params: { allowedActs: ["raise", "cancel"] },
    };

    const decision = await decide(STOP_JUDGMENT, { stop: "ceiling" }, ctx);
    assert.equal(decision.outcome, "refused-by-switch");
    assert.equal(decision.record.requestedModel, "custom-configured-model-v1");

    // JevTransport instance with configured model and switch off
    const jevTransport = new JevTransport({
      projectSwitch: "off",
      env: {},
      model: "jev-model-configured-in-transport",
    });

    const ctx2: DecideContext<any> = {
      ...ctx,
      transport: jevTransport,
      taskId: "task-2",
      taskRoot: taskRoot(stateRoot, PROJECT, "task-2"),
    };

    const decision2 = await decide(STOP_JUDGMENT, { stop: "ceiling" }, ctx2);
    assert.equal(decision2.outcome, "refused-by-switch");
    assert.equal(decision2.record.requestedModel, "jev-model-configured-in-transport");

    // When transport has no model and context has no model, falls back to JEV_DEFAULT_MODEL
    const plainStub = {
      ask: async () => ({
        outcome: "refused-by-switch" as const,
        detail: "off",
      }),
    };
    const ctx3: DecideContext<any> = {
      ...ctx,
      transport: plainStub,
      taskId: "task-3",
      taskRoot: taskRoot(stateRoot, PROJECT, "task-3"),
    };
    const decision3 = await decide(STOP_JUDGMENT, { stop: "ceiling" }, ctx3);
    assert.equal(decision3.record.requestedModel, JEV_DEFAULT_MODEL);
  } finally {
    box.close();
  }
});

// ---------------------------------------------------------------------------
// 3. B2-27: jev-doctor tsFiles() follows symlinks
// ---------------------------------------------------------------------------

test("B2-27: jev-doctor tsFiles() inspects symlinked TypeScript files", async () => {
  const box = scratch("b2-27");
  try {
    box.write(`src/${JEV_TRANSPORT_FILE}`, "export const ok = true;");

    // Try creating a file symlink; if Windows unprivileged fails with EPERM, use directory junction/symlink
    let fileSymlinkSupported = true;
    try {
      const probeTarget = box.write("outside/probe.ts", "export const probe = 1;");
      const probeLink = join(box.root, "probe-link.ts");
      symlinkSync(probeTarget, probeLink, "file");
      rmSync(probeLink, { force: true });
    } catch {
      fileSymlinkSupported = false;
    }

    if (fileSymlinkSupported) {
      // Create a target file outside src
      const targetClean = box.write("outside/clean-target.ts", "export const clean = 1;");
      const targetBreach = box.write("outside/breaching-target.ts", "export const bad = () => fetch('https://example.com');");

      // Symlink clean file into src
      const symlinkClean = join(box.root, "src/workflow/symlinked-clean.ts");
      mkdirSync(dirname(symlinkClean), { recursive: true });
      symlinkSync(targetClean, symlinkClean, "file");

      const statusClean = await jevFenceStatus(join(box.root, "src"));
      assert.equal(statusClean.state, "intact");
      assert.equal(statusClean.files, 2);

      // Symlink breaching file into src
      const symlinkBreach = join(box.root, "src/workflow/symlinked-breach.ts");
      symlinkSync(targetBreach, symlinkBreach, "file");

      const statusBreach = await jevFenceStatus(join(box.root, "src"));
      assert.equal(statusBreach.state, "breached");
      assert.ok(statusBreach.offenders.includes("workflow/symlinked-breach.ts"));
    } else {
      // Test via symlinked directory (supported unprivileged on Windows via junction)
      box.write("outside-clean/clean-module.ts", "export const clean = 1;");
      const cleanDir = join(box.root, "outside-clean");
      const linkCleanDir = join(box.root, "src/workflow-clean");
      symlinkSync(cleanDir, linkCleanDir, process.platform === "win32" ? "junction" : "dir");

      const statusClean = await jevFenceStatus(join(box.root, "src"));
      assert.equal(statusClean.state, "intact");
      assert.equal(statusClean.files, 2);

      // Now add a breaching file into the symlinked directory
      box.write("outside-clean/breach-module.ts", "export const bad = () => fetch('https://example.com');");
      const statusBreach = await jevFenceStatus(join(box.root, "src"));
      assert.equal(statusBreach.state, "breached");
      assert.ok(statusBreach.offenders.some((o) => o.includes("breach-module.ts")));
    }
  } finally {
    box.close();
  }
});

// ---------------------------------------------------------------------------
// 4. B2-36: score validation requires integer score
// ---------------------------------------------------------------------------

test("B2-36: score validation rejects fractional scores like 1.5 with ContractError", () => {
  const questions: JevQuestions = {
    risk: {
      type: "score",
      instructions: "Evaluate risk",
      criteria: ["low", "medium", "high"],
    },
  };

  const validResponse = {
    model: "test-model",
    answers: {
      risk: {
        type: "score",
        score: 1,
        legend: { "0": "low", "1": "medium", "2": "high" },
        probabilities: { "0": 0.2, "1": 0.6, "2": 0.2 },
        confidence: 0.6,
      },
    },
    usage: { input_tokens: 10, output_tokens: 5 },
  };

  // Integer score 1 is valid
  assert.doesNotThrow(() => validateJevResponse(validResponse, questions));

  // Integer score 0 is valid
  assert.doesNotThrow(() => validateJevResponse({
    ...validResponse,
    answers: {
      risk: { ...validResponse.answers.risk, score: 0 },
    },
  }, questions));

  // Fractional score 1.5 must throw ContractError
  assert.throws(() => {
    validateJevResponse({
      ...validResponse,
      answers: {
        risk: { ...validResponse.answers.risk, score: 1.5 },
      },
    }, questions);
  }, (err: unknown) => err instanceof ContractError && err.message.includes("Score out of range: risk"));

  // Negative score -1 must throw ContractError
  assert.throws(() => {
    validateJevResponse({
      ...validResponse,
      answers: {
        risk: { ...validResponse.answers.risk, score: -1 },
      },
    }, questions);
  }, (err: unknown) => err instanceof ContractError && err.message.includes("Score out of range: risk"));

  // Out of range integer score 3 (length 3, max valid is 2) must throw ContractError
  assert.throws(() => {
    validateJevResponse({
      ...validResponse,
      answers: {
        risk: { ...validResponse.answers.risk, score: 3 },
      },
    }, questions);
  }, (err: unknown) => err instanceof ContractError && err.message.includes("Score out of range: risk"));
});

// ---------------------------------------------------------------------------
// 5. B2-37: ask() validates request questions before checking projectSwitch === 'off'
// ---------------------------------------------------------------------------

test("B2-37: ask() validates request questions before checking projectSwitch === 'off'", async () => {
  const transport = new JevTransport({
    projectSwitch: "off",
    env: {},
  });

  // Invalid questions (empty object) must throw QuestionValidationError, not return refused-by-switch
  await assert.rejects(
    transport.ask("state", {} as unknown as JevQuestions),
    QuestionValidationError,
  );

  // Invalid question (missing type) must throw QuestionValidationError
  await assert.rejects(
    transport.ask("state", {
      bad: { instructions: "something" } as unknown as any,
    }),
    QuestionValidationError,
  );

  // Invalid state (number) must throw QuestionValidationError
  await assert.rejects(
    transport.ask(123 as unknown as JevState, {
      q1: { type: "noul", instructions: "test" },
    }),
    QuestionValidationError,
  );

  // Valid questions and state with switch off must return refused-by-switch
  const validQuestions: JevQuestions = {
    q1: { type: "noul", instructions: "Is it valid?" },
  };
  const outcome = await transport.ask("valid state", validQuestions);
  assert.equal(outcome.outcome, "refused-by-switch");
  assert.match(outcome.detail, /switched off/);
});
