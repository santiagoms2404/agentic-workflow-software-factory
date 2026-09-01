// The five-stage ladder, walked end to end in one temporary directory.
//
// AC-6's journey: a throwaway project travels init -> project-register ->
// design-to-plan -> build -> publish on the stub route, with no provider
// contacted and no network touched. Every arrow between two stages is an owner
// act this file performs explicitly. Nothing here advances by itself, which is
// the same claim `core/test/unit/stages/stops.test.ts` proves one boundary at a
// time and this file exercises across the whole ladder.
//
// Q5's ABSENCE DOES NOT APPLY. All five captured stages are reachable, so all
// five travel and none of them is [f].
//
// THE ENVELOPE JOIN, as AC-6 was amended on 2026-08-27. W05's milestone M8
// closed `W05-HOST-COMMAND-ENVELOPES` by registering the three host-command
// schema ids W11's T04 asked for, and by deciding under its Q7 that a
// session-less command's envelope is a validated return value stored nowhere.
// So the join splits, and the split is the contract rather than a shortfall:
//   * all five stage outputs validate against the schema id their record names
//     and carry every field their capture recorded — shape, never bytes;
//   * where a session exists — S3, S4, S5 — that output is read back out of the
//     projection through `envelopesForPhase`, and S4->S5 is the one boundary
//     M8 made projection-observable;
//   * where none exists — S1->S2 and S2->S3 — the later stage's inputs are
//     owner-authored, and the boundary is an absence with no journal, no
//     attempt directory and no launch, so there is no envelope-derived advance
//     to assert at either.
//
// THE HARNESS IS NOT A NEW ONE. It is the offline world of
// `core/test/unit/cli/design-to-plan-route.test.ts`, factored into
// `_offline-route.ts` and extended here with the bootstrap: this journey begins
// from an empty directory through W03's `initCommand` rather than from a
// repository that already exists. Publication's remote is a bare repository
// created inside the same temporary directory, following
// `core/test/journeys/publish.test.ts` and its `bareFixture` helper.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { stringify } from "yaml";

import { readAttempt } from "../../src/cli/commands/attempt.ts";
import { createDashboardProjection } from "../../src/cli/commands/dashboard-projection.ts";
import { initCommand } from "../../src/cli/commands/init.ts";
import { landCommand } from "../../src/cli/commands/land.ts";
import { registerProject } from "../../src/cli/commands/project.ts";
import { publishCommand } from "../../src/cli/commands/publish.ts";
import { runProductionCommand } from "../../src/cli/commands/production-run.ts";
import type { OwnerTerminal } from "../../src/cli/tty.ts";
import { toConfigSnapshotJson } from "../../src/config/effective-config.ts";
import { loadConfig } from "../../src/config/load.ts";
import type { BuildOutput } from "../../src/contracts/build-output.ts";
import type { EnvelopeBase } from "../../src/contracts/envelope-base.ts";
import { INIT_OUTPUT_SCHEMA_ID } from "../../src/contracts/init-output.ts";
import { parseEnvelope } from "../../src/contracts/parse-envelope.ts";
import type { PlanOutput } from "../../src/contracts/plan-output.ts";
import { PROJECT_REGISTER_OUTPUT_SCHEMA_ID } from "../../src/contracts/project-register-output.ts";
import { PUBLISH_OUTPUT_SCHEMA_ID, type PublishOutput } from "../../src/contracts/publish-output.ts";
import { ENVELOPE_SCHEMAS, schemaForId, type EnvelopeSchemaId } from "../../src/contracts/registry.ts";
import type { StoredEnvelope } from "../../src/contracts/stored-envelope.ts";
import type { GitResult } from "../../src/git/changes.ts";
import { envelopesForPhase, phasesForSession, type EnvelopeRow, type PhaseRow } from "../../src/observability/queries.ts";
import { openDatabase } from "../../src/observability/sqlite.ts";
import { defaultWorktreeRoot } from "../../src/persistence/platform-paths.ts";
import { matchesPathGlob } from "../../src/policy/path-policy.ts";
import { STAGES, STAGE_ORDER, type StageId } from "../../src/stages/contract.ts";
import {
  CannedStubAdapter,
  RouteLog,
  design,
  fakeBroker,
  fixtureConfig,
  git,
  installPrompts,
  plan,
  prepareTask,
  review,
} from "../unit/cli/_offline-route.ts";

