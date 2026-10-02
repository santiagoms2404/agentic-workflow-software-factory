# AWSF v3 — intent

**This file is the `USER_PROMPT` for one `plan-sota` run.** It is the single
input. It restates no evidence: the measurements, the grade and the reasoning
live in `specs/awsf-v3-assessment-and-direction.md`, which is the only detail
document a planning session should read.

**Draft for owner review.** Nothing here is authored into a plan until the owner
edits and approves this file.

---

## What v3 is for

v1 built a factory that can build **this** repository. v2 made it a factory the
owner can point at **any** of their projects, carrying an idea to published
source with evidence. v3 makes it a factory that **drives itself between the
owner's decisions**: the procedure is code, judgment runs on the owner's
subscriptions, every stop is explained, and every landing is the owner's.

The line v1 and v2 drew holds unchanged: **the host advances lifecycle state,
models supply structured facts, and a human authorises anything that lands.**
v3 extends that line to the driver. Today the driving procedure lives in a
model's memory, and that is where it fails: in a draft review of the 27 blocked
runs, 8 were stops a mechanical check would have refused. v3 moves the procedure
into the host.

## The ceiling — what "done" means for v3

v3 is done when, for AWSF and for Smart Health:

1. Every known trap is refused before any provider call, and every new stop
   becomes a trap with a test.
2. Every stop and every cancel carries a recorded cause, the driver's included.
3. Every driving session is recorded completely, across compactions.
4. Routes are chosen by a policy the owner approved, within the owner's
   subscriptions, with failover between providers.
5. A user-testing validator checks behaviour against the acceptance criteria
   before the owner's journey.
6. A harness drives the factory through L1–L4, and a local fine-tuned model has
   been measured against Sol on the same suites.
7. Smart Health has readiness checks and a staging deploy, and monitoring runs
   without an unattended background process.
8. At least half of AWSF's own code commits land through the factory.

Acceptance is measured, not asserted. The targets are in the last section.

## Explicitly out of scope for v3

Automatic landing of any kind. Production deploys without the owner. Any
unattended background daemon. Training on frontier-model output. Multi-user or
team features, and offering AWSF or the harness as a product to others.

## Decisions already taken — treat these as constraints, not questions

Each decision names the Questionable it closed in the assessment.

1. **Subscriptions first.** Agent work runs on the owner's subscriptions through
   the providers' official CLIs. API or paid-compute spend is an exception, each
   with a stated budget: Jev (W19), the OpenAI Decisions API as a shadow,
   OpenRouter, rented GPUs and hosted teacher inference.
2. **No frontier output in training data (Q1).** Training uses owner messages,
   tool results, owner confirmations, episodes generated on the stub adapter, and
   an open-weights teacher.
3. **Hardware (Q2, Q3 provisional, Q4).** A MacBook Pro M5 Pro with 64 GB is the
   planning baseline. GRPO at scale and the large teacher are paid exceptions. If
   an M5 Max with 128 GB is bought instead, they move local and nothing else
   changes. On the Mac, AWSF runs in a Linux VM, which keeps the bwrap sandbox.
   Until the Mac arrives, it stays on WSL.
4. **Landing stays human-only through v3 (Q11),** as invariant 13 already says for
   the Delegate.
5. **Routing is an owner-approved policy (Q10).** This supersedes v2 intent
   decision 5 ("quota is a readout, never a router"). A route policy chooses
   within bounds the owner approves, journals every choice, fails closed, and
   never spends on an API outside a lease.
6. **No unattended daemon (Q9).** A harness the owner launches and keeps in the
   foreground is allowed, as `awsf dash` is. Monitoring runs when the harness
   opens or in external CI.
7. **The factory builds AWSF by default (Q13).** Direct sessions are a logged
   exception. The target is at least 50% of code commits.
8. **Planning weight (Q14).** A light tier (a task with no deep plan) for small
   changes. Closed v2 specs leave the priming path. Reference docs are generated
   from code where they can be.
9. **The harness (Q5, Q6, Q7, Q8).**
   - The first surface is a panel in the AWSF dashboard. A native macOS app comes
     second. Text comes first, and local Spanish/English speech comes with the
     native app.
   - Read-only actions run freely. Each run gets one confirmation card covering
     `new`, `start` and `run`, with the route and estimated calls. Owner acts are
     only ever prepared, never executed.
   - The conversational model recognises: capture an idea, ask for a plan, launch
     a run, status or explanation, recover a blocked run, prepare an owner act,
     quota or routes, handoff, chat.
   - It is proven on AWSF first. Smart Health comes first for readiness and
     deploy.
10. **The user-testing validator (Q12).** Scripted browser checks generated from
    the acceptance-criteria ids come first, and agent-driven exploration second.
