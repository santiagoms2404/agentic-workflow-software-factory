import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as planTickets from "../../src/persistence/plan-tickets.ts";
import {
  parsePlanTicketBody,
  parsePlanTicketHandoff,
  parsePlanTicketIdentity,
  PlanTicketBodyError,
  readPlanTicketFile,
  ticketFileDigest,
} from "../../src/persistence/plan-ticket-body.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FIXTURES = join(ROOT, "core", "test", "fixtures", "plan-ticket-body");
const TICKETS = join(ROOT, "specs", "tickets");
const W17_T01 = join(TICKETS, "awsf-v2-w17-shift", "T01.md");

function refusal(code: string) {
  return (error: unknown) => error instanceof PlanTicketBodyError && error.code === code;
}

test("a file with no build prompt is refused by name", async () => {
  await assert.rejects(readPlanTicketFile(join(FIXTURES, "zero-blocks.md")), refusal("E_PLAN_TICKET_NO_BUILD_PROMPT"));
});

test("a file with two build prompts is refused by name", async () => {
  await assert.rejects(
    readPlanTicketFile(join(FIXTURES, "two-blocks.md")),
    refusal("E_PLAN_TICKET_MULTIPLE_BUILD_PROMPTS"),
  );
});

test("a file with no frontmatter or an unfenced prompt is refused by name", () => {
  assert.throws(() => parsePlanTicketBody("## Build prompt\n\n```\nx\n```\n"), refusal("E_PLAN_TICKET_NO_FRONTMATTER"));
  assert.throws(
    () => parsePlanTicketBody("---\nid: T01\n---\n## Build prompt\n\nplain text\n"),
    refusal("E_PLAN_TICKET_PROMPT_NOT_FENCED"),
  );
});

test("a real ticket parses, and its prompt is the build-prompts Section B block verbatim", async () => {
  const file = await readPlanTicketFile(W17_T01);
  assert.equal(file.digest, ticketFileDigest(readFileSync(W17_T01)));
  assert.ok(file.body.prompt.startsWith("```\n") && file.body.prompt.endsWith("\n```"));
  assert.ok(file.body.text.startsWith("[CHOOSE YOUR PROVIDER"));
  assert.ok(file.body.text.includes("TASK 1 of 18. Plan: specs/awsf-v2-w17-shift.html, milestone M1."));
  const sectionB = readFileSync(join(ROOT, "specs", "awsf-v2-w17-shift-build-prompts.md"), "utf8");
  assert.ok(sectionB.includes(`### T01 — The shift manifest contract and the plan-ticket body reader\n\n${file.body.prompt}\n`));
});

test("every committed plan ticket parses under the fence's split", () => {
  let count = 0;
  for (const set of readdirSync(TICKETS, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const name of readdirSync(join(TICKETS, set.name)).filter((entry) => /^[TW]\d\d\.md$/.test(entry))) {
      parsePlanTicketBody(readFileSync(join(TICKETS, set.name, name), "utf8"), `${set.name}/${name}`);
      count += 1;
    }
  }
  assert.ok(count > 0);
});

test("an appended handoff entry changes the digest and leaves the prompt alone", () => {
  const source = readFileSync(W17_T01, "utf8");
  const handedOff = source.replace("\n## Build prompt\n\n", "\nC1. A predecessor's correction.\n\n## Build prompt\n\n");
  assert.notEqual(handedOff, source);
  assert.notEqual(ticketFileDigest(Buffer.from(handedOff)), ticketFileDigest(Buffer.from(source)));
  assert.deepEqual(parsePlanTicketBody(handedOff), parsePlanTicketBody(source));
});

test("the handoff reader returns the section above the prompt, and refuses two", () => {
  const source = readFileSync(W17_T01, "utf8");
  const handoff = parsePlanTicketHandoff(source);
  assert.ok(handoff.startsWith("_Empty at authoring time."));
  assert.ok(!handoff.includes("## Build prompt") && !handoff.endsWith("\n"));
  const appended = source.replace("\n## Build prompt\n\n", "\nC9. A later correction.\n\n## Build prompt\n\n");
  assert.ok(parsePlanTicketHandoff(appended).endsWith("C9. A later correction."));
  assert.equal(parsePlanTicketHandoff(source.replace("## Handoff\n", "## Notes\n")), "");
  assert.throws(
    () => parsePlanTicketHandoff(source.replace("## Handoff\n", "## Handoff\n\nfirst\n\n## Handoff\n")),
    refusal("E_PLAN_TICKET_MULTIPLE_HANDOFFS"),
  );
});

test("the identity reader returns the frontmatter id and title only", () => {
  const source = readFileSync(W17_T01, "utf8");
  assert.deepEqual(parsePlanTicketIdentity(source), {
    id: "T01", title: "The shift manifest contract and the plan-ticket body reader",
  });
  assert.equal(parsePlanTicketIdentity(source.replace(/^title: .*$/mu, "title: \"\"")), null);
  assert.equal(parsePlanTicketIdentity("no frontmatter"), null);
});

test("the frontmatter reader keeps body parsing separate and its stat-keyed cache", () => {
  // W18 T15 intentionally extends frontmatter validation, so a whole-file
  // hash is no longer the invariant. Keep W17's separation and cache instead.
  const source = readFileSync(join(ROOT, "core", "src", "persistence", "plan-tickets.ts"), "utf8");
  assert.doesNotMatch(source, /import.*plan-ticket-body|parsePlanTicketBody\(|parsePlanTicketHandoff\(/);
  assert.match(source, /cached\?\.fingerprint === fingerprint/);
  assert.deepEqual(Object.keys(planTickets).sort(), ["PlanTicketReader", "parsePlanTicketData"]);
  assert.ok(!Object.hasOwn(planTickets.parsePlanTicketData(readFileSync(W17_T01, "utf8"))!, "prompt"));
  assert.deepEqual(
    Object.getOwnPropertyNames(planTickets.PlanTicketReader.prototype).sort(),
    ["constructor", "load", "source"],
  );
});