const SLUG = "five-stage-journey";
const REPOSITORY_ID = "canonical";
const PLAN_STEM = "five-stage-plan";
const BUILD_TASK = "five-stage-build";
const BUILT_FILE = "core/src/generated.ts";
const BRANCH = "published";
const ROLES = ["designer", "architecture-reviewer", "planner", "builder"] as const;
const PLAN_REQUEST = "Make design claims traceable into rendered tickets.";
const BUILD_REQUEST = "Write one bounded source file the host can gate.";
const REPOSITORY_ROOT = join(import.meta.dirname, "..", "..", "..");
const W11_PLAN = "specs/awsf-v2-w11-five-stage-ladder.html";
const FIXTURE_ROOT = join(REPOSITORY_ROOT, "core", "test", "fixtures", "stages");

/**
 * The schema ids W05 registered for the three stages that run without a session.
 *
 * W11 registered none of them — `INV-2` forbade it, T04 routed them instead, and
 * W05's M8 landed all three. Naming them here rather than in
 * `core/src/stages/contract.ts` keeps that ownership visible: the contract
 * records what the M1 capture measured against the thirteen ids that existed
 * then, and this table records what the routed request returned.
 */
const ROUTED_SCHEMA_IDS: Readonly<Partial<Record<StageId, EnvelopeSchemaId>>> = {
  "init": INIT_OUTPUT_SCHEMA_ID,
  "project-register": PROJECT_REGISTER_OUTPUT_SCHEMA_ID,
  "publish": PUBLISH_OUTPUT_SCHEMA_ID,
};

const NETWORK_MODULES = new Set([
  "node:dgram", "node:dns", "node:http", "node:http2", "node:https", "node:net", "node:tls", "undici",
]);
const NETWORK_CALLS = new Set([
  "connect", "createConnection", "createServer", "createSocket", "fetch", "get", "listen", "lookup", "request",
  "resolve", "resolve4", "resolve6", "resolveAny", "reverse", "WebSocket", "XMLHttpRequest",
]);

/** No inherited Git configuration reaches the publication remote. */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process["env"],
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function isolatedGit(repository: string): (argv: readonly string[]) => GitResult {
  return (argv) => {
    const result = spawnSync("git", ["-C", repository, ...argv], { encoding: "utf8", env: GIT_ENV });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error?.message ?? null,
    };
  };
}

function commit(repository: string, message: string, ...paths: string[]): string {
  git(repository, "add", ...paths);
  git(
    repository,
    "-c", "user.name=Santiago Marin",
    "-c", "user.email=santiagomarinsuarez@me.com",
    "commit", "-m", message,
  );
  return git(repository, "rev-parse", "HEAD");
}

function remoteSha(bare: string, branch: string): string | null {
  const output = execFileSync("git", ["ls-remote", bare, `refs/heads/${branch}`], { encoding: "utf8", env: GIT_ENV });
  return /^([0-9a-f]{40})\s/u.exec(output)?.[1] ?? null;
}

/** Every configured URL is an absolute local path beneath this journey's root. */
function assertRemotesStayUnder(root: string, repository: string): void {
  const names = git(repository, "remote").split("\n").filter(Boolean);
  const urls = names.flatMap((name) => git(repository, "remote", "get-url", "--all", name).split("\n").filter(Boolean));
  assert.deepEqual(names, ["origin"]);
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.equal(isAbsolute(url), true, `${url} is not a local absolute path`);
    assert.equal(relative(root, url).startsWith(".."), false, `${url} escapes ${root}`);
  }
}

function repositorySnapshot(root: string, directory = root, snapshot = new Map<string, string>()): ReadonlyMap<string, string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      repositorySnapshot(root, path, snapshot);
    } else if (entry.isFile()) {
      snapshot.set(relative(root, path), readFileSync(path).toString("base64"));
    }
  }
  return snapshot;
}

