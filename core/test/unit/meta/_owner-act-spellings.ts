import { OWNER_ACTS } from "../../../../docs/driving/marimba/marimba-guard-rules.mts";

/** W01-Q7, decided 2026-10-04. Expectations are pinned, never learned from the guard. */
export const OWNER_ACT_SPELLINGS = [
  { id: "direct", prefix: "awsf", knownGapF17: false },
  { id: "just", prefix: "just awsf", knownGapF17: false },
  // F17 closed by G01-G: these five spellings are denied in BOTH harnesses.
  { id: "npm", prefix: "npm run awsf --", knownGapF17: false },
  { id: "npm-script-silent", prefix: "npm run awsf --silent --", knownGapF17: false },
  { id: "npm-prefix", prefix: "npm --prefix <dir> run awsf --", knownGapF17: false },
  { id: "npm-run-silent", prefix: "npm run --silent awsf --", knownGapF17: false },
  { id: "node", prefix: "node --experimental-strip-types core/src/cli/main.ts", knownGapF17: false },
] as const;

export const OWNER_ACT_ROWS = OWNER_ACTS.flatMap((act) => OWNER_ACT_SPELLINGS.map((spelling) => ({
  act,
  spelling: spelling.id,
  command: `${spelling.prefix.replace("<dir>", "./fixture-project")} ${act} T01`,
  expected: spelling.knownGapF17 ? null : act,
  label: `${act} / ${spelling.id}${spelling.knownGapF17 ? " / KNOWN GAP F17 (G01-G)" : ""}`,
})));

/** Runnable Markdown fences and HTML pre blocks; explanatory prose is not a shell claim. */
export function shellFenceLines(source: string): string[] {
  const blocks = [
    ...source.matchAll(/^```(?:bash|sh|shell|console)[^\n]*\n([\s\S]*?)^```/gm),
    ...source.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/giu),
  ];
  return blocks.flatMap((block) => (block[1] ?? "")
    .replace(/<\/?code\b[^>]*>/giu, "")
    .replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&")
    .split("\n").map((raw) => raw.trim().replace(/^\$\s+/u, ""))
    .filter((line) => line.length > 0 && !line.startsWith("#")));
}

/**
 * Extract before classifying, so an unknown launcher cannot fall through to a
 * supported bare-awsf suffix. npm's options and node's entry flags are read
 * broadly here; the seven accepted prefixes below remain deliberately exact.
 * Like doc-reconciliation, this reads written invocations, not shell intent.
 */
export function invocationPrefixes(line: string): string[] {
  const invocation = /(?:^|[\s;|&])((?:npm\s+[^\n;|&]*?\bawsf(?:\s+--[^\s]+)*|node\s+[^\n;|&]*?\bcore\/src\/cli\/main\.ts|(?:just|yarn|pnpm|bun|npx)\s+[^\n;|&]*?\bawsf|awsf)(?:\s+--(?=\s|$))?)\s+(?=[a-z][\w-]*\b)/gu;
  return [...line.matchAll(invocation)].map((match) => (match[1] ?? "").replace(/\s+/gu, " "));
}

export function spellingForPrefix(prefix: string): string | undefined {
  const normalized = prefix.replace(/^(npm --prefix) (?:"[^"]+"|'[^']+'|\S+) (run awsf --)$/u, "$1 <dir> $2");
  return OWNER_ACT_SPELLINGS.find((spelling) => spelling.prefix === normalized)?.id;
}

export function uncoveredPrefixes(lines: readonly string[]): string[] {
  return lines.flatMap(invocationPrefixes).filter((prefix) => spellingForPrefix(prefix) === undefined);
}
