// T4 — the actor matrix, the human gate, the correction tranches, and the
// closed evidence allowlist.
//
// Three actors: host, owner, human (`transitions.actor` in the DDL). The
// L-table's Actor column is read LITERALLY — no widening, no "a human can do
// anything an owner can". The one edge that decides whether this system is
// trustworthy is L20: `AWAITING_OWNER → LANDING` is reachable by a human at an
// interactive terminal and by nothing else.
//
// RED until T5 writes `core/src/state/{task-machine,errors}.ts`.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACTORS,
  ACTOR_TRANCHE,
  CORRECTION_EDGES,
  DETERMINISTIC_REASON_SOURCES,
  LEGAL_EDGES,
  NON_DETERMINISTIC_REASON_SOURCES,
  edge,
  type Actor,
  type EdgeId,
} from "./_lifecycle-tables.ts";
import {
  budget,
  expectAccepted,
  expectRejection,
  inputFor,
  matrixInput,
  stateErrors,
  validInput,
  withBudget,
  withReason,
} from "./_lifecycle-harness.ts";

// ---------------------------------------------------------------------------
// The matrix.
// ---------------------------------------------------------------------------

test("every legal edge accepts exactly the actors its L-table row names", async () => {
  const failures: string[] = [];
  for (const e of LEGAL_EDGES) {
    for (const actor of ACTORS) {
      const permitted = e.actors.includes(actor);
      // `interactive: true` throughout, so a refusal here is about WHO, never
      // about the medium — step 7 isolated from step 8.
      const input = inputFor(e.id, { actor, interactive: true });
      if (permitted) {
        try {
          const result = await expectAccepted(input);
          if (result.actor !== actor) failures.push(`${e.id}: result reports actor ${result.actor}, sent ${actor}`);
        } catch (error) {
          failures.push(`${e.id} should accept ${actor}: ${(error as Error).message}`);
        }
      } else {
        try {
          await expectRejection("ActorNotPermitted", input, { because: `${e.id} permits ${e.actors.join("/")}` });
        } catch (error) {
          failures.push((error as Error).message);
        }
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("the host owns fifteen edges, the human nine, and the owner three", () => {
  // A sanity check on the transcription itself: if the Actor column drifted,
  // the matrix test above would start passing for the wrong reason.
  const byActor = (actor: Actor) => LEGAL_EDGES.filter((e) => e.actors.includes(actor)).map((e) => e.id);
  assert.deepEqual(byActor("host"), [
    "L1", "L2", "L4", "L5", "L7", "L8", "L10", "L11",
    "L12", "L13", "L15", "L17", "L21", "L23", "L24",
  ]);
  // L10 is shared with the host, L16 is the owner's alone, and L25 is shared
  // with the human — a replacement review is an owner act either way, and the
  // tranche map sends both to the same allowance.
  assert.deepEqual(byActor("owner"), ["L10", "L16", "L25"]);
  assert.deepEqual(byActor("human"), ["L3", "L6", "L9", "L14", "L18", "L19", "L20", "L22", "L25"]);
});

// ---------------------------------------------------------------------------
// The human gate — L20.
// ---------------------------------------------------------------------------

test("L20 refuses the host and the owner outright — landing is not delegable", async () => {
  for (const actor of ["host", "owner"] as const) {
    await expectRejection("ActorNotPermitted", inputFor("L20", { actor, interactive: true }), {
      because: "only a human may land",
    });
    // And still refuses them when there is no terminal at all: the actor is
    // the complaint, not the medium.
    await expectRejection("ActorNotPermitted", inputFor("L20", { actor, interactive: false }), {
      because: "only a human may land",
    });
  }
});

test("L20 refuses a human on piped stdin — `awsf land` demands a terminal", async () => {
  await expectRejection("InteractiveOwnerRequired", inputFor("L20", { interactive: false }), {
    because: "the human gate is a TTY gate",
  });
});

test("L20 accepts a human at a terminal with the candidate displayed and confirmed", async () => {
  const result = await expectAccepted(validInput("L20"));
  assert.equal(result.edge, "L20");
  assert.equal(result.actor, "human");
  assert.equal(result.to, "LANDING");
  // Landing spawns nothing; it is a fast-forward, not a call.
  assert.equal(result.spawnSite, false);
  assert.equal(result.spends.calls, 0);
});

test("every human edge demands an interactive session; no host edge does", async () => {
  const failures: string[] = [];
  for (const e of LEGAL_EDGES) {
    const input = inputFor(e.id, { interactive: false });
    if (e.interactive) {
      try {
        await expectRejection("InteractiveOwnerRequired", input, { because: `${e.id} is a human edge` });
      } catch (error) {
        failures.push((error as Error).message);
      }
    } else {
      try {
        await expectAccepted(input);
      } catch (error) {
        failures.push(`${e.id} must not require a TTY: ${(error as Error).message}`);
      }
    }
  }
  assert.deepEqual(failures, []);
  assert.deepEqual(
    LEGAL_EDGES.filter((e) => e.interactive).map((e) => e.id),
    ["L3", "L6", "L9", "L14", "L18", "L19", "L20", "L22", "L25"],
  );
});

// ---------------------------------------------------------------------------
// L16 and L19 — rework is an owner's decision, never the host's.
// ---------------------------------------------------------------------------

test("L16 and L19 throw for the host — a machine may not decide its own work was wrong", async () => {
  await expectRejection("ActorNotPermitted", inputFor("L16", { actor: "host" }));
  await expectRejection("ActorNotPermitted", inputFor("L19", { actor: "host" }));
});

test("L25 and L19 share one owner re-entry allowance — D3's tranche coupling, provable", async () => {
  // "One owner-authorized re-entry of EITHER KIND per attempt." After a
  // replacement review, an L19 rework is refused as exhausted, and the reverse
  // holds too. If the two drew separate counters this would pass for free.
  const replacement = await expectAccepted(validInput("L25"));
  assert.equal(replacement.spends.correctionTranche, "owner");

  const spent = { ownerReentries: 1 };
  await expectRejection("CorrectionAllowanceExhausted", withBudget("L19", spent), {
    scope: "tranche",
    because: "a replacement review already spent the attempt's one owner re-entry",
  });
  await expectRejection("CorrectionAllowanceExhausted", withBudget("L25", spent), {
    scope: "tranche",
    because: "an owner rework already spent the attempt's one owner re-entry",
  });
});

test("L16 is the owner's edge and L19 is the human's — the Actor column read literally", async () => {
  assert.deepEqual(edge("L16").actors, ["owner"]);
  assert.deepEqual(edge("L19").actors, ["human"]);
  await expectAccepted(inputFor("L16", { actor: "owner" }));
  await expectAccepted(inputFor("L19", { actor: "human" }));
  await expectRejection("ActorNotPermitted", inputFor("L16", { actor: "human", interactive: true }));
  await expectRejection("ActorNotPermitted", inputFor("L19", { actor: "owner", interactive: true }));
});

// ---------------------------------------------------------------------------
// Tranches.
// ---------------------------------------------------------------------------

test("the host draws the automatic tranche and the owner draws the owner tranche", async () => {
  assert.deepEqual(ACTOR_TRANCHE, { host: "auto", owner: "owner", human: "owner" });
  const failures: string[] = [];
  for (const id of CORRECTION_EDGES) {
    for (const actor of edge(id).actors) {
      try {
        const result = await expectAccepted(inputFor(id, { actor }));
        const expected = ACTOR_TRANCHE[actor];
        if (result.spends.correctionTranche !== expected) {
          failures.push(`${id} by ${actor}: drew ${String(result.spends.correctionTranche)}, expected ${expected}`);
        }
      } catch (error) {
        failures.push(`${id} by ${actor}: ${(error as Error).message}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("no edge outside L10/L16/L19/L25 draws a correction tranche", async () => {
  const failures: string[] = [];
  const others = LEGAL_EDGES.filter((e) => !(CORRECTION_EDGES as readonly string[]).includes(e.id));
  assert.equal(others.length, 21);
  for (const e of others) {
    try {
      const result = await expectAccepted(validInput(e.id));
      if (result.spends.correctionTranche !== null) {
        failures.push(`${e.id} drew the ${String(result.spends.correctionTranche)} tranche`);
      }
    } catch (error) {
      failures.push(`${e.id}: ${(error as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("L10's first correction is the host's and its second is the owner's", async () => {
  // auto: 1, ownerReentries: 1. The host spends the automatic tranche once; the
  // second inter-state correction on the same task must be authorized by the
  // owner, and it draws the attempt-scoped re-entry allowance.
  const first = await expectAccepted(withBudget("L10", { correctionsAuto: 0, ownerReentries: 0 }));
  assert.equal(first.spends.correctionTranche, "auto");

  await expectRejection(
    "CorrectionAllowanceExhausted",
    withBudget("L10", { correctionsAuto: 1, ownerReentries: 0 }),
    { scope: "tranche", because: "the host's tranche is spent" },
  );

  const second = await expectAccepted({
    ...withBudget("L10", { correctionsAuto: 1, ownerReentries: 0 }),
    actor: "owner",
  });
  assert.equal(second.spends.correctionTranche, "owner");
});

test("a TASK edge's owner tranche is the attempt-scoped re-entry counter, not the per-phase one", async () => {
  // The whole point of the split. A phase that already spent its intra-phase
  // owner correction has NOT spent the owner's re-entry, and an owner re-entry
  // already drawn is not handed back by a later phase.
  const perPhaseSpent = await expectAccepted({
    ...withBudget("L10", { correctionsOwner: 1, ownerReentries: 0 }),
    actor: "owner",
  });
  assert.equal(perPhaseSpent.spends.correctionTranche, "owner");

  await expectRejection(
    "CorrectionAllowanceExhausted",
    { ...withBudget("L10", { correctionsOwner: 0, ownerReentries: 1 }), actor: "owner" },
    { scope: "tranche", because: "the re-entry allowance is what an owner-authorized task edge draws" },
  );
});

test("with both tranches spent, no actor can correct — and hears the global complaint", async () => {
  const spent = { correctionsAuto: 1, ownerReentries: 1 };
  for (const actor of ["host", "owner"] as const) {
    await expectRejection(
      "CorrectionAllowanceExhausted",
      { ...withBudget("L10", spent), actor },
      { scope: "global", because: "switching actors cannot restore a spent global budget" },
    );
  }
});

test("a larger configured allowance is honored — the tranche is data, not a constant", async () => {
  // `risk.correction_allowance` is configuration; the machine must read it
  // rather than hard-code {auto: 1, owner: 1}.
  const generous = budget({ correctionsAuto: 1, ownerReentries: 0, allowance: { auto: 2 } });
  const result = await expectAccepted({ ...validInput("L10"), budget: generous });
  assert.equal(result.spends.correctionTranche, "auto");

  await expectRejection(
    "CorrectionAllowanceExhausted",
    { ...validInput("L10"), budget: budget({ correctionsAuto: 2, ownerReentries: 0, allowance: { auto: 2 } }) },
    { scope: "tranche" },
  );

  // And the same for the re-entry allowance, which is its own configured number.
  await expectAccepted({
    ...validInput("L10"),
    actor: "owner",
    budget: budget({ ownerReentries: 1, allowance: { ownerReentries: 2 } }),
  });
  await expectRejection(
    "CorrectionAllowanceExhausted",
    { ...validInput("L10"), actor: "owner", budget: budget({ ownerReentries: 2, allowance: { ownerReentries: 2 } }) },
    { scope: "tranche" },
  );
});

// ---------------------------------------------------------------------------
// The closed evidence allowlist.
// ---------------------------------------------------------------------------

test("the module's deterministic source allowlist is exactly the plan's six", async () => {
  const errors = await stateErrors();
  assert.deepEqual([...errors.DETERMINISTIC_REASON_SOURCES].sort(), [...DETERMINISTIC_REASON_SOURCES].sort());
  assert.equal(errors.DETERMINISTIC_REASON_SOURCES.length, 6);
});

test("every conversational, clock-driven or mis-cased reason source throws NonDeterministicEvidence", async () => {
  // Including the near-misses: an allowlist is exact membership. "HUMAN" and
  // " git" are not on it, and a machine that trims and lower-cases its way to
  // acceptance has a hole a prompt can drive through.
  const probes: readonly EdgeId[] = ["L1", "L4", "L7", "L10", "L16", "L20", "L21", "L23"];
  const failures: string[] = [];
  for (const source of NON_DETERMINISTIC_REASON_SOURCES) {
    for (const id of probes) {
      try {
        await expectRejection("NonDeterministicEvidence", withReason(id, { source }), {
          because: `${id} with reason.source ${JSON.stringify(source)}`,
        });
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("a missing reason source is as non-deterministic as a fabricated one", async () => {
  const input = validInput("L7");
  const reason = { ...input.reason };
  delete (reason as Partial<typeof reason>).source;
  await expectRejection(
    "NonDeterministicEvidence",
    { ...input, reason },
    { because: "no source at all" },
  );
});

test("each of the six allowlisted sources clears step 1", async () => {
  // Proven on an ILLEGAL pair: whatever fires must be the pair complaint, which
  // is only reachable once step 1 has passed. This is the allowlist's positive
  // half, without asserting that any given source fits any given edge's guard.
  const failures: string[] = [];
  for (const source of DETERMINISTIC_REASON_SOURCES) {
    const input = { ...matrixInput("DRAFT", "GATING"), reason: { source } };
    try {
      await expectRejection("IllegalTransition", input, { because: `source ${source} is allowlisted` });
    } catch (error) {
      failures.push((error as Error).message);
    }
  }
  assert.deepEqual(failures, []);
});
