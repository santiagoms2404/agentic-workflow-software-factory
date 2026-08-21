import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { relRepo } from "./_walk.ts";
import { DRIVING_REL, drivingDir, drivingDocs } from "./_driving.ts";

// A route table names the documents a driving session is told to load. A row
// pointing at a file that does not exist is exactly the drift "reference, never
// duplicate" exists to prevent — and it is the drift a router is MOST prone to,
// because a table is edited when a document is planned and a document is
// written later or not at all.
//
// driving-tree.test.ts proves the tree is walked. This proves the tree is
// wired: every relative path ANY document in the tree advertises resolves to a
// real file inside the tree. The router additionally owes more than one route,
// so a router stripped back to a single row cannot pass by saying less.
//
// The scan is tree-wide rather than router-only because the router is not the
// only document that may route. Two properties are deliberately NOT tree-wide:
//
//   THE ≥2 FLOOR   belongs to the router and to nothing else. A cookbook with
//                  no routes is normal; applied tree-wide the floor would fail
//                  on every cookbook in the tree the moment it was written.
//   THE BASE       is each document's OWN directory, never the router's. A
//                  route in `references/` resolved against `skills/awsf/` would
//                  find the router's cookbooks and pass for the wrong reason.
//
// Every failure names the offending FILE and the route. A tree-wide scan that
// reports only "a route is broken" is worse than the single-file version it
// replaces.

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
export const ROUTE = /`((?:[\w.-]+\/)+[\w.-]+\.md)`/g;

/**
 * Exported because driving-contract.test.ts asserts the contract declares NO
 * route, and that has to be the SAME property this file checks. Two copies of
 * one regex is how a property quietly stops being one property.
 */
export function routes(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(ROUTE)].map((match) => match[1] ?? ""))];
}

/**
 * Every route in `markdown` that does not land on a real file inside the tree,
 * as `route — what is wrong`.
 *
 * `file` is the ABSOLUTE path of the document that declares the routes, and its
 * directory is the base every route resolves against. Passing the router's path
 * for another document's text is the bug this signature exists to make hard to
 * write: it is the one mistake that turns a broken route green.
 *
 * Text-only — the declaring file is never read here, so a companion can hand
 * this a path that does not exist and still exercise the real resolution.
 */
export function brokenRoutes(file: string, markdown: string): string[] {
  const root = normalize(drivingDir());
  const offenders: string[] = [];
  for (const route of routes(markdown)) {
    const resolved = normalize(join(dirname(file), route));
    if (!resolved.startsWith(root)) {
      offenders.push(`${route} — resolves outside ${DRIVING_REL}/`);
      continue;
    }
    if (!existsSync(resolved)) offenders.push(`${route} — no such file at ${relRepo(resolved)}`);
  }
  return offenders;
}

test("every route declared anywhere in the tree resolves to a document inside it", () => {
  const offenders: string[] = [];
  for (const file of drivingDocs()) {
    for (const detail of brokenRoutes(file, readFileSync(file, "utf8"))) {
      offenders.push(`${relRepo(file)} → ${detail}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `${String(offenders.length)} route(s) declared in ${DRIVING_REL}/ do not resolve to a document in the tree`,
  );
});

test("the router advertises more than one route", () => {
  // The floor is the ROUTER's alone. It is stated here, in its own test, rather
  // than folded into the scan above, so that generalising the scan a second
  // time cannot accidentally carry it onto every file in the tree.
  assert.ok(existsSync(ROUTER), `${ROUTER_REL} is missing — the tree has no router to check`);
  const found = routes(readFileSync(ROUTER, "utf8"));

  assert.ok(
    found.length >= 2,
    `${ROUTER_REL} advertises ${String(found.length)} route(s); a router that names nothing cannot go stale, ` +
      `and cannot be useful either`,
  );
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
    "",
    "A cookbook is not a router, and a route it declares — say",
    "`../references/lifecycle.md` — is read exactly the same way.",
  ].join("\n");

  assert.deepEqual(routes(specimen), [
    "cookbooks/preflight_a_task.md",
    "references/gotchas.md",
    "cookbooks/run_and_observe.md",
    "../../../README.md",
    "../references/lifecycle.md",
  ]);
});

test("a route resolves against its own file's directory, and the resolver bites", () => {
  // TRAP 1, held down by a fixture that can only be green under the WRONG base.
  // `cookbooks/preflight_a_task.md` is a real file — under `skills/awsf/`, the
  // router's directory. Declared by a document in `references/` it names
  // `references/cookbooks/preflight_a_task.md`, which does not exist and never
  // will. A resolver that reached for the router's directory would call this
  // green; one that uses the declaring file's own directory reports it.
  const inReferences = join(drivingDir(), "skills", "awsf", "references", "not-a-real-document.md");
  assert.deepEqual(brokenRoutes(inReferences, "See `cookbooks/preflight_a_task.md` for the steps."), [
    `cookbooks/preflight_a_task.md — no such file at ${DRIVING_REL}/skills/awsf/references/cookbooks/preflight_a_task.md`,
  ]);

  // The same route, declared by the router, resolves — so the report above is
  // the base changing and not the matcher failing.
  assert.deepEqual(brokenRoutes(ROUTER, "See `cookbooks/preflight_a_task.md` for the steps."), []);

  // A cookbook may reach a sibling directory, and that is not an escape.
  const inCookbooks = join(drivingDir(), "skills", "awsf", "cookbooks", "not-a-real-document.md");
  assert.deepEqual(brokenRoutes(inCookbooks, "Background: `../references/lifecycle.md`."), []);

  // An escape out of the tree is reported rather than skipped, from any base.
  assert.deepEqual(brokenRoutes(inCookbooks, "Escape to `../../../../../README.md`."), [
    `../../../../../README.md — resolves outside ${DRIVING_REL}/`,
  ]);
});
