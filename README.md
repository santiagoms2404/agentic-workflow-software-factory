# AWSF — Agentic Workflow Software Factory

A single-operator software factory for AI coding agents. A host-owned state
machine governs a task's lifecycle, a typed phase engine governs the work inside
each executing state, and a human at a terminal is the only path to landed code.

**The problem it solves.** An agent that can edit files can also commit them,
push them, spawn more agents, and report a success it did not earn. Each of
those is a state change, and a model asked to check whether its own state change
is permitted is not a control. AWSF moves every one of them out of the model's
reach: **the model supplies structured facts, the host advances state, and a
human authorises anything that becomes permanent.**

> **Status: pre-alpha, single operator, actively built.** v1 is complete —
> M0–M11, 38 tasks, both adoption pilots landed on real work. **v2 is the
> current workstream**: seventeen workstreams on a spine plan, nine landed, each
> milestone carrying its own deep plan with its own tickets, amendments and
> validation. The factory has driven 44 real sessions on this repository and
> landed 8 of them. No native-Windows write parity is claimed. Every number on
> this page is reproduced by a command in
> [Verifying these claims](#verifying-these-claims).

## Run it without an API key

The orchestrator runs against captured provider fixtures, so the whole lifecycle
is exercisable with no account, no key and no quota spent:

```bash
npm install
npm test                                    # 2,167 tests, four layers
npm run awsf -- new T01-fixture "describe the task" --workflow simple-sdlc --tier 1
npm run awsf -- start T01-fixture --stub true
npm run awsf -- run T01-fixture --stub true
npm run awsf -- status T01-fixture
```

That drives the full `simple-sdlc` recipe — plan → build → tests → document →
final tests → review — through the real state machine, the real gates, the real
append-only journal and the real SQLite projection. Only the provider process is
a fixture.

## Verified numbers

| What | Value | Where it lives |
|---|---|---|
| Task lifecycle | 11 states, 27 legal edges, 94 rejected ordered pairs of the 121-pair matrix | [`core/src/state/task-machine.ts`](core/src/state/task-machine.ts) |
| Phase submachine | 8 states, with a same-session correction loop | [`core/src/state/phase-machine.ts`](core/src/state/phase-machine.ts) |
| Postcondition gates | 20 | [`core/src/gates/interface.ts`](core/src/gates/interface.ts) |
| Tests | 2,167 across 4 layers — unit 1,815 · contract 95 · simulation 84 · journeys 173 | `core/test/` |
| Architecture fences | 33 meta-tests that fail the build when a boundary is crossed | [`core/test/unit/meta/`](core/test/unit/meta) |
| Owner CLI | 27 commands | `CLI_COMMANDS` in [`core/src/cli/main.ts`](core/src/cli/main.ts) |
| Workflows | 8 recipes | [`core/src/workflow/recipes/`](core/src/workflow/recipes) |
| Provider adapters | 3 real + 1 fixture stub | [`core/src/adapters/catalog.ts`](core/src/adapters/catalog.ts) |
| Process supervision | 1 port, 3 OS implementations, 1 shared contract suite | [`core/src/execution/platform/`](core/src/execution/platform) |
| HTTP API | 8 reads + 1 archive write | [`core/src/api/routes.ts`](core/src/api/routes.ts) |
| Plans | 16 plan documents carrying **189 dated amendment entries** | [`specs/`](specs) |
| Real runs on this repo | 44 sessions · 137 transitions · 228 phases · 508 gate results · 8.07M tokens · 84 provider calls | the journal and its projection |

## What this is

AWSF fuses two systems that each solved the problem the other ignored:

- **`my-agentic-workflow` (MAW)** owns the *task lifecycle* — guarded state
  transitions, a PID-before-spawn barrier that makes hidden processes
  structurally impossible, and a human-only landing edge. It has no idea what
  happens *inside* a running task.
- **`super-simple-software-factory` (SSSF)** owns the *work inside a single
  execution* — typed phases, runtime-validated envelopes, postcondition gates
  with same-session correction loops, and a live SQLite trace. It has no idea
  what a task *is*.

The fusion is one sentence: **the state machine governs the task; the phase
engine governs the sojourn inside the executing states.** A gate failure inside
a phase is corrected cheaply — re-prompt the same provider session, context
intact, nothing charged against the task's call budget. Only when a phase's own
correction budget is exhausted does the failure escalate to a *state
transition*, which is expensive, reserved in advance, and rationed by a risk
tier ceiling.

```mermaid
flowchart LR
  subgraph SM["STATE MACHINE — governs the task · 11 states · 27 edges · 94 ordered rejections"]
    PREP["PREPARED"] --> RUN
    subgraph RUN["RUNNING — the phase engine governs the sojourn"]
      direction LR
      p1["plan"] --> p2["build"] --> p3["test"] --> p4["document"]
      p3 -. "gate fails → correct in the<br/>SAME session · no tier call" .-> p2
    end
    RUN --> G["GATING"]
    G --> OWN["→ owner → land → publish"]
    G -. "budget exhausted → state transition:<br/>counted · rationed · evidence-gated" .-> RUN
  end
  style RUN stroke:#22D3EE
  style SM stroke:#A78BFA
```

### Six pillars

1. **Host owns the loop.** No model selects phases, changes risk tier, advances
   lifecycle state, lands code, or repairs orchestration state.
2. **Journal is truth; SQLite is a rebuildable projection.** Delete the database
   and `awsf db rebuild` reconstructs it byte-identically.
3. **No process before registration.** The launcher blocks until the journal,
   status store and projection all acknowledge a spawned process's identity.
4. **Typed envelopes and earned success.** Every phase is constructed
   `FAILED`-equivalent; every agent output is schema-validated at runtime; a
   green gate records *what it verified*, not merely that it passed.
5. **Host owns Git; humans own landing.** Agents edit, never commit, merge or
   push. Landing is a local fast-forward only, from an interactive TTY, through
   a persisted `LANDING` state. **Exactly one push path exists in the whole
   codebase** — `awsf publish`, a separate human act on an already-landed
   revision, authorised by the ordered truth table in
   [`core/src/publish/authorize.ts`](core/src/publish/authorize.ts) and spelled
   as argv in [`core/src/publish/argv.ts`](core/src/publish/argv.ts) and nowhere
   else. No pre-`LANDED` push, no force-push and no remote-branch deletion path
   exists anywhere, and the `publish-fence` and `no-destructive-paths`
   meta-tests are what keep that true.
6. **Portability is a contract, not a hope.** One `ProcessSupervisor` port,
   three platform implementations, one shared contract suite — a port that
   cannot enumerate survivors errors, it never silently returns `[]`.

## The lifecycle

Eleven states, twenty-seven legal edges, ninety-four rejected pairs evaluated
against an eleven-step ordered rejection contract. The rejection *order* is part
of the contract: a refusal must name the real defect, or fixing what it named
would let an illegitimate transition through.

```mermaid
stateDiagram-v2
  direction LR
  [*] --> DRAFT : awsf new
  DRAFT --> PREPARED : L1 · host
  PREPARED --> RUNNING : L4 ✦ · call reserved
  RUNNING --> GATING : L7 · host commit exists
  RUNNING --> AWAITING_OWNER : L26 · host
  GATING --> RUNNING : L10 ✦ · correction
  GATING --> REVIEWING : L11 ✦ · tier 2 only
  GATING --> AWAITING_OWNER : L12 · tier 0/1 skips review
  REVIEWING --> AWAITING_OWNER : L15 · verdict recorded
  REVIEWING --> RUNNING : L16 ✦ · owner names a defect
  AWAITING_OWNER --> REVIEWING : L25 ✦ · owner re-buys an unevidenced review
  AWAITING_OWNER --> RUNNING : L19 ✦ · owner rework
  AWAITING_OWNER --> LANDING : L20 · human on a TTY only
  LANDING --> LANDED : L23 · HEAD equals candidate
  LANDING --> BLOCKED : L24 · non-FF or dirty
  LANDED --> PUBLISHED : L27 · human on a TTY only
  PUBLISHED --> [*]
  BLOCKED --> [*]
  CANCELLED --> [*]

  note right of BLOCKED
    Reachable from every active state by explicit
    host reason code — NEVER by a clock.
    awsf retry mints attempt n+1 at DRAFT.
  end note
  note right of CANCELLED
    Reachable from every active state by
    explicit human cancel. Any other route
    into LANDED throws HumanGateBypass.
    ✦ = spawn site — legal only on edges
    into RUNNING or REVIEWING.
  end note
```

All 27 legal edges, all 94 rejected pairs and the ordered rejection contract are
green in the suite. `LANDED` and `PUBLISHED` are reachable only through a human
at an interactive terminal. Of the 137 transitions in this repository's current
projection, 129 were taken by the host and 8 by a human — and every one of those
eight is owner re-entry: seven reworks and one replacement review.

## marimba — the driving layer

AWSF is a CLI. Something still has to decide *which* command to run, read what
came back, and hand the owner what a decision needs. That job is **marimba**:
an agent session in the driving role, sitting one tier above the factory.

**marimba never does the work.** It does not implement a task, does not edit a
managed worktree, and does not hand-edit anything under the state root. Workers
do that, inside attempts, under gates. marimba prepares, launches, observes,
records decisions and reports.

The first rule of the driving layer is the one that keeps it honest:

> **No skill is ever in the execution path.** No gate, transition, guard,
> reservation or accounting decision may depend on a driving document being read
> or followed. If one ever would, that is a defect in the CLI and it is fixed
> there.

So marimba is a judgment layer over a CLI that is already safe without it. Its
documents are thin and the CLI is fat, on purpose: every action marimba takes is
a command a human could type.

### The boundary

marimba runs with permission prompts turned off. What keeps it inside the
lifecycle is therefore not a prompt but a **per-invocation denial at the tool
surface**, delivered by a hook launched with marimba's own settings. Three
fences, defined once in
[`docs/driving/marimba/marimba-guard-rules.mts`](docs/driving/marimba/marimba-guard-rules.mts):

| Fence | What it denies | Why |
|---|---|---|
| **1 — delegation-shaped tool names** | Any tool whose normalised name contains one of 14 delegation stems (`agent`, `task`, `spawn`, `worktree`, `cron`, …) | A driving session must not start work the factory has no attempt directory, journal record, reserved call or gate for. Classification is by *shape*, not a fixed list, so a delegation tool that did not exist when the fence was written is denied on arrival. Ten observe-or-stop names are excluded by whole name; an MCP server's nouns are never classified. |
| **2 — owner-act command text** | A shell command invoking any of the 8 acts the lifecycle reserves for the owner: `land`, `cancel`, `rework`, `review`, `journey`, `raise`, `publish`, `resume` | `processOwnerTerminal()` checks `stdin.isTTY`, which is a terminal-*shape* test. A same-user agent with shell access can allocate a PTY and answer the confirmation, so the TTY check is not the boundary — this fence is. |
| **3 — lifecycle timeout metadata** | A finite timeout, as declared metadata or as a written `timeout` wrapper, around `run`, `rework`, `review` or `resume` | An external deadline on a lifecycle command kills a run mid-transition. |

If the payload parser cannot run at all, the guard **fails closed** and says so.

Fences 1 and 2 are shared by both supported harnesses; fence 3 is a pi-path
safety floor. The rules module imports nothing, a shell `PreToolUse` hook and a
pi extension both bind to it, and the suite asserts that the shell script's own
`for` loops still name exactly what the module exports — so editing one
harness's list without the other fails a test instead of silently producing two
different boundaries. The guard's behaviour is proven offline by a payload
matrix in [`core/test/unit/meta/`](core/test/unit/meta): 22 tests across
`marimba-guard.test.ts` and `marimba-guard-pi.test.ts`.

The repository holds the only copy of both scripts. The owner's settings point
at them by absolute path, so the file that is tested and the file that executes
are the same bytes and cannot drift apart.

### What the boundary does not cover

Stated plainly, because a fence whose limits are undocumented is a fence people
over-trust. Every item below was measured against the guard as committed, and
the full list lives in
[`docs/driving/marimba/CONTRACT.md`](docs/driving/marimba/CONTRACT.md) §3:

- Fence 2 reads **written command text, not resolved intent.** An act reached
  through a variable, a line continuation, or a quoted or split verb is not
  denied. Whitespace is the only shell transformation it undoes.
- Fence 2 **over-denies** in the other direction: a command that merely quotes
  an act name is refused as though it had invoked one.
- The guard **does not protect its own files.** A write aimed at its own script
  is allowed, because fence 2 only ever reads a command field.
- A payload the parser **rejects** fails open, deliberately — failing closed
  there would break every tool call the day a harness changes its payload shape.
- A session launched **without marimba's settings carries no guard**, and
  nothing inside it announces that afterwards. Hence the session-start banner,
  which reports what it could confirm and names what it could not.

**It is not a sandbox.** What the boundary buys is that routing around it is a
*choice* and never an accident.

### The planning journal

A driving session needs somewhere to put what the owner actually asked for, what
it proposes to do about it, and what the owner decided — with none of it living
in a committed file, because which work is running is runtime state. That is the
**group journal**, reached through `awsf group` and stored beside the attempts
in the state root.

It is the same shape as the lifecycle journal: append-only, hash-chained, with
each event naming its predecessor's digest and its base revision. Three
operations carry it:

| Operation | What it records |
|---|---|
| `capture` | The owner's request, verbatim, with its provenance — a handoff file with its SHA-256, a repository revision, a quoted instruction. Exact-input retention is the point: a paraphrase is a second source of truth. |
| `propose` | A revision-bound unit of work — title, explanation, what changes, why, the friction it costs, its prerequisites and acceptance evidence. A proposal names a base revision and carries a content hash. |
| `apply` | The owner's decision, naming the proposal id, its hash, and the owner's own reason. A proposal whose hash no longer matches cannot be applied. |

`inspect`, `orient`, `focus` and `checklist` are bounded read views over the
same journal. They grant no execution permission, and a packet that *looks*
ready is never a reason to launch a worker.

Two groups exist on this repository, holding 85 events between them: 31
captures, 27 proposals and 22 applied decisions across 15 named units. The
journal keeps the proposals that were **never** taken as well as the ones that
were, which is how a superseded scope stays readable instead of disappearing —
one unit in it went through three proposals before the owner's answers made the
third the one that landed.

### What marimba drove, and what it did not

Worth separating, because the two look alike from outside.

**Through driving sessions.** 44 real attempts on this repository, 8 landed and
sealed, the rest blocked, cancelled or still open — every one of them prepared,
launched and read by a driving session, and every landing authorised by the
owner at a terminal. Twenty-six of them ran `build-review` at T2 with an
opposite-provider reviewer; the recorded verdicts are 6 `accept` and
8 `concern`, and a `concern` has been landed on the record rather than argued
away.

**Outside them.** The marimba roadmap's Tasks 3, 4, 5, 6 and 7 were built by
external engineering sessions on the `task3.5` branch — one commit per task,
each with its own green gates — while the group journal held the scope, the
owner's answers and the lineage. The journal is explicit about why: those tasks
change the dashboard and the driving surface itself, and a factory attempt that
rebuilds its own observation surface mid-run is a worse idea than a branch. The
record survives either way, which is the property that matters.

### Handing off

A driving session may start exactly one new session, and only through
[`docs/driving/marimba/handoff.sh`](docs/driving/marimba/handoff.sh), which
takes a handoff file from a fixed directory and a variant **name** from its own
table — never a composed argv. That is what stops a driving session launching a
successor with the guard omitted. A handoff carries facts with their sources
(`file:line`), never conclusions, because the receiving session is told to
verify and can only do that against a source.

### What marimba reads

`/prime-awsf` orients a session, then
[`docs/driving/skills/awsf/SKILL.md`](docs/driving/skills/awsf/SKILL.md) is the
judgment layer: a posture, four hard rules, and a routes table pointing at six
cookbooks (preflight, prompting, workflow and tier choice, run and observe, read
a blocked attempt, owner acts) and three references (evidence map, lifecycle,
gotchas). The suite asserts every path in that table resolves, so the table
cannot quietly outlive the tree. `marimba-plan` is the companion skill for the
group journal — capturing requests, proposing units, and reading progress back.

## The dashboard

A Vue 3 + Vite single-page app, served on loopback only, polling the read API.
It exists to answer one question the terminal answers badly: **what is happening
right now, and what did it cost?**

The plan calls it *the glass wall*, and the name is the specification — you can
see everything through it and reach nothing:

- **The sessions grid** — one card per attempt, with its lifecycle state, risk
  tier, workflow, provider, calls spent against the tier ceiling, and token
  totals. Filterable by state and workflow, stackable, sortable.
- **The session detail** — a state ribbon of the transitions actually taken, a
  swimlane of phases over time, the agent roster, the gate results with what
  each gate checked, the phase inspector and its drawer down to the compiled
  prompt and the envelope rounds, and the owner gate card when an attempt is
  waiting on a person.
- **The event log** — the live stream. Reasoning text is displayed as it
  arrives and never persisted, which is a configuration the loader refuses to
  let you flip.
- **The backlog board** — tickets across plans, in `todo` / `wip` / `done` /
  `failed`, with plan cards linking a run back to the plan that asked for it.
  The dashboard distinguishes a `spine` plan from a `deep` one, because v2's
  structure is that every spine milestone owns a deep plan.
- **Money labels that never lie.** Usage and cost each carry an *authority*:
  `provider`, `catalog-estimate` or `unavailable` for cost, `provider`,
  `partial` or `none` for usage. A number the provider did not report is shown
  as unavailable rather than estimated into something that reads authoritative.
  The sandbox badge works the same way — `os-enforced`, `tool-policy` or
  `unavailable`.
- **A degraded-observability banner**, because a projection that has fallen
  behind must say so rather than quietly showing stale truth.
- **Seven lab palettes** in light and dark, switchable from the top nav.

Polling is cadence-aware — 500 ms on a live session, 2 s on the grid, 5 s idle —
with bounded exponential backoff and focus catch-up.

**The page has exactly one lever.** Of the nine API routes, eight are reads and
the ninth archives a card. There is no start button, no land button, no retry
button: every act that changes anything is a CLI command the owner types at a
terminal. A meta-test asserts the route table stays that shape.

Build it before serving it — `awsf dash` never builds:

```bash
npm run dash:build
npm run awsf -- dash          # loopback only, 127.0.0.1
```

### The dashboard is further along on `task3.5` than on `main`

Stated rather than smoothed over, because the difference is large and a reader
comparing branches will find it. `main` carries 26 components and ~4.0K lines;
`task3.5` carries 38 components and ~9.9K lines, and adds:

- **An execution canvas** — a reproducible force-directed map of runs, plans and
  driving sessions, filterable by kind, with a wheel that opens a run into its
  pipeline, a plan into its board, and a driving session into its decision
  slides.
- **Group decision trees** — the group journal's applied decisions rendered
  above the runs they authorised, distinguishing the owner's own words from an
  assistant's proposal from derived text.
- **Run-failure classification** — every failed phase sorted into `refusal`,
  `review`, `quota`, `harness` or `unclassified`, from the thrown error's class
  name, with an unrecognised name falling into `unclassified` rather than being
  guessed at. The distinction is the whole point: a refusal is the factory doing
  its job, a quota failure means nothing was wrong with the work.
- **A notification sound**, so that silence means nothing needs you.

`main` is currently mid-flight on the roadmap's Task 8 (recovery and adoption,
the protected-quota foundation, seeded continuation) and its tree is dirty. The
merge happens when Task 8 is done — and it is a gate, not a preference: W17's
deep plan records `G17-M`, measured 2026-09-15 from merge-base `8268258`, with
`main` 8 commits ahead, `task3.5` 27 ahead, and a trial merge conflicting in 17
files.