function noNetworkOffenders(): readonly string[] {
  const path = import.meta.filename;
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const offenders: string[] = [];
  const lineOf = (node: ts.Node): string => String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
  const calledName = (expression: ts.Expression): string | null => {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return null;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)
      && NETWORK_MODULES.has(node.moduleSpecifier.text)) {
      offenders.push(`${path}:${lineOf(node)} imports ${node.moduleSpecifier.text}`);
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = calledName(node.expression);
      if (name !== null && NETWORK_CALLS.has(name)) offenders.push(`${path}:${lineOf(node)} calls ${name}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return offenders.sort();
}

function workstreamChangedFiles(): readonly string[] {
  const introduced = execFileSync(
    "git",
    ["log", "--diff-filter=A", "--format=%H", "--reverse", "--", W11_PLAN],
    { cwd: REPOSITORY_ROOT, encoding: "utf8", env: GIT_ENV },
  ).trim().split("\n").filter(Boolean);
  assert.equal(introduced.length, 1, `${W11_PLAN} must have one introducing commit`);
  const completed = execFileSync(
    "git",
    ["log", "-1", "--format=%H", "--", W11_PLAN],
    { cwd: REPOSITORY_ROOT, encoding: "utf8", env: GIT_ENV },
  ).trim();
  assert.notEqual(completed, "", `${W11_PLAN} has no completion-side commit`);
  return execFileSync(
    "git",
    ["diff", "--name-only", `${introduced[0]}^`, completed, "--"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8", env: GIT_ENV },
  ).trim().split("\n").filter(Boolean).sort();
}

// ---- The envelope join, and the two boundaries that have nothing to join ----

interface BoundaryRow {
  readonly earlierStage: StageId;
  readonly laterStage: StageId;
  readonly mechanism: "terminal-seal" | "awaiting-owner" | "no-path";
  readonly ownerAct: string;
  readonly confirmation: Record<string, unknown>;
}

const BOUNDARIES = (JSON.parse(readFileSync(join(FIXTURE_ROOT, "boundaries.json"), "utf8")) as {
  boundaries: BoundaryRow[];
}).boundaries;

function stageRecord(stage: StageId): (typeof STAGES)[number] {
  const found = STAGES.find((candidate) => candidate.id === stage);
  assert.notEqual(found, undefined, `${stage} is not a captured stage`);
  return found!;
}

/** The one registered schema id this stage's output validates against. */
function schemaIdFor(stage: StageId): EnvelopeSchemaId {
  const record = stageRecord(stage);
  const id = record.blocked ? ROUTED_SCHEMA_IDS[stage] : record.schemaId;
  assert.notEqual(id, undefined, `${stage} names no schema id`);
  assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, id!), true, `${id} is not registered`);
  return id!;
}

function requiredFieldsOf(schemaId: EnvelopeSchemaId): readonly string[] {
  const required = (schemaForId(schemaId) as { required?: readonly string[] }).required ?? [];
  assert.ok(required.length > 0, `${schemaId} declares no required field`);
  return [...required].sort();
}

interface StageCapture {
  readonly stage: string;
  readonly output: Record<string, unknown>;
}

/**
 * What M1's capture recorded as this stage's output.
 *
 * A stage that ran with no session recorded the command result itself. A stage
 * that ran inside one recorded its attempt's stored envelopes, of which exactly
 * one carries the schema id the stage's record names.
 */
function capturedOutput(stage: StageId, schemaId: EnvelopeSchemaId): Record<string, unknown> {
  const file = join(FIXTURE_ROOT, `S${stageRecord(stage).ordinal}.json`);
  const capture = JSON.parse(readFileSync(file, "utf8")) as StageCapture;
  assert.equal(capture.stage, `S${stageRecord(stage).ordinal}`, `${file} is not stage ${stage}`);
  const stored = capture.output["storedEnvelopes"];
  if (stored === undefined) return capture.output;
  const matching = Object.values(stored as Record<string, string>)
    .map((bytes) => JSON.parse(bytes) as StoredEnvelope<EnvelopeBase>)
    .filter((envelope) => envelope.schemaId === schemaId);
  assert.equal(matching.length, 1, `${file} must carry exactly one captured ${schemaId} envelope`);
  assert.notEqual(matching[0]!.payload, null, `${file}'s captured ${schemaId} envelope is invalid`);
  return matching[0]!.payload as unknown as Record<string, unknown>;
}

/**
 * The typed-shape half of the join, for every stage.
 *
 * BY SHAPE, NEVER BYTES. The capture is one run's output, so only its field set
 * travels into this assertion; comparing its values would make the journey a
 * snapshot of a scripted adapter and prove nothing about the join.
 */
function assertStageShape(stage: StageId, produced: Record<string, unknown>): void {
  const schemaId = schemaIdFor(stage);
  assert.equal(produced["schema"], schemaId, `${stage} declares a schema id its record does not name`);
  const parsed = parseEnvelope(JSON.stringify(produced), schemaId);
  assert.deepEqual(parsed.valid ? [] : parsed.violations, [], `${stage} does not validate against ${schemaId}`);
  assert.deepEqual(
    requiredFieldsOf(schemaId).filter((field) => !Object.hasOwn(produced, field)),
    [],
    `${stage} is missing a field ${schemaId} requires`,
  );
  assert.deepEqual(
    Object.keys(capturedOutput(stage, schemaId)).sort().filter((field) => !Object.hasOwn(produced, field)),
    [],
    `${stage} dropped a field its capture recorded`,
  );
}

/** The stored envelope this session holds for one stage, read through the projection. */
function storedStageEnvelope(
  db: ReturnType<typeof openDatabase>,
  sessionId: string,
  stage: StageId,
): { readonly phase: PhaseRow; readonly row: EnvelopeRow } {
  const schemaId = schemaIdFor(stage);
  const found = phasesForSession(db, sessionId).flatMap((phase) =>
    envelopesForPhase(db, sessionId, phase.phase_id)
      .filter((row) => row.schema_id === schemaId)
      .map((row) => ({ phase, row })));
  assert.equal(found.length, 1, `session ${sessionId} must store exactly one ${schemaId} envelope for ${stage}`);
  assert.equal(found[0]!.row.valid, 1, `${stage}'s stored envelope is invalid`);
  return found[0]!;
}

/** Every path under the state root, so an absence can be stated exhaustively. */
function stateRootPaths(stateRoot: string): readonly string[] {
  if (!existsSync(stateRoot)) return [];
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(stateRoot, path));
    }
  };
  walk(stateRoot);
  return found.sort();
}

