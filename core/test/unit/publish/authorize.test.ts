import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PUBLISH_REFUSAL_ORDER,
  authorizePublish,
  type PublishRefusalCode,
  type PublishRefspec,
  type PublishRemoteFacts,
  type PublishRepositoryFacts,
  type PublishStatusFacts,
} from "../../../src/publish/authorize.ts";
import { TASK_STATES } from "../../../src/state/task-machine.ts";

const CANDIDATE_SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const ZERO_SHA = "0".repeat(40);
const REMOTE_NAME = "origin";
const BRANCH = "main";
const HOST = "git.example.com";

interface PublishInputs {
  readonly status: PublishStatusFacts;
  readonly repository: PublishRepositoryFacts;
  readonly remote: PublishRemoteFacts;
  readonly refspec: PublishRefspec;
}

function validBaseline(): PublishInputs {
  return {
    status: {
      lifecycleState: "LANDED",
      candidateSha: CANDIDATE_SHA,
      landingApproval: { candidateSha: CANDIDATE_SHA },
    },
    repository: {
      headSha: CANDIDATE_SHA,
      checkoutClean: true,
      allow: {
        remotes: [REMOTE_NAME],
        branches: [BRANCH],
        host: HOST,
      },
    },
    remote: {
      name: REMOTE_NAME,
      branch: BRANCH,
      resolvedHost: HOST,
      fastForward: true,
    },
    refspec: {
      source: CANDIDATE_SHA,
      destination: `refs/heads/${BRANCH}`,
      forced: false,
      deleting: false,
    },
  };
}

/** Changes the candidate identity dimension while keeping every equality row coherent. */
function withCandidate(input: PublishInputs, candidateSha: string): PublishInputs {
  return {
    ...input,
    status: {
      ...input.status,
      candidateSha,
      landingApproval: { candidateSha },
    },
    repository: { ...input.repository, headSha: candidateSha },
    refspec: { ...input.refspec, source: candidateSha },
  };
}

function decide(input: PublishInputs) {
  return authorizePublish(input.status, input.repository, input.remote, input.refspec);
}

function expectRefusal(code: PublishRefusalCode, input: PublishInputs): void {
  const result = decide(input);
  assert.equal(result.decision, "refused");
  if (result.decision === "refused") {
    assert.equal(result.code, code);
  }
}

test("a valid baseline authorizes the plan fields from their source inputs", () => {
  const input = validBaseline();
  const result = decide(input);

  assert.equal(result.decision, "authorized");
  if (result.decision === "authorized") {
    assert.equal(result.plan.remoteName, input.remote.name);
    assert.equal(result.plan.branch, input.remote.branch);
    assert.equal(result.plan.sha, input.status.candidateSha);
  }
});

test("all fourteen refusal codes are reachable in isolation", () => {
  const baseline = validBaseline();
  const cases: readonly { code: PublishRefusalCode; input: PublishInputs }[] = [
    {
      code: "not-landed",
      input: { ...baseline, status: { ...baseline.status, lifecycleState: "PREPARED" } },
    },
    {
      code: "no-landing-approval",
      input: { ...baseline, status: { ...baseline.status, landingApproval: null } },
    },
    {
      code: "approval-not-candidate",
      input: {
        ...baseline,
        status: { ...baseline.status, landingApproval: { candidateSha: OTHER_SHA } },
      },
    },
    {
      code: "malformed-candidate",
      input: withCandidate(baseline, "not-a-sha"),
    },
    {
      code: "head-not-at-candidate",
      input: { ...baseline, repository: { ...baseline.repository, headSha: OTHER_SHA } },
    },
    {
      code: "dirty-checkout",
      input: { ...baseline, repository: { ...baseline.repository, checkoutClean: false } },
    },
    {
      code: "remote-not-allowlisted",
      input: {
        ...baseline,
        repository: {
          ...baseline.repository,
          allow: { ...baseline.repository.allow, remotes: ["upstream"] },
        },
      },
    },
    {
      code: "branch-not-allowlisted",
      input: {
        ...baseline,
        repository: {
          ...baseline.repository,
          allow: { ...baseline.repository.allow, branches: ["release"] },
        },
      },
    },
    {
      code: "remote-host-mismatch",
      input: { ...baseline, remote: { ...baseline.remote, resolvedHost: "other.example.com" } },
    },
    {
      code: "force-refspec",
      input: { ...baseline, refspec: { ...baseline.refspec, forced: true } },
    },
    {
      code: "delete-refspec",
      input: { ...baseline, refspec: { ...baseline.refspec, deleting: true } },
    },
    {
      code: "inexact-source",
      input: { ...baseline, refspec: { ...baseline.refspec, source: OTHER_SHA } },
    },
    {
      code: "destination-not-declared-branch",
      input: {
        ...baseline,
        refspec: { ...baseline.refspec, destination: "refs/heads/release" },
      },
    },
    {
      code: "non-fast-forward",
      input: { ...baseline, remote: { ...baseline.remote, fastForward: false } },
    },
  ];

  assert.deepEqual(cases.map(({ code }) => code), PUBLISH_REFUSAL_ORDER);
  for (const testCase of cases) {
    expectRefusal(testCase.code, testCase.input);
  }
});

