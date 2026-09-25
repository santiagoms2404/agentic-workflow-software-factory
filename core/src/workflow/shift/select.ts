import type { PlanTicketRecord } from "../../persistence/plan-tickets.ts";
import type { Tier } from "../../state/tiers.ts";

// The shift expander: a plan stem and an ordered list of milestones become one
// ordered ticket list. Every way that expansion can be ambiguous is refused by
// its own class, because a selection that silently drops a ticket spends a
// night on the wrong work. Ticket ids are compared literally and never parsed
// for a naming convention; dependencies stay plan-scoped, as in backlog.ts.

/** Every refusal below extends this, so a caller can catch the vocabulary whole. */
export abstract class ShiftSelectionRefusal extends Error {
  readonly plan: string;

  constructor(plan: string, message: string) {
    super(`${plan}: ${message}`);
    this.plan = plan;
  }
}

/** The same milestone named twice. Refused rather than de-duplicated: the list is the owner's order. */
export class ShiftRepeatedMilestone extends ShiftSelectionRefusal {
  readonly milestone: string;

  constructor(plan: string, milestone: string) {
    super(plan, `milestone ${milestone} is selected more than once`);
    this.name = "ShiftRepeatedMilestone";
    this.milestone = milestone;
  }
}

/** A named milestone with no ticket of any state: a typo or a milestone that does not exist. */
export class ShiftMilestoneWithoutTickets extends ShiftSelectionRefusal {
  readonly milestone: string;

  constructor(plan: string, milestone: string) {
    super(plan, `milestone ${milestone} holds no tickets`);
    this.name = "ShiftMilestoneWithoutTickets";
    this.milestone = milestone;
  }
}

/** A selected milestone already has work in flight or failed. Resuming it is the owner's decision. */
export class ShiftMilestoneInProgress extends ShiftSelectionRefusal {
  readonly milestone: string;
  readonly tickets: readonly { readonly id: string; readonly state: "wip" | "failed" }[];

  constructor(plan: string, milestone: string, tickets: readonly { id: string; state: "wip" | "failed" }[]) {
    super(
      plan,
      `milestone ${milestone} is half done: ${tickets.map((ticket) => `${ticket.id} is ${ticket.state}`).join(", ")}`,
    );
    this.name = "ShiftMilestoneInProgress";
    this.milestone = milestone;
    this.tickets = Object.freeze(tickets.map((ticket) => Object.freeze({ ...ticket })));
  }
}

/** Two tickets in one plan share an id, so `depends_on` cannot say which one it means. */
export class ShiftDuplicateTicketId extends ShiftSelectionRefusal {
  readonly ticket: string;

  constructor(plan: string, ticket: string) {
    super(plan, `ticket id ${ticket} is declared by more than one ticket file`);
    this.name = "ShiftDuplicateTicketId";
    this.ticket = ticket;
  }
}

/** A dependency outside the selection that is not done, or does not exist. */
export class ShiftDependencyOutsideSelection extends ShiftSelectionRefusal {
  readonly ticket: string;
  readonly dependency: string;
  /** The dependency's state, or `missing` when the plan has no ticket with that id. */
  readonly dependencyState: "todo" | "wip" | "failed" | "missing";

  constructor(plan: string, ticket: string, dependency: string, dependencyState: ShiftDependencyOutsideSelection["dependencyState"]) {
    super(
      plan,
      `${ticket} depends on ${dependency}, which is outside the selection and ` +
        (dependencyState === "missing" ? "does not exist" : `is ${dependencyState}, not done`),
    );
    this.name = "ShiftDependencyOutsideSelection";
    this.ticket = ticket;
    this.dependency = dependency;
    this.dependencyState = dependencyState;
  }
}

/** The selected tickets' `depends_on` edges form a cycle; `cycle` names it, first id repeated last. */
export class ShiftDependencyCycle extends ShiftSelectionRefusal {
  readonly cycle: readonly string[];

  constructor(plan: string, cycle: readonly string[]) {
    super(plan, `depends_on cycle: ${cycle.join(" -> ")}`);
    this.name = "ShiftDependencyCycle";
    this.cycle = Object.freeze([...cycle]);
  }
}

/** The selection names milestones but no `todo` ticket, or names no milestone at all. */
export class ShiftEmptyExpansion extends ShiftSelectionRefusal {
  readonly milestones: readonly string[];

  constructor(plan: string, milestones: readonly string[]) {
    super(
      plan,
      milestones.length === 0
        ? "no milestone is selected"
        : `milestones ${milestones.join(",")} hold no todo ticket`,
    );
    this.name = "ShiftEmptyExpansion";
    this.milestones = Object.freeze([...milestones]);
  }
}

