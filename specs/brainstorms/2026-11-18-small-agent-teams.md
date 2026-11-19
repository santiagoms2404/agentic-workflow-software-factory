# Small agent teams brainstorm, 2026-11-18

**Status:** brainstorm record. Nothing in this file is a rule. A rule changes only by an owner commit through gate GA of `specs/awsf-v3-plan.html`.

**Written:** 2026-11-19, in a direct session with the owner, after the owner said the vision is captured. **To resume work, read sections 2 and 10 first.**

**Follows:** `specs/brainstorms/2026-11-09-liquid-software.md`, closed by D36. This round is recorded as its own file rather than reopening that one (Q58). The codes C6+, G12+ and Q47+ continue its series. K, F, RT, RD, V, P and SF are new here.

**Source:** IndyDevDan, "Fable 5.2 is CRACKED but THIS goes BEYOND THE MODEL", <https://youtu.be/hYIymEMB9x4>. The full transcript came from the video's YouTube captions, and 65 frames were taken from the video. A frame is cited by its timestamp, so frame 1928 is 19:28. Neither the transcript nor the frames are stored in this repository.

**Design reference:** the Marimba Harness Panel canvas, version 27 (private to the owner, linked from the 2026-11-09 record). The owner ruled on 2026-11-19 that the canvas is settled except for the three frames of P1. It settles once those are drawn (Q63).

## How to read this

The codes are the ones used in the conversation.

| Code | Meaning |
| --- | --- |
| Q | a question, with the owner's ruling in section 2 |
| K | a correction to the source package, checked against the transcript and frames |
| C | conflict between the vision and what is decided |
| F | a freedom a team member may or may not have |
| RT | how routing works today, read from the code |
| RD | a change that per-ticket routing needs |
| V | a finding on GPT-6.2 |
| G | gap: something the vision leaves out |
| P | planned step |
| SF | a feature visible in the frames that the plan does not yet cover |

## 1. The idea

The video shows a small team of agents working one job together. A Lead runs the team. Each member owns a lane, such as contracts, pipeline or quality. They talk in a shared room, challenge each other in rounds, and tune their own settings. The Lead turns the questions only the engineer can answer into cards.

Here the idea is named **Orquesta** (Q56). It is the owner's `orchestrate` skill (a driver, workers in Herdr panes, a verifier, routing per task class against a quota ledger) brought inside the factory's gates. Per-ticket routing by weight class came up in the same round and is recorded in section 7.

## 2. Rulings

### 2026-11-18

| Q | Ruling |
| --- | --- |
| Q47 | Keep D31 to D34: one factory and one journal, with the host decided by A11 and AB1 to AB6. The teams workflow runs wherever the factory runs. If the 8 GB laptop cannot run parallel members, D34 already moves the factory to the Mac, with no new decision needed. |
| Q48 | Freedom by rung of the cost ladder (section 6), sharpened in one way. A change that narrows (a lower grade, less effort, a smaller context) applies without a card. A change that widens needs bounds or a card. |
| Q49 | The first team plans: an author, a grounding reviewer and a readiness reviewer. It produces documents the owner commits. A12's backtest tells whether a review lens earns its cost. |
| Q50 | In a planning team, instructions come from three sources: the owner, the ticket, and the Lead's brief, journaled and kept inside the ticket's scope. A member's message is data. A mention asks for an answer from the mentioned member's lane, and never for wider scope or writes. A building team, later, is a star: members speak only to the Lead. |
| Q51 | Marimba is Lead-only inside the factory, with a trimmed tool set: driver and team acts, no write tools (frame 2604). Direct sessions stay outside the factory until the planning team replaces them. |
| Q52 | A ticket carries a weight class, never a model name: SOTA (S+, S), workhorse (A, B) or lightweight (C, D), on the grade ladder from the videos (frames 0423 and 2140). The owner writes the map from grade to route in `awsf.config.yaml`, so models are re-ranked without a plan-and-ticket commit. The grades are defined for software and agentic work, and the factory's route metrics feed the ranking over time (X6): measured, not guessed. `--route` overrides one ticket for one attempt. One builder provider per shift. A plan that needs both providers is split into one shift per provider, in `depends_on` order. |
| Q53 | Right after T15, one light-tier ticket (`specs/tickets/Tnn.md`): `--route` may name a shift ticket, and the confirmation shows each ticket's route. W06's first milestone follows in spine order. |
| Q54 | Cost is shown as a share of each subscription window (5-hour and weekly), per run and per phase, computed from measured tokens and labelled as an estimate. Dollars appear only on the OpenRouter route, the one that bills. |
| Q55 | The cloud Marimba and extra providers stay outside the team until an inversion rule for N providers passes (P6). The cloud Marimba keeps the handoff channel. |
| Q56 | The name is Orquesta. |
| Q57 | Draw all three surfaces: the phase view, the shift view and the team view. Build them in that order. |
| Q58 | Record this round when the owner says the vision is captured. Push `373c53b` after the owner reads its diff. |

