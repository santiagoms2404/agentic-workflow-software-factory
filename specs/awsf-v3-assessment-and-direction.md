# AWSF v3 assessment and direction

**Draft for owner review.** A brainstorm record, not a plan. It changes no status
marker, ticket or registered plan. It is evidence for a future
`specs/awsf-v3-intent.md`.

- **Date:** 2026-10-01
- **Measured at:** `main` 07b20f9. `npm run test:unit` passed 2,534/2,534.
  Factory figures come from the machine-local state root and the Marimba
  session archive.

---

## ELI version

- **What a software factory is.** A team of AI workers that does the whole job
  of making software. It listens to what users need, picks what matters, builds
  it, checks it, ships it, watches it, and gets better each time. Writing the
  code is the easy part.
- **The talk's three rules.**
  1. Work with any AI brand and the subscriptions you already pay for, and pick
     the cheapest model that's good enough for each job.
  2. Work alone for a long time, but prove every job is really done, using
     checkers who didn't do the work.
  3. Keep getting better: load only what's needed, keep the code tidy, and
     learn from your own history.
- **AWSF's grade: 53 out of 100.**
  - It's very good at checking work and staying safe: strong tests, strict
    rules, a reviewer from a different AI company, a sandbox.
  - It's weak at working on its own. Only about 8 of every 100 code changes to
    AWSF went through the factory. Every finished job still needs Santiago
    twice. Marimba, the AI that drives the factory, forgets checks and
    re-reads a huge amount of text every turn.
- **Where it can go.** Finishing the rest of v2 gets AWSF to about 64. A v3
  could reach 85 or more, in four steps:
  - **A.** Make it impossible to skip checks, and keep a full record of every
    session.
  - **B.** Let it work alone within your subscriptions, with automatic model
    choice and an AI that tests the app the way a user would.
  - **C.** Make it learn: less text per turn, a local model trained on your own
    data, health checks for your projects.
  - **D.** Finish the loop: the Mac setup, deploying, and watching the app after
    release.
- **The number to watch.** How much of your own code ships through AWSF. Today
  it's 8%. The goal is at least half.

---

## Assessment (as given on 2026-10-01)

Graded against the talk's own three pillars, AWSF scores **53/100 today**. It would reach about **64** once the remaining v2 plans land, and **85+** is reachable with a v3. Your verification and governance would hold up in an enterprise review now. What holds the grade down is that the factory isn't yet how you build your own software.

### The talk in brief (Tereza Tížková, Factory: "What it takes to build a software factory")

- **Thesis:** a software factory runs the whole lifecycle on its own: gather signals → prioritize → orchestrate → execute → validate → test in production → iterate → learn. Writing code is the easy part. Build it the way you'd build a team.
- **Pillar 1, Agnostic:**
  - Work where people already work: CLI, desktop, Slack, phone.
  - Let people bring their own key, model, machine and subscription.
  - Optimize tokens instead of cutting spend: cheaper default models, more caching (Coinbase went from 5% to 60% cache hits), no spend limits but required impact.
  - Route automatically. A classifier reads the message, recent tools, repo size, language mix and difficulty. It picks the cheapest model above a quality threshold, upgrades when a task fails, and switches providers when one is down. Their router matched 99% of Opus's pass rate at 20% lower cost.
- **Pillar 2, Autonomous:**
  - Trust is earned, with permissions per person and per task.
  - Loops only work when "done" can be checked. Without that you get cheating and broken loops.
  - Factory's "Missions": an orchestrator writes a validation contract before any code. Workers run one after another, each with fresh context, tests first. Validators never saw the code, report gaps and never fix them.
  - There are two validators. A scrutiny validator runs tests, types, lint and code review. A user-testing validator treats the app as a black box and clicks through it against the contract.
  - Validation took 37% of a 16.5-hour mission. 14% of their missions run longer than 24 hours.
