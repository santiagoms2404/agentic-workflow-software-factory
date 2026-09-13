// Owner-invoked, outside default tests/CI. Role-equivalent retention/interruption diagnostics.
// There is no proved native reconnect transport yet. No result here enables rescue.
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../../src/config/load.ts";
import { parseEnvelope } from "../../src/contracts/parse-envelope.ts";
import { continuityDigest } from "../../src/contracts/interrupted-turn.ts";
import type { NormalizedEvent } from "../../src/contracts/normalized-events.ts";
import type { ObservedProviderSession, ProcessTransport, TransportBroker } from "../../src/adapters/interface.ts";
import { CallBudget } from "../../src/execution/call-budget.ts";
import { ProcessTransportBroker, resolveExecutable, runSystemCommand } from "../../src/execution/transport-broker.ts";
import { Journal } from "../../src/persistence/journal.ts";
import { createCompiledPhaseLaunchVerifier } from "../../src/workflow/phase-launch-authorization.ts";
import { capture, digest, privateFile } from "./support/continuation-probe.ts";
import { prepareRoleProbe } from "./support/phase-parity.ts";
import { createRoleFixture, snapshotRoleFixture } from "./support/role-fixture.ts";

const { values } = parseArgs({ options: {
  role: { type: "string" }, selection: { type: "string", default: "proof-low" },
  cut: { type: "string", default: "none" }, "max-original-turns": { type: "string" },
  "confirm-spend": { type: "boolean" }, "allow-unknown-quota": { type: "boolean" },
  "config-path": { type: "string" },
} });
const configPath = resolve(values["config-path"] ?? join(import.meta.dirname, "../../../awsf.config.yaml"));
const config = loadConfig(await readFile(configPath, "utf8"));
const configured = config.agents.find((agent) => agent.name === values.role);
if (configured === undefined || values["max-original-turns"] !== "1" ||
    !(values.selection === "proof-low" || values.selection === "configured") ||
    !(values.cut === "none" || values.cut === "after-text" || values.cut === "after-tool")) {
  throw new Error("Require --role <configured-role> --selection proof-low|configured --cut none|after-text|after-tool --max-original-turns 1. Dry run unless --confirm-spend.");
}
const entry = config.adapters[configured.harness.adapter];
if (entry?.kind !== "claude-code" && entry?.kind !== "pi-codex") throw new Error("proof-unavailable: no reviewed native diagnostic route");
const commandEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
const executable = resolveExecutable(entry.executable ?? (entry.kind === "claude-code" ? "claude" : "pi"), commandEnv);
const version = runSystemCommand(executable, ["--version"], 10_000);
if (version.status !== 0) throw new Error("executable version unavailable");
const quota = runSystemCommand("quota-axi", ["--provider", entry.kind === "claude-code" ? "claude" : "codex"], 60_000);
console.log(quota.stdout);
if (quota.status !== 0 || quota.stdout.includes("exhausted_now")) throw new Error("quota preflight refused");
if (/stale|headroom_unknown/.test(quota.stdout) && !values["allow-unknown-quota"]) throw new Error("unknown quota requires explicit bounded-research consent");
console.log(JSON.stringify({ role: configured.name, selection: values.selection, cut: values.cut,
  configuredModel: configured.model, configuredEffort: configured.thinking,
  selectedModel: values.selection === "configured" ? configured.model : entry.kind === "claude-code" ? "claude:sonnet" : "codex:gpt-5.6-luna",
  selectedEffort: values.selection === "configured" ? configured.thinking : "low",
  executable, version: version.stdout.trim(), maxOriginalTurns: 1, releaseEligible: false }, null, 2));
if (!values["confirm-spend"]) {
  console.log("Dry run. No fixture or provider launch. Native original-turn reconnection remains unproved.");
} else {
  await run();
}

