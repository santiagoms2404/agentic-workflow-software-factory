import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { K1_FIELD_IDS } from "../../../src/contracts/driver-preflight.ts";
import { repoRoot } from "./_walk.ts";

// W01 task 13: the forensics map in the plan's Notes, re-checked against the
// eight driver rows the owner confirmed at G01-F (2026-10-05). Every row is
// either refused by a named test, which must still exist under that name, or
// out of K1's reach with a taker and a reason that match the plan's own table. The plan
// is read, never written: if the owner corrects a row, this test fails until
// the map below says the same.

const PLAN = "specs/awsf-v3-w01-driver-checks.html";

interface NamedTest { readonly file: string; readonly title: string }

/** The rows K1 refuses, by the tests that name them. A title is matched as source text, so a loop's template literal is matched whole. */
const IN_REACH: Readonly<Record<string, { readonly fields: readonly string[]; readonly taker: string; readonly tests: readonly NamedTest[] }>> = {
  "27": {
    fields: ["request-shape", "write-boundary"], taker: "K1; remainder W02",
    tests: [
      { file: "core/test/unit/preflight/fields.test.ts", title: "request-shape refuses forensics #27's one-line request" },
      { file: "core/test/unit/preflight/fields.test.ts", title: "write-boundary on a shift refuses a where entry outside what a shift builder can write (forensics #27)" },
      { file: "core/test/journeys/k1-driver-checks.test.ts", title: "`K1 ${field}: awsf start --stub true refuses" },
    ],
  },
  "34": {
    fields: ["protected-paths"], taker: "K1",
    tests: [
      { file: "core/test/unit/preflight/fields.test.ts", title: "protected-paths refuses forensics #34's request until the protected path it names as context is classified" },
      { file: "core/test/journeys/k1-driver-checks.test.ts", title: "`K1 ${field}: awsf start --stub true refuses" },
      { file: "core/test/journeys/production-runner.test.ts", title: "T12 build-review planning a protected builder path refuses before L4 with no call reserved, and runs after the owner's grant" },
    ],
  },
  "36": {
    fields: ["git-storage"], taker: "K1",
    tests: [
      { file: "core/test/unit/preflight/fields.test.ts", title: "git-storage refuses all-0777 modes (forensics #36), an unreadable entry and no measurement" },
      { file: "core/test/journeys/k1-driver-checks.test.ts", title: "`K1 ${field}: awsf start --stub true refuses" },
    ],
  },
};

/** The rows decided at run time. K1 has no field for them; each names the workstream that takes it and the plan's reason it is out of reach. */
const OUT_OF_REACH: Readonly<Record<string, { readonly taker: string; readonly reason: string }>> = {
  "11": {
    taker: "W02",
    reason: "The failure is in the run's launch environment. The blocker shows claude searched on npm's node_modules/.bin PATH. " +
      "ClaudeCodeAdapter.isAvailable() validates the name and never resolves it (core/src/adapters/claude-code.ts:345–354).",
  },
  "14": { taker: "W02", reason: "A route-and-request rule over an open factory defect, not a preparation fact" },
  "17": { taker: "W02", reason: "as #11" },
  "18": { taker: "W02, W06", reason: "Quota moves between start and run; it is measured where calls are reserved" },
  "22": { taker: "W02, W06", reason: "as #18" },
};

interface PlanRow {
  readonly id: string;
  readonly attempt: string;
  readonly trap: string;
  readonly k1: string;
  /** The "Out of K1's reach because" cell. */
  readonly reason: string;
  readonly taker: string;
}

const plain = (cell: string): string => cell.replace(/<[^>]*>/gu, "").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&").replace(/\s+/gu, " ").trim();

function planRows(): PlanRow[] {
  const html = readFileSync(join(repoRoot(), PLAN), "utf8");
  const notes = html.slice(html.indexOf("<h3>The forensics map, the acceptance bar</h3>"));
  const table = notes.slice(0, notes.indexOf("</table>"));
  return [...table.matchAll(/<tr>((?:<td>[\s\S]*?<\/td>){6})<\/tr>/gu)].map((row) => {
    const cells = [...row[1]!.matchAll(/<td>([\s\S]*?)<\/td>/gu)].map((cell) => plain(cell[1]!));
    return { id: cells[0]!, attempt: cells[1]!, trap: cells[2]!, k1: cells[3]!, reason: cells[4]!, taker: cells[5]! };
  });
}

test("the forensics map's eight rows are the owner's G01-F rows, each in reach or out of it exactly once", () => {
  const rows = planRows();
  assert.deepEqual(rows.map((row) => row.id), ["11", "14", "17", "18", "22", "27", "34", "36"]);
  assert.deepEqual([...Object.keys(IN_REACH), ...Object.keys(OUT_OF_REACH)].sort(), rows.map((row) => row.id).sort());
});

test("every row K1 reaches names K1 fields, and each is refused by tests that still exist under their names", () => {
  const rows = new Map(planRows().map((row) => [row.id, row]));
  for (const [id, expected] of Object.entries(IN_REACH)) {
    const row = rows.get(id)!;
    assert.equal(row.taker, expected.taker, `row #${id}`);
    for (const field of expected.fields) {
      assert.ok((K1_FIELD_IDS as readonly string[]).includes(field), `row #${id}: ${field} is not a K1 field id`);
      assert.ok(row.k1.includes(field), `row #${id} no longer names ${field} in the plan: ${row.k1}`);
    }
    for (const { file, title } of expected.tests) {
      assert.ok(existsSync(join(repoRoot(), file)), `row #${id}: ${file} is gone`);
      assert.ok(readFileSync(join(repoRoot(), file), "utf8").includes(title), `row #${id}: ${file} has no test named ${title}`);
    }
  }
});

test("every row outside K1's reach has no K1 field and the taker and reason the plan names", () => {
  const rows = new Map(planRows().map((row) => [row.id, row]));
  for (const [id, expected] of Object.entries(OUT_OF_REACH)) {
    const row = rows.get(id)!;
    assert.equal(row.k1, "—", `row #${id} now claims a K1 field: ${row.k1}`);
    assert.equal(row.taker, expected.taker, `row #${id}`);
    assert.equal(row.reason, expected.reason, `row #${id}'s reason in the plan no longer matches the map`);
  }
});

test("each K1 field has a CLI refusal journey and a direct start refusal, both named with its id", () => {
  for (const file of ["core/test/journeys/k1-driver-checks.test.ts", "core/test/unit/cli/start-k1.test.ts"]) {
    const text = readFileSync(join(repoRoot(), file), "utf8");
    assert.match(text, /for \(const field of K1_FIELD_IDS\)/u, `${file} no longer loops over every K1 field id`);
    assert.match(text, /`K1 \$\{field\}: /u, `${file} no longer names each test with its field id`);
    // A field cannot be dropped from the case table without the compiler noticing.
    assert.match(text, /Record<K1FieldId,/u, `${file} no longer types its cases over every K1 field`);
  }
});
