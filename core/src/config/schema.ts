import { Type, type Static } from "@sinclair/typebox";

// awsf/v1 — the single committed tuning surface (awsf.config.yaml), shaped
// exactly per the accepted proposal's §7.3.5 example
// (specs/awsf-architecture-proposal.md). "Durable intent" per the Ownership
// section: no machine paths, no credentials, no PIDs, no quota fields ever
// belong here. load.ts enforces that boundary at load time; this file only
// enforces shape.

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
export const KNOWN_WORKFLOW_IDS = [
  "scout",
  "plan",
  "build",
  "plan-build-test",
  "build-review",
  "simple-sdlc",
] as const;
// §7.3.5 configures exactly two argv-driven gates; the other nine (envelope
// validation, artifact/diff/write checks, review verdict, journey) are
// structural and take no configuration. This set is loader-checked, not
// schema-closed, so a later task can extend it without touching schema.ts.
export const KNOWN_GATE_IDS = ["test", "typecheck"] as const;
export const KNOWN_RISK_TIERS = ["T0", "T1", "T2"] as const;
export const VALID_TIER_CEILINGS = [1, 3, 5] as const;
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

const ProjectSchema = Type.Object(
  {
    slug: Type.String({ minLength: 1, pattern: "^[a-z0-9][a-z0-9-]*$" }),
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

const RoutingSchema = Type.Object(
  {
    default_worker: IdentifierString, // must reference a declared adapters key
    review: Type.Literal("invert-provider"),
    no_fallback: Type.Boolean(), // load.ts rejects any value other than `true`
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
    thinking: Type.Union([
      Type.Literal("none"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
    ]),
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
const GateEntrySchema = Type.Object(
  {
    argv: Type.Array(NonEmptyString, { minItems: 1 }),
    timeout_seconds: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const RiskSchema = Type.Object(
  {
    default: RiskTier,
    // one ceiling per risk tier; each value checked by load.ts against
    // VALID_TIER_CEILINGS ({1,3,5}).
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
export type RiskTierName = Static<typeof RiskTier>;
