import type { EnvelopeBase } from "../contracts/envelope-base.ts";
import { parseEnvelope, type ParseEnvelopeResult } from "../contracts/parse-envelope.ts";
import { wrapEnvelope, type StoredEnvelope } from "../contracts/stored-envelope.ts";
import type { CallBudget } from "../execution/call-budget.ts";
import type { GateReport } from "../gates/interface.ts";
import { captureChangeSet, changedPaths, type GitRunner } from "../git/changes.ts";
import { commitAsHost } from "../git/commit.ts";
import type { PermissionResult } from "../policy/sandbox-broker.ts";
import type { PhaseSession, PhaseState } from "../state/phase-machine.ts";
import {
  CorrectionTransportFailure,
  MAX_PARSE_FIX_ATTEMPTS,
  UsageAccumulator,
  assertCorrectionIdentity,
  assertCorrectionRouteIdentity,
  createCorrectionRequest,
  renderColdCorrectionRequest,
  renderCorrectionRequest,
  type AgentTurn,
  type CorrectionCandidateEvidence,
  type CorrectionSession,
  type PhaseUsage,
} from "./corrections.ts";
import type { CompiledAgentPhase, PhaseContext } from "./phase.ts";
import { PhaseExecution } from "./phase.ts";

export interface EnvelopePersistence {
  persist(envelope: StoredEnvelope<EnvelopeBase>, rawOutput: string): Promise<void> | void;
  persistAgentSession?(record: AgentSessionRecord): Promise<void> | void;
}

export interface AgentSessionRecord {
  readonly phaseId: string;
  readonly identity: PhaseSession;
  readonly usage: PhaseUsage;
  readonly candidateSha: string | null;
}

export interface PhasePermissions {
  enforce(): PermissionResult;
}

export interface HostPhaseGit<T extends EnvelopeBase = EnvelopeBase> {
  /** Host observation after permission enforcement, never an agent-provided list. */
  captureDiff(): readonly string[];
  /** Returns null for a read-only/no-change phase. */
  commit(envelope: T, changedPaths: readonly string[]): string | null;
}

/** Production host boundary backed by the reviewed Git primitives from T16. */
export function createHostPhaseGit<T extends EnvelopeBase>(options: {
  repository: string;
  commitMessage: (envelope: T) => string;
  git?: GitRunner;
}): HostPhaseGit<T> {
  const before = captureChangeSet(options.repository, options.git);
  let observed: readonly string[] | null = null;
  return {
    captureDiff(): readonly string[] {
      observed = Object.freeze(changedPaths(before, captureChangeSet(options.repository, options.git)));
      return observed;
    },
    commit(envelope: T, paths: readonly string[]): string | null {
      if (observed === null) throw new Error("host diff must be captured before commit");
      if (paths !== observed) throw new Error("commit must consume the host-captured diff object");
      return paths.length === 0
        ? null
        : commitAsHost({ repository: options.repository, message: options.commitMessage(envelope) }, options.git);
    },
  };
}

export type CorrectionActor = "host" | "owner" | "human";
export type CorrectionTransport = "same-session" | "cold";

export interface CorrectionAuthorization {
  readonly actor: CorrectionActor;
  readonly transport: CorrectionTransport;
}

export interface CorrectionRefusal {
  readonly actor: null;
  readonly reason: string;
}

export type CorrectionDecision = CorrectionActor | CorrectionAuthorization | CorrectionRefusal | null;

/**
 * What the host measured about the candidate this phase just produced.
 *
 * This is the stage the pilot did not have. Deterministic commands can only run
 * against a commit, and a commit can only exist after the phase's own gates
 * pass — so their verdict arrives strictly later than every other gate, at a
 * moment when the phase had already been declared finished and its conversation
 * closed. Folding it back into the phase makes a red suite what it actually is:
 * a correctable gate violation, priced in tokens, bounded by the same
 * allowance, instead of a phase abort that costs the whole builder again.
 */