## Workflows

Eight recipes, each a fixed phase sequence the host opens; a model never selects
its own next phase.

| Workflow | Phases |
|---|---|
| `scout` | scout |
| `intake` | intake |
| `plan` | planner |
| `build` | builder → tests |
| `plan-build-test` | planner → builder → tests |
| `build-review` | builder → tests → reviewer |
| `simple-sdlc` | planner → builder → tests → documenter → final tests → reviewer |
| `design-to-plan` | designer → architecture-reviewer → planner → plan render |

`awsf workflows` lists what the current configuration enables. On this
repository's own history the distribution is `build-review` 27, `simple-sdlc` 6,
`build` 6, `design-to-plan` 5.

## Risk tiers and the call ceiling

A "call" is one paid provider invocation. Tiers ration them:

| Tier | Meaning | Default ceiling |
|---|---|---|
| T0 | read-only analysis, no second opinion | 1 call |
| T1 | localized, reversible mutation | 3 calls |
| T2 | security, process control, persistent data, cross-component or weakly-tested work | 5 calls |

T2 mandates an opposite-provider review, which is what the wider ceiling pays
for. The defaults are a real dial in `awsf.config.yaml`; the *bound* on that
dial is in `core/src/state/tiers.ts`, because a bound the config could raise is
a bound the config could remove.

