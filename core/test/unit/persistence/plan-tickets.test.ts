import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PlanTicketReader } from "../../../src/persistence/plan-tickets.ts";
import type { ResolvedPlanSource } from "../../../src/registry/plan-source.ts";

function source(root: string, stem: string): ResolvedPlanSource {
  return {
    project: "fixture",
    repositoryId: "fixture",
    planPath: join(root, `${stem}.html`),
    promptsPath: join(root, `${stem}-build-prompts.md`),
    ticketsPath: join(root, "tickets", stem),
    format: "awsf-plan-html/v1",
  };
}

function ticket(id: string, title: string): string {
  return `---\nid: ${id}\ntitle: ${title}\nmilestone: M1\nstate: done\ndepends_on: []\n---\n# ${title}\n`;
}

test("the plan reader reuses unchanged parsed records and reparses only a changed file", async () => {
  const root = await mkdtemp(join(tmpdir(), "awsf-plan-reader-"));
  const sources = [source(root, "foo-plan"), source(root, "foo-w01-deep")];
  try {
    await Promise.all(sources.map((entry) => mkdir(entry.ticketsPath, { recursive: true })));
    await writeFile(join(sources[0]!.ticketsPath, "W01.md"), ticket("W01", "Spine"));
    const changedPath = join(sources[1]!.ticketsPath, "T01.md");
    await writeFile(changedPath, ticket("T01", "Deep"));
    const reader = new PlanTicketReader(sources);

    const first = await reader.load();
    const second = await reader.load();
    assert.equal(second[0]?.records[0], first[0]?.records[0]);
    assert.equal(second[1]?.records[0], first[1]?.records[0]);

    await writeFile(changedPath, ticket("T01", "Deep changed and longer"));
    const third = await reader.load();
    assert.equal(third[0]?.records[0], first[0]?.records[0]);
    assert.notEqual(third[1]?.records[0], first[1]?.records[0]);
    assert.equal(third[1]?.records[0]?.ticket.title, "Deep changed and longer");
    assert.equal(Object.hasOwn(third[1]?.records[0] ?? {}, "source"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ticket expansion reads the complete markdown file byte for byte", async () => {
  const root = await mkdtemp(join(tmpdir(), "awsf-plan-source-"));
  const resolved = source(root, "foo-plan");
  try {
    await mkdir(resolved.ticketsPath, { recursive: true });
    const path = join(resolved.ticketsPath, "T01.md");
    await writeFile(path, ticket("T01", "Verbatim") + "trailing line\n\n");
    const reader = new PlanTicketReader([resolved]);
    assert.equal(await reader.source("foo-plan", "T01"), await readFile(path, "utf8"));
    assert.equal(await reader.source("unknown", "T01"), null);
    assert.equal(await reader.source("foo-plan", "../T01"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
