import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../../../src/cli/main.ts";
import { nextCommand } from "../../../src/cli/commands/next.ts";
import { k1Request, startUnderK1 } from "../../fixtures/k1-preflight.ts";
import { runStubCommand } from "../../../src/cli/commands/run.ts";
import { newCommand } from "../../../src/cli/commands/new.ts";
import { nextRevision, persistAttempt, readAttempt } from "../../../src/cli/commands/attempt.ts";
import { ReviewHeadroomInsufficient, ReviewNotReplaceable } from "../../../src/cli/commands/review.ts";
import { ReworkHeadroomInsufficient, ReworkTierUnsupported } from "../../../src/cli/commands/rework.ts";
import { AttemptWorktreeExists } from "../../../src/git/worktrees.ts";
import { nextSteps } from "../../../src/lifecycle/next-steps.ts";
import {
  renderAttemptNextAction, renderCommand, renderHeadroomAdvice, renderNextAction, renderNextSteps, renderOwnerAlternatives,
  renderRestartAdvice,
} from "../../../src/lifecycle/renderer.ts";
import { assertNextSteps, type NextSteps } from "../../../src/contracts/next-steps.ts";
import { TASK_STATES } from "../../../src/state/task-machine.ts";
import { ReplayNotDeliverable } from "../../../src/workflow/prove/compile.ts";

function bytes(root: string): unknown {
  return readdirSync(root, { withFileTypes: true }).map(entry => [entry.name,
    entry.isDirectory() ? bytes(join(root, entry.name)) : readFileSync(join(root, entry.name)).toString("base64")]);
}