export interface CandidateVerification {
  readonly passed: boolean;
  /** Recorded whether it passed or failed; a green run is evidence too. */
  readonly reports: readonly GateReport[];
  /** What the resumed session is told. Required when `passed` is false. */
  readonly evidence: CorrectionCandidateEvidence | null;
}

export interface RunAgentPhaseOptions<T extends EnvelopeBase> {
  readonly workflowId: string;
  readonly phase: CompiledAgentPhase<T>;
  readonly worktree: string;
  readonly previousEnvelope: EnvelopeBase | null;
  readonly session: CorrectionSession;
  readonly budget: CallBudget;
  readonly permissions: PhasePermissions;
  readonly hostGit: HostPhaseGit<T>;
  readonly persistence: EnvelopePersistence;
  readonly agentSessionId: string;
  readonly now?: () => string;
  readonly rawOutputPath?: (correctionRound: number) => string;
  /** Durable/event observer; receives QUEUED first and FAILED on every abnormal exit. */
  readonly onPhaseState?: (state: PhaseState) => void;
  /** Receives each report at the round that produced it, including superseded failures. */
  readonly onGateReport?: (report: GateReport, correctionRound: number) => Promise<void> | void;
  /** Called after the phase budget authorizes a correction and before its transport launches. */
  readonly onCorrectionAuthorized?: (input: {
    readonly correctionRound: number;
    readonly transport: CorrectionTransport;
  }) => Promise<void> | void;
  /** Return a refusal with a reason when no further correction can run. */
  readonly authorizeCorrection?: (input: {
    cause: "schema-violation" | "gate-violation";
    correctionRound: number;
    reports: readonly GateReport[];
  }) => CorrectionDecision;
  /**
   * Runs the host's deterministic gates against the exact candidate this phase
   * just committed. Absent means the phase ends at its commit, which is the
   * behaviour every caller had before candidate verification existed.
   *
   * It is called AFTER the commit and may re-arm `permissions` and `hostGit` for
   * the next round — the tree it must gate is a committed one, and the next
   * correction's diff is measured from that commit rather than from the seeded
   * worktree.
   */
  readonly verifyCandidate?: (input: {
    readonly candidateSha: string;
    readonly changedPaths: readonly string[];
    readonly correctionRound: number;
  }) => Promise<CandidateVerification>;
}

export interface AgentPhaseResult<T extends EnvelopeBase> {
  readonly state: "SUCCEEDED";
  readonly envelope: StoredEnvelope<T>;
  readonly envelopes: readonly StoredEnvelope<T>[];
  readonly gateReports: readonly GateReport[];
  readonly permission: PermissionResult;
  readonly changedPaths: readonly string[];
  readonly candidateSha: string | null;
  readonly usage: PhaseUsage;
  /**
   * The verification that passed, when one ran. The caller records it rather
   * than re-running the commands: a `tests` phase that re-executed a suite the
   * builder phase already measured against the same SHA would spend the wall
   * clock twice to learn the same thing, and could disagree with itself.
   */
  readonly verification: CandidateVerification | null;
  /** How many correction rounds this phase actually used. Zero is the common case. */
  readonly correctionRounds: number;
}

interface PhaseFailureContext {
  readonly correctionRound?: number;
  readonly maxCorrections?: number;
  readonly terminalReason?: string;
}

function failureContext(context: PhaseFailureContext): string {
  const round = context.correctionRound ?? 0;
  const maximum = context.maxCorrections;
  const rounds = maximum === undefined
    ? `at correction round ${String(round)}`
    : `after ${String(round)} of ${String(maximum)} configured correction round(s)`;
  return `${rounds}${context.terminalReason === undefined ? "" : `; ${context.terminalReason}`}`;
}

function failedCheckSummary(reports: readonly GateReport[]): string {
  const details = reports.flatMap((report) => {
    const failed = report.checks.filter((check) => !check.ok);
    return failed.length === 0
      ? (report.passed ? [] : [`${report.gateId}: gate reported failure without a failed sub-check`])
      : failed.map((check) => `${report.gateId}/${check.item}: ${check.note}`);
  });
  const rendered = details.join("; ") || "none recorded";
  return rendered.length <= 4_000 ? rendered : `${rendered.slice(0, 4_000)}…`;
}

