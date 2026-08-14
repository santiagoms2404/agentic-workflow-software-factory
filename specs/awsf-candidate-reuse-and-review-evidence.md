# Candidate reuse and review evidence — investigation, decisions, and implementation plan

**Status:** owner-approved design record. No marker is flipped by this document, no work is
claimed by it, and it is not a ticket. It records an investigation, the owner's decisions on
its open questions, and the ordered implementation it authorizes.

**Revision 2 — adjudicated 2026-08-14.** An adversarial verification session read revision 1 and
returned the report appended verbatim at the end of this file (from *"# 1. VERDICT"*). That report
is an immutable audit record and is not edited. Parts I–V below have been amended against it, each
amendment adjudicated against code at file:line. Passages carrying **[R2]** were changed or added
in this revision; **Part VI** is the adjudication ledger, stating for every finding whether it was
accepted, narrowed, or refuted, and why. D1–D4 are unchanged and were not re-litigated. The one
question adjudication could not settle was put to the owner and answered the same day — **D5**.

**All owner decisions are settled. The document is implementation-ready. Commit 1 is next.**

**Date of investigation:** 2026-08-14
**Method:** zero provider calls. Evidence read: the complete IndyDevDan *"Engineers, your software
factory needs agent sandboxes"* transcript, all 39 accompanying screenshots (IMG_3370–IMG_3374
examined closely), the `inkwell-agent-sandboxes-and-software-factory` reference clone at
file:line, this repository's `AGENTS.md` / `specs/awsf-plan.html` / `specs/tickets/T30.md` and
implementation, and one retained pilot attempt inspected read-only.

**On live state.** Per `AGENTS.md` invariant 1 this document records **no live task state**. The
pilot observations below are a dated evidence snapshot used to justify a design; the provider
session identifier is deliberately omitted, and nothing here is a record of what is currently
running. The journal and status store remain the only source of truth for that.

---

## Part I — Owner decisions

Four questions were put to the owner. All four are settled.

| # | Question | Decision |
|---|---|---|
| **D1** | Authorize touching `core/src/state/**` (a protected path, T2 by `risk.paths`) to add one lifecycle edge and amend the contract from 24/76 to 25/75 before T30 completes? | **Yes.** The amendment is a single-cell change to the class table and is recorded explicitly in the plan. The alternative — cancel + retry — is the quota waste that prompted the investigation. |
| **D2** | Reviewer tool profile: keep `no-tools` with the diff supplied in the prompt, or widen to `readonly` as the reference factory does? | **Widen to `readonly`**, following the reference. See §D2 below for exactly what that grants in AWSF and what it does *not*, and why the host-composed diff is retained alongside it rather than replaced by it. |
| **D3** | Confirm the tranche coupling: the new edge draws the owner correction tranche, so one owner-authorized re-entry *of either kind* is permitted per attempt? | **Yes.** Accepted as the strongest available bound against review shopping, with the consequence stated: after a replacement review, an L19 rework is refused as exhausted. |
| **D4** | Verdict on the investigation. | **Implement commits 1–3 before continuing the pilot.** Durable per-phase checkpoint reuse is rejected. Generalized candidate-scoped continuation (commit 4) is deferred and must not be opened. |
| **D5** *(R2)* | After L25 spends the owner re-entry allowance, a replacement review that fails post-GO leaves the attempt BLOCKED and `awsf retry` rebuilds — the green candidate is lost. Accept that, or reopen D3 to give L25 its own allowance? | **Accept it.** D3 stands unchanged. Every deterministic failure moves before GO, so post-GO only transport (which has its retry) and invalid JSON remain, and §5.3.1's eligibility narrowing now carries most of the anti-shopping bound D3 was holding alone. The confirmation prompt must say *"if this review fails, the candidate is lost"* in those words. See §VI.6. |

### §D2 — What widening the reviewer to `readonly` actually means here

The decision follows the reference factory, whose reviewer system prompt says, verbatim
(`adws/adw_data/prompt_engineering/reviewer/system.md`):

> "Judge the code on disk, never the builder's summary of it. Start from
> `previous_envelope.changed_files`, read them, and use `git diff` for anything the envelope did
> not mention."

Two facts make the AWSF translation non-identical, and both were verified in code:

1. **AWSF's `readonly` ceiling is `read, grep, find, ls`** and nothing else
   (`core/src/policy/permission-profiles.ts:10-14`). It contains neither `exec` nor `bash`. An
   AWSF readonly reviewer can therefore open, grep and list the worktree, but **cannot run
   `git diff`**, which the reference reviewer does. The host-composed diff is precisely the
   capability the profile cannot supply, so it is **retained, not replaced**. The reviewer gets
   the reference's capability — read the code on disk — without the reference's `exec` surface.
2. **`writes: []` is unchanged**, which keeps `repositoryReadOnly: true`
   (`permission-profiles.ts:63`) and keeps the `writes_within_globs` gate applied to review
   phases (`core/src/cli/commands/production-run.ts:368-371`), under which any observed path is a
   breach. The committed config comment — *"a reviewer that cannot fix cannot quietly fix"* — is
   preserved exactly.

#### §D2.1 — What `readonly` does **not** confine **[R2]**

Revision 1 described the result as opening "a read-only **repository** view." That is wrong, and
the error matters because it understates a real exposure the owner is accepting. What `readonly`
actually confines is **writes**. It confines **reads not at all**:

- `core/src/policy/sandbox-broker.ts:78` — the worktree bind flips to `--ro-bind` when
  `writes.length === 0`, which is the write control working as described.
- `core/src/policy/sandbox-broker.ts:84` — but the namespace is built on `--ro-bind "/" "/"`. The
  **entire host filesystem is mounted readable** inside every sandboxed phase. Nothing in
  `PermissionSession` scopes a read to the worktree; `PermissionSession.enforce()` compares
  change-sets, and a read leaves no change-set entry.
- `core/src/policy/sandbox-broker.ts:129-136` — when `bwrap` is absent the grant degrades to badge
  `tool-policy` (mechanism `adapter-tool-policy`) or, off Linux, `unavailable`. On those paths the
  **only** read control is the adapter's own `--tools` allowlist.

So a `readonly` reviewer holds a model-controlled `Read` tool that can name an absolute path. The
state root, other tasks' attempt directories, this attempt's own `private/` (including
`private/continuity.json` at 0600, which is 0600 against *other users*, not against a process
running as the owner), and ordinary home-directory files are all within reach of a well-formed
absolute path. Under the current `no-tools` reviewer none of that is reachable, because the profile
carries `--tools ""` plus an explicit deny list (`core/src/adapters/claude-code.ts:162-169`). **This
exposure is created by D2, not merely described by it.**

**Decision: accept the exposure, with one cheap confinement added.** D2 stands — the owner's
reasoning (follow the reference, let the reviewer judge code on disk) is sound and the reviewer is
an opposite-provider process the owner already trusts with the candidate's full source. Two things
are required alongside it:

1. **Mask the state root in the bwrap namespace.** After `--ro-bind "/" "/"`, add
   `--tmpfs <stateRoot>` and then re-bind only `request.sessionRuntime`. bwrap applies binds in
   argv order, so this hides every attempt directory — including `private/` — while leaving the
   phase's own writable runtime intact. It costs one argv pair, needs no new policy concept, and
   removes the single most sensitive item in reach. This is added to commit 1.
2. **State the residual plainly in the plan.** With `bwrap` present, everything outside the state
   root remains readable. Without `bwrap`, nothing is confined but the tool allowlist. That is
   recorded as an **accepted confidentiality risk of the T30 experiment**, not as a property the
   design provides. The badge already surfaces which regime a phase ran under
   (`sandbox-broker.ts:118,131`), and a reviewer's `limitations` cannot be trusted to disclose what
   it read.

Resulting reviewer configuration:

```yaml
  - name: reviewer
    harness: { adapter: <inverse of the worker>, continuity: none }
    tools: { profile: readonly, allow: [read, grep, find, ls] }
    writes: []
```

`continuity: none` is deliberately unchanged; see §7 Q8 of the report.

---

## Part II — The investigation

### 1. Decision first

The owner's *motivation* is correct and the current behaviour is genuinely wrong, but the
owner's *stated mechanism* — "resume should be available in every phase no matter which phase of
the lifecycle we are, or the status of marked phases" — is wrong as stated. Neither the
transcript, the screenshots, nor the reference implementation supports it: the reference factory
has **zero durable per-phase checkpoint reuse** and joins a session by re-running every phase.

**Two different continuities exist in the reference, and revision 1 blurred them. [R2]**

| | Host-tier orchestrator continuity | Per-agent ADW continuity |
|---|---|---|
| Scope | **One per sandbox/run** | **One per (adw_id, agent name, model)** |
| Minted | `just/sandbox/lifecycle/create.just:189-193` | `adws/adw_modules/agents.py:233-237` |
| Resumed by | `just/sandbox/run/mod.just:47-90` — `--session-id` then `--resume`, gated on a host sentinel file | the ADW itself, on a `--adw-id` join |
| Purpose | Interactive human steering and inspection (IMG_3372, IMG_3373) | Re-prompting the **same context window** for parse retries and gate corrections (`agents.py:148-177`, `:280-300`) |
| Does it skip a completed phase? | It is not a phase at all | **No** — the phase body always runs |

Revision 1's sentence "resumes exactly one conversation per sandbox … never a worker phase's" was
half right and half wrong. The *interactive* resume the owner remembers is indeed one per box. But
worker phases **do** carry provider conversations that are rejoined across invocations of the same
`adw_id`. What no mechanism anywhere does is treat a prior *success* as a reason not to run the
phase. That distinction — conversation reuse yes, result reuse no — is the whole finding, and
AWSF's `continuity-store.ts` already implements the first half correctly.

The narrowed principle adopted here is:

> **Reuse the candidate, not the phase.** In a Git-owned factory a phase's durable, reusable
> output is the immutable commit it produced plus the host evidence measured against that exact
> SHA — never the phase's execution state. AWSF must never learn to "skip a phase because it
> succeeded"; it must learn to *start work from a candidate*, and it must stop shipping a review
> that never saw one.

The observed defect is not a missing checkpoint store. It is that AWSF hands its mandatory
opposite-provider reviewer a `TestOutput` and no tools, so the plan's own promise of a
*diff-scoped* reviewer is unimplemented; and that once an unevidenced review is on record there
is **no legal edge in the 24-edge contract that buys a replacement review of an unchanged
candidate**, so the only recorded remedy is cancel + retry, which rebuilds a candidate that is
already green.

### 2. Source evidence

#### 2.1 Transcript

The source is a single unwrapped line; it was rendered to 110 columns to cite. Quotes are
verbatim.

| # | Quote | Establishes |
|---|---|---|
| T1 | "We'll boot up Herder. This is my terminal multiplexer of choice for **watching agents, kicking off jobs, running arbitrary commands**" (ll. 20–21) | Herdr's stated role is observation and launching — not state, not evidence |
| T2 | "we can see all the thinking, all the agent calls, **the gate passes**. We have deterministic gate checks on our nondeterministic systems. **JSON error, it fixes JSON error**" (ll. 118–120) | The only correction mechanism shown is in-session schema repair — AWSF escalation-ladder rungs 1–2, already implemented |
| T3 | "Looks like we have a full fail here… It looks like it couldn't get the JSON format out… **This is why we use best of n.**" (ll. 151–155) | The remedy for a failed run is **redundancy and disposal**, not resume |
| T4 | "Open weights bombed. Okay, we just go ahead and close that." (l. 217) | Confirms T3 |
| T5 | "At any point in time, **I can enter these sandboxes and I can enter the orchestration**." (l. 235) | Access to a *running environment* at any time |
| T6 | "Our agent is going to use herder… **We have five panes.** And now my agent is going to boot up **SSH access** into every single one of them." (ll. 242–244) | Workflow A panes are SSH shells, one per VM |
| T7 | "I want the exact same thing except **I want to talk to the orchestrator inside each running sandbox**. So what's that? It's an **interactive cloud code on top of the boxes**." (ll. 252–254) | The resumed thing is the in-sandbox *orchestrator*, one per box |
| T8 | "**There's the boot up command. We have to trust the system all the time.**… **we've connected to an agent that's already ran.**" (ll. 256–262) | The resume is an interactive, human-keypress TTY session |
| T9 | "Our agents are **reading the ADW state**, the actual agent work that was completed" (ll. 266–268) | The resumed orchestrator **reads durable state**; it does not resume workers |
| T10 | "an outloop orchestrator… an in sandbox orchestrator and then… our software factory" (ll. 149–151) | Three tiers; resumability is a property of tier 2, not tier 3 |

The transcript never mentions retry cost, avoiding repeated phases, checkpointing, or reusing a
prior phase result. The word "resume" does not appear. The owner's recollection is a faithful
compression of T5–T9 with one substitution: the object is the *box's orchestrator session*, not
*each phase*.

#### 2.2 Screenshots

**IMG_3370** — Herdr workspace `sbx-redesign-fleet`, five panes, each running
`ssh -t redesign-<config>-….exe.xyz 'cd app && exec bash -l'`, each showing a login banner and a
bash prompt. Sidebar: `agents / grouped: ✓ inkwell — idle · claude`. *Proves* pane ↔ VM shell and
one tracked orchestrator agent, idle. *Does not prove* any phase identity, provider session, or
resumable worker.

**IMG_3371** — The out-loop orchestrator reports `Position | Pane (w7J:p1…p5) | **Run id (= VM)**`,
then: *"These panes are yours now — I won't type into them further… `tail -f run.log` in any pane
watches that arm's SDLC live… **The boxes are disposable** and the clone in `app/` is the run
branch — anything worth keeping leaves via `just sbx manage harvest <run-id>` from the host, not
copy-paste out of a pane. **If a box is torn down later, its pane becomes a dead shell**."* Below
it, the owner's prompt: *"**Connect me to the orchestrator agent inside each running sandbox —
interactive Claude Code on each box's recorded session, all in ONE herdr workspace, one pane per
run.**"* This screenshot is the literal source of the owner's memory, and it says **per run**, not
per phase.

**IMG_3372** — A *new* workspace `sbx-redesign-agents`, five panes, each running
`ssh -t <vm>.exe.xyz "cd app && ANTHROPIC_API_KEY=implicit ANTHROPIC_BASE_URL=… claude
--resume <uuid> --dangerously-skip-permissions --model \"opus[1m]\""`, five distinct UUIDs, one
per VM. *Proves* the reference does use real provider-conversation continuity, by the same
`--resume <uuid>` mechanism AWSF implements — **one session per sandbox, resumed for
inspection**. *Also proves, incidentally*, that the session locator, the permission bypass and the
base URL are all on argv in plaintext on screen: the reference is **less** private than AWSF here,
not more.

**IMG_3373** — All five panes at Claude Code's trust prompt. *Proves* the resume is interactive
and human-gated — an owner observability action, not an automated pipeline step.

**IMG_3374** — The five resumed orchestrators answering. Visible: `just obs phases <id>`,
`just obs tail <id>`, `tail -f run.log`, `just obs kill <id>`; *"`02 plan agent · planner` … ▸
planner `openrouter/anthropic/claude-opus-5` **session `sssf-4dc99c59-planner-bb60`**"*; *"Trace
agrees with the log… **the db processes table shows both the workflow and its planner child
open**"*; *"Note **phases default to fail**, so a fail may mean 'never completed'"*; and decisively
*"if you meant one of the alternates on disk… this run is not on it — say which and **I'll
relaunch**."* Per-phase *identity and observability* exist; per-phase *re-entry* does not — the
offered remedy is **relaunch**.

