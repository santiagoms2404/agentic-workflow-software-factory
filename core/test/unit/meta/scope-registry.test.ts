import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { META, REGISTRY, UNREAD_AREAS, type Fence, type ScanRoot } from "./_fences.ts";
import { nonEmptyScan, scopeMap, trackedFiles, type Area } from "./_scope.ts";
import { parseTestSource, registeredTestNames } from "./_test-audit.ts";
import { repoRoot } from "./_walk.ts";

const root = repoRoot();
type Scan = (selector: ScanRoot) => readonly string[];

function requireInputs(label: string, row: Fence, inputs: Scan, areaFiles: (area: Area) => readonly string[]): void {
  for (const area of row.areas) nonEmptyScan(`${label} — ${area}`, areaFiles(area));
  for (const selector of row.roots) {
    const name = typeof selector === "string" ? selector : `${selector.prefix} (${selector.extensions.join(", ")})`;
    nonEmptyScan(`${label} — ${name}`, inputs(selector));
  }
  assert.ok(row.areas.length + row.roots.length > 0, `${label}: no scan inputs`);
}

function checkRegistry(files: ReadonlyMap<string, string>, registry: typeof REGISTRY): void {
  nonEmptyScan(META, [...files]);
  const errors: string[] = [];
  for (const file of files.keys()) if (!Object.hasOwn(registry, file)) errors.push(`unregistered meta file: ${file}`);
  for (const [file, row] of Object.entries(registry)) {
    const text = files.get(file);
    if (text === undefined) {
      errors.push(`stale registration: ${file}`);
      continue;
    }
    if ("reason" in row) {
      if (!row.reason.trim()) errors.push(`${file}: not-a-fence reason is empty`);
      continue;
    }
    const testNames = registeredTestNames(parseTestSource(file, text));
    if (row.fences.length === 0) errors.push(`${file}: no registered rules`);
    for (const fence of row.fences) {
      if (!fence.rule.trim() || fence.plants.length === 0) errors.push(`${file}: rule or planted cases missing`);
      for (const plant of fence.plants) {
        if (!testNames.has(plant)) errors.push(`${file}: missing plant test ${plant}`);
      }
      if (fence.plants.includes('`T22 plants: ${fence.name}`') &&
          (!testNames.has('`T22 fence: ${fence.name}`') || !text.includes(`name: ${JSON.stringify(fence.rule)}`))) {
        errors.push(`${file}: missing T22 rule ${fence.rule}`);
      }
    }
    const plants = new Set(row.fences.flatMap(fence => fence.plants));
    if (![...testNames].some(name => !plants.has(name))) errors.push(`${file}: no live rule test separate from its plants`);
  }
  assert.deepEqual(errors, [], errors.join("\n"));
}

function areaReaders(area: Area, registry = REGISTRY): string[] {
  return Object.entries(registry).flatMap(([file, row]) => "fences" in row
    ? row.fences.filter(fence => fence.areas.includes(area)).map(fence => `${file}: ${fence.rule}`) : []);
}

function checkAreaReaders(scopes: ReadonlyMap<Area, readonly string[]>, readers = areaReaders, exceptions = UNREAD_AREAS): void {
  const errors: string[] = [];
  for (const area of scopes.keys()) {
    const names = readers(area);
    const reason = exceptions[area];
    if (names.length === 0 && !reason?.trim()) errors.push(`${area}: no fence reads this area and no reason is recorded`);
    if (names.length > 0 && reason !== undefined) errors.push(`${area}: stale unread reason; read by ${names.join(", ")}`);
  }
  assert.deepEqual(errors, [], errors.join("\n"));
}

function entries(directory: string): [string, string][] {
  return readdirSync(join(root, META, directory), { withFileTypes: true }).flatMap(entry => {
    const name = directory === "" ? entry.name : `${directory}/${entry.name}`;
    return entry.isDirectory() ? entries(name) : [[name, readFileSync(join(root, META, name), "utf8")]];
  });
}

function readable(path: string): boolean {
  const stat = statSync(join(root, path), { throwIfNoEntry: false });
  return stat?.isFile() === true && stat.size > 0;
}

