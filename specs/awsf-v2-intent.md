# AWSF v2 — intent

**This file is the `USER_PROMPT` for one `plan-sota` run.** It is the single
input. It is not a candidate record and it restates none of one: the reasoning,
the evidence and the collisions live in
`specs/awsf-v2-candidates-fuse-version.md`, which is the only detail document a
planning session should read.

**Draft for owner review.** Nothing here is authored into a plan until the owner
edits and approves this file.

---

## What v2 is for

v1 built a factory that can build **this** repository. v2 makes it a factory the
owner can point at **any** of their projects, and carry a project from an idea
through to something published with the evidence to prove it.

The factory is a mix of deterministic code and non-deterministic agents. That is
not a defect to design away. The line v1 drew holds unchanged in v2: **the host
advances lifecycle state, models supply structured facts, and a human authorises
anything that lands.**

## The ceiling — what "done" means for v2

The owner's vision for the factory is four stages: **build, publish, deploy,
monitor.** All four are declared in this plan as workstreams so the whole is
written down and sequenced rather than quietly deferred.

**v2 builds the first two.** Its ceiling is *published source with evidence*: a
project the factory can plan, build, gate, review, land and publish, with the
journal and the projection able to answer what happened and what it cost.

**Deploy and monitor are declared, not built in v2.** Each is a spine workstream
whose deep plan is authored after v2's core lands, and each needs a decision it
does not have yet — deploy because it is external mutation, monitor because
every version of "watch it in production" so far has been the resident-daemon
shape this project has twice refused. Naming them now is what stops them being
absorbed into some other workstream by accident.

## Explicitly out of scope for v2

Environment configuration, release migrations, rollback orchestration,
operational acceptance, and any resident background process. A candidate that
needs one of these is deferred to its own workstream rather than widened into an
adjacent one.

## Decisions already taken — treat these as constraints, not questions

1. **A project may span several repositories; a task owns exactly one.** Smart
   Health is three repositories and the factory must serve it, but `AttemptStatus`
   carries one repository and one worktree, landing is atomic per repository, and
   a partial cross-repo landing has no rollback story. Cross-repo work is a parent
   coordination record plus declared contract artifacts between single-repo child
   tasks.
2. **The registry has two layers.** A committed **catalog** — project identity,
   which repository holds the plan and which hold code, each repository's default
   branch and gate commands, delivery posture, the relationships between them.
   And a machine-local **placement** layer — where each clone sits on this
   machine, and per-project worktree roots. This split is forced by code:
   `config/load.ts` refuses absolute machine paths outright. **The state root
   stays out of both:** one state root per machine, projects namespaced inside it,
   because `doctor`, `gc` and `db rebuild` each operate over one root.
3. **marimba is the driving role, and its boundary is enforced at the tool
   surface.** It keeps `--dangerously-skip-permissions`, and its guard denies both
   delegation-shaped tool names and the six owner-act command shapes. The TTY
   check is a terminal-shape test, not an authorisation boundary, and the plan
   must not describe it as one.
4. **Invariant and protected-config changes are proposed by marimba and approved
   by the owner, one at a time.** No agent can write `AGENTS.md` or
   `awsf.config.yaml` — `path-policy` treats `protected-path` as an independent
   rejection. Each amendment names the invariant, what it blocks today with
   evidence, the replacement guarantee in still-mechanically-checkable form, its
   cost, **and the alternative that avoids the amendment entirely.** The amendment
   lands as an owner-approved commit before the build that depends on it.
5. **Quota is a readout, never a router.** Preflight is something the owner reads
   before starting. At a phase boundary the host may read the window, journal it
   as explicitly non-attributable context, and **stop at `AWAITING_OWNER` rather
   than launch the next phase** when the remaining window is too small. No timer,
   no automatic resume, and no per-task cost derived from an account-wide
   percentage.

## The shape of this plan

