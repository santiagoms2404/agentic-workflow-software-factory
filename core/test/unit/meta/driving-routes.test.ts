import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { relRepo } from "./_walk.ts";
import { DRIVING_REL, drivingDir } from "./_driving.ts";

// The router's route table names the documents a driving session is told to
// load. A row pointing at a file that does not exist is exactly the drift
// "reference, never duplicate" exists to prevent — and it is the drift a router
// is MOST prone to, because a table is edited when a document is planned and a
// document is written later or not at all.
//
// driving-tree.test.ts proves the tree is walked. This proves the tree is
// wired: every relative path the router advertises resolves to a real file
// inside the tree, and there is more than one of them, so a router stripped
// back to a single row cannot pass by saying less.

const ROUTER_REL = `${DRIVING_REL}/skills/awsf/SKILL.md`;
const ROUTER = join(drivingDir(), "skills", "awsf", "SKILL.md");

/**
 * A route is a backticked relative markdown PATH — one carrying a directory
 * component. That requirement is the discriminator, not an accident of the
 * current layout: every routable document in this tree sits under `cookbooks/`
 * or `references/`, while a bare basename in the router names a file elsewhere
 * in the repository (`AGENTS.md`, `awsf.config.yaml`) and asserting those
 * resolve inside the tree would be asserting the opposite of the truth.
 *
 * Deliberately NOT scoped to the table's own markup: a route moved into a
 * sentence is still a route, and a scanner that only read table cells would
 * stop seeing it the moment the document was reorganized.
 *
 * Parent-relative paths carry their own separators, so a `../` route escaping
 * the tree is reported rather than silently skipped.
 *
 * The residual case is a router that one day names a repository markdown file
 * BY PATH — this would report it, and the right answer then is to make the
 * router unambiguous rather than to loosen the matcher.
 */
const ROUTE = /`((?:[\w.-]+\/)+[\w.-]+\.md)`/g;

function routes(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(ROUTE)].map((match) => match[1] ?? ""))];
}

test("every document the router routes to exists inside the driving tree", () => {
  assert.ok(existsSync(ROUTER), `${ROUTER_REL} is missing — the tree has no router to check`);
  const found = routes(readFileSync(ROUTER, "utf8"));

  assert.ok(
    found.length >= 2,
    `${ROUTER_REL} advertises ${String(found.length)} route(s); a router that names nothing cannot go stale, ` +
      `and cannot be useful either`,
  );

  const root = normalize(drivingDir());
  const offenders: string[] = [];
  for (const route of found) {
    const resolved = normalize(join(dirname(ROUTER), route));
    if (!resolved.startsWith(root)) {
      offenders.push(`${route} — resolves outside ${DRIVING_REL}/`);
      continue;
    }
    if (!existsSync(resolved)) offenders.push(`${route} — no such file at ${relRepo(resolved)}`);
  }
  assert.deepEqual(offenders, [], `${ROUTER_REL} routes to ${String(offenders.length)} document(s) that are not there`);
});

test("the route matcher bites, and reads routes outside a table too", () => {
  // Guards the failure mode where the pattern silently stops matching and the
  // test above reports green over a router it can no longer read.
  const specimen = [
    "| prepare and launch a new task | `cookbooks/preflight_a_task.md` |",
    "| something surprised you | `references/gotchas.md` |",
    "",
    "Prose naming `cookbooks/run_and_observe.md` is a route too.",
    "An escape to `../../../README.md` must be reported, not skipped.",
    "But `AGENTS.md` is a repository file this router cites, not a route into",
    "the tree, and neither is `awsf.config.yaml` or an inline `awsf status`.",
  ].join("\n");

  assert.deepEqual(routes(specimen), [
    "cookbooks/preflight_a_task.md",
    "references/gotchas.md",
    "cookbooks/run_and_observe.md",
    "../../../README.md",
  ]);
});