test("every meta file is registered and each registered scan has live inputs", () => {
  checkRegistry(new Map(entries("")), REGISTRY);
  const tracked = trackedFiles(root);
  const scopes = scopeMap(root, tracked);
  checkAreaReaders(scopes);
  const live = tracked.filter(readable);
  const liveSet = new Set(live);
  const areas = new Map([...scopes].map(([area, paths]) => [area, paths.filter(path => liveSet.has(path))]));
  for (const [area, paths] of areas) nonEmptyScan(area, paths);
  const scan: Scan = selector => {
    if (typeof selector !== "string") {
      return live.filter(path => path.startsWith(selector.prefix) && selector.extensions.some(ext => path.endsWith(ext)));
    }
    if (selector === "$git-history") {
      return execFileSync("git", ["rev-list", "--all", "--max-count=1"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
    }
    if (selector === "$git-index") return tracked;
    return live.filter(selector.endsWith("/") ? path => path.startsWith(selector) : path => path === selector);
  };
  for (const [file, row] of Object.entries(REGISTRY)) {
    if (!("fences" in row)) continue;
    for (const fence of row.fences) requireInputs(`${file}: ${fence.rule}`, fence, scan, area => areas.get(area) ?? []);
  }
});

test("Git-backed scope names a staged code file with no area", t => {
  const fixture = mkdtempSync(join(tmpdir(), "awsf-scope-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: fixture, stdio: "pipe" });
  git("init", "--quiet");
  const paths = [
    ["core", "core/src/a.ts"], ["dashboard", "dashboard/src/App.vue"], ["shared", "dashboard/shared/a.ts"],
    ["driving", "docs/driving/a.sh"], ["migrations", "core/src/observability/migrations/a.sql"],
    ["dashboardStyles", "dashboard/src/a.css"], ["designStyles", "specs/design/a.css"], ["ci", ".github/workflows/a.yaml"],
    ["hostConfig", "awsf.config.yaml"], ["projectCatalog", "awsf.project.yaml"],
  ] as const;
  // Use the fixture index as the inventory, with no commits or staged paths in the assigned worktree.
  for (const [, path] of paths) {
    const target = join(fixture, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "fixture\n");
    git("add", "--", path);
  }
  const map = scopeMap(fixture);
  for (const [area, path] of paths) assert.deepEqual(map.get(area), [path], area);
  const planted = "stray script.sh";
  writeFileSync(join(fixture, planted), "# fixture\n");
  assert.deepEqual(scopeMap(fixture), map, "an untracked file does not enter the Git scope");
  git("add", "--", planted);
  assert.throws(() => scopeMap(fixture), /stray script\.sh: no area/u);
});

test("the registry rejects unlisted files, stale rows, missing plant tests and empty inputs", () => {
  const source = 'import { test } from "node:test"; test("rule", () => {}); test("plant", () => {});';
  const planted = { rule: "fixture rule", areas: ["core"], roots: ["required.ts"], plants: ["plant"] } as const;
  const row = { fences: [planted] };
  assert.throws(() => checkRegistry(new Map([["new.test.ts", source]]), {}), /unregistered meta file: new\.test\.ts/u);
  assert.throws(() => checkRegistry(new Map([["new.test.ts", source]]), { "new.test.ts": row, "gone.test.ts": row }), /stale registration: gone\.test\.ts/u);
  assert.throws(() => checkRegistry(new Map([["new.test.ts", source.replace('test("plant"', '// test("plant"')]]), { "new.test.ts": row }), /missing plant test plant/u);
  assert.throws(() => checkRegistry(new Map([["new.test.ts", source.replace('test("rule", () => {}); ', "")]]), { "new.test.ts": row }), /no live rule test/u);
  assert.throws(() => requireInputs("fixture", planted, () => [], () => ["core/src/live.ts"]), /empty scan root: fixture — required\.ts/u);
  assert.throws(() => requireInputs("fixture", planted, () => ["required.ts"], () => []), /empty scan root: fixture — core/u);
  for (const [name, entry] of Object.entries(REGISTRY)) {
    if (!("fences" in entry)) continue;
    for (const fence of entry.fences) assert.throws(() => requireInputs(name, fence, () => [], () => []), /empty scan root/u, name);
  }
  const area = new Map<Area, readonly string[]>([["core", ["core/src/a.ts"]]]);
  assert.throws(() => checkAreaReaders(area, () => [], {}), /core: no fence reads this area/u);
  assert.throws(() => checkAreaReaders(area, () => ["reader"], { core: "unused" }), /core: stale unread reason/u);
});
