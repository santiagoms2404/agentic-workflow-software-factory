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

import { EDGE_BLOCKER_CODES, InsufficientEvidence, REVIEW_EVIDENCE_DEFECTS } from "./errors.ts";
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

/** A measured, non-negative count of minutes. `undefined` is the unavailable case, never zero. */
function isMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
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

/**
 * `gatesPass` is one boolean somebody wrote down earlier. An edge that spends
 * a call to PRESERVE a green must check the green itself: every configured
 * gate has a row, every row passed, and every row measured this candidate and
 * not some superseded one.
 */
function gateEvidenceViolations(input: TransitionInput): string[] {
  const evidence = input.evidence?.gateEvidence;
  if (evidence === undefined) {
    return ["no gate rows were attested; `gatesPass` alone does not prove the green it summarises"];
  }
  const violations: string[] = [];
  if (evidence.configured.length === 0) {
    violations.push("no gate was named as configured, so 'every configured gate passed' is unprovable");
  }
  const candidateSha = input.evidence?.candidateSha;
  const byId = new Map(evidence.rows.map((row) => [row.gateId, row]));
  for (const gateId of evidence.configured) {
    if (!byId.has(gateId)) violations.push(`the configured gate ${JSON.stringify(gateId)} has no recorded row`);
  }
  for (const row of evidence.rows) {
    if (!isTrue(row.passed)) violations.push(`the gate ${JSON.stringify(row.gateId)} did not pass`);
    if (!isSha(row.candidateSha)) {
      violations.push(`the gate ${JSON.stringify(row.gateId)} names SHA ${show(row.candidateSha)}, which is not a 40-hex object id`);
    } else if (row.candidateSha !== candidateSha) {
      violations.push(`the gate ${JSON.stringify(row.gateId)} measured a different tree than the candidate`);
    }
  }
  return violations;
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
  //
  // "The correction budget" now means three counters, not two, and L13 means
  // ALL of them: an intra-phase owner correction and an owner RE-ENTRY are
  // different remedies drawn from different accounts, and either one still
  // standing is a way out of this GATING failure that the owner has not been
  // offered yet.
  L13: (input) => {
    const violations = blockerCode("L13", input);
    if (input.evidence?.gatesPass !== false) violations.push("the gates did not fail");
    const { correctionsAuto, correctionsOwner, ownerReentries, allowance } = input.budget;
    if (correctionsAuto < allowance.auto) {
      violations.push(`the automatic tranche still has ${allowance.auto - correctionsAuto} correction(s)`);
    }
    if (correctionsOwner < allowance.owner) {
      violations.push(`the owner tranche still has ${allowance.owner - correctionsOwner} correction(s)`);
    }
    if (ownerReentries < allowance.ownerReentries) {
      violations.push(
        `the owner re-entry allowance still has ${allowance.ownerReentries - ownerReentries} re-entry(s)`,
      );
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

  // L17 — the review failures the host may declare terminal, and only those.
  //
  // Transport unavailability after one retry was the original reason, and the
  // reason it qualified is that it needs no interpretation. Two more failures
  // have exactly that property: an envelope TypeBox either validated or did
  // not, and a `review_evidence_present` row either passed or did not. Neither
  // asks the host what a bad review MEANS.
  //
  // Never a substitute provider: routing may not read quota and a mandatory
  // review is mandatory. And a `verdict_consistent` failure still has no exit
  // here, deliberately — an inconsistent verdict is content.
  //
  // Widening this repairs a dead end that predates L25: a malformed reviewer
  // envelope satisfies neither L15 (no valid verdict), nor L16 (no finding of
  // severity >= medium exists to accept), nor the old L17 (a review that
  // ANSWERED was never a transport failure), so cancel was the only edge and
  // the candidate was lost to a parse error.
  L17: (input) => {
    const violations = blockerCode("L17", input);
    const retries = input.evidence?.reviewTransportRetries;
    const failure = input.evidence?.reviewFailure;
    const deterministic = failure === "review-malformed" || failure === "review-evidence-invalid";
    if (!deterministic && (retries === undefined || retries < 1)) {
      violations.push(
        `the mandatory review was retried ${show(retries)} times and reviewFailure is ${show(failure)}; ` +
          "blocking needs one transport retry, or a host-determined review-malformed / review-evidence-invalid failure",
      );
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

  // L25 — the owner rejects the review and re-buys the review.
  //
  // The contract already had "the owner rejects the review and re-enters"
  // (L16); it lacked this. The asymmetry existed because the contract assumed
  // a review's CONTENT could be wrong but its EVIDENCE could not be missing.
  //
  // Two things make this an edge rather than a loophole. First, eligibility is
  // HOST-determined: `reviewEvidenceDefect` is a two-member enum read off the
  // recorded gate rows, so an owner may not replace a review merely because
  // they dislike it. Second, `gatesInvalidated` must be ABSENT — the tree did
  // not change, the old green vouches for exactly the tree it saw, and
  // preserving it is the entire point of the edge. L16 and L19 demand the
  // opposite because they change the tree; asserting it here would be a rework
  // wearing a review's name.
  L25: (input) => {
    const e = input.evidence;
    const violations = candidate(input);
    if (input.reason.source !== "human") {
      violations.push(
        `only an owner may reject a review, not reason.source ${JSON.stringify(input.reason.source)}`,
      );
    }
    if (!isText(e?.reviewInvalidationReason)) {
      violations.push("no reason was recorded for rejecting the review");
    }
    if (input.tier < 2) {
      violations.push(`review is a T2 control and this task is T${input.tier}; there is nothing to replace`);
    }
    if (!isTrue(e?.gatesPass)) violations.push("the gates did not pass — a red candidate is never re-reviewed");
    violations.push(...gateEvidenceViolations(input));
    if (!isTrue(e?.reviewInvalidated)) {
      violations.push("the superseded review was not invalidated on the record");
    }
    const review = e?.review;
    if (review === undefined) {
      violations.push("no review was recorded, so there is no review to supersede");
    } else if (!isSha(review.reviewedSha)) {
      violations.push(`the reviewed SHA ${show(review.reviewedSha)} is not a 40-hex object id`);
    } else if (review.reviewedSha !== e?.candidateSha) {
      violations.push("the recorded review names a different tree than the candidate");
    }
    const defect = e?.reviewEvidenceDefect;
    if (defect === undefined || !(REVIEW_EVIDENCE_DEFECTS as readonly string[]).includes(defect)) {
      violations.push(
        `reviewEvidenceDefect ${show(defect)} is not one of the host-determined defects (${REVIEW_EVIDENCE_DEFECTS.join(", ")}); ` +
          "a review that carries a passing evidence gate is not replaceable at all",
      );
    }
    if (!isTrue(e?.candidateUnchanged)) {
      violations.push("the host did not observe the candidate and base unmoved and both trees clean");
    }
    if (e?.gatesInvalidated !== undefined) {
      violations.push(
        `gatesInvalidated ${show(e.gatesInvalidated)} was asserted; L25 preserves the green it stands on and may not speak to invalidating it`,
      );
    }
    return violations;
  },

   // L26 — the quota stop. This is where fail-open stops being a property of how
  // a comparison was written and becomes a property of the machine: a reading
  // the host could not make carries no `minutesToReset`, so the edge cannot
  // form. A later refactor that tried to stop on a broken gauge is refused here
  // rather than in its caller. The crossing is checked too, so the host cannot
  // take this edge gratuitously.
  L26: (input) => {
    const stop = input.evidence?.quotaStop;
    if (stop === undefined) {
      return ["no quota reading was attested; L26 exists only to carry a measured stop"];
    }
    const violations: string[] = [];
    const { minutesToReset: minutes, thresholdMinutes: threshold } = stop;
    if (!isMinutes(minutes)) {
      violations.push(
        `minutesToReset ${show(minutes)} is not a measured figure — an unavailable, stale or unknown reading may never stop a run`,
      );
    }
    if (!isMinutes(threshold)) {
      violations.push(`thresholdMinutes ${show(threshold)} is not configured, so nothing was crossed`);
    }
    if (isMinutes(minutes) && isMinutes(threshold) && minutes >= threshold) {
      violations.push(`minutesToReset ${String(minutes)} is not below the configured threshold ${String(threshold)}`);
    }
    if (!isText(stop.route)) {
      violations.push("no route was named, so the threshold cannot be attributed to a configured adapter");
    }
    return violations;
  },
  // L27 — publication uses the landing approval record. The operator must
     // confirm the same candidate revision that was displayed for approval.
     L27: (input) => {
       const e = input.evidence;
       const violations = candidate(input);
       const landing = e?.landing;
       if (landing === undefined) {
         return [...violations, "no landing approval evidence was recorded"];
       }
       if (!isSha(landing.shaDisplayed)) {
         violations.push(`the displayed SHA ${show(landing.shaDisplayed)} is not a 40-hex object id`);
       } else if (landing.shaDisplayed !== e?.candidateSha) {
         violations.push("the SHA shown to the human is not the candidate");
       }
       if (!isTrue(landing.confirmed)) {
         violations.push("the human did not confirm publication");
       }
       return violations;
     },
};

/** Step 10. Throws `InsufficientEvidence` naming every defect at once, or returns. */
export function assertEvidence(edge: LegalEdge, input: TransitionInput): void {
  const violations = GUARDS[edge.id](input);
  if (violations.length > 0) {
    throw new InsufficientEvidence(edge.from, edge.to, edge.id, violations);
  }
}
