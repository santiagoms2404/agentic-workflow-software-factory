// From the projection to the route-arm scorer (W18 task 13). A replay is a
// proving-ground role-row that carries its replay record, so there is one for
// every attempt of a replay task that ran the arm's phase. A retried replay
// that ran twice is two replays, and the scorer names the second
// `replay-duplicated` rather than choosing between them (T12 C16).
//
// `readReplayOutcomes` is the only function here that queries SQLite, and it
// only reads: it imports the `DatabaseSync` type, never `node:sqlite`
// (invariant 6). What it reads is findings and gate results: counts, never
// thoughts (INV-5).

import type { ProvingGroundItem } from "../contracts/proving-ground.ts";
import type { DatabaseSync } from "../observability/sqlite.ts";
import type { RoleRow } from "./role-rows.ts";
import {
  armKey,
  parseRouteArm,
  type ReviewReplayOutcome,
  type RouteArmProtocol,
  type RouteArmReplay,
} from "./route-arm-score.ts";

/** The code a phase or transition records when a call would pass the attempt's ceiling. */
const CEILING_CODE = "CallCeilingExceeded";

/** One agent role's last envelope round in a replay session. */
export interface ReplayEnvelope {
  readonly valid: boolean;
  /** The findings a valid review carried; `null` for any other envelope. */
  readonly findings: ReviewReplayOutcome["findings"] | null;
}

/** What a replay session left behind beyond its role-row. */
export interface ReplayOutcome {
  /** Keyed by agent role. */
  readonly envelopes: Readonly<Record<string, ReplayEnvelope>>;
  /** Each configured gate's round-0 result, from the aggregated `commands_pass` checks and any gate recorded by its own id. */
  readonly firstRoundGates: Readonly<Record<string, boolean>>;
  readonly pausedAtCeiling: boolean;
}

/** What a replay reads of its role-row. Core's `RoleRow` and the payload's row both satisfy it. */
export type ReplayRow = Pick<RoleRow, "sessionId" | "role" | "itemId" | "arm" | "repetition" | "order" | "usageAuthority"> & {
  readonly route: Pick<RoleRow["route"], "provider" | "model">;
};

function findingsOf(payloadJson: string): ReplayEnvelope["findings"] {
  const findings = (JSON.parse(payloadJson) as { findings?: unknown } | null)?.findings;
  if (!Array.isArray(findings)) return null;
  return findings.flatMap((finding: unknown) => {
    const { file, line } = (finding ?? {}) as { file?: unknown; line?: unknown };
    if (typeof file !== "string" || !(line === null || typeof line === "number")) return [];
    return [{ file, line }];
  });
}

/** Every `prove` session's envelopes, round-0 gates and ceiling pauses. Read-only SQL on the caller's connection. */
export function readReplayOutcomes(db: DatabaseSync): Map<string, ReplayOutcome> {
  const sessions = db.prepare("SELECT session_id FROM sessions WHERE workflow_id = 'prove' ORDER BY session_id")
    .all() as unknown as Array<{ session_id: string }>;
  const outcomes = new Map<string, { envelopes: Record<string, ReplayEnvelope>; firstRoundGates: Record<string, boolean>; pausedAtCeiling: boolean }>();
  for (const { session_id } of sessions) outcomes.set(session_id, { envelopes: {}, firstRoundGates: {}, pausedAtCeiling: false });

  // In round order, so each role keeps its last round.
  const envelopes = db.prepare(`SELECT e.session_id, p.owner, e.valid, e.payload_json
      FROM envelopes e JOIN phases p ON p.phase_id = e.phase_id JOIN sessions s ON s.session_id = e.session_id
      WHERE s.workflow_id = 'prove' AND p.kind = 'agent'
      ORDER BY e.session_id, p.ordinal, e.correction_round`).all() as unknown as Array<{
    session_id: string; owner: string; valid: number; payload_json: string;
  }>;
  for (const row of envelopes) {
    const valid = row.valid === 1;
    outcomes.get(row.session_id)!.envelopes[row.owner] = { valid, findings: valid ? findingsOf(row.payload_json) : null };
  }

  const gates = db.prepare(`SELECT g.session_id, g.gate_id, g.passed, g.checks_json
      FROM gate_results g JOIN sessions s ON s.session_id = g.session_id
      WHERE s.workflow_id = 'prove' AND g.correction_round = 0
      ORDER BY g.session_id, g.phase_id, g.gate_id`).all() as unknown as Array<{
    session_id: string; gate_id: string; passed: number; checks_json: string;
  }>;
  for (const row of gates) {
    const first = outcomes.get(row.session_id)!.firstRoundGates;
    const record = (gateId: string, passed: boolean): void => { first[gateId] = (first[gateId] ?? true) && passed; };
    record(row.gate_id, row.passed === 1);
    // The configured commands are one aggregated gate whose checks are named `<gate id>:<check>`.
    if (row.gate_id !== "commands_pass") continue;
    for (const check of JSON.parse(row.checks_json) as Array<{ item?: unknown; ok?: unknown }>) {
      if (typeof check.item !== "string" || !check.item.includes(":")) continue;
      record(check.item.slice(0, check.item.indexOf(":")), check.ok === true);
    }
  }

  const paused = db.prepare(`SELECT s.session_id FROM sessions s WHERE s.workflow_id = 'prove' AND (
      EXISTS (SELECT 1 FROM events e WHERE e.session_id = s.session_id AND e.type = 'notice' AND e.name = 'ceiling-pause')
      OR EXISTS (SELECT 1 FROM transitions t WHERE t.session_id = s.session_id AND t.reason_code = ?)
      OR EXISTS (SELECT 1 FROM phases p WHERE p.session_id = s.session_id AND p.error_code = ?))`)
    .all(CEILING_CODE, CEILING_CODE) as unknown as Array<{ session_id: string }>;
  for (const { session_id } of paused) outcomes.get(session_id)!.pausedAtCeiling = true;
  return outcomes;
}

