import { Type, type Static } from "@sinclair/typebox";
import { WORKFLOW_IDS } from "./workflow-ids.ts";

// awsf/v1 — the single committed tuning surface (awsf.config.yaml), shaped
// exactly per the accepted proposal's §7.3.5 example
// (specs/awsf-architecture-proposal.md). "Durable intent" per the Ownership
// section: no machine paths, no credentials, no PIDs, and no measured quota
// state belong here. A durable quota policy threshold is permitted; the owner
// chooses it rather than a probe measuring it. load.ts retains the machine-path
// and credential boundaries, while this schema excludes measured quota fields.

export const CONFIG_SCHEMA_ID = "awsf/v1";

// Identifier sets are intentionally NOT TypeBox enums here — load.ts checks
// membership against these so the known-set can grow without touching the
// structural schema. Kept as `as const` tuples (strip-mode-safe, no `enum`).
//
// Adapter kinds follow §7.3.5's literal vocabulary, not the File Manifest's
// module filenames: `fixture` is implemented by `adapters/stub.ts` and
// `composite-fusion` by `adapters/fusion.ts` — the registry (T13-15) maps
// kind -> module, the same way `claude-code`/`pi-codex`/`antigravity` map to
// their same-named files.
export const KNOWN_ADAPTER_KINDS = ["claude-code", "pi-codex", "antigravity", "fixture", "composite-fusion"] as const;
export const KNOWN_WORKFLOW_IDS = WORKFLOW_IDS;
// §7.3.5 configures the argv-driven gates; the others (envelope validation,
// artifact/diff/write/hygiene checks, review verdict, journey) are
// structural and take no configuration. This set is loader-checked, not
// schema-closed, so a later task can extend it without touching schema.ts.
export const KNOWN_GATE_IDS = ["test", "typecheck", "lint"] as const;
export const KNOWN_RISK_TIERS = ["T0", "T1", "T2"] as const;
// Per the Ownership section and the Envelope & Gate Contract: `protected` is
// orthogonal to risk tier — credential access, external mutation, deletion,
// migration, release/cutover, credit-billed execution.
export const KNOWN_PROTECTED_OPERATIONS = [
  "credential-access",
  "external-mutation",
  "delete",
  "migration",
  "release-cutover",
  "credit-billed-model",
] as const;

