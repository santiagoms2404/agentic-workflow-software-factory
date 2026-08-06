// The Guard column of the L-table, one function per edge.
//
// This is step 10 — the LAST structural check before price. "Only a fully
// legitimate request earns a critique of its evidence — otherwise fabricating
// evidence would look like the fix." So a guard here never runs until the
// source, the pair, the actor, the medium and the budget have all cleared.
//
// Each guard returns the list of things wrong with the request rather than
// throwing on the first: a caller fixing one missing field at a time, one
// round-trip each, is how a correction budget gets spent on nothing.
//
// Pure — no I/O, no clock. `git`, `gate` and `record` appear only as claims
// somebody else already made; this layer never goes and looks.

import { EDGE_BLOCKER_CODES, InsufficientEvidence } from "./errors.ts";
import type { EdgeId, LegalEdge, TransitionInput } from "./task-machine.ts";
import { BLOCKING_SEVERITIES, severityRank } from "../contracts/review-output.ts";
import { SHA_PATTERN } from "../contracts/test-output.ts";

/**
 * The same `^[0-9a-f]{40}$` the envelope contracts already hold every object
 * id to, imported rather than restated. One path field left unguarded is one
 * place the rule does not hold.
 */
const SHA = new RegExp(SHA_PATTERN);

function isSha(value: unknown): value is string {
  return typeof value === "string" && SHA.test(value);
}

function isTrue(value: unknown): boolean {
  return value === true;
}

/** Present, a string, and not just whitespace. A blank rework request is not a request. */
function isText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function show(value: unknown): string {
  return value === undefined ? "(absent)" : JSON.stringify(value);
}

/** `reason.code ∈ BLOCKER_CODES` — read per edge, because the vocabulary is per edge. */
function blockerCode(id: keyof typeof EDGE_BLOCKER_CODES, input: TransitionInput): string[] {
  const permitted: readonly string[] = EDGE_BLOCKER_CODES[id];
  const code = input.reason.code;
  if (code !== undefined && permitted.includes(code)) return [];
  return [
    `reason.code ${show(code)} is not in ${id}'s blocker vocabulary (${permitted.join(", ")}); an unrecognized code is not a blocker, it is an unexplained halt`,
  ];
}

/** Every `→ CANCELLED` edge: "explicit, interactive" — a person, not a process. */
function humanInput(input: TransitionInput): string[] {
  const source = input.reason.source;
  return source === "human"
    ? []
    : [`cancellation must come from explicit human input, not from reason.source ${JSON.stringify(source)}`];
}

/** A candidate SHA carried for identity on an edge that does not otherwise reason about it. */
function candidate(input: TransitionInput): string[] {
  const sha = input.evidence?.candidateSha;
  return isSha(sha) ? [] : [`candidate SHA ${show(sha)} is not a 40-hex object id`];
}

