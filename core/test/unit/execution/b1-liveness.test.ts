import { test } from "node:test";
import assert from "node:assert/strict";
import { LivenessMonitor } from "../../../src/execution/liveness-monitor.ts";
import type { ProcessIdentity, TerminationReport } from "../../../src/execution/launcher-barrier.ts";

const IDENTITY: ProcessIdentity = {
  pid: 12345,
  pgid: 12345,
  startIdentity: "12345:1000",
  startIdentitySource: "linux-proc-stat",
};

const CLEAN: TerminationReport = {
  termSent: true,
  killSent: false,
  survivors: [],
  terminated: true,
  skipped: null,
};

test("B1-36: tick() group CPU does not reset silence when CPU drops due to member exit", async () => {
  let cpu = 50;
  let simulatedTime = 1000;
  let terminations = 0;

  const monitor = new LivenessMonitor({
    silenceMs: 5000,
    pollMs: 100,
    identity: IDENTITY,
    now: () => simulatedTime,
    supervisor: {
      groupCpu: () => cpu,
      terminateTree: async () => {
        terminations += 1;
        return CLEAN;
      },
    },
  });

  // Initial reading with 2 processes active: total CPU 50
  await monitor.tick();
  assert.equal(terminations, 0);

  // Time advances 4 seconds (under 5s silence)
  simulatedTime += 4000;
  // One process exits: total CPU drops to 25 (cpu < lastCpu)
  // This must NOT count as activity!
  cpu = 25;
  await monitor.tick();
  assert.equal(terminations, 0);

  // Time advances 2 more seconds (total 6s since initial reading at 1000)
  simulatedTime += 2000;
  await monitor.tick();
  // Because the drop did not reset silence, 6s elapsed > 5s silenceMs, so monitor tripped!
  assert.equal(terminations, 1);
});