Remaining 34, in brief: motion graphics (isolation·scale·agency; in-loop vs out-of-loop; the tool
stack; the five-phase SDLC; *code owns sequencing, retries, acceptance while agents own judgment,
language, execution*); the three-tier architecture and its command surface; the fleet preflight,
whose vocabulary for a live orphan run is *"inspect it, harvest any commits, or report its
URLs"* — never resume; the model-stack tier list; the SSSF dashboard (run cards, phase lanes, and
a phase detail panel showing `owner planner · kind agent · attempt 0/0`, agent config with a
per-phase `session` id, `compiled prompts (2)`, `gates (2)`, `cost`, `outputs (3)`); the two-ports
and credential-boundary figures (*"harvest never merges: a run's commits come home as
`refs/sandbox/<run-id>`"*); **IMG_3380**, the sandbox-tier failure doctrine —
`CREATE→FILL→SETUP→EXECUTE→OBSERVE→TEARDOWN`, *"TOTAL COLD MOUNT ~10s"*, with a red arrow from
SETUP labelled **"KILL AND RE-CREATE"**; and *"OBSERVE FROM OUTSIDE ONLY — NEVER REACH IN"*.

#### 2.3 Reference clone — what it actually implements

**There is no phase-result reuse anywhere.**

- `adws/adw_modules/session.py:38-50` — `ensure(cfg, adw_id)` "joins the session if it exists or
  creates it under exactly that id." Joining sets up the tracer and the `Run`; it schedules
  nothing.
- `adws/adw_modules/runner.py:52` — `self._seq = tracer.max_phase_seq(adw_id)  # a joined run
  continues the sequence`. This is the only thing a join reads from the **`phases` table**.
- `adws/adw_modules/runner.py:72-111` — the one phase primitive. It always executes the body;
  `phase.status = "fail"` on any exception, `"success"` only on clean exit. No branch consults a
  prior status.
- `adws/adw_modules/runner.py:131` — `phases_ok = … all(p.status == "success" for p in
  self.phases)` reads the **in-process** list, never SQLite. Nothing outside `just/obs.just` reads
  the `phases` table.
- `adws/adw_simple_sdlc.py:78-172`, `adws/adw_build_review.py:38-64` — every phase is
  unconditional. Running either with `--adw-id <prior>` re-runs everything.

**What a join actually retains — the full list. [R2]** Revision 1 said "the **only** thing a join
reuses is the phase counter and the provider session." That was too narrow and is corrected here,
because an accurate list is what makes the *conclusion* trustworthy rather than convenient.
`adws/adw_modules/runner.py:52-58` constructs, for a joined `adw_id`:

| Retained | Where |
|---|---|
| Phase sequence counter | `runner.py:52` — `tracer.max_phase_seq(adw_id)` |
| The session directory `sessions/<adw_id>/` and everything already in it | `runner.py:54` |
| `context_handoff/` — every envelope and raw record a prior invocation wrote, appended to | `runner.py:55` |
| `agent_map.json` — the per-agent provider session map, read on construction | `runner.py:56-58` |
| Per-agent provider conversations, keyed `(adw_id, agent name, model)` | `agents.py:233-237` |
| The SQLite `sessions` row and its cost/token aggregates | `runner.py:68-70` (`tracer.session_add_usage`) |
| The repository working tree itself — a join does not reset it | `runner.py:53` (`git_helper.repo_root()`) |

**The conclusion is unchanged and is the load-bearing part: none of that causes a phase to be
skipped.** Every retained item is either an append-only record, a context window, or the tree the
next phase will operate on. No branch anywhere consults a prior phase's `status` before deciding to
execute (`runner.py:72-111`, `:131`). A joined run is a *continuation of the conversation and the
paperwork*, never a resumption of the schedule.

**The provider conversation is the one deliberate reuse**, keyed narrowly —
`adws/adw_modules/agents.py:233-237`:

```python
def _agent_session_id(run, agent):
    entry = run.agent_map.get(agent.name)
    if entry and entry.get("model") == agent.model:
        return entry["session_id"]           # rejoin the existing context window
    return f"sssf-{run.adw_id}-{agent.name}-{new_id(4)}"
```

Reuse key = `(adw_id, agent name, model)`; a model change forces a fresh session — the same
invalidation rule as `core/src/execution/continuity-store.ts:218-231`. Persisted at
`agents.py:203-204` → `runner.py:61-63` → `sessions/<adw_id>/agent_map.json`. Parse retries and
gate corrections re-prompt the **same** session, bounded (`agents.py:148-177`, `:280-300`) — AWSF
rungs 1–3, already shipped.

**Host-tier resume** — `just/sandbox/run/mod.just:47-90`, the code behind IMG_3372: one session id
per **run**, minted once at `just/sandbox/lifecycle/create.just:189-193`; first call
`--session-id`, later calls `--resume`, discriminated by a **host sentinel file** `touch`ed only
after a successful turn, because *"a first call that died never created a session, and `--resume`
on a session that does not exist would fail forever"* (`:88-90`). They explicitly declined to
probe the provider's store (`:61-64`): *"depends on Claude Code's on-disk session layout, which we
have NOT verified — an implementation detail is a bad source of truth."* **AWSF's proof is
strictly stronger**: `assertResumable` inspects the host's own `--session-dir` on the pi route, and
the Claude route's evidence is `provider-refuses-unknown-session` re-checked against stream
identity (`core/src/adapters/claude-code.ts:398-427`). The file header states the purpose: a
resumable session, *"For steering."*

**The reference's own documentation of the boundary** — `README.md:95-97`:

| Tier | Where | Role |
|---|---|---|
| Out-sandbox super orchestrator | your machine | mounts, fills, observes, harvests, tears down |
| In-sandbox orchestrator agent | the VM, **a resumable Claude Code session** | receives delegated work, launches the factory, watches it, reports |
| ADW agents | **bounded phases inside the factory** | scout, plan, build, review, document |

`README.md:108`: the agent-mediated path is *"judgment at the kickoff, conversational,
**resumable**"* — attributed to the delegation, not to the phases. `README.md:170`: *"Teardown is
never automatic, and harvest never merges."*

**What the reference does instead of reuse — a smaller ADW that starts later.**
`adws/adw_document.py:36-66` runs `request → changes(code) → documenter` and never rebuilds;
`adws/adw_modules/changes.py:52-84` captures `git diff` against a resolved base into
`context_handoff/changes.diff` with `stat`, insertion/deletion counts, an explicit truncation
marker, and untracked files named separately; `changes.py:87-103` wraps it as an envelope carrying
`changed_files`, `stat`, `diff_path`. **This is the exact primitive AWSF is missing**, and the
model for commit 1.

**Their reviewer** — see §D2 for the system prompt. Note also `adw_simple_sdlc.py:119`, which
passes `previous=**build**` to the reviewer, deliberately *not* the test envelope; the test
envelope goes to the *fix* phase instead at `:111`. Their `verdict_consistent`
(`adws/adw_modules/gates.py:69-93`) checks only self-consistency, exactly like AWSF's.

**Contradictions found:** none between transcript, screenshots and clone. One between this
repository's plan and its code — §3.1.

### 3. AWSF gap

#### 3.1 The review-evidence defect — a plan/code contradiction, not a missing feature

`specs/awsf-plan.html`, States table: *"REVIEWING — T2 only. Cross-provider reviewer,
**diff-scoped**, advisory."* The implementation supplies no diff.

- `core/src/cli/commands/production-run.ts:1341-1403` builds the `previous` chain; a `code` phase
  sets `previous = testOutput` at `:1401`.
- `:1349-1356` defers the review phase out of the RUNNING loop, and `:1471` runs it with that same
  `previous` — for `build-review`, the `tests` phase's `TestOutput`; for `simple-sdlc`,
  `final-tests`'.
- `core/src/workflow/compiler.ts:71-77` renders `{previous_envelope}` as that envelope's JSON and
  nothing else. `prompts/reviewer/user.md` contains exactly `{previous_envelope}` and
  `{output_schema}`.
- `awsf.config.yaml:63` — reviewer `tools: { profile: no-tools, allow: [] }`.
- `production-run.ts:384-387` — `candidatePathsBetween()` computes the exact changed-file set from
  Git, but it is passed only to `verdict_consistent` (`:358-372`), **never to the prompt**.
- `core/src/gates/review.ts:22-49` checks the SHA, verdict/finding consistency, and finding-path
  containment. All four checks pass vacuously for an empty `findings` array.

**Net:** the reviewer is told "Review the exact candidate" while being given a test-command exit
code, a truncated TAP tail, no diff, no file list, no source, and no tools. Its `accept` is
structurally guaranteed whenever `findings` is empty, and `findings` is empty because nothing is
inspectable.

This propagates to landing: `core/src/cli/commands/land.ts:60-71` builds
`LandingEvidence.requiredReviewPresent` from the boolean `status.requiredReviewPresent`, and
`core/src/state/guards.ts:284` checks only that it is `true`. **`requiredReviewPresent` is a
presence check, and presence is satisfiable by a review that audited nothing.**

#### 3.2 The exact architectural boundary

Same-session gate correction was **not** conflated with workflow-level resumability; the T30
prerequisite got that boundary right. The real boundary is:

> **Correction is intra-phase and intra-process. There is no inter-invocation re-entry of any
> kind, at any level.**

- `core/src/workflow/engine.ts:240-404` — the whole correction loop lives inside one
  `runAgentPhase` call over an in-memory `CorrectionSession`. Nothing is reconstructible from a
  later process.
- `core/src/state/phase-machine.ts:113-123` — no edge back into a terminal phase state.
  `SUCCEEDED` is absorbing, correctly.
- `core/src/workflow/phase-launch-authorization.ts:77-79` — every compiled-phase launch, and
  therefore every correction launch (inherited at `:200-210`), requires
  `status.lifecycleState === "RUNNING"`.
- `core/src/execution/continuity-store.ts:74-76` — `continuityHandle(phaseId)` is keyed on the
  phase id alone, and `:172-181` refuses a second `open()` on the same handle. **The conversation
  ledger is attempt-scoped by construction** — right for corrections, and it forecloses
  cross-attempt reuse by design.

The actual conflation is elsewhere:

> **The lifecycle conflates "the owner re-enters RUNNING" with "the candidate is going to
> change."**

`core/src/state/guards.ts:253-260` (L19) demands `gatesInvalidated` *and* `reviewInvalidated`;
`:232-234` (L16) demands `gatesInvalidated` because *"the old green would vouch for a tree it never
saw."* Both are correct **for rework**, which changes the tree. Neither expresses "the tree is
fine, the *review* is not." That case has no edge.

#### 3.3 Consequences, and a latent defect the new edge would activate

From `AWAITING_OWNER` the legal edges are L19, L20, L21, L22
(`core/src/state/task-machine.ts:110-113`). L20 lands, L21 is record-fault only, L22 cancels, L19
is the only re-entry — and:

- `core/src/cli/commands/rework.ts:74` restricts rework to `build`/`plan-build-test`; `:321` throws
  `ReworkTierUnsupported` for `status.tier !== 1`. **T2 owner rework does not exist.**
- `REVIEWING` is reachable only via **L11 from GATING**, and `GATING` only via **L7 from
  RUNNING**. Any second review therefore costs L19's spawn *plus* L11's spawn = **2 calls**, and
  requires asserting `gatesInvalidated: true` about gates that are demonstrably still valid.
- **A review-only recipe is unavailable, but L4 is only half the reason. [R2]** Revision 1 said
  "L4's spawn-site closure forbids a review-only recipe." Stated exactly: `L4.spawnSite === true`
  (`task-machine.ts:95`) plus the closure at `:323-326` forbids a **provider-free RUNNING
  sojourn** — a workflow that enters RUNNING and launches nothing. The task machine does not know
  a reviewer from a builder, so in principle the L4-spawned agent *could* be a reviewer. What
  actually forecloses it is the runner: `production-run.ts:1352-1355` unconditionally lifts every
  review phase out of the RUNNING loop and defers it to the L11 spawn site out of GATING, and
  GATING is reachable only from RUNNING. **Combined, the current runner cannot express an
  adopted-candidate review-only workflow** — which is the claim that matters, and it is the
  combination that has to be cited.
- `core/src/cli/commands/retry.ts:30-77` mints attempt *n+1* at DRAFT, carries `callsSpent`, and
  nulls `worktree`/`baseSha`/`candidateSha` — a full rebuild.

**A pre-existing dead end, found while adjudicating C3. [R2]** This is not caused by L25; it is
already in the shipped runner, and L25 would inherit it.

`production-run.ts:1512` rethrows any REVIEWING failure that is not `MandatoryReviewUnavailable`,
leaving the attempt durably in `REVIEWING`. That is deliberate and the comment defends it well —
the host must not decide what a bad review *means*. But consider a reviewer whose envelope fails
schema validation, or fails `verdict_consistent`:

- **L15** needs a valid, consistent review — absent.
- **L16** needs *"a finding of severity ≥ medium carrying both a file and a detail"*
  (`guards.ts:222-228`) — a malformed envelope has no findings at all, so L16 is unsatisfiable.
- **L17** needs `reviewTransportRetries >= 1` (`guards.ts:240-245`) — a review that *answered* was
  never a transport failure, so L17 is unsatisfiable.
- **L18** cancel is the only remaining edge.

So today, **a malformed reviewer envelope already costs the whole candidate**, and the reviewer
cannot self-correct because `continuity: none` refuses a second turn outright
(`production-run.ts:1109-1111`). The document's revision-1 claim that the owner's exits from
REVIEWING are "L18 and L16" is true only when the review is well-formed and adverse. Commit 2 fixes
this as part of closing C3 (§5.5).

**Latent defect, currently dormant — and it is a conflation, not a bug. [R2]**
`core/src/workflow/engine.ts:251` calls `options.budget.beginPhase()`, and
`core/src/execution/call-budget.ts:451-454` zeroes **both** `correctionsAuto` and
`correctionsOwner`. A command that charges the owner tranche on its authorizing edge
(`call-budget.ts:411-413`) and then enters `runAgentPhase` would have that charge silently erased
from every later `budget.snapshot()`. The production runner never takes a correction edge today
(it authorizes only L4 and L11), so this has never bitten.

Revision 1 proposed "`beginPhase()` must not zero a task-level owner charge." **That fix as stated
is wrong**, and the verifier is right to refuse it. `call-budget.ts:445-450` states the contract
verbatim: *"The correction allowance is per PHASE (`{auto: 1, owner: 1}`), so a new phase refreshes
it."* Suppressing the reset would silently convert every intra-phase owner correction (rung 3) from
a per-phase allowance into a once-per-attempt allowance across the whole workflow — a normative
change nobody asked for, affecting `recordPhaseTransition` (`call-budget.ts:417-436`) and every
multi-phase recipe.

**The real defect is that one pair of counters carries two different allowances:**

| Allowance | Scope | Charged by | Reset by |
|---|---|---|---|
| Intra-phase correction (ladder rungs 2–3) | **per phase** | `recordPhaseTransition` (`call-budget.ts:428-435`) | `beginPhase()` — correctly |
| Owner re-entry (ladder rungs 4–5: L10-owner, L16, L19, and now L25) | **per attempt** | `authorize()` (`call-budget.ts:411-413`) via `ACTOR_TRANCHE` (`task-machine.ts:67-71`) | `retry.ts:56-57` on attempt *n+1* — correctly |

Both write `#correctionsOwner`. Both are read by step 9 (`task-machine.ts:353-363`) and by L13's
guard (`guards.ts:173-179`). The per-phase reset therefore already erases an owner *re-entry*
charge today — for an owner-actor L10 followed by a phase — it simply has no caller yet.

**Commit 2 separates them.** The per-phase counters keep their name, their reset and their
contract; a new attempt-scoped counter carries owner re-entry. Blast radius in §III commit 2.
**This must land before commit 3**, because commit 3's whole bound is that counter.

### 4. Pilot recovery — the concrete case

*Dated evidence snapshot, 2026-08-14. Not a live-state record.*

The pilot attempt under investigation was a tier-2 `build-review` run whose builder produced a
candidate on the first turn with the full configured suite green (238/238), whose host gates
passed against that exact SHA, and whose mandatory inverse-provider review then returned `accept`
with zero findings. Two calls of the tier-2 ceiling of five were spent, none reserved, and both
correction tranches were untouched. The reviewer's compiled user prompt (~9.8 KB) contained the
`TestOutput` JSON and the output JSON Schema, and nothing else. The reviewer's own envelope
recorded six `limitations`, including *"No diff, patch, or changed-file list … was supplied to
this phase; I inspected no source file"* and *"The accept verdict … is not a verified absence of
defects."* The candidate diff is 6 files, +567/−18 — small enough to fit whole in a prompt. The
managed worktree was clean at the candidate; the canonical repository was clean at the base.

**Under the implementation as it stands, that candidate cannot receive a substantive review
without either rebuilding it or falsifying L19's evidence:**

| Path | Calls | Rebuilds? | Legal? | Verdict |
|---|---|---|---|---|
| Land as-is after a journey | 0 | no | **yes** — L20's guard passes | **The real hazard.** Ships a T2 change under a review that says it audited nothing. |
| `awsf rework` | — | — | no | `ReworkTierUnsupported` (`rework.ts:321`) |
| L19 + L7 + L11 by hand | 2 | yes (L19 must spawn) | only by asserting `gatesInvalidated: true` falsely | Rejected — evidence falsification |
| Review-only recipe | — | — | no | L4's spawn-site closure forbids a RUNNING sojourn with no launch |
| Cancel + `awsf retry` | 2 | **yes** | yes | Works, discards a green candidate, re-buys a large builder context, and leaves one call — a single reviewer transport fault then exhausts T2 |

**With commits 1–3 the answer becomes yes, at one call, with no rebuild and two calls of
headroom.**

### 5. The contract

#### 5.1 Candidate checkpoints, not phase checkpoints

A **candidate checkpoint** is an immutable tuple already fully present in AWSF:

```
(baseSha, candidateSha, changedPaths, hostGateResults@candidateSha,
 reviewVerdict@candidateSha?, journeyAttestation@candidateSha?)
```

Its **reuse key**:

```
K = (request, configSnapshotJson,
     compiled workflow id + phase ids/ordinals,
     per-phase adapterId/provider/requestedModel,
     gate ids + argv + timeout_seconds,
     protected_paths, per-role writes globs,
     baseSha, candidateSha)
```

**Revalidation proof — every field checked before a retained result authorizes anything:**
`toConfigSnapshotJson(config) === status.configSnapshotJson` (already at
`production-run.ts:447-449`); canonical HEAD `=== baseSha` and clean; worktree HEAD
`=== candidateSha` and clean; both objects exist; `merge-base --is-ancestor base candidate`;
candidate author *and* committer `=== HOST_AUTHOR` (pattern at `rework.ts:302-303`);
`git diff --check base..candidate` clean; adapter `isAvailable()` and `getModelInfo()` re-read and
identical to the recorded route.

**Which completed phases may be reused.** Exactly one class: **host-measured results keyed by the
exact SHA they measured.** AWSF already implements this correctly and it is the only pattern to
extend — `production-run.ts:806-812` (`candidateMeasurements` keyed by SHA, *"a measurement of a
superseded candidate is retained as evidence and can never be mistaken for a verdict on the
current one"*) and `:1384-1389` (the `tests` phase records rather than re-runs). **No agent phase
result may ever be reused to skip that phase.** The correct economy for agent work is not reuse
but not asking for it again: run a workflow that does not contain the phase.

#### 5.2 Invalidation graph

| Event | Invalidates |
|---|---|
| Request text changed | Everything (K changes) |
| Config snapshot changed — any field | Everything. Already fails closed at `production-run.ts:447-449` |
| Adapter / provider / resolved model changed for a role | That phase and everything downstream of it |
| `baseSha` moved (canonical HEAD advanced) | Everything |
| `candidateSha` moved | Gate results, review, journey |
| Gate id / argv / timeout changed | That gate's results and everything they authorized |
| A correction round fired in a phase | That phase's prior envelope and its gate results |
| Accepted review finding (L16) | Gates + review (`guards.ts:232-234`) |
| Owner rework (L19) | Gates + review (`guards.ts:257-258`) |
| Journey not attested / failed | Landing only |
| Protected-path approval changed | Landing only |
| Worktree dirty at any observation | Everything measured against it |
| **Review evidence absent or bound to another SHA** | **The review — new, commit 1** |

#### 5.3 The one new edge

Workflow phase replay **cannot** live below the ten-state machine: the review's spawn site is a
*lifecycle edge* (L11), and `createCompiledPhaseLaunchVerifier` refuses agent-phase authorization
from any state but `RUNNING` (`phase-launch-authorization.ts:77-79`) — a fact the T30 Part-1
amendment already recorded. One edge is required, and it is a genuine gap rather than a
convenience: the contract already has *"the owner rejects the review and re-enters"* (L16); it
lacks *"the owner rejects the review and re-buys the review."* The asymmetry exists because the
contract assumed a review's **content** could be wrong but its **evidence** could not be missing.

**Exact transition-table delta:**

```
L25  AWAITING_OWNER → REVIEWING   actors ["owner","human"]   spawnSite ✦ true   interactive true
CORRECTION_EDGES = ["L10","L16","L19","L25"]
```

Class table: `AWAITING_OWNER → REVIEWING` leaves the 33-member `IllegalTransition` class.
**27 + 10 + 6 + 32 = 75.** Totals become **25 legal / 75 rejected**; the first three classes'
arithmetic ("3 × 9", "all ten X → X pairs") is untouched. This is a single-cell amendment,
recorded explicitly in the plan's L-table, class table and Amendments — **not a silent change** —
and `core/test/unit/_lifecycle-tables.ts` is re-transcribed by hand to match.

**L25 guard (`core/src/state/guards.ts`), all required — narrowed in R2:**

| Check | Why |
|---|---|
| `reason.source === "human"` | Only an owner may reject a review |
| non-blank `reviewInvalidationReason` | The record must say why, as L19 demands a defect |
| `tier >= 2` | Review is a T2 control; below it there is nothing to replace |
| `candidateSha` is 40-hex | Identity |
| `gatesPass === true` | A red candidate is never re-reviewed |
| **`gateEvidence` names every configured gate, each `passed` and bound to `candidateSha` [R2]** | `gatesPass` is one boolean an earlier transition wrote. The edge that *preserves* a green must check the green, not a flag summarising it |
| `reviewInvalidated === true` | The old verdict is superseded, on the record |
| `review` present, `review.reviewedSha === candidateSha` | You may only supersede a review that exists and named this tree |
| **`reviewEvidenceDefect` is one of the two deterministic codes below [R2]** | **The eligibility narrowing. An owner may not replace a review merely because they dislike it.** |
| `candidateUnchanged === true` | Host observation: worktree HEAD `=== candidate`, clean; canonical HEAD `=== base`, clean |
| **absent** `gatesInvalidated` | The tree did not change; the old green vouches for exactly the tree it saw. **This is the whole point of the new edge.** |

The ordered rejection contract is unchanged: L25 is an ordinary edge evaluated by the same eleven
steps, and its guard runs at step 10 like every other.

#### 5.3.1 Eligibility is deterministic, not discretionary **[R2]**

Revision 1's guard admitted the attack the verifier names in C3/C2: a **fully evidenced** review
returns `concern`, the owner writes any non-blank reason, sets `reviewInvalidated: true`, buys a
cold replacement, and lands on `accept`. Frequency was bounded; shopping was not. A one-shot
verdict lottery is exactly what a mandatory opposite-provider review exists to prevent, and the
bound "you may only do it once" is not an answer — once is enough.

`reviewEvidenceDefect` must be a **host-determined** enum with exactly two members, and the L25
guard rejects any other value:

| Code | Host test |
|---|---|
| `evidence-gate-absent` | The recorded review phase has **no** `review_evidence_present` gate row. This is true of every review produced before commit 1 — the legacy case that motivated the whole investigation, and the retained pilot attempt's case. |
| `evidence-gate-failed` | A `review_evidence_present` gate row exists and its `passed` is `false`. |

Both are read from the persisted gate rows, not asserted by the owner. **A review that carries a
passing `review_evidence_present` row is not replaceable at all** — its verdict stands, whatever it
says, and the owner's remedies are the ones the contract already provides: accept a finding (L16),
rework (L19), land anyway if the verdict permits (L20), or cancel (L22). The owner's `--reason`
string remains required, but it is now a *record*, never a *key*.

This makes the edge do only what it was justified by: repair a review that **structurally could not
have been evidence**. It is a migration path out of a known defect, not a verdict appeal.

**Consequence, stated plainly:** once commit 1 is in and every review carries a passing evidence
gate, L25 becomes unreachable for new attempts. That is correct. Its permanent value is the legacy
class and the failure class — not a standing second chance.

#### 5.3.2 The candidate TOCTOU, and what closes it **[R2]**

The verifier's C1 construction is real and confirmed in code. `PermissionSession` captures
`captureChangeSet()` (`core/src/policy/sandbox-broker.ts:169-170`), and `captureChangeSet` is
`git diff HEAD --numstat` plus untracked files (`core/src/git/changes.ts:36-56`). It answers *"what
differs from HEAD"*, so a **clean checkout of a different commit** produces an identical
fingerprint before and after — the change-set is empty both times. `assertClean` (`:105-108`) is
`status --porcelain`, equally blind. So nothing in the permission layer notices that the tree the
reviewer read is not the tree the guard approved, and `verdict_consistent` compares the SHA the
reviewer *claims* against the host's recorded candidate — a claim the reviewer can copy from the
context it was given.

`candidateUnchanged: true` is **supplied evidence to a pure guard**. The guard is pure by design
(`state-purity-fence.test.ts:10` forbids impure imports under `core/src/state/`), so the physical
check can never live there. It has to live in the command, three times:

1. **Before authorizing L25** — worktree HEAD `=== candidateSha` and clean; canonical HEAD
   `=== baseSha` and clean; both objects exist; `merge-base --is-ancestor`; author *and* committer
   are `HOST_AUTHOR` (`rework.ts:302-303`); `git diff --check` clean.
2. **Immediately before GO**, after the permission session opens and after the sandbox grant is
   built, re-read worktree HEAD and re-assert clean. This is the window C1 attacks, and it is
   narrowed to the interval between the last physical read and the child's first instruction.
3. **After the review answers, before L15** — re-read worktree HEAD, canonical HEAD, and clean on
   both. A move here invalidates the review outright: the transition is refused and the attempt
   stays in REVIEWING with the failure recorded, exactly as a failed `verdict_consistent` does.

**Should the review read an immutable materialization instead?** Considered and **rejected for
commits 1–3**, recorded so it is not silently dropped. A `git worktree add --detach <candidateSha>`
into the attempt runtime would make step 2 unnecessary — nothing could move a detached checkout the
host owns. It is the structurally correct answer. It is also a new managed-worktree lifecycle
(creation, sandbox roots, `assertSandboxRoots` disjointness at `sandbox-broker.ts:66-74`, cleanup,
`gc`), and it changes what "the worktree" means to the permission session. **That is commit 4's
territory, and D4 defers commit 4.** The three-point revalidation is the bounded answer; the
residual window is one process launch wide and is named here rather than papered over.

#### 5.4 Economics

**A replacement review costs one tier call, drawn from the owner correction tranche** (D3). It is
rung 5 of the escalation ladder with a different target — *"stale review invalidated; gates
preserved and revalidated"* — so it is priced like L16/L19. Two independent bounds hold at once:
`risk.correction_allowance.owner = 1` bounds *how many times*, call-neutral of the ceiling; the T2
ceiling of 5 bounds *total spend*. A cold restart is not refused here — it is **required**, which
is why the price is a call rather than tokens.

**Accepted consequence of D3:** one owner-authorized re-entry *of either kind* per attempt. After a
replacement review, an L19 rework is refused as exhausted (`task-machine.ts:353-363`).

**The replacement costs one call but requires two of headroom. [R2]** Revision 1 priced it at one
call and promised the transport retry. Both cannot be true at the bottom of the ceiling, and the
arithmetic is decisive:

| Workflow | Agent phases | Calls at `AWAITING_OWNER` | T2 ceiling | Headroom |
|---|---|---|---|---|
| `build-review` | builder, reviewer | 2 | 5 | 3 |
| `simple-sdlc` | planner, builder, documenter, reviewer | **4** | 5 | **1** |

(`core/test/unit/workflow/recipes.test.ts:26-27` pins both, as `calls: 2` and `calls: 4`.)

With one call of headroom, `awsf review` spends call five, and a transport fault then reserves a
sixth — `budget.reserve` raises `CallCeilingExceeded` from inside the retry closure
(`production-run.ts:1466-1467`). That is not a transport failure
(`isReviewTransportFailure`, `:389-396`), so it is not wrapped as `MandatoryReviewUnavailable`, so
it is rethrown and the attempt is stranded in REVIEWING. Worse, L17 could not have been taken
anyway: its guard requires `reviewTransportRetries >= 1` (`guards.ts:240-245`) and the retry never
happened.

**Rule: `awsf review` refuses at preflight unless the ceiling has at least two calls of
headroom** — one for the review, one for its single permitted retry. Refusing costs nothing; the
alternative strands the attempt. In practice this means the command serves `build-review` freely
and refuses a completed `simple-sdlc` at T2, and the refusal says so in those words. Raising the
T2 ceiling to buy `simple-sdlc` a replacement review is a separate decision that is **not** taken
here: the ceiling is a T30 experimental control.

#### 5.5 Every REVIEWING failure gets an exit **[R2]**

C3 is confirmed, and §3.3 shows the dead end predates L25. D3 forbids giving L25 its own allowance,
so after L25 spends the owner tranche the L16 escape is gone and a failed replacement review would
leave cancel as the only edge. That is unacceptable for an edge whose entire purpose is to *avoid*
discarding a green candidate.

**The fix is to widen L17, narrowly, to the failures the host can determine without judging the
review's content.** L17's existing rationale is that transport unavailability is *"the one review
failure the contract lets the host declare terminal"* — because it needs no interpretation. Two more
failures have exactly that property, and neither requires the host to decide what a bad review
means:

| New blocker code | Host test | Why it is not a judgment |
|---|---|---|
| `review-malformed` | The envelope failed schema validation, or the phase produced no envelope, after the phase's own parse budget was exhausted | Deterministic; TypeBox either validated or it did not |
| `review-evidence-invalid` | `review_evidence_present` returned `passed: false`, or a post-review revalidation (§5.3.2 step 3) found the tree moved | Deterministic host gate rows |

L17's guard becomes: `reviewTransportRetries >= 1` **or** `reviewFailure` is one of those two codes.
The vocabulary check at `blockerCode("L17", …)` extends to three codes. `verdict_consistent`
failures are deliberately **not** included — an inconsistent verdict *is* content, the existing
comment is right about it, and its exits are unchanged.

Two things follow, and both are improvements independent of L25:

- **The pre-existing hole in §3.3 closes.** A malformed reviewer envelope today strands the attempt
  with cancel as its only exit. After this it blocks with a named code, which `awsf status` can
  explain and which the journal records.
- **BLOCKED is still terminal** (`task-machine.ts:55`), so recovery is `awsf retry` and the
  candidate is rebuilt. That is a real cost and it is not hidden: **a failed replacement review
  loses the candidate.** The mitigation is to make post-GO failure nearly impossible by moving every
  deterministic check *before* GO — evidence composed and validated pre-launch (§III commit 1),
  candidate revalidated pre-GO (§5.3.2), route and inversion re-derived pre-launch, ceiling headroom
  ≥ 2 (§5.4). After GO only two things remain: transport, and a reviewer that cannot emit valid
  JSON.

### 6. Herdr model

**Mapping.** In the reference, a pane maps to a **run/VM** (IMG_3371's table, IMG_3372's five VMs),
and one resumable Claude Code session exists **per box** (`create.just:189-193`,
`run/mod.just:53-76`), used for steering and inspection. Phase-level access is provided by a
**host-side observability CLI over a database** — `just obs phases|tail|procs|kill`
(`just/obs.just:39-66`) — not by re-entering phases. For AWSF the honest mapping is: attempt
session → one Herdr workspace; each phase → one pane labelled `<taskId>/<attempt>/<phaseId>`;
`status.json`, the journal and SQLite remain the sole authority.

**Retained visibility is not evidence.** Three independent proofs:
`.claude/skills/herdr/SKILL.md` — *"An agent turning `idle` does not mean it succeeded — a declined
turn also goes idle. Always `read` the pane (or check artifacts) after the wait fires"*; IMG_3371 —
*"if a box is torn down later, its pane becomes a dead shell"*; IMG_3374 — *"phases default to
fail, so a fail may mean 'never completed'."* A pane proves a PTY existed. Nothing more.

**Privacy — a concrete hazard.** `herdr agent start` **records the argv in the layout** so
`layout.export` can rebuild the fleet, and `[session] resume_agents_on_restore = true`
(`references/command-reference.md:172`) relaunches from it. IMG_3372 shows the reference putting
`--resume <uuid>` on exactly that argv. AWSF spent real work closing this leak: the locator lives
only in `private/continuity.json` at 0600 (`continuity-store.ts:11-23`), and
`production-run.ts:713-731` redacts it by exact match from every persisted `BarrierRecord`.
**Registering AWSF provider processes through Herdr would reintroduce that leak by a path the
redactor cannot see** — Herdr's own layout file. Rules: Herdr-visible launches are permitted only
on `continuity: none` routes, **or** the locator must leave argv entirely before Herdr observes it.
`--env` values are never echoed, and no credential reaches a pane.

**Registration, cancellation, resume.** The registrar stays `TransportBroker` +
`launcher-barrier`; every provider OS process is registered before GO exactly as today, and Herdr
never becomes the process of record. Cancellation terminates the recorded tree through
`createHostController().terminateTree(status.process)` (`cancel.ts:27-35`) and reports survivors; a
surviving pane is not a survivor and a closed pane is not a termination. Herdr's
`resume_agents_on_restore` **relaunches argv** — it does not resume a conversation, and AWSF must
never read it as one.

### 7. Fail-closed cases

| Case | Required behaviour | Where enforced |
|---|---|---|
| Stale / moved base SHA | Refuse before any launch | L25 guard `candidateUnchanged`; pattern at `rework.ts:294-296` |
| Candidate moved | Refuse | `rework.ts:297-299`; `production-run.ts:857,891` |
| Dirty tree (either repo) | Refuse; `assertClean` both sides | `git/changes.ts`; `rework.ts:287-288` |
| Config / route / model changed | `ProductionConfigSnapshotMismatch`; re-read `getModelInfo` and compare | `production-run.ts:447-449`; `rework.ts:534-544` |
| Inversion no longer derivable | `InvalidReviewInversion`, derived by **exclusion from the recorded worker provider**, never re-chosen | `review-routing.ts:44-63`; `production-run.ts:559-574` |
| Missing / unopenable provider session | N/A by design — the replacement reviewer is **cold**, `continuity: none`; a second turn is refused outright | `production-run.ts:1109-1111` |
| Owner allowance exhausted | `CorrectionAllowanceExhausted(tranche)` at step 9 | `task-machine.ts:353-384` |
| Ceiling exhausted | `CallCeilingExceeded` before any child exists; `reserve()` stays synchronous | `call-budget.ts:308-337` |
| **Bad review evidence (new class)** | The review phase's own gate `review_evidence_present` fails ⇒ `PhaseGateFailure`. **A review with no diff cannot pass its phase.** | commit 1 |
| Review answers inconsistently | `verdict_consistent` fails, L15 refuses, attempt stays REVIEWING; owner exits by L18/L16. Host invents no terminal state | `guards.ts:188-207` |
| Reviewer transport failure | One retry on the same route, own reservation, then L17 `review-unavailable`. Quota is never a retry | `review-routing.ts:70-92`; `production-run.ts:389-396` |
| Host crash mid-L25 | Durably REVIEWING with the reservation held; `retry` refuses while `callsReserved > 0`; recovery reconciles from the journal | `retry.ts:33-35`; `call-budget.ts:79-98,464-470` |
| Reservation never reaching GO | Released; a provider that never executed never costs a call | `call-budget.ts:359-362`; `production-run.ts:1496` |
| Subscription route | No `$0.00` is invented; `costUsd: null` | `production-run.ts:1245,1251` |

**The failure paths revision 1 did not name. [R2]** Every one of these has an outcome, and none of
them may leave the attempt in a state with no legal edge.

| Case | Required behaviour | Where |
|---|---|---|
| Malformed or schema-invalid replacement review | L17 → BLOCKED, code `review-malformed` | §5.5; commit 2 widens the guard |
| `review_evidence_present` fails on the replacement | L17 → BLOCKED, code `review-evidence-invalid` | §5.5 |
| `verdict_consistent` fails on the replacement | **Unchanged.** Attempt stays REVIEWING with the failed gate recorded; the host does not decide what a bad review means. With the owner tranche spent, the exits are L18 and — once the failure is recorded — nothing else. Named as a residual, not fixed | `guards.ts:188-207`; §5.5 |
| Permission breach by the readonly reviewer | `PermissionBreach` from `enforce()` naming the complete offending set; the phase fails; L17 `review-evidence-invalid` does **not** apply — a breach is a policy failure, and it takes the existing RUNNING/PREPARED blocker path only if it occurred there. From REVIEWING it is a rethrow, and the attempt is stranded. **Commit 3 must classify it explicitly** rather than inherit the rethrow | `sandbox-broker.ts` `PermissionSession.enforce()` |
| Route / adapter / model drift after L25 was authorized | Refuse before GO; release the reservation; the attempt is durably REVIEWING with nothing spent, and the command is rerunnable because the tranche charge is recovered by the recovery path below | `production-run.ts:501-503`; commit 3 |
| Ceiling headroom < 2 at preflight | Refuse before L25 is authorized. Nothing is spent, the attempt does not leave `AWAITING_OWNER` | §5.4 |
| Crash **before** registration | Reservation held, no child. Recovery releases it and rewinds the tranche charge; the attempt returns to a rerunnable REVIEWING | commit 3 recovery, modelled on `rework.ts:910-975` |
| Crash **between** registration and GO | A registered process record exists with no settled outcome. Recovery observes the process, settles it FAILED or CANCELLED, releases the reservation | `rework.ts:962-970` is the exact precedent |
| Crash **after** GO | The call is genuinely spent. Recovery settles the reservation as spent, records the phase FAILED, and blocks with `review-malformed` — a review that never returned an envelope is indistinguishable from one that returned an invalid one, and both are host-deterministic | §5.5 |
| Persistence or projection failure after the review answered | The existing GATING branch (`production-run.ts:1496-1503`) sets `sqlite-projection-failed` and directs to `awsf db rebuild`. Commit 3 extends the same handling to a REVIEWING-sourced projection fault so a good review is never lost to a bad write | `production-run.ts:1496-1503` |

**Named recovery path.** Revision 1 said *"recovery reconciles from the journal."* That is not an
implementation — generic replay reconstructs files, it does not decide whether an in-flight provider
ran, and `beginAttempt` refuses outright while a reservation is held
(`call-budget.ts:464-470`). The only robust precedent in the codebase is **command-specific**:
`rework.ts:910-975` releases outstanding reservations, stamps a recovery timestamp, marks the phase
FAILED, observes the registered process, and persists a defined outcome. **Commit 3 ships the same
block for `awsf review`**, and re-running `awsf review` on an attempt with a stale reservation runs
recovery first and then refuses or proceeds on the reconciled state. Nothing else in the design may
say "recovery reconciles from the journal."

**Named regression risk.** L25 makes a failed attempt strictly worse: the task leaves
`AWAITING_OWNER` (where it could land) for `REVIEWING` (where it cannot), and a `concern` verdict
at T2 still dead-ends because `ReworkTierUnsupported` blocks L19. **[R2]** Add: the owner tranche is
spent by the authorization itself, so L16 is gone too; and a failed replacement blocks the attempt,
which costs the candidate on `awsf retry`. All of this must be displayed in plain words at the
confirmation prompt before the owner confirms — including the sentence *"if this review fails, the
candidate is lost."*

### 8. Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Blind cancel + retry** | Legal, but discards a green candidate, re-buys a large builder context, and leaves one call — a single reviewer transport fault then exhausts T2 |
| **Durable per-phase checkpoint reuse ("skip a green phase")** | Not implemented in the reference at any level (`runner.py:72-111`, `:131`). It would create a second source of truth beside Git, need an invalidation graph larger than Git + the config snapshot already give, and directly attack "success must be earned" (`phase-machine.ts:131-143`) by making success survive the run that earned it |
| **Universal unconditional resume** | Unsafe three ways: host phases have no conversation to resume and must re-measure; a resumable reviewer becomes negotiable; "no matter the lifecycle state" would make RUNNING reachable from terminal states |
| **A resumable reviewer** | Supplying missing host evidence to a *cold* session is a properly-briefed first turn; **resuming** a reviewer is argument, because its prior verdict is in its context and the new turn asks it to revise. AWSF already encodes this (`awsf.config.yaml:64`; `production-run.ts:494`; reviewer `continuity: none`), and the one-way config/adapter check at `production-run.ts:501-503` exists to keep that narrowing legal |
| **Same-provider substitution** | Forbidden by D10 and `no_fallback: true`; the inversion *is* the experiment |
| **Pane retention as proof of continuity** | Refuted three ways in §6 |
| **A `--skip-green-phases` flag on `retry`** | Same objection as checkpoint reuse, plus it lets stale success cross an attempt boundary, which `retry.ts:42-73` deliberately prevents |
| **Reading quota to decide whether to re-review** | Forbidden outright: routing may never read quota |

**How the design blocks the named failure modes:**

| Failure | Blocked by |
|---|---|
| Stale success | Every reused datum keyed by the exact SHA it measured (`production-run.ts:806-812`); K-revalidation before any authorization |
| Cross-attempt confusion | Continuity handles are attempt-scoped (`continuity-store.ts:74-76`, `:172-181`); reservations never cross an attempt (`call-budget.ts:464-470`) |
| Source / diff drift | The review context is host-observed from Git, never agent-claimed; `review_evidence_present` binds the verdict to the evidence supplied, `verdict_consistent` to the SHA claimed |
| Session substitution | `assertCorrectionIdentity` (4 fields), `assertSameSession` on the stream, and the turn-0 locator check (`production-run.ts:1215-1239`) |
| Provider substitution | Inversion by exclusion; `no_fallback`; `InvalidReviewInversion` before any process |
| Quota-based routing | Routing never reads quota; quota is never a retry (`production-run.ts:389-396`) |
| Unbounded free launches | The correction class requires a **spent** origin reservation, refuses round 0, re-checks the tranche (`phase-launch-authorization.ts:230-243`); L25 charges a real call **and** the owner tranche |

---

## Part III — Authorized implementation

Three commits, hand-built at **zero AWSF provider cost**, in the manner of the T30 continuity
prerequisite. Commit 1 is separable from 2–3: commit 1 alone is the review-evidence repair;
commits 2–3 are what rescue an existing candidate without a rebuild.

### Commit 1 — `feat(awsf): readonly diff-scoped review evidence, and a gate that requires it`

No lifecycle change.

**The compiler gives the reviewer exactly one slot. [R2]** `compileAgent` renders
`{previous_envelope}` and `{output_schema}` and nothing else
(`core/src/workflow/compiler.ts:70-88`); `renderPrevious` substitutes one envelope's JSON. There is
no second placeholder and adding one would be a new prompt-compilation concept. **Therefore the
review context must be a composite envelope carrying everything the reviewer needs**, which is why
the R2 shape below is much larger than revision 1's.

- **New contract** `core/src/contracts/review-context.ts` → `awsf.review-context/v1`. **[R2]**
  Revision 1's shape lost the request, the acceptance criteria and most of the gate evidence. The
  required shape is four groups:

  | Group | Fields | Why it is required |
  |---|---|---|
  | **Intent** | `request` (the owner's verbatim text, `status.request`), `goals[]`, `nonGoals[]`, `acceptanceCriteria[]`, `testStrategy[]` | Without these the reviewer can judge code quality but **cannot judge whether the candidate is what was asked for** — which is the only thing a T2 review is mandatory for. For `build-review` these come from `requestOutput()` (`production-run.ts:257-277`); for `simple-sdlc` from the planner's `PlanOutput`. |
  | **Identity** | `baseSha`, `candidateSha`, `changedFiles[]` (from `candidatePathsBetween`, `:384-387`), `insertions`, `deletions`, `stat` | The tree under review, host-observed, never agent-claimed |
  | **Diff** | `diff` (bounded), `diffTruncated`, `diffOmittedChars`, `diffOmittedFiles[]`, `diffSha256`, `diffRef` | See the bounding rules below |
  | **Gate evidence** | the **complete** `TestOutput` of the last `code` phase — `passed`, `candidateSha`, `commands[]` with `durationMs`, `failures[]`, `outputTail` — plus each command's `outputRef` | Revision 1 kept only `gateId/argv/exitCode/outputRef` and dropped `passed`, `durationMs`, `failures` and the inline `outputTail`. That is a **net loss** against today's reviewer, which at least receives the whole `TestOutput`. Nesting it whole is simpler than curating it and cannot lose a field. |

  Register in `core/src/contracts/registry.ts`.

  **`outputRef` path semantics must be stated. [R2]** `TestOutput.commands[].outputRef` is relative
  to the **attempt directory**, while the provider's `cwd` is the **worktree**
  (`production-run.ts:1330` writes `raw/host-<phaseId>.txt`). A readonly reviewer resolving it
  against its own `cwd` finds nothing. The contract must either carry absolute paths or declare the
  refs unreadable-by-design and rely on the inline `outputTail`. **Choose the latter**: keep the
  refs as provenance for the host and the journal, and say in the prompt that they are not
  openable. Handing a reviewer an absolute path into the attempt directory would work directly
  against §D2.1's confinement.

- **Diff bounding needs its own discipline. [R2]** Revision 1 cited "the head/first-hunk/tail
  discipline already in `core/src/gates/command-evidence.ts`." That citation is wrong:
  `command-evidence.ts:17-19` implements head / **first-failure** / tail, and its failure window is
  found by TAP markers (`:38`, `firstFailureLine` at `:79-87`). Diffs have no failure marker. The
  rules for a diff are different and must be written fresh:
  - Bound **per file, on whole hunks**. Never emit a partial hunk — a truncated hunk is worse than
    an omitted one, because it looks complete.
  - **Deletions are never dropped before additions.** A reviewer that sees only what was added
    cannot see what was removed, and removal is where the defects hide.
  - Any file omitted entirely is named in `diffOmittedFiles[]`, so the reviewer knows what it did
    not see and `limitations` can say so.
  - `diffSha256` is the digest of the **full** diff, and `diffRef` names the host-private copy at
    `raw/review-context-<candidateSha>.diff`, mode 0600.

- **Recipes** `core/src/workflow/recipes/{build-review,simple-sdlc}.ts` — insert a `review-context`
  **`code`** phase immediately before `reviewer`. It adds no agent phase, so `minimumCalls` and
  every tier ceiling are unchanged (`recipes.test.ts:43` pins `minimumCalls`). **[R2]** The exact
  phase arrays at `recipes.test.ts:26-27` do change and must be updated:
  `build-review` → `request:engineer, builder:agent, tests:code, review-context:code,
  reviewer:agent`; `simple-sdlc` → the same insertion before `reviewer:agent`.

- **Runner** `core/src/cli/commands/production-run.ts` — build the context, then pass it as the
  reviewer's `previous` at `:1471` in place of the trailing `TestOutput`. (The reference does
  exactly this at `adw_simple_sdlc.py:119`, which passes `previous=build`, not the test envelope.)
  **Note a name collision to avoid:** `production-run.ts:1449` already binds a local called
  `reviewContext` for the `verdict_consistent` gate. The new contract needs a distinct identifier.

- **New gate** `review_evidence_present` in `core/src/gates/review.ts`, added to the review phase's
  gate list at `production-run.ts:358-372`. **[R2] Revision 1's two checks do not prove what the
  gate claims.** A context carrying the right `candidateSha` and the right six filenames with
  `diff: ""` passes them, so "structurally impossible" was false. The gate's real subject is **the
  serialized prompt**, and it must be provable in two places:

  | When | Check |
  |---|---|
  | **Before the call is spent** (a host precondition, not a gate) | the composed context validates against the contract; `changedFiles` equals the host-observed set; if `changedFiles` is non-empty then `diff` contains at least one hunk header and, where the candidate deletes lines, at least one `-` line; `diffSha256` matches the full diff on disk; `request` is non-blank. **Fail here and no provider starts** — a review that could not have been evidence is never bought. |
  | **After the phase, as the gate** | the phase's recorded compiled prompt (`production-run.ts:1011`, `type: "compiled-prompt"`) **contains** the serialized context — asserted by digest, not by re-deriving it. The gate hashes the substring the compiler produced and compares it to `diffSha256` plus a digest of the context JSON. |

  This is what makes the claim true: the first check proves the evidence was *fit*, the second
  proves it was *delivered*. Neither is satisfiable by an empty diff.

- **Reviewer widened to `readonly` (D2)** — `awsf.config.yaml`:
  `tools: { profile: readonly, allow: [read, grep, find, ls] }`, `writes: []` unchanged,
  `continuity: none` unchanged. `writes_within_globs` (`production-run.ts:368-371`) keeps any
  observed write a breach. **[R2]** Add the state-root mask from §D2.1: in
  `core/src/policy/sandbox-broker.ts:77-101`, after `--ro-bind "/" "/"`, emit `--tmpfs <stateRoot>`
  and then the existing `--bind request.sessionRuntime`. Order matters and the descriptor test must
  assert the exact argv, as `buildSpec`'s header requires of adapters
  (`claude-code.ts:431-436`).

- **Prompts** `prompts/reviewer/{user,system}.md` — following the reference's wording: judge the
  code on disk, never the builder's summary; start from the supplied `changedFiles`, read them,
  and use the supplied diff for anything the file list does not explain; state that `exec` is not
  available, so the host-supplied diff is the substitute for `git diff`; **[R2]** state that
  `outputRef` values are not openable; require `limitations` to name anything in
  `diffOmittedFiles[]` it could not verify by reading the file directly.

- **Tests:** a journey asserting the compiled reviewer prompt contains the request, the changed-file
  list and diff hunks for a fixture candidate; `review_evidence_present` negatives (absent context,
  mismatched SHA, mismatched file set); **[R2]** plus: empty `diff` with non-empty `changedFiles`;
  a diff whose hunks are all omitted; a candidate that only deletes lines; a `diffSha256` that does
  not match the file; a context missing `request` or `acceptanceCriteria`; a context whose gate
  evidence lost `outputTail`; and a prompt-digest negative where a valid context was composed but
  not rendered. A bounding test on an over-budget diff asserting no partial hunk is ever emitted. A
  permission test proving the readonly reviewer can read and cannot write, that `exec`/`bash`
  outside the ceiling is refused by `resolvePermissionProfile` (`permission-profiles.ts:52-59`), and
  that the bwrap argv masks the state root. The 100-pair lifecycle matrix unchanged at 24/76.

### Commit 2 — `feat(state): L25 AWAITING_OWNER → REVIEWING`

Protected path. Authorized by **D1**.

- **Separate the two correction allowances first. [R2]** Not "stop `beginPhase()` resetting
  `correctionsOwner`" — that would break the per-phase contract stated verbatim at
  `call-budget.ts:445-450`. Introduce an attempt-scoped counter (working name `ownerReentries`,
  with `allowance.ownerReentries`) alongside the existing per-phase pair:
  - `CallBudget` gains `#ownerReentries`, charged in `authorize()` when
    `result.spends.correctionTranche === "owner"` (`call-budget.ts:411-413`), **not** charged by
    `recordPhaseTransition`, **not** reset by `beginPhase()`, reset by `beginAttempt()` and by
    `retry.ts:56-57`.
  - `task-machine.ts` step 9 (`:353-363`) reads `ownerReentries` for **task** edges; the per-phase
    counters remain the input to `phaseTransition`.
  - `guards.ts:173-179` (L13) must decide which it means. It means both: a task may not be blocked
    for exhausted budget while either an intra-phase owner correction **or** an owner re-entry
    remains. Add the third check.
  - Persistence and display, all of which currently read `correctionsOwner`:
    `core/src/execution/call-budget.ts:212,226,239,279`; `core/src/cli/commands/new.ts:60`;
    `core/src/cli/commands/retry.ts:57`; `core/src/cli/commands/attempt-projection.ts:40`;
    `core/src/observability/projector.ts:75,123` (a new column and a projection version bump);
    `core/src/api/routes.ts:349`; `core/src/cli/commands/status.ts:40`;
    `core/src/cli/commands/rework.ts:517,547,575,584`; `core/src/cli/commands/production-run.ts:707`
    (the redaction-safe budget record); and the dashboard's budget display.
  - **`rework.ts:547` is the precedent to preserve**, not to break: it names its runtime directory
    `private/owner-rework-${correctionsOwner + 1}`. Once the counters split, that expression must
    read the re-entry counter, or two owner reworks in one attempt would collide.
  - Tests proving all three properties: an owner re-entry survives `beginPhase()`; an ordinary
    intra-phase correction still resets per phase exactly as before; L13 refuses while either
    allowance remains.
- `core/src/state/task-machine.ts` — add L25 as specified in §5.3; add `"L25"` to
  `CORRECTION_EDGES`; extend `EdgeId`.
- `core/src/state/guards.ts` — the L25 guard, all eleven checks of §5.3, **[R2]** including
  `gateEvidence` and the `reviewEvidenceDefect` enum.
- **[R2] Widen L17 per §5.5** — guard accepts `reviewTransportRetries >= 1` **or** a
  `reviewFailure` of `review-malformed` / `review-evidence-invalid`; extend L17's blocker-code
  vocabulary from one code to three (`guards.ts:240-245` and the `blockerCode` table). This repairs
  the pre-existing dead end in §3.3 and is independently worth landing.
- `specs/awsf-plan.html` — L-table row, class table `33 → 32`, totals `25 / 75`, escalation-ladder
  rung 5 amended, the L17 blocker vocabulary, the two correction allowances as distinct concepts,
  plus an Amendment recording the reasoning, the tranche coupling (D3), and the regression risk
  in §7.
- **[R2] Every exact-count fixture, not only `_lifecycle-tables.ts`:**
  - `core/test/unit/_lifecycle-tables.ts` — re-transcribed **by hand**, never derived from the
    implementation. `:51` `EdgeId` union; `:94` L-table; `:110-122` the class-arithmetic comment;
    `:161` the 33-member comment; `:223` the rejection-order table.
  - `core/test/unit/transitions.test.ts:3-5,44-48` — the header comment and the four
    `assert.equal` class sizes (`33 → 32`).
  - `core/test/unit/rejection-order.test.ts:62-64` — the comment restating `27 + 10 + 6 + 33`.
  - `core/test/unit/execution/spawn-sites.test.ts:108-111,117,144,156` — the exact five-site list
    becomes six, `LEGAL_EDGES.filter(spawnSite).length` becomes 6, and the "ninety-five" refusal
    count becomes 94.
  - `core/test/unit/_lifecycle-harness.ts`, `actors.test.ts`, `ceilings.test.ts`, `evidence.test.ts`
    — an L25 case in each fixture set.
  - **Comments that restate the count:** `core/src/execution/transport-broker.ts:64-74` ("The five
    task-edge spawn sites"), `core/src/execution/launcher-barrier.ts:309`. **The types do not need
    changing** — `SPAWN_SITE_EDGES` is *derived* from `LEGAL_EDGES.filter(edge => edge.spawnSite)`
    (`transport-broker.ts:75`), so L25 propagates automatically. Revision 1's instruction to
    "extend `ProcessRegistration`'s edge union" was **unnecessary** and is withdrawn.

### Commit 3 — `feat(cli): awsf review, one owner-authorized replacement review`

- **Command name.** Use `awsf review <task>`, **not** `awsf re-review`. The doc-reconciliation
  meta-test matches CLI commands with `/(?:^|\s)awsf (db rebuild|[a-z]+)\b/`
  (`core/test/unit/meta/doc-reconciliation.test.ts:35`), which cannot match a hyphenated name — a
  documented `awsf re-review` would be read as `awsf re` and fail the CLI-table check. `review` is
  a single word, collides with no existing command, and reads correctly. Add it to `CLI_COMMANDS`
  in `core/src/cli/main.ts:29`.
- TTY-only: `awsf review <task> --reason "<why the recorded review is not evidence>"`.
- **Pre-launch, all before any process:** config-snapshot equality; candidate / base / worktree /
  canonical revalidation per §5.1; **[R2]** exact gate-row revalidation — every configured gate has
  a `passed` row bound to `candidateSha` under the current config snapshot, not merely
  `gatesPass === true`; **[R2]** eligibility — the recorded review's `review_evidence_present` row
  is absent or failed (§5.3.1), and the command refuses with `ReviewNotReplaceable` if the review is
  fully evidenced; inversion re-derived by exclusion from the **recorded** worker provider;
  adapter / provider / requestedModel identical to the recorded reviewer route; **[R2]** ceiling
  headroom **≥ 2** (§5.4); owner re-entry allowance unspent. Display the SHA, the summary, the
  superseded verdict, the evidence defect that makes it replaceable, the remaining calls, and the §7
  warnings — including *"if this review fails, the candidate is lost"*; then confirm.
- Authorize L25 with `spawn: { cost: 1 }`; register the process before GO; **[R2]** re-read worktree
  and canonical HEAD immediately before GO (§5.3.2 step 2); run the reviewer **cold**; apply
  `verdict_consistent` **and** `review_evidence_present`; **[R2]** re-read both HEADs and assert
  clean after the review answers and before L15 (§5.3.2 step 3); then L15 → `AWAITING_OWNER` with
  the new verdict and `requiredReviewPresent: true`.
- **[R2] Generation-qualified persistence identities.** Revision 1 claimed *"the superseded review
  stays in the journal, immutably. Nothing is deleted or rewritten."* **That is false as designed** —
  a fresh run id does not make any of these unique, and each would be overwritten:

  | Identity | Constructed at | Collides as |
  |---|---|---|
  | Envelope file | `production-run.ts:779` — `envelopes/${phaseId}-${round}.json` | `envelopes/reviewer-0.json` |
  | DB phase row | `:973` — `dbPhaseId(status.sessionId, phase.id)` | same phase id |
  | Gate rows | derived from that phase id and the correction round | same gate ids |
  | Runtime dir + system prompt | `:982-984` — `private/${phase.id}`, mode 0700 | `private/reviewer` |
  | Compiled prompt record | `:1011` — `type: "compiled-prompt", phaseId` | same phase id |
  | Raw host output | `:1330` — `raw/host-${phaseId}.txt` | same file |

  The replacement runs under a **generation-qualified phase identity** — `reviewer-re<N>`, where
  `N` is the owner re-entry counter — applied uniformly to all six. `rework.ts:547` already does
  exactly this with `private/owner-rework-${n}`, so this is an existing pattern, not a new concept.
  The original review's artefacts are then genuinely immutable, and the projection shows both.
- **[R2] Command-specific crash recovery**, modelled line for line on `rework.ts:910-975`: release
  outstanding reservations, stamp a recovery timestamp, mark the phase FAILED with defined
  start/end times, observe the registered process and settle it, persist a defined outcome, and
  rewind the owner re-entry charge when nothing was spent. Re-running `awsf review` on an attempt
  with a stale reservation runs recovery first. "Recovery reconciles from the journal" is removed
  from this document.
- **[R2] Every non-transport review failure is classified**, per §5.5: `review-malformed` and
  `review-evidence-invalid` take L17 → BLOCKED; a permission breach is classified explicitly rather
  than inheriting `production-run.ts:1512`'s rethrow; a `verdict_consistent` failure keeps the
  existing behaviour and is documented as the one residual.
- **[R2] Landing and journey display both verdicts.** `land.ts:60-71` builds `LandingEvidence` from
  the boolean `status.requiredReviewPresent`, and `guards.ts:284` checks only that it is `true`.
  The confirmation screen must show the superseded verdict, its evidence defect, and the replacement
  verdict side by side, so the human gate at L20 sees that a review was replaced and why.
- Never touches `journeyApproved` — the candidate did not change, so the attestation still concerns
  the same tree.
- **Tests:** happy path on scripted adapters proving `callsSpent` advances by exactly one and no
  builder ran; every refusal above; a fully evidenced review refused as not replaceable at zero
  cost; a same-provider substitution refused at zero cost; a transport failure retried once then
  L17; **[R2]** a `simple-sdlc` attempt at four spent calls refused for insufficient headroom;
  **[R2]** a malformed replacement reaching L17 `review-malformed`; **[R2]** a candidate moved
  between preflight and GO, and between the review and L15, each refused; **[R2]** a replacement
  writing `reviewer-re1` artefacts with the original `reviewer-0` set byte-identical afterwards; a
  crash between L25 and GO recovered by the command's own recovery path; `awsf review` present in
  `CLI_COMMANDS` (`core/src/cli/main.ts:29`) and in the README so doc-reconciliation passes.

### Deferred — commit 4, not authorized

The general form — `awsf continue <task> --workflow review-only|document-only`, minting attempt
*n+1* that **adopts** attempt *n*'s base/candidate/worktree and carries `callsSpent` — is the
correct long-run generalization and is exactly the reference's `adw_document.py` pattern. It
changes `retry.ts`/`start.ts` semantics and the "PREPARED attempt has no managed worktree"
assumption. **It is not M9, and opening it now would widen T30's experiment.** Not in scope.

---

## Part IV — Execution recommendations

These are recommendations on *how to run the implementation*, recorded here so the sequence is
reproducible.

### IV.1 Verify the design before implementing it — yes

**Recommended: one adversarial verification session on this document before commit 1 begins**, on
`codex:gpt-5.6-sol` at **high** reasoning, report-only, zero writes, zero AWSF calls.

Rationale:

- Commit 2 edits `core/src/state/**`, a protected path, and changes a **normative** contract. That
  is the highest-blast-radius change available in this repository, and the eleven-step rejection
  order plus the 100-pair matrix are transcribed by hand — the class of artefact where a
  second reader is worth most.
- The design rests on at least five claims that are falsifiable by reading code, and each one
  changes the plan if wrong: (a) `L4.spawnSite === true` forbids a review-only recipe; (b) the
  class table decomposes `27 + 10 + 6 + 32 = 75` after the change; (c)
  `beginPhase()` erases an owner-tranche charge; (d) `readonly`'s ceiling excludes `exec`, so the
  host diff is complementary rather than redundant; (e) the doc-reconciliation regex cannot match
  a hyphenated command name.
- It costs **no AWSF provider call** — it is an owner-side session, not an AWSF workflow, and it
  does not touch the tier-2 ceiling of the pilot.
- Running it on Codex gives natural provider inversion between the *verifier of the plan* and the
  *implementer of it*, mirroring the factory's own discipline.

Scope it deliberately: the verification session must **not** re-litigate D1–D4, which are settled.
It verifies falsifiable claims and hunts for what the design missed.

### IV.2 Which provider implements — Claude

**Recommended: `claude:opus-5` for all three commits.**

- Commit 2 is high-precision contract transcription across interlocking files — the state machine,
  the guard table, a hand-written 100-pair fixture, and a 580 KB HTML plan with normative tables.
  This is the same class of work as the T30 continuity prerequisite, which was built on
  `claude:opus-5`.
- **Quota argument, specific to this pilot:** the pilot's builder route is `codex` /
  `openai-codex`, and T30's build prompt warns that the driving session is by far the larger
  consumer and that starving the worker's pool blocks a leg D16 forbids rerouting. A long
  three-commit implementation session on Codex burns exactly the pool the builder needs. Claude is
  the reviewer pool for this pilot and is the safer consumer for repo-internal work.
- Stated plainly for completeness: this is work **on** AWSF, not a workflow AWSF runs, so no
  inversion rule applies to it. The quota argument stands on its own.

### IV.3 Session split — three sessions, one per commit, in order

| Session | Commit | Model | Effort | Notes |
|---|---|---|---|---|
| 0 | *(verification of this document)* | `codex:gpt-5.6-sol` | reasoning **high** | Report-only. Zero writes, zero AWSF calls. |
| 1 | Commit 1 | `claude:opus-5` | **high** | Self-contained: contract, recipe insert, runner wiring, gate, config, prompts, tests. Lands green alone. |
| 2 | Commit 2 | `claude:opus-5` | **xhigh** | The contract change plus the `beginPhase()` fix. Maximum care: the 25/75 matrix and `_lifecycle-tables.ts` are transcribed by hand. |
| 3 | Commit 3 | `claude:opus-5` | **high** | Depends on 1 and 2. |

Why split rather than one session:

- Each commit must pass the full gate ladder independently, and `AGENTS.md` invariant 2 forbids
  flipping a marker for work not completed in that session.
- A single session would have to hold the lifecycle table, the production runner, and a new CLI
  command in one context. That is precisely where a transcription error in `_lifecycle-tables.ts`
  creeps in — and that file is the thing that proves the contract.
- Commit 2 landing alone is safe: an edge with no caller is inert, fully covered by the 100-pair
  sweep, and recorded in the plan.

**[R2] The acceptable variation is withdrawn.** Revision 1 allowed merging commits 2 and 3. After
adjudication, commit 2 has grown to include the correction-counter split — which touches the
budget, the projection schema, the API route, the status CLI, the dashboard and `rework.ts` — plus
the L17 widening, on top of the hand-transcribed 25/75 matrix and six exact-count test fixtures.
That is already the largest of the three. **Commits 1, 2 and 3 each get their own session, in
order.** Commit 2 may itself be split if the counter separation and the lifecycle edge want
separate gate ladders; splitting it is always safe, merging it is not.

**[R2] Commit 2 no longer lands inert.** Revision 1 justified landing commit 2 alone on the grounds
that "an edge with no caller is inert." That is still true of L25, but the counter split and the
L17 widening are live the moment they land: the counter split changes `awsf status` output and the
projection schema, and the L17 widening changes what happens to a malformed review today. Commit 2
must therefore pass the full gate ladder on its own merits, not on inertness.

### IV.4 Standing constraints for every implementation session

- Zero AWSF provider calls. These commits are hand-built; the tier-2 ceiling belongs to the pilot.
- No push, no deletion, no external mutation, no credential access, no `shell: true`, no
  `.orchestrate`, no provider fallback.
- Every commit's author and committer identity is the owner's own; no agent, model or tool is ever
  named as author, committer, co-author or collaborator (`AGENTS.md` invariant 11).
- No live task state in any committed file (`AGENTS.md` invariant 1).
- The retained pilot attempt is evidence. Do not cancel, retry, attest, land, edit or delete it.
- `specs/awsf-plan.html` and `specs/tickets/` never disagree; any marker moves in the same commit
  as the work that earned it.

---

## Part V — Skills: the driving-session layer AWSF does not have

Added after the original investigation, at the owner's direction, having read the reference clone's
`.claude/skills/` and `.claude/commands/` in full.

**Verdict: valuable, and a real gap — but at exactly one tier, and it must never touch another.**
This is new scope. It does not block, delay, or modify commits 1–3, and it costs zero AWSF provider
calls.

### V.1 What the reference actually has

Four skills and two slash commands, all under `.claude/`:

| Artefact | Lines | Drives |
|---|---|---|
| `skills/sssf/SKILL.md` + 9 cookbooks + 3 references + templates + the visualizer app | 1,447 md | The factory itself: install, create/run/update an ADW, manage the roster, observe |
| `skills/sssf-sandbox-orchestrator/SKILL.md` + 8 cookbooks + 5 references | 2,416 md | The out-of-sandbox VM lifecycle: mount, execute, observe, harvest, teardown, reap |
| `skills/herdr/SKILL.md` + 2 cookbooks + 1 reference | 950 md | The terminal multiplexer: workspaces, tabs, panes, agent state, blocking waits |
| `skills/sandbox-exe-dev/SKILL.md` + cookbooks + a bundled Python CLI | 798 md + code | The exe.dev VM provider surface |
| `commands/prime.md` | 29 | Orient a fresh session in the three layers, in a fixed reading order |
| `commands/install.md` | 94 | Toolchain check, dependency install, `.env` verification, preflight |

**[R2]** The line counts above are measured (`find … -name '*.md' -not -path '*/templates/*' | xargs
wc -l`), correcting revision 1's estimates, which were low by 10–40%. The first two rows are 1,447
and 2,416 lines respectively — the sandbox orchestrator alone is larger than revision 1 claimed for
the two biggest skills combined. This matters for sequencing: a faithful AWSF port is not a weekend
of markdown, and §V.9 sizes commits 5–7 accordingly.

Transcript backing, verbatim:

> "Let's go ahead and kick off the skill that activates our agents understanding. This is going to
> be SSF, agent, sandbox, orchestrator… **It's got all the context primed, ready to go.** And it can
> see that we have one VM running." (ll. 24–26)

> "I've got a couple really, really important skills that my orchestrator agent is working off. If
> you open up cloud skills, you can see here I have four essential skills. Herder, sandbox exe.dev,
> super simple software factory, and then our super simple software factory orchestrator agent.
> **So this is a composite skill. I don't like to compose my skills. It makes it really hard to
> change things. You create these nasty dependency graphs. But when things are unified in a single
> monorepo, you can make an exception to the rule.**" (ll. 237–242)

> "**I've taught my agent exactly how to do this.**" (l. 253)

> "you need an agent layer wrapping whatever you're trying to do… **It's that meta layer. It's that
> building the system that builds the system.**" (l. 246)

IMG_3343 lists them on screen: `SKILLS  /herdr, /sandbox-exe-dev, /sssf, /sssf-sandbox-orchestrator`.

### V.2 The architectural fact that decides everything — **rewritten in R2**

Revision 1 asserted: *"No skill is in the factory's execution path… That is the whole reason they
are safe,"* and §V.8 offered `grep -r '\.claude' core/src` returning nothing as the guard. **Both
the claim and the guard are wrong, and the verifier is right to reject the section on them.** The
corrections are load-bearing enough to state separately.

**Correction 1 — the reference *does* put a skill in an execution path.**
`just/sandbox/orch/mod.just:29` launches
`claude --dangerously-skip-permissions "Read and Execute .claude/skills/sssf-sandbox-orchestrator/SKILL.md"`,
and `:33` does the same through `pi`. The skill is the orchestrator's entire program. What is true
is narrower and must be said in exactly these words: **no skill is read by an ADW phase.** No file
under `adws/` references `.claude`; phase agents receive `system.md` / `user.md` from
`adws/adw_data/prompt_engineering/`, which is versioned config. The isolation is between the
*orchestrator tier* and the *phase tier*, not between skills and execution.

**Correction 2 — a source grep proves nothing about discovery.** The baseline is real:
`core/src/**` and `dashboard/**` contain zero references to `.claude`. But AWSF does not read
skills; **the provider CLI does**, from its working directory. And the two adapters differ:

| Adapter | Skill discovery | Evidence |
|---|---|---|
| `pi-codex` | **Suppressed explicitly** | `core/src/adapters/pi-codex.ts:619-624` pushes `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-themes`, `--no-context-files` |
| `claude-code` | **Not suppressed** | `core/src/adapters/claude-code.ts:437-453` builds argv with no equivalent flag, and `:457` sets `cwd: request.cwd` — the managed worktree, a checkout of this repository |

So the moment `.claude/skills/awsf/` is committed, every Claude-route phase — builder, reviewer,
documenter — runs with that tree in its working directory. Whether the CLI then *exposes* it is a
question about a flag's gating behaviour, not about AWSF's code. There is a partial bound: both
`readonly` and `managed-worker` pass an explicit `--tools` allowlist that contains no skill-invoking
tool (`claude-code.ts:171-185`). **But that bound is unverified**, and this repository has already
written down why an unverified flag assumption is not a control — the `no-tools` comment at
`claude-code.ts:150-161` refuses exactly this reasoning: *"Confirming that the flags PARSE… says
nothing about how they GATE, and if the empty string is ever treated as absent, the strictest
profile in this adapter silently becomes the widest one."*

**What this changes.** A skill that teaches an owner-side driving session how to prepare a task,
read a blocked attempt, and decide owner acts is *precisely* the content that must never reach a
worker phase's context. Hard rule 1 of §V.7 survives — it is still the right rule — but its
justification and its guard both have to be replaced. §V.6 relocates the skill and §V.8 replaces the
grep with a behavioural fence.

The underlying principle is unchanged and is the reason the rule exists at all: a skill is
unversioned-at-runtime natural language that a model may or may not follow. It is fine as
**judgment about which deterministic command to run**; it is disqualifying as anything a gate, a
transition, or an accounting decision depends on.

### V.3 Is this valuable to AWSF? Yes — and its own record already says so

AWSF has a deterministic host, a lifecycle contract, a CLI, a journal, a SQLite projection and a
dashboard. What it has **nothing** for is the tier above all of that: the owner-side driving
session that decides what to ask for, prepares the state root, launches, watches, reads a blocked
attempt, and decides what to do next. Every one of those has so far been improvised per session.

The cost of that gap is already on the record, disclosed in the plan's own Amendment
`#t30-pilot-2-continuity-friction-2026-08-13`:

- *"The first exact-id task … was **mistakenly created from the AWSF working directory** and
  prepared against AWSF SHA `e6e57ec`; it spent zero calls and **remains retained** because the
  session may not delete or rewrite history."* — a permanent junk task from a wrong working
  directory. A twelve-line preflight cookbook prevents it.
- *"That corrected run was **first invoked before its state-root prompt files existed**; it refused
  from `PREPARED` at zero calls, after which the missing prompt files were supplied."* — a second
  preventable false start in the same pilot.

Both are exactly the class of mistake `commands/prime.md` and a `mount_one.md`-style preflight
cookbook exist to eliminate. The reference paid for its cookbooks the same way — `gotchas.md` opens
*"Every trap below was measured on live hardware, and each one cost a debugging cycle."*

### V.4 What ports, what does not

| Reference skill | AWSF equivalent | Verdict |
|---|---|---|
| `/sssf` — drive the factory | **`/awsf`** — drive AWSF: `new · start · run · status · watch · journey · land · cancel · retry · review · doctor · gc · dash · db rebuild`; read the journal, the status store and the SQLite projection; know the lifecycle | **Build it.** Highest value by a wide margin. |
| `/sssf-sandbox-orchestrator` — drive the VM tier | *none* | **Do not port.** AWSF has no sandbox tier: its isolation is a managed Git worktree plus permission profiles and a sandbox broker, not a disposable VM. Porting it would mean inventing a tier that does not exist, and every one of its hard rules is about credentials and teardown decisions AWSF never makes. |
| `/herdr` — the multiplexer | **`/herdr`**, usable close to verbatim as an owner-side observability and fleet skill | **Optional, later.** Only after §6's privacy rules are written into it: Herdr records `agent start` argv in its exportable layout, so a continuity locator must never reach a pane's command line. |
| `/sandbox-exe-dev` — the VM provider CLI | *none* | **Not applicable.** |
| `commands/prime.md` | **`/prime-awsf`** — a fixed reading order: `AGENTS.md` → the Lifecycle Contract → the phase submachine and escalation ladder → `awsf.config.yaml` → the state-root layout → live status. Then stop and wait. | **Build it.** Cheap, and it is the direct fix for the two disclosed pilot false starts. |
| `commands/install.md` | folded into `/prime-awsf` as a preflight section (`npm run test:unit`, `awsf doctor`, config validity, state-root presence) | **Fold in.** AWSF already has `awsf doctor`. |

Four sub-documents transfer with unusually high value:

1. **`sssf/cookbooks/how_to_prompt_for_the_eng.md` — the single most transferable artefact in the
   repository.** AWSF has literally nothing equivalent, and the request text is not incidental: it
   is persisted by the `request` engineer phase and rendered into the plan envelope every phase
   reads (`core/src/cli/commands/production-run.ts:257-277`). Its governing rule —
   *"**The intent is theirs. The precision is yours.**"* — and its four-line shape (the ask · Where ·
   Done means · Out of scope) apply to AWSF unchanged. Its warning is sharper at AWSF's prices than
   at the reference's: *"Your prompt might run through 10s or 100s of agents. A sloppy prompt is not
   a small tax; it is paid again by every agent in the chain."* At T2 that tax is paid against a
   five-call ceiling.
2. **`sssf-sandbox-orchestrator/references/gotchas.md` — the measured-trap table.** AWSF's traps are
   currently scattered across code comments and plan Amendments with no lookup surface for a driving
   session. It already has enough to fill one: `--no-session` winning over `--session-id` at pi's
   `main.js:206-208`; `--fork-session` being the cold restart the mechanism exists to refuse;
   `output.slice(-4000)` holding the count or the cause but never both; the continuity locator
   riding argv into `processes.command_json`; and `ReworkTierUnsupported` at T2.

   **[R2] A gotchas table must never carry a repaired defect as a live trap.** Two entries revision
   1 listed — *"the reviewer receives `TestOutput` and no tools"* and *"the dormant `beginPhase()`
   tranche erasure"* — are exactly what commits 1 and 2 repair. Carried forward unlabelled they
   would send a driving session hunting a symptom that no longer exists, which is the failure mode
   `gotchas.md` exists to prevent. **Rule: every entry is either currently reproducible, or moved to
   a clearly separated `Historical` section naming the commit that closed it.** The historical
   section earns its place — knowing that a review before commit 1 audited nothing is exactly what
   makes L25's eligibility rule (§5.3.1) legible — but it is never mixed with the live table.
3. **`sssf-sandbox-orchestrator/cookbooks/debug_a_failed_gate.md`, first rule.** *"When one fails it
   **reports, stops, and leaves the VM running**. That is deliberate: the evidence you need is on
   the box, and a gate that auto-destroys throws it away… So the first rule of debugging a gate
   failure is: **do not tear down. Read the box.**"* The AWSF translation is exact and is the
   discipline this entire investigation exists to encode: **a BLOCKED or AWAITING_OWNER attempt is
   evidence — do not cancel and retry before reading the retained journal, envelopes, gate rows and
   command output.** Had that cookbook existed, pilot 2's blind-retry temptation would have been
   answered by a document instead of by an owner's instinct.
4. **`sssf/cookbooks/run_adw.md` § "When a run is stuck".** Its ordering — *which phase is still
   running → what that phase is actually running, with pids → stop it* — maps onto `awsf status`,
   `awsf watch`, the `processes` projection, and `awsf cancel`. Its closing warning is one AWSF
   shares exactly: *"**every phase defaults to `fail`** — a phase showing `fail` may simply never
   have completed; `queued` means it never started. Don't dress up a partial run as a success."*

### V.5 The eight design principles to port, each with its source

1. **Thin skill, fat recipes** — `sssf-sandbox-orchestrator/SKILL.md:13-24`: *"Every action you take
   should be a `just` command a human could type. The recipes hold the knowledge; this skill holds
   the judgment about which one to run and how to read the result… If a recipe is wrong, **fix the
   recipe** and say so. Do not route around it."* AWSF form: **thin skill, fat CLI.** Every action is
   an `awsf` command. Reading the journal or the SQLite projection directly is expected; hand-rolling
   a Git operation, a transition, a reservation or a journal write is forbidden. A wrong CLI is fixed
   in the CLI.
2. **Lazy-load through a routing table** — `sssf/SKILL.md:45-58`. The skill body is a router; deep
   specs load only when a request calls for them.
3. **Volunteered state is guessed state** — `sssf/SKILL.md:26-31`: *"An orchestrator that improvised
   a status board queried a `runs` table and a `payload` column — neither exists… Probing to look
   prepared is how you end up confidently wrong in your first message… **It is stale on arrival.**
   State printed before the request describes a system that the very next run changes."* For AWSF
   this is not merely good practice — it is how a skill stays compatible with `AGENTS.md` invariant 1.
   A skill that printed a live status board on startup would be one edit away from a committed file
   encoding which attempt is running.
4. **Reference, never duplicate** — `sssf-sandbox-orchestrator/SKILL.md:28-31`: *"This skill
   **references** `/sssf` and `/sandbox-exe-dev` rather than duplicating them… a copy pasted here
   would be a second source of truth that goes wrong quietly — a stale model id, a renamed flag. Read
   them; do not quote them."* This is the rule that decides what an AWSF skill may contain: it points
   at `core/src/contracts/`, `core/src/state/`, `awsf.config.yaml` and the plan. It never restates a
   schema, an edge, a ceiling or a gate id, because those are single-sourced in TypeBox and in the
   state machine, and a restatement is drift waiting to happen.
5. **The orchestrator does no worker work** — `sssf/SKILL.md:38-44` and
   `how_to_prompt_for_the_eng.md:21-27`: *"You never touch the application, you prompt, monitor,
   observe, and report… You operate only on the agentic layer."* AWSF form: the driving session
   never implements the task, never edits the managed worktree, never hand-edits an envelope or the
   state root. It drives AWSF and reports.
6. **Never decide destruction** — `sssf-sandbox-orchestrator/SKILL.md:134-138`: *"**Never decide
   teardown.** Report what the run produced, what it cost, and recommend — the human decides."* AWSF
   form, and stronger, because the lifecycle already enforces it: cancel (L22), journey attestation,
   rework (L19) and landing (L20) are all `interactive: true` owner acts. The skill must not offer to
   perform them, only to prepare and explain them. **[R2]** Its analogue of *"harvest is the
   exception you may run freely"* is: `status`, `watch`, `dash` and journal reads, which are
   genuinely read-only — **plus `db rebuild`, which is not read-only and must not be described as
   such.** `core/src/observability/rebuild.ts:212-223` builds a fresh database at
   `awsf.db.rebuild-<stamp>`, hard-links the live one aside as `awsf.db.superseded-<stamp>`, and
   `rename`s the new file into place. That makes it *non-destructive and idempotent* — which is
   precisely what the reference says about `harvest` (*"it only reads the box and only writes
   `refs/sandbox/`"*), so the analogy holds once the word is corrected. The skill says
   "non-destructive", never "read-only".
7. **Report the handle every time** — `:150-151`. AWSF form: every report names the task id, the
   attempt, the lifecycle state, and `callsSpent / ceiling`. Those four are what the next session,
   the next command, and the owner all key off.
8. **Prompt discipline before launch** — `how_to_prompt_for_the_eng.md` in full, per V.4.1.

### V.6 Proposed AWSF skill set

#### V.6.0 Where it lives — the decision V.2 forces **[R2]**

Two options were put by the verifier. Both were assessed; one is recommended.

| Option | What it requires | Assessment |
|---|---|---|
| **A. Owner-global / private location** — `~/.claude/skills/awsf/`, developed in this repo under a non-discoverable path (e.g. `docs/driving/`) and installed by the owner, or kept wholly outside the repository | Nothing from the adapters. A path the provider CLI does not scan from the worktree cannot be discovered from the worktree | **Recommended.** It is correct by construction rather than by a flag whose behaviour we have not verified, and it needs no change to `claude-code.ts` — a file the adapter fence and a hand-asserted descriptor test both guard (`core/test/unit/meta/adapter-fence.test.ts:15-29`) |
| **B. Repository `.claude/`, plus a Claude descriptor mechanism that disables project skill/command discovery** | Find the flag, add it to `buildSpec`, and pin it in the descriptor test in exact argv order as `claude-code.ts:431-436` demands. Then it is enforced, not assumed | Defensible, and strictly better than A *if* such a flag exists and is verified. But it makes a markdown convenience the reason to touch the adapter — the wrong order of priorities for a T30 pilot |

**Decision: option A, with the door left open to B.** Commits 5–6 write the skill to a
**non-discoverable path inside this repository** — `docs/driving/` — so it is versioned, reviewable
and reconciled by the meta-tests like any other document, and the owner installs or symlinks it into
`~/.claude/skills/awsf/` for their own sessions. `.claude/` at the repository root stays empty and
uncreated. If a verified Claude flag for suppressing project skills later lands in `buildSpec`
alongside pi's `--no-skills`, moving the tree to `.claude/` becomes a one-commit change and §V.8's
fence is what makes that move safe.

**This is the one place where the reference is not a model to follow.** IndyDevDan's monorepo runs
its orchestrator *from* `.claude/skills/`, and it works because his phase agents run inside
disposable VMs where a leaked orchestrator skill costs nothing. AWSF's phases run in a worktree of
the repository that contains the skill. The asymmetry is real and it is the reason to diverge.

The layout below is the content; only its root changes.

```
docs/driving/          (installed by the owner as ~/.claude/skills/awsf/ + commands/)
├── commands/
│   └── prime-awsf.md                     orientation + preflight, fixed reading order, then stop
└── skills/
    └── awsf/
        ├── SKILL.md                      router + orchestrator posture + hard rules
        ├── cookbooks/
        │   ├── how_to_prompt_for_the_owner.md   the four-line request shape, tier selection
        │   ├── preflight_a_task.md              clean canonical HEAD, cwd, config, prompt files,
        │   │                                    state root, `awsf doctor` — the two disclosed
        │   │                                    pilot-2 false starts, prevented
        │   ├── run_and_observe.md               launch, watch, read the journal and projection
        │   ├── read_a_blocked_attempt.md        "do not cancel and retry — read the evidence first"
        │   ├── owner_acts.md                    journey, land, cancel, rework, review: what each
        │   │                                    costs, what each invalidates, what only a TTY may do
        │   └── choose_the_workflow_and_tier.md  the six recipes, ceilings, and what T2 buys
        └── references/
            ├── lifecycle.md              pointer-only: the 24/76 (post-commit-2: 25/75) contract
            │                             lives in core/src/state/, never restated here
            ├── evidence_map.md           where every artefact lives: journal.jsonl, status.json,
            │                             envelopes/, raw/, private/ (never opened), SQLite
            └── gotchas.md                the measured-trap table, symptom → cause → guard
```

`/herdr` may be added later, close to verbatim from the reference, with §6's privacy rules written
into it as hard rules.

### V.7 Hard rules for any AWSF skill

1. **No skill is ever in the execution path.** No gate, transition, guard, reservation, or
   accounting decision may depend on a skill being read or followed. If a skill were needed for
   correctness, that is a defect in the CLI and is fixed there — see §V.9.1, where applying this
   rule honestly disqualified four of §V.6's own proposed cookbooks. **[R2]** The rule stands; its
   *justification* changed. It is not true because `core/src` never greps `.claude` (§V.2); it is
   made true by placement (§V.6.0) and held true by a behavioural fence (§V.8).
2. **No live task state, ever** (`AGENTS.md` invariant 1). A skill never records which task,
   attempt or session is running, and never prints an unrequested status board.
3. **Reference, never restate.** No schema, edge id, ceiling, gate id, blocker code or model id is
   copied into a skill. Point at the source file.
4. **Owner acts stay owner acts.** A skill may prepare and explain `journey`, `land`, `cancel`,
   `rework` and `review`; it may never perform them or recommend performing them without the
   evidence the lifecycle requires.
5. **Never open `private/`.** The continuity locator and the materialized system prompts live there;
   a skill has no reason to read them and must say so.
6. **No push, no deletion, no external mutation, no credential access.** Same standing constraints
   as IV.4.

### V.8 The mechanical guard that makes this safe

The one real risk is drift: a skill that confidently describes a command or a flag that no longer
exists. The reference has no guard against this. **AWSF can have one cheaply**, because
`core/test/unit/meta/doc-reconciliation.test.ts` already asserts that every `awsf …`, `npm run …`
and `just …` string documented in `README.md` and the plan's Validation section actually exists.

**Extend that meta-test to walk the skill tree** with the same three assertions. `walkFiles()`
accepts an extension list (`core/test/unit/meta/_walk.ts:10`), so `[".md"]` is a one-argument
change. It fails loudly the moment a skill and the CLI disagree, and it turns the skill layer from
prose into something the suite keeps honest. Note the regex constraint recorded in commit 3: CLI
commands are matched with `/(?:^|\s)awsf (db rebuild|[a-z]+)\b/`, so documented command names must
stay unhyphenated.

**[R2] It must not fire on illustrative prose.** The scanner treats *every* backticked string as a
claim that a command exists (`doc-reconciliation.test.ts:24-34`). That is right for a README and
wrong for a cookbook, which names commands constantly in explanatory sentences and sometimes names
things deliberately as counter-examples. Scanning inline backticks across ~1,000 lines of skill
prose would produce failures that teach authors to stop using backticks — the worst outcome, since
it degrades the documents to protect the test.

**Rule for the skill tree: scan fenced ```bash / ```sh / ```console blocks only, ignoring lines
beginning with `#`.** A fenced block is a thing a session copies and runs, so it is a claim; prose
is explanation. This keeps the fence's whole value — a recipe that names a command that does not
exist fails — at near-zero false-positive cost, and needs no new escape syntax. The residual gap
(prose naming a nonexistent command) is named and accepted.

**[R2] The second fence extends, but narrowed.** `core/test/unit/meta/no-handwritten-schema.test.ts`
is scoped to `PROMPTS_DIR = join(repoRoot(), "prompts")` (`:17`) and does two things: a pattern
sweep (`:41-59`) and a blanket ban on ```json fences (`:61-74`) on the stated grounds that *"a
```json fence in a prompt is a schema copy waiting to drift; use {output_schema}"*. That is exactly
principle 4 of §V.5, already mechanically enforced — but it does not reach the skill tree, so a
skill could copy an envelope schema and drift with nothing to catch it.

Extending it wholesale would misfire. `HANDWRITTEN_SCHEMA_PATTERNS` includes
`/"?(…|changedFiles|…|candidateSha|reviewedSha|…|outputTail|…)"?\s*:/` (`:29-33`), which matches
ordinary explanatory prose — a cookbook sentence containing "`changedFiles`: the host-observed
set" trips it. **Apply to the skill tree only the three patterns that are unambiguous
restatement**, plus the fence ban:

| Applied | Pattern | Why it cannot false-positive |
|---|---|---|
| ✓ | `awsf\.[a-z-]+-output/v1` (`:26`) | A schema id literal is never explanation |
| ✓ | `"\$schema"\s*:` / `"additionalProperties"\s*:` / `"\$id"\s*:` (`:23`) | JSON Schema keywords |
| ✓ | `\binterface\s+\w*(Output\|Envelope\|ArtifactClaim)\b` (`:34`) | A pasted TypeScript declaration |
| ✓ | the ```json fence ban (`:61-74`) | §V.7 rule 3 forbids a skill restating any schema, so it has no legitimate use for one |
| ✗ | the bare field-name pattern (`:29-33`) | Matches prose |
| ✗ | `"type"\s*:\s*"object"` (`:25`) | Matches an ordinary config example |

**[R2] Two invariant fences do not currently reach a committed skill tree, and must.** Both are
scope bugs against `AGENTS.md` as written, independent of whether the skill is ever built:

- `core/test/unit/meta/no-credentials-in-fixtures.test.ts:30` walks only
  `core/test/fixtures` plus the root manifests, while invariant 9 says credentials belong nowhere.
  A cookbook is exactly the kind of document that grows a pasted token in an example.
- `core/test/unit/meta/no-shell-true.test.ts:9-10` walks only `core/src` and `dashboard/src`, while
  invariant 4 says `shell: true` appears nowhere. A cookbook that shows a shell-interpolated command
  is teaching the forbidden pattern.

Both extend to whatever path §V.6.0 settles on. This is the cheapest item in commit 7 and the one
with value even if commits 5–6 are never written.

**[R2] The "baseline to preserve" grep is withdrawn.** Revision 1 proposed asserting that
`core/src/**` never references `.claude` as *"the cheapest possible guard on the whole design."* Per
§V.2 it guards nothing: AWSF does not read skills, the provider CLI does, from its `cwd`. **The
behavioural fence that replaces it** has two assertions:

1. `pi-codex.ts`'s descriptor contains `--no-skills` — pin it in the existing adapter descriptor
   test, in exact argv order.
2. Either the Claude descriptor demonstrably disables project skill and command discovery **or**
   the repository root contains no `.claude/` directory. Under §V.6.0's option A the second
   disjunct is the one asserted, and it is a two-line `existsSync` test that cannot rot.

Assertion 2 is the actual guard, and it is honest about what it guarantees: it does not claim
isolation, it claims **absence**.

### V.9 Sequencing

**Commits 5–7, after commits 1–3, independent of the deferred commit 4.** They do not block the
pilot and must not delay it.

**[R2] Commit 7 moves first, and its table now matches §V.8.** Revision 1 put the fences last and
listed only doc-reconciliation, while §V.8 itself called two more required. Fences that arrive after
the documents they guard have nothing to catch; and two of the four are scope repairs worth landing
whether or not the skill is ever written.

| Commit | Content | Model | Effort |
|---|---|---|---|
| **5** *(was 7)* | **The fences, before any skill exists.** (a) extend `no-credentials-in-fixtures.test.ts` and `no-shell-true.test.ts` to the driving-document tree — repairs two `AGENTS.md` scope gaps that exist today; (b) the execution-isolation assertion of §V.8 — pin `--no-skills` in the pi descriptor test and assert the repository root has no `.claude/`; (c) extend `doc-reconciliation.test.ts` to the tree, fenced-blocks-only; (d) extend `no-handwritten-schema.test.ts` with the narrowed pattern set | `claude:opus-5` | medium |
| **6** *(was 5)* | `docs/driving/commands/prime-awsf.md` + `SKILL.md` + `cookbooks/preflight_a_task.md` — the two disclosed pilot false starts, prevented | `claude:opus-5` | medium |
| **7** *(was 6)* | The remaining cookbooks and references, including `read_a_blocked_attempt.md` and `gotchas.md` | `claude:opus-5` | high |

Commit 6 is worth doing before the next pilot leg regardless of when 7 lands: it is ~150 lines of
markdown, costs no provider call, and addresses two failures already on the record. Commit 5 is
worth doing regardless of whether 6 and 7 are ever written.

**Meta-test survey, verified file by file [R2].** `.claude/` does not currently exist in this
repository and is not gitignored (`git check-ignore` returns nothing). Against a tree of `.md`
files, of the seventeen tests in `core/test/unit/meta/`:

| Blind to a markdown tree (no change needed) | Scope | Why blind |
|---|---|---|
| `no-destructive-paths`, `child-process-fence`, `sqlite-write-fence` | `core/src` | `.ts` only |
| `state-purity-fence` | `core/src/state` | `.ts` only |
| `adapter-fence` | `core/src/adapters` | `.ts` only |
| `no-land-route` | `core/src/api` | `.ts` only |
| `loc-budget` | `core/src`, `dashboard/src` | advisory, and out of scope |
| `ticket-plan-sync` | `specs/` | fixed files |
| `dependency-allowlist` | three `package.json` files | fixed files |
| `redaction-boundary`, `no-agent-coauthor`, `no-write-route` | fixed sources | fixed files |
| `junk-drawer` | `git ls-files` basenames | rejects `*receipt*`, `*manifest*`, `.log`, `.pid`, database extensions — none of which a skill file uses. **Caution:** a cookbook named `read_a_manifest.md` would trip it |

The remaining four are the ones commit 5 extends: `no-credentials-in-fixtures`, `no-shell-true`,
`doc-reconciliation`, `no-handwritten-schema`.

### V.9.1 Four of the proposed cookbooks are CLI defects wearing a costume **[R2]**

The verifier's sharpest Part V finding, and it is right. §V.7 rule 1 says *"if a skill were needed
for correctness, that is a defect in the CLI and is fixed there."* Applying that rule honestly to
§V.6's own list disqualifies four items:

| Proposed as a cookbook | What it actually is | Fix |
|---|---|---|
| `preflight_a_task.md` — "check the prompt files exist before starting" | The disclosed pilot-2 false start: a run *"first invoked before its state-root prompt files existed"* and refused from `PREPARED` at zero calls. A command that can detect this at zero cost should | `awsf new` / `awsf start` validates the configured prompt paths, using the existing `readCommittedPrompt` escape checks (`production-run.ts:241-256`) |
| `preflight_a_task.md` — "check you are in the right repository" | The other disclosed false start: a task *"mistakenly created from the AWSF working directory"*, now permanently retained. Prose cannot prevent a wrong `cwd` | `awsf new` displays the resolved canonical repository and its HEAD, and requires confirmation at a TTY |
| `read_a_blocked_attempt.md` — "read the evidence before you retry" | Good discipline, but the reason it is needed is that reading the evidence is *work*. `awsf status` prints one budget line (`status.ts:40`) | `awsf status --evidence` prints the blocker, the failing gate rows, the last envelope and the retained process record. The cookbook then teaches judgment, not archaeology |
| `owner_acts.md` — "what each act costs and invalidates" | A table of ceilings, tranches and invalidation rules restated in markdown is precisely what §V.5 principle 4 forbids, and it drifts the moment L25 lands | Each command displays its own cost and invalidation at its confirmation prompt. `awsf review`'s prompt already must (§III commit 3); the others should match |

The cookbooks survive as **judgment layers over commands that already tell the truth** — which is
what "thin skill, fat CLI" means. Where revision 1 had a cookbook substituting for a missing
display, the display is the fix. This does not enlarge commits 1–3; it is recorded as the honest
backlog those cookbooks would otherwise hide.

Similarly, `choose_the_workflow_and_tier.md` must not restate the six recipes, their ceilings or
their phase lists — `recipes.test.ts:22-28` pins them and `awsf doctor` can print them. The cookbook
explains *how to choose*; the CLI supplies *what exists*.

### V.10 What deliberately does not get ported

- **The sandbox tier in any form.** AWSF's isolation model is a managed worktree plus permission
  profiles plus a sandbox broker. There is no VM to mount, no key to mint, no teardown to decide,
  and no `harvest` — landing is a local fast-forward the owner authorizes at a TTY.
- **`references/handoff.md`.** Its AWSF equivalent is single-sourced in TypeBox under
  `core/src/contracts/`, which yields the validator, the static type and the injected JSON Schema
  from one definition. The plan calls a handwritten envelope example beside the schema and the gate
  *"SSSF's worst maintenance defect"*. Copying a handoff reference into a skill would recreate it.
- **A skill-owned visualizer.** AWSF already ships `dashboard/` and `awsf dash`.
- **Composite skills.** IndyDevDan takes the exception knowingly — *"I don't like to compose my
  skills… you create these nasty dependency graphs. But when things are unified in a single monorepo,
  you can make an exception"* (ll. 240–242). AWSF needs one skill, so the exception never arises.

**[R2] All four exclusions re-checked and confirmed correct.** No sandbox tier exists to drive; the
handoff reference would recreate the three-copy drift the plan calls *"SSSF's worst maintenance
defect"* and which `no-handwritten-schema.test.ts` exists to prevent; `dashboard/` and `awsf dash`
already ship; and a single skill cannot compose with itself. Nothing on this list should be ported.

---

## Part VI — Adjudication ledger **[R2]**

How every verifier finding was resolved, against code. **Accepted** = the design changed as asked.
**Narrowed** = the finding is real but the remedy differs, and why. **Refuted** = the finding does
not hold.

### VI.1 Claim table

| Finding | Resolution | Evidence |
|---|---|---|
| **A1** PARTIAL — L4 alone does not forbid a review-only recipe | **Accepted.** §3.3 restated: L4 forbids a *provider-free RUNNING sojourn*; the runner's unconditional deferral of review phases to L11 is the other half | `task-machine.ts:95`, `:323-326`; `production-run.ts:1352-1355` |
| **A2** CONFIRMED — 25/75, single-cell change | Unchanged | `_lifecycle-tables.ts:161`; `transitions.test.ts:44-48` |
| **A3** CONFIRMED, with "the proposed fix is underspecified" | **Accepted, and the revision-1 fix withdrawn as wrong.** `beginPhase()`'s per-phase reset is the stated contract; the defect is that one counter pair carries two allowances. Commit 2 splits them | `call-budget.ts:445-454` (the contract, verbatim), `:411-413`, `:428-435`; `retry.ts:56-57` |
| **A4** CONFIRMED, caveat on "repository view" | **Accepted** — see C6 | `permission-profiles.ts:10-14`, `:64` |
| **A5** CONFIRMED — `awsf review` is safe | Unchanged | `doc-reconciliation.test.ts:35`; `main.ts:28-32` |
| **Part B** PARTIAL — a join retains more than two things | **Accepted.** §2.3 now enumerates seven retained items and separates host-tier from per-agent continuity in §1. The conclusion — no phase status causes a skip — is retained and re-verified | `runner.py:52-58`, `:72-111`, `:131`; `agents.py:233-237` |
| **E1** PARTIAL — source grep is not an execution fence | **Accepted in full; §V.2 rewritten.** Additionally found: the reference *does* run a skill in an execution path | `pi-codex.ts:619-624`; `claude-code.ts:437-457`; `just/sandbox/orch/mod.just:29,33` |
| **E2** PARTIAL — credential and shell fences do not reach a skill tree | **Accepted.** Both extended in commit 5. The other thirteen meta-tests surveyed file by file in §V.9 | `no-credentials-in-fixtures.test.ts:30`; `no-shell-true.test.ts:9-10` |
| **E3** PARTIAL — the schema fence is too broad; doc scan cannot tell illustration from invocation | **Accepted, narrowed.** Three patterns plus the fence ban apply; the field-name pattern does not. Doc reconciliation scans fenced `bash` blocks only | `no-handwritten-schema.test.ts:23-34`, `:61-74`; `_walk.ts:10` |
| **E4** PARTIAL — policy-only mitigation; `db rebuild` is not read-only | **Accepted.** §V.5 principle 6 corrected to "non-destructive and idempotent" | `rebuild.ts:212-223` |
| **E5** PARTIAL — line counts low; "no skill in any execution path" overbroad | **Accepted.** Counts measured and corrected; the claim narrowed to ADW phases | measured 1,447 / 2,416 / 950 / 798 |
| **E6** PARTIAL — cookbooks hiding CLI defects; fixed defects as live gotchas | **Accepted.** New §V.9.1 names four; §V.4.2 requires a separated `Historical` section | §V.9.1 |

### VI.2 Attacks

| Attack | Resolution |
|---|---|
| **C1** clean HEAD movement is invisible | **Accepted, confirmed in code.** `captureChangeSet` is `git diff HEAD` (`git/changes.ts:36-44`) and `assertClean` is `status --porcelain` (`:105-108`) — both blind to a clean checkout. §5.3.2 adds three-point physical revalidation and records the immutable-materialization alternative as commit-4 territory |
| **C2** verdict shopping | **Accepted; the strongest single change in R2.** §5.3.1 makes eligibility a two-member host-determined enum. A fully evidenced review is not replaceable at all |
| **C3** REVIEWING dead ends | **Accepted, and found to be worse than reported.** The dead end predates L25: a malformed envelope today fails L15, cannot satisfy L16 (`guards.ts:222-228` needs a medium+ finding), cannot satisfy L17 (`guards.ts:240-245` needs a transport retry), leaving only cancel. §5.5 widens L17 to two additional host-deterministic codes, repairing the existing hole |
| **C4** empty diff passes the gate | **Accepted.** §III commit 1 replaces the two-field check with a pre-GO fitness precondition plus a post-phase prompt-digest gate. The `command-evidence.ts` citation was wrong and is corrected — it is head/first-**failure**/tail (`:17-19`, `:79-87`) |
| **C5** lost evidence | **Accepted.** The context now nests the whole `TestOutput` and carries request, goals, non-goals, acceptance criteria and test strategy. Also newly established: the compiler offers exactly one envelope slot (`compiler.ts:70-88`), so a composite envelope is the only available shape |
| **C6** `readonly` is not read-confined | **Accepted; D2 unchanged.** §D2.1 states the exposure precisely, adds a state-root `--tmpfs` mask to the bwrap namespace, and records the residual as an accepted confidentiality risk | 
| **C7** breakages, persistence collisions, recovery, economics | **Accepted with one refutation.** Every exact-count fixture enumerated in §III commit 2. Persistence collisions confirmed at six identities (`production-run.ts:779`, `:973`, `:982-984`, `:1011`, `:1330`) and fixed by generation-qualified `reviewer-re<N>`, following `rework.ts:547`. Recovery: `rework.ts:910-975` is the required model. Economics: `simple-sdlc` spends 4 of 5 (`recipes.test.ts:27`), so §5.4 requires two calls of headroom. **Refuted:** "extend `ProcessRegistration`'s edge union" is unnecessary — `SPAWN_SITE_EDGES` is derived from the L-table (`transport-broker.ts:75`); only comments and tests restate "five" |

### VI.3 Sections amended

Part I §D2 (new §D2.1) · Part II §1 · §2.3 · §3.3 · §5.3 (new §5.3.1, §5.3.2) · §5.4 · new §5.5 ·
§7 · Part III commits 1, 2 and 3 · Part IV §IV.3 · Part V §V.1, §V.2, §V.4.2, §V.5.6, §V.6 (new
§V.6.0), §V.7, §V.8, §V.9, new §V.9.1, §V.10. The appended verification report is untouched.

### VI.4 Final sequence and dependencies for commits 1–3

```
commit 1  review evidence + readonly reviewer + state-root mask
          ├─ independent: lands alone, repairs the shipped defect, no lifecycle change
          └─ REQUIRED BY commit 3 (L25 eligibility reads review_evidence_present rows)

commit 2  correction-counter split + L25 + L17 widening + 25/75
          ├─ counter split is independent of L25 and could be its own commit
          ├─ L17 widening repairs a pre-existing dead end and is independently valuable
          └─ REQUIRED BY commit 3 (the edge, and the counter it charges)

commit 3  awsf review
          └─ depends on 1 and 2
```

Order is forced: 1 → 2 → 3, one session each, no merging. Commit 1 is the only one that improves
the current pilot's position without any lifecycle change, so it is also the one to land first if
the sequence is interrupted.

### VI.5 Verdict and placement for commits 5–7

**Proceed, renumbered and relocated.** The verifier's "do not proceed as written" is accepted in
full: the placement was unsafe and the safety argument was invalid. With §V.6.0 (option A —
`docs/driving/`, installed by the owner, no repository `.claude/`) and §V.8's behavioural fence, the
objection is answered by construction rather than by an unverified flag. Fences move to commit 5 and
land first. The content is unchanged in value and, per §V.9.1, four of its cookbooks are recorded as
CLI work rather than written as prose.

### VI.6 The one genuinely unavoidable owner decision — **settled, D5**

**Resolved 2026-08-14: the owner accepted option (a).** D3 is unchanged, the residual is accepted,
and the confirmation prompt must disclose it in plain words. The reasoning is retained below because
the *next* session to touch L25 needs to know this was chosen rather than overlooked.

Everything else in this revision was settled against code. This one was not, because both answers
are defensible and the choice is economic:

> **After L25 spends the owner re-entry allowance, a replacement review that fails post-GO leaves
> the attempt BLOCKED, and `awsf retry` rebuilds the candidate. The green candidate is lost.**

D3 forbids giving L25 its own allowance, and BLOCKED is terminal (`task-machine.ts:55`), so within
the settled decisions there is no path that both bounds shopping and preserves the candidate through
a failed replacement. The options:

| | Effect |
|---|---|
| **(a) Accept it** — **CHOSEN** | Every deterministic failure is moved before GO (§III commit 1, §5.3.2, §5.4), so post-GO only transport and invalid JSON remain — and transport already has its retry. The residual is small, named, and displayed at the confirmation prompt |
| **(b) Revisit D3** | Give L25 its own allowance so L16 survives a failed replacement. Bounds shopping less tightly, and reopens a settled decision for a case §5.3.1 has already made rare |

**Chosen: (a).** §5.3.1's eligibility narrowing does most of the work D3 was carrying, so the
coupling is now belt-and-braces rather than the primary bound — and the confirmation prompt tells
the owner exactly what they are risking before they spend the call.

**Binding consequence for commit 3.** The confirmation prompt is not advisory copy; it is the last
place a human sees the risk before a call is spent. It must display, at minimum: the candidate SHA,
the superseded verdict, the evidence defect that makes it replaceable, `callsSpent / ceiling`, that
the attempt leaves `AWAITING_OWNER` for `REVIEWING`, that L16 and L19 are gone once the allowance is
spent, and the sentence *"if this review fails, the candidate is lost."* A test asserts the prompt
contains each of them.

---

## Appended — adversarial verification report, verbatim

**Audit record. Do not edit.** Produced by an independent verification session against revision 1 of
this document, on `codex:gpt-5.6-sol` at high reasoning, report-only. It is reproduced here exactly
as returned, including the findings this revision narrowed or refuted, so the adjudication in
Part VI can be checked against what was actually said. Where Part VI and this report disagree,
Part VI is the current design and this report is the record of how it got there.

# 1. VERDICT

## Commits 1–3: **proceed with the amendments listed**

The direction is sound, but the current design is not implementation-ready:

- `review_evidence_present` does not actually prove that a usable diff reached the prompt.
- The proposed review context loses the original request and bounded test output.
- L25 permits replacing a fully evidenced adverse review.
- Replacement-review persistence identifiers would collide with the original review.
- Several failures leave the attempt in `REVIEWING` with cancellation as its only legal exit.
- The owner-tranche fix conflicts with the existing per-phase correction semantics unless the counters are separated.
- `readonly` exposes a much larger filesystem-read surface than the document states.

## Commits 5–7: **do not proceed as written**

Putting the skill under repository `.claude/skills/` breaks Part V’s central execution-path-isolation claim. Pi is launched with `--no-skills`; Claude Code is not. Claude phases run with the managed worktree as `cwd`, so project skills can be discovered implicitly even though `core/src/**` never references `.claude`.

Relocate the skill outside the repository, or first add and verify a Claude adapter mechanism that disables project skill/command discovery.

---

# 2. CLAIM TABLE

| Claim | Result | Evidence |
|---|---|---|
| **A1** | **PARTIAL** | `core/src/state/task-machine.ts:95`: `L4 ... to: "RUNNING" ... spawnSite: true`. At `:323-325`: `const declaresSpawn = ...; if (declaresSpawn !== edge.spawnSite) throw new IllegalSpawnSite(...)`. `production-run.ts:657-664` unconditionally authorizes L4 with `spawn: { cost: 1 }` and holds `firstReservation`. This forbids a RUNNING sojourn with no launch. But the task machine does not know that an agent is a reviewer: a reviewer could theoretically be the L4-spawned agent. The intended review-only recipe is unavailable only in combination with `production-run.ts:1350-1355`, which defers every review to L11. L4 alone does not prove the broader claim. |
| **A2** | **CONFIRMED** | `_lifecycle-tables.ts:168-171` currently places `["AWAITING_OWNER", "REVIEWING"]` in `ILLEGAL_TRANSITION_PAIRS`. It is neither terminal-source, self-transition, nor a `→ LANDED` pair. Removing that single cell changes only `IllegalTransition`: `27 + 10 + 6 + 32 = 75`; legal pairs become 25. `TERMINAL_ATTEMPT_PAIRS`, `ALREADY_IN_STATE_PAIRS`, and `HUMAN_GATE_BYPASS_PAIRS` are structurally unaffected. |
| **A3** | **CONFIRMED** | `call-budget.ts:451-454`: `beginPhase(): void { this.#correctionsAuto = 0; this.#correctionsOwner = 0; }`. `engine.ts:251`: `options.budget.beginPhase();`. `call-budget.ts:411-413` charges the transition tranche before the phase starts. `production-run.ts` authorizes only L4 and L11; it takes no L10/L16/L19 correction edge. Thus an L25 owner charge followed by `runAgentPhase()` would be erased. Fix ordering is necessary before commit 3, although the proposed fix is underspecified because `beginPhase()` is normatively per-phase. |
| **A4** | **CONFIRMED** | `permission-profiles.ts:10-14`: `readonly: new Set(["read", "grep", "find", "ls"])`; only `managed-worker` contains `exec`/`bash`. At `:64`, `repositoryReadOnly: writes.length === 0`. `production-run.ts:361-371` adds both `verdict_consistent` and `writes_within_globs` for review phases. The host diff is therefore complementary. Caveat: “repository view” is too narrow—see C6. |
| **A5** | **CONFIRMED** | `doc-reconciliation.test.ts:35`: `/(?:^|\s)awsf (db rebuild|[a-z]+)\b/g`. `awsf re-review` is parsed as `re`; `awsf review` is parsed as `review`. `main.ts:29-32` contains no existing `review` command, so the name is collision-free. |
| **Part B** | **PARTIAL** | Zero durable phase skipping is confirmed. `runner.py:52`: `self._seq = tracer.max_phase_seq(adw_id)`. `runner.py:73-111` always creates and executes a new phase; no old status is consulted. `runner.py:131`: `all(p.status == "success" for p in self.phases)` reads only the new in-process list. Every `adw_*.py` opens its phases unconditionally. Provider reuse is confirmed by `agents.py:233-237`: lookup by agent name in the adw-scoped map and reuse only when `entry.get("model") == agent.model`. However, “only” sequence plus provider session is false: `runner.py:54-58` reuses the same session directory, `context_handoff`, and `agent_map.json`; the reference’s `run_adw.md` explicitly says “same `sessions/{adw_id}/` dirs, same `context_handoff/`, envelopes appended.” The SQLite session row and repository state are also retained. None permits a successful phase to be skipped. |
| **E1** | **PARTIAL** | Baseline confirmed: `core/src/**` and `dashboard/**` currently contain zero `.claude` references. But source grep is not an execution-path fence. `pi-codex.ts:615-624` explicitly includes `--no-skills`; `claude-code.ts:438-456` has no corresponding suppression and launches with `cwd: request.cwd`. Once `.claude/skills` is present in the managed worktree, Claude Code can discover it implicitly. Part V’s central safety claim is therefore false for AWSF. |
| **E2** | **PARTIAL** | The proposed Markdown filenames would not currently trip most meta-tests. `_walk.ts:10` defaults to `.ts/.tsx/.vue`; junk-drawer checks tracked basenames only; LOC is limited to `core/src` and `dashboard/src`; ticket/plan and dependency tests use fixed files. But important fences are blind: `no-credentials-in-fixtures.test.ts` scans only fixtures and root manifests, while invariant 9 says “anywhere else”; `no-shell-true.test.ts` scans only `core/src` and `dashboard/src`, while invariant 4 says “anywhere.” Safety cannot be claimed from the existing suite alone. |
| **E3** | **PARTIAL** | `walkFiles()` accepts `[".md"]`, so both extensions are mechanically easy. The doc scanner, however, treats every command-looking inline/fenced string as executable documentation; it cannot distinguish “never run `awsf nonexistent`” from an invocation. A valid illustration such as `awsf land <task>` is not a false positive because `land` exists. The proposed schema extension is too broad: `no-handwritten-schema.test.ts:61-74` rejects every ````json` fence, including harmless config or command-output examples, and patterns such as `changedFiles:` can match explanatory prose. It also does not specifically prove that an envelope schema was copied. |
| **E4** | **PARTIAL** | The proposed static files do not themselves encode live task state or use receipt/manifest filenames. “Report the handle every time” can remain chat output rather than a committed write. But the mitigation is policy-only, not mechanical, and `/prime-awsf` is described as reading live status. More importantly, implicit Claude skill discovery violates the execution-layer boundary and can expose these owner-driving rules to worker phases. `db rebuild` is also incorrectly classified as read-only; it rewrites the projection. |
| **E5** | **PARTIAL** | Four skill roots and two commands are confirmed. `prime.md` is 29 lines and `install.md` 94. The quoted thin-skill, prompt-discipline, failed-gate, stuck-run, idle-state, and teardown passages are accurate in context. No `adws/*.py` file directly reads `.claude`, and the ADW Pi launcher does not opt into Claude skills. The line estimates are materially low: non-template Markdown is approximately 1,447 lines for `sssf`, 2,416 for the sandbox orchestrator, 950 for Herdr, and 720 for sandbox-exe-dev. Also, the reference explicitly uses skills in the outer orchestration launch path; “no skill in any execution path” is true only for ADW phases, not the whole repository. |
| **E6** | **PARTIAL** | No sandbox tier, no copied handwritten handoff schema, no second visualizer, and no composite AWSF skill are correctly excluded. CLI defects are nevertheless disguised as cookbooks: missing prompt-file validation before PREPARED; inadequate blocked-attempt/process inspection; owner-act cost/invalidation information not being displayed by commands; and wrong-repository creation lacking an explicit repository confirmation. Fixed defects such as unevidenced review and tranche erasure must not be born as current “gotchas” after commits 1–3 repair them. |

---

# 3. ATTACKS

## C1 — stale gates or changed tree

**Counterexample exists.**

1. L25 preflight observes clean candidate `C` and `gatesPass: true`.
2. After that observation, another process cleanly checks out `C2`.
3. `PermissionSession` sees a clean tree before and after. `captureChangeSet()` compares only uncommitted changes, so clean HEAD movement is invisible.
4. The reviewer reads `C2` but emits the expected `reviewedSha: C`.
5. L15 compares the claim, not the physical tree.

`candidateUnchanged: true` is only supplied evidence to the pure guard. Require exact gate rows bound to `C`, revalidation immediately before GO, and HEAD/clean revalidation after review before L15. Prefer reviewing an immutable materialization rather than a mutable worktree.

## C2 — verdict shopping

**Counterexample exists.**

A fully evidenced first review returns `concern`. The owner supplies any nonblank reason, sets `reviewInvalidated: true`, buys one cold replacement, and lands if it returns `accept`. Nothing in L25 requires the old review’s evidence to have been absent or invalid.

The one-owner-tranche bound limits frequency, not the existence of shopping. Add deterministic evidence that the superseded review failed or predated `review_evidence_present`; do not authorize L25 merely because the owner dislikes its conclusion. Preserve and display both verdicts at journey/landing.

## C3 — exits from REVIEWING

After L25 spends the owner tranche:

- **L15** works only after a valid, consistent review.
- **L16** is refused because the owner tranche is spent.
- **L17** works only for mandatory-review transport unavailability after one retry.
- **L18** cancellation remains legal.

Concrete dead-end: the replacement emits malformed JSON. With reviewer `continuity: none`, no corrective second turn is authorized; current production handling rethrows any non-`MandatoryReviewUnavailable` failure while leaving the durable state `REVIEWING`. L15 has no valid review, L16 is exhausted, and L17’s guard is unsatisfied. Cancellation is the only exit.

The document’s named `concern` risk is therefore incomplete. Schema failure, evidence-gate failure, permission breach, route mismatch after L25, persistence collision, and retry-ceiling failure also need explicit outcomes.

## C4 — empty or truncated diff

**Counterexample exists.**

The proposed gate checks only:

- context `candidateSha` equals candidate;
- `changedFiles` equals the host set.

A context with the correct six filenames and `diff: ""` passes. So does one whose bounded diff omits every deletion or substantive hunk. The statement that this makes unevidenced review “structurally impossible” is false.

Also, `command-evidence.ts` implements head/first-**failure**/tail, not head/first-**hunk**/tail.

## C5 — lost evidence

**Counterexample exists.**

The current `TestOutput` contains:

```ts
passed, candidateSha, commands[{ gateId, argv, exitCode, durationMs, outputRef }],
failures, outputTail
```

The proposed context’s gate summary omits `passed`, `durationMs`, `failures`, and inline `outputTail`. Its relative `outputRef` names the attempt directory, while the provider’s `cwd` is the worktree, so it is not inherently usable.

More seriously, the proposed review context contains no original request, plan goals, acceptance criteria, or build envelope. The reviewer can inspect code quality but cannot judge whether the candidate is what the owner asked for.

## C6 — readonly consequences

The sandbox grant’s write surface is unchanged because `writes: []` controls it:

```ts
const worktreeBind = request.writes.length === 0 ? "--ro-bind" : "--bind";
```

The permission session and adapter argv do change, while `writes_within_globs` remains.

The unmentioned consequence is confidentiality: `readonly` is not repository-read-scoped. On bwrap, `sandbox-broker.ts:79-88` performs `--ro-bind / /`, making the host filesystem read-only but broadly readable. Without bwrap, only adapter tool policy exists. A model-controlled Read tool can attempt absolute reads outside the worktree, including other state-root material, home-directory files, and attempt-private files. D2 may remain settled, but the document must not call this merely a “read-only repository view” without read confinement or an explicit accepted-risk statement.

## C7 — breakages and omissions

Concrete existing failures likely include:

- `transitions.test.ts`: exact 24/76 and 33-member assertions.
- `spawn-sites.test.ts:108-111`: exact five-site list.
- `ceilings.test.ts:297`: exact spawn-site list.
- `_lifecycle-harness.ts`, actors, rejection-order, evidence, and ceiling fixtures need L25.
- `workflow/recipes.test.ts:26-27`: exact phase arrays.
- `gates/interface.ts:4-16`: closed `GateId` vocabulary.
- Contract registry/schema tests and journey fixtures with exact phase/gate sequences.
- Adapter/config tests currently asserting the reviewer’s `no-tools` descriptor.
- Transport-broker comments and tests saying “five” sites.

Commit 3 has a more severe persistence collision. A fresh run id does not make these unique:

- `envelopes/reviewer-0.json`;
- phase id derived from `sessionId:reviewer`;
- gate ids derived from that phase id and round;
- runtime directory `private/reviewer`.

The original review already owns those identifiers. A replacement needs a generation-qualified evidence phase, envelope, gate, raw-output, runtime, and compiled-prompt identity.

The claimed crash recovery is also unsupported. Generic replay reconstructs files; it does not reconcile a held provider reservation. Existing robust recovery is command-specific, notably in `rework.ts`. Commit 3 needs an explicit rerunnable recovery path.

Finally, a replacement after a four-call `simple-sdlc` consumes call five and has no ceiling headroom for the promised transport retry. A second reservation then raises `CallCeilingExceeded`, not `MandatoryReviewUnavailable`, leaving the task in `REVIEWING`.

---

# 4. AMENDMENTS REQUIRED

## Part I §D2

Replace “read-only repository view” with an exact statement:

- write confinement remains repository read-only;
- read tools are not path-confined by `PermissionSession`;
- bwrap currently exposes `/` read-only;
- no-bwrap Linux relies on tool policy;
- either add read-root confinement or record this confidentiality exposure as accepted.

## Part II §§1 and 2.3

1. Distinguish the two continuities:
   - one interactive host-tier orchestrator session per sandbox;
   - separate ADW agent sessions reused by `(adw_id, agent name, model)`.
2. Replace “only” reuse with the full list: phase sequence, session row/aggregates, session directory, context handoff, appended envelopes/raw records, agent map, provider conversations, and repository state.
3. Retain the verified conclusion: no prior phase status causes a skip.

## Part II §3.3 / A1 rationale

Change “L4 makes a review-only recipe impossible” to:

> L4 forbids a provider-free RUNNING sojourn. Combined with production-run’s mandatory deferral of reviewer phases to L11, the current runner cannot express an adopted-candidate review-only workflow.

## Part II §§5.3–5.4

1. Add deterministic old-review evidence invalidity to L25; a human string alone is insufficient.
2. Require exact successful gate evidence bound to the candidate and current config, not only `gatesPass`.
3. Specify post-review physical revalidation.
4. Resolve correction-counter scope explicitly. Do not simply stop `beginPhase()` from resetting `correctionsOwner`; that breaks the existing per-phase contract. Separate task-edge owner re-entry accounting from intra-phase correction accounting, and amend the plan/schema/dashboard/tests accordingly.
5. State that a successful replacement costs one call but may require a second call for transport retry.

## Part II §7

Add outcomes for:

- malformed or schema-invalid review;
- `review_evidence_present` failure;
- permission breach;
- route/model drift after L25;
- no retry headroom;
- crash before registration, between registration and GO, and after GO;
- persistence/projection failure after the review answered.

Name a concrete recovery command/path. “Recovery reconciles from the journal” is not currently an implementation.

## Part III — Commit 1

Revise `ReviewContext` to include:

- original owner request and applicable plan/acceptance context;
- full `TestOutput` or equivalent bounded command evidence, not only `outputRef`;
- an exact host-derived diff digest and coherent stat/count fields;
- nonempty hunk/deletion evidence whenever changed files exist;
- an accessible full-diff reference with explicit path semantics.

Run evidence validation before spending the review call, then gate the exact serialized prompt or a digest of it. Do not claim the current two-field check proves prompt inclusion.

Add tests for empty diff, all-hunks-omitted diff, deletions, inaccessible `diffRef`, lost test tail, and missing request/acceptance context.

## Part III — Commit 2

Specify the counter model and update every exact-count/spawn-site test, not only `_lifecycle-tables.ts`. Add tests proving:

- L25 and L19 share the one task-level owner re-entry allowance;
- ordinary per-phase corrections still reset as the existing contract promises;
- registration failure and crash recovery have defined tranche semantics.

## Part III — Commit 3

Add:

- deterministic eligibility based on invalid old review evidence;
- generation-qualified persistence identities such as `reviewer-re1`;
- pre-GO and post-review candidate/base checks;
- exact gate-row revalidation;
- two-call headroom handling or an explicit no-retry outcome;
- command-specific crash recovery;
- handling for every non-transport review failure;
- landing/journey display of the superseded and replacement verdicts.

## Part V §§V.2, V.6–V.9

1. Do not place the skill under repository `.claude/` until Claude phase discovery is disabled and descriptor-tested. Prefer an owner-global/private skill location.
2. Replace source-reference grep with a behavioral fence:
   - Pi descriptor contains `--no-skills`;
   - Claude descriptor demonstrably disables project skills/commands, or repository `.claude` is forbidden.
3. Extend credential and forbidden-`shell: true` sweeps to the skill tree.
4. Make doc reconciliation context-aware or provide an explicit escaped “non-command illustration” form.
5. Narrow the handwritten-schema fence to envelope-shaped examples; do not ban every JSON fence.
6. Add the no-handwritten-schema and execution-isolation changes to commit 7’s actual table; it currently names only doc reconciliation.
7. Remove fixed defects from current gotchas or label them historical.
8. Do not restate ceilings, recipes, gate ids, or invalidation tables in `choose_the_workflow_and_tier.md` / `owner_acts.md`; have commands display them.
9. Correct the reference line counts and stop calling `db rebuild` read-only.

---

# 5. MISSED

- Project `.claude/skills` is implicitly load-bearing for Claude Code even with zero source references.
- The review context omits the owner’s request and acceptance criteria.
- The proposed gate cannot prove the context was serialized into the prompt.
- Replacement evidence identifiers collide with immutable first-review artifacts.
- Existing correction counters conflate task-edge and per-phase semantics.
- One replacement review can still shop a fully evidenced verdict.
- A four-call T2 workflow has no room for the promised replacement-review retry.
- Clean HEAD movement is invisible to `PermissionSession`’s change-set fingerprint.
- `readonly` permits broad filesystem reads, not merely repository reads.
- The full-diff bounding citation points to failure-window logic, not diff-hunk logic.
- The reference join reuses substantially more durable context than the two items claimed, though none is a skippable phase checkpoint.
- Existing credential and `shell: true` meta-tests do not enforce their AGENTS.md invariants over `.claude`.
- Part V’s commit-7 table omits two fences that §V.8 itself calls required.
