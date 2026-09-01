import { ARTIFACT_KINDS, type ArtifactKind, type EnvelopeBase } from "../contracts/envelope-base.ts";
import type { GateCheck } from "../gates/interface.ts";

export type OwnedOutput = "plan" | "source-and-tests" | "documentation" | "run-report" | "review" | "host-test-evidence";

export interface PhaseOutputOwnership {
  readonly outputs: readonly OwnedOutput[];
  readonly artifactKinds: readonly ArtifactKind[];
}

/** One ownership table for every shipped phase that can author an agent envelope. */
export const PHASE_OUTPUT_OWNERSHIP = Object.freeze({
  request: { outputs: ["plan"], artifactKinds: [] },
  planner: { outputs: ["plan"], artifactKinds: ARTIFACT_KINDS },
  plan: { outputs: ["plan"], artifactKinds: ARTIFACT_KINDS },
  builder: { outputs: ["source-and-tests"], artifactKinds: ["source", "test"] },
  tests: { outputs: ["host-test-evidence"], artifactKinds: [] },
  "final-tests": { outputs: ["host-test-evidence"], artifactKinds: [] },
  documenter: { outputs: ["documentation", "run-report"], artifactKinds: ["documentation"] },
  "review-context": { outputs: ["review"], artifactKinds: [] },
  reviewer: { outputs: ["review"], artifactKinds: ARTIFACT_KINDS },
  "design-context": { outputs: ["plan"], artifactKinds: [] },
  design: { outputs: ["plan"], artifactKinds: ARTIFACT_KINDS },
  "architecture-review": { outputs: ["review"], artifactKinds: ARTIFACT_KINDS },
  "plan-context": { outputs: ["plan"], artifactKinds: [] },
  "plan-render": { outputs: ["plan", "documentation"], artifactKinds: ["plan", "documentation"] },
  scout: { outputs: ["review"], artifactKinds: ARTIFACT_KINDS },
  intake: { outputs: ["plan"], artifactKinds: ["documentation"] },
} as const satisfies Readonly<Record<string, PhaseOutputOwnership>>);

export function outputOwnershipCheck(phaseId: string, envelope: EnvelopeBase): GateCheck {
  const ownership = (PHASE_OUTPUT_OWNERSHIP as Readonly<Record<string, PhaseOutputOwnership>>)[phaseId];
  if (ownership === undefined) {
    return { item: "phase output ownership", ok: false, note: `phase ${JSON.stringify(phaseId)} has no ownership declaration` };
  }
  const allowed = new Set<ArtifactKind>(ownership.artifactKinds);
  const violations = envelope.artifacts.filter((artifact) => !allowed.has(artifact.kind));
  return {
    item: "phase output ownership",
    ok: violations.length === 0,
    note: violations.length === 0
      ? `${phaseId} owns ${ownership.outputs.join(", ")} and declared ${String(envelope.artifacts.length)} permitted artifact(s)`
      : `${phaseId} does not own ${violations.map((artifact) => `${artifact.kind}:${artifact.path}`).join(", ")}`,
  };
}
