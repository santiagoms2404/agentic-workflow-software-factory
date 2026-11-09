import { CallCeilingExceeded } from "../../state/errors.ts";

export const PHASE_SILENCE_TIMEOUT_REASON = "configured silence timeout elapsed";

/** A typed silence stop keeps provider wording from deciding lifecycle evidence. */
export class PhaseSilenceTimeout extends Error {
  constructor(detail = PHASE_SILENCE_TIMEOUT_REASON) {
    super(detail);
    this.name = "PhaseSilenceTimeout";
  }
}

/** Classify only host-owned failures; provider text is never a blocker taxonomy. */
export function phaseBlocker(
  error: unknown,
  detail: string,
): { readonly code: "budget-exhausted" | "silence"; readonly detail: string } | null {
  if (error instanceof CallCeilingExceeded) return { code: "budget-exhausted", detail };
  if (error instanceof PhaseSilenceTimeout) return { code: "silence", detail };
  return null;
}

/** Rebuild the same named outcome from the phase record retained before a crash. */
export function persistedPhaseBlocker(
  errorCode: string | null,
  detail: string,
): { readonly code: string; readonly detail: string } | null {
  if (errorCode === "CallCeilingExceeded") return { code: "budget-exhausted", detail };
  if (errorCode === "PhaseSilenceTimeout") return { code: "silence", detail };
  if (errorCode === "ReviewEvidenceUnfit") return { code: "review-evidence-invalid", detail };
  if (errorCode === "EnvelopeValidationFailure") return { code: "review-malformed", detail };
  if (errorCode === "MandatoryReviewUnavailable") return { code: "review-unavailable", detail };
  return null;
}
