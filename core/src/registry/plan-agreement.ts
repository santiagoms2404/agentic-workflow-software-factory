import { TICKET_TASK_CLASSES } from "../contracts/ticket.ts";
import type { ParsedAwsfPlan } from "./plan-source.ts";
import { isPlanIdentifierClaim, spineCoverage, type SpineCoverageRule } from "./plan-spine.ts";

const STATES = ["todo", "wip", "done", "failed"];
const TIERS = [0, 1, 2];
const WORKFLOWS = ["scout", "plan", "build", "plan-build-test", "build-review", "simple-sdlc", "intake"];
const TICKET_ID = /^[TW]\d\d$/;

// Spine dependencies order authoring, but states track build completion. G1
// reverses this one build edge; failed work is never covered by the exception.
const COMPLETION_DEPENDENCY_EXCEPTIONS = new Set(["awsf-v2-plan/W06->W05"]);

/** The fence's parsed frontmatter, without adding coercions or requirements. */
export interface AgreementTicket {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly milestone: string;
  readonly tier: number | undefined;
  readonly state: string;
  readonly depends_on: readonly string[];
  readonly workflow: string | undefined;
  readonly task_class: unknown;
  readonly serves: readonly string[] | undefined;
  readonly prompt: string;
}

export interface SectionBBlock {
  readonly title: string;
  readonly prompt: string;
}

export interface PlanAgreementInput {
  readonly label: string;
  readonly plan: ParsedAwsfPlan;
  readonly tickets: readonly AgreementTicket[];
  readonly sectionB: ReadonlyMap<number, SectionBBlock>;
  readonly knownStems: readonly string[];
}

export type PlanAgreementRule =
  | "TICKET_COVERAGE" | "MILESTONE" | "MILESTONE_STATE" | "CHECKLIST"
  | "CHECKLIST_STATE" | "PROMPT" | "DEPENDENCIES" | "COMPLETED_DEPENDENCIES"
  | "VOCABULARIES" | SpineCoverageRule;

export interface PlanAgreementViolation {
  readonly plan: string;
  readonly rule: PlanAgreementRule;
  /** The original fence's diagnostic, unchanged. */
  readonly message: string;
}

function violations(
  input: PlanAgreementInput,
  rule: PlanAgreementRule,
  messages: readonly string[],
): readonly PlanAgreementViolation[] {
  return Object.freeze(messages.map((message) => Object.freeze({ plan: input.label, rule, message })));
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((number, index) => number === right[index]);
}

export function ticketCoverage(input: PlanAgreementInput): readonly PlanAgreementViolation[] {
  const numbers = input.tickets.map((ticket) => ticket.number);
  const highest = Math.max(...numbers);
  const expected = Array.from({ length: highest }, (_, i) => i + 1);
  const messages: string[] = [];
  if (!sameNumbers(numbers, expected)) messages.push("ticket ids must be T01..Tnn with no gaps");
  const uncovered = input.plan.filter((task) => task.number <= highest && !numbers.includes(task.number));
  if (uncovered.length > 0) messages.push("a plan task below the highest ticket has no ticket");
  const orphans = numbers.filter((number) => !input.plan.some((task) => task.number === number));
  if (orphans.length > 0) messages.push("a ticket names a task the plan does not have");
  return violations(input, "TICKET_COVERAGE", messages);
}

export function ticketMilestones(input: PlanAgreementInput): readonly PlanAgreementViolation[] {
  const byNumber = new Map(input.plan.map((task) => [task.number, task]));
  return violations(input, "MILESTONE", input.tickets
    .filter((ticket) => byNumber.get(ticket.number)?.milestone !== ticket.milestone)
    .map((ticket) => `${input.label}/${ticket.id}: ticket says ${ticket.milestone}, plan says ${byNumber.get(ticket.number)?.milestone}`));
}

export function ticketMilestoneStates(input: PlanAgreementInput): readonly PlanAgreementViolation[] {
  const byNumber = new Map(input.plan.map((task) => [task.number, task]));
  const messages: string[] = [];
  for (const ticket of input.tickets) {
    const marker = byNumber.get(ticket.number)?.milestoneMarker;
    if (marker === "x" && ticket.state !== "done") {
      messages.push(`${input.label}/${ticket.id}: milestone ${ticket.milestone} is [x] but ticket is ${ticket.state}`);
    }
    if (marker === "" && ticket.state === "done") {
      messages.push(`${input.label}/${ticket.id}: milestone ${ticket.milestone} is [] but ticket is done`);
    }
  }
  return violations(input, "MILESTONE_STATE", messages);
}

export function planTaskChecklists(input: PlanAgreementInput): readonly PlanAgreementViolation[] {
  return violations(input, "CHECKLIST", input.plan
    .filter((task) => task.checklist.length === 0)
    .map((task) => `${input.label}: task ${task.number} (${task.milestone}) has no checklist to check state against`));
}

export function ticketChecklistStates(input: PlanAgreementInput): readonly PlanAgreementViolation[] {
  const byNumber = new Map(input.plan.map((task) => [task.number, task]));
  const messages: string[] = [];
  for (const ticket of input.tickets) {
    const checklist = byNumber.get(ticket.number)?.checklist ?? [];
    if (checklist.length === 0) continue; // guarded by planTaskChecklists
    const allChecked = checklist.every((mark) => mark === "x");
    if (allChecked && ticket.state !== "done") {
      messages.push(`${input.label}/${ticket.id}: every plan checklist box is [x] but ticket is ${ticket.state}`);
    }
    if (!allChecked && ticket.state === "done") {
      messages.push(`${input.label}/${ticket.id}: ticket is done but the plan still has unchecked boxes`);
    }
  }
  return violations(input, "CHECKLIST_STATE", messages);
}