### 2026-11-19

| Item | Ruling |
| --- | --- |
| Push | `373c53b` was pushed after the owner read the diff. The machine specifications in it stay, because they are the basis of D34 and the 8 GB judgment. |
| SF14 | Folded into section 6 and K1, with invariant 13. The brief's grant is scoped to one task, covers settings already built, and allows no new code. |
| SF24 | The mission template is recorded against I6: one mission note per project, changed only by owner commit. |
| SF3, SF5, SF17, SF20 | Noted for the team-view and room design. No decision yet. |
| C16 | Decided when the team view is drawn. |
| Capture | The owner said the vision is captured. This file is the record. |
| Q63 | The canvas is settled except for the three P1 frames. Draw them first, then settle once and re-freeze the frame index once (A8, G7). |

## 3. Corrections to the source package

The transcript summary is accurate in the main. These details change the design.

| Code | Correction | Evidence |
| --- | --- | --- |
| K1 | Round 3 ended in two lists. List A was applied by the Lead: name, grade, thinking, extensions and subagent budgets. List B was applied by each member to itself and read back: nav bars, tool-summary cadence and, for one member, compaction thresholds, which are a context setting. The grade and thinking changes were the members' own proposals, including one member's downgrade to Workhorse B at medium. The members asked the Lead to apply them ("please apply thinking xhigh for me"). The narration credits the members, but the frames show the Lead applying the changes through `team_settings` ("Changed Member 1's…"). Its power to apply them came from the engineer's brief for that one discussion (SF14), a grant with the shape of invariant 13's lease (section 6). | frames 1928, 2017, 2031, 2046, 2052, 2127, 2135; transcript 21:22 |
| K2 | The only prompt item shown as reserved is the mission section: "the mission section of each system prompt is still the blank template. Leave it as is." The Lead gives its reason in general terms: "prompt changes are the engineer's call". The video shows no other prompt change, either allowed or refused. Section 6's reservation rests on rung 3 of the cost ladder, not on this frame. | frames 2337, 2135 |
| K3 | The video's grades are dollar tiers mapped to OpenRouter models. The ladder has six grades: SOTA S+ and S, workhorse A and B, lightweight C and D, from $8/$40 down to $0.01/$0.50 per million tokens. The tier list in frame 0423 ranks named models into those grades and is marked as run by a factory. The owner's routes are subscriptions, and AWSF's pricing never shows a dollar figure for them. So cost shows here as a share of each quota window (Q54). | frames 0423, 0803, 2140, `core/src/config/schema.ts` PricingSchema |
| K4 | The Lead overruled the members' agreement on thinking levels ("my ruling", "the engineer can overrule it"). It closed with process notes for next time, including a tie-break rule. | frame 2052 |
| K5 | A dismissal stops the asking, not the owner's access. The Lead read the dismissals as "don't send these", and the engineer had it present them again. | transcript 23:35, frame 1912 |
| K6 | "Quiet unless mentioned" is not a Marimba-to-Marimba rule. Section 19 of the 2026-11-09 record says "data until the owner confirms". The mention rule comes from the video. | the 2026-11-09 record |
| K7 | The Lead catches up every minute on a cron job. That is a resident timer. | transcript 18:39 |
| K8 | Budgets and safety-check rules are not cards, because they "need your own words". One card shows a third form: a yes/no card where "no means you give other numbers". | frames 2456, 2536 |
| K9 | The "durable yes or no" drawing (Build, Prove, You, Merge) is the order AWSF already enforces: gates prove, the owner lands. There is nothing to adopt beyond the picture. | frame 2455 |

