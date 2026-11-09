import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertSameProviderSession,
  reservationIdOf,
  type BrokerProcessRegistration,
  type ContinuityCapableAdapter,
  type ModelInfo,
  type ModelRequest,
  type ObservedProviderSession,
  type TransportBroker,
} from "../../../src/adapters/interface.ts";
import type { BuildOutput } from "../../../src/contracts/build-output.ts";
import type { NormalizedEvent } from "../../../src/contracts/normalized-events.ts";
import { readAttempt } from "../../../src/cli/commands/attempt.ts";
import { runProductionCommand } from "../../../src/cli/commands/production-run.ts";
import { readAttemptEvidence } from "../../../src/cli/commands/review-record.ts";
import { fakeBroker } from "../../fixtures/recording-broker.ts";
import type { BrokerOptions } from "../../../src/execution/transport-broker.ts";
import { ReplayStub, box, draft, prepare, start } from "../../fixtures/trap-world.ts";

function buildOutput(): BuildOutput {
  return {
    schema: "awsf.build-output/v1",
    producerStatus: "success",
    summary: "A bounded fixture change.",
    artifacts: [],
    notesForNextPhase: "Review the candidate.",
    changedFiles: ["core/src/approved.ts"],
    implementationNotes: ["The fixture output is valid."],
    commandsRun: [],
    proposedCommitMessage: "feat: add approved fixture change",
  };
}

class CorrectionAdapter extends ReplayStub implements ContinuityCapableAdapter {
  readonly supportsSameSessionCorrection = true as const;
  readonly tranches: ("auto" | "owner")[] = [];
  readonly #answers: readonly ("invalid" | "valid")[];
  readonly #beforeOwnerLaunch: (() => Promise<void>) | undefined;
  #turn = 0;

  constructor(
    id: string,
    answers: readonly ("invalid" | "valid")[],
    beforeOwnerLaunch?: () => Promise<void>,
  ) {
    super(id);
    this.#answers = answers;
    this.#beforeOwnerLaunch = beforeOwnerLaunch;
  }

  override async getModelInfo(model: string): Promise<ModelInfo> {
    return { ...(await super.getModelInfo(model)), continuity: "same-session-correction" };
  }

  continuityStoreDir(): string | null { return null; }

  assertResumable(): { proof: "provider-refuses-unknown-session"; detail: string } {
    return { proof: "provider-refuses-unknown-session", detail: "the fixture accepts only its opened conversation" };
  }

  assertSameSession(first: ObservedProviderSession, next: ObservedProviderSession): void {
    assertSameProviderSession(this.id, first, next);
  }

  override async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
    observed?: ObservedProviderSession,
  ): AsyncIterable<NormalizedEvent> {
    const turn = this.#turn++;
    this.launches++;
    if (registration.kind === "phase-correction") {
      this.tranches.push(registration.tranche);
      if (registration.tranche === "owner") await this.#beforeOwnerLaunch?.();
    }
    const continuity = request.continuity;
    assert.ok(continuity, "the configured same-session route carries its conversation binding");
    if (observed !== undefined) {
      observed.sessionId = continuity.ref.providerSessionId;
      observed.resolvedModel = request.model;
    }
    await broker.startProcess(registration, this.buildSpec(request), signal);
    const base = { runId: registration.runId, hostAt: "2026-10-01T00:00:00.000Z", providerAt: null };
    yield { ...base, seq: 1, kind: "run.started", adapter: this.id, requestedModel: request.model };
    yield {
      ...base,
      seq: 2,
      kind: "model.resolved",
      adapter: this.id,
      provider: (await this.getModelInfo(request.model)).provider,
      requestedModel: request.model,
      resolvedModel: request.model,
      provenance: "stream-authoritative",
    };
    const answer = this.#answers[turn] ?? "invalid";
    if (answer === "valid") {
      const path = join(request.cwd, "core", "src", "approved.ts");
      mkdirSync(join(request.cwd, "core", "src"), { recursive: true });
      writeFileSync(path, "export const approved = true;\n");
      yield { ...base, seq: 3, kind: "text.delta", text: JSON.stringify(buildOutput()) };
    } else {
      yield { ...base, seq: 3, kind: "text.delta", text: "not-json" };
    }
    yield { ...base, seq: 4, kind: "run.completed", exitCode: 0 };
  }
}

class ColdCorrectionAdapter extends ReplayStub {
  readonly #answers: readonly ("invalid" | "valid")[];
  #turn = 0;

  constructor(id: string, answers: readonly ("invalid" | "valid")[]) {
    super(id);
    this.#answers = answers;
  }