- **Pillar 3, Always improving:**
  - Load tools and context only when needed, from a short index (up to 51% savings with 100+ tools).
  - Measure "agent readiness" in 8 categories: style, build, testing, docs, dev environment, observability, security, task discovery. Their slogan is "structure is the variable, not the model".
  - Stop repeating instructions: reusable skills, auto-generated docs, stored user preferences.
- **Direction:** humans decide *what* to build, and the factory handles *how*.

### Grade

| Criterion (weight) | Now | v2 done | Evidence |
|---|---|---|---|
| Whole lifecycle (15) | 7 | 7 | build → review → land → publish all work. Signals, deploy and monitor are declared but not built (W13–W14) |
| Bring your own subscription, model, machine (8) | 6 | 8 | Claude Code and Codex run on your plans through their official CLIs. OpenRouter only has M1 |
| Works where you work (5) | 2 | 2 | CLI, dashboard, Marimba in a terminal |
| Routing and token cost (12) | 4 | 7 | `no_fallback: true` and "quota is a readout, never a router". Marimba re-sends 168k tokens per turn |
| Checkable "done" (10) | 9 | 9 | acceptance criteria threaded from design to gates, gates measured by the host, phases count as failed until proven |
| Independent validators (8) | 4 | 4 | scrutiny exists (reviewer on the other provider). You are the user tester. Validation is 20% of phase time vs the talk's 37% |
| Long-running autonomy and owner load (10) | 3 | 6 | land rate 25% (12/48). Every landing needs at least 2 owner acts |
| Trust and permissions (7) | 6 | 6 | 13 invariants, 41 meta-test files, sandbox. One gap in the guard (F17) |
| Orchestrator reliability (7) | 2 | 3 | 8 of 27 blocked runs were preventable by the driver. 41% of your requests captured |
| Context management (6) | 3 | 4 | priming cut 95%, but turns are still 168k tokens |
| Agent readiness (6) | 4 | 4 | AWSF's own repo is well structured. Weak spots: the dev environment, and no readiness checks for Smart Health |
| Learning from its own data (6) | 3 | 4 | 1 of 36 stops has a recorded cause. 9 cancels have none |
| **Total** | **53** | **64** | |

### What you're doing well

- **S1** The validation contract is your strongest pillar. "Done means" must be command-checkable, acceptance criteria run from design to gates, and the host does the measuring. The talk's orchestrator does this with an agent. You do it in code, which is stronger.
- **S2** Scrutiny is independent: the reviewer runs on the other provider, is read-only, and reports without fixing.
- **S3** Trust is enforced in code: invariants backed by tests, sandbox, path policy, grants and credential scrubbing.
- **S4** You use your subscriptions through official CLIs, which is the talk's "bring your own subscription" without breaking any terms.
- **S5** Observability: every run can answer what happened and what it cost.
- **S6** AWSF's own repo is well structured: 2,534 green unit tests, four test layers, strict TypeScript.

### Where you're going wrong or deviating

- **N1** The factory builds only about 8% of itself. Since 08-11, 238 commits touched `core/src` or `dashboard/src`, and the factory's 12 landings carried 20 of them. You've built a governed lane, but direct agent sessions are still your production line.
- **N2** Owner load is high: a 25% land rate, at least 2 owner acts per landing (journey and land), and raises needed on 15 attempts.
- **N3** The orchestrator is your most expensive and least reliable part. In the talk it's the cheapest. You already know the cause: Marimba driving by chat.
- **N4** You deliberately chose "quota is a readout, never a router". For a subscription-bound owner, routing is the main throughput lever. Change this in v3: a routing policy that proposes and logs its choices, within limits you approve.
- **N5** You deliberately kept a human in charge of every landing. Keep that, and automate everything before it.
- **N6** There's no user-testing validator. You do the black-box check yourself every time.
- **N7** A run can't close its own plan markers (that's what W15 was declared for), so plans drift from code. W18 M5 landed on 10-01, but its markers and T15–T17 still say open. Specs total 92,828 lines vs 56,352 in `core/src`, and 175 of the 530 commits since 08-11 are docs.
- **N8** The lifecycle stops at publish.
- **N9** The dev environment is the weakest readiness area. The Windows-mounted drive caused stops, and the sandbox only works on Linux.
- **N10** Branches drift: W19 is 29 commits ahead of `main` and 28 behind it, and there are more than a dozen side branches.

