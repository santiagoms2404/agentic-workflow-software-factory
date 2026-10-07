import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Value } from "@sinclair/typebox/value";
import { OWNER_ACTS } from "../../../docs/driving/marimba/marimba-guard-rules.mts";
import { assertNextSteps, NEXT_STEPS_SCHEMA_ID, NextStepsSchema, type NextSteps } from "../../src/contracts/next-steps.ts";
import { ENVELOPE_SCHEMAS, RECORD_SCHEMAS, isEnvelopeSchemaId } from "../../src/contracts/registry.ts";
import { EDGE_INVOCATIONS, NON_TRANSITION_ACTS, OWNER_ACT_COMMANDS, nextSteps, type NextStepsInput } from "../../src/lifecycle/next-steps.ts";
import { renderGrantRefusalAdvice, renderNextAction } from "../../src/lifecycle/renderer.ts";
import { LEGAL_EDGES, TASK_STATES, type TaskState } from "../../src/state/task-machine.ts";
import { repoRoot } from "./meta/_walk.ts";

const inputFor = (state: TaskState): NextStepsInput => ({ project: "fixture-project", taskId: "fixture-task", attempt: 2, revision: 14, state });

// Same derivation as boundary-claims, whose helper is deliberately local.
// No second expected list: the arms that construct the terminal are authority.
function ownerActsIn(source: string): string[] {
  const arms = [...source.matchAll(/\bcase "([a-z][\w-]*)":|\bdefault:/g)];
  return arms.flatMap((arm, index) => arm[1] !== undefined &&
    source.slice(arm.index, arms[index + 1]?.index ?? source.length).includes("processOwnerTerminal()") ? [arm[1]] : []);
}

// Used unchanged for real outputs and planted defects: a mutation must fail the
// same property that protects production, not a separate assertion about the mutant.
function assertInventory(output: NextSteps): void {
  const state = output.state;
  const implemented = output.steps.filter(step => step.kind === "edge");
  const entries = [...implemented, ...output.waits, ...output.unavailable];
  assert.deepEqual(entries.map(entry => entry.edge).sort(), LEGAL_EDGES.filter(edge => edge.from === state).map(edge => edge.id).sort(), state);
  assert.equal(new Set(entries.map(entry => entry.edge)).size, entries.length, state);
  assert.equal(Value.Check(NextStepsSchema, output), true, state);
  assertNextSteps(JSON.parse(JSON.stringify(output)));
  for (const edge of LEGAL_EDGES.filter(edge => edge.from === state)) {
    const entry = entries.find(entry => entry.edge === edge.id)!;
    assert.equal(entry.to, edge.to);
    const invocation = EDGE_INVOCATIONS[edge.id];
    if (invocation.kind === "cli") {
      const step = implemented.find(step => step.edge === edge.id)!;
      assert.equal(step.verb, invocation.verb);
      assert.equal(step.spendsCalls, edge.spawnSite);
      assert.equal(step.who, (OWNER_ACT_COMMANDS as readonly string[]).includes(step.verb) ? "owner" : "driver");
      assert.equal(step.interactive, edge.interactive || step.who === "owner");
      assert.ok(edge.actors.includes(invocation.provenance.actor));
    } else if (invocation.kind === "host-internal") {
      assert.equal(output.waits.find(wait => wait.edge === edge.id)?.who, "host");
      assert.equal(invocation.provenance.actor, "host");
      assert.ok(edge.actors.includes("host"));
    } else {
      const unavailable = output.unavailable.find(value => value.edge === edge.id)!;
      assert.deepEqual(unavailable.actors, edge.actors);
      assert.equal(unavailable.reason, "not-implemented");
      assert.match(unavailable.detail, /\S/u);
      for (const property of ["verb", "argv", "who"]) assert.equal(Object.hasOwn(unavailable, property), false);
    }
  }
  for (const step of output.steps) {
    assert.equal(step.who, (OWNER_ACT_COMMANDS as readonly string[]).includes(step.verb) ? "owner" : "driver");
    if (step.kind !== "edge") {
      assert.equal(step.interactive, step.who === "owner");
      assert.equal(step.spendsCalls, false);
    }
    assert.deepEqual(step.requires, []);
    assert.deepEqual(step.argv.slice(0, 7), ["awsf", step.verb, output.taskId, "--project", output.project, "--attempt", String(output.attempt)]);
  }
}

