import { CallCeilingExceeded } from "../../state/errors.ts";
import { ceilingFor, MAX_CALL_CEILING, type ResolvedCeiling, type Tier } from "../../state/tiers.ts";
import { MAX_GRANT_CALLS } from "./raise.ts";

// `awsf shift plan <stem> --milestone <Mx>[,<My>,...]` — the pre-flight
// readout M3 exists for. It reads the tickets and the tier's ceiling and
// prints what an owner needs before leaving the room; it spawns nothing,
// reserves nothing and writes nothing (INV-5). The ceiling arithmetic is
// `core/src/state/tiers.ts`'s `ceilingFor`, applied to the recipe's own
// `minimumCalls`; this file invents no second notion of a ceiling and reaches
// into `raise.ts` only for the one constant a recommendation needs — never
// the command, which stays the owner's and requires the terminal it has.

/** `--milestone M4,M5` and `--milestone M4 --milestone M5` spell one ordered list. */
export function parseMilestoneSelection(values: readonly string[]): readonly string[] {
  const milestones: string[] = [];
  for (const value of values) {
    for (const part of value.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) milestones.push(trimmed);
    }
  }
  return Object.freeze(milestones);
}

export interface RaisePlan {
  /** How many `awsf raise` acts, each granting up to `MAX_GRANT_CALLS`. */
  readonly acts: number;
  /** The ceiling reached after all of them land. */
  readonly finalCeiling: number;
}

/**
 * The fewest full-grant `awsf raise` acts that carry `ceiling` up to at least
 * `target`, or `null` when `target` itself is past `MAX_CALL_CEILING` — the
 * one shortfall no sequence of acts can close, because the bound is the bound.
 */
export function raiseActsNeeded(ceiling: number, target: number): RaisePlan | null {
  if (target > MAX_CALL_CEILING) return null;
  if (target <= ceiling) return Object.freeze({ acts: 0, finalCeiling: ceiling });
  let acts = 0;
  let current = ceiling;
  while (current < target) {
    current = Math.min(current + MAX_GRANT_CALLS, MAX_CALL_CEILING);
    acts += 1;
  }
  return Object.freeze({ acts, finalCeiling: current });
}

export interface ShiftAdmission {
  readonly minimumCalls: number;
  readonly tier: Tier;
  /** The tier's ceiling right now — before any raise this readout recommends. */
  readonly ceiling: number;
  /** Whether `minimumCalls` is admitted against `ceiling` at zero cost, today. */
  readonly fits: boolean;
  /** `max(0, ceiling - minimumCalls)`, meaningful only when `fits`. */
  readonly headroom: number;
  /**
   * `true` exactly when the ceiling this shift would run at — its own when it
   * fits, or the ceiling reached after every recommended raise act otherwise —
   * leaves zero calls beyond `minimumCalls`. At that ceiling
   * `coldCorrectionHeadroom()` is zero at every phase (production-run.ts
   * :1607-1614), so every builder's declared `maxCorrections: 1` buys nothing.
   */
  readonly coldCorrectionExhausted: boolean;
  /** The raise plan to reach admission, or `null` when it already fits or nothing can fund it. */
  readonly raise: RaisePlan | null;
  /** `true` when `minimumCalls` exceeds `MAX_CALL_CEILING` and no raise act, however many, can fund it. */
  readonly unfundable: boolean;
}

/** Pure arithmetic: `minimumCalls` against one tier's ceiling, before any process exists. */
export function assessShiftAdmission(minimumCalls: number, tier: Tier, resolved?: ResolvedCeiling): ShiftAdmission {
  const ceiling = ceilingFor(tier, resolved);
  const fits = minimumCalls <= ceiling;
  const raise = fits ? null : raiseActsNeeded(ceiling, minimumCalls);
  const unfundable = !fits && raise === null;
  const effectiveCeiling = fits ? ceiling : raise?.finalCeiling ?? ceiling;
  return Object.freeze({
    minimumCalls,
    tier,
    ceiling,
    fits,
    headroom: fits ? ceiling - minimumCalls : 0,
    coldCorrectionExhausted: !unfundable && effectiveCeiling - minimumCalls === 0,
    raise,
    unfundable,
  });
}

/**
 * The refusal, reusing `CallCeilingExceeded` rather than minting a new class
 * (so the dashboard's failure classifier meets a name it already knows), with
 * a `subject` that names which of the two refusals this is: a selection a
 * sequence of `awsf raise` acts can still fund, or one `MAX_CALL_CEILING`
 * makes impossible regardless of how many acts the owner is willing to take.
 */
export function assertShiftAdmission(admission: ShiftAdmission, subject: string): void {
  if (admission.fits) return;
  const detail = admission.unfundable
    ? `minimumCalls ${admission.minimumCalls} exceeds MAX_CALL_CEILING (${MAX_CALL_CEILING}); no awsf raise act, however many, can fund this shift — split the selection into smaller milestones`
    : `needs ${admission.raise!.acts} awsf raise act(s) of up to ${MAX_GRANT_CALLS} call(s) each, ${admission.ceiling} -> ${admission.raise!.finalCeiling}, before this shift can be admitted`;
  throw new CallCeilingExceeded({
    from: null,
    to: null,
    subject: `${subject}: ${detail}`,
    tier: admission.tier,
    ceiling: admission.ceiling,
    requested: admission.minimumCalls,
    committed: 0,
  });
}

export interface ShiftTicketSummary {
  readonly id: string;
  readonly title: string;
}

/**
 * The readout itself: ordered ticket ids and titles, `minimumCalls = N + 1`,
 * the tier's ceiling, the remaining headroom, and — when it does not fit —
 * the raise acts needed or the plain statement that none can help. Composed
 * whether or not the selection is admitted, so a caller prints this in full
 * BEFORE calling `assertShiftAdmission`, which is the only thing that throws.
 */
export function shiftPlanReadout(options: {
  readonly plan: string;
  readonly milestones: readonly string[];
  readonly tickets: readonly ShiftTicketSummary[];
  readonly admission: ShiftAdmission;
}): readonly string[] {
  const { plan, milestones, tickets, admission } = options;
  const lines: string[] = [
    `shift plan ${plan} --milestone ${milestones.join(",")}`,
    ...tickets.map((ticket) => `  ${ticket.id}  ${ticket.title}`),
    `minimumCalls = ${String(tickets.length)} + 1 = ${String(admission.minimumCalls)}`,
    `ceiling: T${String(admission.tier)} = ${String(admission.ceiling)}`,
    admission.fits
      ? `remaining headroom: ${String(admission.headroom)} call(s)`
      : `does not fit: ${String(admission.minimumCalls - admission.ceiling)} call(s) short of the ceiling`,
  ];
  if (admission.coldCorrectionExhausted) {
    lines.push(
      "cold-correction consequence: at ceiling === minimumCalls, coldCorrectionHeadroom() is zero at every " +
        "phase, so each builder's declared maxCorrections: 1 buys nothing — this shift has no correction round anywhere in it",
    );
  }
  if (!admission.fits) {
    lines.push(
      admission.unfundable
        ? `no awsf raise can fund this shift: minimumCalls ${String(admission.minimumCalls)} exceeds ` +
          `MAX_CALL_CEILING (${String(MAX_CALL_CEILING)}) — split the selection into smaller milestones`
        : `awsf raise: ${String(admission.raise!.acts)} act(s) needed, up to ${String(MAX_GRANT_CALLS)} call(s) ` +
          `each, ${String(admission.ceiling)} -> ${String(admission.raise!.finalCeiling)}`,
    );
  }
  return Object.freeze(lines);
}