When an attempt runs out, the ceiling is a checkpoint rather than a cap:
`awsf raise TASK --calls N --reason "..."` grants one named task more calls
while its attempt is live, at a TTY, with the grant and the reason written to
the journal. It is bounded per act and in total, task-scoped, carried forward by
`awsf retry`, and refused outright to a piped stdin.

## Gates

Twenty postcondition gates. A passing gate records what it checked, not merely
that it passed.

| Group | Gates |
|---|---|
| Output shape | `envelope_valid`, `json_parses`, `artifacts_exist`, `files_non_empty` |
| Claim vs reality | `diff_matches_claims`, `head_advanced`, `candidate_hygiene` |
| Policy | `no_protected_paths`, `writes_within_globs`, `risk_tier_sufficient` |
| Review integrity | `verdict_consistent`, `review_evidence_present`, `architecture_verdict_consistent`, `architecture_review_clear` |
| Evidence of work | `commands_pass`, `journey_passes`, `design_evidence_present` |
| Plan continuity | `contract_digest`, `spine_declared`, `spine_carried` |

`review_evidence_present` is the one worth calling out: a T2 reviewer is handed
host-composed evidence — the owner's request and acceptance criteria, the exact
base and candidate SHAs, the Git-observed changed-file list, a bounded
whole-hunk diff with the digest of the full one, and the complete command
results. The gate refuses evidence that *could not be* evidence before the call
is spent, and refuses the phase whose prompt did not carry it, because a review
that saw nothing is not a review.

