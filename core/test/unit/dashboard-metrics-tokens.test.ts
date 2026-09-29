// W18 task 10: every CSS custom property the metrics tab uses resolves in all
// seven palettes and both modes (AWSF Classic dark only), without falling back
// to the no-script Forest dark default, and no metrics file carries a literal
// colour. Role dots are the one colour source outside the palette: they come
// from the config's agents[].color through readRoleColors, never from a table
// in the tab.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readRoleColors } from "../../../dashboard/src/metrics-lens.ts";
import { METRICS_FILES, cssRules, declarations, sharedMetricsCss, source } from "./_metrics-static.ts";

/** `var(--name)` references, with whether the reference carries its own fallback. */
function varRefs(text: string): Array<{ name: string; fallback: boolean }> {
  return [...text.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)].map((match) => ({ name: match[1]!, fallback: match[2] === "," }));
}

/** Custom properties the tab sets itself, inline or in its own rules. */
function ownProperties(text: string): Set<string> {
  return new Set([...text.matchAll(/["']?(--[\w-]+)["']?\s*:/g)].map((match) => match[1]!));
}

const PALETTES = [...source("dashboard/src/theme.ts").matchAll(/\{\s*id: "([a-z-]+)"/g)].map((match) => match[1]!);
const MODES = ["dark", "light"] as const;
type Mode = (typeof MODES)[number];

/** The (palette, mode) pairs the shell can apply: AWSF Classic is forced dark by applyTheme. */
function appliedPairs(): Array<[string, Mode]> {
  return PALETTES.flatMap((palette) => (palette === "awsf-classic" ? [[palette, "dark"]] : MODES.map((mode) => [palette, mode]))) as Array<[string, Mode]>;
}

interface Declaration {
  readonly value: string;
  readonly specificity: number;
  readonly order: number;
  readonly bare: boolean;
}

/** The `:root` cascade dashboard.css resolves for one palette and mode. */
function rootCascade(palette: string, mode: Mode): Map<string, Declaration> {
  const winners = new Map<string, Declaration>();
  let order = 0;
  for (const rule of cssRules(source("dashboard/src/styles/dashboard.css"))) {
    if (rule.at !== null) continue;
    for (const selector of rule.selector.split(",").map((part) => part.trim())) {
      const shape = /^:root((?:\[data-(?:theme|mode)="[^"]+"\])*)$/.exec(selector);
      if (shape === null) continue;
      const attrs = [...shape[1]!.matchAll(/\[data-(theme|mode)="([^"]+)"\]/g)];
      const applies = attrs.every(([, key, value]) => (key === "theme" ? value === palette : value === mode));
      if (!applies) continue;
      for (const [name, value] of declarations(rule.body)) {
        if (!name.startsWith("--")) continue;
        order += 1;
        const next = { value, specificity: attrs.length, order, bare: attrs.length === 0 };
        const held = winners.get(name);
        if (held === undefined || next.specificity >= held.specificity) winners.set(name, next);
      }
    }
  }
  return winners;
}

/** Follows a token to its leaves; returns why it fails to resolve for this pair, or null. */
function unresolved(name: string, cascade: Map<string, Declaration>, seen: Set<string> = new Set()): string | null {
  if (seen.has(name)) return `${name} is circular`;
  const held = cascade.get(name);
  if (held === undefined) return `${name} is undefined`;
  if (held.bare && /^#[0-9A-Fa-f]{3,8}$/.test(held.value)) return `${name} falls back to the no-script Forest dark default`;
  for (const ref of varRefs(held.value)) {
    const why = unresolved(ref.name, cascade, new Set([...seen, name]));
    if (why !== null && !ref.fallback) return why;
  }
  return null;
}

test("the palette list is theme.ts's seven, and AWSF Classic is applied dark only", () => {
  assert.deepEqual(PALETTES, ["awsf-classic", "forest", "lavender-slate", "earthy-obsidian", "navy-sky", "warm-rust", "sunset"]);
  assert.match(source("dashboard/src/theme.ts"), /selectedPalette\.value === "awsf-classic" \? "dark" : resolvedMode\.value/);
  assert.equal(appliedPairs().length, 13);
});

test("the metrics files are found by name and include every view", () => {
  for (const file of ["dashboard/src/metrics-lens.ts", "dashboard/src/metrics-run.ts", "dashboard/src/components/MetricsRun.vue",
    "dashboard/src/components/MetricsMatrix.vue", "dashboard/src/routes/metrics.vue", "dashboard/src/styles/metrics.css"]) {
    assert.ok(METRICS_FILES.includes(file), file);
  }
});

test("every custom property the metrics files use resolves in all seven palettes and both modes", () => {
  const text = [...METRICS_FILES.map(source), sharedMetricsCss()].join("\n");
  const own = ownProperties(text);
  const used = [...new Set(varRefs(text).filter((ref) => !own.has(ref.name)).map((ref) => ref.name))].sort();
  assert.ok(used.length > 20, `the scan found ${used.length} tokens`);
  for (const expected of ["--accent", "--count", "--neu-well", "--neu-surface", "--green", "--red", "--amber", "--blue", "--faint", "--violet", "--cyan"]) {
    assert.ok(used.includes(expected), `${expected} is used`);
  }
  const failures: string[] = [];
  for (const [palette, mode] of appliedPairs()) {
    const cascade = rootCascade(palette, mode);
    for (const name of used) {
      const why = unresolved(name, cascade);
      if (why !== null) failures.push(`${palette}/${mode}: ${why}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("the resolver catches a palette that would inherit Forest dark", () => {
  // Every palette block restates the thirteen base colours; dropping one
  // would make that palette silently render Forest's.
  const cascade = rootCascade("navy-sky", "light");
  cascade.set("--violet", { value: "#8AAFA4", specificity: 0, order: 0, bare: true });
  assert.equal(unresolved("--violet", cascade), "--violet falls back to the no-script Forest dark default");
  assert.equal(unresolved("--nope", cascade), "--nope is undefined");
});

test("the tab's own custom properties are set by the tab", () => {
  const text = METRICS_FILES.map(source).join("\n");
  assert.deepEqual([...ownProperties(text)].filter((name) => varRefs(text).some((ref) => ref.name === name)).sort(), ["--matrix-columns"]);
});

test("no metrics file carries a literal colour; role colours come only from the config", () => {
  const files = [...METRICS_FILES.map((file) => [file, source(file)] as const), ["shared metrics css", sharedMetricsCss()] as const];
  for (const [file, text] of files) {
    assert.doesNotMatch(text, /#[0-9A-Fa-f]{3,8}\b(?![-\w])/, `${file} carries a literal hex colour`);
    assert.doesNotMatch(text, /\b(?:rgba?|hsla?|oklch|lab|lch)\(/, `${file} carries a literal colour function`);
  }
  // The role-colour table is awsf.config.yaml's agents[].color, read once.
  assert.deepEqual(readRoleColors({ agents: [{ name: "builder", color: "#22D3EE" }, { name: "x", color: "red" }, { name: "y", color: "var(--red)" }] }),
    { builder: "#22D3EE" }, "only a #RRGGBB from settings becomes a role colour");
  const dotSources = METRICS_FILES.map(source).join("\n").match(/roleColors\[[^\]]+\]/g) ?? [];
  assert.ok(dotSources.length >= 3, "role dots index the settings' colours");
});
