// Visual references through the production runner, at zero provider cost.
//
// The scripted worker behaves like a real image tool in the one way that
// matters: it reads the delivered file from disk and reports the bytes it
// read, so a replaced, missing or unopened file is observed exactly as it
// would be on a real route. What these tests cannot show — that a model
// perceived the pixels — is what the live smoke on each route is for.

import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { AwsfConfig } from "../../src/config/schema.ts";
import { loadConfig } from "../../src/config/load.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { ReviewOutput } from "../../src/contracts/review-output.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import { AdapterError, isTaskEdgeRegistration, reservationIdOf } from "../../src/adapters/interface.ts";
import type {
  Availability, BrokerProcessRegistration, ContinuityCapableAdapter, ContinuityEvidence, ContinuityRef, ModelInfo,
  ModelRequest, ObservedProviderSession, ProcessSpec, TransportBroker,
} from "../../src/adapters/interface.ts";
import type { BrokerOptions } from "../../src/execution/transport-broker.ts";
import { PiCodexAdapter } from "../../src/adapters/pi-codex.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { newCommand } from "../../src/cli/commands/new.ts";
import { startCommand } from "../../src/cli/commands/start.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import { reworkCommand } from "../../src/cli/commands/rework.ts";
import { readAttempt } from "../../src/cli/commands/attempt.ts";
import type { AttemptEvidence } from "../../src/observability/attempt-evidence.ts";
import { bindingFor, referenceLibrary, sha256, discPng, type ReferenceLibrary } from "../fixtures/visual-references.ts";

const AT = "2026-09-23T00:00:00.000Z";
const SOURCE = "core/src/generated.ts";

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function build(): BuildOutput {
  return {
    schema: "awsf.build-output/v1", producerStatus: "success", summary: "wrote one source after opening the references",
    artifacts: [{ path: SOURCE, kind: "source", description: "bounded source" }], notesForNextPhase: "run host commands",
    changedFiles: [SOURCE], implementationNotes: ["fixture implementation"], commandsRun: [], proposedCommitMessage: "feat: add generated source",
  };
}

function review(reviewedSha: string): ReviewOutput {
  return {
    schema: "awsf.review-output/v1", producerStatus: "success", summary: "compared the candidate with the references",
    artifacts: [], notesForNextPhase: "owner decides", verdict: "accept", reviewedSha, findings: [],
    limitations: [{ detail: "scripted fixture review", affectedFiles: [] }],
  };
}

/** The frames a host block names, as the worker would read them off its prompt. */
function deliveredPaths(prompt: string): Map<string, string> {
  const paths = new Map<string, string>();
  for (const match of prompt.matchAll(/^- ([A-Za-z0-9._-]+): (.+) \(sha256 [a-f0-9]{64}\)$/gmu)) paths.set(match[1]!, match[2]!);
  return paths;
}

interface Turn {
  readonly adapter: string;
  readonly prompt: string;
  readonly measured: boolean;
  readonly continuity: "open" | "resume" | undefined;
}

interface Behaviour {
  /** Which delivered frames this turn opens with its read tool. */
  readonly open?: (turn: number, frames: readonly string[], role: "builder" | "reviewer") => readonly string[];
  readonly supportsImages?: boolean;
  /** Runs after a turn, with the delivered paths it saw. */
  readonly after?: (turn: number, paths: ReadonlyMap<string, string>) => void;
}

class VisualAdapter implements ContinuityCapableAdapter {
  readonly supportsSameSessionCorrection = true as const;
  readonly id: string;
  readonly #worktree: string;
  readonly #turns: Turn[];
  readonly #behaviour: Behaviour;
  readonly #candidate: () => string;
  #turn = 0;
  readonly #sessions = new Set<string>();
  /** A resumed conversation still holds the paths its first turn was given. */
  #remembered = new Map<string, string>();

  constructor(id: string, worktree: string, turns: Turn[], behaviour: Behaviour, candidate: () => string) {
    this.id = id; this.#worktree = worktree; this.#turns = turns; this.#behaviour = behaviour; this.#candidate = candidate;
  }