## 4. Conflicts with what is decided

| Code | The vision says | What is decided | Resolution |
| --- | --- | --- | --- |
| C6 | The teams workflow runs on the Mac. The current laptop gets another purpose, and work delegates between machines. | D31: one factory and one journal on an always-on Linux box, with the Mac as a dashboard client. D32: no second orchestrator. D34: the laptop earns the host role through AB1 to AB6, or decision 3 holds (AWSF in a VM on the Mac). | One factory (Q47). If parallel members fail AB4 at 8 GB, that is evidence for decision 3, with the laptop used as AU2 to AU4. |
| C7 | Team agents configure their own settings. | E4 and decision 14: generated work never rewrites the controls that authorize it. Routing may change only model, effort and adapter (`RolePolicy`, `core/src/workflow/phase-routing.ts:44`). `awsf.config.yaml` is a protected path. | Freedom by rung (section 6). |
| C8 | "Anything you can do, your lead agent can do on your behalf" (20:16). | Invariant 13: the Delegate never lands, publishes, attests or grants. Decision 4: landing is human-only. D7 and D11: owner buttons are signed. | Parity holds for the view and driver classes. The owner class keeps its own door. |
| C9 | The team works around the clock, and the Lead wakes every minute. | Decision 6: no unattended daemon. D15 and D26: routines run under a lease, and only while the dashboard is open. D33: a run the owner started may finish. | A team run the owner starts may finish. A Lead that wakes itself is a routine, so it needs a lease and an open dashboard. Reaching the owner while away needs G8 and W14. |
| C10 | Members render arbitrary HTML pages (12:42). | D1 (never a page), D6 (recipe or program), NR1 to NR5. G6: the dashboard's CSP refuses program teclas. | A member's report is an envelope in the journal, shown by a recipe. No free-form HTML in the first version. |
| C11 | The cloud Marimba joins the team. | Section 19 of the 2026-11-09 record: the cloud Marimba never reads the journal directly, and its channel is files in git through the owner's commit. | It stays outside the team (Q55). |
| C12 | More models join the team: Google, free agents, more providers. | Review inversion needs exactly two distinct providers (`providerPairFrom`, `core/src/workflow/review-routing.ts:51`). A reviewed workflow refuses build phases on two providers (`reviewWorkerProvider`, `core/src/workflow/compiler.ts:223`). | A third provider needs an inversion rule for N providers, passed through GA. Free endpoints never receive a private repository. |
| C13 | A cheap model writes the tool summary. | D16 (I7): step summaries come from a template, and the model fallback is parked. | Keep the template. |
| C14 | W04 starts inside the new workflow, and the brainstorm continues. | D36 closed the brainstorm. Section 13 of the 2026-11-09 record sets the order, with T15 first. The teams workflow needs W04's session record, W05's leases, W06's routing and W08's panel. | This record. W04 is authored the existing way, and a later deep plan serves as the workflow's acceptance test (P4). |
| C15 | The Lead tunes members while they run. | An attempt records its configuration, and rework and review refuse when it changes (header of `core/src/workflow/route-flags.ts`). | A setting change applies at the next attempt, never mid-attempt. |
| C16 | Each member wears its own accent tint, and one member argued for an amber accent because its lane is "work in motion" (frames 1022, 2000). | The canvas palette has one accent, orange, kept for what spends and what waits on the owner. Kinds are told apart by shape and fill. D28 gives each project a theme. | Open until the team view is drawn. The proposal: show a lane's identity by its name, list label and shape, never by a new accent colour. |