## Owner acts

Eight acts the lifecycle reserves for a human. Each is interactive, each is
journalled, and none can be reached by a model.

| Act | What it does |
|---|---|
| `awsf rework TASK "<concrete defect>"` | One fresh builder call on a new candidate built on the prior one, with fresh gates. T1 only: what it produces has not been reviewed. |
| `awsf review TASK --reason "..."` | The T2 counterpart. Replaces a review recorded without evidence, once, on the opposite provider, changing no tree — so it preserves the green rather than invalidating it. A review carrying a *passing* `review_evidence_present` row is not replaceable at all, so disliking a verdict cannot buy a second opinion. |
| `awsf raise TASK --calls N --reason "..."` | Grants a live attempt more calls, bounded and journalled. |
| `awsf journey TASK --journey ID --sha REVISION` | Records the end-user journey. The gate checks separately that it ran, that it passed, and that the revision is the exact candidate. |
| `awsf land TASK` | Local fast-forward only, from a TTY, through a persisted `LANDING` state. |
| `awsf publish TASK` | Publishes a landed revision to its configured remote branch and seals the attempt. |
| `awsf cancel TASK` | Explicit human cancel, reachable from every active state. |
| `awsf resume TASK` | Resumes a quota pause or an accepted phase result without repeating a model call. |

