// Shared between the barrier simulation and the host it kills.
//
// The run id is the needle. It appears in the gated launcher's argv (the broker
// puts it there so a human at a `ps` can tell which run a blocked child belongs
// to) and in the provider's argv (via the side-effect path), which is what lets
// the parent ask the whole process table a single question: is anything from
// this run still alive?

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const PROVIDER_PATH = join(
  import.meta.dirname,
  "..",
  "fixtures",
  "providers",
  "stub",
  "stub-provider.mjs",
);

/** The provider writes this the instant it starts. Its absence is the proof. */
export function sideEffectPathFor(dir: string, runId: string): string {
  return join(dir, `${runId}.ran.json`);
}

/**
 * Every live process whose command line mentions this run.
 *
 * Deliberately asked of the WHOLE process table rather than of a pid the parent
 * was told about: after the host dies, the launcher is an orphan with no
 * relationship left to anything the test holds, and "the pid I knew about is
 * gone" is a weaker claim than "nothing from this run is running".
 */
export function processesMentioning(runId: string): number[] {
  const found: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    let cmdline: string;
    try {
      cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8");
    } catch {
      continue; // Exited between the listing and the read.
    }
    if (cmdline.includes(runId)) found.push(Number(entry));
  }
  return found.sort((a, b) => a - b);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls a predicate to a deadline. Returns whether it ever came true. */
export async function within(deadlineMs: number, predicate: () => boolean): Promise<boolean> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() >= until) return false;
    await sleep(20);
  }
}