### Limits on scaling, and fixes

| Limit | Fixable? | How |
|---|---|---|
| Your attention (≥2 acts per landing) | Yes | the K1–K5 checks, W19 leases, a user-testing validator. Landing stays yours |
| Subscription quota windows | Partly | routing within subscriptions, the lean delegation profile (−94% context), stateless driver turns, a local model for cheap roles |
| One attempt at a time, can't build on an unlanded candidate | Yes | candidate stacking or a merge queue |
| One machine, WSL quirks, Linux-only sandbox | Yes | Mac with a Linux VM, then a macOS sandbox port |
| Single owner | By design | turn knowledge into code (traps, readiness checks) instead of prose and handoffs |
| Planning overhead | Yes | a light planning tier for small changes, generated docs, closed plans archived |

To prevent future friction:
- Every stop becomes a trap that refuses the run before any spend, plus a test.
- Every cancel requires a reason.
- Runs close their own markers.
- `awsf doctor` reports stale branches, open markers on landed work, Windows-drive storage, missing provider CLIs and low quota.
- Any "done" you keep typing is an automation candidate, and metrics count it.

### KPIs to track (now → v3 target)

| KPI | Now | Target |
|---|---|---|
| Factory share of code commits | 8% | ≥50% |
| Land rate | 25% | ≥70% |
| Owner acts per landing | ≥2 | 1 |
| Driver-preventable stops | 8 of 27 | 0 on known traps |
| Driver prompt tokens per turn | 168k | <10k |
| Requests captured | 41% | 100% |
| Stops with a recorded cause | 1 of 36 | all |
| Validation share of phase time | 20% | ~35% |

### Direction: yes, write a v3 spine

v2 has reached its own ceiling, "published source with evidence". What's still open in v2 was planned before subscriptions-first, the K checks, the harness and the local model. Two v2 rules (quota never routes, no resident process) also need restating. Proposed thesis: **the factory drives itself between your decisions. The procedure is code, judgment runs on your subscriptions, every stop is explained, and every landing is yours.**

- **Phase A, reliability and record.** This comes first because autonomy multiplies whatever error rate exists.
  - X1 Driver checks: K1, K2, the guard fix (A10), the driver cause and cancel reasons (A12).
  - X2 Trap suite plus environment checks in `doctor`.
  - X3 Ticket closure (from W15).
  - X4 Session record in the state root and the dashboard (A14).
- **Phase B, autonomy within subscriptions.**
  - X5 Authority: W19 carried forward, with the Decisions API as a side-by-side comparison.
  - X6 Routing: task class plus route metrics plus quota → a route policy you approve, provider failover, lean delegation profiles.
  - X7 User-testing validator.
  - X8 Marimba harness v1, with Sol as the conversational layer first.
- **Phase C, always improving.**
  - X9 Context engine: load on demand, generated docs.
  - X10 Data loop and local model, with W16 reshaped into the local-model provider path.
  - X11 Readiness checks for your projects, Smart Health first.
- **Phase D, the full loop.**
  - X12 Mac host.
  - X13 Deploy (from W13).
  - X14 Monitoring and signals without a background daemon (from W14).
  - X15 Surfaces: orb, voice, phone.

What happens to the remaining v2 work:

| v2 item | v3 |
|---|---|
| W18 M5 | Close it in v2 with your bookkeeping commit |
| W19 (M1–M2 done on its branch) | Carry into X5. Rebase now and finish M3–M4. Move M5 → X7, M6/M7 → X9, M8 → X10 |
| W16 (M1 done) | Reshape into X10's local-model provider path. OpenRouter stays as the paid exception |
| W09 agy, W10 mf | Park. Revisit fusion after X7 as "parallel candidates, the validator picks one" |
| W13, W14 | Carry as X13 and X14 |
| W15 | Promote to Phase A (X3) |

