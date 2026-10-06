import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { relRepo, repoRoot, walkFiles } from "./_walk.ts";

// W01-Q2 as decided (specs/awsf-v3-w01-driver-checks.html, task 11): K1 is
// enforced in `awsf start`, not in L1's guard, so the guarantee that no other
// path reaches PREPARED is this fence. start.ts is the only module under
// core/src that asks for PREPARED, as a transition target or as a status write.
// The machine under core/src/state declares the edge and requests nothing.

interface Source { readonly path: string; readonly text: string }
const START = "core/src/cli/commands/start.ts";
const MACHINE = "core/src/state/";

/** A transition or authorization whose target is PREPARED, or a status written straight to PREPARED. */
const REQUESTS_PREPARED = /\b(?:to|lifecycleState)\s*:\s*(['"`])PREPARED\1/u;

function requestSites(sources: readonly Source[]): string[] {
  return sources.flatMap(({ path, text }) => path.startsWith(MACHINE) ? [] : text.split("\n").flatMap((line, index) =>
    REQUESTS_PREPARED.test(line) ? [`${path}:${String(index + 1)}`] : []));
}

function assertOnlyStart(sources: readonly Source[]): void {
  const outside = requestSites(sources).filter((site) => !site.startsWith(`${START}:`));
  assert.deepEqual(outside, [], "only start.ts may request DRAFT to PREPARED");
}

function coreSources(): Source[] {
  return walkFiles(join(repoRoot(), "core", "src"), [".ts", ".mts"]).map((file) => ({ path: relRepo(file), text: readFileSync(file, "utf8") }));
}

test("start.ts is the only module under core/src that requests a transition to PREPARED", () => {
  const sources = coreSources();
  assert.ok(sources.some((source) => source.path === START), `${START} is outside the sweep`);
  assert.ok(requestSites(sources).some((site) => site.startsWith(`${START}:`)), "the matcher must see start.ts's own request");
  assertOnlyStart(sources);
});

test("the fence bites a planted second site, whatever its spelling", () => {
  const sources = coreSources();
  for (const [path, line] of [
    ["core/src/cli/commands/planted.ts", 'transition({ from: "DRAFT", to: "PREPARED", actor: "host", tier, reason, interactive: false, budget });'],
    ["core/src/workflow/planted.ts", "budget.authorize({ from: 'DRAFT', to: 'PREPARED' });"],
    ["core/src/cli/main.ts", "await persistAttempt(dir, revision, { kind: \"attempt.transitioned\", next: nextRevision(status, { lifecycleState: `PREPARED` }) });"],
  ] as const) {
    const planted = { path, text: `// planted offline\n${line}\n` };
    assert.deepEqual(requestSites([planted]), [`${path}:2`]);
    assert.throws(() => assertOnlyStart([...sources, planted]), { name: "AssertionError" }, path);
  }
  // Reading a state, or declaring the edge in the machine, is not a request.
  assertOnlyStart([
    { path: "core/src/cli/commands/run.ts", text: 'if (status.lifecycleState !== "PREPARED") throw new Error("stub run requires PREPARED");' },
    { path: "core/src/state/task-machine.ts", text: '{ id: "L1",  from: "DRAFT", to: "PREPARED", actors: ["host"] },' },
  ]);
});