test("next steps partition the machine edges exactly once and validate for every state", () => {
  assert.deepEqual(Object.keys(EDGE_INVOCATIONS).sort(), LEGAL_EDGES.map(edge => edge.id).sort());
  for (const state of TASK_STATES) assertInventory(nextSteps(inputFor(state)));
});

test("the inventory property rejects missing, extra and duplicate edges in every populated state", () => {
  for (const state of TASK_STATES) {
    const original = nextSteps(inputFor(state));
    for (const bucket of ["steps", "waits", "unavailable"] as const) {
      const index = original[bucket].findIndex(entry => "edge" in entry);
      if (index === -1) continue;
      const missing = structuredClone(original);
      missing[bucket].splice(index, 1);
      assert.throws(() => assertInventory(missing), { name: "AssertionError" }, `${state}/${bucket}: missing`);
      const duplicate = structuredClone(original);
      // Cloning the entire output avoids mutating the machine or invocation table.
      duplicate[bucket].splice(index, 0, duplicate[bucket][index]! as never);
      assert.throws(() => assertInventory(duplicate), { name: "AssertionError" }, `${state}/${bucket}: duplicate`);
    }
    const extra = structuredClone(original);
    const foreign = LEGAL_EDGES.find(edge => edge.from !== state)!;
    extra.waits.push({ edge: foreign.id, to: foreign.to, who: "host" });
    assert.throws(() => assertInventory(extra), { name: "AssertionError" }, `${state}: foreign edge`);
  }
});

test("inventory checks reject actor, executable owner and destination drift", () => {
  for (const state of TASK_STATES) {
    const original = nextSteps(inputFor(state));
    for (const [index, step] of original.steps.entries()) {
      const planted = structuredClone(original);
      planted.steps[index]!.who = step.who === "owner" ? "driver" : "owner";
      assert.throws(() => assertInventory(planted), { name: "AssertionError" });
    }
    for (const [index] of original.waits.entries()) {
      const planted = structuredClone(original);
      Object.assign(planted.waits[index]!, { who: "owner" });
      assert.throws(() => assertInventory(planted), { name: "AssertionError" });
    }
    for (const [index] of original.unavailable.entries()) {
      const planted = structuredClone(original);
      planted.unavailable[index]!.actors = ["human"];
      assert.throws(() => assertInventory(planted), { name: "AssertionError" });
    }
    const wrongDestination = structuredClone(original);
    const entry = [...wrongDestination.steps.filter(step => step.kind === "edge"), ...wrongDestination.waits, ...wrongDestination.unavailable][0];
    if (entry !== undefined) {
      entry.to = TASK_STATES.find(value => value !== entry.to)!;
      assert.throws(() => assertInventory(wrongDestination), { name: "AssertionError" });
    }
  }
});

function assertOwnerParity(commands: readonly string[], main: string, guard: readonly string[]): void {
  const derived = ownerActsIn(main);
  assert.ok(derived.length > 0, "owner-terminal derivation must not be vacuous");
  assert.equal(new Set(commands).size, commands.length);
  assert.deepEqual(new Set(commands), new Set(derived));
  assert.deepEqual(new Set(commands), new Set(guard));
}

test("the current owner-act table equals the main.ts owner-terminal arms and guard", () => {
  const main = readFileSync(join(repoRoot(), "core/src/cli/main.ts"), "utf8");
  assertOwnerParity(OWNER_ACT_COMMANDS, main, OWNER_ACTS);
  // Prove the derivation reads the terminal, not a remembered list or a verb name.
  assert.deepEqual(ownerActsIn('case "invented": { terminal: processOwnerTerminal() } default:'), ["invented"]);
  assert.deepEqual(ownerActsIn('case "land": { readOnly() } default:'), []);
});

