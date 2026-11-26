import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { extname } from "node:path";
import { CODE_EXTS } from "./_walk.ts";

export const SCOPE_EXTENSIONS = [...CODE_EXTS, ".sh", ".sql", ".css", ".html", ".yml", ".yaml"] as const;
const yaml = (path: string) => /\.ya?ml$/u.test(path);
const script = (path: string) => CODE_EXTS.some(ext => path.endsWith(ext)) || path.endsWith(".sh");
const under = (directory: string, matches: (path: string) => boolean) =>
  (path: string) => path.startsWith(`${directory}/`) && matches(path);
const suffix = (extension: string) => (path: string) => path.endsWith(extension);

// Areas are disjoint by path AND kind. A TypeScript matcher in dashboard/src
// does not read its styles; the migration subtree similarly has its own area.
export const AREAS = {
  core: under("core/src", script),
  dashboard: under("dashboard/src", script),
  shared: under("dashboard/shared", script),
  dashboardBuild: (path: string) => /^dashboard\/vite\.config\.[^.]+$/.test(path) && script(path),
  dashboardMarkup: (path: string) => path === "dashboard/index.html",
  driving: under("docs/driving", script),
  tests: under("core/test", script),
  migrations: under("core/src/observability/migrations", suffix(".sql")),
  dashboardStyles: under("dashboard/src", suffix(".css")),
  designStyles: under("specs/design", suffix(".css")),
  designMarkup: under("specs/design", suffix(".html")),
  docMarkup: under("docs", suffix(".html")),
  planMarkup: (path: string) => /^specs\/[^/]+\.html$/.test(path),
  ci: under(".github/workflows", yaml),
  hostConfig: (path: string) => path === "awsf.config.yaml",
  projectCatalog: (path: string) => path === "awsf.project.yaml",
  taskRunner: (path: string) => path === "justfile",
} satisfies Record<string, (path: string) => boolean>;

export type Area = keyof typeof AREAS;

export function trackedFiles(root: string): string[] {
  // -z keeps spaces, newlines and non-ASCII paths intact. --cached includes
  // newly staged paths; --deduplicate avoids repeated unmerged index entries.
  return execFileSync("git", ["ls-files", "--cached", "--deduplicate", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0").filter(Boolean);
}

function isCode(path: string): boolean {
  if (path === "justfile") return true;
  return (SCOPE_EXTENSIONS as readonly string[]).includes(extname(path));
}

export function nonEmptyScan<T>(name: string, entries: readonly T[]): readonly T[] {
  assert.ok(entries.length > 0, `empty scan root: ${name}`);
  return entries;
}

export function scopeMap(root: string, tracked = trackedFiles(root)): ReadonlyMap<Area, readonly string[]> {
  const areas = Object.keys(AREAS) as Area[];
  const files = new Map(areas.map(area => [area, [] as string[]]));
  const errors: string[] = [];
  for (const path of nonEmptyScan("Git index", tracked).filter(isCode)) {
    const matches = areas.filter(area => AREAS[area](path));
    if (matches.length !== 1) errors.push(`${path}: ${matches.length === 0 ? "no area" : `overlap: ${matches.join(", ")}`}`);
    else files.get(matches[0]!)!.push(path);
  }
  assert.deepEqual(errors, [], `tracked code scope errors:\n${errors.join("\n")}`);
  return files;
}
