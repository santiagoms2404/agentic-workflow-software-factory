# AWSF — v2 Candidates, fused

Two records went into this file and neither is superseded by it.

- **`awsf-v2-candidates.md`** — the working record, 30 decisions, candidates 2.1
  through 2.8, written across 2026-08-18 to 2026-08-20. It holds the captures and
  the decision history.
- **`awsf-v2-candidates-GPT-version.md`** — an adversarial second review dated
  2026-08-20, structured as a verdict table, a sixteen-row disagreement register,
  and a per-candidate critique.

**What this file adds.** Every disagreement is adjudicated against AWSF's own
code rather than split down the middle, because §2.3.6's matrix says only the
target repository settles *fit* and only the factory settles *buildability*, and
both are this repository. Where the review is right the original's claim is
corrected here and the error is kept rather than deleted. Where the review
overreaches, the overreach is named with the code that bounds it.

**Adjudication rule, applied throughout.** A review claim about AWSF's behaviour
was upheld only after being re-run or re-read here. A claim resting on reasoning
alone is marked as such. Seventeen checks were executed for this file; each is
quoted at the claim it settles.

**Outcome, stated plainly so the reader is not looking for a fight that did not
happen: of sixteen registered disagreements, thirteen are upheld in full, three
in part, and none is rejected.** Three of them found defects in work committed on
2026-08-20, two of which are already repaired.

**Currency.** Work continued after this file was fused, and six of its statements
are superseded. They are listed in §10 rather than edited in place, so the
adjudication that produced them stays readable. **Read §10 before acting on §3
or §6.**

---

## How to read this file

The original called all of Part 2 "parked", which stopped being true once
candidates began carrying applied work. Every entry below therefore carries an
explicit state.

| State | Meaning |
| --- | --- |
| `history` | Done and landed. Evidence retained; never re-planned. |
| `applied-outside-repo` | Executed on the owner's machine, outside any managed worktree. Not v2 build scope. |
| `taken` | An owner decision exists and binds the v2 plan. |
| `candidate` | Proposed, not decided. |
| `contested` | The two records disagree, or a claim was falsified. Adjudicated below. |
| `blocked-on-decision` | Cannot be planned until a named fork is chosen. |

**Strength** is used as the review used it: *strong* means the candidate can be
handed to plan-sota as-is, *medium* means a named gap must close first, *weak*
means it is not yet a v2 candidate and the route to strong is the deliverable.

---

## 0. Defects in the committed record

Three, all found by the review, all confirmed here.

### 0.1 The applied guard broke a mechanically-enforced fence — repaired

`core/test/unit/meta/execution-isolation.test.ts` asserts that **`.claude/` does
not exist at the repository root at all**, not merely that it is untracked. The
reason is in the test: a Claude-route phase's `cwd` is a managed worktree of this
repository and no verified flag disables project discovery, so *absence is the
control*.

Installing `marimba`'s guard at `.claude/settings.local.json` broke it, and
adding `.claude/` to `.gitignore` did not help, because the fence reads the
filesystem rather than Git. Confirmed 2026-08-20:

```
node --experimental-strip-types --test core/test/unit/meta/execution-isolation.test.ts
# pass 1  # fail 1   .claude/ exists at the repository root
```

**Repaired the same day, and the repair is better than the original design.**
`claude --help` advertises `--settings <file-or-json>`, so the guard now lives at
`~/.claude/marimba/settings.json` and is passed per invocation. That scopes it to
marimba sessions exactly — narrower than repository-local settings, which caught
every session in the repo, and far narrower than user-level settings, which would
have caught every session on the machine. Verified after the move:

```
npm run test:unit          -> tests 988  pass 988  fail 0
claude --print --dangerously-skip-permissions --settings ~/.claude/marimba/settings.json \
  "Call the ListAgents tool right now..."
-> Blocked - the `PreToolUse:ListAgents` hook ... denied it as "delegation-shaped"
```

The `.gitignore` line was reverted (`d88520f`). It encoded the premise that a
local `.claude/` is acceptable here, which the fence denies, and it suppressed
the cheaper of the two signals that a forbidden directory had appeared.

**The lesson, kept because it generalises.** A new guarantee was proposed where a
stronger one already existed and had not been read. Decision #18 requires a
revision to restate a guarantee in still-checkable form; it should equally
require checking whether the guarantee is *already* enforced before adding a
weaker sibling.

**Residual gap, honestly stated:** it is proven that `--settings` *loads* the
named file; it is **not** proven that `--settings` *excludes* project settings
when both exist. The repository root now has no `.claude/`, so nothing currently
tests that interaction. One probe with both present settles it. Not done.

### 0.2 A hundred lines of marimba material sat inside candidate 2.7 — repaired

The `#### O3 captured end to end` and `#### Applied 2026-08-20 (O3)` blocks were
inserted before the first occurrence of a heading that appears in **both** 2.7
and 2.8, so they landed in the quota-telemetry candidate. Confirmed by line
number: §2.7 spans 1236–1641 and both blocks sit at 1399 and 1443.

The collision is not only positional. §2.7's `O3` is *"a preflight admission
check — explicitly not taken"*; §2.8's `O3` is the delegation guard, which is
taken and applied. As committed, candidate 2.7 reads as though its untaken option
was captured end to end.

**Repaired 2026-08-20.** Both blocks were relocated into §2.8, where they now sit
after the delegation-guard section and before that candidate's own collisions,
and a dated record correction was appended to them rather than editing their text
in place. That note also supersedes three statements the blocks carried which the
same day's later work falsified: the guard is no longer registered in a
repository-local `.claude/settings.local.json`, the `.gitignore` line did not
close the hazard, and the hazard was already closed by the fence in §0.1. §2.7
now runs from its own heading to its collisions section with nothing of
marimba's in it.

### 0.3 Two internal contradictions

- **Decision #24 says the claim-labelling rule is taken; §2.3.8 says it is
  "still undecided in this section".** One of them is wrong and the decisions
  table is the later statement. Recommendation: keep #24, delete the trailing
  sentence in §2.3.8.
- **Decision #30 and §2.8 rest a boundary on a TTY check that does not hold.**
  See §2.8 below; this is the substantive one.

