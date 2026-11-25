import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { change, PLAN, plan, registry, tree } from "./_fixtures.ts";

async function countPlanParses(): Promise<void> {
  const parser = await import("../../../src/registry/plan-source.ts");
  const parse = mock.fn(parser.parseAwsfPlanHtmlV1);
  const context = mock.module("../../../src/registry/plan-source.ts", {
    namedExports: { ...parser, parseAwsfPlanHtmlV1: parse },
  });
  try {
    const { closureDelta } = await import("../../../src/closure/delta.ts");
    const other = { ...registry.plans[0]!, label: "other", planPath: "plans/other.html", ticketsPath: "paired/other" };
    const sources = { plans: [...registry.plans, other] };
    const before = tree();
    before.set(other.planPath, Buffer.from(plan));
    const parsedLabels = () => parse.mock.calls.map(({ arguments: [, label] }) => label);
    assert.equal(closureDelta(before, before, sources).ok, true);
    assert.deepEqual(parsedLabels(), ["sample", "other"]);
    parse.mock.resetCalls();

    const after = change(before, PLAN, '[]</code> Milestone', '[wip]</code> Milestone');
    // The untouched plan can be backed by a newly read buffer with equal bytes.
    after.set(other.planPath, Buffer.from(before.get(other.planPath)!));
    assert.equal(closureDelta(before, after, sources).ok, true);
    assert.deepEqual(parsedLabels(), ["sample"]);
    parse.mock.resetCalls();
    assert.equal(closureDelta(after, after, sources).ok, true);
    assert.deepEqual(parsedLabels(), []);
  } finally {
    context.restore();
  }
}

if (process.argv.includes("--count-plan-parses")) {
  await countPlanParses();
} else {
  test("agreement parses only the registered plan whose bytes changed", () => {
    // Exercise the real parser through Node's module mock without changing the unit gate flags.
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--experimental-test-module-mocks",
      fileURLToPath(import.meta.url), "--count-plan-parses"], { encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  });

  test("agreement cannot reuse a parse after the plan bytes change in place", async () => {
    const { treeAgreement } = await import("../../../src/closure/tree.ts");
    const files = tree();
    const bytes = files.get(PLAN)!;
    assert.deepEqual(treeAgreement(files, registry), []);
    bytes[Buffer.byteLength(plan.slice(0, plan.indexOf("<h4>1."))) + "<h4>".length] = 0x32;
    assert.ok(treeAgreement(files, registry).some((violation) => violation.rule === "TICKET_COVERAGE"));
    bytes[bytes.length - 1] = 0x80;
    assert.throws(() => treeAgreement(files, registry), { code: "E_CLOSURE_TREE", message: `${PLAN}: ${PLAN}: invalid UTF-8` });
  });

  for (const [name, sequence] of [
    ["a truncated sequence", [0xe2, 0x82]],
    ["an overlong form", [0xc0, 0xaf]],
    ["an encoded surrogate", [0xed, 0xa0, 0x80]],
    ["a lone continuation byte", [0x80]],
  ] as const) {
    test(`treeText refuses ${name}`, async () => {
      const { treeText } = await import("../../../src/closure/tree.ts");
      const files = new Map([[PLAN, Uint8Array.from(sequence)]]);
      assert.throws(() => treeText(files, PLAN), { code: "E_CLOSURE_TREE", path: PLAN, message: `${PLAN}: invalid UTF-8` });
    });
  }

  test("treeText decodes only the file's byte span and preserves valid UTF-8", async () => {
    const { treeText } = await import("../../../src/closure/tree.ts");
    const text = "\uFEFFASCII é 🙂 \uFFFD";
    const padded = Uint8Array.from([0x80, ...Buffer.from(text), 0x80]);
    assert.equal(treeText(new Map([[PLAN, padded.subarray(1, -1)]]), PLAN), text);
  });
}
