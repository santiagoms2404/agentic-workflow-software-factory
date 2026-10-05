import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Value } from "@sinclair/typebox/value";
import { assertNextSteps, NEXT_STEPS_SCHEMA_ID, NextStepsSchema } from "../../src/contracts/next-steps.ts";
import { ENVELOPE_SCHEMAS, RECORD_SCHEMAS, isEnvelopeSchemaId } from "../../src/contracts/registry.ts";
import { EDGE_INVOCATIONS, NON_TRANSITION_ACTS, OWNER_ACT_COMMANDS, nextSteps, type NextStepsInput } from "../../src/lifecycle/next-steps.ts";
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

test("next steps partition the machine edges exactly once and validate for every state", () => {
  assert.deepEqual(Object.keys(EDGE_INVOCATIONS).sort(), LEGAL_EDGES.map(edge => edge.id).sort());
  for (const state of TASK_STATES) {
    const output = nextSteps(inputFor(state));
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
        assert.deepEqual(output.unavailable.find(value => value.edge === edge.id)?.actors, edge.actors);
      }
    }
    for (const step of output.steps) {
      assert.deepEqual(step.requires, []);
      assert.deepEqual(step.argv.slice(0, 7), ["awsf", step.verb, output.taskId, "--project", output.project, "--attempt", String(output.attempt)]);
    }
  }
});

test("the current owner-act table equals the main.ts owner-terminal arms without duplicates", () => {
  const main = readFileSync(join(repoRoot(), "core/src/cli/main.ts"), "utf8");
  const derived = ownerActsIn(main);
  assert.ok(derived.length > 0);
  assert.equal(new Set(OWNER_ACT_COMMANDS).size, OWNER_ACT_COMMANDS.length);
  assert.deepEqual([...OWNER_ACT_COMMANDS].sort(), derived.sort());
  // Prove the derivation reads the terminal, not a remembered list or a verb name.
  assert.deepEqual(ownerActsIn('case "invented": { terminal: processOwnerTerminal() } default:'), ["invented"]);
  assert.deepEqual(ownerActsIn('case "land": { readOnly() } default:'), []);
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
  assert.deepEqual(NON_TRANSITION_ACTS.map(act => act.verb), ["raise", "grant", "journey", "attribute", "status", "watch"]);
  for (const state of TASK_STATES) {
    const acts = nextSteps(inputFor(state)).steps.filter(step => step.kind !== "edge");
    const verbs = acts.map(act => act.verb);
    assert.equal(verbs.includes("raise"), !["LANDED", "PUBLISHED", "BLOCKED", "CANCELLED"].includes(state), state);
    assert.equal(verbs.includes("grant"), state === "PREPARED", state);
    assert.equal(verbs.includes("journey"), state === "AWAITING_OWNER", state);
    assert.equal(verbs.includes("attribute"), state === "BLOCKED" || state === "CANCELLED", state);
    assert.ok(verbs.includes("status") && verbs.includes("watch"), state);
    for (const act of acts) {
      assert.equal(act.who, act.kind === "read" ? "driver" : "owner");
      assert.equal(act.interactive, act.kind !== "read");
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
