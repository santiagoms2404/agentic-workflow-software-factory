import assert from "node:assert/strict";

/** Known sites are exact exceptions, not a budget that can move to a new site. */
export function assertRatchet(actual: Iterable<string>, known: Iterable<string>): void {
  const seen = new Set(actual);
  const allowed = new Set(known);
  const added = [...seen].filter(site => !allowed.has(site)).sort();
  const stale = [...allowed].filter(site => !seen.has(site)).sort();
  assert.ok(added.length === 0 && stale.length === 0, [
    ...added.map(site => `new site: ${site}`),
    ...stale.map(site => `stale site (remove it from the list): ${site}`),
  ].join("\n"));
}
