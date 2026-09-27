import { test } from "node:test";
import assert from "node:assert/strict";
import { TOOL_CLASS_BY_NAME, TOOL_CLASSES, toolClass } from "../../src/metrics/tool-class.ts";

test("every tool name measured in F6 folds into its class, whatever its case", () => {
  // The thirteen spellings in the owner's database on 2026-09-26, pi and Claude Code alike.
  const measured: ReadonlyArray<readonly [string, string]> = [
    ["read", "read"],
    ["bash", "exec"],
    ["Read", "read"],
    ["grep", "search"],
    ["edit", "edit"],
    ["Grep", "search"],
    ["Glob", "search"],
    ["find", "search"],
    ["write", "edit"],
    ["Bash", "exec"],
    ["ls", "search"],
    ["Edit", "edit"],
    ["Write", "edit"],
  ];
  assert.equal(measured.length, 13);
  for (const [name, expected] of measured) assert.equal(toolClass(name), expected, name);
});

test("an unlisted name is other, including one that shadows an object property", () => {
  for (const name of ["WebFetch", "TodoWrite", "NotebookEdit", "", "constructor", "toString", "__proto__"]) {
    assert.equal(toolClass(name), "other", JSON.stringify(name));
  }
});

test("the class vocabulary is exactly five, in display order, and the table is frozen", () => {
  assert.deepEqual([...TOOL_CLASSES], ["read", "search", "edit", "exec", "other"]);
  assert.equal(Object.isFrozen(TOOL_CLASS_BY_NAME), true);
});
