// The host that dies while dispatching an owner-configured command.
//
// A real child process running the real ledger protocol against a real attempt,
// SIGKILLed from inside it. Not a thrown error standing in for a crash — an
// actual uncatchable kill, so what is on disk afterwards is exactly what a power
// cut at that boundary leaves: no `finally` ran, and the journal never learned
// that anything had failed.
//
// The dispatched command is deliberately NON-IDEMPOTENT: it appends one line to
// a counter file. Every restore case can then assert the counter did not move
// and every dispatch case that it moved exactly once, so an accidental re-run
// fails visibly instead of passing quietly. The counter lives OUTSIDE the
// managed worktree, because a file written inside it would dirty the tree and
// trip the host's own cleanliness check before any assertion was reached.
//
// Invoked by `command-ledger-recovery.test.ts` as:
//   node --experimental-strip-types _command-ledger-kill-host.ts '<attemptDir>' '<stage>' '<counterPath>' '<worktree>'

import { randomUUID } from "node:crypto";
import { writeFile, chmod, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argvDigest, gateConfigDigest, gatesConfigDigest, COMMAND_LEDGER_PROTOCOL_VERSION } from "../../src/contracts/command-ledger.ts";
import { readCommandLedger, retainedOutputDigest, occurrenceKeyForMeasurement } from "../../src/workflow/command-ledger-store.ts";
import { runSystemCommand } from "../../src/execution/transport-broker.ts";
import { nextRevision, persistAttempt, readAttempt } from "../../src/cli/commands/attempt.ts";
import type { AttemptEvidence } from "../../src/observability/attempt-evidence.ts";

/**
 * Four ordered deaths inside one dispatch.
 *
 * `pre-intent` dies before anything durable exists, which must dispatch on
 * recovery because the command provably never ran. `post-intent` dies with the
 * intent durable and the command not yet spawned — indistinguishable on disk
 * from `post-dispatch`, which is exactly why both refuse. `post-dispatch` dies
 * with the command having actually run and no result, the cut the whole ledger
 * exists to make safe. `post-result` dies with everything durable, which
 * restores without running the body again.
 */
const attemptDir = process.argv[2]!;
const stage = process.argv[3]! as "pre-intent" | "post-intent" | "post-dispatch" | "post-result";
const counterPath = process.argv[4]!;
const worktree = process.argv[5]!;

const CANDIDATE = process.env.AWSF_FIXTURE_CANDIDATE!;
const GATE = "counter";
const ARGV = ["sh", "-c", `printf 'ran\\n' >> ${JSON.stringify(counterPath)}`];
const GATES = { [GATE]: { argv: ARGV, timeout_seconds: 30 } };
const MAX_OUTPUT = 1_048_576;

const append = async (evidence: AttemptEvidence): Promise<void> => {
  const status = await readAttempt(attemptDir);
  await persistAttempt(attemptDir, status.revision, { kind: "attempt.updated", next: nextRevision(status, {}), evidence });
};

const status = await readAttempt(attemptDir);
const occurrenceKey = occurrenceKeyForMeasurement("builder", CANDIDATE, 0);

// Read before this run's own hygiene record, exactly as the dispatchers do.
await readCommandLedger(attemptDir);
await append({ type: "command-occurrence-opened", opening: {
  schema: "awsf.command-occurrence-opened/v1", dispatcherId: "production-run/measure-candidate",
  occurrenceKey, protocolVersion: COMMAND_LEDGER_PROTOCOL_VERSION, openedAt: new Date().toISOString(),
} });

if (stage === "pre-intent") process.kill(process.pid, "SIGKILL");

const intentId = randomUUID();
await append({ type: "command-dispatch-intent", intent: {
  schema: "awsf.command-dispatch-intent/v1", intentId, dispatcherId: "production-run/measure-candidate",
  occurrenceKey, gateId: GATE, origin: "verify-candidate", phaseKey: "builder", phaseOrdinal: 1, round: 0,
  attempt: status.attempt, sessionId: status.sessionId,
  argv: [...ARGV], argvDigest: argvDigest(ARGV),
  cwd: worktree, worktreeRealPath: worktree, timeoutMs: 30_000, maxOutputBytes: MAX_OUTPUT,
  gateConfigDigest: gateConfigDigest(GATES[GATE]!), gatesConfigDigest: gatesConfigDigest(GATES),
  candidateSha: CANDIDATE, headBefore: CANDIDATE, cleanBefore: true,
  dispatchedAt: new Date().toISOString(),
} });

if (stage === "post-intent") process.kill(process.pid, "SIGKILL");

const [executable, ...argv] = ARGV;
const result = runSystemCommand(executable!, argv, { timeoutMs: 30_000, cwd: worktree, maxBuffer: MAX_OUTPUT });

if (stage === "post-dispatch") process.kill(process.pid, "SIGKILL");

const output = `${result.stdout}${result.stderr}${result.error === null ? "" : `\n${result.error}`}`;
const outputRelative = join("raw", `command-builder-${GATE}-0.txt`);
const outputAbsolute = join(attemptDir, outputRelative);
await mkdir(dirname(outputAbsolute), { recursive: true });
await writeFile(outputAbsolute, output, { mode: 0o600 });
await chmod(outputAbsolute, 0o600);
await append({ type: "command-dispatch-result", result: {
  schema: "awsf.command-dispatch-result/v1", intentId,
  outcome: result.status === null ? "no-exit" : "exited",
  exitCode: result.status ?? -1, durationMs: 1, outputRef: outputRelative,
  outputBytes: Buffer.byteLength(output), outputDigest: retainedOutputDigest(output),
  headAfter: CANDIDATE, cleanAfter: true, descendantQuiescence: "unproved",
  settledAt: new Date().toISOString(),
} });

if (stage === "post-result") process.kill(process.pid, "SIGKILL");

// Only reached when the kill never landed. The test asserts on the exit signal,
// so a clean exit shows up as a failed injection rather than a silent pass.
process.exit(0);
