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
  /** Exact Git paths whose inline section lost hunks, without parsing marker prose. */
  readonly partialFiles: readonly string[];
}

interface ParsedSection {
  readonly path: string;
  /** Everything before the first hunk: the `diff --git`, index, and ---/+++ lines. */
  readonly header: string;
  readonly hunks: readonly string[];
  readonly removesLines: readonly boolean[];
  readonly hunkChars: number;
  readonly markerChars: number;
  readonly totalChars: number;
}

const HUNK_START = /^@@ /;

/**
 * True when this diff text removes content.
 *
 * Outside a hunk, `--- a/path` headers begin with a hyphen and are excluded.
 * Inside a hunk (after `@@ `), any line starting with `-` is a removal, even
 * when its content begins with `--` (e.g. SQL comments or CSS custom properties,
 * resulting in `---`) (B10-10).
 */
export function diffRemovesLines(text: string): boolean {
  let insideHunk = false;
  for (const line of text.split("\n")) {
    if (HUNK_START.test(line)) {
      insideHunk = true;
      continue;
    }
    if (line.startsWith("diff ") || line.startsWith("*** ")) {
      insideHunk = false;
      continue;
    }
    if (insideHunk) {
      if (line.startsWith("-")) return true;
    } else {
      if (line.startsWith("-") && !line.startsWith("---")) return true;
    }
  }
  return false;
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
  const parsedHunks = Object.freeze(hunks.map((hunk) => `${hunk.join("\n").replace(/\n+$/, "")}\n`));
  return {
    path: section.path,
    header: header.length === 0 ? "" : `${header.join("\n").replace(/\n+$/, "")}\n`,
    hunks: parsedHunks,
    removesLines: Object.freeze(parsedHunks.map(diffRemovesLines)),
    hunkChars: parsedHunks.reduce((sum, hunk) => sum + hunk.length, 0),
    markerChars: partialMarker(section.path, parsedHunks.length, parsedHunks.length).length,
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

/** Deletion-bearing hunks first, original order preserved inside each group. */
function selectionOrder(removesLines: readonly boolean[]): readonly number[] {
  const indices = removesLines.map((_, index) => index);
  const removing = indices.filter((index) => removesLines[index]);
  const adding = indices.filter((index) => !removesLines[index]);
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
  const hunkOrder = parsed.map((section) => selectionOrder(section.removesLines));
  const originalChars = parsed.reduce((sum, section) => sum + section.totalChars, 0);
  const whole = normalized.map((section) => section.text).join("");
  if (parsed.length === 0) {
    return Object.freeze({ diff: "", truncated: false, omittedChars: 0, omittedFiles: Object.freeze([]), partialFiles: Object.freeze([]) });
  }
  if (whole.length <= budget) {
    return Object.freeze({ diff: whole, truncated: false, omittedChars: 0, omittedFiles: Object.freeze([]), partialFiles: Object.freeze([]) });
  }

  const kept = parsed.map(() => new Set<number>());
  const admitted = parsed.map(() => false);
  const keptBodyChars = parsed.map(() => 0);
  const fileCosts = parsed.map(() => 0);
  let totalCost = 0;
  const share = Math.floor(budget / parsed.length);

  const cost = (index: number): number => admitted[index] ? fileCosts[index]! : 0;
  const costWith = (index: number, extraHunk: number): number => {
    const section = parsed[index]!;
    const nextCount = kept[index]!.size + 1;
    return section.header.length + keptBodyChars[index]! + section.hunks[extraHunk]!.length
      + (nextCount < section.hunks.length ? section.markerChars : 0);
  };
  const updateCost = (index: number, nextCost: number): void => {
    const previous = cost(index);
    admitted[index] = true;
    fileCosts[index] = nextCost;
    totalCost += nextCost - previous;
  };
  const everything = (index: number): Set<number> =>
    new Set(parsed[index]!.hunks.map((_hunk, position) => position));
  const admitHunk = (index: number, hunk: number): void => {
    const section = parsed[index]!;
    const selected = kept[index]!;
    const nextBodyChars = keptBodyChars[index]! + section.hunks[hunk]!.length;
    selected.add(hunk);
    keptBodyChars[index] = nextBodyChars;
    updateCost(index, section.header.length + nextBodyChars
      + (selected.size < section.hunks.length ? section.markerChars : 0));
  };

  const admitAll = (index: number, ceiling: number): boolean => {
    const section = parsed[index]!;
    // Tried first, and it is not an optimization. A partial file costs a marker
    // line, so there are budgets at which the WHOLE file fits and any single
    // hunk of it does not — a greedy pass that never considered the whole
    // would omit a file it could have shown entirely.
    const fullCost = section.header.length + section.hunkChars;
    if (fullCost > ceiling) return false;
    const previous = cost(index);
    kept[index] = everything(index);
    keptBodyChars[index] = section.hunkChars;
    admitted[index] = true;
    fileCosts[index] = fullCost;
    totalCost += fullCost - previous;
    return true;
  };

  // Pass one: an equal share for every file, spent on whole hunks, deletions
  // first, so one enormous file cannot starve the rest.
  for (const [index, section] of parsed.entries()) {
    if (admitAll(index, share)) continue;
    let removalDropped = false;
    for (const hunk of hunkOrder[index]!) {
      const removes = section.removesLines[hunk]!;
      if (!removes && removalDropped) break;
      if (costWith(index, hunk) > share) {
        removalDropped ||= removes;
        continue;
      }
      admitHunk(index, hunk);
    }
  }

  // Pass two: the unspent remainder, in file order, so a small candidate with
  // one large file still shows that file.
  for (const [index, section] of parsed.entries()) {
    const spare = budget - totalCost + cost(index);
    if (kept[index]!.size < section.hunks.length && admitAll(index, spare)) continue;
    let removalDropped = false;
    for (const hunk of hunkOrder[index]!) {
      const removes = section.removesLines[hunk]!;
      // The rule, enforced rather than merely preferred: an addition-only hunk
      // is never shown in the place of a deletion this file could not fit. A
      // file whose removals did not fit shows no additions at all, and says so.
      if (!removes && removalDropped) break;
      if (kept[index]!.has(hunk)) continue;
      if (totalCost - cost(index) + costWith(index, hunk) > budget) {
        removalDropped ||= removes;
        continue;
      }
      admitHunk(index, hunk);
    }
    if (!admitted[index] && section.hunks.length === 0 && totalCost + section.header.length <= budget) {
      updateCost(index, section.header.length);
    }
  }

  const rendered: string[] = [];
  const omittedFiles: string[] = [];
  const partialFiles: string[] = [];
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
      partialFiles.push(section.path);
      rendered.push(partialMarker(section.path, section.hunks.length - keptHunks.length, section.hunks.length));
    }
  }

  return Object.freeze({
    diff: rendered.join(""),
    truncated: true,
    omittedChars: Math.max(0, originalChars - shownChars),
    omittedFiles: Object.freeze(omittedFiles.sort()),
    partialFiles: Object.freeze(partialFiles.sort()),
  });
}
