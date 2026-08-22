import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { TicketSchema, emitTicketJsonSchema, type Ticket } from "../../../src/contracts/ticket.ts";
import { TicketDependencyCycleError, TicketStore } from "../../../src/persistence/ticket-store.ts";

function ticket(id: string, depends_on: string[] = []): Ticket {
  return {
    id,
    title: `Title ${id}`,
    milestone: "M9",
    tier: 1,
    state: "todo",
    depends_on,
    workflow: "plan-build-test",
    outcome: "Deliver the requested change.",
    context: ["A test fixture."],
    acceptance: ["The test passes."],
    non_goals: ["Other work."],
  };
}

async function fixtureDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "awsf-ticket-store-"));
}

test("Ticket is one TypeBox source for runtime validation, static type, and JSON Schema", () => {
  const valid = ticket("T01");
  assert.equal(Value.Check(TicketSchema, valid), true);
  assert.equal(Value.Check(TicketSchema, { ...valid, extra: true }), false);
  const emitted = emitTicketJsonSchema();
  assert.equal(emitted["$id"], "awsf.ticket/v1");
  assert.deepEqual(emitted.required, Object.keys(TicketSchema.properties));
});

test("the ticket corpus validates", async () => {
  const records = await new TicketStore("specs/tickets/awsf-plan").load();
  assert.ok(records.length > 0);
  assert.deepEqual(
    records.filter((record) => record.ticket === null).map((record) => ({ path: record.path, violations: record.violations })),
    [],
  );
});

test("invalid frontmatter is retained with violations and is never repaired", async () => {
  const directory = await fixtureDirectory();
  try {
    const path = join(directory, "T01.md");
    const original = "---\nid: T01\ntitle: missing required fields\n---\nbody\n";
    await writeFile(path, original);
    const [record] = await new TicketStore(directory).load();
    assert.ok(record);
    assert.equal(record.ticket, null);
    assert.ok(record.violations.length > 0);
    const after = await (await import("node:fs/promises")).readFile(path, "utf8");
    assert.equal(after, original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("depends_on cycles are rejected while loading files", async () => {
  const directory = await fixtureDirectory();
  try {
    const store = new TicketStore(directory);
    await store.write(ticket("T01", ["T02"]), "first\n");
    await store.write(ticket("T02", ["T01"]), "second\n");
    await assert.rejects(() => store.load(), TicketDependencyCycleError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