test("1 before 2 — lifecycle state outranks missing approval", () => {
  const baseline = validBaseline();
  // Fixing the later missing approval first would leave a pre-landed attempt publishable.
  expectRefusal("not-landed", {
    ...baseline,
    status: { ...baseline.status, lifecycleState: "PREPARED", landingApproval: null },
  });
});

test("2 gates 3 — approval existence precedes approval identity", () => {
  const baseline = validBaseline();
  // Fixing approval identity before requiring a record would let an unapproved revision through.
  expectRefusal("no-landing-approval", {
    ...baseline,
    status: { ...baseline.status, landingApproval: null },
  });
  expectRefusal("approval-not-candidate", {
    ...baseline,
    status: { ...baseline.status, landingApproval: { candidateSha: OTHER_SHA } },
  });
});

test("3 before 4 — approval identity outranks candidate shape", () => {
  const malformed = withCandidate(validBaseline(), "not-a-sha");
  // Fixing the later malformed SHA first would leave publication of an unapproved candidate possible.
  expectRefusal("approval-not-candidate", {
    ...malformed,
    status: { ...malformed.status, landingApproval: { candidateSha: OTHER_SHA } },
  });
});

test("4 before 5 — candidate shape outranks HEAD identity", () => {
  const malformed = withCandidate(validBaseline(), "not-a-sha");
  // Fixing the later HEAD mismatch first would let a malformed object id reach publication.
  expectRefusal("malformed-candidate", {
    ...malformed,
    repository: { ...malformed.repository, headSha: OTHER_SHA },
  });
});

test("5 before 6 — HEAD identity outranks checkout cleanliness", () => {
  const baseline = validBaseline();
  // Fixing the later dirty checkout first would publish a revision other than the landed candidate.
  expectRefusal("head-not-at-candidate", {
    ...baseline,
    repository: { ...baseline.repository, headSha: OTHER_SHA, checkoutClean: false },
  });
});

test("6 before 7 — checkout cleanliness outranks remote allowlisting", () => {
  const baseline = validBaseline();
  // Fixing the later remote allowlist first would publish from an unrecorded dirty tree.
  expectRefusal("dirty-checkout", {
    ...baseline,
    repository: {
      ...baseline.repository,
      checkoutClean: false,
      allow: { ...baseline.repository.allow, remotes: ["upstream"] },
    },
  });
});

test("7 before 8 — remote allowlisting outranks branch allowlisting", () => {
  const baseline = validBaseline();
  // Fixing the later branch allowlist first would publish through an unauthorized remote binding.
  expectRefusal("remote-not-allowlisted", {
    ...baseline,
    repository: {
      ...baseline.repository,
      allow: { ...baseline.repository.allow, remotes: ["upstream"], branches: ["release"] },
    },
  });
});

test("8 before 9 — branch allowlisting outranks host identity", () => {
  const baseline = validBaseline();
  // Fixing the later host mismatch first would create an unauthorized branch successfully.
  expectRefusal("branch-not-allowlisted", {
    ...baseline,
    repository: {
      ...baseline.repository,
      allow: { ...baseline.repository.allow, branches: ["release"] },
    },
    remote: { ...baseline.remote, resolvedHost: "other.example.com" },
  });
});

test("9 before 10 — host identity outranks force", () => {
  const baseline = validBaseline();
  // Fixing the later force complaint first would still publish to a rewritten remote host.
  expectRefusal("remote-host-mismatch", {
    ...baseline,
    remote: { ...baseline.remote, resolvedHost: "other.example.com" },
    refspec: { ...baseline.refspec, forced: true },
  });
});

test("10 before 11 — force outranks deletion", () => {
  const baseline = validBaseline();
  // Fixing the later deletion complaint first would still permit a forced remote update.
  expectRefusal("force-refspec", {
    ...baseline,
    refspec: { ...baseline.refspec, forced: true, deleting: true },
  });
});

test("11 before 12 — deletion outranks source exactness", () => {
  const baseline = validBaseline();
  // Fixing the later source mismatch first would turn an exact-looking source into a branch deletion.
  expectRefusal("delete-refspec", {
    ...baseline,
    refspec: { ...baseline.refspec, source: OTHER_SHA, deleting: true },
  });
});