function stringValues(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) stringValues(item, into);
  else if (value !== null && typeof value === "object") for (const item of Object.values(value)) stringValues(item, into);
  return into;
}

/**
 * A boundary where no session exists, so no envelope-derived advance can.
 *
 * Under W05's Q7 the earlier stage's envelope is a validated return value stored
 * nowhere, and the run recorded the boundary as `no-path`: no task, no session,
 * no attempt directory and no lifecycle, so `LEGAL_EDGES` supplies nothing to
 * advance and there is no earlier stored envelope for the later stage to derive
 * from. `ownerSupplied` is the list of inputs the later stage requires that the
 * owner therefore has to author — none of which the earlier envelope carries.
 */
function assertOwnerHeldBoundary(
  earlierStage: StageId,
  produced: Record<string, unknown>,
  world: { readonly stateRoot: string; readonly log: RouteLog; readonly expectedStatePaths: readonly string[] },
  ownerSupplied: readonly string[],
): void {
  const row = BOUNDARIES.find((candidate) => candidate.earlierStage === earlierStage);
  assert.notEqual(row, undefined, `boundaries.json records no boundary after ${earlierStage}`);
  assert.equal(row!.mechanism, "no-path", `${earlierStage} is not held by no-path`);
  assert.equal(row!.confirmation["observedTaskState"], null, `${earlierStage} claims no-path but recorded a task state`);
  assert.equal(row!.confirmation["hostCommandThatReturns"], stageRecord(earlierStage).producer);
  assert.ok(row!.ownerAct.length > 0, `${earlierStage}'s boundary names no owner act`);

  // The absence, stated exhaustively rather than as a count: no journal exists,
  // so no session row and no envelope row do either, and no attempt directory
  // and no provider launch appeared while the boundary was open.
  assert.deepEqual(stateRootPaths(world.stateRoot), [...world.expectedStatePaths].sort(), `${earlierStage} left state behind`);
  assert.equal(existsSync(join(world.stateRoot, "awsf.db")), false, `${earlierStage} left a journal behind`);
  assert.deepEqual(world.log.launches, [], `${earlierStage} launched a provider across its boundary`);

  // The later stage's inputs are the owner's, not the earlier envelope's.
  const carried = stringValues(produced);
  assert.deepEqual(
    ownerSupplied.filter((value) => carried.includes(value)),
    [],
    `${earlierStage}'s envelope already carries an input the owner must supply`,
  );
}

