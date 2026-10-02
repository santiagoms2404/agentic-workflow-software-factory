import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  Availability,
  BrokerProcessRegistration,
  HarnessAdapter,
  ModelInfo,
  ModelRequest,
  ProcessSpec,
  ProcessTransport,
  TransportBroker,
} from "../../src/adapters/interface.ts";
import { isTaskEdgeRegistration, reservationIdOf } from "../../src/adapters/interface.ts";
import { loadConfig } from "../../src/config/load.ts";
import { assertProvingGroundItem, provingGroundItemDigest, type ReplayRecord, type ReviewItem } from "../../src/contracts/proving-ground.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { ReviewFinding, ReviewOutput } from "../../src/contracts/review-output.ts";
import type { BrokerOptions } from "../../src/execution/transport-broker.ts";
import { PROVING_GROUND_DIR } from "../../src/workflow/prove/bind.ts";

// The W18 replay harness, shared by the task 12 runner tests
// (`prove-run.test.ts`) and the task 14 journey (`journeys/prove-replay.test.ts`):
// a two-commit canonical repository whose corpus postdates its base, the
// shipped config (which enables `prove` since gate G18-B) cut to one offline
// gate, a review adapter that is the only route a replay launches, and a broker
// that spends on GO. No provider is called.
//
// A replay's agent runs only under worktree confinement (task 18), so the
// runners pass `hasBwrap` as their sandbox probe and the descriptor the fixture
// broker records is the confined one; nothing is spawned.

/** The sandbox probe of a host with bwrap. */
export const hasBwrap = (executable: string): boolean => executable === "bwrap";

/**
 * Asserts a recorded launch is `worktree`-confined: bwrap with no bind of the
 * host root, the canonical checkout or the state root.
 */
export function assertConfinedLaunch(command: readonly string[], canonical: string, stateRoot: string): void {
  assert.equal(command[0], "bwrap");
  const argv = command.slice(1, command.indexOf("--"));
  for (let at = 0; at < argv.length; at += 1) {
    if (argv[at] !== "--ro-bind" && argv[at] !== "--bind") continue;
    const source = argv[at + 1]!;
    assert.notEqual(source, "/", "the host root is bound");
    assert.ok(!source.startsWith(canonical), `the canonical checkout is bound: ${source}`);
    assert.ok(!`${stateRoot}/`.startsWith(`${source}/`), `the state root is exposed by ${source}`);
  }
}

const OWNER = ["-c", "user.name=Santiago Marin", "-c", "user.email=santiagomarinsuarez@me.com"];
export const ITEM_ID = "probe-01";
export const REQUEST = "Report the probe's second line.";
const PATCH = "diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n base\n+seeded\n";
const GATE = ["-e", "process.exit(0)"] as const;

export function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

/** The shipped config, cut to one offline gate. */
function configText(): string {
  return readFileSync(resolve("awsf.config.yaml"), "utf8")
    .replaceAll("interrupted_turn: true", "interrupted_turn: false")
    .replace("  seed_paths: [node_modules]", "  seed_paths: []")
    .replace("test: { argv: [npm, run, test:unit], timeout_seconds: 600 }", `test: { argv: [node, ${GATE[0]}, ${GATE[1]}], timeout_seconds: 10 }`)
    .replace("  typecheck: { argv: [npm, run, typecheck], timeout_seconds: 300 }\n", "")
    .replace("  lint: { argv: [npm, run, lint], timeout_seconds: 300 }\n", "")
    .replace("  journeys: { argv: [npm, run, test:journeys], timeout_seconds: 2400 }\n", "");
}

/** A synthetic item authored against this repository's base, not the AWSF corpus (T14 C2). */
export function world(label: string) {
  const root = mkdtempSync(join(tmpdir(), `awsf-${label}-`));
  const canonical = join(root, "canonical");
  execFileSync("git", ["init", "-q", "-b", "main", canonical]);
  writeFileSync(join(canonical, "README.md"), "base\n");
  git(canonical, "add", ".");
  git(canonical, ...OWNER, "commit", "-q", "-m", "base");
  const baseSha = git(canonical, "rev-parse", "HEAD");
  // The corpus postdates the base, so the replay's worktree cannot hold it.
  const item: ReviewItem = {
    schema: "awsf.proving-ground-item/v1", id: ITEM_ID, kind: "review", taskClass: "evidence-heavy-defect-review",
    role: "reviewer", baseSha, request: REQUEST,
    seed: { patch: `${PROVING_GROUND_DIR}/${ITEM_ID}.patch`, defectClass: "off-by-one", expected: [{ file: "README.md", lineStart: 2, lineEnd: 2 }] },
  };
  assertProvingGroundItem(item);
  mkdirSync(join(canonical, PROVING_GROUND_DIR), { recursive: true });
  writeFileSync(join(canonical, PROVING_GROUND_DIR, `${ITEM_ID}.json`), `${JSON.stringify(item, null, 2)}\n`);
  writeFileSync(join(canonical, item.seed.patch), PATCH);
  git(canonical, "add", ".");
  git(canonical, ...OWNER, "commit", "-q", "-m", "corpus");

  const configPath = join(root, "awsf.config.yaml");
  writeFileSync(configPath, configText());
  const config = loadConfig(configText());
  assert.ok(config.workflows.enabled.includes("prove"), "the committed config enables prove (gate G18-B)");
  for (const agent of config.agents) {
    for (const promptPath of [agent.prompt.system, agent.prompt.user]) {
      mkdirSync(resolve(join(root, promptPath), ".."), { recursive: true });
      writeFileSync(join(root, promptPath), readFileSync(resolve(promptPath), "utf8"));
    }
  }
  mkdirSync(join(root, "prompts", "shared"), { recursive: true });
  writeFileSync(join(root, "prompts/shared/headless-role.md"), readFileSync(resolve("prompts/shared/headless-role.md"), "utf8"));
  const replay: ReplayRecord = {
    itemId: item.id, itemDigest: provingGroundItemDigest(item, new Uint8Array(Buffer.from(PATCH))),
    arm: "claude/anthropic/claude:opus@high", repetition: 1, order: 1, baseSha,
  };
  return { root, canonical, stateRoot: join(root, "state"), worktreeRoot: join(root, "worktrees"), config, configPath, baseSha, item, replay };
}

