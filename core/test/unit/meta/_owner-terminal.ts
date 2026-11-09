import { OWNER_ACT_LIST } from "../../../../docs/driving/marimba/owner-acts.mts";

const OWNER_TERMINAL_FALLBACK = /^\s*function\s+ownerTerminal\s*\(\s*provided(?:\s*:\s*[^)]*)?\)\s*(?::\s*OwnerTerminal)?\s*\{\s*return\s+provided\s*\?\?\s*processOwnerTerminal\s*\(\s*\)\s*;\s*\}/gmu;
const CASE_ARM = /\bcase "([a-z][\w-]*)":|\bdefault:/g;

/** The shared main.ts helper must continue to default to the real owner terminal. */
export function hasOwnerTerminalFallback(source: string): boolean {
  return [...source.matchAll(OWNER_TERMINAL_FALLBACK)].length === 1;
}

/** Whether a helper-only owner act is still called inside its declared flag guard. */
export function ownerHelperFlagIsGuarded(body: string, flag: string, callIndex: number): boolean {
  const key = flag.replace(/^--/u, "");
  const assignment = new RegExp(String.raw`\b(?:const|let)\s+targetTaskId\s*=\s*parsed\.flags\["${key}"\]`, "u").exec(body);
  if (assignment === null) return false;

  const guard = /\bif\s*\(\s*targetTaskId\s*!==\s*undefined\s*\)\s*/gu;
  for (const match of body.matchAll(guard)) {
    const start = match.index + match[0].length;
    if (assignment.index >= match.index || callIndex < start) continue;
    if (body[start] !== "{") {
      const end = body.indexOf(";", start);
      if (end < 0 || callIndex < end) return true;
      continue;
    }

    let depth = 0;
    for (let index = start; index < body.length; index += 1) {
      if (body[index] === "{") depth += 1;
      else if (body[index] === "}") depth -= 1;
      if (index === callIndex) return depth > 0;
      if (depth === 0) break;
    }
  }
  return false;
}

/** Derive the case-arm owner acts, following the verified shared terminal fallback. */
export function ownerActsIn(source: string): string[] {
  const hasFallback = hasOwnerTerminalFallback(source);
  const arms = [...source.matchAll(CASE_ARM)];
  const acts: string[] = [];
  for (const [index, arm] of arms.entries()) {
    const verb = arm[1];
    if (verb === undefined) continue;
    const body = source.slice(arm.index, arms[index + 1]?.index ?? source.length);
    const helperCalls = [...body.matchAll(/\bownerTerminal\s*\(/gu)];
    const direct = /\bprocessOwnerTerminal\s*\(/u.test(body);
    if (!direct && !(hasFallback && helperCalls.length > 0)) continue;

    const flaggedHelper = OWNER_ACT_LIST.find((entry) =>
      entry.verb === verb && entry.reach === "helper" && entry.flag !== undefined &&
      helperCalls.some((call) => ownerHelperFlagIsGuarded(body, entry.flag!, call.index)));
    if (flaggedHelper !== undefined && !direct) continue;
    acts.push(verb);
  }
  return acts;
}
