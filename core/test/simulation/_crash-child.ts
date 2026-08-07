// The host that gets killed.
//
// A real child process driving the real write protocol, SIGKILLed from inside
// the protocol's own step hook. Not a simulation of a crash — an actual
// uncatchable kill, so whatever is on disk afterwards is exactly what a power
// cut at that boundary would have left: no `finally` ran, no handle was
// flushed on the way out, and the lock file is still there.
//
// Invoked by `crash-injection.test.ts` as:
//   node --experimental-strip-types _crash-child.ts '<json>'

import { driveWrites } from "./_harness.ts";
import type { WriteProtocolStep } from "../../src/persistence/attempt-lock.ts";

interface ChildRequest {
  attemptDir: string;
  dbPath: string | null;
  writes: number;
  terminal: "completed" | "failed" | null;
  /** 1-based write during which the kill lands. */
  killWrite: number;
  killStep: WriteProtocolStep;
}

const request = JSON.parse(process.argv[2] ?? "{}") as ChildRequest;

await driveWrites({
  attemptDir: request.attemptDir,
  dbPath: request.dbPath,
  from: 1,
  count: request.writes,
  terminal: request.terminal,
  onStep: (write, step) => {
    if (write === request.killWrite && step === request.killStep) {
      process.kill(process.pid, "SIGKILL");
    }
  },
});

// Only reached when the kill step never fired — the test asserts on the exit
// signal, so a clean exit here shows up as a failed injection rather than a
// silently uninjected run.
process.exit(0);