test("owner parity rejects a missing or invented act on any of its three surfaces", () => {
  const main = readFileSync(join(repoRoot(), "core/src/cli/main.ts"), "utf8");
  for (const commands of [OWNER_ACT_COMMANDS.slice(1), [...OWNER_ACT_COMMANDS, "invented"], [...OWNER_ACT_COMMANDS, OWNER_ACT_COMMANDS[0]]]) {
    assert.throws(() => assertOwnerParity(commands, main, OWNER_ACTS), { name: "AssertionError" });
  }
  assert.throws(() => assertOwnerParity(OWNER_ACT_COMMANDS, main.replaceAll("processOwnerTerminal()", "readOnly()"), OWNER_ACTS), { name: "AssertionError" });
  assert.throws(() => assertOwnerParity(OWNER_ACT_COMMANDS, `${main}\ncase "invented": processOwnerTerminal(); default:`, OWNER_ACTS), { name: "AssertionError" });
  for (const guard of [OWNER_ACTS.slice(1), [...OWNER_ACTS, "invented"]]) {
    assert.throws(() => assertOwnerParity(OWNER_ACT_COMMANDS, main, guard), { name: "AssertionError" });
  }
});

// Availability is independently pinned, not inferred only from EDGE_INVOCATIONS:
// changing that table to fabricate a caller must not make these checks pass.
function assertUnavailableCorrections(output: NextSteps): void {
  const id = output.state === "GATING" ? "L10" : "L16";
  assert.equal(EDGE_INVOCATIONS[id].kind, "unavailable");
  const entry = output.unavailable.find(value => value.edge === id);
  assert.ok(entry, `${id} must be unavailable`);
  assert.equal(output.steps.some(step => step.kind === "edge" && step.edge === id), false);
  assert.equal(output.waits.some(wait => wait.edge === id), false);
  assert.equal(entry.reason, "not-implemented");
  assert.match(entry.detail, /\S/u);
  assert.deepEqual(entry.actors, LEGAL_EDGES.find(edge => edge.id === id)!.actors);
  for (const property of ["verb", "argv", "who"]) assert.equal(Object.hasOwn(entry, property), false);
}

test("L10 and L16 cannot become fake commands or fake host waits even with complete coverage", () => {
  for (const state of ["GATING", "REVIEWING"] as const) {
    const original = nextSteps(inputFor(state));
    assertUnavailableCorrections(original);
    const edge = original.unavailable[0]!;
    for (const kind of ["command", "wait"] as const) {
      const planted = structuredClone(original);
      planted.unavailable = planted.unavailable.filter(value => value.edge !== edge.edge);
      if (kind === "command") planted.steps.push({ kind: "edge", edge: edge.edge, to: edge.to, verb: "rework", argv: ["awsf", "rework", original.taskId], who: "owner", interactive: true, spendsCalls: true, requires: [] });
      else planted.waits.push({ edge: edge.edge, to: edge.to, who: "host" });
      assertNextSteps(planted); // Structural validity and coverage alone are insufficient.
      assert.throws(() => assertUnavailableCorrections(planted), { name: "AssertionError" });
    }
    const actors = structuredClone(original);
    actors.unavailable[0]!.actors = ["human"];
    assertNextSteps(actors);
    assert.throws(() => assertUnavailableCorrections(actors), { name: "AssertionError" });
  }
});

test("unimplemented task edges remain explanatory and reject executable properties", () => {
  for (const [state, id] of [["GATING", "L10"], ["REVIEWING", "L16"], ["AWAITING_OWNER", "L21"]] as const) {
    const output = nextSteps(inputFor(state));
    const entry = output.unavailable.find(value => value.edge === id)!;
    assert.ok(entry);
    assert.equal(entry.reason, "not-implemented");
    assert.match(entry.detail, /\S/u);
    assert.deepEqual(entry.actors, LEGAL_EDGES.find(edge => edge.id === id)!.actors);
    assert.equal(output.steps.some(step => step.kind === "edge" && step.edge === id), false);
    assert.equal(output.waits.some(wait => wait.edge === id), false);
    for (const property of ["verb", "argv", "who"]) {
      assert.equal(Object.hasOwn(entry, property), false);
      const planted = structuredClone(output);
      Object.assign(planted.unavailable.find(value => value.edge === id)!, { [property]: property === "argv" ? ["awsf", "rework", "fixture-task"] : property === "who" ? "owner" : "rework" });
      assert.throws(() => assertNextSteps(planted), /invalid awsf.next\/v1/u);
    }
    const blank = structuredClone(output);
    blank.unavailable.find(value => value.edge === id)!.detail = " ";
    assert.throws(() => assertNextSteps(blank), /invalid awsf.next\/v1/u);
  }
});

