// How much of a candidate's diff may be shown to the reviewer, and which parts.
//
// This is NOT `command-evidence.ts`'s discipline and must not be confused with
// it. That file windows head / first-FAILURE / tail (`:17-19`), and it finds the
// failure window with TAP-shaped markers (`:79-87`). A diff has no failure
// marker: every line is equally the subject. So the rules here are written
// fresh, and there are four of them:
//
//   1. Bound PER FILE, on WHOLE hunks. A truncated hunk is worse than an
//      omitted one, because it looks complete — a reviewer reading half a hunk
//      has no way to know the other half disagreed with it.
//   2. Deletions are never dropped before additions. A reviewer that sees only
//      what was added cannot see what was removed, and removal is where the
//      defects hide.
//   3. A file no hunk of which survives is NAMED, so the reviewer knows what it
//      did not see and its `limitations` can say so.
//   4. The digest is always of the FULL diff. The bounded copy is a rendering;
//      the digest is what proves which diff it is a rendering of.
//
// Everything here is pure: same sections in, same evidence out, so a replayed
// journal and a re-rendered prompt agree.

/** One file's complete section of a unified diff, keyed by the path Git reported. */
export interface DiffFileSection {
  readonly path: string;
  readonly text: string;
}

export interface BoundedReviewDiff {
  /** The bounded rendering. Whole hunks only, in file order and in hunk order. */
  readonly diff: string;
  readonly truncated: boolean;
  /** Characters of ORIGINAL diff content not shown. Host markers are not counted. */
  readonly omittedChars: number;
  /** Files no hunk of which survived. Sorted, so the evidence is stable. */
  readonly omittedFiles: readonly string[];
}

interface ParsedSection {
  readonly path: string;
  /** Everything before the first hunk: the `diff --git`, index, and ---/+++ lines. */
  readonly header: string;
  readonly hunks: readonly string[];
  readonly totalChars: number;
}

const HUNK_START = /^@@ /;

/**
 * True when this diff text removes content.
 *
 * The `---` exclusion is the whole subtlety: every unified diff's own
 * `--- a/path` header begins with a hyphen, so the naive test would report that
 * an addition-only change removes lines.
 */
export function diffRemovesLines(text: string): boolean {
  return text.split("\n").some((line) => line.startsWith("-") && !line.startsWith("---"));
}

function parseSection(section: DiffFileSection): ParsedSection {
  const lines = section.text.split("\n");
  const header: string[] = [];
  const hunks: string[][] = [];
  for (const line of lines) {
    if (HUNK_START.test(line)) {
      hunks.push([line]);
      continue;
    }
    if (hunks.length === 0) header.push(line);
    else hunks[hunks.length - 1]!.push(line);
  }
  return {
    path: section.path,
    header: header.length === 0 ? "" : `${header.join("\n").replace(/\n+$/, "")}\n`,
    hunks: Object.freeze(hunks.map((hunk) => `${hunk.join("\n").replace(/\n+$/, "")}\n`)),
    totalChars: section.text.length,
  };
}

/**
 * The one host-authored line that may appear inside a diff.
 *
 * Its length is computed from the path and the file's TOTAL hunk count rather
 * than from the number actually omitted, so the reservation is an upper bound
 * that later passes can only make smaller. A budget that grew as hunks were
 * added back would be a budget that could be exceeded.
 */
function partialMarker(path: string, omitted: number, total: number): string {
  return `*** awsf: ${String(omitted)} of ${String(total)} hunk(s) omitted from ${path}\n`;
}

function markerReservation(section: ParsedSection): number {
  return partialMarker(section.path, section.hunks.length, section.hunks.length).length;
}

/** Deletion-bearing hunks first, original order preserved inside each group. */
function selectionOrder(hunks: readonly string[]): readonly number[] {
  const indices = hunks.map((_, index) => index);
  const removing = indices.filter((index) => diffRemovesLines(hunks[index]!));
  const adding = indices.filter((index) => !diffRemovesLines(hunks[index]!));
  return Object.freeze([...removing, ...adding]);
}

/**
 * Bounds a candidate's diff to `budget` characters.
 *
 * Two passes. The first gives every file an equal share so one enormous file
 * cannot starve the rest; the second hands the unspent remainder back in file
 * order, so a small candidate with one big file still shows that file.
 */
