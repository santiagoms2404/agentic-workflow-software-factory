// TypeBox schemas for the route-metrics data and payload, shared by the rate
// card test and the metrics route test. The dashboard cannot depend on
// TypeBox (invariant 7), so the schemas live with the tests.

import { Type } from "@sinclair/typebox";

const IsoDate = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const Usd = Type.Number({ minimum: 0 });

export const RateCardRowSchema = Type.Object({
  model: Type.String({ pattern: "^(claude|gpt)-[a-z0-9.-]+$" }),
  label: Type.String({ minLength: 1 }),
  provider: Type.Union([Type.Literal("anthropic"), Type.Literal("openai")]),
  tier: Type.Union([Type.Literal("state of the art"), Type.Literal("workhorse"), Type.Literal("lightweight")]),
  input: Usd,
  cacheWrite: Usd,
  cacheRead: Usd,
  output: Usd,
  note: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  checkedAt: IsoDate,
  source: Type.String({ pattern: "^https://" }),
}, { additionalProperties: false });

export const RateCardSchema = Type.Object({
  checkedAt: IsoDate,
  rows: Type.Array(RateCardRowSchema, { minItems: 1 }),
  limitations: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
}, { additionalProperties: false });

export const BenchmarkSchema = Type.Object({
  id: Type.String({ pattern: "^[a-z0-9-]+$" }),
  name: Type.String({ minLength: 1 }),
  tests: Type.String({ minLength: 1 }),
  informs: Type.String({ minLength: 1 }),
  roles: Type.Array(Type.String({ minLength: 1 })),
  transfer: Type.Union(["high", "medium", "low", "none", "high as a method"].map((value) => Type.Literal(value))),
  scale: Type.Union([Type.Literal("percent"), Type.Literal("elo"), Type.Literal("index")]),
  scores: Type.Array(Type.Object({
    model: Type.String({ minLength: 1 }),
    score: Type.Number({ minimum: 0 }),
    effort: Type.Union([Type.String(), Type.Null()]),
  }, { additionalProperties: false })),
  summary: Type.String({ minLength: 1 }),
  sources: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  checkedAt: IsoDate,
}, { additionalProperties: false });

export const BenchmarkPriorsSchema = Type.Object({
  checkedAt: IsoDate,
  benchmarks: Type.Array(BenchmarkSchema, { minItems: 1 }),
  modelLabels: Type.Record(Type.String(), Type.String()),
}, { additionalProperties: false });


const Nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) => Type.Union([schema, Type.Null()]);
const Str = Type.String();
const NStr = Nullable(Type.String());
const Count = Type.Integer({ minimum: 0 });
const NCount = Nullable(Type.Integer({ minimum: 0 }));
const Flag = Type.Boolean();
const Literals = (values: readonly string[]) => Type.Union(values.map((value) => Type.Literal(value)));
const Attribution = Literals(["model", "factory", "environment", "owner", "unknown"]);
const EffortSource = Nullable(Literals(["journal", "config-phase-route", "config-agent", "unknown"]));
const Provenance = Nullable(Literals(["stream-authoritative", "route-attributed"]));
const UsageAuthority = Literals(["provider", "partial", "none"]);
const StateGroup = Literals(["LANDED", "AWAITING_OWNER", "OPEN", "CANCELLED", "BLOCKED"]);
const ToolCounts = Type.Object({ read: Count, search: Count, edit: Count, exec: Count, other: Count }, { additionalProperties: false });
const Route = Type.Object({ adapter: NStr, provider: NStr, model: NStr, effort: NStr }, { additionalProperties: false });
const Tokens = Type.Object({
  inputTokens: NCount, outputTokens: NCount, cacheReadTokens: NCount, cacheWriteTokens: NCount, reasoningTokens: NCount,
  reasoningRelation: Literals(["included-in-output", "additive", "unknown"]),
  usageEvents: Count,
}, { additionalProperties: false });

