import { Type, type Static } from "@sinclair/typebox";

// awsf/v1 — the single committed tuning surface (awsf.config.yaml).
// "Durable intent" per the Ownership section: no machine paths, no
// credentials, no PIDs, no quota fields ever belong here. load.ts enforces
// that boundary at load time; this file only enforces shape.

export const CONFIG_SCHEMA_ID = "awsf/v1";

// Identifier sets are intentionally NOT TypeBox enums here — load.ts checks
// membership against these so the known-set can grow without touching the
// structural schema. Kept as `as const` tuples (strip-mode-safe, no `enum`).
export const KNOWN_ADAPTER_KINDS = ["claude-code", "pi-codex", "antigravity", "stub", "fusion"] as const;
export const KNOWN_WORKFLOW_IDS = [
  "scout",
  "plan",
  "build",
  "plan-build-test",
  "build-review",
  "simple-sdlc",
] as const;
// The eleven gates. `commands_pass` is parameterized (config supplies argv);
// the rest are structural and take no configuration beyond being named.
export const KNOWN_GATE_KINDS = [
  "envelope_valid",
  "artifacts_exist",
  "files_non_empty",
  "json_parses",
  "diff_matches_claims",
  "head_advanced",
  "no_protected_paths",
  "writes_within_globs",
  "verdict_consistent",
  "commands_pass",
  "journey_passes",
] as const;
export const VALID_TIER_CEILINGS = [1, 3, 5] as const;
export const KNOWN_RISK_TIERS = [0, 1, 2] as const;

const IdentifierString = Type.String({ minLength: 1, pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$" });

const ProjectSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    slug: Type.String({ minLength: 1, pattern: "^[a-z0-9][a-z0-9-]*$" }),
  },
  { additionalProperties: false },
);

const RuntimeSchema = Type.Object(
  {
    default_workflow: IdentifierString,
    default_tier: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
    poll_ms: Type.Integer({ minimum: 250 }),
  },
  { additionalProperties: false },
);

const AdapterEntrySchema = Type.Object(
  {
    id: IdentifierString,
    kind: Type.String({ minLength: 1 }), // membership checked by load.ts against KNOWN_ADAPTER_KINDS
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

const RoutingSchema = Type.Object(
  {
    review: Type.Literal("invert-provider"),
    no_fallback: Type.Boolean(), // load.ts rejects any value other than `true`
  },
  { additionalProperties: false },
);

// tools is a capability list, not a sandbox — writes is the enforced
// statement. An agent whose harness extension registers a tool must name
// that tool here or the tool is silently filtered by the adapter.
const AgentDefinitionSchema = Type.Object(
  {
    name: IdentifierString,
    model: Type.String({ minLength: 1 }),
    thinking: Type.Union([
      Type.Literal("none"),
      Type.Literal("low"),
      Type.Literal("medium"),
      Type.Literal("high"),
    ]),
    color: Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" }),
    purpose: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }), // repo-relative path under prompts/, never absolute
    harness: IdentifierString, // must reference a declared adapters[].id
    tools: Type.Array(Type.String({ minLength: 1 })),
    writes: Type.Array(Type.String({ minLength: 1 })), // [] = repository-read-only
  },
  { additionalProperties: false },
);

const WorkflowEntrySchema = Type.Object(
  {
    id: IdentifierString, // membership checked by load.ts against KNOWN_WORKFLOW_IDS
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);

const CommandGateSchema = Type.Object(
  {
    kind: Type.Literal("commands_pass"),
    argv: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  },
  { additionalProperties: false },
);

const StructuralGateSchema = Type.Object(
  {
    kind: Type.String({ minLength: 1 }), // membership checked by load.ts against KNOWN_GATE_KINDS
  },
  { additionalProperties: false },
);

const GateEntrySchema = Type.Union([CommandGateSchema, StructuralGateSchema]);

const RiskSchema = Type.Object(
  {
    // one ceiling per risk tier (0/1/2); each value checked by load.ts
    // against VALID_TIER_CEILINGS ({1,3,5}).
    tier_ceilings: Type.Object(
      {
        "0": Type.Integer(),
        "1": Type.Integer(),
        "2": Type.Integer(),
      },
      { additionalProperties: false },
    ),
    paths: Type.Array(
      Type.Object(
        {
          pattern: Type.String({ minLength: 1 }),
          tier: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2)]),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const PolicySchema = Type.Object(
  {
    protected_paths: Type.Array(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

const ObservabilitySchema = Type.Object(
  {
    redaction_level_default: Type.Union([Type.Literal("public"), Type.Literal("private-ref")]),
  },
  { additionalProperties: false },
);

// Empty by default — Q7's decision. AWSF never fabricates a $0.00 cost;
// pricing.provider stays "unavailable" until an entry is added here.
const PricingEntrySchema = Type.Object(
  {
    adapter: IdentifierString,
    model: Type.String({ minLength: 1 }),
    input_cost_per_1m: Type.Number({ minimum: 0 }),
    output_cost_per_1m: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const AwsfConfigSchema = Type.Object(
  {
    schema: Type.Literal(CONFIG_SCHEMA_ID),
    project: ProjectSchema,
    runtime: RuntimeSchema,
    adapters: Type.Array(AdapterEntrySchema),
    routing: RoutingSchema,
    agents: Type.Array(AgentDefinitionSchema),
    workflows: Type.Array(WorkflowEntrySchema),
    gates: Type.Record(IdentifierString, GateEntrySchema),
    risk: RiskSchema,
    policy: PolicySchema,
    observability: ObservabilitySchema,
    pricing: Type.Array(PricingEntrySchema),
  },
  { additionalProperties: false },
);

export type AwsfConfig = Static<typeof AwsfConfigSchema>;
export type AgentDefinition = Static<typeof AgentDefinitionSchema>;
export type AdapterEntry = Static<typeof AdapterEntrySchema>;
export type WorkflowEntry = Static<typeof WorkflowEntrySchema>;
export type GateEntry = Static<typeof GateEntrySchema>;