export function boundReviewDiff(
  sections: readonly DiffFileSection[],
  budget: number,
): BoundedReviewDiff {
  // One trailing newline per section, so concatenation cannot run two files'
  // diffs together and the char accounting below measures what is emitted.
  const normalized = sections.map((section) => ({
    path: section.path,
    text: section.text.length === 0 || section.text.endsWith("\n") ? section.text : `${section.text}\n`,
  }));
  const parsed = normalized.map(parseSection);
  const originalChars = parsed.reduce((sum, section) => sum + section.totalChars, 0);
  const whole = normalized.map((section) => section.text).join("");
  if (parsed.length === 0) {
    return Object.freeze({ diff: "", truncated: false, omittedChars: 0, omittedFiles: Object.freeze([]) });
  }
  if (whole.length <= budget) {
    return Object.freeze({ diff: whole, truncated: false, omittedChars: 0, omittedFiles: Object.freeze([]) });
  }

  const kept = parsed.map(() => new Set<number>());
  const admitted = parsed.map(() => false);
  const share = Math.floor(budget / parsed.length);

  /**
   * What file `index` currently costs to render, marker included.
   *
   * Every admission decision is made by simulating this against a ceiling, so
   * there is exactly one place where the arithmetic of "what will this cost"
   * lives and no running total to fall out of step with it.
   */
  const costOf = (index: number, hunks: ReadonlySet<number>): number => {
    const section = parsed[index]!;
    const body = [...hunks].reduce((sum, hunk) => sum + section.hunks[hunk]!.length, 0);
    const marker = hunks.size < section.hunks.length ? markerReservation(section) : 0;
    return section.header.length + body + marker;
  };
  const cost = (index: number): number => admitted[index] ? costOf(index, kept[index]!) : 0;
  const costWith = (index: number, extraHunk: number): number =>
    costOf(index, new Set([...kept[index]!, extraHunk]));
  const total = (): number => parsed.reduce((sum, _section, index) => sum + cost(index), 0);
  const everything = (index: number): Set<number> =>
    new Set(parsed[index]!.hunks.map((_hunk, position) => position));

  const admitAll = (index: number, ceiling: number): boolean => {
    // Tried first, and it is not an optimization. A partial file costs a marker
    // line, so there are budgets at which the WHOLE file fits and any single
    // hunk of it does not — a greedy pass that never considered the whole
    // would omit a file it could have shown entirely.
    if (costOf(index, everything(index)) > ceiling) return false;
    admitted[index] = true;
    kept[index] = everything(index);
    return true;
  };

  // Pass one: an equal share for every file, spent on whole hunks, deletions
  // first, so one enormous file cannot starve the rest.
  for (const [index, section] of parsed.entries()) {
    if (admitAll(index, share)) continue;
    let removalDropped = false;
    for (const hunk of selectionOrder(section.hunks)) {
      const removes = diffRemovesLines(section.hunks[hunk]!);
      if (!removes && removalDropped) break;
      if (costWith(index, hunk) > share) {
        removalDropped ||= removes;
        continue;
      }
      admitted[index] = true;
      kept[index]!.add(hunk);
    }
  }

  // Pass two: the unspent remainder, in file order, so a small candidate with
  // one large file still shows that file.
  for (const [index, section] of parsed.entries()) {
    const spare = budget - total() + cost(index);
    if (kept[index]!.size < section.hunks.length && admitAll(index, spare)) continue;
    let removalDropped = false;
    for (const hunk of selectionOrder(section.hunks)) {
      const removes = diffRemovesLines(section.hunks[hunk]!);
      // The rule, enforced rather than merely preferred: an addition-only hunk
      // is never shown in the place of a deletion this file could not fit. A
      // file whose removals did not fit shows no additions at all, and says so.
      if (!removes && removalDropped) break;
      if (kept[index]!.has(hunk)) continue;
      if (total() - cost(index) + costWith(index, hunk) > budget) {
        removalDropped ||= removes;
        continue;
      }
      admitted[index] = true;
      kept[index]!.add(hunk);
    }
    if (!admitted[index] && section.hunks.length === 0 && total() + section.header.length <= budget) {
      admitted[index] = true;
    }
  }

  const rendered: string[] = [];
  const omittedFiles: string[] = [];
  let shownChars = 0;
  for (const [index, section] of parsed.entries()) {
    const keptHunks = [...kept[index]!].sort((a, b) => a - b);
    if (!admitted[index]) {
      omittedFiles.push(section.path);
      continue;
    }
    rendered.push(section.header);
    shownChars += section.header.length;
    for (const hunk of keptHunks) {
      rendered.push(section.hunks[hunk]!);
      shownChars += section.hunks[hunk]!.length;
    }
    if (keptHunks.length < section.hunks.length) {
      rendered.push(partialMarker(section.path, section.hunks.length - keptHunks.length, section.hunks.length));
    }
  }

  return Object.freeze({
    diff: rendered.join(""),
    truncated: true,
    omittedChars: Math.max(0, originalChars - shownChars),
    omittedFiles: Object.freeze(omittedFiles.sort()),
  });
}
