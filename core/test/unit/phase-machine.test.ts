// T5 — the phase submachine.
//
// The task matrix (T4's five suites) is the contract for the ten task states.
// This is the contract for what happens INSIDE a phase, and its load-bearing
// rule is the one the plan states in capitals: CORRECTING → RUNNING must
// resume the SAME adapter, provider, model and provider session. "No cold
// restart disguised as a correction."
//
// The edges are transcribed from the plan's phase-submachine diagram, not read
// back out of `phase-machine.ts`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CORRECTABLE_CAUSES,
  PHASE_CANCELLABLE_STATES,
  PHASE_STATES,
  PHASE_TERMINAL_STATES,
  UNCORRECTABLE_CAUSES,
  initialPhaseState,
  isPhaseTerminal,
  phaseTransition,
  settleAbnormalExit,
  type PhaseCause,
  type PhaseSession,
  type PhaseState,
  type PhaseTransitionInput,
} from "../../src/state/phase-machine.ts";
import {
  CorrectionAllowanceExhausted,
  IllegalPhaseTransition,
  SessionIdentityBroken,
  UncorrectableViolation,
} from "../../src/state/errors.ts";

/** The diagram, transcribed by hand. Twelve edges, and no thirteenth. */
const LEGAL_PHASE_EDGES: readonly (readonly [PhaseState, PhaseState])[] = [
  ["QUEUED", "RUNNING"],
  ["QUEUED", "SKIPPED"],
  ["RUNNING", "VALIDATING"],
  ["RUNNING", "FAILED"],
  ["VALIDATING", "SUCCEEDED"],
  ["VALIDATING", "CORRECTING"],
  ["VALIDATING", "FAILED"],
  ["CORRECTING", "RUNNING"],
  ["QUEUED", "CANCELLED"],
  ["RUNNING", "CANCELLED"],
  ["VALIDATING", "CANCELLED"],
  ["CORRECTING", "CANCELLED"],
];

const SESSION: PhaseSession = {
  adapter: "claude-code",
  provider: "anthropic",
  model: "claude-opus-4",
  sessionId: "01J8Z5Q7WQ0000000000000000",
};

/**
 * Runs `call` expecting it to throw `ctor`, and returns the NARROWED error.
 *
 * `assert.ok(x instanceof C)` cannot narrow here: `node:assert` has no type
 * declarations in this workspace (see T1's amendment), so `assert` is `any`
 * and its assertion signature is lost. A plain `if` does the narrowing that
 * `tsc` will actually believe.
 */
function expectThrown<E extends Error>(
  ctor: new (...args: never[]) => E,
  call: () => unknown,
): E {
  let thrown: unknown;
  try {
    call();
  } catch (error) {
    thrown = error;
  }
  if (thrown === undefined) throw new Error(`expected ${ctor.name}, but nothing was thrown`);
  if (!(thrown instanceof ctor)) {
    throw new Error(`expected ${ctor.name}, got ${String(thrown)}`);
  }
  return thrown;
}

const identityBreak = (call: () => unknown): SessionIdentityBroken =>
  expectThrown(SessionIdentityBroken, call);
const exhaustion = (call: () => unknown): CorrectionAllowanceExhausted =>
  expectThrown(CorrectionAllowanceExhausted, call);