## How the work is planned

The plan is the unit of work, and it nests two levels deep.

1. **A spine plan** declares the workstreams and sequences them, with the
   ordering gates that cannot be resequenced. `specs/awsf-v2-plan.html` is the
   current one: seventeen workstreams, each a milestone.
2. **A deep plan** is authored per workstream, with its own milestones, tasks,
   Questionables and validation commands — `specs/awsf-v2-w17-shift.html` and
   its siblings.
3. **A ticket set** mirrors each plan one file per task under `specs/tickets/`.
   A meta-test asserts a plan and its tickets can never disagree.
4. **An amendments log** at the end of every plan records what changed after
   authoring — each entry dated, each naming what moved and what deliberately
   did not. There are **189 such entries** across 16 plan documents, and they
   are where the project's real history lives: the corrections, the questions
   the owner answered against a recommendation, and the findings that only a
   live drive could produce.

Markers are earned rather than pre-declared: a milestone goes `[x]` in the same
commit that flips its ticket, and an amendment that moves no marker says so.

## Install and usage

AWSF runs from a checked-out repository on Node 22.12 or newer.

```bash
npm install
npm test
awsf init ./my-project --project my-project
npm run awsf -- project register --catalog ./my-project/awsf.project.yaml --repository app=/absolute/path/to/app
npm run awsf -- doctor
npm run awsf -- workflows
npm run awsf -- db rebuild
```