  override async *execute(
    request: ModelRequest,
    broker: TransportBroker,
    registration: BrokerProcessRegistration,
    signal: Parameters<TransportBroker["startProcess"]>[2],
  ): AsyncIterable<NormalizedEvent> {
    const turn = this.#turn++;
    this.launches++;
    await broker.startProcess(registration, this.buildSpec(request), signal);
    const base = { runId: registration.runId, hostAt: "2026-10-01T00:00:00.000Z", providerAt: null };
    yield { ...base, seq: 1, kind: "run.started", adapter: this.id, requestedModel: request.model };
    yield {
      ...base,
      seq: 2,
      kind: "model.resolved",
      adapter: this.id,
      provider: (await this.getModelInfo(request.model)).provider,
      requestedModel: request.model,
      resolvedModel: request.model,
      provenance: "stream-authoritative",
    };
    if (this.#answers[turn] === "valid") {
      const path = join(request.cwd, "core", "src", "approved.ts");
      mkdirSync(join(request.cwd, "core", "src"), { recursive: true });
      writeFileSync(path, "export const approved = true;\n");
      yield { ...base, seq: 3, kind: "text.delta", text: JSON.stringify(buildOutput()) };
    } else {
      yield { ...base, seq: 3, kind: "text.delta", text: "not-json" };
    }
    yield { ...base, seq: 4, kind: "run.completed", exitCode: 0 };
  }
}

async function prepared(allowance: { auto: number; owner: number }, continuity: "same-session" | "none" = "same-session"): Promise<{
  readonly b: ReturnType<typeof box>;
  readonly attemptDir: string;
}> {
  const b = box(config => {
    const builder = config.agents.find(agent => agent.name === "builder");
    assert.ok(builder);
    builder.harness.continuity = continuity;
    config.risk.correction_allowance.auto = allowance.auto;
    config.risk.correction_allowance.owner = allowance.owner;
  });
  const created = await draft(b, undefined, "build");
  await prepare(b, created.attemptDir);
  await start(b, created.attemptDir);
  return { b, attemptDir: created.attemptDir };
}

function builderAdapterId(b: ReturnType<typeof box>): string {
  return b.config.agents.find(agent => agent.name === "builder")!.harness.adapter;
}

async function run(
  b: ReturnType<typeof box>,
  attemptDir: string,
  adapter: ReplayStub,
  terminal?: { interactive: boolean; write(line: string): void; confirm(prompt: string): Promise<boolean> },
) {
  return runProductionCommand({
    attemptDir,
    stateRoot: b.stateRoot,
    config: b.config,
    configPath: b.configPath,
    projectRecord: b.projection.project,
    assertAdvancement: b.projection.assertAdvancement,
    assertLaunchProjection: b.projection.assertLaunchPermitted,
    ...(terminal === undefined ? {} : { terminal }),
    infrastructure: {
      ...b.infrastructure,
      adapterFor: (_entry, id) => adapter.id === id ? adapter : new ReplayStub(id),
      createBroker: (options: BrokerOptions): TransportBroker => {
        const ordinary = fakeBroker(options);
        return {
          async startProcess(registration, spec, signal) {
            if (registration.kind !== "phase-correction") return ordinary.startProcess(registration, spec, signal);
            const evidence = options.correctionLaunchVerifier?.verify(registration);
            if (evidence === undefined || options.onCorrection === undefined) throw new Error("fixture correction launch was not authorized");
            const record = {
              identity: { pid: 4242, pgid: 4242, startIdentity: "fixture:4242", startIdentitySource: "fixture" },
              runId: registration.runId,
              edge: null,
              reservationId: reservationIdOf(registration),
              command: [spec.executable, ...spec.argv],
              cwd: spec.cwd,
            };
            await options.register(record);
            await options.onCorrection(record, evidence);
            return {
              runId: registration.runId,
              identity: record.identity,
              stdout: (async function* () {})(),
              stderr: (async function* () {})(),
              exit: Promise.resolve({ code: 0, signal: null }),
              cancel: async () => ({ termSent: false, killSent: false, survivors: [], terminated: true, skipped: null }),
            };
          },
        };
      },
    },
  });
}

