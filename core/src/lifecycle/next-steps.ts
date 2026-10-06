import { NEXT_STEPS_SCHEMA_ID, type NextSteps, type NextStep } from "../contracts/next-steps.ts";
import { LEGAL_EDGES, TASK_STATES, TERMINAL_STATES, type Actor, type EdgeId, type TaskState } from "../state/task-machine.ts";

/** Kept equal to main.ts's owner-terminal arms by a source-derived test. */
export const OWNER_ACT_COMMANDS = [
  "prove", "resume", "rework", "review", "grant", "raise", "degrade-review",
  "attribute", "journey", "land", "publish", "cancel",
] as const;

type Provenance = { readonly module: string; readonly callSite: string; readonly actor: Actor };
export type EdgeInvocation =
  | { readonly kind: "cli"; readonly verb: string; readonly args: readonly string[]; readonly provenance: Provenance }
  | { readonly kind: "host-internal"; readonly provenance: Provenance }
  | { readonly kind: "unavailable"; readonly reason: "not-implemented"; readonly detail: string };

const cli = (verb: string, module: string, callSite: string, actor: Actor, args: readonly string[] = []): EdgeInvocation =>
  ({ kind: "cli", verb, args, provenance: { module: `core/src/cli/commands/${module}.ts`, callSite, actor } });
const host = (module: string, callSite: string): EdgeInvocation =>
  ({ kind: "host-internal", provenance: { module: `core/src/cli/commands/${module}.ts`, callSite, actor: "host" } });
const cancel = cli("cancel", "cancel", "cancelCommand: confirmed transition to CANCELLED", "human", ["--cause", "<cause>", "--reason", "<why>"]);

/**
 * One classification per machine edge. Provenance cites actual TASK requests,
 * not phase corrections, rejection probes, registrations or suggested verbs.
 * Host outcomes are waits even when the host runs inside a CLI command.
 */
export const EDGE_INVOCATIONS: Readonly<Record<EdgeId, EdgeInvocation>> = {
  L1: cli("start", "start", "startCommand: final transition to PREPARED", "host"),
  L2: host("start", "blockDraft: transition DRAFT to BLOCKED"),
  L3: cancel,
  L4: cli("run", "production-run", "runProductionCommand: const l4 = budget.authorize(PREPARED to RUNNING)", "host"),
  L5: host("production-run", "runProductionCommand: preflight catch transition PREPARED to BLOCKED"),
  L6: cancel,
  L7: host("production-run", "runProductionCommand: const l7 = transition(RUNNING to GATING)"),
  L8: host("production-run", "runProductionCommand: final catch transition from failedFrom RUNNING to BLOCKED"),
  L9: cancel,
  L10: { kind: "unavailable", reason: "not-implemented", detail: "No task-transition invocation requests GATING to RUNNING as host or owner. Rework requests human, which this edge rejects; workflow engine corrections change phase state, not task state." },
  L11: host("production-run", "runProductionCommand: const l11 = budget.authorize(GATING to REVIEWING)"),
  L12: host("production-run", "runProductionCommand: const l12 = transition(GATING to AWAITING_OWNER), no review phase"),
  L13: host("adopt", "adoptCommand: const l13 = transition(GATING to BLOCKED), failed fresh adoption gates"),
  L14: cancel,
  L15: host("production-run", "runProductionCommand: const l15 = transition(REVIEWING to AWAITING_OWNER)"),
  L16: { kind: "unavailable", reason: "not-implemented", detail: "No task-transition invocation requests REVIEWING to RUNNING as owner. Rework requests human, which this edge rejects; workflow engine corrections do not invoke this task edge." },
  L17: host("production-run", "runProductionCommand: failedFrom REVIEWING catch transition to BLOCKED"),
  L18: cancel,
  L19: cli("rework", "rework", "reworkCommand: const authorization = budget.authorize(AWAITING_OWNER to RUNNING)", "human", ["<defect>"]),
  L20: cli("land", "land", "authorizeLanding: transition AWAITING_OWNER to LANDING (default human actor)", "human"),
  // The Notes example is illustrative. Replay names L21's fault vocabulary,
  // but reports a recovery blocker; it never calls transition or authorize.
  L21: { kind: "unavailable", reason: "not-implemented", detail: "No task-transition invocation requests AWAITING_OWNER to BLOCKED. Persistence replay reports record faults using L21's vocabulary but does not invoke the task transition." },
  L22: cancel,
  L23: host("land", "decideCompletion: transition LANDING to LANDED"),
  L24: host("land", "decideBlock: transition LANDING to BLOCKED"),
  L25: cli("review", "review", "reviewCommand: const authorization = budget.authorize(AWAITING_OWNER to REVIEWING)", "human", ["--reason", "<why the recorded review is not evidence>"]),
  L26: host("production-run", "takePhaseBoundarySnapshot: const l26 = budget.authorize(RUNNING to AWAITING_OWNER)"),
  L27: cli("publish", "publish", "authorizePublication: transition LANDED to PUBLISHED (default human actor)", "human"),
};

