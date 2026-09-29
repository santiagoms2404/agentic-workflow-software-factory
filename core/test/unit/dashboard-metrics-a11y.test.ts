// W18 task 10: the metrics tab's accessibility, read statically from its
// templates and styles. Every control is a button or a link with an accessible
// name; toggle pills carry aria-pressed; form fields are labelled; focus is
// visible on every control; prefers-reduced-motion stops every transition and
// hover lift the tab adds. A browser audit is the owner's; this holds the
// markup to it.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  METRICS_TEMPLATES,
  cssRules,
  declarations,
  elements,
  hasAttr,
  selectors,
  source,
  template,
  visibleText,
  type Element,
} from "./_metrics-static.ts";

/** The rail reuses the sessions board's ladder, so its controls are the tab's too. */
const FILES = [...METRICS_TEMPLATES, "dashboard/src/components/SessionFilterRow.vue"];
const templates = FILES.map((file) => [file, template(source(file))] as const);
const all = (tag: string): Element[] => templates.flatMap(([file, text]) => elements(text, tag, file));
const where = (element: Element) => `${element.file}: <${element.tag}${element.attrs.replace(/\s+/g, " ").slice(0, 120)}>`;

/** Action pills do something once; they are not toggles and carry no pressed state. */
const ACTION_PILLS = ["Reset lens", "Copy command"];

function accessibleName(element: Element): boolean {
  return hasAttr(element, "aria-label") || hasAttr(element, "aria-labelledby") || visibleText(element.inner).length > 0;
}

test("the scan reaches every control the tab renders", () => {
  assert.ok(all("button").length >= 15, `${all("button").length} buttons`);
  assert.ok(all("a").length >= 4, `${all("a").length} links`);
  for (const [file, text] of templates) assert.ok(text.length > 100, `${file} has a template`);
});

test("every button has an accessible name and is a plain type=button", () => {
  for (const button of all("button")) {
    assert.ok(accessibleName(button), `${where(button)} has no accessible name`);
    assert.match(button.attrs, /\stype="button"/, `${where(button)} is not type="button"`);
  }
});

test("every link goes somewhere and has an accessible name", () => {
  for (const link of all("a")) {
    assert.ok(hasAttr(link, "href"), `${where(link)} has no href`);
    assert.ok(accessibleName(link), `${where(link)} has no accessible name`);
  }
  // An icon-only control names itself.
  for (const element of [...all("a"), ...all("button")].filter((candidate) => visibleText(candidate.inner).length === 0)) {
    assert.ok(hasAttr(element, "aria-label"), `${where(element)} is icon-only without an aria-label`);
  }
});

test("toggle pills carry aria-pressed; the two action pills do not", () => {
  const pills = all("button").filter((button) => /class="[^"]*\b(metrics-pill|session-filter-option|session-filter-control)\b/.test(button.attrs));
  assert.ok(pills.length >= 8, `${pills.length} pills`);
  const actions: string[] = [];
  for (const pill of pills) {
    const text = visibleText(pill.inner);
    if (ACTION_PILLS.some((label) => text.includes(label))) {
      actions.push(ACTION_PILLS.find((label) => text.includes(label))!);
      assert.ok(!hasAttr(pill, "aria-pressed"), `${where(pill)} is an action, not a toggle`);
    } else {
      assert.ok(hasAttr(pill, "aria-pressed"), `${where(pill)} is a toggle without aria-pressed`);
    }
  }
  assert.deepEqual(actions.sort(), [...ACTION_PILLS].sort(), "each action pill is found once");
});

test("every pill group and landmark is named", () => {
  for (const [file, text] of templates) {
    for (const match of text.matchAll(/<(\w+)([^>]*\srole="(group|table|img|tooltip|status)"[^>]*)>/g)) {
      const attrs = match[2]!;
      if (match[3] === "tooltip" || match[3] === "status") continue;
      assert.ok(/(?::|\s)aria-label(?:ledby)?=/.test(attrs), `${file}: role="${match[3]}" on <${match[1]}> is unnamed`);
    }
  }
});

test("every form field is labelled", () => {
  for (const [file, text] of templates) {
    const labels = elements(text, "label", file);
    const forIds = new Set(labels.map((label) => /\sfor="([^"]+)"/.exec(label.attrs)?.[1]).filter((id): id is string => id !== undefined));
    for (const tag of ["select", "input", "textarea"]) {
      for (const field of elements(text, tag, file)) {
        const id = /\sid="([^"]+)"/.exec(field.attrs)?.[1];
        const wrapped = labels.some((label) => label.inner.includes(field.attrs));
        assert.ok(hasAttr(field, "aria-label") || (id !== undefined && forIds.has(id)) || wrapped, `${where(field)} is unlabelled`);
      }
    }
  }
});

test("only buttons and links take a click, except a ledger row whose title link is its keyboard path", () => {
  for (const [file, text] of templates) {
    for (const match of text.matchAll(/<(\w[\w-]*)\s[^>]*@click/g)) {
      const tag = match[1]!;
      if (tag === "button" || tag === "a" || /^[A-Z]/.test(tag)) continue;
      assert.equal(tag, "tr", `${file}: <${tag}> takes a click`);
      const row = elements(text, "tr", file).find((element) => element.attrs.includes("@click"))!;
      assert.match(row.inner, /<a\s[^>]*:href=/, `${file}: the clickable row has no link for the keyboard`);
    }
  }
});