for (const state of TASK_STATES) {
  test(`next text and JSON at synthetic ${state} are read-only and use the persisted renderer`, async () => {
    const root = mkdtempSync(join(tmpdir(), "awsf-next-"));
    try {
      const stateRoot = join(root, "state");
      const created = await newCommand({ stateRoot, project: "fixture", taskId: "stub-task", repository: root,
        request: "inspect synthetic legal steps", workflow: "build-review", tier: 2 });
      // These are isolated synthetic records, not transitions of a live attempt.
      const status = await persistAttempt(created.attemptDir, created.status.revision, {
        kind: "attempt.transitioned", next: nextRevision(created.status, { lifecycleState: state }),
      });
      const before = bytes(root);
      const output: string[] = [];
      const errors: string[] = [];
      const invoke = (extra: string[]) => main({ argv: ["next", "stub-task", "--state-root", stateRoot,
        "--project", "fixture", "--config", resolve("awsf.config.yaml"), ...extra], cwd: root,
        // A throwing getter proves the arm never even asks for an owner terminal.
        get terminal(): never { throw new Error("next accessed an owner terminal"); },
        writeOut: line => output.push(line), writeError: line => errors.push(line) });
      assert.equal(await invoke(["--json"]), 0, errors.join("\n"));
      const model: unknown = JSON.parse(output[0]!);
      assertNextSteps(model);
      // At DRAFT next measures K1 with reads only; this attempt has no preflight record.
      const k1 = state === "DRAFT" ? [{ check: "K1", field: "preflight-record", status: "missing" }] : undefined;
      assert.deepEqual(model, nextSteps({ ...status, state, ...(k1 === undefined ? {} : { k1 }) }));
      // w01-m3's owner exercise, on synthetic records only; no owner act is executed.
      if (state === "DRAFT") {
        assert.equal(model.steps.find(step => step.verb === "start")?.who, "driver");
        assert.equal(model.steps.find(step => step.verb === "cancel")?.who, "owner");
        assert.equal(model.steps.find(step => step.verb === "preflight")?.who, "driver");
        assert.equal(model.steps.find(step => step.verb === "confirm")?.who, "owner");
      }
      if (state === "AWAITING_OWNER") {
        for (const verb of ["land", "journey", "rework", "review", "cancel"]) {
          assert.equal(model.steps.find(step => step.verb === verb)?.who, "owner", verb);
        }
      }
      output.length = 0;
      assert.equal(await invoke(["--attempt", "1"]), 0, errors.join("\n"));
      assert.deepEqual(output, renderNextSteps(model, status));
      // The persisted sentence is rendered without K1's measurement; next adds it at DRAFT.
      if (state === "DRAFT") assert.equal(output[0], `start is refused until K1 clears: preflight-record missing; ${status.nextAction}`);
      else assert.equal(output[0], status.nextAction);
      assert.deepEqual(bytes(root), before, "next must not create a DB, lock, journal row or status revision");
      for (const id of ["L10", "L16"].filter(id => model.unavailable.some(edge => edge.edge === id))) {
        assert.ok(output.some(line => line.startsWith(`Unavailable ${id} `)));
        assert.doesNotMatch(output[0]!, new RegExp(id));
        assert.ok(!model.waits.some(wait => wait.edge === id));
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("next reads old advice without rewriting it, but displays today's model", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-next-legacy-"));
  try {
    const created = await newCommand({ stateRoot: root, project: "fixture", taskId: "legacy", repository: root,
      request: "read an old record", workflow: "build-review", tier: 2 });
    const old = { ...created.status, lifecycleState: "AWAITING_OWNER" as const, nextAction: "historical advice stays byte-identical" };
    writeFileSync(join(created.attemptDir, "status.json"), JSON.stringify(old));
    const before = bytes(root);
    const result = await nextCommand(created.attemptDir);
    assert.equal(result.lines[0], renderAttemptNextAction(old));
    assert.notEqual(result.lines[0], old.nextAction);
    assert.match(result.lines[0]!, /awsf review legacy/);
    assert.match(result.lines[0]!, /awsf journey legacy/);
    assert.equal((await readAttempt(created.attemptDir)).nextAction, old.nextAction);
    assert.deepEqual(bytes(root), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("next validates task selection and refuses unsupported flags without writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-next-refusal-"));
  try {
    const created = await newCommand({ stateRoot: root, project: "fixture", taskId: "stub", repository: root,
      request: "read without writes", workflow: "build", tier: 1 });
    const before = bytes(root);
    for (const extra of [["--attempt", "0"], ["--attempt", "9"], ["--reason", "no"], ["extra-task"]]) {
      const errors: string[] = [];
      assert.equal(await main({ argv: ["next", created.status.taskId, "--state-root", root, "--project", "fixture",
        "--config", resolve("awsf.config.yaml"), ...extra], cwd: root, writeOut: () => {}, writeError: line => errors.push(line) }), 1);
      assert.ok(errors.length > 0);
      assert.deepEqual(bytes(root), before);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("renderer separates unavailable explanations and gives flag-complete cancel advice", () => {
  for (const state of ["RUNNING", "GATING", "REVIEWING", "AWAITING_OWNER"] as const) {
    const model = nextSteps({ project: "fixture", taskId: "stub", attempt: 2, revision: 3, state });
    const text = renderNextAction(model);
    assert.match(text, /awsf cancel stub.*--cause.*--reason/);
    assert.doesNotMatch(text, /L10|L16|awsf rework.*(?:L10|L16)/);
    assert.equal(renderNextSteps(model).length, 1 + model.steps.length + model.waits.length + model.unavailable.length);
  }
});

function assertUnavailableRendering(model: ReturnType<typeof nextSteps>, lines: readonly string[]): void {
  // Commands and waits are separate from informational explanations. In these
  // states no implemented CLI edge goes to RUNNING, so rework is not advice.
  assert.doesNotMatch(lines[0]!, /L10|L16|awsf (?:rework|run)\b/u);
  for (const edge of model.unavailable) {
    const informational = lines.filter(line => line.startsWith(`Unavailable ${edge.edge} `));
    assert.equal(informational.length, 1);
    assert.ok(informational[0]!.includes(edge.detail));
    assert.ok(informational[0]!.includes(`machine actors ${edge.actors.join(", ")}`));
    assert.doesNotMatch(informational[0]!, /`awsf\b/u);
    assert.equal(lines.some(line => new RegExp(`^(?:Step|Wait) ${edge.edge}\\b`, "u").test(line)), false);
  }
}

test("unavailable rendering exposes explanations, never recommendations, with planted defects", () => {
  for (const state of ["GATING", "REVIEWING"] as const) {
    const model = nextSteps({ project: "fixture", taskId: "stub", attempt: 2, revision: 3, state });
    const lines = renderNextSteps(model);
    assertUnavailableRendering(model, lines);
    for (const planted of [
      ["run `awsf rework stub`", ...lines.slice(1)],
      ["wait for L10 or L16", ...lines.slice(1)],
      [...lines, `Wait ${model.unavailable[0]!.edge} to RUNNING: host`],
      lines.filter(line => !line.startsWith("Unavailable ")),
      lines.map(line => line.startsWith("Unavailable ") ? line.replace(model.unavailable[0]!.detail, "") : line),
    ]) assert.throws(() => assertUnavailableRendering(model, planted), { name: "AssertionError" });
  }
});

test("real offline stub transitions persist the same rendered action next reads", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-next-stub-"));
  try {
    const repository = join(root, "canonical");
    execFileSync("git", ["init", "-b", "main", repository], { stdio: "ignore" });
    writeFileSync(join(repository, "fixture.txt"), "offline fixture\n");
    writeFileSync(join(repository, ".gitignore"), "node_modules/\n");
    execFileSync("git", ["-C", repository, "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", repository, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com",
      "commit", "-m", "test: seed offline next exercise"], { stdio: "ignore" });
    mkdirSync(join(repository, "node_modules"));
    const created = await newCommand({ stateRoot: join(root, "state"), project: "agentic-workflow-software-factory", taskId: "stub",
      repository, request: k1Request("exercise next without providers", "core/src/example.ts"), workflow: "simple-sdlc", tier: 2 });
    assert.equal((await nextCommand(created.attemptDir)).lines[0], created.status.nextAction);
    const prepared = await startUnderK1({ attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"),
      configPath: resolve("awsf.config.yaml"), preflight: () => ({ adapter: true, sandbox: true, observability: true }) });
    assert.equal((await nextCommand(created.attemptDir)).lines[0], prepared.nextAction);
    const states: string[] = [];
    const done = await runStubCommand(created.attemptDir, { projectRecord: (_record, status) => {
      states.push(status.lifecycleState);
      assert.equal(status.nextAction, renderAttemptNextAction(status));
    } });
    assert.deepEqual(states, ["RUNNING", "GATING", "REVIEWING", "AWAITING_OWNER"]);
    assert.equal((await nextCommand(created.attemptDir)).lines[0], done.nextAction);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("recovery and replay advice are rendered from facts, never bare cancellation or an unavailable edge", () => {
  const running = nextSteps({ project: "fixture", taskId: "stub", attempt: 2, revision: 3, state: "RUNNING" });
  for (const kind of ["quota-pause", "ceiling-pause", "ticket-block", "result-ready", "completed-phase"]) {
    const action = renderNextAction(running, { recovery: { kind, ticket: "T06" }, process: null, budget: { callsReserved: 0 } });
    assert.match(action, /awsf resume stub.*--reason/);
    if (kind === "ceiling-pause") assert.match(action, /awsf raise stub.*--calls.*--reason/);
  }
  const advice = { kind: "ceiling-pause" as const, minimumCeiling: 5, maximumCeiling: 10 };
  assert.match(renderNextAction(running, { recovery: { kind: "ceiling-pause" }, advice, budget: { callsReserved: 0, ceiling: 4 } }), /--calls 1/);
  const funded = renderNextAction(running, { recovery: { kind: "ceiling-pause" }, advice, budget: { callsReserved: 0, ceiling: 5 } });
  assert.match(funded, /awsf resume/);
  assert.doesNotMatch(funded, /awsf raise/);
  const impossible = renderNextAction(running, { recovery: { kind: "ceiling-pause" }, advice: { ...advice, minimumCeiling: 11 } });
  assert.match(impossible, /exceeds MAX_CALL_CEILING/);
  assert.doesNotMatch(impossible, /awsf (raise|resume)/);
  const owner = nextSteps({ project: "fixture", taskId: "stub", attempt: 1, revision: 3, state: "AWAITING_OWNER" });
  const replay = renderNextAction(owner, { workflow: "prove", recovery: { kind: "completed-phase" } });
  assert.match(replay, /awsf cancel stub.*--cause.*--reason/);
  assert.doesNotMatch(replay, /awsf (land|journey|resume)/);
  assert.match(renderNextAction(running, { blocker: { code: "sqlite-projection-failed" } }), /awsf db rebuild/);
});

function argvOf(model: NextSteps, verb: string): string {
  const step = model.steps.find(step => step.verb === verb);
  assert.ok(step !== undefined, `no ${verb} step at ${model.state}`);
  return renderCommand(step.argv);
}

test("only a prove replay is told it never lands; intake gets the landable owner-gate advice", () => {
  const owner = nextSteps({ project: "fixture", taskId: "stub", attempt: 2, revision: 3, state: "AWAITING_OWNER" });
  const prove = renderNextAction(owner, { workflow: "prove", candidateSha: "abc", gatesPass: true });
  assert.match(prove, /this workflow never lands/);
  assert.ok(prove.includes(argvOf(owner, "cancel")));
  for (const workflow of ["intake", "build-review"]) {
    const action = renderNextAction(owner, { workflow, candidateSha: "abc", gatesPass: true });
    assert.doesNotMatch(action, /never lands/, workflow);
    for (const verb of ["land", "journey", "cancel"]) assert.ok(action.includes(argvOf(owner, verb)), `${workflow} ${verb}`);
  }
  assert.equal(renderNextAction(owner, { workflow: "intake", candidateSha: "abc", gatesPass: true }),
    renderNextAction(owner, { workflow: "build-review", candidateSha: "abc", gatesPass: true }));
});

test("owner advice carries the loaded project and attempt, never a guessed attempt", () => {
  const attempt = { project: "fixture", taskId: "stub", attempt: 3 };
  const owner = nextSteps({ ...attempt, revision: 0, state: "AWAITING_OWNER" });
  const headroom = renderHeadroomAdvice(attempt, 2);
  assert.ok(headroom.includes(renderCommand(owner.steps.find(step => step.verb === "raise")!.argv.map(token => token === "<n>" ? "2" : token))));
  for (const text of [headroom, renderOwnerAlternatives(attempt),
    new ReviewHeadroomInsufficient(1, 2, attempt).message, new ReworkHeadroomInsufficient(1, 3, 2, attempt).message,
    new ReworkTierUnsupported(1, "build-review", 2, attempt).message]) {
    assert.match(text, /--project fixture --attempt 3\b/u);
    assert.doesNotMatch(text, /<project>|<attempt>|--attempt (?!3\b)/u);
  }
  // Only a site with no loaded attempt keeps placeholders, and never a concrete number.
  const restart = new AttemptWorktreeExists("/trees/session", true).message;
  assert.ok(restart.includes(renderRestartAdvice({ taskId: "<task>" })));
  assert.match(restart, /awsf start '<task>' --project '<project>' --attempt '<attempt>'/u);
  assert.doesNotMatch(restart, /--attempt \d/u);
});

test("a non-replaceable review offers rework first, then land or cancel, from the model", () => {
  const attempt = { project: "fixture", taskId: "stub", attempt: 3 };
  const owner = nextSteps({ ...attempt, revision: 0, state: "AWAITING_OWNER" });
  const message = new ReviewNotReplaceable("request-changes", "review", attempt).message;
  const [rework, land, cancel] = ["rework", "land", "cancel"].map(verb => message.indexOf(argvOf(owner, verb)));
  assert.match(argvOf(owner, "rework"), /^`awsf rework stub --project fixture --attempt 3 '<defect>'`$/u);
  assert.ok(rework! >= 0 && rework! < land! && land! < cancel!, message);
  assert.doesNotMatch(message, /awsf raise/u);
});

test("replay refusals render the model's cancel argv, with its cause and reason placeholders", () => {
  const status = { project: "fixture", taskId: "replay", attempt: 3, revision: 4 };
  const owner = nextSteps({ ...status, state: "AWAITING_OWNER" });
  for (const act of ["land", "journey"] as const) {
    const message = new ReplayNotDeliverable({ ...status, lifecycleState: "AWAITING_OWNER" }, act).message;
    assert.ok(message.includes(argvOf(owner, "cancel")), message);
    assert.match(message, /awsf cancel replay --project fixture --attempt 3 --cause '<cause>' --reason '<why>'/u);
  }
  const cancelled = new ReplayNotDeliverable({ ...status, lifecycleState: "CANCELLED" }, "land").message;
  assert.doesNotMatch(cancelled, /awsf cancel/u);
});
