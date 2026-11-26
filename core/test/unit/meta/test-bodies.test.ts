import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createTestAudit, parseTestSource } from "./_test-audit.ts";
import { nonEmptyScan } from "./_scope.ts";
import { repoRoot, walkFiles } from "./_walk.ts";

// T25 replaces the advisory LOC test; do not change its behavior here. This
// exact case is the only grandfathered body, not a skip of the whole file.
const ADVISORY = "core/test/unit/meta/loc-budget.test.ts";
const advisoryTest = new Set(["advisory LOC budget (warns only, never fails)"]);

test("suite test bodies have a failure path and no todo or only markers", () => {
  const root = repoRoot();
  const paths = nonEmptyScan("core/test test files", walkFiles(join(root, "core/test")).filter(path => /\.test\.[cm]?[jt]sx?$/u.test(path)));
  const audit = createTestAudit(root);
  const issues = paths.flatMap(path => audit(parseTestSource(path, readFileSync(path, "utf8")), path === join(root, ADVISORY) ? advisoryTest : undefined));
  assert.deepEqual(issues, [], issues.join("\n"));
});

test("test body audit reports planted dormant assertions and forbidden markers", () => {
  const audit = createTestAudit(repoRoot());
  const findings = audit(parseTestSource("planted.test.ts", `
    import { test as check, describe } from "node:test";
    import { equal } from "node:assert/strict";
    function real() { equal(result, expected); }
    function run(cb) { cb(); }
    function ignore(cb) {}
    describe("group", () => {
      check("real", real);
      check("throw", () => { if (wrong) throw new Error("wrong"); });
      check("helper", () => run(real));
      check("no body");
      check("empty", () => {});
      check("printed", () => console.log("assert.equal()"));
      check("dormant", () => { const unused = () => equal(result, expected); });
      check("ignored", () => ignore(real));
      check("unreachable", () => { if (false) real(); return; real(); });
      check("swallowed", () => { try { real(); } catch {} });
      check["only"]("focus", real);
      check.todo("later");
      check("marked", { todo: "later", ["only"]: true }, real);
      check("nested", async t => { await t.test("child", real); t.todo(); });
      check("platform", { skip: process.platform !== "linux", only: false }, real);
    });`));
  assert.deepEqual(findings.map(issue => issue.replace(/^planted\.test\.ts:\d+: /u, "")), [
    "no reachable assertion or throw: no body",
    "no reachable assertion or throw: empty",
    "no reachable assertion or throw: printed",
    "no reachable assertion or throw: dormant",
    "no reachable assertion or throw: ignored",
    "no reachable assertion or throw: unreachable",
    "no reachable assertion or throw: swallowed",
    "only test marker", "todo test marker", "todo test option", "only test option", "todo test marker",
  ]);
});