test("next is a registered host record, disjoint from agent-output envelopes", () => {
  assert.equal(RECORD_SCHEMAS[NEXT_STEPS_SCHEMA_ID], NextStepsSchema);
  assert.equal(isEnvelopeSchemaId(NEXT_STEPS_SCHEMA_ID), false);
  assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, NEXT_STEPS_SCHEMA_ID), false);
  for (const state of TASK_STATES) {
    const output = nextSteps(inputFor(state));
    for (const mutate of [
      (value: Record<string, unknown>) => { value.schema = "awsf.next/v2"; },
      (value: Record<string, unknown>) => { value.state = "INVENTED"; },
      (value: Record<string, unknown>) => { value.attempt = 0; },
      (value: Record<string, unknown>) => { value.revision = -1; },
      (value: Record<string, unknown>) => { value.producerStatus = "success"; },
    ]) {
      const planted = structuredClone(output);
      mutate(planted);
      assert.throws(() => assertNextSteps(planted), /invalid awsf.next\/v1/u);
    }
  }
});

test("non-transition acts follow their own command state checks and reads work on terminal states", () => {
  assert.deepEqual(NON_TRANSITION_ACTS.map(act => act.verb), ["preflight", "confirm", "raise", "grant", "journey", "attribute", "status", "watch"]);
  for (const state of TASK_STATES) {
    const acts = nextSteps(inputFor(state)).steps.filter(step => step.kind !== "edge");
    const verbs = acts.map(act => act.verb);
    assert.equal(verbs.includes("preflight"), state === "DRAFT", state);
    assert.equal(verbs.includes("confirm"), state === "DRAFT", state);
    assert.equal(verbs.includes("raise"), !["LANDED", "PUBLISHED", "BLOCKED", "CANCELLED"].includes(state), state);
    assert.equal(verbs.includes("grant"), state === "PREPARED", state);
    assert.equal(verbs.includes("journey"), state === "AWAITING_OWNER", state);
    assert.equal(verbs.includes("attribute"), state === "BLOCKED" || state === "CANCELLED", state);
    assert.ok(verbs.includes("status") && verbs.includes("watch"), state);
    for (const act of acts) {
      // preflight is the driver's act: it measures, and takes no owner terminal.
      const driverAct = act.kind === "read" || act.verb === "preflight";
      assert.equal(act.who, driverAct ? "driver" : "owner");
      assert.equal(act.interactive, !driverAct);
      assert.equal(act.spendsCalls, false);
      assert.equal(Object.hasOwn(act, "edge"), false);
    }
  }
  const grants = (input: NextStepsInput) => nextSteps(input).steps.filter(step => step.verb === "grant");
  for (const kind of ["quota-pause", "completed-phase"]) {
    assert.equal(grants({ ...inputFor("RUNNING"), recovery: { kind }, process: null, budget: { callsReserved: 0 } }).length, 1);
    assert.equal(grants({ ...inputFor("RUNNING"), recovery: { kind }, process: {} }).length, 0);
    assert.equal(grants({ ...inputFor("RUNNING"), recovery: { kind }, budget: { callsReserved: 1 } }).length, 0);
  }
  assert.equal(grants({ ...inputFor("RUNNING"), recovery: { kind: "ceiling-pause" } }).length, 0);
});

