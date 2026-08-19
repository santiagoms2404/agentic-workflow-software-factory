export type LifecycleState =
  | "DRAFT"
  | "PREPARED"
  | "RUNNING"
  | "GATING"
  | "REVIEWING"
  | "AWAITING_OWNER"
  | "LANDING"
  | "LANDED"
  | "BLOCKED"
  | "CANCELLED";

export type PhaseStatus =
  | "QUEUED"
  | "RUNNING"
  | "VALIDATING"
  | "CORRECTING"
  | "SUCCEEDED"
  | "FAILED"
  | "SKIPPED"
  | "CANCELLED";

export type CostAuthority = "provider" | "catalog-estimate" | "unavailable";
export type UsageAuthority = "provider" | "partial" | "none";
export type ModelProvenance = "stream-authoritative" | "route-attributed" | null;
export type SandboxBadge = "os-enforced" | "tool-policy" | "unavailable";
export type SandboxMechanism = "linux-bwrap" | "adapter-tool-policy" | "none";

export interface ApiError {
  error: string;
  code: string;
}

export interface UsageTotals {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  reasoningRelation: "included-in-output" | "additive" | "unknown";
  usageAuthority: UsageAuthority;
  estimatedCostUsd: number | null;
  costAuthority: CostAuthority;
  costPartial: boolean;
}

export interface PhaseSummary {
  phaseId: string;
  ordinal: number;
  key: string;
  name: string;
  kind: "agent" | "code" | "engineer";
  owner: string;
  description: string;
  status: PhaseStatus;
  correctionCount: number;
  maxCorrections: number;
  error: { code: string | null; message: string | null } | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface AgentSummary {
  agent: string;
  adapterId: string;
  provider: string;
  color: string | null;
  requestedModel: string;
  resolvedModel: string | null;
  modelProvenance: ModelProvenance;
  contextTokens: number | null;
  contextWindow: number | null;
  callCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  costAuthority: CostAuthority;
  sandboxBadge: SandboxBadge | null;
  sandboxMechanism: SandboxMechanism | null;
  createdAt: string;
  lastUsedAt: string;
}

export interface ActivityPoint {
  id: string;
  phaseId: string | null;
  source: "phase" | "event";
  type: string;
  status: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface SessionCard {
  sessionId: string;
  project: string;
  taskId: string;
  attempt: number;
  workflowId: string;
  riskTier: 0 | 1 | 2;
  protected: boolean;
  state: LifecycleState;
  request: string;
  callCeiling: number;
  callsReserved: number;
  callsSpent: number;
  observabilityDegraded: boolean;
  archived: boolean;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  usage: UsageTotals;
  phases: PhaseSummary[];
  agents: AgentSummary[];
  /** Bounded chronological timestamps from canonical phase/event evidence. */
  activity: ActivityPoint[];
}

export interface SessionsResponse {
  sessions: SessionCard[];
}

export interface TransitionSummary {
  id: string;
  seq: number;
  from: string;
  to: string;
  actor: "host" | "owner" | "human";
  edgeId: string;
  reason: { source: string; code: string | null; detail: string | null };
  spawnSite: boolean;
  at: string;
}

export interface GateSummary {
  id: string;
  phaseId: string;
  round: number;
  gateId: string;
  kind: string;
  candidateSha: string | null;
  passed: boolean;
  exitCode: number | null;
  checks: unknown;
  violations: unknown;
  startedAt: string;
  endedAt: string;
}

export interface ProcessSummary {
  id: string;
  phaseId: string | null;
  runId: string;
  adapterId: string;
  role: string;
  transport: string;
  status: string;
  registeredAt: string;
  releasedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  exitSignal: string | null;
}

export interface LandingSummary {
  problem: string;
  changes: string;
  verification: string;
  risks: string;
}

export interface SessionDetailResponse extends SessionCard {
  baseSha: string | null;
  headSha: string | null;
  candidateSha: string | null;
  workerProvider: string | null;
  workerModelRequested: string | null;
  workerModelResolved: string | null;
  reviewProvider: string | null;
  reviewVerdict: string | null;
  correctionsAuto: number;
  correctionsOwner: number;
  /** Per attempt, not per phase — the allowance L16/L19/L25 draw on. */
  ownerReentries: number;
  stateRevision: number;
  landingSummary: LandingSummary | null;
  transitions: TransitionSummary[];
  gates: GateSummary[];
  processes: ProcessSummary[];
  allowedNextActions: string[];
}

export interface EnvelopeRound {
  id: string;
  agent: string;
  schemaId: string;
  correctionRound: number;
  valid: boolean;
  producerStatus: "success" | "failure" | null;
  payload: unknown;
  violations: unknown;
  createdAt: string;
}

export interface CompiledPrompt {
  name: string;
  text: string;
  lineCount: number;
}

export interface PhaseDetailResponse {
  sessionId: string;
  requestText: string | null;
  phase: PhaseSummary;
  effectiveConfig: unknown;
  compiledPrompts: CompiledPrompt[];
  envelopes: EnvelopeRound[];
  gates: GateSummary[];
  usage: UsageTotals;
  agents: AgentSummary[];
  processes: ProcessSummary[];
}

export interface EventItem {
  row: number;
  id: string;
  phaseId: string | null;
  runId: string | null;
  parentEventId: string | null;
  firstSourceSeq: number;
  lastSourceSeq: number;
  type: string;
  name: string;
  status: string | null;
  payload: unknown;
  startedAt: string;
  endedAt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  costAuthority: CostAuthority | null;
}

export interface EventsResponse {
  events: EventItem[];
  cursor: number;
  hasMore: boolean;
}

export interface HealthResponse {
  ok: true;
  schemaVersion: number;
  journalMode: string;
  project: string;
  activeSessions: number;
  projectorLag: number;
  degradedSessions: number;
}

export interface SettingsResponse {
  settings: unknown;
}

export interface AdapterHealth {
  id: string;
  kind: string;
  provider: string | null;
  enabled: boolean;
  status: "configured" | "disabled" | "blocked";
  code: string | null;
}

export interface AdaptersResponse {
  adapters: AdapterHealth[];
}

export interface ArchiveResponse {
  archived: true;
}

export interface BacklogTicket {
  id: string;
  title: string;
  milestone: string;
  tier: 0 | 1 | 2;
  state: "todo" | "wip" | "done" | "failed";
  depends_on: string[];
  workflow: string;
  outcome: string;
  context: string[];
  acceptance: string[];
  non_goals: string[];
  ready: boolean;
}

export interface TicketsResponse {
  // Readonly because the backlog projection this mirrors is readonly, and the
  // tickets route is a read route: nothing on either side of the wire may
  // rewrite the board it was handed.
  tickets: readonly BacklogTicket[];
  ready: readonly BacklogTicket[];
  counts: {
    state: Record<BacklogTicket["state"], number>;
    milestone: Record<string, number>;
    tier: Record<"T0" | "T1" | "T2", number>;
  };
  projectedCost: { usd: number | null; authority: CostAuthority; partial: boolean };
}