test("12 before 13 — source exactness outranks destination identity", () => {
  const baseline = validBaseline();
  // Fixing the later destination first would publish a source other than the approved candidate.
  expectRefusal("inexact-source", {
    ...baseline,
    refspec: { ...baseline.refspec, source: OTHER_SHA, destination: "refs/heads/release" },
  });
});

test("13 before 14 — destination identity outranks fast-forward status", () => {
  const baseline = validBaseline();
  // Fixing the later fast-forward complaint first would publish to an undeclared destination ref.
  expectRefusal("destination-not-declared-branch", {
    ...baseline,
    remote: { ...baseline.remote, fastForward: false },
    refspec: { ...baseline.refspec, destination: "refs/heads/release" },
  });
});

test("every imported state except LANDED is refused by the state row", () => {
  const baseline = validBaseline();
  let refused = 0;

  for (const lifecycleState of TASK_STATES) {
    if (lifecycleState === "LANDED") {
      continue;
    }
    expectRefusal("not-landed", {
      ...baseline,
      status: { ...baseline.status, lifecycleState },
    });
    refused += 1;
  }

  assert.equal(refused, TASK_STATES.length - 1);
});

test("the cartesian product of discrete dimensions is total and never throws", () => {
  const candidateValues = [CANDIDATE_SHA, "not-a-sha", null] as const;
  const approvalModes = ["match", "mismatch", "absent"] as const;
  const headModes = ["match", "mismatch"] as const;
  const booleans = [true, false] as const;
  const hostModes = ["absent", "match", "mismatch"] as const;
  const sourceModes = ["exact", "other", "empty", "zero"] as const;
  const destinationModes = ["declared", "other"] as const;
  const fastForwardValues = [true, false, null] as const;
  const refusalCodes: readonly string[] = PUBLISH_REFUSAL_ORDER;
  let unknownResults = 0;
  let throws = 0;
  let checked = 0;

  for (const lifecycleState of TASK_STATES) {
    for (const candidateSha of candidateValues) {
      for (const approvalMode of approvalModes) {
        for (const headMode of headModes) {
          for (const checkoutClean of booleans) {
            for (const remoteAllowed of booleans) {
              for (const branchAllowed of booleans) {
                for (const hostMode of hostModes) {
                  for (const forced of booleans) {
                    for (const deleting of booleans) {
                      for (const sourceMode of sourceModes) {
                        for (const destinationMode of destinationModes) {
                          for (const fastForward of fastForwardValues) {
                            const candidateForEquality = candidateSha ?? CANDIDATE_SHA;
                            const landingApproval = approvalMode === "absent"
                              ? null
                              : {
                                  candidateSha: approvalMode === "match"
                                    ? candidateForEquality
                                    : OTHER_SHA,
                                };
                            const allow = hostMode === "absent"
                              ? {
                                  remotes: remoteAllowed ? [REMOTE_NAME] : ["upstream"],
                                  branches: branchAllowed ? [BRANCH] : ["release"],
                                }
                              : {
                                  remotes: remoteAllowed ? [REMOTE_NAME] : ["upstream"],
                                  branches: branchAllowed ? [BRANCH] : ["release"],
                                  host: HOST,
                                };
                            const source = sourceMode === "exact"
                              ? candidateForEquality
                              : sourceMode === "other"
                                ? OTHER_SHA
                                : sourceMode === "empty"
                                  ? ""
                                  : ZERO_SHA;
                            const input: PublishInputs = {
                              status: { lifecycleState, candidateSha, landingApproval },
                              repository: {
                                headSha: headMode === "match" ? candidateForEquality : OTHER_SHA,
                                checkoutClean,
                                allow,
                              },
                              remote: {
                                name: REMOTE_NAME,
                                branch: BRANCH,
                                resolvedHost: hostMode === "mismatch" ? "other.example.com" : HOST,
                                fastForward,
                              },
                              refspec: {
                                source,
                                destination: destinationMode === "declared"
                                  ? `refs/heads/${BRANCH}`
                                  : "refs/heads/release",
                                forced,
                                deleting,
                              },
                            };

                            try {
                              const result = decide(input);
                              if (result.decision !== "authorized" && !refusalCodes.includes(result.code)) {
                                unknownResults += 1;
                              }
                            } catch {
                              throws += 1;
                            }
                            checked += 1;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const expected = TASK_STATES.length
    * candidateValues.length
    * approvalModes.length
    * headModes.length
    * booleans.length ** 5
    * hostModes.length
    * sourceModes.length
    * destinationModes.length
    * fastForwardValues.length;
  assert.equal(checked, expected);
  assert.equal(unknownResults, 0);
  assert.equal(throws, 0);
});