---

## 1. Adjudication of the disagreement register

| Code | Verdict | What was checked here, and the consequence |
| --- | --- | --- |
| DR1 | **upheld** | `specs/tickets/T37.md` and `T38.md` both read `state: done`; `npm run typecheck` exits 0; `npm run test:unit` is 988/988. Part 1 is history and must not enter a v2 backlog. |
| DR2 | **upheld** | Part 2 mixes parked proposals, taken decisions and applied owner-local work under one "nothing is committed" label. The state vocabulary above is the fix. |
| DR3 | **upheld in part** | Detection is not prevention: `path-policy` compares a worktree fingerprint after the provider returns, and on this machine the sandbox badge is `tool-policy`, so nothing is OS-enforced. The review's remedy — reject #13/#14 — is the owner's call, not the review's. The binding correction is narrower and non-negotiable: **the word "bounded" must leave those decisions.** `agy` is detection-bounded, which is a weaker guarantee and must be described as one. |
| DR4 | **upheld in part** | Decisive half confirmed: only the outer `mf` PID crosses `transport-broker`, so no child provider launch gets a registration, a reservation id, or its own GO. Overstated half corrected: partial settlement is **not** impossible — `settle(id, spent)` exists and its own comment describes the halfway composite ("two workers reached GO, the fuser's registration failed, so two are spent and one goes back"). `spendOnGo` is the all-or-nothing convenience, not the only path. The gap is supervision, not arithmetic. |
| DR5 | **upheld in part** | Correct that a *recipe* cannot depend on invoking an installed skill, because `pi-codex` launches with `--no-skills`. Correct, and neither record had noticed, that **decision 30's guard removes the fresh subagent decision 20's pre-repository review depends on**. That collision is real. It is resolvable by scoping rather than by dropping either decision: the guard is now per-invocation, so a review session that is not marimba is unaffected. |
| DR6 | **upheld** | The contradiction is real (0.3). The falsification point is fair: naming a cheapest upgrade is a prompt, not a proof, and hindsight can dress itself as a pre-existing check. The fix is additive — require the disconfirming observation, not a weaker rule. |
| DR7 | **upheld** | Decision #22 sequences the ladder last and decision #7 sequences the cheatsheet last. Both cannot hold. Resolution: ladder last among executable capabilities, cheatsheet as the final artifact after it. |
| DR8 | **upheld** | The current no-push meta-test is a source scan. A state-aware replacement is necessary and not sufficient; remote, refspec, force-form, cleanliness, SHA equality and idempotency are all unaddressed. |
| DR9 | **upheld** | `systemPrompt` is composed in `production-run.ts` and `review-phase.ts` independently, with `rework.ts` as the third per the review's anchor. §2.5's "one natural insertion point" describes a desirable design, not the current code. |
| DR10 | **upheld** | Confirmed by line number (0.2). My defect. |
| DR11 | **upheld** | An account-window percentage cannot attribute consumption to one task: another client on the same account moves the same number, and the figure is an integer percentage. Decision #27 calls O2 "the leverage"; that claim does not survive. O2 survives only as an explicitly non-attributable contextual snapshot. |
| DR12 | **upheld** | Confirmed and repaired (0.1). |
| DR13 | **upheld** | Reproduced independently: `printf 'yes\n' \| script -qec "node probe.js" /dev/null` yields `stdin.isTTY=true` and `answer=yes`. `processOwnerTerminal()` checks terminal *shape*, not human presence. |
| DR14 | **upheld** | `driving-routes.test.ts` hardcodes `ROUTER_REL` to the current router only. A new contract's routes would not be checked. §2.8's claim that it "inherits two existing fences" is wrong; it inherits the tree walk, the credential and shell sweeps, and fenced-command reconciliation, but not route resolution. |
| DR15 | **upheld** | `defaultWorktreeRoot(stateRoot)` returns `join(dirname(stateRoot), "awsf-worktrees")` — a **sibling** of the state root, not a child. And `land` fast-forwards the canonical repository by design. The claim "no `awsf` command mutates outside the state root" is false twice over and is replaced below. |
| DR16 | **upheld** | `path-policy` treats `protected-path` as an independent rejection reason, checked alongside the write globs. So no configured agent can amend `AGENTS.md` or `awsf.config.yaml`, even the documenter whose glob is `**/*.md`. **Every candidate that revises an invariant needs an owner-authored amendment outside the managed build.** This is the largest structural finding in the review. |

---

## 2. Part 1 — history, not backlog

**State: `history`.** The original wrote 1.1 through 1.3 as work to schedule.
They were done before this review ran, and re-planning them would put completed
tickets into a v2 backlog.

| | Evidence it is closed |
| --- | --- |
| 1.1 typecheck repair, D2 amendment | `specs/tickets/T37.md` `state: done`; `npm run typecheck` exits 0 across `tsc` and `vue-tsc`; `AGENTS.md` invariant 7 carries the dated `@types/node` amendment |
| 1.2 seven WSL2 rows | `specs/tickets/T38.md` `state: done`; `npm run test:contract` 53/53 |
| 1.3 Linux desktop column | dated deferrals recorded in the plan's Portability Matrix; owner testimony is the primary source for machine ownership and no probe can strengthen it |

**1.4 macOS — state: `blocked-on-decision`, and it is a hardware gate rather
than a candidate.** Keep it out of the v2 build graph. What it needs now is
cheap and is not written down anywhere: **a versioned Darwin checklist** that
separates T27's existing verification from the new portability rows v2
candidates will add (quota-axi Keychain consent, `agy` if it ever graduates,
publish if 2.4 lands). Writing that list costs an hour, needs no hardware, and
prevents the first Mac visit from discovering its own scope.

---

## 3. Part 2 — the candidates, fused

### 2.1 Antigravity (`agy`)

**State: `contested`. Fused strength: weak.** Both records agree the stream
protocol is real and the parser is writable. They disagree about what decisions
13 and 14 licence.