Order: close the W18 bookkeeping → decide W19 (Q15) → write `specs/awsf-v3-intent.md` from your answers → spine plan with plan-sota → Phase A deep plans first.

### Open questions

Carried over, with updated recommendations:
- **Q3** Which Mac? Subscriptions-first plus local GRPO and a local teacher model favors the M5 Max with 128 GB.
- **Q4** Where does the factory run? I recommend a Linux VM on the Mac first.
- **Q5** First harness interface? I recommend the dashboard panel, then a native app. Do you need Spanish and English voice from day one?
- **Q6** When should the harness ask first? Read-only actions run freely, one confirmation card per run, and owner acts are only ever prepared. Should runs under a W19 lease skip the card?
- **Q7** Is my list of things the local model must recognize complete?
- **Q8** First project: AWSF or Smart Health?

New:
- **Q9** v2 refused background processes twice. Is a harness you launch yourself and keep in the foreground OK (like `awsf dash`), with monitoring done when you open it or by external CI? I recommend yes.
- **Q10** Should we amend "quota is a readout, never a router" so a route policy chooses within limits you approve, logged and failing closed? I recommend yes.
- **Q11** Does landing stay human-only through v3? I recommend yes.
- **Q12** For the user-testing validator: scripted browser checks generated from the acceptance criteria first, and an agent driving the app second?
- **Q13** Should AWSF's own code changes go through the factory by default, with direct sessions as the logged exception?
- **Q14** A light planning tier for small changes, and closed v2 specs archived out of the priming path?
- **Q15** Rebase W19 now and finish M3–M4? I recommend yes. The 29/28 drift only grows.
- **Q16** What counts as "deployed" for Smart Health, and who presses the button?

Judge v3 first by the share of your own code that ships through AWSF. That number is 8% today, and most of the other KPIs above improve when it does.

### Codes used above, defined earlier in the brainstorm

The assessment refers to codes defined in earlier turns of the same
brainstorm. They are restated here so this file stands on its own.

| Code | Meaning |
|---|---|
| L1 | AWSF code owns the procedure: lifecycle, preflight refusals, and the valid next steps in each state |
| L2 | Decisions: Jev, through W19's decision service, picks among valid steps at routine stops |
| L3 | The conversational driver: talks with the owner, captures asks, fills command arguments. Sol first, a local fine-tune later |
| L4 | Frontier models (Opus, Sol) called through their official CLIs for planning and diagnosis |
| K1 | The DRAFT→PREPARED step refuses without a driver preflight record: suite green at HEAD, write boundary covered, grant present for protected paths, native Git storage, no duplicate task, the four-line request with named paths confirmed, prior attempts consulted |
| K2 | `awsf next --json`: the legal next steps and who may take each, from `LEGAL_EDGES` and `OWNER_ACTS`, replacing the prose `nextAction` |
| K3 | Each turn, the driver's output must match a JSON schema that only allows legal driver steps. Owner acts are never in it |
| K4 | Confirm first: read-only actions run, a state change shows the parsed intent and waits for a yes, low confidence hands back to the owner |
| K5 | A trap suite on the stub adapter. Every historical stop becomes a trap that must be refused before any provider call |
| F15 | A minimal `claude -p` profile (`--restricted --strict-mcp-config --disable-slash-commands --tools "" --system-prompt …`) kept the subscription login and cut loaded context from 20,897 to 1,215 tokens. This is the "lean delegation profile" |
| F17 | The guard's `ownerActViolation` matches `awsf land` but not `npm run awsf --silent -- land`, the documented spelling. No Marimba-marked session has used it so far |
| A10 | Make the guard also match the `npm run awsf [--silent] --` spellings, with test cases for each |
| A12 | A `driver` attribution cause, a reason on `awsf cancel`, causes for cancelled attempts, then an owner backfill from the forensics draft |
| A14 | The dashboard reads the session archive, so a driving session shows every compaction cycle |
| D1 | Keep Jev for W19. Compare the OpenAI Decisions API side by side once it has a price and docs |
| R6 | AWSF's sandbox broker is bwrap-only, so a macOS host needs a Linux VM or a Seatbelt port |
| S1–S6, N1–N10, X1–X15 | Defined in this file |