async function run(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "awsf-role-proof-"));
  await chmod(root, 0o700);
  console.log(`Private evidence: ${root}`);
  privateFile(join(root, "quota.txt"), quota.stdout);
  const fixture = await createRoleFixture(root, configured!.name, `fixture-${randomUUID()}`);
  const prepared = await prepareRoleProbe({ config, configPath, workflow: fixture.workflow, role: configured!.name,
    selection: values.selection as "proof-low" | "configured", previous: fixture.previous, designContext: fixture.designContext,
    recordedRequest: fixture.request, canonical: fixture.canonical, worktree: fixture.worktree,
    stateRoot: fixture.stateRoot, runtime: fixture.runtime, env: fixture.env });
  privateFile(join(root, "selection.json"), JSON.stringify({ ...prepared.evidence, version: version.stdout.trim(), executable,
    adapterSourceDigest: digest(readFileSync(join(import.meta.dirname, `../../src/adapters/${prepared.adapter.id}.ts`))),
    harnessSourceDigest: digest(readFileSync(new URL(import.meta.url))), cut: values.cut, maxOriginalTurns: 1 }, null, 2));
  privateFile(join(root, "input.txt"), prepared.request.prompt);
  const journal = new Journal(join(fixture.stateRoot, "journal.jsonl"));
  const ledger = new CallBudget({ taskId: "isolated-role-proof", tier: 0, reservationNamespace: randomUUID() });
  const reservation = ledger.reserve({ cost: 1, subject: "one original diagnostic turn" });
  const taskSessionId = randomUUID();
  const registration = prepared.registrationFor(`proof-${randomUUID()}`, reservation.id, taskSessionId);
  const fixtureAdmission = { taskSessionId, workflowId: prepared.workflow.id,
    lifecycleState: registration.kind === "agent-phase" ? "RUNNING" as const : registration.from };
  await journal.append({ type: "isolated-phase-admission", fixtureAdmission, registration });
  const phaseLaunchVerifier = createCompiledPhaseLaunchVerifier({
    statusFor: id => id === taskSessionId ? fixtureAdmission : null,
    compiledWorkflowFor: id => id === taskSessionId ? prepared.workflow : null,
    configuredRouteFor: input => input.taskSessionId === taskSessionId && input.workflowId === prepared.workflow.id &&
      input.phaseId === prepared.phase.id && input.phaseOrdinal === prepared.evidence.ordinal
      ? { adapterId: prepared.agent.harness.adapter, role: prepared.agent.name,
        launchAuthorization: registration.kind === "agent-phase" ? "agent-phase" : "task-edge" } : null,
  });
  const broker = new ProcessTransportBroker({ ledger, phaseLaunchVerifier, terminate: { graceMs: config.runtime.process_grace_seconds * 1_000 },
    register: async record => { await journal.append({ type: "registered", record }); },
    onSpent: async (record, debit) => { await journal.append({ type: "spent", runId: record.runId, debit }); },
  });
  const held: { transport: ProcessTransport | null } = { transport: null };
  const wrapped: TransportBroker = { startProcess: async (registration, spec, signal) => {
    const grant = prepared.permission.sandbox(spec);
    if (continuityDigest(grant.spec) !== continuityDigest(prepared.grant.spec) || grant.badge !== prepared.grant.badge || grant.mechanism !== prepared.grant.mechanism) throw new Error("actual phase descriptor drifted after preflight");
    held.transport = await broker.startProcess(registration, grant.spec, signal);
    return { ...held.transport, stdout: capture(held.transport.stdout, join(root, "original.stdout")),
      stderr: capture(held.transport.stderr, join(root, "original.stderr")) };
  } };
  const controller = new AbortController();
  let timedOut = false;
  const watchdog = setTimeout(() => {
    timedOut = true;
    controller.abort("isolated proof watchdog");
    void held.transport?.cancel("isolated proof watchdog");
  }, 180_000);
  const observed: ObservedProviderSession = { sessionId: null, resolvedModel: null };
  let terminal: NormalizedEvent | null = null;
  let output = "";
  let cutObserved = false;
  let locallyStopped = false;
  let cleanup: Awaited<ReturnType<ProcessTransport["cancel"]>> | null = null;
  const problems: string[] = [];
  const treeSnapshot = (): string => {
    const result = runSystemCommand("git", ["-C", fixture.worktree, "status", "--porcelain=v1", "--untracked-files=all"], { env: fixture.env, timeoutMs: 10_000 });
    if (result.status !== 0) throw new Error("fixture tree inspection failed");
    return result.stdout;
  };
  const snapshot = async (): Promise<string | null> => {
    try { return await snapshotRoleFixture(fixture.worktree, fixture.gitControlPaths); }
    catch (error) { problems.push(`snapshot: ${error instanceof Error ? error.message : String(error)}`); return null; }
  };
  try {
    for await (const event of prepared.adapter.execute(prepared.request, wrapped, registration, controller.signal, observed)) {
      await journal.append(event);
      if (event.kind === "text.delta") output += event.text;
      if (["run.completed", "run.failed", "run.cancelled"].includes(event.kind)) terminal = event;
      const reached = values.cut === "after-text" ? event.kind === "text.delta" && output.length > 0
        : values.cut === "after-tool" && event.kind === "tool.completed" && event.outcome === "ok" &&
          (prepared.agent.writes.length === 0 || treeSnapshot().length > 0);
      if (!cutObserved && reached) {
        cutObserved = true;
        controller.abort("selected diagnostic cut");
        const report = await held.transport?.cancel("selected diagnostic cut");
        locallyStopped = report?.terminated === true && report.skipped === null && report.survivors.length === 0;
        await journal.append({ type: "cut-local-termination", report: report ?? null });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    problems.push(`transport: ${message}`);
    await journal.append({ type: "diagnostic-error", message });
  } finally {
    clearTimeout(watchdog);
    if (held.transport !== null) {
      cleanup = await held.transport.cancel("isolated fixture cleanup");
      await journal.append({ type: "fixture-cleanup", stopped: cleanup });
      if (!cleanup.terminated || cleanup.survivors.length > 0) problems.push("cleanup: local process termination is unproved");
      await held.transport.exit;
    }
  }
  try {
    const beforeRefusal = await snapshot();
    // No native inspection/executor/cursor contract exists in the shipped print adapters.
    // Do not buy an empty reopen or send a follow-up prompt under the old reservation.
    const refusal = { code: "proof-unavailable", detail: "native original-turn cursor, execution ledger and exclusive takeover are unproved" };
    const afterRefusal = await snapshot();
    const parsed = parseEnvelope(output, prepared.phase.schemaId);
    let permission: ReturnType<typeof prepared.permission.enforce> | null = null;
    try { permission = prepared.permission.enforce(); }
    catch (error) { problems.push(`permission: ${error instanceof Error ? error.message : String(error)}`); }
    const result = { classification: "diagnostic-only", ...prepared.evidence,
      terminal, observed, callsSpent: ledger.callsSpent, callsReserved: ledger.callsReserved, cutObserved,
      locallyStopped, cleanup, timedOut, problems,
      retainedBytesUnchanged: beforeRefusal !== null && beforeRefusal === afterRefusal,
      sessionIdentityHonoured: observed.sessionId !== null && observed.sessionId === prepared.request.continuity?.ref.providerSessionId,
      envelopeValid: parsed.valid, permission, refusal, reconnectAttempted: false,
      unexercised: ["original-turn-reconnect", "host-death", "independent-tool-executor", "idempotent-result-acknowledgement", "amended-rescue", "repeated-qualification", "phase-engine-acceptance-and-gates"] };
    privateFile(join(root, "output.txt"), output);
    privateFile(join(root, "result.json"), JSON.stringify(result, null, 2));
    await journal.append({ type: "diagnostic-result", result });
    console.log(JSON.stringify({ evidence: root, role: prepared.agent.name, resolvedModel: observed.resolvedModel,
      callsSpent: ledger.callsSpent, cutObserved, envelopeValid: parsed.valid, releaseEligible: false }, null, 2));
    process.exitCode = 2;
  } finally { await journal.close(); }
}
