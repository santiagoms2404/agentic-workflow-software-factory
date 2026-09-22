// The host that dies mid-publication.
//
// A real child process running the real completion protocol against a real
// attempt, SIGKILLed from inside the protocol's own seam. Not a thrown error
// standing in for a crash — an actual uncatchable kill, so what is on disk
// afterwards is exactly what a power cut at that boundary leaves: no `finally`
// ran, the index lock is still there, the execution lease was never released,
// and the journal never learned that anything had failed.
//
// That distinction is the whole point. An interruption the host can catch is
// finished in place, under the authority that was already granted, before the
// attempt can seal. Process death cannot be, and is what `awsf resume` has to
// reconcile from durable evidence alone.
//
// Invoked by `production-runner.test.ts` as:
//   node --experimental-strip-types _protected-kill-host.ts '<attemptDir>' '<stage>'

import { withExecutionLease } from "../../src/execution/operation-lease.ts";
import { completeProtectedPublication, inspectProtectedPublication, unfinishedProtectedEffect } from "../../src/git/protected-reconcile.ts";
import { readProtectedState } from "../../src/workflow/protected-grants.ts";
import { nextRevision, persistAttempt, readAttempt } from "../../src/cli/commands/attempt.ts";

/**
 * Four ordered deaths inside one protocol.
 *
 * `lock` dies after the index lock exists and holds the staged bytes but before
 * its creation record is durable — the window that has to refuse, because a
 * later recovery has nothing to attribute the file with. `witness` dies just
 * after that record lands and before HEAD moves, which is the window that has
 * to reconcile. `head` dies between the HEAD CAS and the index install, and
 * `binding` after both, before the binding is durable.
 */
const attemptDir = process.argv[2]!;
const stage = process.argv[3]! as "lock" | "witness" | "head" | "binding";

await withExecutionLease(attemptDir, async () => {}, async () => {
  const state = readProtectedState(attemptDir);
  const intent = unfinishedProtectedEffect(state);
  if (intent === null) throw new Error("the fixture has no retained protected host effect to interrupt");
  const publication = inspectProtectedPublication(state, intent);
  if (publication.outcome !== "unpublished") throw new Error(`the fixture publication is ${publication.outcome}, not unpublished`);
  await completeProtectedPublication({
    attemptDir, state, intent, publication,
    ...(stage === "head" ? { afterHeadPublished: () => process.kill(process.pid, "SIGKILL") } : {}),
    persistWitness: async witness => {
      // The callback fires with the lock created and nothing yet published, so
      // killing before the append is exactly the unwitnessed-lock cut and
      // killing after it is the witnessed one.
      if (stage === "lock") process.kill(process.pid, "SIGKILL");
      const status = await readAttempt(attemptDir);
      await persistAttempt(attemptDir, status.revision, { kind: "attempt.updated",
        next: nextRevision(status, {}), evidence: { type: "protected-lock-witness", witness } });
      if (stage === "witness") process.kill(process.pid, "SIGKILL");
    },
    persistBinding: async () => {
      if (stage !== "binding") throw new Error("the kill seam never fired");
      process.kill(process.pid, "SIGKILL");
    },
  });
});

// Only reached when the kill never landed. The test asserts on the exit signal,
// so a clean exit shows up as a failed injection rather than a silent pass.
process.exit(0);
