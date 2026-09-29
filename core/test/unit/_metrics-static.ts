// Static-scan helpers for the metrics tab's files, shared by the token, label
// and accessibility tests (W18 task 10). The files are found by name so a new
// view cannot slip past the scans.

import { readdirSync, readFileSync } from "node:fs";

export const source = (path: string): string => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const listDir = (path: string) => readdirSync(new URL(`../../../${path}`, import.meta.url));

/** Every file the tab owns. */
export const METRICS_FILES: readonly string[] = [
  ...listDir("dashboard/src").filter((name) => /^metrics-.*\.ts$/.test(name)).map((name) => `dashboard/src/${name}`),
  ...listDir("dashboard/src/components").filter((name) => /^Metrics.*\.vue$/.test(name)).map((name) => `dashboard/src/components/${name}`),
  "dashboard/src/routes/metrics.vue",
  "dashboard/src/styles/metrics.css",
].sort();

/** The Vue templates the tab renders, plus the run card that carries its entry control. */
export const METRICS_TEMPLATES: readonly string[] = [
  ...METRICS_FILES.filter((file) => file.endsWith(".vue")),
  "dashboard/src/components/SessionCard.vue",
];

export interface CssRule {
  readonly selector: string;
  readonly body: string;
  /** The enclosing at-rule, or null at the top level. */
  readonly at: string | null;
}

/** Rules with their enclosing at-rule; one level of nesting is all these files use. */
export function cssRules(text: string): CssRule[] {
  const rules: CssRule[] = [];
  const walk = (chunk: string, at: string | null) => {
    let depth = 0;
    let start = 0;
    let head = "";
    for (let i = 0; i < chunk.length; i += 1) {
      const ch = chunk[i];
      if (ch === "{") {
        if (depth === 0) {
          head = chunk.slice(start, i).trim();
          start = i + 1;
        }
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const body = chunk.slice(start, i);
          if (head.startsWith("@")) walk(body, head);
          else rules.push({ selector: head, body, at });
          start = i + 1;
        }
      } else if (ch === ";" && depth === 0) {
        start = i + 1;
      }
    }
  };
  walk(text.replace(/\/\*[\s\S]*?\*\//g, ""), null);
  return rules;
}

/** A rule body's declarations, in order. */
export function declarations(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const part of body.split(/;(?![^(]*\))/)) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim();
    if (name.length > 0) out.push([name, part.slice(colon + 1).trim()]);
  }
  return out;
}

/** The selectors of a rule, split on top-level commas. */
export function selectors(rule: CssRule): string[] {
  return rule.selector.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}

/** The metrics rules that live in the shared stylesheets (the run card's controls). */
export function sharedMetricsCss(): string {
  return ["dashboard/src/styles/dashboard.css", "dashboard/src/styles/morphism.css"]
    .flatMap((path) => cssRules(source(path)))
    .filter((rule) => /\.metrics-control|\.card-controls/.test(rule.selector))
    .map((rule) => `${rule.at === null ? "" : `${rule.at} { `}${rule.selector} { ${rule.body} }${rule.at === null ? "" : " }"}`)
    .join("\n");
}

/** A Vue file's template, without its HTML comments. */
export function template(text: string): string {
  const start = text.indexOf("<template>");
  const end = text.lastIndexOf("</template>");
  return (start < 0 ? "" : text.slice(start, end < 0 ? undefined : end)).replace(/<!--[\s\S]*?-->/g, "");
}

/** Script text without comments: block comments, and line comments that start a line or follow whitespace. */
export function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

export interface Element {
  readonly tag: string;
  /** The opening tag's attribute text. */
  readonly attrs: string;
  /** The element's inner markup, or "" for a self-closed tag. */
  readonly inner: string;
  readonly file: string;
}

/**
 * Every element with the given tag in a template. Inner markup runs to the
 * matching close tag, counting nested elements of the same tag. Attribute
 * values may hold `>` inside quotes (`=>` in handlers), so the opening tag is
 * scanned with quotes respected.
 */
export function elements(text: string, tag: string, file: string): Element[] {
  const out: Element[] = [];
  const open = new RegExp(`<${tag}(?=[\\s>/])`, "g");
  for (const match of text.matchAll(open)) {
    let i = match.index! + tag.length + 1;
    let quote: string | null = null;
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (quote !== null) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
    }
    const attrs = text.slice(match.index! + tag.length + 1, i);
    if (attrs.trimEnd().endsWith("/")) {
      out.push({ tag, attrs, inner: "", file });
      continue;
    }
    let depth = 1;
    let cursor = i + 1;
    const scan = new RegExp(`<(/?)${tag}(?=[\\s>/])`, "g");
    scan.lastIndex = cursor;
    let close = text.length;
    for (let next = scan.exec(text); next !== null; next = scan.exec(text)) {
      depth += next[1] === "/" ? -1 : 1;
      if (depth === 0) {
        close = next.index;
        break;
      }
      cursor = scan.lastIndex;
    }
    out.push({ tag, attrs, inner: text.slice(i + 1, close), file });
  }
  return out;
}

/** Whether an attribute (static or bound) is present. */
export function hasAttr(element: Pick<Element, "attrs">, name: string): boolean {
  return new RegExp(`(?:^|\\s)(?::|v-bind:)?${name}(?=[\\s=]|$)`).test(element.attrs);
}

/** Visible text: inner markup with tags, decorative icons and whitespace removed. Interpolations count as text. */
export function visibleText(inner: string): string {
  return inner
    .replace(/<([A-Za-z][\w-]*)[^>]*aria-hidden="true"[^>]*\/>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}