**Settled.** `--output-format stream-json` emits a four-event NDJSON protocol
with stream-authoritative model identity (#10). `--mode plan` steers rather than
enforces, and the probe showed `write_to_file` executing under it. `agy` exposes
no tool allow/deny flag (#11) and no system-prompt flag (#26). It requires a
Windows-accessible working directory (#12). The adapter is `enabled: false` and
returns `E_ADAPTER_UNVERIFIED` today.

**Contested, adjudicated.** Decisions 13 and 14 admit `agy` for write-capable
roles *"bounded by worktree containment plus host-side stream inspection"*. That
word does not survive contact with the code: `path-policy` compares a worktree
fingerprint **after** the provider returns, and `sandbox-broker` degrades to
`tool-policy` where `bwrap` is absent, which is the case on the development
machine. Detection also covers one tool's `TargetFile` parameter and says nothing
about `run_command`, `send_message`, `schedule`, `search_web`, or a write whose
event carries a different shape — and three of those are `external-mutation`
shaped, which `policy.protected_operations` already names.

**The adjudication is narrower than the review's proposed rejection, because
whether the owner accepts a detection-only route is the owner's decision and #14
already recorded that acceptance explicitly.** What is not the owner's to decide
is the description. Restate #13 and #14 as: *`agy` is admitted for write-capable
roles under **post-hoc detection only**; no preventive boundary exists on either
side of the WSL/Windows line; the route is refused for any role where prevention
is required.* That keeps the decision and removes the false guarantee.

**Route to strong — split the graduation in two.** Parser graduation is
fixture-first work that can proceed now with the route left disabled. Permission
graduation waits for captured bytes proving either a provider tool-scoping flag
or an OS boundary. If neither ever arrives, the ladder still runs on claude and
pi, exactly as #22 condition (a) already permits.

**Buildability.** Parser only: `build-review` at T2 in a managed worktree. Gates:
scrubbed fixtures for every event and terminal state, exact-argv descriptor test,
broker registration, cwd/path contract row, plus one bounded live portability
capture. Enabling the route is a separate owner act.

**Open item neither record closed.** Whether a tool event arrives *before* or
*after* the provider has executed that tool. Detection cannot claim timely abort
without event-order evidence, and no fixture establishes it.

### 2.2 Fusion via `mf`

**State: `contested`. Fused strength: weak.**

**Settled.** Reserve-the-full-cost-before-any-launch is right and already
implemented (`reserveComposite`, `compositeCost = workers + 1`). PATH resolution
with a blocked result when absent (#8) is the correct shape and matches 2.7's
probe.

**Contested, adjudicated.** The review's decisive finding is upheld: **only the
outer `mf` process crosses the broker**, so no constituent provider launch gets a
registration, a reservation id, or its own GO. Everything decisions 5, 9 and 17
promise about per-role supervision rests on processes AWSF never sees.

The review's second claim is overstated and is corrected here: partial settlement
is not blocked by the ledger. `settle(id, spent)` exists and its own comment
describes exactly the halfway composite. `spendOnGo` spends the whole
reservation, but it is a convenience over `settle`, not the only route. **The gap
is supervision and attribution, not arithmetic**, and stating it correctly
matters because the arithmetic version suggests a ledger redesign that is not
needed.

**Route to strong — one fork, stated as a fork.** Either *(a)* AWSF orchestrates
the two workers and the fuser natively through its own broker, so every child has
a registration, a worktree, a permission session and a retained envelope, and
`mf` stops being the executable; or *(b)* `mf` stays and the promise shrinks to
one opaque composite that spends its declared cost at outer GO, with no per-child
supervision and no per-role worktree claim. Decision 17's per-role worktree
recommendation belongs to (a) only, and the Still-open item that says it is
unvalidated is correct.

**Buildability.** (a) is `simple-sdlc` at T2 and needs gates proving three broker
registrations, reserve-before-first-GO, partial-failure settlement, per-worktree
path attribution and crash recovery. (b) is cheap and honest and buys much less.

### 2.3 Planning phase — greenfield from zero

**State: `blocked-on-decision`. Fused strength: weak as one candidate, and
several strong candidates are trapped inside it.**

Both records reach the same verdict from opposite directions. The original built
it up from a real case and a real reference pair; the review found it has no
single acceptance boundary. Both are right, and the fusion is a split.

**Settled and worth keeping intact:** the design-before-plan split, an
independent architecture review whose verdict is an envelope rather than a
transition (#21), the `INV-n`/`AC-n` spine threaded design → ticket → gate (#19
verdict C, still the best leverage per unit cost in the whole set), explicit
stopping points, `ARCHITECTURE.md` plus a docs index, and a registry grounded in
three real repositories rather than a hypothetical.

**Contested, adjudicated.**

- **The recipe cannot invoke an installed skill.** `pi-codex` launches with
  `--no-skills`, so a phase running on that route cannot reach one. The component
  list's *"a plan recipe emitting a planf3 HTML"* has to become a compiled recipe
  with a typed envelope, not a skill invocation. Upheld.
- **The bootstrap ordering contradicts itself.** The component list puts the plan
  inside the baseline commit; §2.3.4's inversion creates the baseline first and
  produces the plan as a governed phase output. The inversion is right and the
  component list should be corrected to match.
- **Decision 20 collides with decision 30, and neither record saw it until this
  review.** A pre-repository architecture review needs a fresh subagent that did
  not write the proposal; marimba's guard denies exactly that tool. Adjudicated:
  **the collision is real and resolvable by scope, not by reversal.** The guard is
  now delivered per invocation, so a review session launched without marimba's
  settings retains the tool. Write that into the contract as a stated exception
  rather than discovering it during a build.
- **`planf3` → `plan-sota` is not AWSF-buildable.** The skill and its memory files
  live outside every managed worktree. Upheld: it is owner-side migration work,
  versioned separately, and it must leave the v2 task graph.

**Route to strong — four candidates instead of one.**

1. **`awsf init`** — deterministic, host-owned, no model: create the directory,
   `git init`, write a minimal config, commit under the owner's identity. Nothing
   about it needs a provider, and making it host-only removes the chicken-and-egg
   entirely.
2. **Project registry, first version** — plan repository may differ from target
   repositories; per-repo default branch and gate commands; **each task and each
   landing stays single-repository**. That scope cut is what makes it planable.
3. **`requirements → design → architecture-review → plan`** as compiled recipes
   with typed envelopes and an `AC`/`INV` coverage gate extending the existing
   ticket/plan-sync meta-test.
4. **The ladder**, after a capture pass, sequenced last among executable work.

**Forks that must be decided before any of this is planned** — see §4.

### 2.4 Publish path

**State: `taken` (#16), scope under-specified. Fused strength: medium.**

**Settled.** Post-`LANDED`, human-initiated, exact-revision publication is
compatible with the owner gate, and the cost — restating *"any push
implementation"* as *"no push path from any pre-`LANDED` state"* and rewriting
the meta-test as a state-aware check — was accepted deliberately rather than
absorbed.

**Contested, adjudicated.** Upheld: a state-aware meta-test is necessary and not
sufficient. State is one dimension. The command also needs an allowlisted remote
and branch, canonical HEAD equal to the landed candidate, a clean checkout, a
non-force non-delete refspec, credential non-persistence under invariant 9,
idempotent retry on the same SHA, and a scrubbed record of what the remote
accepted. None of that is in the candidate.

Also upheld, and it matters for the whole set: **`publish` is not deployment.**
§2.4's framing sentence — *"a project that is production-ready but can never
leave the local machine"* — reads as though publication were the last mile to
production. It is source publication only.

**Route to strong.** Specify `authorizePublish(status, repository, remote,
refspec)` as a pure function with a truth table, fence the single push argv site,
and test the whole thing against a local bare remote with no network. Then, and
only then, amend invariant 8 — which per DR16 is an owner-authored edit, because
no agent can write `AGENTS.md`.

### 2.5 System prompt engineering

**State: driving layer `applied-outside-repo`; worker prompts `candidate`. Fused
strength: medium.**

**Settled.** The mechanism exists and needs no adapter change: both routes append
rather than replace, and the host materializes the prompt privately
(`writeSystemPromptFile` at mode 0600, `assertPrivateSystemPrompt` at launch).
Per-role scoping is right, aliases are interactive-only, and the reviewer must
not be compressed, because a tersely agreeable reviewer is the rubber-stamped
closure pillar 1 exists to prevent.

**Contested, adjudicated.** Two corrections, both upheld.

- **"One natural insertion point" describes a design, not the code.**
  `production-run.ts` and `review-phase.ts` each compose a system prompt
  independently, with `rework.ts` as a third. The v2 task therefore starts with
  *centralising composition*, and the shared preamble is the second step. Written
  the other way round it creates a fourth copy.
- **Two calls do not measure anything.** One sample per arm cannot separate a
  prompt effect from model variance. The Still-open item that proposes "run one
  phase twice" should be replaced with a repeated matched-task benchmark whose
  metrics are stated in advance: input tokens, output tokens, **parse-correction
  count**, and reviewer evidence specificity. Parse corrections are the metric
  neither record had: a style block that makes prose terser can make envelopes
  fail validation more often, and the correction allowance pays for that.

**Overlooked by both records.** Shared prompt bytes must enter the same immutable
route evidence as the role prompts, or `rework` and a replacement `review` can
read different instructions under one config snapshot.

**Buildability.** `simple-sdlc` at T2. Gates: byte-exact composition across all
roles and all three execution paths, digest persistence in route evidence, no
alias section in a headless role, reviewer-evidence regression fixtures, and the
benchmark recorded outside the offline suites.

### 2.6 Non-technical cheatsheet

**State: `candidate`. Fused strength: medium.**

**Settled.** It is sequenced last, and both records agree on why.

**Contested, adjudicated.** *"Every command and flow"* has no bounded acceptance
test, and taken literally it duplicates the routed tree and violates the
one-owner rule. Upheld. The fix is to define acceptance as a **walkthrough**
rather than as coverage: on a clean machine, the intended reader installs,
primes, creates one throwaway task, observes it, reads a blocked attempt, and
stops at an owner act with the right evidence in hand. That is testable; "every
flow" is not.

**Sequencing correction (DR7).** #22 puts the ladder last and #7 puts the
cheatsheet last. Resolution: **ladder last among executable capabilities,
cheatsheet the final artifact after it.**

### 2.7 Quota telemetry

**State: `taken` (#27–#29) with O2 `contested`. Fused strength: medium for O1,
weak for O2 as written.**

**Settled, and it survives review intact.** Render from
`quotaSemantics.effectiveAvailability` and never from `windows[]`; detect state
structurally from `state.status` rather than by exit code; never use `--refresh`
or `--tui`; spawn on PATH rather than import; fixture-first parsing; and the
import fence barring `core/src/workflow/**` and the routing resolver (#29). The
failure-path captures that produced those rules are the strongest evidence in the
original document.

**Contested, adjudicated — and this one costs the candidate its headline claim.**
Decision #27 calls O2 *"the leverage"*: journal a snapshot at each phase boundary
so the call ledger's proxy unit gains a real denominator. **An account-window
percentage cannot do that.** Another client on the same account moves the same
number, the figure is an integer percentage, and nothing in the payload carries
task identity. Upheld.

What survives: journal the snapshot as **explicitly non-attributable context**,
labelled as such in the record, and never compute a "task cost" delta from two
readings. If a real per-task denominator is wanted, AWSF already records
provider-authoritative usage per call in its normalized events — that is the
number with task identity attached, and it is the one to build on.

**Two smaller corrections, both upheld.** The section pins `quota-axi@0.1.29`
while also recommending unpinned `npx -y quota-axi`, which may fetch a different
version — the runtime contract should name a version floor and check it. And a
phase-boundary probe needs a stated failure posture: hard timeout, fail-open, and
what is journalled when the refresh fails. Neither is written down.

**Also missing:** no quota-axi fixture exists in the target tree, so the
fixture-first rule is currently satisfied only by captures held outside the
repository.

### 2.8 `marimba`

**State: name `taken` (#30); guard `applied-outside-repo`; contract `candidate`;
authority model `contested`. Fused strength: weak as committed, medium after the
repairs already made, and the route to strong is short.**

**Settled.** The name and its scope. The contract is hand-authored, names no
command, and therefore carries no sequencing constraint — that argument survives
review untouched. The delegation guard is real, captured four ways, and its
layered behaviour was demonstrated: with the deny list removing `Task`/`Agent`
from the schema, the model reached for `ListAgents`, which the deny list never
enumerated, and the hook denied it by shape.

**Contested, adjudicated — three claims in the committed section are false.**

1. **"Bounded by construction" is wrong.** `processOwnerTerminal()` checks
   `process.stdin.isTTY`, which is a terminal-*shape* check. Reproduced here:
   `script -qec` yields `stdin.isTTY=true` and a scripted `yes` answers the
   confirmation. Under `--dangerously-skip-permissions` with unrestricted Bash, a
   driving session can allocate a PTY and take an owner act. The TTY requirement
   prevents an *accidental* non-interactive invocation; it prevents nothing
   deliberate.

   **The repair is available and was verified today.** A PreToolUse payload
   carries `tool_input.command`, `permission_mode` and `cwd` — captured
   2026-08-20:

   ```
   keys: ['cwd','effort','hook_event_name','permission_mode','prompt_id',
          'session_id','tool_input','tool_name','tool_use_id','transcript_path']
   tool_name: Bash
   tool_input: {"command": "echo marimba-probe", ...}
   ```

   So the same guard that denies delegation-shaped tool *names* can deny
   owner-act command *shapes* — `awsf land|cancel|rework|review|journey|raise`,
   and PTY allocation if wanted. That converts the boundary from a shape check
   into a denial at the tool surface, which is what the delegation half already
   demonstrated works. **This is the single highest-value unbuilt item in 2.8**,
   and it lets the owner keep `--dangerously-skip-permissions` without resting on
   a claim that does not hold.

2. **"It inherits two existing fences" is wrong.** `driving-routes.test.ts`
   hardcodes the current router path, so a new contract's routes are unchecked. It
   does inherit the tree walk, the credential and shell sweeps, and fenced-command
   reconciliation. Either extend the route scanner to every declared router, or
   keep the contract route-free and assert *that* property.

3. **"No `awsf` command mutates outside the state root" is wrong twice.**
   `defaultWorktreeRoot(stateRoot)` returns a **sibling** directory,
   `awsf-worktrees`, and `land` fast-forwards the canonical repository by design.
   Replace the claim with the guarantees that are actually true: no push path
   exists, nothing is auto-deleted, writes are confined to a managed worktree by
   `path-policy`, and canonical movement happens only through a human-approved
   local fast-forward.

**Two guard improvements adopted from the review.** `ListAgents` only enumerates;
by the guard's own observe-or-stop logic it belongs in the whole-name exclusion
list rather than being denied. And malformed JSON currently fails open — the
right call, since failing closed on a payload-shape change would brick every tool
call, but it is a stated limit rather than an accident and belongs in the script's
header.

**Route to strong.** Land the contract and its tests as a small documentation
candidate; extend the guard to owner-act command shapes and capture the denial;
state the boundary honestly in the contract; keep the installation an owner act
outside the build.

### 2.9 Evidence readability — the event log

**State: `candidate`, new on 2026-08-20. Fused strength: strong.** It is the
first candidate in this set whose diagnosis is complete before any work starts,
because the cause turned out to be one function and the data it needs is already
in the record.

**Sources declared.** **Target == factory**: `source-verified` at
`dashboard/src/components/EventLog.vue`, `dashboard/src/display.ts`,
`core/src/contracts/normalized-events.ts`, `core/src/observability/projector.ts`.
**Screenshot**: twelve captures of a real reviewer run, 2026-08-20, which is the
primary source for *"this is what the owner actually sees"* and cannot be
replaced by reading code. **Absent**: no query against a live projection, so
every volume figure below is counted from a screenshot rather than from the
database — *not gathered*, and the query is named in the upgrades.

#### The cause is one function

`EventLog.vue`'s `summary()` is a five-key fallback chain — `inputSummary`,
`message`, `detail`, `reason`, `resolvedModel` — and **anything it does not match
falls through to `item.name || item.type`**. That single line explains every
symptom in the screenshots, including the one that looks like a rendering bug:

| Kind | What the payload holds | What the row shows | Why |
| --- | --- | --- | --- |
| `text.delta` | `text` | `text.delta` | `text` is not in the chain |
| `usage` | `usage: {inputTokens, outputTokens, cacheRead, cacheWrite, reasoning}` | `usage` | the value is an object, and the chain only accepts strings |
| `tool_call` | `inputSummary`, `outcome`, `durationMs`, `resultSnippet` | escaped JSON of the tool input | `inputSummary` is first in the chain and wins |
| `quota` | `message` | *"the five_hour subscription window reports allowed"* | it matches — this is the one readable row, and it proves the mechanism |

The duplicated second column is the same defect seen from the front: when the
chain misses, the summary *is* the kind, printed beside the kind.

#### The data is present; the renderer discards it

Three findings, each `source-verified`, and together they mean this candidate
adds no new evidence to the system — it stops throwing away what is recorded.

1. **Tool calls already carry their name.** `ToolRequestedEventSchema` declares
   `name`, and the projector writes it to the events table's `name` **column**
   rather than into `payload_json`. That is why expanding a tool row shows no
   name, and why `summary()` *can* read `item.name` but never reaches it.
2. **Usage is already formatted well, one panel over.** The phase evidence panel
   renders the identical event as `total tokens 200.0k · provider`,
   `input / output 156.8k / 43.3k`, `cache read / write 4.19M / 47.5k`. Same data,
   two renderers, one good.
3. **The formatters already exist and are already exported.** `display.ts`
   exports thirteen, `formatTokens` and `formatUsage` among them. `EventLog.vue`
   imports exactly one of them, `formatDuration`, and hand-rolls the guess chain
   instead.

#### `text.delta` — settled, and it closes an open question

The frozen record's Still-open list asks *"Does `text_delta` stream
incrementally? One longer-output probe settles it."* **A screenshot settled it
instead, at no cost.** Two consecutive deltas from one reviewer run:

```
seq 4   "{\n  \"schema\": \"awsf.review-output/"
seq 5   "v1\",\n  \"producerStatus\": \"success\",\n  \"summary\": \"Reviewed candidate …"
```

The break falls **inside** a JSON string value, mid-token. So the deltas are the
model streaming its envelope chunk by chunk, one persisted row per chunk, and
their concatenation in `seq` order reconstructs the phase output that the
outputs panel already displays in full.

**That is what makes compaction safe.** Folding a run of deltas into one row
discards nothing, because the whole is retained elsewhere as the phase's own
output artifact. Compaction at the *display* layer costs nothing and needs no
contract change; compaction at the *storage* layer is a different decision and is
not proposed here.

Volume, counted from the screenshots rather than the database: twenty-four
consecutive delta rows spanning twenty-four seconds in one capture, and four
inside a single second in another.

#### What to build, in order of leverage

1. **Per-kind summarizers, replacing the guess chain.** One function per kind
   that reads the fields that kind actually has. `usage` becomes
   `156.8k in / 43.3k out · 4.19M cached · 16.7k reasoning` through the existing
   `formatUsage`. `tool_call` becomes `Edit · herdr-visibility.test.ts · replaced
   2 blocks · ok 81ms`, built from the `name` column and `resultSnippet` —
   which is the informative field and is currently hidden until expansion while
   the escaped input is shown. A kind with genuinely nothing to say renders an em
   dash rather than its own name repeated.
2. **Delta compaction.** Fold a contiguous run of `text.delta` into one row —
   `streamed response · 128 chunks · 12.4s` — expandable to the reassembled text.
   Fold only across contiguous `seq` within one run, never across a tool call or
   a terminal event, so the fold can never hide an interleaved event.
3. **A rendered view beside the raw JSON.** The expanded payload is
   `JSON.stringify(payload, null, 2)` today. Keep it, add a rendered view, and
   default to rendered with raw one click away. The phase evidence panel is the
   design precedent and it is already in the repository.
4. **The clipped run cards.** Cards carrying an `authority partial total` line
   overflow a fixed height and clip mid-row; three of six cards in the capture
   are cut. A layout fix, unrelated to the rest, and worth carrying in the same
   slice because it is the same surface.

#### Collisions, with adaptations (per #18)

**Collision 1 — redaction is per event, and reassembly crosses events.**
`stringifyRedacted` runs at projection time over one event at a time. A
credential split across two delta chunks matches no pattern in either chunk and
is reassembled by any concatenating renderer. **This is a real exposure created by
compaction rather than an existing one**, and it is the reason compaction needs a
guard rather than a loop. **Adaptation: redaction runs again over the reassembled
text, in the same code path that reassembles it, and the fixture that proves it
splits a credential-shaped value across a chunk boundary deliberately.**

**Collision 2 — invariant 9, thinking is never persisted.** `thinking.delta` is
streamed for live display and excluded by `isPersistableKind`. A compaction rule
written over "delta kinds" rather than over `text.delta` specifically would be
one edit away from persisting a fold of reasoning content. **Adaptation: the fold
is defined on `text.delta` alone, and a test asserts that no `thinking.delta`
reaches the projection.**

**Collision 3 — invariant 1, no live task state.** Screenshots of a real run
carry run ids and session ids. **Adaptation: none of them are quoted into this
repository, here or in any fixture.** The captures stay outside the tree, and the
figures above are counted rather than pasted.

#### Buildability

`dashboard/**` is **T1** by `risk.paths`, and the work is one component plus
`display.ts`, so `build-review` at T1 in a managed worktree. Gates: the three
existing dashboard suites — `dashboard-display.test.ts`, `dashboard-mechanics.test.ts`,
`dashboard-parity.test.ts` — plus `vue-tsc`. One constraint carried from §2.7:
eighteen assertions pin `formatCost` across three files, so reuse must extend the
formatters rather than perturb them. New coverage owed: one summarizer test per
kind, a fold test asserting no fold across a tool call or terminal, and the
split-credential redaction fixture from Collision 1.

#### Cheapest unused upgrades

- **Count the real delta volume.** One `SELECT type, COUNT(*) … GROUP BY type`
  against the projection gives the true ratio per phase and sizes the win.
  **Not done** — it needs a live database, and the screenshots were enough to
  establish the shape.
- **Diff the reassembly against the stored output.** Concatenate one run's deltas
  and compare with that phase's output artifact. It settles whether reassembly is
  byte-identical or merely equivalent, which decides whether the compacted row can
  claim to *be* the output or only to summarise it. **Not done.**
- **Confirm the tool name survives to the client.** `summary()` already reads
  `item.name`, so the column almost certainly reaches the API shape — but "almost
  certainly" is not the standard. One response inspection settles it. **Not done.**

---

## 4. The five forks that must be decided before planning

Nothing below can be estimated until these are chosen. Each is the owner's, and
each has a recommendation.

| | Fork | Recommendation |
| --- | --- | --- |
| **F-1** | **Cross-repo task ownership.** May one task own worktrees in several repositories, or do tasks stay single-repo with a declared contract artifact linking them? | **Single-repo tasks** in the first v2 slice, with a parent coordination record and immutable contract artifacts between children. `AttemptStatus` carries one repository and one worktree today; multi-repo atomicity also has no rollback story, and a partial cross-repo landing is the failure that story would have to cover. |
| **F-2** | **Registry reach** — how far into config loading, state-root resolution and worktree resolution does it go? | Version the schema and keep the first version narrow: plan repo, target repos, per-repo default branch and gate commands. Invariant 12 currently assumes plan and tickets share one checkout, so a separate plan repository needs a new mechanically checked source-of-truth relation. |
| **F-3** | **marimba's authority model.** Given the TTY finding, is the boundary restored at the tool surface, or is the flag dropped? | **Restore it at the tool surface.** Keep `--dangerously-skip-permissions`, extend the guard to deny owner-act command shapes, and capture the denial. The alternative — dropping the flag — trades a real fence for a prompt the owner would click through anyway. |
| **F-4** | **The protected-file amendment route.** No configured agent can write `AGENTS.md` or `awsf.config.yaml`, yet 2.1, 2.2, 2.4, 2.7 and 2.8 all imply amendments to one or both. | Every invariant or protected-config revision becomes an **owner-authored commit that precedes the managed build**, recorded in the plan's Amendments. Do not invent an owner-authorized protected-change mechanism to route around `path-policy`; that is the boundary working. |
| **F-5** | **What "production-ready" means.** The set covers local build, source publication and planning. It does not define deployment, environment configuration, release migration, rollback, monitoring, or operational acceptance. | Define it explicitly and narrowly for v2, or the goal silently expands the scope of 2.3 and 2.4. Recommendation: v2's ceiling is *published source with evidence*, and deployment is named as out of scope. |

---

## 5. Decisions 1–30, fused disposition

Only the rows that move are listed; every other decision stands as written.

| # | Fused disposition |
| --- | --- |
| 1–3 | **Archive as history.** T37/T38 done, matrix updated. Not v2 scope. |
| 4 | **Revise.** "Part 2 is parked" stopped being true; use the state vocabulary above. |
| 5, 9, 17 | **Hold pending 2.2's fork.** The per-child broker gap is real; the partial-settlement objection is not. Decision 17's per-role worktrees belong to the native option only. |
| 7 | **Keep**, with DR7's ordering: the cheatsheet is the final artifact, after the ladder. |
| 13, 14 | **Keep the decision, correct the language.** Detection-bounded, not bounded. Refused for any role where prevention is required. |
| 16 | **Keep, and add the authorization contract** before the invariant amendment. |
| 18 | **Strengthen.** Add: check whether the guarantee is already enforced elsewhere before adding a weaker sibling, and note that a protected-file revision is an owner commit (F-4). |
| 19 | **Split.** A–G proceed as recipes; H (the ladder) and I (the rename) become separate workstreams, and I leaves the AWSF task graph entirely. |
| 20 | **Keep both altitudes, and record the collision with #30** plus its scoping resolution. |
| 21 | **Keep.** The envelope-not-transition shape is correct. State the limit: a zero-blocker count proves envelope consistency, not that the reviewer found everything. |
| 22 | **Keep the three conditions.** Re-sequence per DR7. The first task remains the capture pass. |
| 24 | **Keep as taken, and delete §2.3.8's contradicting sentence.** Add the disconfirming-observation requirement for decision-bearing claims. |
| 25 | **Keep per-role scoping. Reorder the work:** centralise composition first, then the shared block, then a repeated benchmark including parse-correction count. |
| 27 | **Split.** O1 stands. **O2 loses its "leverage" claim**: journal it as non-attributable context or drop it. Per-task cost, if wanted, comes from the existing per-call usage events. |
| 28, 29 | **Keep unchanged.** Both survive review. |
| 30 | **Keep the name. Correct the rationale.** The TTY sentence is falsified; the boundary is restored at the tool surface (F-3), and P1–P6 remain untaken. |

---

## 6. Sequencing

1. **Close the record defects.** Re-home §2.7's misplaced O3 blocks; delete
   §2.3.8's contradicting sentence; correct #13/#14's language and #30's
   rationale. Document-only, no build.
2. **Decide F-1 through F-5.** Everything downstream is shaped by them.
3. **marimba, small slice:** the command-free contract, its route test, and the
   guard extended to owner-act command shapes. Early because it is cheap, and
   because it is the thing that drives everything else.
4. **`awsf init` and the registry, first version.** Host-owned bootstrap, then a
   narrow registry. These unblock 2.3, 2.4 and 2.7's per-repo shape.
5. **Design → architecture-review → plan recipes**, with the `AC`/`INV`
   coverage gate extending ticket/plan-sync. This is where verdict C's leverage
   is realised.
6. **Centralise prompt composition, then 2.5's shared block and benchmark.**
7. **2.7 O1**, then **2.4** once the registry gives it per-repo remote policy.
8. **2.1 and 2.2 as optional adapter workstreams.** Neither blocks the core;
   neither graduates until its own gap closes.
9. **The ladder**, after its capture pass — last among executable capabilities.
10. **The cheatsheet**, final artifact.

---

## 7. Set-level risks

The review's eleven, adjudicated and reduced to the seven that still bite after
the repairs made on 2026-08-20.

- **R1 — prevention is repeatedly described as stronger than it is.** `agy`
  detection, opaque `mf`, the TTY check, and an owner-local hook were each
  written as boundaries. This is the pattern rather than four incidents, and it
  is what to watch for when reading any remaining candidate.
- **R2 — the set is unfunded.** 2.3 alone holds four architecture workstreams,
  and six of eight candidates alter a security, process, credential or lifecycle
  boundary. The split in §3 and the sequencing in §6 are the response.
- **R3 — protected revisions are not factory-buildable.** F-4.
- **R4 — external work is mixed into factory work.** Skill renames, shell
  functions, settings, memory curation and upstream broker contributions cannot
  land from a managed worktree. Mark them and keep them out of the task graph.
- **R5 — evidence retention is weaker than the method requires.** Several
  decisions cite captured bytes that exist in no fixture and at no named path.
  Anything that becomes executable needs its captures scrubbed into the tree.
- **R6 — identifier collisions and text drift.** `O3` means two different things;
  #24 contradicts §2.3.8. Qualify option ids per candidate.
- **R7 — "production-ready" is undefined.** F-5.

---

## 8. Absences

Carried forward and consolidated. Each is a stated bound, not an unstated one.

| Absent | Reason | What closes it |
| --- | --- | --- |
| Does `--settings` exclude project settings when both exist? | Not gathered; the repo root now has no `.claude/`, so nothing tests the interaction | One probe with both present |
| `agy` event ordering — does a tool event precede execution? | No fixture establishes it | One capture with a write and a shell call |
| `agy` prevention across the WSL/Windows boundary | No containment capture retained | One adversarial throwaway run |
| Raw `agy`, `mf` and quota-axi byte streams | Existed in earlier sessions; no citable path and no fixture in the tree | Supply the raw files, scrub copies into fixtures |
| `mf` event bytes and TMPDIR behaviour | Reference not gathered; AWSF fit already fails at the broker | A fake-`mf` broker test first, a live capture only after the fork is chosen |
| Ladder stage envelopes | Produced once, by hand, as prose | The capture pass that is #22's first task |
| Worker prompt benefit | No repeated benchmark; two calls would not settle it | Matched repeated tasks with the four metrics named in 2.5 |
| quota-axi rate-limited bytes | Cannot be summoned safely | Retain the next natural occurrence |
| GPT quota on a Pi-only machine | This machine has a Codex binary installed under /snap | A machine without it, or the upstream credential broker |
| Unattended Claude quota on macOS | No Darwin hardware | The M5 visit, with the versioned checklist from §2 |
| Which deny key does the work, `Task` or `Agent` | The pair was tested together | A/B with a nonsense-name control |
| Smart Health repository detail | Exists; not gathered because no finding turns on it | Read before freezing the registry schema |
| A running firstmate instance | Requires a provisioned fleet home | Only needed before porting a supervision mechanism, not for the contract or the guard |

---

## 9. What plan-sota should receive

Five buildable slices, in order, once the forks are resolved:

1. **marimba contract plus guard extension** — `simple-sdlc` at T2. Gates:
   execution-isolation, route resolution for every pointer the contract names,
   no live handles, and captured guard denials including an owner-act command
   shape.
2. **`awsf init`** — host-only, no provider. Gates: temp-directory `git init`,
   owner commit identity, and no model call before the baseline exists.
3. **Registry v1** — plan repo plus target repos, per-repo branch and gates,
   single-repo tasks. Gates: schema, path containment, per-repo gate resolution,
   and ticket/plan-sync redefined per registered plan source.
4. **Design → architecture-review → plan recipes** — typed envelopes, a
   deterministic zero-blocker gate, and `AC`/`INV` coverage extending invariant
   12's meta-test.
5. **Prompt composition centralisation**, then the shared block behind its
   benchmark.

Everything else in this file is history, an optional adapter workstream, a
document correction, or work that must wait on a fork.

---

*Fused 2026-08-20 from `awsf-v2-candidates.md` and
`awsf-v2-candidates-GPT-version.md`. Seventeen verification checks were run
against this repository while adjudicating, each quoted at the claim it settles.
Neither source file was modified.*

---

## 10. Changes since fusion — 2026-08-20

Six statements above are superseded by work done after the fusion. Each names
what it replaces.

**10.1 — marimba's guard now holds the owner-act boundary.** §2.8 called the
guard extension "the single highest-value unbuilt item" and F-3 posed it as a
fork. It is built. The guard reads `tool_input.command` and denies the six owner
acts by name. Offline: `awsf land T01` and `just awsf rework X` deny at exit 2,
while `awsf status` and `awsf run` pass, so the spend the tier already authorised
is untouched. Live under marimba's own settings: *"It was blocked — the
`delegation-guard.sh` PreToolUse hook (marimba) denied `awsf land` as an
owner-only act in a driving session; the command never executed."* F-3 is
answered: the flag stays and the boundary is real.

Two adjustments came with it. `ListAgents` moved into the whole-name exclusion
list, because the review was right that it enumerates and creates nothing. And
the fail-open behaviour on malformed JSON is now stated in the script's header as
a deliberate limit rather than left implicit: failing closed on a payload-shape
change would brick every tool call the day the harness changes its schema.

**10.2 — the v1 ticket move is reversed, and §6 step 1 is wrong about it.** The
move would have broken two commands. `ticketStoreFor` resolves `specs/tickets`
and `TicketStore` reads that exact directory with no recursion, so `awsf ticket
list` and `awsf backlog` would have silently returned nothing. **The v1 tickets
stay flat.** The physical move belongs with the registry slice that gives the
store a plan to resolve against — which is F-2, where it now sits.

**10.3 — the sync fence is plan-aware, which was the actual requirement.** It
pairs each plan with its own ticket set and runs every assertion per set: the
flat `specs/tickets/` against `awsf-plan.html`, and each
`specs/tickets/<stem>/` against `specs/<stem>.html`. A ticket set with no plan
fails loudly rather than being skipped. Proven to bite: a ghost directory
produced `specs/tickets/awsf-v2-ghost/ has no plan`, and the suite returned to
green once removed. Ticket ids accept `Wnn` alongside `Tnn` for spine plans whose
units are workstreams, and `tier`/`workflow` became optional because the plan
skill omits them when a plan defines no such vocabulary.

**10.4 — `plan-sota` exists.** Decision #23's rename was executed on 2026-08-20:
23 executing mentions across the skill and `orchestrate`, with both compatibility
pieces in place — the legacy `localStorage` key read once and never written, and
Mode B accepting either block header. Those are the only two `planf3` strings
that remain anywhere, which is exactly the line #23 drew. The rename verified
itself: the harness reloaded the skill mid-session under the new name.

**10.5 — every plan now carries an In Plain Language section.** It existed only
in `awsf-plan.html`, hand-authored, and appeared nowhere in the skill, so v2
would not have had one. It is now the first section of the template body, with a
required-in-every-plan rule and its own workflow step. It is written last, after
the technical body is final, so it describes the plan that exists rather than the
one intended. This applies to the spine and to every deep plan.

**10.6 — `specs/v2/` is dropped and plans stay flat.** §0.2 and §8 both assume a
`specs/v2/` directory. It is unnecessary: plan filenames never collide, the skill
defaults to `specs/`, and the fence accepts either location. Only tickets need
grouping, because only tickets collide. `plan-sota` now writes them to
`specs/tickets/<plan-stem>/`, which is what makes the plan-aware fence engage —
without that patch the fence would have been correct and never exercised.

**10.7 — a new candidate, and one open question closed by it.** §2.9, evidence
readability, was added on 2026-08-20 from twelve screenshots of a real reviewer
run plus the renderer's own source. It settles the frozen record's Still-open
item *"Does `text_delta` stream incrementally?"* — it does, and a screenshot
settled it for nothing where the record had budgeted a probe. The deltas break
mid-token inside the streamed envelope, so their concatenation reconstructs the
phase output that is already stored, which is what makes display-layer compaction
lossless.

It also raises an exposure that did not exist before it was proposed: redaction
runs per event, so a credential split across two chunks is reassembled by any
concatenating renderer. That is carried in §2.9's Collision 1 with the fixture
that must prove it.
