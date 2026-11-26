import assert from "node:assert/strict";
import { META } from "./_fences.ts";

type TestRef = { readonly file: string; readonly title: string };
export type InvariantRow = { readonly tests: readonly TestRef[]; readonly partial?: string };
const meta = (file: string, title: string): TestRef => ({ file: `${META}/${file}.test.ts`, title });

export const INVARIANTS: Readonly<Record<number, InvariantRow>> = {
  1: { partial: "The driving contract is checked for live state; other files and commit messages are not checked for live state.", tests: [
    meta("driving-contract", "`${CONTRACT_REL} carries no live task state`"),
  ] },
  2: { partial: "Marker agreement is checked, but no test proves a marker was earned by work completed in the same session.", tests: [
    meta("ticket-plan-sync", "ticket state agrees with its task's own checklist"),
  ] },
  3: { tests: [meta("child-process-fence", "node:child_process is imported nowhere in shipped code except transport-broker.ts")] },
  4: { tests: [meta("no-shell-true", "no shell option enables a shell in tracked code or the driving-document tree")] },
  5: { tests: [meta("state-purity-fence", "core/src/state runtime imports and their relative closure remain pure")] },
  6: { tests: [meta("sqlite-write-fence", "SQLite is written only by the observability driver, projector, and migrations")] },
  7: { tests: [
    meta("dependency-allowlist", "core/package.json dependencies match the D2 allowlist exactly"),
    meta("dependency-allowlist", "dashboard/package.json dependencies match the D2 allowlist exactly"),
    meta("dependency-allowlist", "root package.json devDependencies match the D2 allowlist exactly"),
  ] },
  8: { tests: [
    meta("no-destructive-paths", "no force/auto-delete paths in core/src"),
    meta("publish-fence", "the authorization table refuses every state except LANDED"),
    meta("no-land-route", "the backlog surface is a GET route and no dashboard write path reaches the lifecycle"),
  ] },
  9: { tests: [
    meta("no-credentials-in-fixtures", "no credential-shaped values in test fixtures"),
    meta("no-credentials-in-fixtures", "no credential-shaped values in the committed root manifests"),
    meta("no-credentials-in-fixtures", "no credential-shaped values in the driving-document tree"),
  ] },
  10: { tests: [meta("junk-drawer", "no committed runtime artifacts or *receipt*/*manifest* files")] },
  11: { tests: [
    meta("no-agent-coauthor", "no commit in history has an agent as author or committer"),
    meta("no-agent-coauthor", "no commit in history carries an agent co-author, session trailer or tool line"),
  ] },
  12: { tests: [
    meta("ticket-plan-sync", "ticket state agrees with its milestone's marker"),
    meta("ticket-plan-sync", "ticket state agrees with its task's own checklist"),
    meta("ticket-plan-sync", "each ticket carries its Section B build prompt byte-identically"),
    meta("light-ticket-sync", "the registered plans root's flat light store passes the shared vocabulary and dependency-cycle rules"),
  ] },
  13: { partial: "The Jev endpoint and quota fences exist; the delegate-authority fence belongs to W19 T08.", tests: [
    meta("jev-transport-fence", "no file in core/src but the Jev transport calls global fetch"),
    meta("jev-transport-fence", "no file in core/src but the Jev transport names the decisions endpoint"),
    meta("quota-fence", "workflow cannot transitively reach quota modules"),
  ] },
};

export function checkInvariants(text: string, rows: Readonly<Record<number, InvariantRow>>, tests: (file: string) => ReadonlySet<string>): void {
  const ids = [...text.matchAll(/^(\d+)\.\s+\S/gmu)].map(match => Number(match[1]));
  assert.ok(ids.length > 0, "empty AGENTS.md invariant list");
  const errors: string[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`duplicate AGENTS.md invariant ${id}`);
    seen.add(id);
    if (!Object.hasOwn(rows, id)) errors.push(`invariant ${id} has no row`);
  }
  for (const [key, row] of Object.entries(rows)) {
    if (!seen.has(Number(key))) errors.push(`stale invariant row ${key}`);
    if (row.tests.length === 0 && !row.partial?.trim()) errors.push(`invariant ${key} has no tests or reason`);
    if (["1", "2", "13"].includes(key) && !row.partial?.trim()) errors.push(`invariant ${key} must be marked partial with a reason`);
    for (const { file, title } of row.tests) {
      if (!tests(file).has(title)) errors.push(`invariant ${key}: missing test ${file} — ${title}`);
    }
  }
  assert.deepEqual(errors, [], errors.join("\n"));
}