## 5. Tensions answered

- **Lead-only or dual.** Inside the factory, Marimba is already shaped like a Lead: it drives, and the phases build. It is Lead-only in the teams workflow (Q51).
- **Parallel or one at a time.** Planning members can run in parallel, because they produce documents and land nothing. Building members in parallel collide at landing: land is fast-forward only, and a new attempt cannot start on top of a candidate that has not landed. So building stays serial within one repository. Whether parallel planning fits in 8 GB is unmeasured.
- **Free-form pages or teclas.** Teclas, for the reasons in C10.
- **The waterfall.** Keep it. A workflow earns its own view when its phases repeat (shift), compare (prove) or produce a document (plan-author). The other workflows keep the generic waterfall. The redesigned phase view comes first, because every workflow uses it.
- **Which decisions are cards.** Three forms: a pick-one card, a yes/no card that falls back to the owner's words (K8), and items that are not cards because they need the owner's own words. Cards are questionables (D27), not owner acts. Owner acts stay signed presses (W17). A dismissal is recorded, and the owner can recall it (K5).

## 6. The freedom boundary

**Rule (Q48).** A member does itself what costs rung 0. It proposes what costs rung 2, and the Lead applies it within the owner's bounds, at the next attempt. It flags what costs rung 3 and nothing more. It never takes an owner act. The rule rests on the cost ladder (section 1 of the 2026-11-09 record), not on the video.

**The Lead's grant (SF14).** The Lead applies a member's settings only under a grant in the owner's brief for that task. The grant covers settings that are already built and no new code, and it ends with the task. In the video the brief said: "then you can directly make requested factory configuration settings that are already built out, don't code anything new" (frame 1928). That is the shape of invariant 13's lease: granted by the owner, scoped to one task, revocable, and named in the task. Without a grant, the member's proposal waits for the owner.

| Code | Freedom | In the video | Here | Why |
| --- | --- | --- | --- | --- |
| F1 | Read the whole room | yes | yes, within the run's project scope | AM4 scope check |
| F2 | Speak only when mentioned | yes | yes | It is also the main token saver. |
| F3 | Message another member | yes | yes, as data (Q50) | A mention asks for an answer from the member's lane. It never widens scope or writes. |
| F4 | Challenge the Lead or another member | yes | yes in a planning team. In a building team, only through the review phase. | In planning, the challenge is the review. |
| F5 | Change its own view settings | yes, list B | yes, self-applied and journaled | rung 0 |
| F6 | Propose its own grade, effort or context, including a downgrade | proposed by the member, applied by the Lead (K1) | yes. The Lead applies it at the next attempt, under the owner's grant for that task. A narrowing change applies without a card. A widening change needs W06's bounds or a card. | rung 2 |
| F7 | Change its own prompt, tools or writes | no | no. It may flag. The Lead prepares the diff (FL7), and the owner commits it. | rung 3, C7 |
| F8 | Choose its lane | proposed in round 1 | It may propose. A lane is a role in `awsf.config.yaml`, so a new lane is an owner commit. Assigning tickets to existing lanes is the Lead's routing. | rung 3 |
| F9 | Ask the owner | through the Lead | through the Lead, as cards. Budgets and rule text are never cards. | K8 |
| F10 | Start subagents | yes | No more than the role's tool profile allows today. | least privilege |
| F11 | Work while the owner is away | yes | Runs the owner started may finish. Self-waking needs a lease. | C9 |
| F12 | Commit, land, publish, grant, lease, attest, attribute | partly, through parity | never | invariants 8 and 13, decision 4 |

**The reservation.** The owner keeps prompts, tools, writes, lanes, the bounds, and the text of the room's own conversation contract, because that contract is a prompt. Grades inside the bounds are not reserved. This rests on rung 3 of the cost ladder. The video shows only the mission section reserved (K2).