test("K1's measured requirements fill only the L1 step's requires, and confirm is the owner's at DRAFT", () => {
  const k1 = [{ check: "K1", field: "suite", status: "failed" }, { check: "K1", field: "confirmation", status: "missing" }];
  for (const state of TASK_STATES) {
    const output = nextSteps({ ...inputFor(state), k1 });
    assert.equal(Value.Check(NextStepsSchema, output), true, state);
    for (const step of output.steps) {
      assert.deepEqual(step.requires, step.kind === "edge" && step.edge === "L1" ? k1 : [], `${state}/${step.verb}`);
    }
  }
  const draft = nextSteps({ ...inputFor("DRAFT"), k1 });
  const confirm = draft.steps.find(step => step.verb === "confirm")!;
  assert.deepEqual([confirm.kind, confirm.who, confirm.interactive, confirm.spendsCalls], ["act", "owner", true, false]);
  // Unmeasured is not satisfied, and never invents a requirement.
  assert.deepEqual(nextSteps(inputFor("DRAFT")).steps.find(step => step.verb === "start")!.requires, []);
  // The model shares no array with its input.
  draft.steps.find(step => step.verb === "start")!.requires.pop();
  assert.equal(k1.length, 2);
});

test("an owed protected grant names its phase and planned paths on the owner's grant step, and only where grant is legal", () => {
  const grantOwed = { phase: "documenter", paths: ["docs/driving/**", "README.md"] };
  const legal: NextStepsInput[] = [{ ...inputFor("PREPARED"), grantOwed },
    { ...inputFor("RUNNING"), recovery: { kind: "completed-phase" }, process: null, budget: { callsReserved: 0 }, grantOwed }];
  for (const input of legal) {
    const output = nextSteps(input);
    assert.equal(Value.Check(NextStepsSchema, output), true, input.state);
    const grant = output.steps.filter(step => step.verb === "grant");
    assert.equal(grant.length, 1, input.state);
    assert.deepEqual([grant[0]!.kind, grant[0]!.who, grant[0]!.interactive, grant[0]!.spendsCalls], ["act", "owner", true, false]);
    // The phase is filled; the files stay the owner's to choose.
    assert.deepEqual(grant[0]!.argv.slice(-6), ["--phase", "documenter", "--file", "<path>", "--reason", "<why>"]);
    assert.deepEqual(grant[0]!.requires, [
      { check: "protected-paths", field: "docs/driving/**", status: "ungranted for documenter" },
      { check: "protected-paths", field: "README.md", status: "ungranted for documenter" },
    ]);
    for (const step of output.steps.filter(step => step.verb !== "grant")) assert.deepEqual(step.requires, [], `${input.state}/${step.verb}`);
  }
  // An owed grant never makes grant legal where its own command refuses it.
  assert.equal(nextSteps({ ...inputFor("RUNNING"), grantOwed }).steps.some(step => step.verb === "grant"), false);
  assert.equal(nextSteps({ ...inputFor("RUNNING"), recovery: { kind: "completed-phase" }, budget: { callsReserved: 1 }, grantOwed }).steps.some(step => step.verb === "grant"), false);
  // Absent or null stays the generic step.
  for (const owed of [undefined, null]) {
    const generic = nextSteps({ ...inputFor("PREPARED"), ...(owed === undefined ? {} : { grantOwed: owed }) }).steps.find(step => step.verb === "grant")!;
    assert.deepEqual(generic.argv.slice(-6), ["--phase", "<phase>", "--file", "<path>", "--reason", "<why>"]);
    assert.deepEqual(generic.requires, []);
  }
});