function catalog(defaultBranch: string): string {
  return [
    "version: awsf.project/v1",
    "",
    "project:",
    `  slug: ${SLUG}`,
    "",
    "repositories:",
    `  ${REPOSITORY_ID}:`,
    "    role: plan",
    `    default_branch: ${defaultBranch}`,
    "    gates: {}",
    "    publish:",
    "      remotes: [origin]",
    `      branches: [${BRANCH}]`,
    "",
    "plans:",
    "  root: specs",
    "  format: awsf-plan-html/v1",
    `  default: ${PLAN_STEM}`,
    "",
  ].join("\n");
}

function buildPlan(): PlanOutput {
  return {
    schema: "awsf.plan-output/v1",
    producerStatus: "success",
    summary: "Write one bounded source.",
    artifacts: [],
    notesForNextPhase: `Write ${BUILT_FILE}.`,
    goals: ["Write one source file."],
    nonGoals: ["Touch anything else."],
    implementationSteps: [{
      id: "one",
      title: "Write the source file",
      files: [BUILT_FILE],
      acceptanceCriteria: ["The host records the candidate."],
    }],
    testStrategy: ["Run the configured host commands."],
    risks: [],
    openQuestions: [],
  };
}

function buildOutput(): BuildOutput {
  return {
    schema: "awsf.build-output/v1",
    producerStatus: "success",
    summary: "Wrote one bounded source.",
    artifacts: [{ path: BUILT_FILE, kind: "source", description: "Bounded source." }],
    notesForNextPhase: "Run host gates.",
    changedFiles: [BUILT_FILE],
    implementationNotes: ["Scripted fixture implementation."],
    commandsRun: [],
    proposedCommitMessage: "feat: add generated source",
  };
}

function terminal(lines: string[]): OwnerTerminal {
  return {
    interactive: true,
    write: (line) => { lines.push(line); },
    confirm: async () => true,
  };
}

/** Applies a scripted build envelope's claimed diff, so the host has one to capture. */
function applyBuild(worktree: string): (response: EnvelopeBase) => void {
  return (response) => {
    if (response.schema !== "awsf.build-output/v1") return;
    for (const path of (response as BuildOutput).changedFiles) {
      const target = join(worktree, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, "export const generated = true;\n");
    }
  };
}

test("the five-stage journey imports no networking API or socket-opening call", () => {
  assert.deepEqual(noNetworkOffenders(), []);
});

test("the W11 changed-file list touches no protected path from the loaded config", () => {
  const config = loadConfig(readFileSync(join(REPOSITORY_ROOT, "awsf.config.yaml"), "utf8"));
  const changed = workstreamChangedFiles();
  assert.ok(changed.length > 0, "the W11 changed-file list is empty");
  const offenders = changed.flatMap((path) => config.policy.protected_paths
    .filter((glob) => matchesPathGlob(path, glob))
    .map((glob) => `${path} matches ${glob}`));
  assert.deepEqual(offenders, []);
});