Drive a configured T1 workflow, landing only at an interactive terminal:

```bash
npm run awsf -- new T01 "describe the task" --workflow build
npm run awsf -- start T01
npm run awsf -- run T01
npm run awsf -- status T01
# If inspection finds a concrete defect:
npm run awsf -- rework T01 "remove the duplicate whitespace in core/src/generated.ts"
npm run awsf -- land T01
npm run awsf -- publish T01
```

The tier belongs to the workflow recipe, so `awsf new` derives it: passing
`--tier` is optional, and a tier that disagrees with the recipe is refused
before a DRAFT attempt exists.

The [`justfile`](justfile) is optional convenience only; each target delegates
to a root npm script.

## Verifying these claims

Every status claim on this page is backed by a command, not an assertion:

```bash
npm install
npm test              # unit + contract + simulation + zero-quota journeys
npm run lint          # oxlint over core/ and dashboard/
npm run typecheck     # tsc over core/** plus vue-tsc over the dashboard
npm run awsf -- status <task-id>
npm run awsf -- doctor
npm run awsf -- db rebuild
```

Do not take a green unit suite as evidence about process trees or Git landing —
`npm test` runs all four layers, and each proves something the others cannot:

| Layer | Tests | What only this layer can prove |
|---|---|---|
| `unit` | 1,815 | Pure logic: the transition matrix, gate arithmetic, contract parsing, and the 33 architecture fences |
| `contract` | 95 | That all three `ProcessSupervisor` implementations satisfy one shared behavioural contract |
| `simulation` | 84 | Crash safety: SIGKILL injected at every step of the launch sequence, torn journal lines, orphan reaping, rebuild identity |
| `journeys` | 173 | End-to-end owner paths — correction, rework, review inversion, permission breach, human gate, publish — against captured provider fixtures |

The journey suite spends no provider quota.

## Repository layout