test("the next action names the owed grant before run at PREPARED and before resume at a completed-phase boundary", () => {
  const grantOwed = { phase: "builder", paths: ["core/src/state/**"] };
  const prepared = renderNextAction(nextSteps({ ...inputFor("PREPARED"), grantOwed }));
  assert.match(prepared, /^run is refused until builder's protected grant covers core\/src\/state\/\*\*; run `awsf run fixture-task /);
  assert.match(prepared, /`awsf grant fixture-task --project fixture-project --attempt 2 --phase builder --file '<path>' --reason '<why>'`/);
  const boundary = { ...inputFor("RUNNING"), recovery: { kind: "completed-phase" }, process: null, budget: { callsReserved: 0 } };
  assert.match(renderNextAction(nextSteps({ ...boundary, grantOwed }), boundary),
    /^completed-phase; builder owes a protected grant for core\/src\/state\/\*\*: the owner decides on `awsf grant .*--phase builder .*`, then run `awsf resume fixture-task /);
  assert.equal(renderNextAction(nextSteps(boundary), boundary).startsWith("completed-phase; run `awsf resume"), true, "nothing owed leaves the advice unchanged");
  assert.doesNotMatch(renderNextAction(nextSteps(inputFor("PREPARED"))), /refused/);
});

test("a phase's one recorded grant that misses a planned path lists no grant step and the next action says it cannot be widened", () => {
  const grantOwed = { phase: "builder", paths: ["core/src/state/**"], grantId: "g-1" };
  const grantUnwidenable = { phase: "builder", grantId: "g-1", paths: grantOwed.paths };
  const boundary = { ...inputFor("RUNNING"), recovery: { kind: "completed-phase" }, process: null, budget: { callsReserved: 0 } };
  for (const input of [inputFor("PREPARED"), boundary]) {
    const model = nextSteps({ ...input, grantOwed });
    assert.equal(Value.Check(NextStepsSchema, model), true, input.state);
    assert.equal(model.steps.some(step => step.verb === "grant"), false, `${input.state} lists no grant step`);
    const action = renderNextAction(model, { ...input, grantUnwidenable });
    assert.match(action, /builder's protected grant misses core\/src\/state\/\*\*/);
    assert.ok(action.includes("the recorded grant g-1 is builder's one grant and cannot be widened on this attempt"), action);
    assert.doesNotMatch(action, /awsf grant|owes a protected grant|covers/);
  }
  // A grant that is merely owed (no recorded id) keeps its step.
  assert.equal(nextSteps({ ...inputFor("PREPARED"), grantOwed: { ...grantOwed, grantId: null } }).steps.some(step => step.verb === "grant"), true);
});

test("the grant refusal advice names the owner's grant and the step that follows, and never offers to widen a recorded grant", () => {
  const selector = { project: "fixture-project", taskId: "fixture-task", attempt: 2 };
  assert.equal(renderGrantRefusalAdvice(selector, { phase: "builder", grantId: null }, "before-l4"),
    "the owner decides on `awsf grant fixture-task --project fixture-project --attempt 2 --phase builder --file '<path>' --reason '<why>'` at an interactive terminal; " +
    "then run `awsf run fixture-task --project fixture-project --attempt 2`");
  assert.match(renderGrantRefusalAdvice(selector, { phase: "documenter", grantId: null }, "phase-boundary"),
    /--phase documenter .* at an interactive terminal; then run `awsf resume fixture-task --project fixture-project --attempt 2 --reason '<why>'`$/);
  const widened = renderGrantRefusalAdvice(selector, { phase: "builder", grantId: "g-1" }, "before-l4");
  assert.equal(widened, "the recorded grant g-1 is builder's one grant and cannot be widened on this attempt");
  assert.doesNotMatch(widened, /awsf grant/);
});

test("cancel advice carries cause and reason placeholders on every implemented cancel edge", () => {
  for (const edge of LEGAL_EDGES.filter(edge => edge.to === "CANCELLED")) {
    const step = nextSteps(inputFor(edge.from)).steps.find(step => step.kind === "edge" && step.edge === edge.id)!;
    assert.equal(step.verb, "cancel");
    assert.deepEqual(step.argv.slice(-4), ["--cause", "<cause>", "--reason", "<why>"]);
  }
});

test("nextSteps is deterministic, does not mutate input and does not share mutable output arrays", () => {
  const input = Object.freeze(inputFor("GATING"));
  const output = nextSteps(input);
  const saved = structuredClone(output);
  assert.deepEqual(nextSteps(input), saved);
  output.unavailable[0]!.actors.pop();
  output.steps[0]!.requires.push({ check: "K1", field: "confirmation", status: "missing" });
  output.steps[0]!.argv.push("invented");
  output.waits.pop();
  assert.deepEqual(nextSteps(input), saved);
  assert.deepEqual(input, inputFor("GATING"));
});
