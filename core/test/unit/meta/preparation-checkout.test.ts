import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { treeFiles } from "../../fixtures/trap-fence.ts";

const sources = new Map(treeFiles(resolve(import.meta.dirname, "../../../.."), "core/src")
  .map(({ path, text }) => [path.replace(/^core\/src\//u, ""), text]));

const source = (path: string) => {
  const text = sources.get(path);
  assert.notEqual(text, undefined, path);
  return text!;
};

function checkDigestSites(files: ReadonlyMap<string, string>): void {
  const filesUsingTicketDigest = [...files].filter(([, text]) => /\bticketFileDigest\b/u.test(text)).map(([path]) => path);
  assert.deepEqual(filesUsingTicketDigest, ["persistence/plan-ticket-body.ts", "persistence/ticket-bytes.ts"]);
  const comparisons = [...files].flatMap(([path, text]) =>
    text.split("\n").filter(line => /(?:[!=]==?\s*ticket\.digest\b|\bticket\.digest\s*[!=]==?)/u.test(line)).map(() => path));
  assert.deepEqual(comparisons, ["persistence/ticket-bytes.ts"]);
}

test("there is one ticket file digest comparison in core/src", () => {
  checkDigestSites(sources);
  for (const path of ["workflow/shift/compile.ts", "preflight/shift-tickets.ts"]) {
    assert.match(source(path), /assertTicketFileDigest\(ticket, bytes/u);
  }
  assert.match(source("preflight/checkout.ts"), /await assertSelectedTicketFiles\(/u);
  assert.match(source("persistence/ticket-bytes.ts"), /assertTicketFileDigest\(ticket, bytes\)/u);
  const runner = source("cli/commands/production-run.ts");
  assert.equal([...runner.matchAll(/await planAuthorPromptSuffix\(/gu)].length, 2);
  assert.match(runner, /async function planAuthorPromptSuffix[^]*?await assertSelectedTicketFiles\(/u);
});

// Work-start boundaries, not readouts or DRAFT-only commands (new, prove,
// retry without --adopt). `ticket new/refine` uses the checked start boundary.
const checked = {
  preflight: ["cli/commands/preflight.ts", "assertPreparationCheckout(current)"],
  start: ["cli/commands/start.ts", "assertPreparationCheckout(current)"],
  rework: ["cli/commands/rework.ts", 'assertClean(status.repository, "before", canonical)'],
  review: ["cli/commands/review.ts", 'assertClean(status.repository, "before", canonical)'],
  "retry --adopt": ["cli/commands/adopt.ts", 'assertClean(candidate.source.repository, "before", canonical)'],
  seed: ["workflow/candidate-seed.ts", 'assertClean(repository, "before", git)'],
};
const unchecked = {
  run: "Starts an already PREPARED attempt on its pinned managed tree; the stub run is local and plan-author still rechecks the ticket.",
  resume: "Continues an admitted attempt at a verified managed checkpoint, not a new preparation in the canonical checkout.",
  preview: "Starts only a local server for a verified candidate in its managed worktree; it spends no provider call.",
};

function checkWorkStart(read: (path: string) => string): void {
  for (const [command, [path, guard]] of Object.entries(checked)) {
    assert.ok(read(path!).includes(guard!), `${command} checks the canonical checkout`);
  }
}

test("canonical-cleanliness coverage and intentional exceptions at work-start boundaries", () => {
  checkWorkStart(source);
  const main = source("cli/main.ts");
  assert.match(main, /if \(command === "ticket"\)[^]*?await startCommand\(/u);
  // Pin the CLI routes that actually begin execution or materialize checked work.
  const entries = [...main.matchAll(/await (preflightCommand|startCommand|runStubCommand|runProductionCommand|resumeProductionCommand|previewCommand|reworkCommand|reviewCommand|adoptCommand|seedCommand)\(/gu)]
    .map(match => match[1]);
  assert.deepEqual(entries, ["startCommand", "runProductionCommand", "seedCommand", "startCommand", "preflightCommand",
    "runStubCommand", "runProductionCommand", "resumeProductionCommand", "reworkCommand", "reviewCommand", "previewCommand", "adoptCommand"]);
  for (const [command, reason] of Object.entries(unchecked)) {
    assert.match(main, new RegExp(`case "${command}":`), reason);
  }
});

test("preparation checks refuse a second digest comparison and a missing checkout guard", () => {
  const altered = new Map(sources);
  altered.set("planted.ts", "if (saved !== ticket.digest) check();");
  assert.throws(() => checkDigestSites(altered), /planted\.ts/u);
  assert.throws(() => checkDigestSites(new Map()), { code: "ERR_ASSERTION" });
  assert.throws(() => checkWorkStart(path => path === checked.start[0] ? "" : source(path)), /start checks the canonical checkout/u);
});