11. **W19 (Q15).** Rebase it onto `main` and finish M3–M4 as planned. Its M5 moves
    to X7, M6 and M7 to X9, and M8 to X10.
12. **Deploy for Smart Health (Q16).** The factory builds and publishes to a
    staging channel. Release to production is an owner act.
13. **Reliability before autonomy.** No workstream that widens what runs without
    the owner may land before Phase A's trap suite refuses every known trap.
14. **No model emits an owner act.** Owner acts are absent from every action
    schema a model fills, in every harness, whatever the spelling.

## Terms

- **L1–L4, the driving layers.**
  - **L1** is AWSF code: lifecycle, preflight refusals, and the legal next steps.
  - **L2** is decisions: W19's decision service picks among legal steps at
    routine stops.
  - **L3** is the conversational driver: it talks with the owner, captures asks
    and fills command arguments. Sol fills it first, and a local fine-tune later
    if it earns the role.
  - **L4** is frontier models, called through their official CLIs for planning
    and diagnosis.
- **K1–K5, the driver checks.**
  - **K1:** the DRAFT→PREPARED step refuses without a driver preflight record.
  - **K2:** `awsf next --json` returns the legal next steps and who may take each.
  - **K3:** the driver's output must match a schema of legal driver steps only.
  - **K4:** the confirmation policy in decision 9.
  - **K5:** the trap suite.

## The shape of this plan

**Author a spine.** Each workstream below is a whole workstream that gets its
own deep plan before any of its code is written. This plan holds the workstream
list, the phases, the dependencies, the shared invariants, the amendments each
workstream needs, and the Questionables each must resolve. It holds no
implementation detail.

Each workstream's build prompt is therefore a **meta-prompt that authors that
workstream's deep plan and stops at the owner-review gate** — not implementation
code. Deep plans default to managed execution through the factory (decision 7).
Manual execution is the logged exception for work a broken factory or a
protected path cannot carry.

## Before the spine is authored

- **The owner's W18 M5 bookkeeping commit.** The M5 code is on `main`, but M5,
  T15–T17 and the spine's M18 are still open. Invariant 2 keeps that flip with
  the owner.
- **The W19 rebase (decision 11).** Its branch is 28 commits ahead of `main` and
  31 behind it at 2f5e78e, in its own worktree. Run the suite at the rebased head
  before any further W19 work.

## Workstreams, by phase and in dependency order

### Phase A — reliability and record

| | Workstream | Why here |
| --- | --- | --- |
| X1 | **Driver checks** — K1 and K2; the guard also matches `npm run awsf [--silent] -- <owner act>`; a `driver` attribution cause, a reason on `awsf cancel`, and causes for cancelled attempts | 8 of 27 blocks look driver-preventable in the draft review, and 9 cancels carry no cause |
| X2 | **Trap suite** — K5 on the stub adapter, seeded from every past stop and the live gotchas, plus `awsf doctor` checks for Git storage, provider CLIs, quota, stale branches and open markers on landed work | Turns each past stop into a refusal with a test |
| X3 | **Ticket closure** (v2 W15) — a run closes its own markers and ticket states through an owner-confirmed act | No role can close them today, so plans drift from code |
| X4 | **Session record** — the session archive moves into the state root, and the dashboard shows each driving session cycle by cycle | Complete records feed metrics, evals and training |

### Phase B — autonomy within subscriptions

| | Workstream | Why here |
| --- | --- | --- |
| X5 | **Authority** — W19 carried: the decision service, the shadow owner, leases, Delegate acts and route fallback, with the Decisions API as a shadow backend | Every landing needs the owner at least twice |
| X6 | **Routing within subscriptions** — task class, route metrics and quota windows feed a route policy the owner approves; provider failover; lean delegation profiles; cache-stable prompt prefixes | Quota is the binding limit |
| X7 | **User-testing validator** — scripted browser checks from AC ids on the preview build, then agent-driven exploration | The owner is the only black-box tester |
| X8 | **Marimba harness v1** — a separate repository registered as an AWSF project and built through the factory; L1–L4 with Sol in L3; K3 and K4; native session capture; the guard rules reused | The driver is the most expensive and least reliable part |

### Phase C — always improving

| | Workstream | Why here |
| --- | --- | --- |
| X9 | **Context engine** — a capability index the driver reads first, with detail on demand (W19 M6–M7 folded in); generated reference docs; closed v2 specs out of the priming path | A driver turn re-sends a median of 168k prompt tokens |
| X10 | **Data loop and local model** — labels from confirmations and attributions, intent and trap suites, a local provider through pi (v2 W16 reshaped), a LoRA fine-tune on the Mac, and an A/B against Sol | The local model must earn L3 on measured suites |
| X11 | **Agent readiness for registered projects** — eight categories, a score and recommended actions, Smart Health first | Structure decides how agents perform in a project |