export const RoleRowSchema = Type.Object({
  sessionId: Str, taskId: Str, attempt: Count, role: Str,
  route: Route, effortSource: EffortSource, routeMixed: Flag, identityProvenance: Provenance, resolvedModel: NStr,
  calls: Count, turns: Count, phases: Count, minutes: Nullable(Type.Number({ minimum: 0 })), corrections: Count,
  settled: Flag, firstPass: Flag, cleanCompletion: Flag, failedHere: Flag, blockedHere: Flag,
  attribution: Nullable(Attribution), attributionSource: Nullable(Literals(["owner", "heuristic"])),
  heuristicAttribution: Nullable(Literals(["model", "factory", "environment", "unknown"])),
  tokens: Tokens, costAuthority: Literals(["provider", "catalog-estimate", "unavailable"]),
  tools: ToolCounts, toolErrors: Count,
  gates: Type.Object({ pass: Count, total: Count, firstRoundFail: Type.Array(Str) }, { additionalProperties: false }),
  guardrailHits: Count, claims: Count, refuted: Count, honestStops: Count, recovered: Count, corrected: Count,
  stateGroup: StateGroup, workflow: Str, tier: Count, project: Str, planRef: NStr, reviewVerdict: NStr,
  ownerReentries: Count, reworkPhases: Count, observabilityDegraded: Flag, usageAuthority: UsageAuthority,
  startedAt: Str, endedAt: NStr,
  source: Literals(["production", "proving-ground"]), itemId: NStr, arm: NStr,
  repetition: Nullable(Type.Integer({ minimum: 1 })), order: Nullable(Type.Integer({ minimum: 1 })),
}, { additionalProperties: false });

const AgentPhase = Type.Object({
  route: Type.Object({ adapter: NStr, provider: NStr, model: NStr, effort: NStr, effortSource: EffortSource }, { additionalProperties: false }),
  requestedModel: NStr, resolvedModel: NStr, modelProvenance: Provenance, turns: Count, tokens: Tokens,
  tools: Type.Object({ calls: Count, byClass: ToolCounts, errors: Count }, { additionalProperties: false }),
}, { additionalProperties: false });

const RunPhase = Type.Object({
  phaseId: Str, key: Str, ordinal: Count, kind: Literals(["agent", "code", "engineer"]), owner: Str,
  status: Literals(["QUEUED", "RUNNING", "VALIDATING", "CORRECTING", "SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED"]),
  correctionCount: Count, maxCorrections: Count, errorCode: NStr, startedAt: NStr, endedAt: NStr,
  minutes: Nullable(Type.Number({ minimum: 0 })), agent: Nullable(AgentPhase),
}, { additionalProperties: false });

export const MetricsRunSchema = Type.Object({
  sessionId: Str, project: Str, taskId: Str, attempt: Count, workflow: Str, tier: Count, planRef: NStr,
  lifecycleState: Literals(["DRAFT", "PREPARED", "RUNNING", "GATING", "REVIEWING", "AWAITING_OWNER", "LANDING", "LANDED", "PUBLISHED", "BLOCKED", "CANCELLED"]),
  stateGroup: StateGroup, reviewVerdict: NStr, ownerReentries: Count, observabilityDegraded: Flag,
  usageAuthority: UsageAuthority, startedAt: Str, endedAt: NStr,
  ownerAttribution: Nullable(Type.Object({ cause: Attribution, reason: Str, at: Str }, { additionalProperties: false })),
  attribution: Nullable(Attribution), attributionSource: Nullable(Literals(["owner", "heuristic"])),
  heuristicAttribution: Nullable(Literals(["model", "factory", "environment", "unknown"])),
  phases: Type.Array(RunPhase),
}, { additionalProperties: false });

export const UntestedRouteSchema = Type.Object({
  adapter: Str, provider: Str, model: Str, effort: Str, label: Type.String({ minLength: 1 }), prior: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

export const MetricsResponseSchema = Type.Object({
  schema: Type.Literal("awsf.route-metrics/v1"),
  extractedAt: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$" }),
  runs: Type.Array(MetricsRunSchema),
  roleRows: Type.Array(RoleRowSchema),
  rateCard: RateCardSchema,
  priors: BenchmarkPriorsSchema,
  untestedRoutes: Type.Array(UntestedRouteSchema),
}, { additionalProperties: false });