test("a focusable non-control has a role and a name, and every graphic is either decorative or named", () => {
  for (const [file, text] of templates) {
    for (const match of text.matchAll(/<(\w+)([^>]*\stabindex="0"[^>]*)>/g)) {
      assert.match(match[2]!, /\srole="[^"]+"/, `${file}: <${match[1]} tabindex> has no role`);
      assert.match(match[2]!, /(?::|\s)aria-label=/, `${file}: <${match[1]} tabindex> has no name`);
    }
    for (const svg of elements(text, "svg", file)) {
      assert.ok(/aria-hidden="true"/.test(svg.attrs) || (/\srole="/.test(svg.attrs) && hasAttr(svg, "aria-label")), `${where(svg)} is neither hidden nor named`);
    }
    for (const match of text.matchAll(/<(ChartColumn|Copy)\b([^>]*)\/>/g)) {
      assert.match(match[2]!, /aria-hidden="true"/, `${file}: the ${match[1]} icon is not hidden`);
    }
  }
});

// ---------------------------------------------------------------------------
// Styles: focus and motion.
// ---------------------------------------------------------------------------

const metricsCss = cssRules(source("dashboard/src/styles/metrics.css"));
const sharedCss = ["dashboard/src/styles/dashboard.css", "dashboard/src/styles/morphism.css"].flatMap((path) => cssRules(source(path)));
const valueOf = (body: string, name: string) => declarations(body).find(([key]) => key === name)?.[1];

test("focus is visible: the shell's rule covers buttons, links and focusable marks, and each field class has its own", () => {
  const global = sharedCss.find((rule) => rule.at === null && selectors(rule).includes("button:focus-visible"));
  assert.ok(global, "dashboard.css has a focus-visible rule for buttons");
  assert.deepEqual(["button:focus-visible", "a:focus-visible", "[tabindex]:focus-visible"].filter((s) => !selectors(global!).includes(s)), []);
  assert.match(valueOf(global!.body, "outline") ?? "", /^2px solid var\(--accent\)$/);

  const fieldClasses = new Set<string>();
  for (const [, text] of templates) {
    for (const tag of ["select", "input", "textarea"]) {
      for (const field of elements(text, tag, "")) {
        const cls = /\sclass="([^"]+)"/.exec(field.attrs)?.[1];
        if (cls !== undefined) fieldClasses.add(`.${cls.split(/\s+/)[0]}`);
      }
    }
  }
  fieldClasses.add(".run-reason input");
  for (const field of fieldClasses) {
    const rule = metricsCss.find((candidate) => selectors(candidate).includes(`${field}:focus-visible`));
    assert.ok(rule && /solid var\(--accent\)/.test(valueOf(rule.body, "outline") ?? ""), `${field} has no visible focus`);
  }
});

test("no metrics rule removes an outline without restoring it on :focus-visible", () => {
  for (const rule of metricsCss) {
    const outline = valueOf(rule.body, "outline");
    if (outline === undefined || !/^(none|0)$/.test(outline)) continue;
    for (const selector of selectors(rule).filter((s) => !s.includes(":focus-visible"))) {
      const restored = metricsCss.some((candidate) => selectors(candidate).includes(`${selector}:focus-visible`) && /solid/.test(valueOf(candidate.body, "outline") ?? ""));
      assert.ok(restored, `${selector} removes its outline and never restores it`);
    }
  }
});

test("prefers-reduced-motion stops every transition and hover lift the tab adds", () => {
  const reduced = metricsCss.filter((rule) => rule.at === "@media (prefers-reduced-motion: reduce)");
  assert.ok(reduced.length > 0, "metrics.css has a reduced-motion block");
  const stops = (selector: string, property: "transition" | "transform") =>
    reduced.some((rule) => selectors(rule).includes(selector) && valueOf(rule.body, property) === "none");

  const moving = [
    ...metricsCss.filter((rule) => rule.at === null),
    ...sharedCss.filter((rule) => rule.at === null && /\.metrics-control/.test(rule.selector)),
  ];
  const missing: string[] = [];
  for (const rule of moving) {
    const transition = valueOf(rule.body, "transition");
    const transform = valueOf(rule.body, "transform");
    for (const selector of selectors(rule)) {
      if (rule.selector.includes(".metrics-control") && !selector.includes(".metrics-control")) continue;
      if (transition !== undefined && transition !== "none" && !stops(selector, "transition")) missing.push(`${selector} { transition }`);
      if (selector.includes(":hover") && transform !== undefined && transform !== "none" && !stops(selector, "transform")) missing.push(`${selector} { transform }`);
    }
  }
  assert.deepEqual(missing, []);
  // The shell's backstop: every transition and animation collapses under the preference.
  const backstop = sharedCss.find((rule) => rule.at === "@media (prefers-reduced-motion: reduce)" && selectors(rule).includes("*"));
  assert.match(backstop?.body ?? "", /transition-duration: \.01ms !important/);
});
