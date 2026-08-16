# Pilot 2 — a real T2 task, landed with an evidenced opposite-provider review

**Outcome: LANDED.** The factory performed a real, owner-named tier-2 job within its 5-call
ceiling; the review ran on the provider opposite the builder and actually read the candidate's
diff; the owner exercised the built feature by hand and attested it against the exact candidate
SHA; and canonical HEAD moved only through a human at a TTY.

The review returned **`concern` with four findings**. It was landed with those findings on the
record — which is a designed outcome, not a workaround. A fifth finding was discovered by the
owner during the journey. All five are recorded below and are being corrected by hand.

## Task and scope

Add `/coordinate` to the Fusion Harness — the "one plan, work split" pattern from that project's
own README gallery. Three rounds: both models propose a plan and a work split; a single
architect-family agent merges them into one agreed plan in which every work item has exactly one
owner; then each model executes only the items assigned to it. Round 3 is gated behind explicit
approval, so a bare invocation stops after the plan.

Scope was **read-only with respect to the caller's repository** and reversible: 8 files,
**763 insertions, 10 deletions**, entirely inside the harness extension plus three new prompt
files. Sixteen numbered behaviours and eight required proofs were specified up front.

## Identity

| | |
|---|---|
| Attempt | 1 (no retry, no rework, no replacement review) |
| Workflow / tier | `build-review` / T2 |
| Base SHA | `a3e5af1c1c6b0300bfeae8f9065b8cae9a2a75ca` |
| Candidate SHA | `7ea497c3c08ab3844c22df9f516c214cc29aebf4` |
| Landed SHA | `7ea497c3c08ab3844c22df9f516c214cc29aebf4` (identical to candidate) |

## The inversion, which is the experiment

| Role | Adapter | Provider | Requested | Resolved | Provenance |
|---|---|---|---|---|---|
| Builder | `codex` | **`openai-codex`** | `codex:gpt-5.6-sol` | `gpt-5.6-sol` | route-attributed |
| Reviewer | `claude` | **`anthropic`** | `claude:opus` | `claude-opus-5` | stream-authoritative |

`worker_provider` and `review_provider` differ in the session record, so the inversion is
provable from the evidence rather than asserted. The reviewer route was derived by exclusion
against the provider the worker actually ran on, never from configuration alone. No fallback and
no substitution was possible: the config declares `no_fallback`.

Sandbox grant for both: `tool-policy` / `adapter-tool-policy` — the truthful grant on a host
without `bwrap`, read from the broker rather than inferred.

## Calls by category

**Total: 2 of the 5-call T2 ceiling.**

| Category | Calls |
|---|---|
| Builder | 1 |
| Review (opposite provider) | 1 |
| Automatic correction | 0 |
| Owner rework | 0 |
| Replacement review | 0 |
| **Total** | **2** |

Three calls and the single owner re-entry allowance were left unspent at landing.

## The review actually read the candidate

`review_evidence_present` **passed**. The host composed a diff-scoped review context — the full
diff, the changed-file list, the recorded intent, and the gate results — and proved it fit before
the reviewer launched, then proved it had reached the compiled prompt afterwards.

This is the distinction that matters, and it is why this pilot's `concern` is worth more than an
`accept` would have been earlier: an opposite-provider reviewer that receives only a bounded test
tail cannot find anything, and its acceptance is structurally guaranteed rather than earned. This
one had the diff and returned four specific, file-attributed defects.

## Gates

**19 of 19 passed**, every one measured by the host against the exact candidate SHA:

- `builder` (9) — `candidate_hygiene`, `commands_pass`, `envelope_valid`, `artifacts_exist`,
  `json_parses`, `no_protected_paths`, `diff_matches_claims`, `writes_within_globs`,
  `head_advanced`
- `tests` (2) — `candidate_hygiene`, `commands_pass` (the configured fixture suite, exit 0)
- `reviewer` (6) — `envelope_valid`, `artifacts_exist`, `json_parses`, `no_protected_paths`,
  `verdict_consistent`, `writes_within_globs`, plus **`review_evidence_present`**
- `owner-journey` (1) — `journey_passes`

## Findings, carried rather than hidden

Four from the reviewer, one from the owner's journey. None is a correctness defect in the
feature's happy path; three concern proof quality and documentation, and two concern robustness.

1. **medium** — required README registration missing; the change never touched `README.md`.
2. **medium** — the required proofs are not behavioral: accounting, resume and one-sided-failure
   tests largely inspect source text or hard-coded arrays instead of exercising the command, so
   they could stay green while runtime behaviour is wrong.
3. **medium** — three *existing* tests were repurposed rather than added to, switching their
   subject command, so two shipped commands silently lost setup-failure, cancellation and
   concurrency coverage. The headline test count rose while coverage moved sideways.
