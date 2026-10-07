import type { NextSteps, NextStep } from "../contracts/next-steps.ts";
import { nextSteps, type NextStepsInput } from "./next-steps.ts";
import type { TaskState } from "../state/task-machine.ts";

/** Display argv as copyable tokens; placeholders still need real values. */
export function renderCommand(argv: readonly string[]): string {
  return `\`${argv.map(token => /^[A-Za-z0-9._/:-]+$/u.test(token) ? token : `'${token.replaceAll("'", "'\\''")}'`).join(" ")}\``;
}

/** Measured command-specific context, persisted only for new advice. Not authorization. */
export type NextAdvice =
  | { readonly kind: "adoption-grant"; readonly repeatArgv: readonly string[] }
  | { readonly kind: "ceiling-pause"; readonly minimumCeiling: number; readonly maximumCeiling: number };

export interface AdviceContext {
  readonly advice?: NextAdvice | null;
  readonly candidateSha?: string | null;
  readonly gatesPass?: boolean;
  readonly workflow?: string;
  readonly recovery?: { readonly kind: string; readonly ticket?: string } | null;
  readonly process?: unknown;
  readonly budget?: { readonly callsReserved: number; readonly ceiling?: number };
  readonly blocker?: { readonly code: string } | null;
}

function command(model: NextSteps, verb: string): string | null {
  const step = model.steps.find(step => step.verb === verb);
  return step === undefined ? null : renderCommand(step.argv);
}

function selected(model: NextSteps, verbs: readonly string[]): string[] {
  return verbs.flatMap(verb => { const value = command(model, verb); return value === null ? [] : [value]; });
}

/** The grant step's owed phase and paths, when the caller measured one; the step itself stays the owner's. */
function owedGrant(model: NextSteps): { readonly phase: string; readonly paths: readonly string[]; readonly grant: string } | null {
  const step = model.steps.find(step => step.verb === "grant" && step.requires.length > 0);
  const phase = step?.argv[step.argv.indexOf("--phase") + 1];
  return step === undefined || phase === undefined ? null : { phase, paths: step.requires.map(entry => entry.field), grant: renderCommand(step.argv) };
}

/** The one lifecycle sentence source. Unavailable edges never supply advice. */
export function renderNextAction(model: NextSteps, context: AdviceContext = {}): string {
  if (context.blocker?.code === "sqlite-projection-failed") return "run `awsf db rebuild`, then retry advancement";
  if (context.advice?.kind === "adoption-grant" && model.state === "GATING") {
    return `after ${renderDegradationAdvice(model.taskId)}, ${renderAdoptionAction(context.advice.repeatArgv)}; ${command(model, "watch")}`;
  }
  const recovery = context.recovery;
  if (recovery != null && ["PREPARED", "RUNNING", "GATING", "REVIEWING"].includes(model.state) &&
      context.process == null && (context.budget?.callsReserved ?? 0) === 0) {
    const resume = renderCommand(["awsf", "resume", model.taskId, "--project", model.project, "--attempt", String(model.attempt), "--reason", "<why>"]);
    const ticket = recovery.ticket === undefined ? "" : ` at ticket ${recovery.ticket}`;
    if (recovery.kind === "ceiling-pause") {
      const advice = context.advice?.kind === "ceiling-pause" ? context.advice : null;
      if (advice !== null && advice.minimumCeiling > advice.maximumCeiling) return `ceiling-paused${ticket}; no ceiling grant can fund the rest: ${advice.minimumCeiling} exceeds MAX_CALL_CEILING (${advice.maximumCeiling})`;
      const short = advice === null || context.budget?.ceiling === undefined ? null : Math.max(0, advice.minimumCeiling - context.budget.ceiling);
      if (short === 0) return `ceiling funded${ticket}; run ${resume}`;
      const raise = model.steps.find(step => step.verb === "raise");
      const grant = raise === undefined ? "a task-scoped ceiling grant" : renderCommand(raise.argv.map(token => token === "<n>" && short !== null ? String(short) : token));
      return `ceiling-paused${ticket}; the owner must fund the remaining work with ${grant}, then run ${resume}`;
    }
    if (recovery.kind === "ticket-block") return `ticket-blocked${ticket}; the owner fixes the cause, then runs ${resume} to re-measure the same candidate`;
    const owed = owedGrant(model);
    if (owed !== null) return `${recovery.kind}; ${owed.phase} owes a protected grant for ${owed.paths.join(", ")}: the owner decides on ${owed.grant}, then run ${resume}`;
    return `${recovery.kind}; run ${resume} to continue the saved boundary`;
  }
  if (model.state === "AWAITING_OWNER") {
    if (context.workflow === "prove") return `inspect the retained findings, then run ${command(model, "cancel")}; this workflow never lands`;
    if (context.candidateSha === null && context.gatesPass && (context.workflow === "scout" || context.workflow === "plan")) {
      return `inspect the retained awsf.${context.workflow}-output/v1 envelope, then run ${command(model, "cancel")} when finished; no candidate can be landed`;
    }
  }
  const actions = model.steps.filter(step => step.kind !== "read").map(step => renderCommand(step.argv));
  if (model.state === "BLOCKED" || model.state === "CANCELLED") {
    const retry = renderCommand(["awsf", "retry", model.taskId, "--project", model.project]);
    return `inspect the sealed attempt; ${actions.length === 0 ? "" : `owner attribution: ${actions.join(" or ")}; `}run ${retry} only if the task should continue`;
  }
  if (model.state === "LANDING") return `wait for persisted landing completion; recover with ${renderCommand(["awsf", "land", model.taskId, "--project", model.project, "--attempt", String(model.attempt)])}`;
  const wait = model.waits.length === 0 ? "" : `host transitions: ${model.waits.map(wait => `${wait.edge} to ${wait.to}`).join(", ")}`;
  const sentence = actions.length === 0 ? "no state-changing CLI action is listed" : `run ${actions.join(" or ")}`;
  const held = model.steps.find(step => step.kind === "edge" && step.edge === "L1")?.requires ?? [];
  const k1 = held.length === 0 ? "" : `start is refused until K1 clears: ${held.map(entry => `${entry.field} ${entry.status}`).join(", ")}; `;
  const owed = owedGrant(model);
  const grant = owed === null ? "" : `run is refused until ${owed.phase}'s protected grant covers ${owed.paths.join(", ")}; `;
  return `${k1}${grant}${sentence}${wait === "" ? "" : `; ${wait}`}; inspect with ${command(model, "watch") ?? command(model, "status")}`;
}

