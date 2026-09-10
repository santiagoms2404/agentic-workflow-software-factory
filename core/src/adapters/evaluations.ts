import type { RouteEvaluation } from "../contracts/route-selection.ts";

export interface ExternalHarnessFinding {
  readonly harness: "openclaw" | "hermes-agent";
  readonly disposition: "not-an-awsf-route";
  readonly finding: string;
  readonly evaluation: RouteEvaluation;
}

/**
 * Bounded discovery findings for the two suggested harnesses.
 *
 * Only first-party project repositories are cited. Their advertised provider
 * and tool capabilities are discovery evidence, not protocol evidence: AWSF
 * has not captured either harness's raw non-interactive stream, proved model
 * identity, or reviewed correction continuity. Neither is therefore added to
 * KNOWN_ADAPTER_KINDS or made selectable by a phase route.
 *
 * There are intentionally no scores. An adapter/model score detached from a
 * phase prompt, tool policy and observed run would be a global model claim.
 */
export const EXTERNAL_HARNESS_FINDINGS: readonly ExternalHarnessFinding[] = Object.freeze([
  Object.freeze({
    harness: "openclaw",
    disposition: "not-an-awsf-route",
    finding: "OpenClaw's official project describes a multi-provider personal assistant, but supplies no captured AWSF ProcessSpec/event/identity evidence; keep it outside the executable adapter set.",
    evaluation: Object.freeze({
      summary: "Discovery only; no AWSF route evaluation has been run.",
      sources: [{
        kind: "official-documentation" as const,
        title: "OpenClaw official repository",
        publisher: "OpenClaw",
        url: "https://github.com/openclaw/openclaw",
        checked_at: "2026-09-04",
      }],
    }),
  }),
  Object.freeze({
    harness: "hermes-agent",
    disposition: "not-an-awsf-route",
    finding: "Hermes Agent's official project describes a tool-using CLI with model-provider configuration, but supplies no captured AWSF ProcessSpec/event/identity evidence; keep it outside the executable adapter set.",
    evaluation: Object.freeze({
      summary: "Discovery only; no AWSF route evaluation has been run.",
      sources: [{
        kind: "official-documentation" as const,
        title: "Hermes Agent official repository",
        publisher: "Nous Research",
        url: "https://github.com/NousResearch/hermes-agent",
        checked_at: "2026-09-04",
      }],
    }),
  }),
]);
