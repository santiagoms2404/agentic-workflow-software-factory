import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { repoRoot } from "./_walk.ts";

const REQUIRED = ["unit", "contract", "sim", "journeys", "traps"];

// Only count direct, unfiltered layer invocations. In particular an echo, a
// comment, or `npm run test:unit -- some.test.ts` is not running the layer.
function layer(command: unknown): string | undefined {
  if (typeof command !== "string") return undefined;
  return /^npm[ \t]+run[ \t]+test:([\w-]+)$/u.exec(command.trim())?.[1];
}

function rootLayers(script: string): string[] {
  // The root dispatcher uses semicolon-separated commands for independent
  // exits. Tokenize quoted strings as units so a printed command is not one.
  const commands = script.match(/(?:"(?:\\.|[^"\\])*"|'[^']*'|[^;\r\n"'])+/gu) ?? [];
  return commands.flatMap(command => layer(command) ?? []);
}

function disabled(condition: unknown): boolean {
  return condition === false || (typeof condition === "string" && /^(?:\$\{\{\s*false\s*\}\}|false)$/iu.test(condition.trim()));
}

function ciLayers(workflow: string): string[] {
  type Step = { run?: unknown; if?: unknown };
  const ci = parse(workflow) as { jobs?: Record<string, { steps?: Step[]; if?: unknown }> } | null;
  return Object.values(ci?.jobs ?? {}).flatMap(job => disabled(job.if) ? [] :
    (job.steps ?? []).flatMap(step => disabled(step.if) ? [] : layer(step.run) ?? []));
}

function checkLayers(script: string, workflow: string): void {
  const root = rootLayers(script);
  const ci = ciLayers(workflow);
  const expected = new Set([...REQUIRED, ...root, ...ci]);
  const problems: string[] = [];
  for (const name of expected) {
    for (const [source, layers] of [["root test script", root], ["CI", ci]] as const) {
      const count = layers.filter(candidate => candidate === name).length;
      if (count !== 1) problems.push(`${source}: ${count === 0 ? "missing" : "repeated"} test:${name}`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
}

test("CI and the root test script run the same test layers", () => {
  const root = repoRoot();
  const { scripts } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: { test: string } };
  checkLayers(scripts.test, readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"));
});

test("layer comparison reports missing layers on either side and ignores inert mentions", () => {
  const dispatcher = REQUIRED.map(name => `npm run test:${name}`).join("; ");
  const workflow = (layers: readonly string[]) => `jobs:\n  verify:\n    steps:\n${layers.map(name => `      - run: npm run test:${name}`).join("\n")}`;
  assert.doesNotThrow(() => checkLayers(dispatcher, workflow(REQUIRED)));
  assert.throws(() => checkLayers(dispatcher, `${workflow(REQUIRED.slice(0, -1))}\n      # - run: npm run test:traps`), /CI: missing test:traps/u);
  assert.throws(() => checkLayers(dispatcher.replace("npm run test:traps", 'echo "; npm run test:traps; "'), workflow(REQUIRED)), /root test script: missing test:traps/u);
  assert.throws(() => checkLayers(`${dispatcher}; npm run test:extra`, workflow(REQUIRED)), /CI: missing test:extra/u);
  assert.throws(() => checkLayers(dispatcher, `${workflow(REQUIRED)}\n        if: \u0024{{ false }}`), /CI: missing test:traps/u);
  assert.throws(() => checkLayers("", ""), /root test script: missing test:unit\nCI: missing test:unit/u);
});