function outcomeOf(item: ProvingGroundItem | undefined, envelope: ReplayEnvelope | undefined, outcome: ReplayOutcome | undefined): RouteArmReplay["outcome"] {
  if (item?.kind === "review") return envelope?.valid === true && envelope.findings !== null ? { kind: "review", findings: envelope.findings } : null;
  if (item?.kind === "build") return { kind: "build", firstRoundGates: outcome?.firstRoundGates ?? {} };
  return null;
}

/**
 * The scorer's replays: one per proving-ground row that carries a replay
 * record. The observed model is the selector the route launched (the row's
 * `route.model`), because an arm names a selector and a provider answers with
 * a resolved id no selector equals. A role with no envelope yet was never
 * "still invalid", so it reaches the scorer as valid with no outcome, which
 * the scorer names `outcome-missing`.
 */
export function routeArmReplays(
  rows: readonly ReplayRow[],
  outcomes: ReadonlyMap<string, ReplayOutcome>,
  items: readonly ProvingGroundItem[],
): RouteArmReplay[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return rows.flatMap((row): RouteArmReplay[] => {
    if (row.itemId === null || row.arm === null || row.repetition === null || row.order === null) return [];
    const item = byId.get(row.itemId);
    // A replay session runs one agent role: the one its item measures.
    if (item !== undefined && item.role !== row.role) return [];
    const outcome = outcomes.get(row.sessionId);
    const envelope = outcome?.envelopes[row.role];
    return [{
      itemId: row.itemId,
      arm: row.arm,
      repetition: row.repetition,
      order: row.order,
      observed: { provider: row.route.provider, model: row.route.model },
      usageAuthority: row.usageAuthority,
      envelopeValid: envelope?.valid ?? true,
      pausedAtCeiling: outcome?.pausedAtCeiling ?? false,
      outcome: outcomeOf(item, envelope, outcome),
    }];
  });
}

/**
 * The protocol the replays in scope imply, since none is stored: one arm per
 * route however it is spelled, the highest repetition, and the corpus items
 * the replays name. The scorer then names every replay the protocol expects
 * and none recorded (T11 C12). `null` below two arms, where nothing compares.
 */
export function routeArmProtocol(replays: readonly RouteArmReplay[], items: readonly ProvingGroundItem[]): RouteArmProtocol | null {
  const arms = new Map<string, string>();
  for (const spec of replays.map((replay) => replay.arm).sort()) {
    try {
      const key = armKey(parseRouteArm(spec));
      if (!arms.has(key)) arms.set(key, spec);
    } catch {
      // An unreadable arm keys no route; the scorer reports its replay as stray.
    }
  }
  if (arms.size < 2) return null;
  const named = new Set(replays.map((replay) => replay.itemId));
  return {
    arms: [...arms.values()],
    repetitions: Math.max(...replays.map((replay) => replay.repetition)),
    items: items.filter((item) => named.has(item.id)),
  };
}