export type World = ReturnType<typeof world>;

function review(worktree: string, findings: readonly ReviewFinding[]): ReviewOutput {
  return {
    schema: "awsf.review-output/v1", producerStatus: "success", summary: "reviewed the seeded candidate",
    artifacts: [], notesForNextPhase: "The owner reads the findings.", verdict: findings.length === 0 ? "accept" : "concern",
    reviewedSha: git(worktree, "rev-parse", "HEAD"), findings: [...findings],
    limitations: [{ detail: "Scripted offline review.", affectedFiles: [] }],
  };
}

/** The review route. Any other launch is a defect: a seeded replay builds nothing. */
export class ReviewAdapter implements HarnessAdapter {
  readonly id: string;
  readonly #provider: string;
  readonly #worktree: () => string;
  readonly #launches: string[];
  readonly #findings: readonly ReviewFinding[];
  constructor(id: string, worktree: () => string, launches: string[], findings: readonly ReviewFinding[] = []) {
    this.id = id; this.#worktree = worktree; this.#launches = launches; this.#findings = findings;
    this.#provider = id === "claude" ? "anthropic" : "openai-codex";
  }
  async isAvailable(): Promise<Availability> { return { status: "available" }; }
  async getModelInfo(model: string): Promise<ModelInfo> {
    return { adapter: this.id, provider: this.#provider, requestedModel: model, contextWindow: null,
      supportsThinking: true, supportsTools: true, supportsImages: false, continuity: "none", usageAuthority: "provider", costAuthority: "unavailable" };
  }
  buildSpec(request: ModelRequest): ProcessSpec {
    return { executable: "node", argv: ["-e", ""], cwd: request.cwd, env: request.env, stdin: request.prompt, shell: false };
  }
  async *parse(_transport: ProcessTransport): AsyncIterable<NormalizedEvent> { yield* []; }
  async *execute(request: ModelRequest, broker: TransportBroker, registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2]): AsyncIterable<NormalizedEvent> {
    await broker.startProcess(registration, this.buildSpec(request), signal);
    assert.ok(request.prompt.includes("awsf.review-output/v1"), "the only provider call is the review");
    this.#launches.push(`review:${this.id}:${request.model}:${String(request.effort)}`);
    // The reviewer is handed the request and the candidate, and nothing that
    // names the item, its defect or the suite (T11 C5).
    for (const leak of [ITEM_ID, "off-by-one", "proving-ground"]) assert.equal(request.prompt.includes(leak), false, leak);
    const at = "2026-09-29T00:00:00.000Z";
    yield { kind: "run.started", seq: 1, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id, requestedModel: request.model };
    yield { kind: "model.resolved", seq: 2, runId: registration.runId, hostAt: at, providerAt: null, adapter: this.id,
      provider: this.#provider, requestedModel: request.model, resolvedModel: `${request.model}-resolved`, provenance: "route-attributed" };
    yield { kind: "text.delta", seq: 3, runId: registration.runId, hostAt: at, providerAt: null, text: JSON.stringify(review(this.#worktree(), this.#findings)) };
    yield { kind: "usage", seq: 4, runId: registration.runId, hostAt: at, providerAt: null,
      usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, reasoningRelation: "included-in-output" } };
    yield { kind: "run.completed", seq: 5, runId: registration.runId, hostAt: at, providerAt: null, exitCode: 0 };
  }
}

/** Spends on GO like the real broker, and records every edge it is asked to start and, if asked, its command. */
export function countingBroker(started: string[], commands: (readonly string[])[] = []) {
  return (options: BrokerOptions): TransportBroker => ({
    async startProcess(registration, spec) {
      const record = {
        identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" },
        runId: registration.runId, edge: isTaskEdgeRegistration(registration) ? registration.edge : null,
        ...(registration.kind === "agent-phase" ? { phase: { taskSessionId: registration.taskSessionId, workflowId: registration.workflowId,
          phaseId: registration.phaseId, phaseOrdinal: registration.phaseOrdinal, adapterId: registration.adapterId, role: registration.role } } : {}),
        reservationId: reservationIdOf(registration), command: [spec.executable, ...spec.argv], cwd: spec.cwd,
      };
      if (registration.kind === "agent-phase") options.phaseLaunchVerifier?.verify(registration);
      started.push(isTaskEdgeRegistration(registration) ? `edge ${registration.edge}` : registration.kind);
      commands.push(record.command);
      await options.register(record);
      const reservation = options.ledger.spendOnGo(reservationIdOf(registration));
      await options.onSpent?.(record, reservation);
      return {
        runId: registration.runId, identity: record.identity,
        stdout: (async function* () {})(), stderr: (async function* () {})(),
        exit: Promise.resolve({ code: 0, signal: null }),
        cancel: async () => ({ termSent: false, killSent: false, survivors: [], terminated: true, skipped: null }),
      };
    },
  });
}