const GUARDS: Readonly<Record<EdgeId, (input: TransitionInput) => string[]>> = {
  // L1 — worktree created, base SHA pinned, config validates, three preflights green.
  L1: (input) => {
    const e = input.evidence;
    const violations: string[] = [];
    if (!isTrue(e?.worktreeCreated)) violations.push("no worktree was materialized");
    if (!isTrue(e?.configValid)) violations.push("the configuration does not validate");
    if (!isSha(e?.baseSha)) violations.push(`base SHA ${show(e?.baseSha)} is not a 40-hex object id`);
    const preflight = e?.preflight;
    if (preflight === undefined) {
      violations.push("no adapter/sandbox/observability preflight was attested");
    } else {
      if (!isTrue(preflight.adapter)) violations.push("the adapter preflight did not pass");
      if (!isTrue(preflight.sandbox)) violations.push("the sandbox preflight did not pass");
      if (!isTrue(preflight.observability)) violations.push("the observability preflight did not pass");
    }
    return violations;
  },

  L2: (input) => blockerCode("L2", input),
  L3: humanInput,

  // L4 — the workflow must exist, and fit, before a provider does.
  L4: (input) =>
    isTrue(input.evidence?.workflowCompiled) ? [] : ["the workflow was not compiled"],

  L5: (input) => blockerCode("L5", input),
  L6: humanInput,

  // L7 — the "said done, wrote nothing" gate. A 40-hex candidate that is not
  // the base is the only proof the phase produced a tree at all.
  L7: (input) => {
    const e = input.evidence;
    const base = e?.baseSha;
    const cand = e?.candidateSha;
    const violations: string[] = [];
    if (!isTrue(e?.requiredPhasesTerminalSuccess)) {
      violations.push("not every required phase reached terminal success");
    }
    if (!isTrue(e?.hostCommitCreated)) violations.push("no host commit was created");
    if (!isSha(base)) {
      violations.push(`base SHA ${show(base)} is not a 40-hex object id, so "differs from base" is unprovable`);
    }
    if (!isSha(cand)) {
      violations.push(`candidate SHA ${show(cand)} is not a 40-hex object id`);
    }
    if (isSha(base) && isSha(cand) && cand === base) {
      violations.push("the candidate SHA equals the base — the phase said done and wrote nothing");
    }
    return violations;
  },

  L8: (input) => blockerCode("L8", input),

  // L9 — a cancellation that cannot say what is still alive is the
  // ghost-process failure this system exists to prevent.
  L9: (input) => {
    const e = input.evidence;
    const violations = humanInput(input);
    if (!isTrue(e?.treeTerminated)) violations.push("the process tree was not terminated");
    if (!isTrue(e?.survivorsReported)) violations.push("the survivors were not reported");
    return violations;
  },

  // L10 — a correction carries its own proof. Without the exact command and
  // its output, "the gates failed" is hearsay and the call buys a guess.
  L10: (input) => {
    const violations = candidate(input);
    const gatesPass = input.evidence?.gatesPass;
    if (gatesPass !== false) {
      violations.push(
        gatesPass === undefined
          ? "no gate result was attested, so there is nothing to correct"
          : "the gates passed — a correction would spend a call on nothing",
      );
    }
    const command = input.reason.command;
    if (command === undefined || command.length === 0) {
      violations.push("reason.command does not name the failed command");
    }
    if (!isText(input.reason.output)) violations.push("reason.output does not carry the command's output");
    return violations;
  },

  // L11 / L12 — the tier fork out of GATING. T2 may not skip review; T0/T1 may
  // not invent one.
  L11: (input) => {
    const violations = candidate(input);
    if (!isTrue(input.evidence?.gatesPass)) violations.push("the gates did not pass");
    if (input.tier < 2) violations.push(`review is a T2 control and this task is T${input.tier}`);
    return violations;
  },

  L12: (input) => {
    const violations = candidate(input);
    if (!isTrue(input.evidence?.gatesPass)) violations.push("the gates did not pass");
    if (input.tier >= 2) violations.push("a T2 task may not skip the opposite-provider review");
    return violations;
  },

  // L13 — the budget must really be gone. Blocking a task whose owner tranche
  // is still available would strand work the owner could have authorized.
  L13: (input) => {
    const violations = blockerCode("L13", input);
    if (input.evidence?.gatesPass !== false) violations.push("the gates did not fail");
    const { correctionsAuto, correctionsOwner, allowance } = input.budget;
    if (correctionsAuto < allowance.auto) {
      violations.push(`the automatic tranche still has ${allowance.auto - correctionsAuto} correction(s)`);
    }
    if (correctionsOwner < allowance.owner) {
      violations.push(`the owner tranche still has ${allowance.owner - correctionsOwner} correction(s)`);
    }
    return violations;
  },

  L14: humanInput,

  // L15 — a verdict must be internally consistent and about THIS tree.
  // `accept` carrying a high or critical finding is a record that contradicts
  // itself, and a review of a different SHA is not a review of this change.
  L15: (input) => {
    const violations = candidate(input);
    const review = input.evidence?.review;
    if (review === undefined) return [...violations, "no review verdict was recorded"];
    if (!isSha(review.reviewedSha)) {
      violations.push(`the reviewed SHA ${show(review.reviewedSha)} is not a 40-hex object id`);
    } else if (review.reviewedSha !== input.evidence?.candidateSha) {
      violations.push("the review names a different tree than the candidate");
    }
    const blocking = review.findings.filter((f) =>
      (BLOCKING_SEVERITIES as readonly string[]).includes(f.severity),
    );
    if (review.verdict === "accept" && blocking.length > 0) {
      violations.push(`the verdict is accept but ${blocking.length} finding(s) are high or critical`);
    }
    if (review.verdict === "concern" && review.findings.length === 0) {
      violations.push("the verdict is concern but no finding says what the concern is");
    }
    return violations;
  },

  // L16 — a style note is not a defect. If it authorized re-work, "the
  // reviewer had opinions" would be indistinguishable from "the code is
  // wrong", and the difference is one tier call.
  L16: (input) => {
    const violations = candidate(input);
    const review = input.evidence?.review;
    if (review === undefined) {
      violations.push("no review was recorded, so no finding can have been accepted");
    } else {
      if (!isSha(review.reviewedSha)) {
        violations.push(`the reviewed SHA ${show(review.reviewedSha)} is not a 40-hex object id`);
      } else if (review.reviewedSha !== input.evidence?.candidateSha) {
        violations.push("the review names a different tree than the candidate");
      }
      const qualifying = review.findings.filter(
        (f) => severityRank(f.severity) >= severityRank("medium") && isText(f.file) && isText(f.detail),
      );
      if (qualifying.length === 0) {
        violations.push(
          "no finding of severity >= medium carries both a file and a detail; a style note does not authorize re-work",
        );
      }
    }
    if (!isTrue(input.evidence?.gatesInvalidated)) {
      violations.push("the stale gates were not invalidated — the old green would vouch for a tree it never saw");
    }
    return violations;
  },

  // L17 — one transport retry, then block. Never a substitute provider:
  // routing may not read quota and a mandatory review is mandatory.
  L17: (input) => {
    const violations = blockerCode("L17", input);
    const retries = input.evidence?.reviewTransportRetries;
    if (retries === undefined || retries < 1) {
      violations.push(`the mandatory review was retried ${show(retries)} times; it must be retried once before blocking`);
    }
    return violations;
  },

  L18: humanInput,

  // L19 — owner rework invalidates everything it supersedes, and names a
  // concrete defect. "Try again" is not a rework request.
  L19: (input) => {
    const e = input.evidence;
    const violations = candidate(input);
    if (!isText(e?.reworkRequest)) violations.push("no concrete named defect or rework request was given");
    if (!isTrue(e?.gatesInvalidated)) violations.push("the stale gates were not invalidated");
    if (!isTrue(e?.reviewInvalidated)) violations.push("the stale review was not invalidated");
    return violations;
  },

  // L20 — the human gate's evidence. The SHA the human saw, the SHA the
  // review read, and the SHA the host will fast-forward to are one object id
  // or the human confirmed one tree and the host lands another.
  L20: (input) => {
    const e = input.evidence;
    const violations = candidate(input);
    if (!isTrue(e?.gatesPass)) violations.push("the gates did not pass");
    const landing = e?.landing;
    if (landing === undefined) return [...violations, "no landing evidence was recorded"];
    if (!isSha(landing.shaDisplayed)) {
      violations.push(`the displayed SHA ${show(landing.shaDisplayed)} is not a 40-hex object id`);
    } else if (landing.shaDisplayed !== e?.candidateSha) {
      violations.push("the SHA shown to the human is not the candidate");
    }
    if (!isText(landing.summaryDisplayed)) violations.push("no summary was displayed");
    if (!isTrue(landing.confirmed)) violations.push("the human did not confirm");
    if (!isTrue(landing.protectedApprovalsValid)) violations.push("the protected-path approvals are not valid");
    if (!isTrue(landing.fastForwardPreflightPasses)) violations.push("the fast-forward preflight did not pass");
    // "T1 plus opposite-provider review and end-user journey" — required at
    // T2, and only at T2. Demanding them below it would invent controls the
    // tier never bought.
    if (input.tier >= 2) {
      if (!isTrue(landing.requiredReviewPresent)) violations.push("the T2 opposite-provider review is missing");
      if (!isTrue(landing.journeyApproved)) violations.push("the T2 end-user journey was not approved");
    }
    return violations;
  },

  // L21 — record faults only, and deliberately narrow. AWAITING_OWNER has no
  // timeout, so no clock may produce this edge; a task waiting on the owner
  // waits forever, and that is the point. (A clock never reaches here anyway:
  // it is not on the deterministic allowlist, so step 1 refuses it first.)
  L21: (input) => {
    const violations = blockerCode("L21", input);
    if (input.reason.source !== "record") {
      violations.push(
        `AWAITING_OWNER blocks only on a record fault, not on reason.source ${JSON.stringify(input.reason.source)}`,
      );
    }
    return violations;
  },

  L22: humanInput,

  // L23 — landing is confirmed against reality, not against intent.
  L23: (input) => {
    const e = input.evidence;
    const head = e?.headSha;
    const violations = candidate(input);
    if (!isSha(head)) {
      violations.push(`canonical HEAD ${show(head)} is not a 40-hex object id`);
    } else if (head !== e?.candidateSha) {
      violations.push("canonical HEAD is not the candidate");
    }
    if (!isTrue(e?.checkoutClean)) violations.push("the canonical checkout is not clean");
    return violations;
  },

  L24: (input) => blockerCode("L24", input),
};

/** Step 10. Throws `InsufficientEvidence` naming every defect at once, or returns. */
export function assertEvidence(edge: LegalEdge, input: TransitionInput): void {
  const violations = GUARDS[edge.id](input);
  if (violations.length > 0) {
    throw new InsufficientEvidence(edge.from, edge.to, edge.id, violations);
  }
}
