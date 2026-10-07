import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { join, relative } from "node:path";
import { matchesPathGlob } from "../../src/policy/path-policy.ts";
import { NO_TRAP_KINDS, type BlockerCoverage, type PendingEntry, type TrapEntry } from "../../src/traps/catalogue.ts";

export interface SourceFile { path: string; text: string }
export interface MarkerPair { id: string; path: string; begin: number; end: number }
export const PROTECTED_TRAP_PATHS = [
  "core/src/state/**", "core/src/policy/**", "core/src/execution/transport-broker.ts",
  "core/src/observability/migrations/**", "docs/driving/**", "AGENTS.md",
  "awsf.config.yaml", "awsf.project.yaml", "package.json",
] as const;

/** No symlink traversal: a scratch mutation must never write through to its base. */
export function treeFiles(root: string, directory: string): SourceFile[] {
  const out: SourceFile[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir).sort()) {
      if (["node_modules", ".git", "dist"].includes(entry)) continue;
      const path = join(dir, entry);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`trap tree contains symlink: ${path}`);
      if (stat.isDirectory()) walk(path);
      else if (entry.endsWith(".ts")) out.push({ path: relative(root, path).split("\\").join("/"), text: readFileSync(path, "utf8") });
    }
  }
  walk(join(root, directory));
  return out;
}

/** Line numbers are zero-based and include neither marker in the removed block. */
export function markerPairs(files: readonly SourceFile[], protectedPaths: readonly string[] = PROTECTED_TRAP_PATHS): MarkerPair[] {
  const pairs: MarkerPair[] = [];
  for (const file of files) {
    let open: { id: string; begin: number } | null = null;
    const lines = file.text.split("\n");
    lines.forEach((line, index) => {
      if (!line.includes("trap-refusal-")) return;
      const match = /^\s*\/\/ trap-refusal-(begin|end) (TR-\d{2,})\s*$/u.exec(line);
      if (match === null) throw new Error(`malformed trap marker: ${file.path}:${index + 1}`);
      if (protectedPaths.some(glob => matchesPathGlob(file.path, glob))) throw new Error(`protected trap marker: ${file.path}`);
      const id = match[2]!;
      if (match[1] === "begin") {
        if (open !== null) throw new Error(`nested trap marker: ${file.path}:${index + 1}`);
        open = { id, begin: index };
      } else {
        if (open === null || open.id !== id) throw new Error(`unbalanced trap marker ${id}: ${file.path}:${index + 1}`);
        if (!lines.slice(open.begin + 1, index).some(text => text.trim() !== "" && !text.trim().startsWith("//"))) {
          throw new Error(`empty trap refusal ${id}: ${file.path}`);
        }
        pairs.push({ id, path: file.path, begin: open.begin, end: index });
        open = null;
      }
    });
    if (open !== null) throw new Error(`unclosed trap marker: ${file.path}`);
  }
  return pairs;
}

export function assertCatalogueFence(input: {
  traps: readonly TrapEntry[];
  pending: readonly PendingEntry[];
  sources: readonly SourceFile[];
  tests: readonly string[];
  blockers: Readonly<Record<string, readonly string[]>>;
  coverage: readonly BlockerCoverage[];
  protectedPaths?: readonly string[];
  /** T03 only: exact T02 entries await T04 adoption, not M4 gaps.
   * Callers must explicitly supply this list; strict validation is the default.
   */
  awaitingAdoption?: readonly string[];
}): void {
  const ids = input.traps.map(trap => trap.id);
  if (new Set(ids).size !== ids.length) throw new Error("duplicate trap id");
  ids.forEach((id, index) => {
    if (id !== `TR-${String(index + 1).padStart(2, "0")}`) throw new Error(`non-contiguous trap id: ${id}`);
  });
  for (const pending of input.pending) {
    if (!["T08", "T09", "T10", "T11", "T12"].includes(pending.task)) throw new Error(`pending trap outside M4: ${pending.task}`);
  }
  const pairs = markerPairs(input.sources, input.protectedPaths);
  for (const pair of pairs) if (!ids.includes(pair.id as TrapEntry["id"])) throw new Error(`marker with no entry: ${pair.id}`);
  const tests = input.tests.map(path => {
    const match = /^core\/test\/traps\/(TR-\d{2,})-[a-z0-9-]+\.test\.ts$/u.exec(path);
    if (match === null) throw new Error(`malformed trap test path: ${path}`);
    if (!ids.includes(match[1]! as TrapEntry["id"])) throw new Error(`test with no entry: ${path}`);
    return match[1]!;
  });
  for (const id of ids) {
    const markerCount = pairs.filter(pair => pair.id === id).length;
    const testCount = tests.filter(testId => testId === id).length;
    if (input.awaitingAdoption?.includes(id) && markerCount === 0 && testCount === 0) continue;
    if (testCount !== 1) throw new Error(`entry with ${testCount} tests: ${id}`);
    if (markerCount !== 1) throw new Error(`entry with ${markerCount} marker pairs: ${id}`);
  }
  const expected = Object.entries(input.blockers).flatMap(([edge, codes]) => codes.map(code => `${edge}:${code}`));
  const covered: string[] = [];
  for (const row of input.coverage) {
    const key = `${row.edge}:${row.code}`;
    if (!expected.includes(key)) throw new Error(`coverage for unknown blocker: ${key}`);
    if (covered.includes(key)) throw new Error(`duplicate blocker coverage: ${key}`);
    covered.push(key);
    if (!row.evidence.trim()) throw new Error(`blocker coverage lacks evidence: ${key}`);
    if ("family" in row.target) {
      const family = row.target.family;
      if (!input.traps.some(trap => trap.family === family)) throw new Error(`unknown coverage family: ${key}`);
    } else if (!(NO_TRAP_KINDS as readonly string[]).includes(row.target.kind)) throw new Error(`unknown no-trap coverage kind: ${key}`);
  }
  for (const key of expected) if (!covered.includes(key)) throw new Error(`uncovered blocker code: ${key}`);
}