export interface ShiftSelection {
  readonly plan: string;
  /** The owner's selection order, which is also the first tie-break. */
  readonly milestones: readonly string[];
  /** Every selected `todo` ticket, in one topological order over `depends_on`. */
  readonly tickets: readonly PlanTicketRecord[];
  /**
   * The maximum declared tier across every selected ticket. NULL when no
   * selected ticket declares one: absent is recorded as absent, never guessed.
   */
  readonly tier: Tier | null;
}

function literal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Plan + ordered milestones → one ordered ticket list, or a named refusal. */
export function selectShiftTickets(
  plan: string,
  milestones: readonly string[],
  records: readonly PlanTicketRecord[],
): ShiftSelection {
  if (milestones.length === 0) throw new ShiftEmptyExpansion(plan, milestones);
  const position = new Map<string, number>();
  for (const milestone of milestones) {
    if (position.has(milestone)) throw new ShiftRepeatedMilestone(plan, milestone);
    position.set(milestone, position.size);
  }

  const byId = new Map<string, PlanTicketRecord>();
  for (const record of records) {
    if (record.plan !== plan) continue;
    if (byId.has(record.ticket.id)) throw new ShiftDuplicateTicketId(plan, record.ticket.id);
    byId.set(record.ticket.id, record);
  }
  const planRecords = [...byId.values()];

  const selected: PlanTicketRecord[] = [];
  for (const milestone of milestones) {
    const members = planRecords.filter((record) => record.ticket.milestone === milestone);
    if (members.length === 0) throw new ShiftMilestoneWithoutTickets(plan, milestone);
    const unfinished = members
      .flatMap((record) => record.ticket.state === "wip" || record.ticket.state === "failed"
        ? [{ id: record.ticket.id, state: record.ticket.state }]
        : [])
      .sort((left, right) => literal(left.id, right.id));
    if (unfinished.length > 0) throw new ShiftMilestoneInProgress(plan, milestone, unfinished);
    selected.push(...members.filter((record) => record.ticket.state === "todo"));
  }
  if (selected.length === 0) throw new ShiftEmptyExpansion(plan, milestones);

  const key = (record: PlanTicketRecord): readonly [number, string] =>
    [position.get(record.ticket.milestone)!, record.ticket.id];
  selected.sort((left, right) => {
    const [leftPosition, leftId] = key(left);
    const [rightPosition, rightId] = key(right);
    return leftPosition - rightPosition || literal(leftId, rightId);
  });

  // Internal edges only; an edge leaving the selection is admitted when done.
  const inSelection = new Set(selected.map((record) => record.ticket.id));
  const internal = new Map<string, readonly string[]>();
  for (const record of selected) {
    const edges: string[] = [];
    for (const dependency of record.ticket.depends_on) {
      if (inSelection.has(dependency)) {
        edges.push(dependency);
        continue;
      }
      const target = byId.get(dependency);
      if (target === undefined) {
        throw new ShiftDependencyOutsideSelection(plan, record.ticket.id, dependency, "missing");
      }
      if (target.ticket.state !== "done") {
        throw new ShiftDependencyOutsideSelection(plan, record.ticket.id, dependency, target.ticket.state);
      }
    }
    internal.set(record.ticket.id, edges);
  }

  // Kahn's algorithm, always emitting the lowest (milestone position, id) ready
  // ticket. `selected` is already in that order, so the first ready one wins.
  const ordered: PlanTicketRecord[] = [];
  const emitted = new Set<string>();
  const pending = [...selected];
  while (pending.length > 0) {
    const index = pending.findIndex((record) => internal.get(record.ticket.id)!.every((id) => emitted.has(id)));
    if (index === -1) throw new ShiftDependencyCycle(plan, cycleAmong(pending, internal));
    const [next] = pending.splice(index, 1);
    ordered.push(next!);
    emitted.add(next!.ticket.id);
  }

  let tier: Tier | null = null;
  for (const record of ordered) {
    const declared = record.ticket.tier;
    if (declared !== undefined && (tier === null || declared > tier)) tier = declared;
  }

  return Object.freeze({
    plan,
    milestones: Object.freeze([...milestones]),
    tickets: Object.freeze(ordered),
    tier,
  });
}

/**
 * Every pending ticket waits on at least one other pending ticket, so walking
 * first unmet dependencies from the first pending ticket must revisit one.
 */
function cycleAmong(pending: readonly PlanTicketRecord[], internal: ReadonlyMap<string, readonly string[]>): string[] {
  const waiting = new Set(pending.map((record) => record.ticket.id));
  const path: string[] = [];
  let current = pending[0]!.ticket.id;
  while (!path.includes(current)) {
    path.push(current);
    current = internal.get(current)!.find((id) => waiting.has(id))!;
  }
  return [...path.slice(path.indexOf(current)), current];
}
