# Pilot 1 — a real T1 task, landed

**Outcome: LANDED.** The factory performed a real, owner-named job within its T1 ceiling,
showed it live before it finished, and moved canonical HEAD only through a human at a TTY.

## Task and scope

A bounded, read-only differential survey of a released agent-sandbox project against AWSF's
own sandbox, permission, process, persistence, portability, observability, and human-control
contracts at current HEAD. Reference material (transcript, 39 screenshots, a source clone
pinned at `92f1701`) was read strictly read-only; nothing was installed or executed.

Scope was **specs-only and trivially reversible**: the landed change is one file,
`specs/awsf-plan.html`, **8 insertions and 0 deletions** — a single Amendment recording the
comparison. The survey concluded that no net-new task was earned and added none.

## Identity

| | |
|---|---|
| Task | `pilot-1-sandbox-survey-claude` |
| Attempt | 2 (attempt 1 cancelled — see call accounting) |
| Session | `21c850f8-93d7-45a5-bc74-5e1944bec51b` |
| Workflow / tier | `build` / T1 |
| Base SHA | `51fe6d95201060afa99751031421a9cbfeff804e` |
| Candidate SHA | `99974f3f92b248df71c0bca4256cb5a77c304c72` |
| Landed SHA | `99974f3f92b248df71c0bca4256cb5a77c304c72` (identical to candidate) |

The driving prompt pinned base `830a71e4`. Canonical HEAD had advanced to `51fe6d9` — the
owner's own purely additive docs commit, a direct child of that pin, with all markers
provably untouched. The owner authorized proceeding from the newer base rather than
resetting canonical backwards.

## Route

- **Driver:** Claude Code (`--model opus --effort medium`), owner-side.
- **Worker adapter:** `claude-code` over the Anthropic subscription surface.
- **Requested selector:** `claude:opus` → placed on the command line as `opus`.
- **Resolved model:** **`claude-opus-5`**, provenance **`stream-authoritative`** — taken from
  the provider stream, never inferred or substituted.
- **Fallback:** none. The config declared a single adapter with `no_fallback`, so
  cross-provider substitution was structurally impossible.
- **Sandbox grant:** `tool-policy` / `adapter-tool-policy` — the truthful grant on a host
  without `bwrap`, read from the broker rather than inferred from the adapter name.

## Calls by category

**Fresh-run total: 2 of the 3-call T1 ceiling.**

| Category | Calls |
|---|---|
| Builder (attempt 1, lost to host failure) | 1 |
| Builder (attempt 2, produced the landed candidate) | 1 |
| Review | 0 |
| Automatic correction | 0 |
| Owner rework | 0 |
| **Total** | **2** |

Attempt 1's call bought no candidate. The host's WSL2 filesystem exhausted its backing disk
mid-run and remounted read-only, killing the worker mid-tool with no envelope and no
surviving process. Attempt 1 was cancelled at a TTY (`survivors []`; no signal was sent,
because the recorded start identity no longer matched the reused pid). `awsf retry` then
minted attempt 2 **carrying** the spent call, so the ledger read 2 of 3 rather than
resetting — a crash does not refund quota.

## Tokens and cost authority

Provider-authority usage for the landing call (`usageAuthority: provider`):

| Field | Value |
|---|---|
| Input | 464 |
| Output | 21,559 |
| Cache read | 2,158,881 |
| Cache write | 119,314 |
| Reasoning | 8,304 |

**Cost authority: `unavailable` — subscription route.** No dollar figure is rendered, and
none was estimated. Attempt 1 recorded no usage at all, having died before its result event.

## Duration

| Phase | Window |
|---|---|
| `request` | 02:31:22.538Z → 02:31:22.585Z |
| `builder` | 02:31:24.301Z → 02:37:55.521Z (6m 31s) |
| `tests` (host gates) | 02:37:55.852Z → 02:38:30.117Z (34s) |
| Landed | 02:53:07.142Z |

## Gates

**Configured (host-run, against the exact candidate SHA):** 9/9 passed — `envelope_valid`,
`artifacts_exist`, `json_parses`, `no_protected_paths`, `diff_matches_claims`,
`writes_within_globs`, `head_advanced`, `candidate_hygiene`, and `commands_pass`
(`npm run test:unit` exit 0, `npm run lint` exit 0, worktree clean before and after).

**Independent (reproduced separately, treating the envelope as a claim):**

- Full suite in the candidate worktree: **954/954 green** — 812 unit, 45 contract,
  55 simulation, 42 journey, 0 failures.
- Repository typecheck compared against base: **697 diagnostics at base, 697 at the
  candidate, diagnostic lines identical** — no new diagnostic. The documented declaration
  baseline was deliberately not repaired.
- `git show --check` clean; base is the candidate's exact parent.
- Protected regions byte-identical to base: `specs/tickets/T29.md`, the M8 block, the
  acceptance file, the build-prompts file, and all 20 tickets.
- The envelope's declared change set matched the host diff exactly.
- Every source citation in the landed survey was checked at its cited location — in this
  repository and in the pinned read-only clone — and each resolved to what the text claims.

## Live dashboard

`awsf dash` served the machine-local read-only view throughout. The owner watched state and
timeline advance, the builder lane appear, and activity accumulate **while the run was still
in flight**, and confirmed it directly. This is recorded from observation, not inferred from
the finished journal.

An earlier attempt at this proof was correctly refused by the owner, who reported seeing
nothing live. The cause was a driving-session error — a command delivered into a pane whose
foreground process was a `tail -f`, so the run never launched — not a dashboard defect. The
projection truthfully showed `prepared · calls 1/3 · no recorded activity yet`, which is
exactly what an unstarted run should look like. Nothing was claimed until the genuine run
was confirmed.

## Landing

`awsf land … --attempt 2` was run by the owner in an interactive terminal. The owner
inspected the gate — candidate SHA, summary, and a fast-forward meter reading *ahead 0,
behind 1* — and typed the confirmation. The host never answered it.

Result: `LANDED`. Canonical HEAD moved by **local fast-forward** to exactly
`99974f3f92b248df71c0bca4256cb5a77c304c72`, single parent, no merge commit, clean checkout.

## Nothing was deleted, nothing was pushed

No file, branch, ref, worktree, journal, or attempt record was deleted at any point. The
prior run's journals are preserved unmodified. Nothing was pushed: the remote is untouched
and `main` simply sits ahead of `origin/main` locally. No credential was accessed, no
dependency changed, and no external system was mutated.

## Historical disclosure — the earlier pre-repair run

Separately from the fresh run above, and **not counted in its totals**: before the factory
defects were repaired, task `pilot-1-sandbox-survey` consumed **three GPT calls** on
`gpt-5.6-sol` across attempts 1–3, ending `BLOCKED`, `CANCELLED`, `CANCELLED`. It **never
landed**. Its journals are preserved unmodified.

Those three calls belong to a different task id and a pre-repair factory. The fresh,
owner-authorized rerun under a new task id was a transparent restart after prerequisite
repair — not a hidden budget reset. Both records stand; neither is merged into the other.