export class EnvelopeValidationFailure extends Error {
  readonly envelopes: readonly StoredEnvelope<EnvelopeBase>[];
  readonly correctionRound: number;
  readonly terminalReason: string | null;

  constructor(
    phaseId: string,
    envelopes: readonly StoredEnvelope<EnvelopeBase>[],
    context: PhaseFailureContext = {},
  ) {
    super(
      `phase ${phaseId} emitted no valid envelope ${failureContext(context)}; ` +
        `schema violations: ${envelopes.at(-1)?.violations.map((violation) => `${violation.path || "(root)"}: ${violation.message}`).join("; ") || "none recorded"}`,
    );
    this.name = "EnvelopeValidationFailure";
    this.envelopes = Object.freeze([...envelopes]);
    this.correctionRound = context.correctionRound ?? 0;
    this.terminalReason = context.terminalReason ?? null;
  }
}

export class PhaseGateFailure extends Error {
  readonly reports: readonly GateReport[];
  readonly correctionRound: number;
  readonly terminalReason: string | null;

  constructor(phaseId: string, reports: readonly GateReport[], context: PhaseFailureContext = {}) {
    super(
      `phase ${phaseId} reached a terminal gate failure ${failureContext(context)}; ` +
        `failed checks: ${failedCheckSummary(reports)}`,
    );
    this.name = "PhaseGateFailure";
    this.reports = Object.freeze([...reports]);
    this.correctionRound = context.correctionRound ?? 0;
    this.terminalReason = context.terminalReason ?? null;
  }
}

function phaseSession(identity: CorrectionSession["identity"]): PhaseSession {
  return { ...identity };
}

async function send(
  options: RunAgentPhaseOptions<EnvelopeBase>,
  prompt: string,
  correctionRound: number,
  transport: CorrectionTransport = "same-session",
): Promise<AgentTurn> {
  let turn: AgentTurn;
  try {
    turn = await options.session.send(prompt);
  } catch (error) {
    if (correctionRound > 0) {
      throw error instanceof CorrectionTransportFailure
        ? error
        : new CorrectionTransportFailure(options.phase.id, correctionRound, error);
    }
    throw error;
  }
  // Identity failure is a protocol breach, not a transport failure. Keeping it
  // outside the catch also prevents a mismatch from looking retryable. A paid
  // cold correction may mint a session, but its adapter/provider/model route is
  // still fixed by preflight and must remain exact.
  if (transport === "cold") assertCorrectionRouteIdentity(options.session.identity, turn.identity);
  else assertCorrectionIdentity(options.session.identity, turn.identity);
  return turn;
}

async function store<T extends EnvelopeBase>(
  options: RunAgentPhaseOptions<T>,
  turn: AgentTurn,
  correctionRound: number,
): Promise<StoredEnvelope<T>> {
  const parsed = parseEnvelope(turn.rawOutput, options.phase.schemaId) as ParseEnvelopeResult<T>;
  const envelope = wrapEnvelope<T>({
    envelopeId: `${options.agentSessionId}:${options.phase.id}:${correctionRound}`,
    sessionId: options.agentSessionId,
    phaseId: options.phase.id,
    correctionRound,
    agent: options.phase.owner,
    schemaId: options.phase.schemaId,
    createdAt: (options.now ?? ((): string => new Date().toISOString()))(),
    rawOutputPath: (options.rawOutputPath ?? ((round): string => `raw/${options.phase.id}/${round}.txt`))(correctionRound),
  }, parsed);
  await options.persistence.persist(envelope as StoredEnvelope<EnvelopeBase>, turn.rawOutput);
  return envelope;
}