test("a throwaway project travels all five captured stages on the stub route without a provider or a network", async () => {
  const repositoryBefore = repositorySnapshot(REPOSITORY_ROOT);
  const root = mkdtempSync(join(tmpdir(), "awsf-five-stage-"));
  const canonical = join(root, "canonical");
  const stateRoot = join(root, "state");
  const worktreeRoot = defaultWorktreeRoot(stateRoot);
  const bare = join(root, "remote.git");
  const sideEffect = join(root, "provider-process-ran.json");
  const log = new RouteLog();
  const travelled: StageId[] = [];
  const lines: string[] = [];
  let projection: ReturnType<typeof createDashboardProjection> | null = null;

  try {
    // ---- Stage 1 · init ---------------------------------------------------
    // The journey starts with no repository at all: `canonical` does not exist.
    assert.equal(existsSync(canonical), false);
    const initialized = await initCommand({ path: canonical, slug: SLUG });
    travelled.push("init");

    assert.equal(initialized.path, canonical);
    assert.match(initialized.commitSha, /^[0-9a-f]{40}$/u);
    assert.deepEqual(
      git(canonical, "show", "--name-only", "--pretty=format:", initialized.commitSha).split("\n").filter(Boolean),
      ["awsf.config.yaml"],
      "S1 commits its minimal configuration and nothing else",
    );
    // S1's captured observation: no state root, so no session and no attempt.
    assert.equal(existsSync(stateRoot), false);
    const defaultBranch = git(canonical, "rev-parse", "--abbrev-ref", "HEAD");

    // The publication remote is a bare repository inside this temporary
    // directory. It is the only remote this journey ever knows.
    execFileSync("git", ["init", "--bare", bare], { stdio: "ignore", env: GIT_ENV });
    git(canonical, "remote", "add", "origin", bare);
    assertRemotesStayUnder(root, canonical);

    // ---- Boundary S1 -> S2 · owner act ------------------------------------
    // `awsf init` writes no catalog and, per W05's Q7, stores no envelope. The
    // owner authors and commits one, and the two inputs `awsf project register`
    // requires are values this test supplies rather than values S1 produced.
    const catalogPath = join(canonical, "awsf.project.yaml");
    const catalogBytes = catalog(defaultBranch);
    const repositoryArgument = `${REPOSITORY_ID}=${canonical}`;
    assert.equal(existsSync(catalogPath), false, "S1 wrote no catalog for S2 to read");
    assertOwnerHeldBoundary(
      "init",
      initialized as unknown as Record<string, unknown>,
      { stateRoot, log, expectedStatePaths: [] },
      [catalogPath, catalogBytes, repositoryArgument],
    );
    writeFileSync(catalogPath, catalogBytes);
    commit(canonical, "chore: declare the project catalog", "awsf.project.yaml");

    // ---- Stage 2 · project register ---------------------------------------
    const registered = await registerProject({
      stateRoot,
      catalogPath,
      repositories: [repositoryArgument],
    });
    travelled.push("project-register");

    assert.equal(registered.resolvedProject.slug, SLUG);
    assert.equal(registered.resolvedProject.repositories[REPOSITORY_ID]?.path, canonical);
    assert.equal(registered.resolvedProject.repositories[REPOSITORY_ID]?.worktreeRoot, worktreeRoot);
    assert.equal(existsSync(join(stateRoot, "projects", SLUG, "placement.yaml")), true);
    // S2's captured observation: a placement and nothing else under the state root.
    assert.deepEqual(readdirSync(stateRoot), ["projects"]);

    // ---- Boundary S2 -> S3 · owner act ------------------------------------
    // The configuration `awsf init` wrote enables only `intake` and declares no
    // agent, and `awsf project register` stores no envelope either. The owner
    // replaces the configuration and supplies the role prompts; every name S3
    // needs arrives that way rather than out of S2's return value.
    const config = fixtureConfig({ slug: SLUG, roles: ROLES });
    const configPath = join(canonical, "awsf.config.yaml");
    const configBytes = stringify(config);
    assertOwnerHeldBoundary(
      "project-register",
      registered as unknown as Record<string, unknown>,
      { stateRoot, log, expectedStatePaths: [join("projects", SLUG, "placement.yaml")] },
      [configBytes, ...ROLES, "design-to-plan"],
    );
    writeFileSync(configPath, configBytes);
    installPrompts(canonical, ROLES);
    commit(canonical, "chore: configure the stub route and its prompts", "awsf.config.yaml", "prompts");

    projection = createDashboardProjection(stateRoot);
    const configSnapshotJson = toConfigSnapshotJson(config);

    // ---- Stage 3 · design-to-plan -----------------------------------------
    const planTask = await prepareTask({
      stateRoot,
      project: SLUG,
      taskId: PLAN_STEM,
      repository: canonical,
      request: PLAN_REQUEST,
      workflow: "design-to-plan",
      tier: 1,
      worktreeRoot,
      configPath,
      configSnapshotJson,
      projectRecord: projection.project,
    });
    const planAdapter = new CannedStubAdapter({
      sideEffectPath: sideEffect,
      responses: [design(), review(false), plan()],
      log,
    });
    const planned = await runProductionCommand({
      attemptDir: planTask.attemptDir,
      stateRoot,
      config,
      configPath,
      projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement,
      assertLaunchProjection: projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: () => planAdapter,
        createBroker: fakeBroker,
        resolveExecutable: () => { throw new Error("quota probe unavailable in this offline journey"); },
        sandboxProbe: () => false,
      },
    });
    travelled.push("design-to-plan");

    assert.equal(planned.lifecycleState, "AWAITING_OWNER", planned.blocker?.detail);
    assert.equal(planned.budget.callsSpent, 3);
    assert.equal(planned.budget.callsReserved, 0);
    assert.equal(planAdapter.responsesRemaining, 0);
    for (const document of [
      join("specs", `${PLAN_STEM}.html`),
      join("specs", `${PLAN_STEM}-build-prompts.md`),
      join("specs", "tickets", PLAN_STEM, "T01.md"),
    ]) {
      assert.equal(existsSync(join(planTask.worktree, document)), true, `${document} was not rendered`);
    }

    // ---- Boundary S3 -> S4 · owner act ------------------------------------
    const landedPlan = await landCommand({
      attemptDir: planTask.attemptDir,
      terminal: terminal(lines),
      projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement,
    });
    assert.equal(landedPlan.status.lifecycleState, "LANDED");
    assert.equal(git(canonical, "rev-parse", "HEAD"), planned.candidateSha);
    assert.equal(
      existsSync(join(canonical, "specs", `${PLAN_STEM}.html`)),
      true,
      "S4's entry precondition: the rendered plan set is on the default branch",
    );

    // ---- Stage 4 · build ---------------------------------------------------
    const buildTask = await prepareTask({
      stateRoot,
      project: SLUG,
      taskId: BUILD_TASK,
      repository: canonical,
      request: BUILD_REQUEST,
      workflow: "plan-build-test",
      tier: 1,
      worktreeRoot,
      configPath,
      configSnapshotJson,
      projectRecord: projection.project,
    });
    const buildAdapter = new CannedStubAdapter({
      sideEffectPath: sideEffect,
      responses: [buildPlan(), buildOutput()],
      log,
      onResponse: applyBuild(buildTask.worktree),
    });
    const built = await runProductionCommand({
      attemptDir: buildTask.attemptDir,
      stateRoot,
      config,
      configPath,
      projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement,
      assertLaunchProjection: projection.assertLaunchPermitted,
      infrastructure: {
        adapterFor: () => buildAdapter,
        createBroker: fakeBroker,
        resolveExecutable: () => { throw new Error("quota probe unavailable in this offline journey"); },
        sandboxProbe: () => false,
      },
    });
    travelled.push("build");

    assert.equal(built.lifecycleState, "AWAITING_OWNER", built.blocker?.detail);
    assert.equal(built.budget.callsSpent, 2);
    assert.equal(built.budget.callsReserved, 0);
    assert.equal(buildAdapter.responsesRemaining, 0);
    assert.equal(existsSync(join(buildTask.worktree, BUILT_FILE)), true);

    // ---- Boundary S4 -> S5 · owner act ------------------------------------
    const landedBuild = await landCommand({
      attemptDir: buildTask.attemptDir,
      terminal: terminal(lines),
      projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement,
    });
    assert.equal(landedBuild.status.lifecycleState, "LANDED");
    assert.equal(git(canonical, "rev-parse", "HEAD"), built.candidateSha);
    assert.equal(git(canonical, "status", "--porcelain"), "", "S5's entry precondition: a clean checkout at the candidate");

    // ---- Stage 5 · publish -------------------------------------------------
    assert.equal(remoteSha(bare, BRANCH), null);
    const published = await publishCommand({
      attemptDir: buildTask.attemptDir,
      stateRoot,
      terminal: terminal(lines),
      projectRecord: projection.project,
      assertAdvancement: projection.assertAdvancement,
      gitRunner: isolatedGit(canonical),
    });
    travelled.push("publish");

    assert.equal(published.outcome, "published", JSON.stringify(published));
    if (published.outcome !== "published") throw new Error("the ladder did not reach publication");
    assert.equal(published.status.lifecycleState, "PUBLISHED");
    assert.equal(remoteSha(bare, BRANCH), built.candidateSha);
    assert.equal((await readAttempt(buildTask.attemptDir)).lifecycleState, "PUBLISHED");
    assert.ok(lines.includes(`Revision: ${built.candidateSha!}`));
    assert.ok(lines.includes("Remote: origin"));
    assert.ok(lines.includes(`Branch: ${BRANCH}`));

    // ---- The ladder, and what it cost --------------------------------------
    assert.deepEqual(travelled, [...STAGE_ORDER], "every captured stage travelled, in the captured order");
    // The route log, not a count: every contact this journey made was the stub. The number of
    // scripted calls is already pinned by each adapter's `responsesRemaining`, so this row asserts
    // the set of providers contacted, which is what "no launch beyond the stub" actually means.
    assert.ok(log.providers.length > 0, "the route log recorded no contact at all");
    assert.deepEqual([...new Set(log.providers)], ["stub"], "no provider beyond the scripted stub was contacted");
    assert.deepEqual(log.launches, log.providers, "no launch happened that the route did not record");
    assert.equal(existsSync(sideEffect), false, "the fixture provider process must never run");
    assertRemotesStayUnder(root, canonical);

    const db = openDatabase(join(stateRoot, "awsf.db"), { readonly: true });
    try {
      assert.deepEqual(phasesForSession(db, planTask.sessionId).map((phase) => [phase.phase_key, phase.status]), [
        ["request", "SUCCEEDED"],
        ["design-context", "SUCCEEDED"],
        ["design", "SUCCEEDED"],
        ["architecture-review", "SUCCEEDED"],
        ["plan-context", "SUCCEEDED"],
        ["plan", "SUCCEEDED"],
        ["plan-render", "SUCCEEDED"],
      ]);
      assert.deepEqual(phasesForSession(db, buildTask.sessionId).map((phase) => [phase.phase_key, phase.status]), [
        ["request", "SUCCEEDED"],
        ["planner", "SUCCEEDED"],
        ["builder", "SUCCEEDED"],
        ["tests", "SUCCEEDED"],
        ["publish", "SUCCEEDED"],
      ]);

      // ---- The envelope join, stage by stage -------------------------------
      // Typed shape for all five. S1 and S2 are the validated return values the
      // commands handed back, because Q7 stores neither; S3, S4 and S5 come out
      // of the projection, because each ran inside a session that holds one.
      assertStageShape("init", initialized as unknown as Record<string, unknown>);
      assertStageShape("project-register", registered as unknown as Record<string, unknown>);

      const planRender = storedStageEnvelope(db, planTask.sessionId, "design-to-plan");
      assertStageShape("design-to-plan", JSON.parse(planRender.row.payload_json) as Record<string, unknown>);

      const tests = storedStageEnvelope(db, buildTask.sessionId, "build");
      assertStageShape("build", JSON.parse(tests.row.payload_json) as Record<string, unknown>);

      const publication = storedStageEnvelope(db, buildTask.sessionId, "publish");
      assertStageShape("publish", JSON.parse(publication.row.payload_json) as Record<string, unknown>);

      // ---- Boundary S4 -> S5, the one M8 made projection-observable --------
      // S4 and S5 share the attempt's session, so the publication envelope is
      // reachable by the same session id the build stage stored its own under,
      // and it names the exact revision S4 produced. This is stored evidence of
      // the boundary, not derivation across it: `awsf land` and `awsf publish`
      // are both owner acts this test performs.
      assert.equal(publication.phase.session_id, tests.phase.session_id, "S4 and S5 are not the same attempt");
      assert.ok(publication.phase.ordinal > tests.phase.ordinal, "S5's phase does not follow S4's");
      assert.equal(publication.row.schema_id, schemaIdFor("publish"));
      const publicationPayload = JSON.parse(publication.row.payload_json) as PublishOutput;
      assert.equal(publicationPayload.result.status.candidateSha, built.candidateSha);
      assert.equal(publicationPayload.result.status.lifecycleState, "PUBLISHED");
      assert.equal(publicationPayload.result.status.sessionId, buildTask.sessionId);
    } finally {
      db.close();
    }
  } finally {
    projection?.close();
    rmSync(root, { recursive: true, force: true });
  }
  // No residue: the state root was beneath the temporary root, and neither
  // survives cleanup. The repository snapshot catches any accidental write to
  // this checkout while the journey ran.
  assert.equal(relative(root, stateRoot).startsWith(".."), false, "the state root escaped the temporary directory");
  assert.equal(existsSync(root), false);
  assert.equal(existsSync(stateRoot), false);
  assert.deepEqual(repositorySnapshot(REPOSITORY_ROOT), repositoryBefore, "the journey wrote inside this repository");
});