/**
 * The runner's refusal of a writing phase that owes a planned protected grant,
 * and what clears it. Issuing the grant is the owner's act at a terminal; the
 * runner names it and never issues one. A phase takes one grant, so a recorded
 * grant that misses a planned path cannot be widened on this attempt.
 */
export function renderGrantRefusalAdvice(selector: AdviceSelector, owed: { readonly phase: string; readonly grantId: string | null },
  boundary: "before-l4" | "phase-boundary"): string {
  if (owed.grantId !== null) return `the recorded grant ${owed.grantId} is ${owed.phase}'s one grant and cannot be widened on this attempt`;
  const state: TaskState = boundary === "before-l4" ? "PREPARED" : "RUNNING";
  const model = nextSteps({ project: selector.project ?? "<project>", taskId: selector.taskId, attempt: selector.attempt ?? 0, revision: 0, state,
    recovery: boundary === "phase-boundary" ? { kind: "completed-phase" } : null, process: null, budget: { callsReserved: 0 },
    grantOwed: { phase: owed.phase, paths: ["<planned>"] } });
  const grant = command(model, "grant") ?? "`awsf grant`";
  const again = boundary === "before-l4"
    ? command(model, "run") ?? "`awsf run`"
    : renderCommand(["awsf", "resume", selector.taskId, "--project", selector.project ?? "<project>", "--attempt", String(selector.attempt ?? "<attempt>"), "--reason", "<why>"]);
  return `the owner decides on ${grant} at an interactive terminal; then run ${again}`;
}

/**
 * K1's refusal of L1 and the command that clears it. The confirmation is the
 * owner's act; every other field or stale binding is cleared by measuring the
 * attempt again, after which changed paths or request text need a fresh
 * confirmation. The attempt is still DRAFT, so start is retried afterwards.
 */
export function renderK1RefusalAdvice(selector: AdviceSelector, field: string | null): string {
  const model = selectorModel(selector, "DRAFT");
  const [preflight, confirm, start] = ["preflight", "confirm", "start"].map(verb => command(model, verb) ?? `\`awsf ${verb}\``);
  if (field === "confirmation") return `the owner confirms the request and paths with ${confirm} at an interactive terminal; then run ${start} again`;
  return `fix the cause and run ${preflight} again; if the request or its paths changed, the owner confirms them with ${confirm}; then run ${start} again`;
}

/** Structural input keeps the renderer pure and independent of CLI persistence. */
export function renderAttemptNextAction(status: Omit<NextStepsInput, "state"> & AdviceContext & { readonly lifecycleState: TaskState }): string {
  return renderNextAction(nextSteps({ ...status, state: status.lifecycleState }), status);
}