Supporting material is machine-local and not committed. The session archive
and its report are in `~/marimba-lab/corpus`. A draft cause for every stopped
attempt is in `~/marimba-lab/forensics/2026-10-01-stops.md`.

---

## Questionables: recommendations and alternatives

Q1 and Q2 are decided. Q3–Q16 are open.

### Q1. Where does training data for a local model come from? (decided 2026-10-01)

- **Decision:** keep Sol and Opus output out of the training data. Use owner
  messages, tool results, owner confirmations, episodes generated by the stub
  gym, and an open-weights teacher.
- **Alternative A:** distill from frontier transcripts. More data now, but
  OpenAI's and Anthropic's terms forbid using output to build competing
  models, and losing either account would stop the factory.
- **Alternative B:** pay for frontier labels under an agreement that permits
  it. Costly, and still bound by the provider's terms.

### Q2. What compute runs the local model and its training? (decided 2026-10-01)

- **Decision:** buy a MacBook Pro M5 (about 64 GB, 1–2 TB, not final). Rented
  GPUs and hosted inference are acceptable for particular cases.
- **Alternative A:** rent only. No upfront cost, pay per experiment, nothing
  runs offline.
- **Alternative B:** a desktop GPU box. More VRAM per dollar and the CUDA
  ecosystem, but not portable.

### Q3. Which Mac?

- **Recommendation:** M5 Max with 128 GB. It has 614 GB/s of bandwidth, can host
  the 122B-A10B teacher (about 75 GB at 4-bit), and runs GRPO rollouts about
  twice as fast as the M5 Pro. That keeps training off paid compute, which
  subscriptions-first favors.
- **Alternative A:** M5 Pro with 64 GB (from $2,199 before the memory upgrade).
  Enough for the local model, LoRA training and speech-to-text. GRPO and a large
  teacher go to rented or hosted compute.
- **Alternative B:** M5 Max with 64 GB. The bandwidth, without room for the
  large teacher.

### Q4. Where does the factory run once the Mac arrives?

- **Recommendation:** in a Linux VM on the Mac. That keeps the bwrap sandbox
  semantics and removes the Windows-drive traps.
- **Alternative A:** port the sandbox to macOS Seatbelt. Native speed, but a new
  security surface to verify.
- **Alternative B:** keep the factory on the Windows laptop and use the Mac only
  for models. The Windows-drive friction stays, and a network hop is added.

### Q5. What is the harness's first interface?

- **Recommendation:** a Marimba panel in the AWSF dashboard, then a native macOS
  app (orb, hotkey, voice). Start with text, and add local Spanish/English
  speech-to-text in the native-app milestone.
- **Alternative A:** a terminal interface first. Fastest to build, least new.
- **Alternative B:** the native app first. Best experience, most new code.

### Q6. When does the harness ask before acting?

- **Recommendation:** read-only actions run freely. One confirmation card per
  run (`new` + `start` + `run`, with route and estimated calls). Owner acts are
  only ever prepared, never executed.
- **Alternative A:** confirm every state change. Safest, slowest.
- **Alternative B:** under a W19 lease, skip the card for runs within the lease's
  bounds. Faster, and relies on leases.

### Q7. What must the local model recognize? (also the label set for training)

- **Recommendation:** capture an idea, ask for a plan, launch a run, status or
  explanation, recover a blocked run, prepare an owner act, quota or routes,
  handoff, chat.