function input(overrides: Partial<PhaseTransitionInput> = {}): PhaseTransitionInput {
  return {
    phase: "builder",
    from: "QUEUED",
    to: "RUNNING",
    session: SESSION,
    corrections: { auto: 0, owner: 0 },
    allowance: { auto: 1, owner: 1 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The edge list.
// ---------------------------------------------------------------------------

test("the submachine has the plan's eight phase states", () => {
  assert.deepEqual(
    [...PHASE_STATES],
    ["QUEUED", "RUNNING", "VALIDATING", "CORRECTING", "SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED"],
  );
  assert.deepEqual([...PHASE_TERMINAL_STATES], ["SUCCEEDED", "FAILED", "SKIPPED", "CANCELLED"]);
  assert.deepEqual([...PHASE_CANCELLABLE_STATES], ["QUEUED", "RUNNING", "VALIDATING", "CORRECTING"]);
});

test("exactly the twelve diagrammed edges are accepted, and the other fifty-two are not", () => {
  const legal = new Set(LEGAL_PHASE_EDGES.map(([from, to]) => `${from}->${to}`));
  assert.equal(legal.size, 12);

  const accepted: string[] = [];
  for (const from of PHASE_STATES) {
    for (const to of PHASE_STATES) {
      // Give every probe what a legal edge of that shape would need, so a
      // refusal is about the PAIR and never about a missing cause or session.
      const probe = input({
        from,
        to,
        cause: "gate-violation",
        actor: "host",
      });
      try {
        phaseTransition(probe);
        accepted.push(`${from}->${to}`);
      } catch (error) {
        if (!legal.has(`${from}->${to}`)) {
          assert.ok(
            error instanceof IllegalPhaseTransition,
            `${from}->${to} must be refused as an illegal pair, got ${(error as Error).name}`,
          );
        } else {
          throw error;
        }
      }
    }
  }
  assert.deepEqual(accepted.sort(), [...legal].sort());
  assert.equal(PHASE_STATES.length * PHASE_STATES.length - accepted.length, 52);
});

test("no edge leaves a terminal phase state", () => {
  for (const from of PHASE_TERMINAL_STATES) {
    assert.ok(isPhaseTerminal(from));
    for (const to of PHASE_STATES) {
      assert.throws(() => phaseTransition(input({ from, to, cause: "gate-violation" })), IllegalPhaseTransition);
    }
  }
});

// ---------------------------------------------------------------------------
// Success is earned.
// ---------------------------------------------------------------------------

test("a phase is constructed FAILED-equivalent — it starts QUEUED and settles to FAILED", () => {
  assert.equal(initialPhaseState(), "QUEUED");
  for (const from of ["QUEUED", "RUNNING", "VALIDATING", "CORRECTING"] as const) {
    assert.equal(settleAbnormalExit(from), "FAILED", `${from} must not settle as anything but a failure`);
  }
  // A phase that already settled keeps its verdict: an abnormal exit AFTER
  // success is the host's problem, not a retroactive failure of the phase.
  for (const from of PHASE_TERMINAL_STATES) {
    assert.equal(settleAbnormalExit(from), from);
  }
});

test("only a clean exit through VALIDATING reaches SUCCEEDED", () => {
  const reachSucceeded = PHASE_STATES.filter((from) => {
    try {
      phaseTransition(input({ from, to: "SUCCEEDED" }));
      return true;
    } catch {
      return false;
    }
  });
  assert.deepEqual(reachSucceeded, ["VALIDATING"]);
  const result = phaseTransition(input({ from: "VALIDATING", to: "SUCCEEDED" }));
  assert.equal(result.terminal, true);
  assert.equal(result.correctionTranche, null);
});

// ---------------------------------------------------------------------------
// CORRECTING → RUNNING: same session, or it is not a correction.
// ---------------------------------------------------------------------------

test("CORRECTING -> RUNNING resumes the identical session", () => {
  const result = phaseTransition(input({ from: "CORRECTING", to: "RUNNING", resumeSession: { ...SESSION } }));
  assert.deepEqual(result.session, SESSION);
  assert.equal(result.terminal, false);
  // Absent an explicit resume session, the phase stays bound to the one it has.
  assert.deepEqual(phaseTransition(input({ from: "CORRECTING", to: "RUNNING" })).session, SESSION);
});

test("a correction that changes ANY of adapter, provider, model or session id is a cold restart", () => {
  const drifts: readonly (readonly [string, PhaseSession])[] = [
    ["adapter", { ...SESSION, adapter: "codex" }],
    ["provider", { ...SESSION, provider: "openai" }],
    ["model", { ...SESSION, model: "claude-sonnet-4" }],
    ["sessionId", { ...SESSION, sessionId: "01J8Z5Q7WQ1111111111111111" }],
  ];
  for (const [field, resumeSession] of drifts) {
    const broken = identityBreak(() =>
      phaseTransition(input({ from: "CORRECTING", to: "RUNNING", resumeSession })),
    );
    assert.equal(broken.name, "SessionIdentityBroken", `a changed ${field} must not pass as a correction`);
    assert.equal(broken.differences.length, 1);
    assert.match(broken.differences[0] ?? "", new RegExp(`^${field} `));
  }
});

test("all four fields changing at once is reported as all four", () => {
  const broken = identityBreak(() =>
    phaseTransition(
      input({
        from: "CORRECTING",
        to: "RUNNING",
        resumeSession: { adapter: "codex", provider: "openai", model: "gpt", sessionId: "other" },
      }),
    ),
  );
  assert.equal(broken.differences.length, 4);
});

test("the identity rule binds only the resume — a fresh QUEUED -> RUNNING may be any session", () => {
  const result = phaseTransition(
    input({ from: "QUEUED", to: "RUNNING", resumeSession: { ...SESSION, model: "claude-haiku-4-5" } }),
  );
  assert.equal(result.to, "RUNNING");
});

// ---------------------------------------------------------------------------
// What is correctable, and what blocks immediately.
// ---------------------------------------------------------------------------

test("invalid JSON and gate violations share one allowance; breaches and transport faults do not", () => {
  assert.deepEqual([...CORRECTABLE_CAUSES], ["schema-violation", "gate-violation"]);
  for (const cause of CORRECTABLE_CAUSES) {
    const result = phaseTransition(input({ from: "VALIDATING", to: "CORRECTING", cause, actor: "host" }));
    assert.equal(result.correctionTranche, "auto");
  }
  for (const cause of UNCORRECTABLE_CAUSES) {
    assert.throws(
      () => phaseTransition(input({ from: "VALIDATING", to: "CORRECTING", cause, actor: "host" })),
      UncorrectableViolation,
      `${cause} must never be corrected`,
    );
  }
});

test("a correction with no named cause is not a correction", () => {
  assert.throws(
    () => phaseTransition(input({ from: "VALIDATING", to: "CORRECTING", actor: "host" })),
    UncorrectableViolation,
  );
});

test("an uncorrectable fault still reaches FAILED directly from RUNNING", () => {
  for (const cause of UNCORRECTABLE_CAUSES) {
    const result = phaseTransition(input({ from: "RUNNING", to: "FAILED", cause }));
    assert.equal(result.terminal, true);
  }
});

// ---------------------------------------------------------------------------
// The allowance — and the road out when it is gone.
// ---------------------------------------------------------------------------

test("the host draws the automatic tranche and the owner draws the owner tranche", () => {
  const correcting = { from: "VALIDATING", to: "CORRECTING", cause: "gate-violation" } as const;
  assert.equal(phaseTransition(input({ ...correcting, actor: "host" })).correctionTranche, "auto");
  assert.equal(phaseTransition(input({ ...correcting, actor: "owner" })).correctionTranche, "owner");
  assert.equal(phaseTransition(input({ ...correcting, actor: "human" })).correctionTranche, "owner");
});

test("a spent tranche refuses the correction, and the whole budget says so", () => {
  const correcting = { from: "VALIDATING", to: "CORRECTING", cause: "gate-violation" } as const;

  // The host's automatic correction is spent; the owner's is not.
  assert.equal(
    exhaustion(() => phaseTransition(input({ ...correcting, actor: "host", corrections: { auto: 1, owner: 0 } }))).scope,
    "tranche",
  );
  // ...and the owner can still authorize rung 3.
  assert.equal(
    phaseTransition(input({ ...correcting, actor: "owner", corrections: { auto: 1, owner: 0 } })).correctionTranche,
    "owner",
  );

  // Both gone: no actor can restore it, and that is the global complaint.
  for (const actor of ["host", "owner", "human"] as const) {
    assert.equal(
      exhaustion(() => phaseTransition(input({ ...correcting, actor, corrections: { auto: 1, owner: 1 } }))).scope,
      "global",
      `switching to ${actor} cannot restore a spent budget`,
    );
  }
});

test("VALIDATING -> FAILED is the road out once the budget is spent — it feeds L8 / L13", () => {
  const result = phaseTransition(
    input({
      from: "VALIDATING",
      to: "FAILED",
      cause: "gate-violation",
      corrections: { auto: 1, owner: 1 },
    }),
  );
  assert.equal(result.to, "FAILED");
  assert.equal(result.terminal, true);
});

test("the allowance is data, not a constant", () => {
  const correcting = { from: "VALIDATING", to: "CORRECTING", cause: "gate-violation", actor: "host" } as const;
  assert.equal(
    phaseTransition(input({ ...correcting, corrections: { auto: 1, owner: 0 }, allowance: { auto: 2, owner: 1 } }))
      .correctionTranche,
    "auto",
  );
  assert.throws(
    () => phaseTransition(input({ ...correcting, corrections: { auto: 2, owner: 0 }, allowance: { auto: 2, owner: 1 } })),
    CorrectionAllowanceExhausted,
  );
});

// ---------------------------------------------------------------------------
// Cancellation.
// ---------------------------------------------------------------------------

test("a human cancel reaches CANCELLED from all four live states and nowhere else", () => {
  for (const from of PHASE_CANCELLABLE_STATES) {
    const result = phaseTransition(input({ from, to: "CANCELLED" }));
    assert.equal(result.terminal, true);
    assert.equal(result.correctionTranche, null);
  }
  for (const from of PHASE_TERMINAL_STATES) {
    assert.throws(() => phaseTransition(input({ from, to: "CANCELLED" })), IllegalPhaseTransition);
  }
});

// ---------------------------------------------------------------------------
// Purity.
// ---------------------------------------------------------------------------

test("phaseTransition mutates nothing it is given", () => {
  const corrections = { auto: 0, owner: 0 };
  const session = { ...SESSION };
  const request = input({ from: "VALIDATING", to: "CORRECTING", cause: "gate-violation", actor: "host", corrections, session });
  phaseTransition(request);
  assert.deepEqual(corrections, { auto: 0, owner: 0 }, "the caller counts the spend, not the machine");
  assert.deepEqual(session, SESSION);
});

test("every cause the module names is one of the two closed lists", () => {
  const all: readonly PhaseCause[] = [...CORRECTABLE_CAUSES, ...UNCORRECTABLE_CAUSES];
  assert.equal(new Set(all).size, all.length, "a cause may not be both correctable and not");
});
