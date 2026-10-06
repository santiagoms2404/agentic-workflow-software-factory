import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { relRepo, repoRoot, walkFiles } from "./_walk.ts";

interface Source { readonly path: string; readonly text: string }
const RENDERER = "core/src/lifecycle/renderer.ts";

/** Written source includes escaped backticks in template literals. The renderer is the only exemption. */
function proseOffenders(sources: readonly Source[]): string[] {
  return sources.flatMap(({ path, text }) => path === RENDERER ? [] : text.split("\n").flatMap((line, index) =>
    /\brun\s+\\?`awsf\b/iu.test(line) ? [`${path}:${index + 1}`] : []));
}

function assertRenderedAdvice(sources: readonly Source[]): void {
  assert.deepEqual(proseOffenders(sources), [], "literal next-step prose belongs only in the lifecycle renderer");
}

test("all core source is free of literal run-awsf next-step sentences", () => {
  const files = walkFiles(join(repoRoot(), "core/src"), [".ts", ".mts"]);
  assert.ok(files.length > 0, "the core sweep must not be vacuous");
  for (const path of ["core/src/cli/main.ts", "core/src/cli/commands/attempt.ts", "core/src/workflow/prove/compile.ts", "core/src/git/worktrees.ts", RENDERER]) {
    assert.ok(files.some(file => relRepo(file) === path), `${path} is outside the sweep`);
  }
  assertRenderedAdvice(files.map(file => ({ path: relRepo(file), text: readFileSync(file, "utf8") })));
  const renderer = readFileSync(join(repoRoot(), RENDERER), "utf8");
  assert.ok(proseOffenders([{ path: "core/src/cli/planted.ts", text: renderer }]).length > 0,
    "the matcher must see the renderer's real source spelling");
  assertRenderedAdvice([{ path: RENDERER, text: renderer }]);
});

test("the same prose fence bites planted plain and escaped literals in any core module but the renderer", () => {
  for (const path of ["core/src/cli/main.ts", "core/src/cli/commands/attempt.ts", "core/src/cli/commands/recovery.ts", "core/src/cli/renderer.ts",
    "core/src/workflow/prove/compile.ts", "core/src/git/worktrees.ts", "core/src/lifecycle/next-steps.ts"]) {
    for (const text of [
      'const advice = "run `awsf cancel TASK`";',
      "const advice = `run \\`awsf land ${taskId}\\``;",
      'throw new Error("Run `awsf next TASK`");',
    ]) {
      const source = { path, text: `// planted offline\n${text}\n` };
      assert.deepEqual(proseOffenders([source]), [`${path}:2`]);
      assert.throws(() => assertRenderedAdvice([source]), { name: "AssertionError" });
    }
  }
  assertRenderedAdvice([{ path: "core/src/cli/main.ts", text: [
    "out(renderAttemptNextAction(status));",
    "const argv = ['awsf', 'run', taskId];",
    "// `awsf review` is an owner command, not a next-step sentence.",
  ].join("\n") }]);
});
