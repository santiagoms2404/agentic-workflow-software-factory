import type { BoundVisualFrame, VisualObservation } from "../contracts/visual-references.ts";
import { GateReport } from "./interface.ts";

const EVIDENCE_LIMIT = "this proves the bound bytes reached the model through its image tool in this phase, never the quality of the visual judgment made from them";

export interface PhaseVisualObservation extends VisualObservation {
  /** The phase whose own turn observed the image. */
  readonly phaseId: string;
}

export interface VisualInspectionInput {
  readonly phaseId: string;
  readonly frames: readonly Pick<BoundVisualFrame, "id" | "sha256">[];
  readonly observations: readonly PhaseVisualObservation[];
}

/**
 * Every bound frame must have come back from a successful image-tool call made
 * by THIS phase, with exactly the bound bytes. A prompt that names a path, a
 * worker that says it looked, a hash the host computed itself, and an image
 * another phase opened all leave a frame unobserved.
 */
export function visualReferencesInspected(input: VisualInspectionInput): GateReport {
  const report = new GateReport("visual_references_inspected");
  const own = input.observations.filter((observation) => observation.phaseId === input.phaseId);
  const foreign = input.observations.length - own.length;
  const delivered = own.filter((observation) => observation.outcome === "ok");
  report.check(
    "image tool results observed in this phase",
    delivered.length > 0,
    delivered.length > 0
      ? `${String(delivered.length)} image result(s) observed; ${String(foreign)} from other phases not counted`
      : `no successful image tool result was observed in ${input.phaseId}; ${String(foreign)} from other phases not counted`,
  );
  for (const frame of input.frames) {
    const matched = delivered.find((observation) => observation.sha256 === frame.sha256);
    report.check(
      `frame ${frame.id} opened through the image tool`,
      matched !== undefined,
      matched !== undefined
        ? `${matched.toolName} ${matched.toolCallId} returned sha256:${frame.sha256}`
        : `no image result carried sha256:${frame.sha256}; open the delivered file for ${frame.id} with the read tool`,
    );
  }
  const unrequested = delivered.filter((observation) => !input.frames.some((frame) => frame.sha256 === observation.sha256));
  report.check(
    "evidence limit",
    true,
    `${String(unrequested.length)} image result(s) matched no bound frame; ${EVIDENCE_LIMIT}`,
  );
  return report;
}