async function runGates<T extends EnvelopeBase>(
  options: RunAgentPhaseOptions<T>,
  payload: T,
  correctionRound: number,
): Promise<readonly GateReport[]> {
  const context: PhaseContext = {
    workflowId: options.workflowId,
    phaseId: options.phase.id,
    worktree: options.worktree,
    previousEnvelope: options.previousEnvelope,
  };
  const reports: GateReport[] = [];
  for (const gate of options.phase.gates) {
    const report = await gate.run({ ...context, envelope: payload, correctionRound });
    reports.push(report);
    await options.onGateReport?.(report, correctionRound);
  }
  return Object.freeze(reports);
}

/**
 * Drives one agent phase. Same-session corrections remain call-neutral. A
 * caller may explicitly authorize a cold correction, but its session transport
 * must reserve a new call against the task ceiling before that send reaches GO.
 */
export async function runAgentPhase<T extends EnvelopeBase>(
  options: RunAgentPhaseOptions<T>,
): Promise<AgentPhaseResult<T>> {
  const execution = new PhaseExecution(options.phase.id, options.onPhaseState);
  const usage = new UsageAccumulator();
  const envelopes: StoredEnvelope<T>[] = [];
  const expectedSession = phaseSession(options.session.identity);
  let correctionRound = 0;
  let parseFixes = 0;
  let gateRound = 0;
  let lastReports: readonly GateReport[] = [];
  options.budget.beginPhase();

  const correct = async (
    cause: "schema-violation" | "gate-violation",
    previous: StoredEnvelope<T>,
    previousRawOutput: string,
    reports: readonly GateReport[],
    candidate?: CorrectionCandidateEvidence,
  ): Promise<AgentTurn> => {
    const nextRound = correctionRound + 1;
    const decision: CorrectionDecision = options.authorizeCorrection === undefined
      ? "host"
      : options.authorizeCorrection({ cause, correctionRound: nextRound, reports });
    if (decision === null || (typeof decision === "object" && decision.actor === null)) {
      const reason = decision === null
        ? "the caller exposed no correction transport"
        : decision.reason;
      const context = {
        correctionRound,
        maxCorrections: options.phase.maxCorrections,
        terminalReason: `correction unavailable: ${reason}`,
      };
      throw cause === "schema-violation"
        ? new EnvelopeValidationFailure(options.phase.id, envelopes, context)
        : new PhaseGateFailure(options.phase.id, reports, context);
    }
    const authorization: CorrectionAuthorization = typeof decision === "string"
      ? { actor: decision, transport: "same-session" }
      : decision;
    options.budget.recordPhaseTransition({
      phase: options.phase.id,
      from: "VALIDATING",
      to: "CORRECTING",
      session: expectedSession,
      cause,
      actor: authorization.actor,
      correctionTransport: authorization.transport,
    });
    await options.onCorrectionAuthorized?.({ correctionRound: nextRound, transport: authorization.transport });
    execution.correcting();
    const request = createCorrectionRequest({
      phase: options.phase.id,
      round: nextRound,
      previousEnvelope: previous,
      gateReports: reports,
      remainingCallBudget: options.budget.remaining,
      ...(candidate === undefined ? {} : { candidate }),
    });
    const correctionPrompt = renderCorrectionRequest(request);
    const prompt = authorization.transport === "cold"
      ? renderColdCorrectionRequest(
          options.phase.renderPrompt(options.previousEnvelope),
          previous.payload ?? previousRawOutput,
          request,
        )
      : correctionPrompt;
    const turn = await send(
      options as RunAgentPhaseOptions<EnvelopeBase>,
      prompt,
      nextRound,
      authorization.transport,
    );
    options.budget.recordPhaseTransition({
      phase: options.phase.id,
      from: "CORRECTING",
      to: "RUNNING",
      session: expectedSession,
      resumeSession: phaseSession(turn.identity),
      correctionTransport: authorization.transport,
    });
    execution.running();
    correctionRound = nextRound;
    usage.add(turn);
    execution.validating();
    return turn;
  };

  try {
    execution.running();
    let turn = await send(options as RunAgentPhaseOptions<EnvelopeBase>, options.phase.renderPrompt(options.previousEnvelope), 0);
    usage.add(turn);
    execution.validating();

    let accepted: StoredEnvelope<T> | null = null;
    let permission: PermissionResult | null = null;
    let changedPaths: readonly string[] = [];
    let candidateSha: string | null = null;
    let verification: CandidateVerification | null = null;
    while (accepted === null) {
      const envelope = await store(options, turn, correctionRound);
      envelopes.push(envelope);
      if (!envelope.valid || envelope.payload === null) {
        if (parseFixes >= MAX_PARSE_FIX_ATTEMPTS) {
          throw new EnvelopeValidationFailure(options.phase.id, envelopes, {
            correctionRound,
            maxCorrections: options.phase.maxCorrections,
            terminalReason: `parse-fix limit ${String(MAX_PARSE_FIX_ATTEMPTS)} reached`,
          });
        }
        parseFixes += 1;
        turn = await correct("schema-violation", envelope, turn.rawOutput, []);
        continue;
      }

      lastReports = await runGates(options, envelope.payload, correctionRound);
      if (!lastReports.every((report) => report.passed)) {
        if (gateRound >= options.phase.maxCorrections) {
          throw new PhaseGateFailure(options.phase.id, lastReports, {
            correctionRound,
            maxCorrections: options.phase.maxCorrections,
            terminalReason: `configured correction limit ${String(options.phase.maxCorrections)} reached`,
          });
        }
        gateRound += 1;
        parseFixes = 0;
        turn = await correct("gate-violation", envelope, turn.rawOutput, lastReports);
        continue;
      }

      // Ordering is safety-significant: gate mistakes are correctable;
      // permission breaches are observed only here and abort without another
      // send. Both run on EVERY round, never only the first — a correction that
      // fixed a failing test by writing outside its globs is a breach, and a
      // round that skipped this check would launder it.
      permission = options.permissions.enforce();
      changedPaths = options.hostGit.captureDiff();
      candidateSha = options.hostGit.commit(envelope.payload!, changedPaths);

      // No verifier, or nothing to verify because the phase changed no files.
      if (options.verifyCandidate === undefined || candidateSha === null) {
        accepted = envelope;
        break;
      }
      verification = await options.verifyCandidate({ candidateSha, changedPaths, correctionRound });
      if (verification.passed) {
        accepted = envelope;
        break;
      }
      // The candidate exists and is red. It stays — a failed candidate is
      // evidence, and the next round builds on it rather than replacing it.
      if (gateRound >= options.phase.maxCorrections) {
        throw new PhaseGateFailure(options.phase.id, [...lastReports, ...verification.reports], {
          correctionRound,
          maxCorrections: options.phase.maxCorrections,
          terminalReason: `configured correction limit ${String(options.phase.maxCorrections)} reached`,
        });
      }
      gateRound += 1;
      parseFixes = 0;
      turn = await correct(
        "gate-violation",
        envelope,
        turn.rawOutput,
        verification.reports,
        verification.evidence ?? undefined,
      );
    }

    // Non-null by construction: the loop only leaves through a break that runs
    // strictly after both.
    execution.succeed();
    const phaseUsage = usage.snapshot();
    await options.persistence.persistAgentSession?.({
      phaseId: options.phase.id,
      identity: expectedSession,
      usage: phaseUsage,
      candidateSha,
    });
    return Object.freeze({
      state: "SUCCEEDED",
      envelope: accepted,
      envelopes: Object.freeze([...envelopes]),
      // The phase's OWN gates only. The verification's reports are already
      // recorded against the exact SHA they measured, at the round they ran in,
      // and re-emitting them here would write a second row under the same id.
      gateReports: lastReports,
      permission: permission!,
      changedPaths,
      candidateSha,
      usage: phaseUsage,
      verification,
      correctionRounds: correctionRound,
    });
  } catch (error) {
    execution.fail();
    throw error;
  }
}