  #provider(): string { return this.id === "claude-code" ? "anthropic" : "openai-codex"; }
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return { adapter: this.id, provider: this.#provider(), requestedModel: model, contextWindow: null, supportsThinking: true, supportsTools: true,
      supportsImages: this.#behaviour.supportsImages ?? true, continuity: "same-session-correction", usageAuthority: "provider", costAuthority: "unavailable" };
  }
  continuityStoreDir(runtimeDir: string): string { return join(runtimeDir, "scripted-sessions"); }
  assertResumable(ref: ContinuityRef): ContinuityEvidence {
    if (!this.#sessions.has(ref.providerSessionId)) throw new AdapterError(this.id, "E_BACKEND_FAILURE", "no such session");
    return { proof: "host-visible-session-store", detail: "scripted" };
  }
  assertSameSession(first: ObservedProviderSession, next: ObservedProviderSession): void {
    if (first.sessionId !== next.sessionId) throw new AdapterError(this.id, "E_BACKEND_FAILURE", "different session");
  }
  buildSpec(request: ModelRequest): ProcessSpec {
    return { executable: "node", argv: ["-e", ""], cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false };
  }
  async *parse(): AsyncIterable<NormalizedEvent> { yield* []; }

  async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2], observed?: ObservedProviderSession): AsyncIterable<NormalizedEvent> {
    const turn = this.#turn++;
    const locator = request.continuity?.ref.providerSessionId ?? null;
    if (turn === 0 && locator !== null) this.#sessions.add(locator);
    this.#turns.push({ adapter: this.id, prompt: request.prompt, measured: observed?.images !== undefined, continuity: request.continuity?.turn });
    await broker.startProcess(registration, this.buildSpec(request), signal);
    const role = request.prompt.includes("awsf.review-output/v1") ? "reviewer" : "builder";
    const stated = deliveredPaths(request.prompt);
    const paths = stated.size > 0 || request.continuity?.turn !== "resume" ? stated : this.#remembered;
    this.#remembered = paths;
    const runId = registration.runId;
    const events: NormalizedEvent[] = [];
    let seq = 1;
    const push = (event: Record<string, unknown>): void => { events.push({ seq: seq++, runId, hostAt: AT, providerAt: null, ...event } as NormalizedEvent); };
    push({ kind: "run.started", adapter: this.id, requestedModel: request.model });
    push({ kind: "model.resolved", adapter: this.id, provider: this.#provider(), requestedModel: request.model, resolvedModel: `${request.model}-resolved`, provenance: "route-attributed" });
    let tool = 0;
    for (const frame of this.#behaviour.open?.(turn, [...paths.keys()], role) ?? [...paths.keys()]) {
      // The read tool: whatever bytes are on disk at that path are what the model receives.
      const bytes = readFileSync(paths.get(frame)!);
      tool += 1;
      push({ kind: "tool.requested", toolCallId: `t${String(tool)}`, name: "read", inputSummary: "{}" });
      push({ kind: "tool.completed", toolCallId: `t${String(tool)}`, outcome: "ok", durationMs: 1, resultSnippet: "[image]" });
      observed?.images?.push({ toolCallId: `t${String(tool)}`, toolName: "read", outcome: "ok", mediaType: "image/png", bytes: bytes.length, sha256: sha256(bytes) });
    }
    this.#behaviour.after?.(turn, paths);
    let payload: BuildOutput | ReviewOutput;
    if (role === "reviewer") payload = review(this.#candidate());
    else {
      mkdirSync(join(this.#worktree, "core", "src"), { recursive: true });
      writeFileSync(join(this.#worktree, SOURCE), `export const generated = ${String(turn)};\n`);
      payload = build();
    }
    if (observed !== undefined) { observed.sessionId = locator; observed.resolvedModel = `${request.model}-resolved`; }
    push({ kind: "text.delta", text: JSON.stringify(payload) });
    push({ kind: "usage", usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" } });
    push({ kind: "run.completed", exitCode: 0 });
    yield* events;
  }
}

function fakeBroker(options: BrokerOptions): TransportBroker {
  return {
    async startProcess(registration, spec) {
      const record = {
        identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" },
        runId: registration.runId, edge: isTaskEdgeRegistration(registration) ? registration.edge : null,
        ...(registration.kind === "agent-phase" || registration.kind === "phase-correction" ? {
          phase: { taskSessionId: registration.taskSessionId, workflowId: registration.workflowId, phaseId: registration.phaseId,
            phaseOrdinal: registration.phaseOrdinal, adapterId: registration.adapterId, role: registration.role },
        } : {}),
        reservationId: reservationIdOf(registration), command: [spec.executable, ...spec.argv], cwd: spec.cwd,
      };
      if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
      if (registration.kind === "phase-correction") {
        const evidence = options.correctionLaunchVerifier!.verify(registration);
        await options.register(record);
        await options.onCorrection?.(record, evidence);
      } else {
        await options.register(record);
        const reservation = options.ledger.spendOnGo(reservationIdOf(registration));
        await options.onSpent?.(record, reservation);
      }
      return {
        runId: registration.runId, identity: record.identity,
        stdout: (async function* () {})(), stderr: (async function* () {})(),
        exit: Promise.resolve({ code: 0, signal: null }),
        cancel: async () => ({ termSent: false, killSent: false, survivors: [], terminated: true, skipped: null }),
      };
    },
  };
}

function configText(): string {
  return readFileSync(resolve("awsf.config.yaml"), "utf8")
    .replaceAll("interrupted_turn: true", "interrupted_turn: false")
    .replace("  seed_paths: [node_modules]", "  seed_paths: []")
    .replace("test: { argv: [npm, run, test:unit], timeout_seconds: 600 }", "test: { argv: [node, -e, process.exit(0)], timeout_seconds: 10 }")
    .replace("  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "")
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "");
}

interface WorldOptions {
  readonly workflow?: "build" | "build-review";
  readonly phases?: readonly string[] | null;
  readonly configure?: (config: AwsfConfig) => AwsfConfig;
  readonly beforeRun?: (library: ReferenceLibrary) => void;
}

async function world(options: WorldOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "awsf visual journey "));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  execFileSync("git", ["init", "-b", "main", canonical], { stdio: "ignore" });
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", "README.md");
  git(canonical, "-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com", "commit", "-m", "test: seed visual journey");
  const text = configText();
  const config = (options.configure ?? ((value) => value))(loadConfig(text));
  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, text);
  for (const agent of config.agents) {
    for (const promptPath of [agent.prompt.system, agent.prompt.user]) {
      const destination = join(root, promptPath);
      mkdirSync(resolve(destination, ".."), { recursive: true });
      writeFileSync(destination, readFileSync(resolve(promptPath), "utf8"));
    }
  }
  mkdirSync(join(root, "prompts/shared"), { recursive: true });
  writeFileSync(join(root, "prompts/shared/headless-role.md"), readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"));
  const library = referenceLibrary(["f1", "f2", "f3"], { parent: join(root, "owner downloads") });
  const workflow = options.workflow ?? "build";
  const projection = createDashboardProjection(stateRoot);
  const created = await newCommand({ stateRoot, project: config.project.slug, taskId: `visual-${workflow}`, repository: canonical,
    request: "write one bounded source that matches the bound references", workflow, tier: workflow === "build" ? 1 : 2,
    configSnapshotJson: JSON.stringify(config), projectRecord: projection.project });
  let bindingPath: string | undefined;
  if (options.phases !== null) {
    bindingPath = join(root, "owner binding.yaml");
    writeFileSync(bindingPath, JSON.stringify(bindingFor(library, undefined, options.phases ?? ["builder"])));
  }
  await startCommand({ attemptDir: created.attemptDir, worktreeRoot: join(root, "worktrees"), configPath,
    preflight: () => ({ adapter: true, sandbox: true, observability: true }), projectRecord: projection.project,
    ...(bindingPath === undefined ? {} : { visualReferences: bindingPath }) });
  options.beforeRun?.(library);
  const prepared = await readAttempt(created.attemptDir);
  const turns: Turn[] = [];
  const run = (behaviour: Behaviour = {}, ids: Readonly<Record<string, string>> = { claude: "claude-code", codex: "pi-codex" }) =>
    runProductionCommand({ attemptDir: created.attemptDir, stateRoot, config, configPath, projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement, assertLaunchProjection: projection.assertLaunchPermitted,
      infrastructure: { adapterFor: (_entry, id) => new VisualAdapter(ids[id] ?? id, prepared.worktree!, turns, behaviour,
        () => git(prepared.worktree!, "rev-parse", "HEAD")), createBroker: fakeBroker, sandboxProbe: () => false } });
  const evidence = (): AttemptEvidence[] => readFileSync(join(created.attemptDir, "journal.jsonl"), "utf8").split("\n").filter(Boolean)
    .map((line) => (JSON.parse(line) as { event: { evidence?: AttemptEvidence } }).event.evidence).filter((value): value is AttemptEvidence => value !== undefined);
  return { root, canonical, stateRoot, config, configPath, library, created, prepared, turns, run, evidence, projection };
}

function gate(evidence: readonly AttemptEvidence[], phase: string) {
  return evidence.filter((value) => value.type === "gate" && value.gateId === "visual_references_inspected" && value.phaseId.endsWith(`:${phase}`));
}

test("V1 a bound builder receives fresh copies, opens them through its tool, and the gate passes on the observed bytes", async () => {
  const w = await world();
  try {
    const status = await w.run();
    assert.equal(status.lifecycleState, "AWAITING_OWNER", JSON.stringify(status.blocker));
    assert.equal(status.budget.callsSpent, 1);
    const evidence = w.evidence();
    const bound = evidence.find((value) => value.type === "visual-references-bound");
    assert.equal(bound?.type, "visual-references-bound");
    assert.deepEqual(bound.bound.frames.map((frame) => frame.id), ["f1", "f2", "f3"]);
    const delivered = evidence.find((value) => value.type === "visual-references-delivered");
    assert.equal(delivered?.type, "visual-references-delivered");
    assert.equal(delivered.readOnly, "digest-checked", "without bwrap the record says the copy is digest-checked, not OS-protected");
    const inspection = evidence.find((value) => value.type === "visual-reference-inspection");
    assert.equal(inspection?.type, "visual-reference-inspection");
    assert.deepEqual(inspection.observations.map((observation) => observation.frameId), ["f1", "f2", "f3"]);
    const rows = gate(evidence, "builder");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.type === "gate" && rows[0].passed, true);

    const turn = w.turns[0]!;
    assert.equal(turn.measured, true, "the host asked the adapter to measure image results");
    assert.match(turn.prompt, /VISUAL REFERENCES \(host-provisioned, read-only\)/);
    const paths = deliveredPaths(turn.prompt);
    for (const [frame, path] of paths) {
      assert.deepEqual(readFileSync(path), w.library.images[frame], "delivered bytes are the verified bytes");
      assert.ok(relative(w.prepared.worktree!, path).startsWith(".."), "delivered copies live outside the worktree");
      assert.ok(path.startsWith(w.created.attemptDir), "delivered copies live in the attempt's private runtime");
    }
    assert.deepEqual(git(w.prepared.worktree!, "show", "--name-only", "--format=", status.candidateSha!).split("\n"), [SOURCE],
      "no reference enters the candidate diff");
    for (const frame of Object.keys(w.library.images)) assert.equal(sha256(readFileSync(w.library.paths[frame]!)), sha256(w.library.images[frame]!));

    const journal = readFileSync(join(w.created.attemptDir, "journal.jsonl"), "utf8");
    assert.ok(!journal.includes(w.library.root), "the source root never reaches the journal");
    assert.ok(!journal.includes("owner downloads"));
    assert.ok(!readFileSync(join(w.created.attemptDir, "status.json"), "utf8").includes(w.library.root));

    // Paths outside the runner that would launch the bound phase refuse before confirming anything.
    await assert.rejects(reworkCommand({ attemptDir: w.created.attemptDir, stateRoot: w.stateRoot, defect: "the disc in f2 is drawn off-centre",
      terminal: { interactive: true, write: () => {}, confirm: async () => assert.fail("refused before confirmation") },
      config: w.config, configPath: w.configPath }), /path-unsupported/);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test("V2 an incomplete inspection blocks visual acceptance with the missing frame named", async () => {
  const w = await world();
  try {
    const status = await w.run({ open: (_turn, frames) => frames.slice(0, 2) });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.match(status.blocker?.detail ?? "", /frame f3 opened/);
    const rows = gate(w.evidence(), "builder");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.type === "gate" && rows[0].passed, false);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test("V1 an ordinary attempt without a binding is unchanged: no block, no measurement, no gate, no evidence", async () => {
  const w = await world({ phases: null });
  try {
    const status = await w.run();
    assert.equal(status.lifecycleState, "AWAITING_OWNER", JSON.stringify(status.blocker));
    assert.doesNotMatch(w.turns[0]!.prompt, /VISUAL REFERENCES/);
    assert.equal(w.turns[0]!.measured, false);
    const evidence = w.evidence();
    assert.equal(evidence.some((value) => value.type.startsWith("visual-")), false);
    assert.equal(gate(evidence, "builder").length, 0);
    assert.equal(existsSync(join(w.created.attemptDir, "private", "visual-references")), false);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

for (const [name, code, setup] of [
  ["a text-only model", "route-text-only", { behaviour: { supportsImages: false } }],
  ["a profile with no read tool", "tool-unavailable", { configure: (config: AwsfConfig): AwsfConfig => ({ ...config,
    agents: config.agents.map((agent) => agent.name === "builder" ? { ...agent, tools: { ...agent.tools, allow: ["edit", "write", "exec"] } } : agent) }) }],
  ["a route with no demonstrated image delivery", "route-unsupported", { ids: { claude: "claude", codex: "codex" } }],
  ["a source replaced after start", "source-changed", { beforeRun: (library: ReferenceLibrary) => {
    const replaced = discPng(9); writeFileSync(library.paths.f2!, replaced); library.writeDigests({ f2: sha256(replaced) });
  } }],
] as const) {
  test(`V2 ${name} blocks before any provider call (${code})`, async () => {
    const w = await world({ ...("configure" in setup ? { configure: setup.configure } : {}), ...("beforeRun" in setup ? { beforeRun: setup.beforeRun } : {}) });
    try {
      const status = await w.run("behaviour" in setup ? setup.behaviour : {}, "ids" in setup ? setup.ids : undefined);
      assert.equal(status.lifecycleState, "BLOCKED");
      assert.match(status.blocker?.detail ?? "", new RegExp(code));
      assert.equal(status.budget.callsSpent, 0);
      assert.equal(w.turns.length, 0);
    } finally { rmSync(w.root, { recursive: true, force: true }); }
  });
}

const sameSessionBuilder = (config: AwsfConfig): AwsfConfig => ({ ...config,
  agents: config.agents.map((agent) => agent.name === "builder" ? { ...agent, harness: { ...agent.harness, continuity: "same-session" as const } } : agent) });

test("V1 a same-session correction re-proves the delivery and completes the inspection in the same phase", async () => {
  const w = await world({ configure: sameSessionBuilder });
  try {
    const status = await w.run({ open: (turn, frames) => turn === 0 ? [] : frames });
    assert.equal(status.lifecycleState, "AWAITING_OWNER", JSON.stringify(status.blocker));
    assert.equal(status.budget.callsSpent, 1, "the correction cost tokens, not a call");
    assert.deepEqual(w.turns.map((turn) => turn.continuity), ["open", "resume"]);
    const evidence = w.evidence();
    assert.equal(evidence.filter((value) => value.type === "visual-reference-inspection").length, 2, "each turn records what its tool returned");
    assert.deepEqual(gate(evidence, "builder").map((row) => row.type === "gate" && row.passed), [false, true]);
    assert.equal(evidence.filter((value) => value.type === "visual-references-delivered").length, 1, "one launch, one delivery");
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test("V2 a delivered file replaced between turns ends the phase before the correction launches", async () => {
  const w = await world({ configure: sameSessionBuilder });
  try {
    const status = await w.run({ open: () => [], after: (turn, paths) => {
      if (turn !== 0) return;
      const path = paths.get("f1")!;
      chmodSync(path, 0o644);
      writeFileSync(path, discPng(55));
    } });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.match(status.blocker?.detail ?? "", /delivery-changed/);
    assert.equal(w.turns.length, 1, "no process was started for the correction");
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test("V1 a bound reviewer gets its own delivery and must open the frames itself", async () => {
  const w = await world({ workflow: "build-review", phases: ["reviewer"] });
  try {
    const status = await w.run();
    assert.equal(status.lifecycleState, "AWAITING_OWNER", JSON.stringify(status.blocker));
    const builderTurn = w.turns.find((turn) => !turn.prompt.includes("awsf.review-output/v1"))!;
    const reviewerTurn = w.turns.find((turn) => turn.prompt.includes("awsf.review-output/v1"))!;
    assert.doesNotMatch(builderTurn.prompt, /VISUAL REFERENCES/, "an unbound phase receives nothing");
    assert.match(reviewerTurn.prompt, /VISUAL REFERENCES/);
    assert.equal(reviewerTurn.adapter, "claude-code");
    assert.equal(gate(w.evidence(), "reviewer").length, 1);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test("V2 evidence from the builder never satisfies the reviewer's own inspection", async () => {
  const w = await world({ workflow: "build-review", phases: ["builder", "reviewer"] });
  try {
    const status = await w.run({ open: (_turn, frames, role) => role === "builder" ? frames : [] });
    assert.equal(status.lifecycleState, "BLOCKED");
    const evidence = w.evidence();
    assert.deepEqual(gate(evidence, "builder").map((row) => row.type === "gate" && row.passed), [true]);
    assert.deepEqual(gate(evidence, "reviewer").map((row) => row.type === "gate" && row.passed), [false]);
    assert.equal(evidence.filter((value) => value.type === "visual-references-delivered").length, 2, "each bound phase receives its own copy");
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

// The production transport end to end: the real pi adapter's argv, the real
// broker's process, and the real decoder measuring bytes a separate process
// read off disk and returned in pi's captured tool-result shape.
const VISUAL_PROVIDER = resolve("core/test/fixtures/providers/codex/visual-reference-fixture.mjs");

class ProcessPiAdapter extends PiCodexAdapter {
  readonly #open: number;
  readonly specs: ProcessSpec[] = [];
  constructor(open: number) { super({ executable: "visual-reference-fixture" }); this.#open = open; }
  override async isAvailable(): Promise<Availability> { return { status: "available" }; }
  override buildSpec(request: ModelRequest): ProcessSpec {
    const spec = super.buildSpec(request);
    this.specs.push(spec);
    return { ...spec, executable: VISUAL_PROVIDER, argv: [...spec.argv, "--awsf-fixture-open", String(this.#open)] };
  }
}

for (const [open, expected] of [[3, "AWAITING_OWNER"], [1, "BLOCKED"]] as const) {
  test(`V1/V2 a process-backed pi builder opening ${String(open)} of 3 frames is ${expected} through the real decoder`, async () => {
    const w = await world();
    try {
      const adapter = new ProcessPiAdapter(open);
      const status = await runProductionCommand({ attemptDir: w.created.attemptDir, stateRoot: w.stateRoot, config: w.config, configPath: w.configPath,
        projectRecord: w.projection.project, assertAdvancement: w.projection.assertAdvancement, assertLaunchProjection: w.projection.assertLaunchPermitted,
        infrastructure: { adapterFor: (_entry, id) => id === "codex" ? adapter : null, sandboxProbe: () => false } });
      assert.equal(status.lifecycleState, expected, JSON.stringify(status.blocker));
      const spec = adapter.specs.at(-1)!;
      assert.deepEqual(spec.argv.slice(spec.argv.indexOf("--tools"), spec.argv.indexOf("--tools") + 2), ["--tools", "read,grep,find,ls,edit,write,bash"],
        "the managed-worker profile keeps its read tool");
      const inspection = w.evidence().find((value) => value.type === "visual-reference-inspection");
      assert.equal(inspection?.type, "visual-reference-inspection");
      assert.deepEqual(inspection.observations.map((observation) => observation.frameId), ["f1", "f2", "f3"].slice(0, open));
      assert.deepEqual(inspection.observations.map((observation) => observation.toolName), Array(open).fill("read"));
      const journal = readFileSync(join(w.created.attemptDir, "journal.jsonl"), "utf8");
      assert.doesNotMatch(journal, /iVBORw0KGgo/, "no image payload reaches the journal");
      if (expected === "BLOCKED") assert.match(status.blocker?.detail ?? "", /frame f2 opened/);
    } finally { rmSync(w.root, { recursive: true, force: true }); }
  });
}