Two npm workspaces, so the dependency allowlist is mechanically checkable per
workspace (`core/test/unit/meta/dependency-allowlist.test.ts`). There is
deliberately no `orchestrator/` directory — a CLI calls a workflow that opens
phases; naming a directory "orchestrator" is how one grows back.

```
awsf.config.yaml          the only committed tuning surface — validated by core/src/config/
awsf.project.yaml         this project's own catalog entry: repositories, gates, plan root
AGENTS.md                 invariants an agent session working ON this repo must not break
specs/                    the planning artifacts — read these first
  awsf-plan.html             the v1 spine: M0–M11, 38 tasks, 75 amendments
  awsf-v2-plan.html          the v2 spine: 17 workstreams, 9 landed
  awsf-v2-w*.html            one deep plan per workstream, each with its own amendments
  awsf-architecture-proposal.md   the accepted design authority the plans implement
  tickets/<plan>/            one ticket per task, kept in sync with the plan by meta-test
core/                     @awsf/core — the host
  src/state/                 the pure task and phase machines; imports nothing impure
  src/contracts/             runtime-validated envelopes, TypeBox-generated schemas
  src/workflow/              the eight recipes, the phase engine, the correction economy
  src/gates/                 the twenty postcondition gates
  src/execution/             process supervision, the PID-before-spawn barrier, call budget
  src/adapters/              claude-code, pi-codex, antigravity, fixture stub
  src/persistence/           the append-only journal and status store
  src/planning/              the group journal: captures, proposals, applied decisions
  src/observability/         the SQLite projector and its rebuild path
  src/publish/               the single authorised push site
  src/api/                   the loopback HTTP server
  test/{unit,contract,simulation,journeys}/    four executable proof layers
dashboard/                Vue 3 + Vite, loopback-only, cursor-polling dashboard
docs/driving/             marimba: the driving role's contract, guards, skills and cookbooks
prompts/<agent>/          system.md / user.md pairs per agent, referenced by awsf.config.yaml
records/pilots/           the two real adoption pilots, written up with their evidence
```

Runtime state lives outside the repository, under the platform state root —
attempts, journals, the projection, and the group journals. Nothing runtime is
ever committed; a meta-test enforces it.

## Configuration

`awsf.config.yaml` is the only committed tuning surface — adapters, routing, the
per-agent Model·Prompt·Harness·Tools dial, workflows, gates, risk tiers, policy,
observability and pricing. It is validated against the `awsf/v1` TypeBox schema
in `core/src/config/schema.ts` by a loader that hard-rejects:

- **any absolute machine path** (POSIX, Windows drive-letter, UNC or `~`) — this
  file is durable intent, committed and versioned forever, and must never encode
  where anything lives on any one machine
- **any credential-shaped value**
- traversal, ambiguous separators, overlap or absolute paths in
  `runtime.seed_paths`
- adapter, workflow or gate identifiers outside the known set
- a risk-tier call ceiling that is not a whole number of calls inside the bound
  in `core/src/state/tiers.ts`
- `routing.no_fallback` set to anything but `true`
- `observability.persist_thinking_text` set to anything but `false` — model
  reasoning is streamed for live display and never persisted

`core/src/config/effective-config.ts` produces the redacted snapshot that backs
the API and the dashboard, with a defence-in-depth redaction pass on top of what
the loader already guarantees.

## Portability