## 7. Routing

### How routing works today

| Code | Fact | Where |
| --- | --- | --- |
| RT1 | Routes resolve in three layers, field by field: the role's default, then `routing.phase_routes.<phase>`, then `--route` at `awsf new`. Every field records its source (`agent-default`, `phase-override`, `attempt-override`) and its requested, effective and observed values. | `core/src/workflow/phase-routing.ts:86`, `core/src/contracts/route-selection.ts` |
| RT2 | This repository uses layer 1 only. `routing` has no `phase_routes`, and `pricing.models` is empty. | `awsf.config.yaml:33` |
| RT3 | Each ticket in a shift compiles to a `tNN-build` phase that is routed as the role `builder`. The loader and the flag parser refuse every key that is not a role id. So every ticket in a shift gets one builder route. | `phase-routing.ts:97`, `core/src/config/load.ts:237`, `route-flags.ts:85` |
| RT4 | Review inverts the provider by default and needs exactly two providers. The shift review refuses build phases on two providers. It accepts different models on one provider. | `review-routing.ts:51`, `compiler.ts:223` |
| RT5 | Risk tiers T0 to T2 come from path globs. They set the call ceiling and admission, not the route. A shift is at least T2, and v3 tickets declare no tier. | `core/src/policy/risk.ts`, `core/src/workflow/shift/compile.ts:38` |
| RT6 | The role-policy guard: routing may change model, effort and adapter or provider only. Prompt, tools, writes and continuity stay with the role. Review refuses a route that changed them. | `phase-routing.ts:44`, `core/src/cli/commands/review-phase.ts:506` |
| RT7 | Fenced on purpose: `no_fallback: true`. Quota never decides the inversion. Same-provider review needs the owner's `degrade-review`. Evaluation evidence is dropped when a route changes. | `schema.ts` RoutingSchema, `phase-routing.ts` |
| RT8 | Planned and not built: v3 W06, "Routing within subscriptions". Task class, W18's metrics and quota windows feed a route policy the owner approves. Its Q3 is decided: bounds per task class per provider window, plus a daily ceiling. No deep plan exists yet. W18's metrics and advisory are on main. | `specs/awsf-v3-plan.html` W06 |

### What per-ticket routing needs

