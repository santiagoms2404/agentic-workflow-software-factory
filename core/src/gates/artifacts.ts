import type { ArtifactClaim } from "../contracts/envelope-base.ts";
import { GateReport } from "./interface.ts";

export interface ArtifactObservation {
  readonly exists: boolean;
  readonly size: number;
  /** UTF-8 content when the host captured it; required by `json_parses`. */
  readonly content?: string;
}

export type ArtifactReader = (path: string) => ArtifactObservation;

export function artifactsExist(artifacts: readonly ArtifactClaim[], read: ArtifactReader): GateReport {
  const report = new GateReport("artifacts_exist");
  if (artifacts.length === 0) return report.check("declared artifacts", true, "no artifacts declared");
  for (const artifact of artifacts) {
    const observed = read(artifact.path);
    report.check(artifact.path, observed.exists, observed.exists ? `exists; size=${observed.size} bytes` : "missing");
  }
  return report;
}

export function filesNonEmpty(artifacts: readonly ArtifactClaim[], read: ArtifactReader): GateReport {
  const report = new GateReport("files_non_empty");
  if (artifacts.length === 0) return report.check("declared artifacts", true, "no artifacts declared");
  for (const artifact of artifacts) {
    const observed = read(artifact.path);
    report.check(
      artifact.path,
      observed.exists && observed.size > 0,
      observed.exists ? `size=${observed.size} bytes` : "missing",
    );
  }
  return report;
}

function topLevelType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function jsonParses(artifacts: readonly ArtifactClaim[], read: ArtifactReader): GateReport {
  const report = new GateReport("json_parses");
  const jsonArtifacts = artifacts.filter((artifact) => artifact.path.toLowerCase().endsWith(".json"));
  if (jsonArtifacts.length === 0) return report.check("JSON artifacts", true, "no .json artifacts declared");
  for (const artifact of jsonArtifacts) {
    const observed = read(artifact.path);
    let parsed: unknown;
    let ok = observed.exists && observed.content !== undefined;
    if (ok) {
      try {
        parsed = JSON.parse(observed.content!);
      } catch {
        ok = false;
      }
    }
    report.check(
      artifact.path,
      ok,
      ok ? `parses; top-level type=${topLevelType(parsed)}` : observed.exists ? "invalid or unreadable JSON" : "missing",
    );
  }
  return report;
}