export function renderNextSteps(model: NextSteps, context: AdviceContext = {}): readonly string[] {
  const stepLine = (step: NextStep): string =>
    `Step ${step.kind === "edge" ? `${step.edge} to ${step.to}` : step.kind}: ${renderCommand(step.argv)} — ${step.who}${step.interactive ? ", interactive" : ""}${step.spendsCalls ? ", spends calls" : ""}`;
  return [renderNextAction(model, context), ...model.steps.map(stepLine),
    ...model.waits.map(wait => `Wait ${wait.edge} to ${wait.to}: host — implemented task transition`),
    ...model.unavailable.map(edge => `Unavailable ${edge.edge} to ${edge.to}: ${edge.reason}; machine actors ${edge.actors.join(", ")}. ${edge.detail}`)];
}

/** Whose advice it is. A selector the caller does not hold renders as a placeholder, never a guessed value. */
export interface AdviceSelector { readonly project?: string; readonly taskId: string; readonly attempt?: number }

function selectorModel(selector: AdviceSelector, state: TaskState): NextSteps {
  const model = nextSteps({ project: selector.project ?? "<project>", taskId: selector.taskId, attempt: selector.attempt ?? 0, revision: 0, state });
  if (selector.attempt !== undefined) return model;
  return { ...model, steps: model.steps.map(step => ({ ...step, argv: step.argv.map((token, index) => step.argv[index - 1] === "--attempt" ? "<attempt>" : token) })) };
}

export function renderHeadroomAdvice(selector: AdviceSelector, calls: number, state: TaskState = "AWAITING_OWNER"): string {
  const model = selectorModel(selector, state);
  const raise = model.steps.find(step => step.verb === "raise");
  const advice = raise === undefined ? "no ceiling grant is available on this sealed attempt" :
    renderCommand(raise.argv.map(token => token === "<n>" ? String(calls) : token));
  return `nothing was spent; ${advice}, ${selected(model, ["land", "cancel"]).join(" or ")} remain`;
}

export function renderSealedAdvice(taskId: string): string {
  return `run ${renderCommand(["awsf", "retry", taskId])} to open the next attempt; prior spend and ceiling grants carry forward`;
}

/** Owner-gate alternatives in the caller's order; verbs the model does not offer are dropped. */
export function renderOwnerAlternatives(selector: AdviceSelector, verbs: readonly string[] = ["land", "cancel", "raise"]): string {
  return `consider ${selected(selectorModel(selector, "AWAITING_OWNER"), verbs).join(" or ")}; command-specific guards apply`;
}

/** A replay ends by cancellation, never delivery; a state without a cancel step gets no cancel advice. */
export function renderReplayAdvice(model: NextSteps): string {
  const cancel = command(model, "cancel");
  return cancel === null ? `no cancel is legal at ${model.state}` : `run ${cancel} once its evidence is read`;
}

export function renderRestartAdvice(selector: AdviceSelector): string {
  return `run ${command(selectorModel(selector, "DRAFT"), "start")} again`;
}

export function renderAdoptionAction(argv: readonly string[]): string { return `run ${renderCommand(argv)}`; }
export function renderWatchAdvice(taskId: string): string { return `inspect changes with ${renderCommand(["awsf", "watch", taskId])}`; }
export function renderStatusAdvice(taskId: string): string { return `refresh with ${renderCommand(["awsf", "status", taskId])}`; }
export function renderOwnerGateAdvice(taskId: string): string { return `it waits for the owner; ${renderCommand(["awsf", "land", taskId])} needs an interactive terminal`; }
export function renderProjectionAdvice(): string { return "run `awsf db rebuild`"; }
export function renderNewAdvice(taskId: string): string { return `run ${renderCommand(["awsf", "new", taskId, "..."])}`; }
export function renderPreviewAdvice(taskId: string): string { return `run ${renderCommand(["awsf", "preview", taskId])} again`; }
export function renderRegistrationAdvice(): string { return "run `awsf project register --catalog <path> --repository <id>=<path>` first"; }
export function renderDegradationAdvice(taskId: string): string { return `the owner may allow degraded review with ${renderCommand(["awsf", "degrade-review", taskId, "--reason", "<why>"])}`; }

/** Prove's owner exercise uses the documented npm launcher and replaceable placeholders. */
export function renderProveActions(model: NextSteps): { readonly commands: { readonly start: string; readonly cancel: string }; readonly lines: readonly string[] } {
  const written = (verb: string): string => {
    const step = model.steps.find(step => step.verb === verb);
    if (step === undefined) throw new Error(`no implemented ${verb} step at ${model.state}`);
    return `npm run awsf -- ${step.argv.slice(1).map(token => token === "<why>" ? '"<why>"' : token).join(" ")}`;
  };
  const commands = { start: written("start"), cancel: written("cancel") };
  return { commands, lines: [`Start it: ${commands.start}`, `Cancel it once its evidence is read: ${commands.cancel}`] };
}
