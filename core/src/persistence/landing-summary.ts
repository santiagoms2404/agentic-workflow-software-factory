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

/** The portable review record has one fixed, human-copyable Markdown shape. */
export function renderLandingSummary(summary: LandingSummary): string {
  return [
    "# Landing Summary",
    ...LANDING_SUMMARY_SECTIONS.flatMap((heading) => [
      "",
      `## ${heading}`,
      summary[keyFor(heading)].trim(),
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

  const values: Partial<Record<keyof LandingSummary, string>> = {};
  for (let index = 0; index < LANDING_SUMMARY_SECTIONS.length; index += 1) {
    const heading = LANDING_SUMMARY_SECTIONS[index]!;
    const startMarker = `## ${heading}\n`;
    const start = source.indexOf(startMarker);
    if (start === -1) return null;
    const bodyStart = start + startMarker.length;
    const next = LANDING_SUMMARY_SECTIONS[index + 1];
    const bodyEnd = next === undefined ? source.length : source.indexOf(`\n## ${next}\n`, bodyStart);
    if (bodyEnd === -1) return null;
    const value = source.slice(bodyStart, bodyEnd).trim();
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