test("automatic correction uses only auto; owner approval is explicit, durable, and charged before its same-session launch", async () => {
  const { b, attemptDir } = await prepared({ auto: 1, owner: 1 });
  const answers: string[] = [];
  const adapter = new CorrectionAdapter(builderAdapterId(b), ["invalid", "invalid", "valid"], async () => {
    const rows = readFileSync(join(attemptDir, "journal.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line) as {
      event: { evidence?: { type?: string }; next?: { budget?: { correctionsOwner?: number } } };
    });
    const authorizationIndex = rows.findIndex(row => row.event.evidence?.type === "owner-correction-authorization");
    const chargedIndex = rows.findIndex(row => row.event.next?.budget?.correctionsOwner === 1);
    assert.ok(authorizationIndex >= 0, "owner approval is already durable before its provider launch");
    assert.ok(chargedIndex > authorizationIndex, "the durable consent precedes the owner-counter spend");
    assert.equal((await readAttempt(attemptDir)).budget.correctionsOwner, 1);
  });
  const status = await run(b, attemptDir, adapter, {
    interactive: true,
    write: () => {},
    confirm: async prompt => {
      answers.push(prompt);
      const beforeCharge = await readAttempt(attemptDir);
      assert.equal(beforeCharge.budget.correctionsAuto, 1);
      assert.equal(beforeCharge.budget.correctionsOwner, 0);
      assert.equal((await readAttemptEvidence(attemptDir)).some(row => row.type === "owner-correction-authorization"), false);
      return true;
    },
  });
  try {
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.correctionsAuto, 1);
    assert.equal(status.budget.correctionsOwner, 1);
    assert.equal(status.budget.ownerReentries, 0, "a phase correction does not consume lifecycle re-entry allowance");
    assert.deepEqual(adapter.tranches, ["auto", "owner"]);
    assert.equal(adapter.launches, 3);
    assert.equal(status.budget.callsSpent, 1, "both same-session corrections are call-neutral");
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(answers.length, 1);
    assert.match(answers[0]!, /owner correction 2.*same-session.*no additional provider call/u);
    const approvals = (await readAttemptEvidence(attemptDir)).filter(row => row.type === "owner-correction-authorization");
    assert.equal(approvals.length, 1);
    assert.equal(approvals[0]!.sessionId, status.sessionId);
    assert.equal(approvals[0]!.attempt, status.attempt);
    assert.equal(approvals[0]!.correctionRound, 2);
  } finally { b.close(); }
});

test("declined owner correction is not spent and noninteractive execution never prompts", async () => {
  for (const mode of ["declined", "noninteractive"] as const) {
    const { b, attemptDir } = await prepared({ auto: 0, owner: 1 });
    const adapter = new CorrectionAdapter(builderAdapterId(b), ["invalid", "valid"]);
    let confirmations = 0;
    try {
      const status = await run(b, attemptDir, adapter, {
        interactive: mode === "declined",
        write: () => {},
        confirm: async () => { confirmations++; return false; },
      });
      assert.equal(status.lifecycleState, "BLOCKED");
      assert.equal(status.budget.correctionsAuto, 0);
      assert.equal(status.budget.correctionsOwner, 0);
      assert.equal(status.budget.callsSpent, 1);
      assert.equal(status.budget.callsReserved, 0);
      assert.equal(adapter.launches, 1, "no correction turn follows a refusal");
      assert.equal(confirmations, mode === "declined" ? 1 : 0);
      assert.equal((await readAttemptEvidence(attemptDir)).filter(row => row.type === "owner-correction-authorization").length, 0);
    } finally { b.close(); }
  }
});

test("a cold route remains automatic-only and cannot spend the owner tranche", async () => {
  const { b, attemptDir } = await prepared({ auto: 1, owner: 1 }, "none");
  const adapter = new ColdCorrectionAdapter(builderAdapterId(b), ["invalid", "invalid"]);
  let confirmations = 0;
  try {
    const status = await run(b, attemptDir, adapter, {
      interactive: true,
      write: () => {},
      confirm: async () => { confirmations++; return true; },
    });
    assert.equal(status.lifecycleState, "BLOCKED");
    assert.equal(status.budget.correctionsAuto, 1);
    assert.equal(status.budget.correctionsOwner, 0);
    assert.equal(status.budget.callsSpent, 2, "the cold automatic correction is a separate paid provider call");
    assert.equal(status.budget.callsReserved, 0);
    assert.equal(adapter.launches, 2);
    assert.equal(confirmations, 0, "owner authority is unavailable on a cold route");
    assert.equal((await readAttemptEvidence(attemptDir)).filter(row => row.type === "owner-correction-authorization").length, 0);
  } finally { b.close(); }
});

test("automatic correction remains available without an owner terminal and never spends the owner tranche", async () => {
  const { b, attemptDir } = await prepared({ auto: 1, owner: 1 });
  const adapter = new CorrectionAdapter(builderAdapterId(b), ["invalid", "valid"]);
  try {
    const status = await run(b, attemptDir, adapter);
    assert.equal(status.lifecycleState, "AWAITING_OWNER", status.blocker?.detail);
    assert.equal(status.budget.correctionsAuto, 1);
    assert.equal(status.budget.correctionsOwner, 0);
    assert.deepEqual(adapter.tranches, ["auto"]);
    assert.equal((await readAttemptEvidence(attemptDir)).filter(row => row.type === "owner-correction-authorization").length, 0);
  } finally { b.close(); }
});
