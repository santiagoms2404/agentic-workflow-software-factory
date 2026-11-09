import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LANDING_SUMMARY_FILE = "landing-summary.md";
export const LANDING_SUMMARY_SECTIONS = ["Problem", "Changes", "Verification", "Risks"] as const;

export interface LandingSummary {
  readonly problem: string;
  readonly changes: string;
  readonly verification: string;
  readonly risks: string;
}

const keyFor = (heading: (typeof LANDING_SUMMARY_SECTIONS)[number]): keyof LandingSummary =>
  heading.toLowerCase() as keyof LandingSummary;

const TITLE = "# Landing Summary";
const ESCAPED_FORMAT = "<!-- awsf-landing-summary: escaped-v1 -->";
const sectionHeading = (line: string): boolean => LANDING_SUMMARY_SECTIONS.some(heading => line === `## ${heading}`);

// land.ts supplies the owner's free-text request and Git's summary, not a restricted
// Markdown grammar. Escape delimiter lines even inside code fences; a fence-aware
// reader cannot recover boundaries the old writer never distinguished. Escape leading
// backslashes too, and version the encoding so legacy literal backslashes stay literal.
const encodeBody = (body: string): string => body.trim().split("\n")
  .map(line => line.startsWith("\\") || sectionHeading(line) ? `\\${line}` : line).join("\n");
const decodeLine = (line: string): string => line.startsWith("\\\\") ||
  (line.startsWith("\\") && sectionHeading(line.slice(1))) ? line.slice(1) : line;

/** The portable review record has one fixed, human-copyable Markdown shape. */
export function renderLandingSummary(summary: LandingSummary): string {
  return [
    TITLE,
    ESCAPED_FORMAT,
    ...LANDING_SUMMARY_SECTIONS.flatMap((heading) => [
      "",
      `## ${heading}`,
      encodeBody(summary[keyFor(heading)]),
    ]),
    "",
  ].join("\n");
}

export async function writeLandingSummary(attemptDir: string, summary: LandingSummary): Promise<void> {
  await writeFile(join(attemptDir, LANDING_SUMMARY_FILE), renderLandingSummary(summary), "utf8");
}

/** Missing, unreadable, or malformed records render as absent rather than breaking the read surface. */
export async function readLandingSummary(attemptDir: string): Promise<LandingSummary | null> {
  let source: string;
  try {
    source = await readFile(join(attemptDir, LANDING_SUMMARY_FILE), "utf8");
  } catch {
    return null;
  }

  const lines = source.split("\n");
  const boundaries = lines.flatMap((line, index) => sectionHeading(line) ? [index] : []);
  // A legacy duplicate is irrecoverably ambiguous. Do not silently move request
  // text into Changes (or guess which of several identical headings was intended).
  if (boundaries.length !== LANDING_SUMMARY_SECTIONS.length) return null;
  const prefix = lines.slice(0, boundaries[0]).join("\n").trim();
  const escaped = prefix === `${TITLE}\n${ESCAPED_FORMAT}`;
  if (!escaped && prefix !== TITLE) return null;

  const values: Partial<Record<keyof LandingSummary, string>> = {};
  for (let index = 0; index < LANDING_SUMMARY_SECTIONS.length; index += 1) {
    const heading = LANDING_SUMMARY_SECTIONS[index]!;
    const start = boundaries[index]!;
    if (lines[start] !== `## ${heading}`) return null;
    const body = lines.slice(start + 1, boundaries[index + 1]);
    const value = (escaped ? body.map(decodeLine) : body).join("\n").trim();
    if (value.length === 0) return null;
    values[keyFor(heading)] = value;
  }

  if (values.problem === undefined || values.changes === undefined || values.verification === undefined || values.risks === undefined) return null;
  return {
    problem: values.problem,
    changes: values.changes,
    verification: values.verification,
    risks: values.risks,
  };
}