| Code | Change |
| --- | --- |
| RD1 | **The signal:** a weight-class grade on each ticket (Q52). The plan author writes it, and the owner approves it with the plan. A grade names a class, never a model. The risk tier cannot serve, because it measures blast radius, not weight. A classifier at run time would spend a call to guess. |
| RD2 | **The map:** the tier list (grade to route) lives in `awsf.config.yaml`, written by the owner through GA. Re-ranking models changes only the config. Over time, W18's route metrics feed the ranking (X6). The Routes frame names the models (D22). |
| RD3 | **The lookup for a `tNN-build` phase:** `--route tNN=` wins, then the route the ticket's grade maps to, then `phase_routes.builder`, then the role's default. The resolver already reads an exact phase-id key before the role key (`phase-routing.ts:98`, `:100`). Only the flag parser refuses it (`route-flags.ts:85`), so the `--route` half is one small ticket (Q53). The grade half touches the ticket frontmatter vocabulary (and so invariant 12's fence), the loader's and the flag's allowed keys, and the shift compiler. |
| RD4 | **One builder provider per shift.** The code already enforces this (RT4). Grades vary model and effort within one provider. Mixing providers in one shift needs a rule change. |
| RD5 | **The control surface:** the confirmation shows each ticket's grade and route, and the window share it spends. No route was found in the preflight fields (`core/src/preflight/*.ts`). Check this before relying on it. |
| RD6 | **The prompt guard stays.** To control the system prompt per task, the owner picks the lane, which is the role. The ticket body is the per-task prompt (PS3). |

### Verdict

- **Direction:** right. It is W06 with a smaller first step.
- **Worth it:** probably. Plus quota is the binding limit, and every ticket runs `gpt-6-sol@xhigh` today. Unmeasured: how many tickets would land on a cheaper grade. Measure that first, from per-ticket builder tokens and outcomes in past shifts.
- **The efficient version** is RD1 to RD6, about four tickets, as W06's first milestone. It does not widen autonomy, because the owner confirms every grade, so it need not wait for GR.
- **Not to build:** a difficulty classifier at run time, an automatic upgrade after a failure (which is a fallback), model changes in the middle of an attempt, dollars on subscription routes, system prompts per ticket, the video's OpenRouter grade stack, or a model catalogue in the repository.

A lane is a role: prompt, tools, writes. A grade is a route: model and effort. The Lead assigns lanes and proposes grades, and the owner confirms them. Grades change between attempts (C15). The teams picture and the routing design agree on "grades, not names".

## 8. GPT-6.2 for teclas

| Code | Finding |
| --- | --- |
| V1 | **Reachable only through OpenRouter, which bills per token.** On 2026-11-19, after pi was updated from 0.87.1 to 1.5.2, `pi --list-models` lists `openai/gpt-6.2-sol` and `openai/gpt-6.2-astra` (each also as `-pro` and `:batch`) under `openrouter`. Under `openai-codex`, the subscription route, there is still no 6.2: the newest is `gpt-6.1-sol`, with `gpt-6.1-terra`, `gpt-6-sol`, `gpt-6-luna` and `gpt-6-astra`. pi 0.87.1 listed 6.2 under no provider. A build on the OpenRouter route would be a third provider for review inversion (C12). Whether the factory's pi-codex adapter runs unchanged under pi 1.5.2 is unchecked. |
| V2 | **A recipe tecla runs no code (D6).** Making one means choosing blocks and routes, so an HTML skill does not help. |
| V3 | **An HTML skill helps where HTML gets written:** the trusted block library and tuned teclas, which are factory build tickets in `dashboard/`, and program teclas later, after G6 and AM6. |
| V4 | **A weak ask-or-proceed judgment** is acceptable in a builder, which never asks. It is wrong for a Lead, a driver or a planner. |
| V5 | **When 6.2 reaches the subscription route:** add a "visual" grade for UI tickets, and measure it against `gpt-6-sol` on the same UI ticket with a prove replay pair. The Plus quota is shared with every build. Until then, a measurement through OpenRouter costs money per token. |

## 9. What the vision leaves out

| Code | Gap |
| --- | --- |
| G12 | **No measure of success.** Proposed: a teams run against the existing workflow on the same request, comparing land rate, owner minutes and the window share spent. |
| G13 | **Concurrency.** Unverified whether the lifecycle admits two attempts in one repository at the same time. Landing is fast-forward only. |
| G14 | **The room as a record:** format, scope and retention. It must be journal records (invariants 1 and 10), owned by W04 and W08. SF5 shows the record's shape. |
| G15 | **Who may instruct whom inside a room.** Answered for planning teams by Q50. |
| G16 | **A team budget.** Teams buy speed with tokens: 75 agent-minutes against 60 (frame 0320). That needs a lease with a daily ceiling (W05, W06 Q3). |
| G17 | **Failure.** A member stalls, the Lead's window runs out mid-round, or the owner presses Stop (G4). |
| G18 | **Reaching the owner while away** needs G8 and W14. |
| G19 | **Traps.** Each new freedom gets a trap in W02's suite before it is switched on. |
| G20 | **No spine workstream owns this.** Proposed: fold it into existing ones, with no new workstream. Routing goes to W06. The run screen and phase view go to W08. Rooms and the team view go to W08 and W16. The planning team goes to the plan-author workflow plus D35's review lenses. |

## 10. Planned

| Code | Step | Waits on |
| --- | --- | --- |
| P0 | Record this round. Done by this file. | |
| P1 | Three canvas frames, with nothing built. A phase view showing the core four plus route provenance, evidence and window share. A shift view with one lane per ticket and its grade. A team room with tabs for the Lead, the members and the cards. Then the canvas settles (Q63), and A8 re-freezes the frame index once. | nothing |
| P2 | Routing, in two steps. First, the light-tier ticket of Q53. Second, W06's first milestone: RD1 to RD6, in spine order. Independent of the teams vision. | T15, then W06 in spine order |
| P3 | The run screen: the phase view first, then the shift view. The data is already journaled (route provenance, compiled prompt, usage), and `dashboard/src/components/PhaseInspector.vue` already shows compiled prompts. A W08 milestone. | W08's deep plan |
| P4 | **Orquesta v0, a planning team.** A compiled workflow beside plan-author, with an author, a grounding reviewer and a readiness reviewer (D35's lenses). The protocol: propose, challenge, rule, then the owner answers the cards. Output goes to the session only, and the owner commits. Acceptance (GP2): it authors a real deep plan, compared with W04 authored the existing way. | A12 shows the review earns its cost |
| P5 | A building team. Serial within each repository, and perhaps never parallel on the 8 GB laptop. | P4, W05, W06 |
| P6 | More providers. The Antigravity adapter stays disabled until then. Free endpoints never receive a private repository. | an inversion rule for N providers, through GA |

The order of work in section 13 of the 2026-11-09 record still holds, with T15 first. P1 runs beside it, because it builds nothing.

## 11. Features in the frames not yet planned

From a pass over all 65 frames. Features already handled above are left out: the context bar (frames 0805, 1310), the tool summary (2347, C13), cost today (Q54), per-member jobs (2127, D15), the parity diagram (2043, C8) and the yes/no gate (2455, K9).

| Code | Feature | Frames | Where it would land |
| --- | --- | --- | --- |
| SF1 | Each agent sets its own status with a note: working, waiting, needs-engineer (with a count, "2 of 9") or done. The header shows it. | 0955, 1219, 2510, 2519 | Run and phase states, and "Waiting on you" (I3). The note is new. |
| SF2 | A header activity line: the incoming queue ("From Member 2 in C-1 · 1 queued"), the Lead's state ("Answering you"), and the next job's countdown ("Team catch-up in 31s"). | 0735, 0955, 1201 | The strip (frame 17). |
| SF3 | The composer shows who a message will reach before it is sent ("Reaches: Lead, Member 1, … everyone in it"), with a mention picker and "Post as" the owner's name. | 0955, 1215 | The team room. The audience is visible, which supports Q50. |
| SF4 | The composer's mode follows the agent's state: "Message the agent" when idle, and "Steer the current run" or "Queue a message for after this run" when busy. Each member chose queue or steer for its lane ("a steer can derail a running failure drill"). | 0955, 2000, 2328 | Busy behaviour per lane. |
| SF5 | The room record: an id (C-1 to C-8), a kind (group or direct), participants, state, message count, last message and age. Rename, Close and Archive. Archiving takes a room off the Lead's list, and a new message brings it back. Search covers titles, summaries and messages. | 1009, 1324, 1337 | G14: the shape of the room record. |
| SF6 | A message never blocks its sender, and every room is a thread in the Lead's list, "so the Lead always knows the state". | 1140 | Rooms in the journal (G14). |
| SF7 | Reference chips: each reply links to the member's work item, and the Lead's chat links back to the room message ("From Member 3 in C-1"). | 0955, 1226 | D17: every line is read from a record. |
| SF8 | Restraint is stated in the trace: "I sent no reply, since none was needed". | 0956, 2328 | F2, made visible. |
| SF9 | The brief's shape: the task, constraint bullets, and a definition of done ("reply here with one line and a ref to your page"). | 1215 | The ticket's shape, and the planning team's brief. |
| SF10 | The round brief: "Round 2 of 3: challenge and settle", numbered prompts, and a required "one challenge" to another member's proposal. | 1947 | P4's protocol. |
| SF11 | Lanes are negotiated as ownership: one member owns the signing code, another the storage contract it signs against. One owns the pipeline metrics, another only reads them. | 1947, 2000 | `writes` per role. Rung 3, so the owner commits it. |
| SF12 | Tools must justify themselves: "an unused tool adds cost and clutter … keep it only if you name the check it does." | 2000 | The narrowing side of Q48. |
| SF13 | A retrospective closes each discussion: what worked and what to change, such as a tie-break rule, the value format stated up front, and read-only settings shared in round 1. | 2031, 2052 | A lesson record (D17) that feeds the next brief. |
| SF14 | The Lead's power to apply settings came from the engineer's brief for that discussion. | 1928 | Folded into section 6, F6 and K1. |
| SF15 | Every judgment names what it did not check: "I read the page text only, not the rendered diagrams". | 1232, 1332, 1933 | Applies to the Lead's rulings too. |
| SF16 | A correction names its cause: "the page text was clipped at that row when I read it." | 2354 | Self-correction (frames 26, 17a). |
| SF17 | The decision table carries an owner and a state for each decision: working choice, needs research, waits on the engineer's policy, or open. "2 to 4 are working choices, not confirmed: the engineer … can overrule any." | 2354 | Questionables with states. A working choice lets work proceed on the pick, and the owner can overrule it later. |
| SF18 | The Lead holds dependent work until the decisions land ("Do not start it until I send it to you"), then sends them in one batch per member, "one message instead of nine". | 2354, 2510 | Gating and batched delivery for the planning team. |
| SF19 | The card's anatomy: "Decision N of 9", what it blocks, the member's pick with reasons, options with the pick marked, "+ Other", "Pick one" or "Yes or no", a dismiss button and a source chip. Once answered, it shows the choice and the time. A `team_withdraw` tool can retract an ask. | 2501, 2507, 2510, 2536, 2602 | Cards (section 5). Withdrawal matches D24: an item leaves "Waiting on you" when its cause disappears. |
| SF20 | The work product marks its own open items ("Tooling picks 12: 7 settled, 3 choices, 2 open"), and the Lead turns them into cards. | 2328 | FL8: a plan's questionables become cards. |
| SF21 | A thumbs-up or thumbs-down on each block of a page. | 1232, 1255 | Finer than the rating per tecla (frames 21, 24). |
| SF22 | A "Full Model Names" switch: grades by default, model names on request. | 1310 | D22 and Q52 in one switch. |
| SF23 | The Lead runs on SOTA S+ at medium thinking. The members run on Workhorse A at high. | 1022, 1310 | The Lead's grade belongs in the tier list as well (RD2). |
| SF24 | The prompt screen counts tokens: 7.4k across 11 sections, 615 in the custom part. The prompt lists the six ways work reaches an agent: chat, cron, a page button, a durable job, a subagent's report and a team message. The mission section ships with a template: "the one problem this factory solves, who it serves, and what a good day of work looks like." | 0807 | Token weight per section (W06's lean profiles). The mission template is recorded against I6. |
| SF25 | Each member has a name, a list label (Contracts, Pipeline, Quality) and a list of its own. The Lead's list is its conversations. "Every application is a list of something." | 0509, 0916, 2017 | A lane's home view is its list: one tecla per lane. |
| SF26 | Subagent defaults per member: grade, thinking, a dollar budget, minutes and concurrency. | 1952, 2017 | AWSF's equivalent is the call ceiling per tier and raises per attempt. |
| SF27 | Team switcher cards: name, grade, cron count, cost today, state and item count. Keys 1 to 6 open a member, so a team holds up to six agents. | 0800, 0916 | The team view. A size limit worth deciding. |
| SF28 | The tier list itself is the output of a factory job ("Last run 26m ago"). | 0423 | X6: a ranking fed by measurements. |

## 12. Not verified

- Whether the confirmation record shows routes (RD5).
- Concurrency within one repository (G13), and the memory used by parallel members on 8 GB.
- Whether the factory's pi-codex adapter runs unchanged under pi 1.5.2 (V1).
- The name's musical meaning (Q56): "marimba orquesta" as an ensemble the marimba leads was not checked.