- **Alternative A:** a coarser set of five (talk, plan, run, status, recover).
  Easier to label, less precise.
- **Alternative B:** one intent per `awsf` command. Precise, but needs many more
  labels.

### Q8. Which project comes first?

- **Recommendation:** prove the driver checks and the harness on AWSF itself,
  where the session archive, traps and tests already exist. Make Smart Health the
  first target for readiness checks (X11) and deploy (X13).
- **Alternative:** Smart Health first. It's the priority project with real
  product pressure, but it has less captured data and fewer known traps.

### Q9. May the harness be a long-running process?

- **Recommendation:** allow a harness you launch yourself and keep in the
  foreground, like `awsf dash`. Keep the rule against unattended background
  daemons. Monitoring runs when you open the harness, or in external CI.
- **Alternative A:** allow a supervised background daemon with a kill switch.
  Enables real-time monitoring and alerts, but reverses a decision v2 made
  twice.
- **Alternative B:** no persistent process. The harness is a CLI invoked once per
  message. Simplest, with no live state held between messages.

### Q10. May routing choose models automatically?

- **Recommendation:** amend v2 decision 5. A route policy (task class, route
  metrics, quota windows) chooses within limits you approve. It logs every
  choice, fails closed, and never spends on an API outside a lease.
- **Alternative A:** keep "quota is a readout, never a router". Routes stay
  manual, with advisory metrics only (today's W18).
- **Alternative B:** a fully automatic router like Factory's: cheapest model above
  a threshold, upgrading on failure, with no owner-set limits.

### Q11. Does landing stay human-only?

- **Recommendation:** yes, through v3, as invariant 13 already says for the
  Delegate.
- **Alternative A:** auto-land low-risk tiers (docs-only or T0) under a lease,
  after a measured record such as 50 decisions in a row matching yours.
- **Alternative B:** auto-land with a revert window.

### Q12. How deep does the user-testing validator go?

- **Recommendation:** start with scripted browser checks generated from the
  acceptance criteria, run against the preview build. They're deterministic and
  cheap. Add an agent that drives the app for exploratory checks second.
- **Alternative A:** an agent driving the app from the start. Closest to the
  talk, but costlier and harder to reproduce.
- **Alternative B:** keep your journey attestation as the only black-box check.

### Q13. Should AWSF's own code go through the factory by default?

- **Recommendation:** yes. Direct sessions remain a logged exception, and the
  target is at least 50% of code commits through the factory.
- **Alternative A:** keep direct sessions as the default and use the factory
  selectively. Faster now, but the factory learns slower.
- **Alternative B:** factory only, for all code. The purest option, but it blocks
  urgent fixes when the factory itself is broken.

### Q14. How heavy should planning be?

- **Recommendation:** add a light tier (ticket only, no deep plan) for small
  changes. Archive closed v2 specs out of the priming path, and generate
  reference docs from code.
- **Alternative A:** keep full deep plans for everything. Maximum rigor, with
  today's overhead (specs 92.8k lines vs 56.4k of `core/src`).
- **Alternative B:** drop deep plans in v3. Fast, but it loses the
  acceptance-criteria spine that S1 depends on.

### Q15. What happens to W19 now?

- **Recommendation:** rebase W19 onto `main` now and finish M3–M4 (leases and
  Delegate acts) as planned. Then move M5 → X7, M6/M7 → X9 and M8 → X10.
- **Alternative A:** merge M1–M2 now and freeze the rest until X5's deep plan.
- **Alternative B:** finish all of W19 under v2 before starting v3. The longest
  delay to v3.

### Q16. What counts as "deployed" for Smart Health, and who presses the button?

- **Recommendation:** the factory produces a reproducible build and publishes it
  to a staging channel (for example a store test track or a staging backend).
  Release to production stays an owner act, like landing.
- **Alternative A:** production deploy as an owner act with no staging step.
- **Alternative B:** automated staging and production under a lease, after a
  measured record.
