import type { Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CONFIG_SCHEMA_ID, AwsfConfigSchema, type AwsfConfig } from "./schema.ts";
import { MIN_CALL_CEILING } from "../state/tiers.ts";

// Minimal awsf/v1 configuration inventory for buildMinimalConfig (T02).
// This table records the schema and loader contract that determines every
// value below, so a schema change has a local inventory to update.
//
// | Top-level key | Minimal accepted value | Why |
// | --- | --- | --- |
// | schema | CONFIG_SCHEMA_ID (`"awsf/v1"`) | Required literal. |
// | project | `{ slug, default_workflow: "intake" }` | `slug` is checked by AwsfConfigSchema; `intake` is known to the loader. |
// | runtime | `{ silence_timeout_seconds: 1, process_grace_seconds: 0, max_output_bytes: 1, max_event_count: 1, seed_paths: [] }` | Integer floors, with no paths to normalize, overlap, or reject. |
// | adapters | `{ claude: { kind: "claude-code", enabled: true } }` | Exactly one locked adapter. Its identifier is valid, its kind is known, and it needs no executable, provider, or `verified` attestation. |
// | routing | `{ default_worker: "claude", review: "invert-provider", no_fallback: true }` | References the sole adapter and meets the loader's exact-true requirement. |
// | agents | `[]` | The schema has no minimum items and therefore no adapter references to validate. |
// | workflows | `{ enabled: ["intake"] }` | The sole known workflow matches `project.default_workflow`. |
// | gates | `{}` | The schema has no minimum entries and therefore no gate identifiers to validate. |
// | risk | `{ default: "T0", call_ceiling: { T0: MIN_CALL_CEILING, T1: MIN_CALL_CEILING, T2: MIN_CALL_CEILING }, correction_allowance: { auto: 0, owner: 0 }, paths: {} }` | `T0` and zero allowances are the structural minima. Each ceiling uses `MIN_CALL_CEILING`, never a repeated numeric literal, and remains within the loader's `MIN_CALL_CEILING` through `MAX_CALL_CEILING` bound. |
// | policy | `{ protected_paths: ["AGENTS.md", "awsf.config.yaml"], protected_operations: [] }` | The two required protected relative paths contain no absolute or credential-shaped value; no operation membership check is triggered. |
// | observability | `{ poll_ms: 1, db: "state://awsf.db", persist_thinking_text: false }` | Numeric floor, symbolic database URI, and the loader's exact-false requirement. |
// | pricing | `{ display_mode: "x", effective_date: null, models: {} }` | A one-character non-empty display mode, null date, and no fabricated model costs. |

export class InvalidProjectSlugError extends Error {
  constructor(slug: string) {
    super(`invalid project slug: ${JSON.stringify(slug)}; expected lowercase letters, digits, and internal hyphens`);
    this.name = "InvalidProjectSlugError";
  }
}

/** Builds the smallest configuration accepted by the awsf/v1 schema and loader. */
export function buildMinimalConfig(slug: string): AwsfConfig {
  const config: Static<typeof AwsfConfigSchema> = {
    schema: CONFIG_SCHEMA_ID,
    project: { slug, default_workflow: "intake" },
    runtime: {
      silence_timeout_seconds: 1,
      process_grace_seconds: 0,
      max_output_bytes: 1,
      max_event_count: 1,
      seed_paths: [],
    },
    adapters: { claude: { kind: "claude-code", enabled: true } },
    routing: { default_worker: "claude", review: "invert-provider", no_fallback: true },
    agents: [],
    workflows: { enabled: ["intake"] },
    gates: {},
    risk: {
      default: "T0",
      call_ceiling: { T0: MIN_CALL_CEILING, T1: MIN_CALL_CEILING, T2: MIN_CALL_CEILING },
      correction_allowance: { auto: 0, owner: 0 },
      paths: {},
    },
    policy: { protected_paths: ["AGENTS.md", "awsf.config.yaml"], protected_operations: [] },
    observability: { poll_ms: 1, db: "state://awsf.db", persist_thinking_text: false },
    pricing: { display_mode: "x", effective_date: null, models: {} },
  };

  if (!Value.Check(AwsfConfigSchema, config)) {
    throw new InvalidProjectSlugError(slug);
  }

  return config;
}