4. **low** — a dead argument-parser binding duplicating a flag literal.
5. **medium, found during the journey** — proposal parsing rejects fenced or prose-wrapped JSON.
   A correct, well-formed proposal was discarded because the model wrapped it in a sentence and a
   fenced block; the parser calls `JSON.parse` on the whole output with no extraction.

Finding 2 predicted finding 5's class exactly, and finding 5 was then found in the wild. That is
the reviewer earning its call.

## The journey

Journey id `coordinate-embedded-v1`, exercised by the owner against the exact candidate in the
managed worktree, in **embedded mode** — the only mode this build can reach, because the harness's
visible-execution runtime is contract-only by design.

Verified by observation: the three-round structure; the 3-call plan-only default and its stop; the
2-call resume that re-ran neither the proposals nor the merge — **proved on disk by file
timestamps**, not merely by a panel; every merged item owned by exactly one side and traced to a
retained proposal; both provenance branches, consensus and kept-with-attribution, including a
genuine arbitration between two disagreeing proposals; exact call accounting by role and round on
every panel; truthful embedded labelling; the one-sided-failure path, observed live on a real
provider error; and the caller's repository untouched on every path.

**Explicitly not observed, and not claimed:** escape cancellation. Escape failed to cancel, and a
differential test against a shipped, previously-landed command failed the same way in the same
terminal, so the cause is that environment's raw-input handling rather than the candidate. The
single-invocation five-call form was also not run — the split was exercised as plan-then-resume,
so both halves of the arithmetic are proven but that exact invocation is inferred.

Journey spend: **12 provider calls**, all subscription routes, none credit-billed. These are not
AWSF calls and are not counted against the tier ceiling.

## Tokens and cost authority

Usage authority: `provider`. **Cost authority: `unavailable` — subscription routes. No dollar
figure is rendered and none was estimated.**

| | Input | Output | Cache read | Cache write | Reasoning |
|---|---|---|---|---|---|
| Builder | 156,767 | 31,825 | 4,186,624 | 0 | 9,015 |
| Reviewer | 2 | 11,441 | 0 | 47,468 | 7,693 |

## Duration

| Phase | Window |
|---|---|
| `request` | 05:38:06.997Z → 05:38:07.032Z |
| `builder` | 05:38:08.221Z → 05:50:52.149Z (12m 44s) |
| `tests` (host gates) | 05:50:53.343Z → 05:50:53.866Z |
| `review-context` (host) | 05:50:53.978Z → 05:50:58.091Z |
| `reviewer` | 05:50:59.930Z → 05:53:40.067Z (2m 40s) |
| `owner-journey` | 08:53:25.403Z |
| Landed | 08:54:39.586Z |

The gap between review and journey is the owner reading four findings and exercising the feature
by hand. The lifecycle waits; it does not expire.

## Landing

`awsf land` was run by the owner in an interactive terminal. The screen showed the candidate SHA,
the change summary, and a fast-forward meter reading *ahead 0, behind 1*. The owner typed the
confirmation; the host never answered it.

Result: canonical HEAD moved by **local fast-forward** to exactly
`7ea497c3c08ab3844c22df9f516c214cc29aebf4`, single parent, no merge commit, clean checkout. No
push path exists anywhere in the codebase to have used.

## Two observability gaps found by auditing this landing

Recorded here rather than quietly fixed, because both were found while verifying the pilot and
neither was repaired by it:

- **The landing edges are not journalled as transition evidence.** `L20`, `L21` and `L23` advance
  the lifecycle and are printed by the command, but unlike every other command's transitions they
  carry no `transition` evidence record — so the projection's transitions table shows the run
  ending at `L15`, and the two edges that actually move code into the canonical repository are the
  only ones with no audit row.
- **The landed head is not recorded.** `head_sha` remains null in the session row after a
  successful landing, so the landed revision is recoverable only from Git or from the candidate
  column.

Neither affected this pilot's evidence: the landing is provable from canonical HEAD, the
lifecycle state, and the `journey_passes` gate row.

## An intermittent test, named rather than smoothed over

During the post-pilot suite run, one simulation case — *"a host killed AFTER the release leaves
the provider's side effect behind — the control"* — failed once and then passed on four
consecutive re-runs. It is a timing-sensitive crash-injection case, unrelated to this pilot's
change or to the landing. The suite is green; the flake is real and is on the record.

## Nothing was deleted, nothing was pushed

No file, branch, ref, worktree, journal, or attempt record was deleted at any point during either
pilot. The superseded attempt from the earlier tier-2 run is preserved unmodified, including its
review artefacts. Nothing was pushed: both repositories' remotes are untouched and `main` simply
sits ahead of its upstream locally. No credential was accessed, no dependency changed, and no
external system was mutated.
