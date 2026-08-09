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
  createCorrectionRequest,
  renderCorrectionRequest,
  renderParseFixRequest,
  type AgentTurn,
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
      observed = changedPaths(before, captureChangeSet(options.repository, options.git));
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
  /** Return null to refuse a further correction. Defaults to the automatic tranche. */
  readonly authorizeCorrection?: (input: {
    cause: "schema-violation" | "gate-violation";
    correctionRound: number;
  }) => CorrectionActor | null;
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
}

export class EnvelopeValidationFailure extends Error {
  readonly envelopes: readonly StoredEnvelope<EnvelopeBase>[];

  constructor(phaseId: string, envelopes: readonly StoredEnvelope<EnvelopeBase>[]) {
    super(`phase ${phaseId} did not emit a valid envelope within ${MAX_PARSE_FIX_ATTEMPTS} parse fixes`);
    this.name = "EnvelopeValidationFailure";
    this.envelopes = Object.freeze([...envelopes]);
  }
}

export class PhaseGateFailure extends Error {
  readonly reports: readonly GateReport[];

  constructor(phaseId: string, reports: readonly GateReport[]) {
    const failed = reports.filter((report) => !report.passed).map((report) => report.gateId);
    super(`phase ${phaseId} exhausted gate corrections; failed gates: ${failed.join(", ")}`);
    this.name = "PhaseGateFailure";
    this.reports = Object.freeze([...reports]);
  }
}

function phaseSession(identity: CorrectionSession["identity"]): PhaseSession {
  return { ...identity };
}

async function send(
  options: RunAgentPhaseOptions<EnvelopeBase>,
  prompt: string,
  correctionRound: number,
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
  // outside the catch also prevents a mismatch from looking retryable.
  assertCorrectionIdentity(options.session.identity, turn.identity);
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
    reports.push(await gate.run({ ...context, envelope: payload, correctionRound }));
  }
  return Object.freeze(reports);
}

/**
 * Drives one agent phase. The caller opens and books the initial provider
 * session; every send here is another turn in that same object and therefore
 * cannot reserve a tier call or manufacture a fallback session.
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
    reports: readonly GateReport[],
  ): Promise<AgentTurn> => {
    const nextRound = correctionRound + 1;
    const actor = options.authorizeCorrection === undefined
      ? "host"
      : options.authorizeCorrection({ cause, correctionRound: nextRound });
    if (actor === null) {
      throw cause === "schema-violation"
        ? new EnvelopeValidationFailure(options.phase.id, envelopes)
        : new PhaseGateFailure(options.phase.id, reports);
    }
    options.budget.recordPhaseTransition({
      phase: options.phase.id,
      from: "VALIDATING",
      to: "CORRECTING",
      session: expectedSession,
      cause,
      actor,
    });
    execution.correcting();
    const prompt = cause === "schema-violation"
      ? renderParseFixRequest({
          phase: options.phase.id,
          round: nextRound,
          previousEnvelope: previous,
          remainingCallBudget: options.budget.remaining,
        })
      : renderCorrectionRequest(createCorrectionRequest({
          phase: options.phase.id,
          round: nextRound,
          previousEnvelope: previous,
          gateReports: reports,
          remainingCallBudget: options.budget.remaining,
        }));
    const turn = await send(options as RunAgentPhaseOptions<EnvelopeBase>, prompt, nextRound);
    options.budget.recordPhaseTransition({
      phase: options.phase.id,
      from: "CORRECTING",
      to: "RUNNING",
      session: expectedSession,
      resumeSession: phaseSession(turn.identity),
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
    while (accepted === null) {
      const envelope = await store(options, turn, correctionRound);
      envelopes.push(envelope);
      if (!envelope.valid || envelope.payload === null) {
        if (parseFixes >= MAX_PARSE_FIX_ATTEMPTS) {
          throw new EnvelopeValidationFailure(options.phase.id, envelopes);
        }
        parseFixes += 1;
        turn = await correct("schema-violation", envelope, []);
        continue;
      }

      lastReports = await runGates(options, envelope.payload, correctionRound);
      if (lastReports.every((report) => report.passed)) {
        accepted = envelope;
        break;
      }
      if (gateRound >= options.phase.maxCorrections) {
        throw new PhaseGateFailure(options.phase.id, lastReports);
      }
      gateRound += 1;
      parseFixes = 0;
      turn = await correct("gate-violation", envelope, lastReports);
    }

    // Ordering is safety-significant: gate mistakes are correctable; permission
    // breaches are observed only after the loop and abort without another send.
    const permission = options.permissions.enforce();
    const changedPaths = Object.freeze([...options.hostGit.captureDiff()]);
    const candidateSha = options.hostGit.commit(accepted.payload!, changedPaths);
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
      gateReports: lastReports,
      permission,
      changedPaths,
      candidateSha,
      usage: phaseUsage,
    });
  } catch (error) {
    execution.fail();
    throw error;
  }
}