export function ticketPromptAgreement(input: PlanAgreementInput): readonly PlanAgreementViolation[] {
  const messages: string[] = [];
  for (const ticket of input.tickets) {
    const block = input.sectionB.get(ticket.number);
    if (!block) {
      messages.push(`${input.label}/${ticket.id}: no Section B block in awsf-plan-build-prompts.md`);
      continue;
    }
    if (block.prompt !== ticket.prompt) messages.push(`${input.label}/${ticket.id}: build prompt has drifted from Section B`);
    if (block.title !== ticket.title) messages.push(`${input.label}/${ticket.id}: title differs from its Section B heading`);
  }
  return violations(input, "PROMPT", messages);
}

export function ticketDependencies(input: PlanAgreementInput): readonly PlanAgreementViolation[] {
  const ids = new Set(input.tickets.map((ticket) => ticket.id));
  const messages: string[] = [];
  for (const ticket of input.tickets) {
    for (const dep of ticket.depends_on) {
      if (!ids.has(dep)) messages.push(`${input.label}/${ticket.id}: depends on ${dep}, which does not exist`);
      else if (dep >= ticket.id) messages.push(`${input.label}/${ticket.id}: depends on ${dep}, which is not earlier`);
    }
  }
  return violations(input, "DEPENDENCIES", messages);
}

export function ticketCompletedDependencies(input: PlanAgreementInput): readonly PlanAgreementViolation[] {
  const stateOf = new Map(input.tickets.map((ticket) => [ticket.id, ticket.state]));
  return violations(input, "COMPLETED_DEPENDENCIES", input.tickets
    .filter((ticket) => ticket.state === "done")
    .flatMap((ticket) => ticket.depends_on
      .filter((dep) => stateOf.get(dep) !== "done")
      .filter((dep) => stateOf.get(dep) === "failed"
        || !COMPLETION_DEPENDENCY_EXCEPTIONS.has(`${input.label}/${ticket.id}->${dep}`))
      .map((dep) => `${input.label}/${ticket.id} is done but ${dep} is ${stateOf.get(dep)}`)));
}

export function validTaskClass(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && (TICKET_TASK_CLASSES as readonly string[]).includes(value));
}

export function ticketVocabularies(input: PlanAgreementInput): readonly PlanAgreementViolation[] {
  const messages: string[] = [];
  for (const ticket of input.tickets) {
    if (!STATES.includes(ticket.state)) messages.push(`${input.label}/${ticket.id}: state "${ticket.state}"`);
    // Optional fields stay optional; no spine is invented for a legacy plan.
    if (ticket.tier !== undefined && !TIERS.includes(ticket.tier)) {
      messages.push(`${input.label}/${ticket.id}: tier "${String(ticket.tier)}"`);
    }
    if (ticket.workflow !== undefined && !WORKFLOWS.includes(ticket.workflow)) {
      messages.push(`${input.label}/${ticket.id}: workflow "${ticket.workflow}"`);
    }
    if (!validTaskClass(ticket.task_class)) {
      messages.push(`${input.label}/${ticket.id}: task_class ${JSON.stringify(ticket.task_class)}`);
    }
    if (
      ticket.serves !== undefined
      && (!Array.isArray(ticket.serves)
        || ticket.serves.some((identifier) => typeof identifier !== "string" || !isPlanIdentifierClaim(identifier)))
    ) {
      messages.push(`${input.label}/${ticket.id}: serves ${JSON.stringify(ticket.serves)}`);
    }
    if (!TICKET_ID.test(ticket.id)) messages.push(`${input.label}/${ticket.id}: id is not zero-padded Tnn or Wnn`);
  }
  return violations(input, "VOCABULARIES", messages);
}

export function identifierSpineAgreement(input: PlanAgreementInput): readonly PlanAgreementViolation[] {
  const ticketIdByNumber = new Map(input.tickets.map((ticket) => [ticket.number, ticket.id]));
  return spineCoverage(
    { label: input.label, declarations: input.plan.declarations },
    input.plan.map((task) => ({
      id: ticketIdByNumber.get(task.number) ?? `T${String(task.number).padStart(2, "0")}`,
      serves: task.serves,
    })),
    input.tickets.map((ticket) => ({ id: ticket.id, serves: ticket.serves })),
    input.knownStems,
  );
}

const CHECKS = {
  TICKET_COVERAGE: ticketCoverage,
  MILESTONE: ticketMilestones,
  MILESTONE_STATE: ticketMilestoneStates,
  CHECKLIST: planTaskChecklists,
  CHECKLIST_STATE: ticketChecklistStates,
  PROMPT: ticketPromptAgreement,
  DEPENDENCIES: ticketDependencies,
  COMPLETED_DEPENDENCIES: ticketCompletedDependencies,
  VOCABULARIES: ticketVocabularies,
} as const;

/** All rules, or one fence rule, over caller-resolved and parsed data only. */
export function planAgreement(
  input: PlanAgreementInput,
  rule?: PlanAgreementRule,
): readonly PlanAgreementViolation[] {
  if (rule !== undefined) {
    if (rule in CHECKS) return CHECKS[rule as keyof typeof CHECKS](input);
    return Object.freeze(identifierSpineAgreement(input).filter((violation) => violation.rule === rule));
  }
  return Object.freeze([
    ...Object.values(CHECKS).flatMap((check) => check(input)),
    ...identifierSpineAgreement(input),
  ]);
}