### Phase D — the whole loop and reach

| | Workstream | Why here |
| --- | --- | --- |
| X12 | **Mac host** — AWSF in a Linux VM on the Mac; a Seatbelt port only if the VM gets in the way | The sandbox is bwrap-only, and the Windows mount caused stops |
| X13 | **Deploy** (v2 W13) for Smart Health — build and publish to a staging channel; production release is an owner act | The loop stops at publish |
| X14 | **Monitor and signals** (v2 W14) — pulled when the harness opens or by external CI, then fed to intake and the backlog | Signals start the loop, and no daemon is allowed |
| X15 | **Surfaces** — the native macOS app (orb, hotkey, local speech) and phone notifications | Only after X8 proves the harness |

## What v2 hands over

| v2 item | In v3 |
| --- | --- |
| W18 M5 | Closed in v2 by the owner's bookkeeping commit |
| W19 Jev and the Delegate | Carried into X5. M5 → X7, M6 and M7 → X9, M8 → X10 |
| W16 pi/OpenRouter adapter | Reshaped into X10's local provider. OpenRouter stays the paid exception |
| W09 agy, W10 mf | Parked. Fusion is revisited after X7 as parallel candidates a validator chooses between |
| W13 Deploy, W14 Monitor | Carried as X13 and X14 |
| W15 Ticket closure | Promoted to Phase A as X3 |
| v2 intent decision 5 | Superseded by decision 5 above |
| v2's "no resident background process" scope | Restated by decision 6 above |

## Amendments this plan will need

Each one is proposed by marimba and approved by the owner, one at a time, as v2
did. Each names the invariant, what it blocks today with evidence, the
replacement guarantee in a still-mechanically-checkable form, its cost, **and the
alternative that avoids the amendment entirely.** Each lands as an
owner-approved commit before the build that depends on it.

- **Invariant 13**, for X5: a second decision provider needs its own single
  transport module, and the same rule that no agent phase receives its
  credential.
- **Invariant 7**, only if X7 or X4 needs a runtime dependency inside AWSF. The
  zero-dependency path is the default: Node built-ins, the browser's own CLI, or
  tooling that lives in an agent phase or the harness repository.
- **Protected paths:** `docs/driving/` for the guard fix in X1, and
  `awsf.config.yaml` for the route policy in X6.

## Surface these as Questionables rather than deciding them

- Which K1 evidence fields are measured by the host and which are attested by the
  driver, and how an attested field is checked.
- Where traps live (a new test layer or the journeys layer), and how a stop
  becomes a trap.
- The route policy's units and bounds (per task class, per provider window, per
  day), and how it composes with W19 leases.
- Whether the session archiver lives in AWSF core (X4) or the harness repository
  (X8). The assessment leans toward AWSF core, because the dashboard reads it and
  AWSF's scrubbing applies.
- The harness repository's name, location on the WSL filesystem, and stack.
- The local model's base (9B, 27B or 35B-A3B), chosen by the trap and intent
  suites, and the serving stack on the Mac.
- The user-testing validator's tooling within the dependency allowlist.
- What Smart Health's staging channel is, concretely.
- Monitor's signal sources, and the trigger that is not a daemon.
- Candidate stacking or a merge queue, so a run can build on an unlanded
  candidate.
- How a direct-session exception is logged and counted.
- What a readiness score measures for a project, and where scores live.

## Constraints the plan itself must honour

- `AGENTS.md`'s thirteen invariants hold unless an amendment lands first, under
  the process above. Several are mechanically enforced, so a plan that assumes
  otherwise fails its own gates.
- No workstream puts a skill in the execution path. A gate never depends on a
  document having been read.
- Work that cannot land from a managed worktree is named as owner-side and kept
  out of the task graph: machine setup, installs, model training runs, purchases.
- Every claim carrying a decision names its evidence, and the cheapest unused
  upgrade that would strengthen it.

## Acceptance targets

Measured with `awsf metrics` and the session archive. The baselines come from
the assessment, measured on 2026-10-01.

| Measure | Baseline | v3 target |
| --- | --- | --- |
| Factory share of AWSF code commits | 8% | ≥ 50% |
| Land rate | 25% | ≥ 70% |
| Owner acts per landing | ≥ 2 | 1 |
| Driver-preventable stops | 8 of 27 | 0 on known traps |
| Driver prompt tokens per turn (median) | 168k | < 10k |
| Owner asks captured | 41% | 100% |
| Stops and cancels with a cause | 1 of 36 | all |
| Validation share of phase time | 20% | about 35% |
