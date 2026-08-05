import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, walkFiles, relRepo } from "./_walk.ts";

// Advisory only — this suite WARNS via console.warn and never fails the run.
const BUDGETS = {
  "core/src": { min: 6000, max: 9000 },
  "core/src/workflow": { min: 0, max: 800 },
  "dashboard/src": { min: 4000, max: 5500 },
};
const PER_FILE_MAX = 450;

function logicalLines(path: string): number {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//")).length;
}

test("advisory LOC budget (warns only, never fails)", () => {
  for (const [dir, budget] of Object.entries(BUDGETS)) {
    const files = walkFiles(join(repoRoot(), ...dir.split("/")));
    const total = files.reduce((sum, f) => sum + logicalLines(f), 0);
    if (total < budget.min || total > budget.max) {
      console.warn(
        `[loc-budget] ${dir}: ${total} logical lines, outside advisory range ${budget.min}-${budget.max}`,
      );
    }
    for (const f of files) {
      const n = logicalLines(f);
      if (n > PER_FILE_MAX) {
        console.warn(`[loc-budget] ${relRepo(f)}: ${n} logical lines exceeds per-file threshold ${PER_FILE_MAX}`);
      }
    }
  }
});