export interface NextStepsInput {
  readonly project: string;
  readonly taskId: string;
  readonly attempt: number;
  readonly revision: number;
  readonly state: TaskState;
  /** Optional measured facts distinguish grant's resumable boundary from live execution. */
  readonly recovery?: { readonly kind: string } | null;
  readonly process?: unknown;
  readonly budget?: { readonly callsReserved: number };
}

interface NonTransitionAct {
  readonly kind: "act" | "read";
  readonly verb: string;
  readonly states: readonly TaskState[];
  readonly args: readonly string[];
  readonly detail: string;
}

const liveStates = TASK_STATES.filter(state => !(TERMINAL_STATES as readonly TaskState[]).includes(state));

/** State eligibility is an inventory, not proof that command-specific guards pass. */
export const NON_TRANSITION_ACTS: readonly NonTransitionAct[] = [
  { kind: "act", verb: "raise", states: liveStates, args: ["--calls", "<n>", "--reason", "<why>"], detail: "raise.ts: isTerminalStatus refuses terminal attempts" },
  { kind: "act", verb: "grant", states: liveStates, args: ["--phase", "<phase>", "--file", "<path>", "--reason", "<why>"], detail: "grant.ts: PREPARED or quota-pause/completed-phase recovery, no process and no reserved calls; recovery is not a lifecycle state" },
  { kind: "act", verb: "journey", states: ["AWAITING_OWNER"], args: ["--journey", "<id>", "--sha", "<revision exercised>"], detail: "journey.ts: AWAITING_OWNER; also requires T2 and a candidate" },
  { kind: "act", verb: "attribute", states: ["BLOCKED", "CANCELLED"], args: ["--cause", "<cause>", "--reason", "<why>"], detail: "attribute.ts: only BLOCKED or CANCELLED; task-scoped write leaves the sealed attempt untouched" },
  { kind: "read", verb: "status", states: TASK_STATES, args: [], detail: "status.ts: reads any attempt" },
  { kind: "read", verb: "watch", states: TASK_STATES, args: [], detail: "watch.ts: reads any attempt; returns after its first terminal reading" },
];

function isOwner(verb: string): boolean {
  return (OWNER_ACT_COMMANDS as readonly string[]).includes(verb);
}

function argvFor(input: NextStepsInput, verb: string, args: readonly string[]): string[] {
  return ["awsf", verb, input.taskId, "--project", input.project, "--attempt", String(input.attempt), ...args];
}

/** Pure information only: no file, clock, process, Git, provider or permission side effects. */
export function nextSteps(input: NextStepsInput): NextSteps {
  const output: NextSteps = {
    schema: NEXT_STEPS_SCHEMA_ID, project: input.project, taskId: input.taskId,
    attempt: input.attempt, revision: input.revision, state: input.state,
    steps: [], waits: [], unavailable: [],
  };
  for (const edge of LEGAL_EDGES.filter(edge => edge.from === input.state)) {
    const invocation = EDGE_INVOCATIONS[edge.id];
    switch (invocation.kind) {
      case "cli":
        output.steps.push({ kind: "edge", edge: edge.id, to: edge.to, verb: invocation.verb,
          argv: argvFor(input, invocation.verb, invocation.args), who: isOwner(invocation.verb) ? "owner" : "driver",
          interactive: isOwner(invocation.verb) || edge.interactive, spendsCalls: edge.spawnSite, requires: [] });
        break;
      case "host-internal":
        output.waits.push({ edge: edge.id, to: edge.to, who: "host" });
        break;
      case "unavailable":
        output.unavailable.push({ edge: edge.id, to: edge.to, actors: [...edge.actors], reason: invocation.reason, detail: invocation.detail });
        break;
    }
  }
  for (const act of NON_TRANSITION_ACTS.filter(act => act.states.includes(input.state))) {
    if (act.verb === "grant" &&
        (!(input.state === "PREPARED" || input.recovery?.kind === "quota-pause" || input.recovery?.kind === "completed-phase") ||
         (input.process !== undefined && input.process !== null) || (input.budget?.callsReserved ?? 0) !== 0)) continue;
    const step: NextStep = { kind: act.kind, verb: act.verb, argv: argvFor(input, act.verb, act.args),
      who: isOwner(act.verb) ? "owner" : "driver", interactive: isOwner(act.verb), spendsCalls: false, requires: [] };
    output.steps.push(step);
  }
  return output;
}