const IdentifierString = Type.String({ minLength: 1, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$" });
const NonEmptyString = Type.String({ minLength: 1 });
const RiskTier = Type.Union([Type.Literal("T0"), Type.Literal("T1"), Type.Literal("T2")]);

/** Owner-selectable reasoning intent; each adapter must represent it or refuse preflight. */
export const ROUTE_EFFORT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export const REVIEW_ROUTE_MODES = ["invert-provider", "same-provider-degraded"] as const;

export const RouteEvaluationSourceSchema = Type.Object({
  kind: Type.Union([Type.Literal("official-documentation"), Type.Literal("observed-run")]),
  title: NonEmptyString,
  publisher: NonEmptyString,
  url: Type.String({ minLength: 1, pattern: "^https://" }),
  checked_at: NonEmptyString,
}, { additionalProperties: false });

/** Evidence stays attached to one phase route; there is deliberately no score field. */
export const RouteEvaluationSchema = Type.Object({
  summary: NonEmptyString,
  sources: Type.Array(RouteEvaluationSourceSchema, { minItems: 1 }),
}, { additionalProperties: false });

export const PhaseRouteSelectionSchema = Type.Object({
  model: Type.Optional(NonEmptyString),
  effort: Type.Optional(Type.Union(ROUTE_EFFORT_LEVELS.map((level) => Type.Literal(level)))),
  adapter: Type.Optional(IdentifierString),
  provider: Type.Optional(NonEmptyString),
  evaluation: Type.Optional(RouteEvaluationSchema),
}, { additionalProperties: false });

export const ProjectSlugSchema = Type.String({ minLength: 1, pattern: "^[a-z0-9][a-z0-9-]*$" });

const ProjectSchema = Type.Object(
  {
    slug: ProjectSlugSchema,
    default_workflow: IdentifierString, // membership checked by load.ts against KNOWN_WORKFLOW_IDS
  },
  { additionalProperties: false },
);

const RuntimeSchema = Type.Object(
  {
    silence_timeout_seconds: Type.Integer({ minimum: 1 }),
    process_grace_seconds: Type.Integer({ minimum: 0 }),
    max_output_bytes: Type.Integer({ minimum: 1 }),
    max_event_count: Type.Integer({ minimum: 1 }),
    // Repository-relative ignored paths copied into each detached worktree
    // before PREPARED. Machine-local source roots and install commands do not
    // belong in durable config.
    seed_paths: Type.Array(NonEmptyString, { uniqueItems: true }),
  },
  { additionalProperties: false },
);

// Keyed by adapter id (`claude`, `codex`, `antigravity`, `stub`, `fusion`, …)
// — the key is the id agents' `harness.adapter` and `routing.default_worker`
// reference; `kind` selects the implementation and is checked by load.ts
// against KNOWN_ADAPTER_KINDS.
const AdapterEntrySchema = Type.Object(
  {
    kind: NonEmptyString,
    executable: Type.Optional(NonEmptyString),
    provider: Type.Optional(NonEmptyString),
    enabled: Type.Optional(Type.Boolean()),
    // `verified` is meaningful only for Antigravity today. It is an explicit
    // operator attestation that the documented capture-and-read procedure ran.
    verified: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const QuotaStopEntrySchema = Type.Object(
  {
    minutes: Type.Integer({ minimum: 0 }),
    probe_timeout_ms: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const QuotaStopSchema = Type.Object(
  {
    default: QuotaStopEntrySchema,
    // Keys are adapter ids, matching ConfiguredPhaseRoute.adapterId. Adapter
    // membership is resolved by consumers against the configured route set.
    by_adapter: Type.Optional(Type.Record(IdentifierString, QuotaStopEntrySchema)),
  },
  { additionalProperties: false },
);

const RoutingSchema = Type.Object(
  {
    default_worker: IdentifierString, // must reference a declared adapters key
    // Opposite-provider review remains the default and the shipped value.
    // Same-provider review has one deliberately alarming spelling and is never
    // selected from availability, quota, or a transport failure.
    review: Type.Union(REVIEW_ROUTE_MODES.map((mode) => Type.Literal(mode))),
    no_fallback: Type.Boolean(), // load.ts rejects any value other than `true`
    // Per-PHASE overrides change only route controls. Prompt, tools, writes and
    // continuity continue to come from the phase's configured role.
    phase_routes: Type.Optional(Type.Record(IdentifierString, PhaseRouteSelectionSchema)),
    // Omission disables the stop and preserves pre-W07 behavior.
    quota_stop: Type.Optional(QuotaStopSchema),
  },
  { additionalProperties: false },
);

// tools is a capability list, not a sandbox — writes is the enforced
// statement (`exec` runs anything, `write` reaches any path). An agent whose
// harness extension registers a tool must name that tool in `tools.allow` or
// the extension loads and the tool is silently filtered by the adapter.
const AgentDefinitionSchema = Type.Object(
  {
    name: IdentifierString,
    model: NonEmptyString,
    thinking: Type.Union(ROUTE_EFFORT_LEVELS.map((level) => Type.Literal(level))),
    color: Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" }),
    purpose: NonEmptyString,
    prompt: Type.Object(
      { system: NonEmptyString, user: NonEmptyString }, // repo-relative paths, never absolute
      { additionalProperties: false },
    ),
    harness: Type.Object(
      {
        adapter: IdentifierString, // must reference a declared adapters key
        continuity: Type.Union([Type.Literal("same-session"), Type.Literal("none")]),
        interrupted_turn: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
    tools: Type.Object(
      { profile: NonEmptyString, allow: Type.Array(NonEmptyString) },
      { additionalProperties: false },
    ),
    writes: Type.Array(NonEmptyString), // [] = repository-read-only
  },
  { additionalProperties: false },
);

const WorkflowsSchema = Type.Object(
  {
    enabled: Type.Array(IdentifierString), // membership checked by load.ts against KNOWN_WORKFLOW_IDS
  },
  { additionalProperties: false },
);

// Only the argv-driven gates are configurable; ids are checked by load.ts
// against KNOWN_GATE_IDS. The structural gates (envelope_valid,
// diff_matches_claims, verdict_consistent, …) are hardcoded in
// core/src/gates/ and never appear here.
export const GateEntrySchema = Type.Object(
  {
    argv: Type.Array(NonEmptyString, { minItems: 1 }),
    timeout_seconds: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const RiskSchema = Type.Object(
  {
    default: RiskTier,
    // One ceiling per risk tier, and a real dial: any whole number of calls
    // the loader admits (`MIN_CALL_CEILING`..`MAX_CALL_CEILING` in
    // core/src/state/tiers.ts). The shipped defaults stay 1/3/5. The upper
    // bound lives in code, never here — a bound the config could raise would
    // be a bound the config could remove.
    call_ceiling: Type.Object(
      { T0: Type.Integer(), T1: Type.Integer(), T2: Type.Integer() },
      { additionalProperties: false },
    ),
    correction_allowance: Type.Object(
      { auto: Type.Integer({ minimum: 0 }), owner: Type.Integer({ minimum: 0 }) },
      { additionalProperties: false },
    ),
    paths: Type.Record(Type.String(), RiskTier), // keyed by glob pattern
  },
  { additionalProperties: false },
);

const PolicySchema = Type.Object(
  {
    protected_paths: Type.Array(NonEmptyString),
    // membership checked by load.ts against KNOWN_PROTECTED_OPERATIONS
    protected_operations: Type.Array(NonEmptyString),
  },
  { additionalProperties: false },
);

const ObservabilitySchema = Type.Object(
  {
    poll_ms: Type.Integer({ minimum: 1 }),
    // symbolic `state://` scheme only — the real root is resolved at runtime
    // by platform-paths.ts; a config value can never be an absolute machine
    // path because this pattern structurally forbids it.
    db: Type.String({ pattern: "^state://[A-Za-z0-9._-]+$" }),
    // invariant 9: thinking is streamed for live display and never
    // persisted. load.ts rejects any value other than `false`.
    persist_thinking_text: Type.Boolean(),
  },
  { additionalProperties: false },
);

// Empty by default (Q7) — AWSF never fabricates a $0.00 cost; a route with
// no entry under `models` renders "— subscription", never `$0.00`.
const PricingSchema = Type.Object(
  {
    display_mode: NonEmptyString,
    effective_date: Type.Union([NonEmptyString, Type.Null()]),
    models: Type.Record(
      Type.String(),
      Type.Object(
        { input_cost_per_1m: Type.Number({ minimum: 0 }), output_cost_per_1m: Type.Number({ minimum: 0 }) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export const AwsfConfigSchema = Type.Object(
  {
    schema: Type.Literal(CONFIG_SCHEMA_ID),
    project: ProjectSchema,
    runtime: RuntimeSchema,
    adapters: Type.Record(IdentifierString, AdapterEntrySchema),
    routing: RoutingSchema,
    agents: Type.Array(AgentDefinitionSchema),
    workflows: WorkflowsSchema,
    gates: Type.Record(IdentifierString, GateEntrySchema),
    risk: RiskSchema,
    policy: PolicySchema,
    observability: ObservabilitySchema,
    pricing: PricingSchema,
  },
  { additionalProperties: false },
);

export type AwsfConfig = Static<typeof AwsfConfigSchema>;
export type AgentDefinition = Static<typeof AgentDefinitionSchema>;
export type AdapterEntry = Static<typeof AdapterEntrySchema>;
export type GateEntry = Static<typeof GateEntrySchema>;
export type QuotaStopEntry = Static<typeof QuotaStopEntrySchema>;
export type RiskTierName = Static<typeof RiskTier>;
