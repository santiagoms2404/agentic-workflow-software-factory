import { scanAwsfPlanHtmlV1 } from "../registry/plan-source.ts";
import type { PlanAgreementViolation } from "../registry/plan-agreement.ts";
import { ClosureTreeError, registeredTicketPaths, ticketFrontmatter, treeAgreement, treeText,
  type ClosureRegistry, type ClosureTree } from "./tree.ts";

export interface ClosureChange {
  readonly path: string;
  readonly kind: "milestone" | "status" | "state";
  readonly milestone: string | null;
  readonly taskNumber: number | null;
  readonly rowIndex: number | null;
  readonly oldValue: string;
  readonly newValue: string;
}
export interface ClosureDeltaRefusal {
  readonly code: "E_CLOSURE_DELTA";
  readonly kind: "paths" | "content" | "vocabulary" | "agreement" | "tree" | "mode";
  readonly path: string;
  /** Zero-based byte offset, not a UTF-16 character index. */
  readonly offset: number;
  readonly beforeContext: string;
  readonly afterContext: string;
  readonly message: string;
  readonly violations?: readonly PlanAgreementViolation[];
}
export type ClosureDeltaResult =
  | { readonly ok: true; readonly changes: readonly ClosureChange[] }
  | { readonly ok: false; readonly refusal: ClosureDeltaRefusal };
export interface ClosureModes {
  readonly before: ReadonlyMap<string, string>;
  readonly after: ReadonlyMap<string, string>;
}

interface ValueSpan {
  start: number;
  end: number;
  value: string;
  kind: ClosureChange["kind"];
  taskNumber: number | null;
  rowIndex: number | null;
  milestone: string | null;
}

function firstDifference(before: Uint8Array, after: Uint8Array): number {
  let index = 0;
  while (index < before.length && index < after.length && before[index] === after[index]) index++;
  return index;
}

function refusal(before: ClosureTree, after: ClosureTree, path: string, kind: ClosureDeltaRefusal["kind"],
  message: string, violations?: readonly PlanAgreementViolation[]): ClosureDeltaResult {
  const left = before.get(path) ?? new Uint8Array();
  const right = after.get(path) ?? new Uint8Array();
  const offset = firstDifference(left, right);
  const context = (bytes: Uint8Array): string => Buffer.from(bytes.slice(Math.max(0, offset - 24), offset + 24)).toString("utf8");
  return { ok: false, refusal: { code: "E_CLOSURE_DELTA", kind, path, offset,
    beforeContext: context(left), afterContext: context(right), message,
    ...(violations === undefined ? {} : { violations }) } };
}

function planSpans(text: string): ValueSpan[] {
  const layout = scanAwsfPlanHtmlV1(text);
  return [...layout.milestones, ...layout.tasks.flatMap((task) => task.tokens)]
    .sort((left, right) => left.valueStart - right.valueStart)
    .map((token) => ({ start: token.valueStart, end: token.valueEnd, value: token.value,
      kind: token.taskNumber === null ? "milestone" : "status", taskNumber: token.taskNumber,
      rowIndex: token.rowIndex, milestone: token.milestone }));
}

function ticketSpans(text: string, path: string, light: boolean): ValueSpan[] {
  const fm = ticketFrontmatter(text, path, light);
  return [{ start: fm.stateStart, end: fm.stateEnd, value: fm.state, kind: "state",
    taskNumber: Number(String(fm.fields.id).slice(1)), rowIndex: null,
    milestone: light ? null : String(fm.fields.milestone) }];
}

/** Compare immutable segments, not a placeholder string that source bytes could impersonate. */
function sameOutsideValues(left: string, right: string, before: readonly ValueSpan[], after: readonly ValueSpan[]): boolean {
  if (before.length !== after.length) return false;
  let a = 0;
  let b = 0;
  for (let index = 0; index < before.length; index++) {
    const old = before[index]!;
    const next = after[index]!;
    if (left.slice(a, old.start) !== right.slice(b, next.start)) return false;
    a = old.end;
    b = next.end;
  }
  return left.slice(a) === right.slice(b);
}

/**
 * Pure byte-tree proof. Only resolver-registered plans/tickets can change.
 * Callers with Git trees must supply complete modes (or independently prove
 * identical modes before trusting a bytes-only proof); bytes cannot encode a chmod.
 */
export function closureDelta(before: ClosureTree, after: ClosureTree, registry: ClosureRegistry,
  modes?: ClosureModes): ClosureDeltaResult {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  for (const path of paths) {
    if (!before.has(path) || !after.has(path)) return refusal(before, after, path, "paths", "closure adds or removes a path");
    if (modes !== undefined && (modes.before.get(path) === undefined || modes.after.get(path) === undefined
      || modes.before.get(path) !== modes.after.get(path))) {
      return refusal(before, after, path, "mode", "closure changes a mode or has no mode evidence");
    }
  }
  const plans = new Set(registry.plans.map((source) => source.planPath));
  const tickets = new Set(registry.plans.flatMap((source) => registeredTicketPaths(before, source)));
  const lights = new Set(registry.lightTickets?.values());
  const changes: ClosureChange[] = [];
  let currentPath = paths[0] ?? "";
  try {
    for (const path of paths) {
      currentPath = path;
      if (Buffer.from(before.get(path)!).equals(Buffer.from(after.get(path)!))) continue;
      if (!plans.has(path) && !tickets.has(path) && !lights.has(path)) {
        return refusal(before, after, path, "content", "changed path is not a registered plan or ticket");
      }
      const left = treeText(before, path);
      const right = treeText(after, path);
      const oldSpans = plans.has(path) ? planSpans(left) : ticketSpans(left, path, lights.has(path));
      const newSpans = plans.has(path) ? planSpans(right) : ticketSpans(right, path, lights.has(path));
      if (!sameOutsideValues(left, right, oldSpans, newSpans)) {
        return refusal(before, after, path, "content", "difference outside status-token or state values");
      }
      for (const [index, span] of newSpans.entries()) {
        const old = oldSpans[index]!;
        if (old.value === span.value) continue;
        // Only a value closure writes is held to its vocabulary. An untouched [f]
        // row or failed state elsewhere in the file is not this closure's doing,
        // and refusing it would block every closure of that plan (G03-C, F1).
        const allowed = span.kind === "state" ? ["todo", "wip", "done"] : ["", "wip", "x"];
        if (!allowed.includes(span.value)) return refusal(before, after, path, "vocabulary", `closure refuses ${span.kind} value ${JSON.stringify(span.value)}`);
        changes.push(Object.freeze({ path, kind: span.kind,
          milestone: span.milestone, taskNumber: span.taskNumber, rowIndex: span.rowIndex,
          oldValue: old.value, newValue: span.value }));
      }
    }
    const violations = treeAgreement(after, registry);
    if (violations.length > 0) {
      const path = registry.plans.find((source) => source.label === violations[0]?.plan)?.planPath ?? currentPath;
      return refusal(before, after, path, "agreement", "after tree fails plan/ticket agreement", violations);
    }
    return { ok: true, changes: Object.freeze(changes) };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const path = error instanceof ClosureTreeError ? error.path : currentPath;
    return refusal(before, after, path, "tree", error.message);
  }
}