**Author a spine.** Each workstream below is a whole workstream that will get its
own deep plan before any of its code is written. This plan holds the workstream
list, the dependencies, the shared invariants, and the Questionables each
workstream must resolve. It holds no implementation detail.

Each workstream's build prompt is therefore a **meta-prompt that authors that
workstream's deep plan and stops at the owner-review gate** — not implementation
code.

## Workstreams, in dependency order

| | Workstream | Why here |
| --- | --- | --- |
| W01 | **marimba's operating contract** — command-free, inside `docs/driving/`, delivered as an appended system prompt; the guard's tests and captured refusals land with it | Cheap, self-contained, and it is what drives every other workstream |
| W02 | **Evidence readability** — per-kind event summarisers, delta folding, a rendered view beside raw JSON, and the clipped run cards | 85.3% of all projection rows are `text.delta` rendering as their own name. This is the surface the owner reads while driving everything below it |
| W03 | **`awsf init`** — deterministic, host-owned, no model: create the directory, `git init`, minimal config, baseline commit under the owner's identity | Removes greenfield's chicken-and-egg without inventing a pre-repository execution mode |
| W04 | **Project registry v1** — the two layers above, per-repo branch and gates, single-repo tasks, and the cross-repo coordination record | Everything multi-project depends on it, including `ticketStoreFor` gaining a plan to resolve against |
| W05 | **Design → architecture-review → plan** as compiled recipes with typed envelopes, a deterministic zero-blocker gate, and the `INV-n`/`AC-n` spine threaded design → ticket → gate | The best leverage per unit cost in the candidate set |
| W06 | **Prompt composition** — centralise the three composition sites, then the shared per-role block behind a repeated benchmark | Must precede new agent roles or it multiplies duplicated prompt paths |
| W07 | **Quota telemetry** — the readout, the phase-boundary snapshot, the import fence | Small, and it needs the registry's per-project shape |
| W08 | **Publish** — `authorizePublish` with an explicit truth table, one push site, tested against a local bare remote | Needs W04's per-repository remote policy, and an owner amendment to invariant 8 |
| W09 | **`agy` adapter** — parser graduation fixture-first with the route disabled, then the documenter role only | Detection-bounded, never prevention-bounded; the lightest write-capable role |
| W10 | **`mf` adapter** — a model-fusion branch shaped for AWSF, preferring a plan-only mode where AWSF spawns the children through its own broker | Also the first real customer of W04's multi-repo capability |
| W11 | **The five-stage ladder** — capture pass first, then the governed workflow | Last among executable work: it consumes W03 through W06 |
| W12 | **The cheatsheet** — acceptance is one clean-machine walkthrough by the intended reader | The final artifact, after the command surface stops moving |
| W13 | **Deploy** — declared, not built in v2 | Its deep plan and its amendment come after v2's core |
| W14 | **Monitor** — declared, not built in v2 | Same, and it needs a design that is not a daemon |

W09 and W10 are optional to v2's completion: nothing above them waits on either,
and neither graduates until its own evidence gap closes.

## Surface these as Questionables rather than deciding them

- The exact shape of the cross-repo coordination artifact between single-repo
  child tasks.
- How far the registry catalog eventually reaches beyond v1's fields.
- Whether `monitor` can be built without a resident process, and what it is if it
  cannot.
- The threshold and the units for W07's phase-boundary stop.
- Whether `AC`/`INV` ids are unique per plan, per project, or globally.

## Constraints the plan itself must honour

- `AGENTS.md`'s twelve invariants hold unless an amendment lands first under
  decision 4 above. Several are mechanically enforced; a plan that assumes
  otherwise will fail its own gates.
- No workstream may put a skill in the execution path. A gate never depends on a
  document having been read.
- Work that cannot land from a managed worktree — the owner's shell functions,
  installed skills, machine-local settings, upstream contributions to another
  repository — is named as owner-side and kept out of the task graph.
- Every claim carrying a decision names its evidence and the cheapest unused
  upgrade that would strengthen it.