Every cell may only be filled with evidence produced *on the machine the column
names* — a passing Linux suite is not evidence about Darwin. The plan's
[Portability Matrix](specs/awsf-plan.html#portability) is the sole authoritative
table, with per-cell dates, deferrals, and the command output behind each claim.
The WSL2 column is closed. **No native-Windows write parity is claimed.**

## Governance

[`AGENTS.md`](AGENTS.md) lists twelve invariants any agent session working *on*
this repository must not break — no `node:child_process` outside the transport
broker, no `shell: true` anywhere, no SQLite writer outside the projector and
its migrations, no credential-shaped value committed anywhere, no commit that
names an agent as author or co-author, no status marker flipped for work a
session did not complete, and a plan that never disagrees with its ticket set.
Most are mechanically enforced by the meta-tests under
[`core/test/unit/meta/`](core/test/unit/meta).

## Status

### v1 — complete

| Milestone | State | What it covers |
|---|---|---|
| **M0** — the plan | `[x]` | Architecture accepted, plan authored, all nine Questionables resolved |
| **M1** — contracts & state | `[x]` | Workspace, config and envelope contracts; the exhaustive lifecycle and phase machines |
| **M2** — durable persistence | `[x]` | Journal, status store, SQLite projector, crash recovery and rebuild |
| **M3** — execution kernel ⚠ | `[x]` | Process supervision, the PID-before-spawn barrier, call-budget reservations |
| **M4** — real adapters | `[x]` | `claude-code` and `pi-codex` against captured real provider streams |
| **M5** — workflows & gates | `[x]` | The recipes, the gates, permission profiles, and the correction loop |
| **M6** — owner controls | `[x]` | The CLI, TTY-only persisted landing, cancel, retry, doctor, rebuild, list-only gc |
| **M7** — API & dashboard | `[x]` | The loopback HTTP API and the Vue dashboard |
| **M8** — platform & pilots | `[x]` | WSL2 matrix evidence and **both adoption pilots landed** — see [`records/pilots/`](records/pilots) |
| **M9** — the work queue | `[x]` | Tickets and the backlog board |
| **M10** — arguing back | `[x]` | The review reaching the builder: the correction economy and owner re-entry |
| **M11** — closeout | `[x]` | The plan's own loose ends; the WSL2 column closed |

All 38 v1 tickets are `state: done`. Pilot 1 was a T1 read-only survey; pilot 2
a T2 task whose opposite-provider review returned `concern` with four findings
and was landed with those findings on the record.

### v2 — the current workstream

v1 built a factory that can build *this* repository. v2 makes it one the owner
can point at **any** project and carry from an idea to published source with the
evidence to prove it. Its ceiling is deliberate: **build and publish are in
scope; deploy and monitor are declared, not built**, because each needs a
decision it does not have yet, and naming them is what stops them being absorbed
into an adjacent workstream by accident.

| # | Workstream | Class | State |
|---|---|---|---|
| W01 | marimba's operating contract | v2 core | `[x]` |
| W02 | Evidence readability | v2 core | `[x]` |
| W03 | `awsf init` | v2 core | `[x]` |
| W04 | Project registry v1 | v2 core | `[x]` |
| W05 | Design → architecture-review → plan | v2 core | `[x]` |
| W06 | Prompt composition | v2 core | `[x]` |
| W07 | Quota telemetry | v2 core | `[x]` |
| W08 | Publish | v2 core | `[x]` |
| W09 | agy adapter | optional | `[ ]` |
| W10 | mf adapter | optional | `[ ]` |
| W11 | The five-stage ladder | v2 core | `[x]` |
| W12 | The cheatsheet | v2 core | `[ ]` |
| W13 | Deploy | declared, not built | `[ ]` |
| W14 | Monitor | declared, not built | `[ ]` |
| W15 | Ticket closure | declared, not built | `[ ]` |
| W16 | The pi/OpenRouter adapter | optional | `[ ]` |
| W17 | `shift` — a milestone as one attempt | v2 core | `[ ]` |

W12 is worth reading even unfinished: its sixteen amendments are the record of
driving the factory against real work for a week — every enabled route
exercised, four hidden seams induced and removed, a review's fifteen findings
closed or refused in code, and two structural traps in the rework path found the
only way they could be found.

W17 is the newest and the most ambitious: a workflow whose phase list is
*compiled from selected tickets*, so one milestone becomes one attempt with one
owner gate. It exists because the obvious alternative does not work — a queue of
independent unattended runs halts on ticket one and waits for a person, since
`L20` is human-only and no timer can produce a lifecycle transition.

## Planning artifacts

- [`specs/awsf-v2-plan.html`](specs/awsf-v2-plan.html) — the current spine.
- [`specs/awsf-plan.html`](specs/awsf-plan.html) — the v1 plan: every milestone,
  task, architectural table and Q&A.
- `specs/awsf-v2-w*.html` — one deep plan per workstream.
- [`specs/awsf-architecture-proposal.md`](specs/awsf-architecture-proposal.md) —
  the accepted design authority the plans implement.
- [`specs/awsf-plan-acceptance.md`](specs/awsf-plan-acceptance.md) — every claim
  this project makes, mapped to the exact mechanism that proves it.

These are static HTML with inline Mermaid; GitHub renders them as source, so
clone and open them in a browser to read them as intended.

## License and attribution

This repository is public and carries **no license file**, which means default
copyright applies and no permission to use, copy, modify or distribute is
granted. That is a decision left open rather than an oversight.

Its design draws on `super-simple-software-factory`, an external MIT-licensed
© 2026 IndyDevDan project — see
[`specs/awsf-architecture-proposal.md`](specs/awsf-architecture-proposal.md) for
the full read-only audit this project's design is built on. Where SSSF code is
carried literally (stream framing, visualizer patterns), the receiving file
carries its own MIT attribution header; where only a pattern is reused, the
plan's own citations are the record.
