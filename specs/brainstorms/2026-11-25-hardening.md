# Hardening plan, 2026-11-25

**Status:** plan record. Nothing in this file is a rule. A rule changes only by an owner commit through gate GA of `specs/awsf-v3-plan.html`. Rulings authorize no build: each ticket starts as its own run.

**Written:** 2026-11-25, in a direct session with the owner, after W03 closed. The owner ruled Q117 to Q129 as recommended, and then Q130 to Q135, and asked for a plan that takes every improvement of the pyramid evaluation, over the whole codebase, with nothing missed. **To resume work, read sections 1, 2 and 4.**

**Follows:** `specs/brainstorms/2026-11-24-design-contract.md`. The codes K46+, NF28+, IM13+ and Q130+ continue its series. OC is an owner commit.

**Measured:** at `44ff534`, unless a row names a later commit, with the TypeScript compiler's own parser over all 1,095 tracked code files (353 in core/src, 83 in dashboard/src, 5 in dashboard/shared, 3 in docs/driving, 650 tests, 1 other). The four shell files, nine migrations and six style sheets are outside that parser and were not measured. T23 gives them an area. The CI workflow was read. CI is green on that commit.

## 1. The plan in short

1. **Four light tickets come first (T20 to T23), then W04's deep plan.** They make a run safe to start, the suite fast enough, identity fenced, and every fence able to fail.
2. **Seven more light tickets (T24 to T30) fill gaps** between W04's landings, one at a time.
3. **The rest is carried by the plans that touch that code next** (W04, W05, W06, W08, W11, W14), through their tickets' Handoff.
4. **Nothing is tracked by hand.** Every improvement becomes a check that reads the whole codebase from Git on every run, with a list of today's sites that may only shrink. T23 builds that machine.

The order of Q40 stands: A12, W04, W08, W16.

## 2. Rulings

Made on 2026-11-25, all as recommended. Q130 to Q135 were ruled after this record was read, and section 7 keeps their alternatives. Q136 to Q138 came from the first two tickets.

| Code | Question | Ruling |
| --- | --- | --- |
| Q117 | When is the 2,820-line function split? | Its own plan, after W04 and before W06. |
| Q118 | Do layers become lint rules? | Yes: `attempt.ts` first, then the rest over W04 to W08. |
| Q119 | Update the linter and ratchet size and complexity? | Yes, by owner commit. |
| Q120 | Narrow what a worker can read? | Try it on one run first, and decide from what breaks. |
| Q121 | A comment rule? | No ban. No number or path in a comment unless a test derives it, and no comment that excuses a shortcut. |
| Q122 | The small-fix lane | Prepare only, after W14. The owner lands. |
| Q123 | Does each plan task name its cheapest check? | Yes, one line in the plan text. |
| Q124 | Formal checks | An explorer of crash orders in the simulation layer, when W05 starts. |
| Q125 | Does W08's new repository start with the pyramid? | Yes, from its first commit. |
| Q126 | Land T15 as built, or rework? | Landed as built on 2026-11-25. |
| Q127 | When is the ticket digest check added? | Now, before W04 is authored. |
| Q128 | Does preflight refuse an unclean checkout? | Yes, in the same ticket as Q127. |
| Q129 | How do publish and close fit together? | Publish accepts a HEAD that is the candidate plus its own recorded closure commits. A light ticket. |
| Q130 | L10, L16 and L21 | Removed, through GA (OC5). The ids are never reused. |
| Q131 | LC2, LC4 and LC5 | In W04's first milestone. It replaces that part of Q94. |
| Q132 | LC3 | Now, as T23. It replaces that part of Q94. |
| Q133 | The order of the sandbox trial | Reviewers first, then one builder in a third mode. |
| Q134 | The risk map | Tier 2 for the parts of NF28, and the credential patterns become a protected path (OC4). |
| Q135 | The split of the run loop | v3 W18, added by AM8 after AM6 and AM7 (OC6). |
| Q136 | Are the light tickets made visible? | Yes, as T31, after T23. |
| Q137 | T20's review findings: rework or a later ticket? | T20 landed as built. F1 to F4 are T32, before W04's deep plan. |
| Q138 | T21's second acceptance line | Accepted for its purpose: the plan whose bytes changed since its last check is parsed again. No follow-up ticket. |

## 3. Corrections and findings

| Code | Earlier claim | What is true | Evidence |
| --- | --- | --- | --- |
| K46 | IM12: move the credential patterns to `core`. | They cannot simply move. `dashboard/src/delta-fold.ts` runs them in the browser, and no dashboard file imports `core`. The fault is their protection, not their folder (NF28). | import sweep |
| K47 | Three of eight fences show no planted violation. | Six of 53 test files in `core/test/unit/meta`: `dependency-allowlist`, `execution-isolation`, `layer-separation`, `no-write-route`, `planning-isolation`, `readme-reference`. | every test name, and nine files read |
| K48 | IM7's narrow sandbox is untried for workers. | v2 W18 ran 80 reviewer replays in it. A builder cannot run in it as it is: Git finds no repository there, and this repository's Git store lies in the home folder. | `sandbox-broker.ts`, `confinedSpec`. T15's recorded Git path |

| Code | Finding | Evidence |
| --- | --- | --- |
| NF28 | **The risk map covers 18% of `core/src`.** Tier 2 (review and journey) applies to execution, policy, state, persistence and observability. Landing, publishing, closing, the gates, preflight, the Delegate, the decision service, quota, the configuration loader and the credential patterns are tier 1, where no review or journey is required. | `awsf.config.yaml`, `risk.paths`. 13,288 of 73,017 lines |
| NF29 | `registry/plan-admission.ts:302` measures the age of a cached proof with the wall clock. It has LS2's shape, and the earlier sort did not list it. | clock sweep |
| NF30 | Two causes make the plan corpus tests slow, and small changes to both take that file from 294 s to 162 s. The rest grows with the number of plans. | CPU profile, and a trial on a scratch copy with 23 of 23 green |
| NF31 | **68 exported values are read by no production code.** 60 are read only by tests and eight by nobody. Two are in the sandbox rules. | section 6 |
| NF32 | One test of 4,029 calls can never fail, the line budget. None is marked todo or only. | test sweep |
| NF33 | Linter 1.93.0 adds no package beyond its own binary, reports two warnings on today's code, and runs in 1.3 s with the layer and size rules on. | a trial on a scratch copy |
| NF34 | Its check for unhandled promises needs a second package outside invariant 7's list. It stays out. | the rule list, `type_aware` |
| NF35 | Inside an agent session two credential traps fail, because the session's environment holds credential-shaped values. In a clean environment 78 of 78 pass. | two runs on one clone |
| IM13 | Put the parts of NF28 in tier 2, and protect the credential patterns like `core/src/policy`. | Q134 |
| NF36 | No command and no screen shows a light ticket when a catalog is present. `awsf ticket show T20` prints the first plan's T20. | `core/src/cli/main.ts`, `ticketStoreForList`, and the tickets route |

### What T20 and T21 showed

T20 landed as `ff29952` and closed in `7dbe76a`. T21 landed as `e8b471b` and closed in `350d4f9`. The builder of both was `gpt-6.2-sol` at high, on its first two tasks here, and the reviewer was Opus 5.5. Both reviews accepted. Each was checked again by an independent session before the journey.

| Code | Finding | Answer |
| --- | --- | --- |
| F1 of T20, medium | The plan author's ticket check also runs when resume only validates a saved reply, and can seal the attempt. | T32 |
| F2 of T20, low | `ticket new` and `refine` leave a stray DRAFT when the checkout is not clean. | T32 |
| F3 of T20, low | On a fresh run the same check comes after L4, so a ticket edit seals the attempt with no call spent. T20's own acceptance line allowed it. | T32 |
| F4 of T20, low | Two of twelve mutants survive: a missing sealed file, and a rename row in the list of paths. | T32 |
| F1 of T21, low | The parse cache keeps one entry per plan, so checks that alternate between plans parse one more. The result is the same. | Q138 |

Measured for T21: with 44 plans in place of 22, one plan's test grows 2% where the base grew 23%. The unit gate took 319 s, against 423 s in T20's run.

## 4. Order

| Step | What | Who | Codes |
| --- | --- | --- | --- |
| 1 | Push T15's two commits | done 2026-11-25, CI green | |
| 2 | OC0: W03's closing record and Validation rows | done, `d4d56ee` | |
| 3 | OC1: CI runs the trap layer | done, `f1858f7`, 78 of 78 in CI | IM1 |
| 4 | OC3: the plan author names the cheapest check | done, `0de38a2` | Q123 |
| 5 | T20 | done | Q127, Q128 |
| 6 | T21 | done | IM3 |
| 7 | T22 | factory | LC1, LS1, LS2, NF29 |
| 8 | T23 | factory | LC3, K47, invariants 1, 2 and 13 |
| 8a | T32, then T31 | factory | F1 to F4, NF36 |
| 9 | OC4: the risk map and the credential patterns | owner commit through GA, between attempts | IM13 |
| 10 | W04's deep plan, authored through the factory | factory | |
| 11 | OC2: linter and its configuration | owner commit | IM5 |
| 12 | T24 to T30, in any gap | factory | IM2, IM5, IM6, IM12, Q121, DC4, Q113, Q129 |
| 13 | OC5: the three edges and the machine's header | owner commit through GA | IM8, NF25 |
| 14 | OC6: AM8, after AM6 and AM7 | owner commit through GA | Q117 |

A12 writes no code, so it can run beside steps 2 to 9. AM6, AM7 and Q104 keep their place.

Landing is fast-forward only. One light ticket waits at a time, and no plan candidate waits with it.

## 5. Where every improvement lands

Nothing of the evaluation, the October sort or the open questions is left out.

| Code | What | Lands | What keeps it true | Today |
| --- | --- | --- | --- | --- |
| IM1 | CI runs every layer | OC1 | the step itself, and T23 compares CI with `npm test` | 4 of 5 |
| IM2 | `attempt.ts` below `cli` | T24 | lint ban and a meta-test | 25 imports in 21 files |
| IM3 | Plan corpus tests | T21, done | a parse count in a test | 2% for twice the plans |
| IM4, LC6 | Split the run loop, one provider loop | its own plan before W06 (AM8) | T25's ratchet | 2,820 lines, 3 loops |
| IM5 | Linter and size ratchet | OC2, T25 | lint in the worker's loop, a ratchet by function | 18, 42 and 52 sites |
| IM6 | The line budget | T25 deletes it | T23 refuses a test that cannot fail | 1 |
| IM7 | Sandbox | W05 | a descriptor test per mode | whole disk readable |
| IM8, NF25 | Three edges without a caller | OC5 | `next-steps.ts` covers each edge | 3 edges, 1 false header |
| IM9 | The other 30 upward imports | W04 15, W05 10, W06 2, AM8 3 | the lint ban per layer, with a list that may only shrink | 30 |
| IM10 | One render test per component slice | W08 | DC5's browser | 0 |
| IM11 | One card for a landing | K4 and W17, as planned | | 5 commands |
| IM12 | What core reads from the dashboard | T26 | a closed list of five files | 18 imports in 10 files |
| IM13 | The risk map | OC4 | a test that every part of `core/src` has a tier by name | 18% |
| LC1, LS1, LS2 | Identity, containment and clock | T22 | five fences | 8 Git starts, 10 and 10 sites |
| LC2 | Hostile input table | W04, first milestone | its own unit layer | 63 JSON and 6 YAML parse calls |
| LC3 | A bite for every fence | T23 | the registry | 6 without |
| LC4 | Seven shapes | two in T22, five in W04 | one helper and one fence each | 43 cuts, 19 maps, 3 patterns |
| LC5 | Durable write helper | W04, first milestone | a fence on the raw spelling | 13 creates, 16 renames |
| LC7 | Clock, environment and working directory at the edge | clock durations in T22, the rest with AM8's plan | a list of allowed files | 44, 17 and 4 files |
| LC8 | One guarded loader | W08 | a fence on a raw fetch | 16 in 8 files |
| LC9 | Production reachability | W11 | a fence with a list that may only shrink | 68 |
| Invariants 1, 2, 13 | Their tests | T23 lists them as partial, W19's T08 builds 13's | the invariant table | 3 partial |
| DC4 | Design coverage | T28 | its own fence | no check |
| Q113 | A fix proves the bug | T29 | a host gate | no check |
| Q121 | Comments | T27 | a fence and a list that may only shrink | 121 counts, 9 dead paths |
| Q122 | Small-fix lane | W14 | one task per firing | |
| Q123 | Cheapest check | OC3 | the plan review | |
| Q124 | Crash orders | W05 | the simulation layer | |
| Q125 | W08's first commit | W08 | its own CI | |
| Q127, Q128 | Ticket bytes, clean checkout | T20, done | TR-22 and TR-23 | |
| F1 to F4 of T20 | A ticket edit never costs a paid reply | T32, before W04 | journeys and mutants | |
| NF36 | Light tickets can be seen | T31 | the list, the route and the screen | 0 of 13 |
| Q129 | Publish after close | T30 | the publish fences | |

**What is not taken, and why.** Bombadil: a dependency outside the list, and experimental. TLA+ and Lean: Q124 comes first. A ban on comments: Q121. Automatic merging: decisions 4 and 14, and invariant 13. A duplicate detector: a new dependency for 157 findings that held 10 bugs.

## 6. The lists

**The 32 upward imports of IM9.** T24 takes `doctor/report` to `cli` and `persistence/closure-journal` to `cli`.

| Plan | Imports |
| --- | --- |
| W04 | `contracts`: attribution-record and traps-readout to traps, design-context, design-output, preview-record and project-register-output to registry, next-steps to state, publish-output to publish. `persistence`: delegate-replays and task-delegate to delegate, plan-tickets and ticket-store to registry. `registry/plan-admission` to closure. `git/closure` to closure and to registry. |
| W05 | `policy`: path-policy and sandbox-broker to contracts, risk to config, sandbox-broker to execution and to git. Protected rules in workflow: git/protected-commit (2), git/protected-reconcile (2), sandbox-broker (1). |
| W06 | `config/load` to state and to workflow. |
| AM8's plan | `execution`: call-budget and transport-broker to workflow, phase-request to adapters. |

The layer order is the best of 40 searches. A plan may choose another, if its list is not longer.

**The 68 values of LC9.** Read by nobody: `clearClosureSnapshotCache`, `validatePathPolicy`, `permissionProfileForAgent`, `tierForPaths`, `QUOTA_ROUTE_REASON_TEXT`, `emitContractProjectionJsonSchema`, `renderParseFixRequest` and `stepSimulation`. Read only by tests: 60, of which eight are in `persistence`, four in `observability`, three in `delegate` and three in `git/changes`. W11 regenerates the list from its own fence. Some of these wait for W19's later milestones, so a reason is written beside each.

**Not covered by the sweep:** the 111 declined and 25 not-reproduced findings of the October review were not read again. Their sort is of 2026-11-23.

## 7. The questions behind Q130 to Q135

All six were ruled as recommended on 2026-11-25. Nothing in this file waits for a ruling.

| Code | Question | Recommendation | Alternative |
| --- | --- | --- | --- |
| Q130 | L10, L16 and L21: wire them or remove them? | Remove. L10 and L16 are corrections, which are phase state and not task state. L21 would write a transition into a record it calls damaged. The ids are never reused. Cost: protected files, four trap rows and the cheatsheet, through GA. | keep them, with a test that lists each edge without a caller |
| Q131 | Do LC2, LC4 and LC5 move into W04's first milestone? | Yes. W04 reads outside transcripts and writes records, which is where those three bite. Q94 sent them to W06, W07, W08 and W11. | keep Q94 |
| Q132 | Does LC3 come now, as T23? | Yes. A list that may only shrink is worth nothing if its fence cannot fail. Q94 sent it later. | after W04 |
| Q133 | The order of the sandbox trial | Reviewers first, then one builder in a third mode with the Git store readable and nothing else of home. | a builder at once in the narrow mode, which is known to break Git |
| Q134 | The risk map (NF28) | Tier 2 for git, publish, closure, gates, preflight, lifecycle, delegate, decision, traps, quota, config and the credential patterns, and the patterns become a protected path. | only the credential patterns |
| Q135 | Where does the split of the run loop live? | AM8 adds it to the spine as v3 W18, after AM6 and AM7, because the plan author needs a spine ticket. | W06's first milestone, which changes Q117 |

## 8. Owner commits

| Code | Content | State |
| --- | --- | --- |
| OC0 | W03: the closing record as a dated Amendment, six Validation rows, dates and commits | done, `d4d56ee` |
| OC1 | `.github/workflows/ci.yml`: the trap step, and a comment that no longer counts layers | done, `f1858f7` |
| OC2 | `npm install --save-dev --save-exact oxlint@1.93.0`, and `.oxlintrc.json` with the three limits, the ban on imports of `cli` and today's files as exceptions. Tests are exempt from size. 1.93.0 is 16 days old, and 1.95.0 is two. | the trial found 25 imports in 21 files, with the message a worker would see |
| OC3 | `prompts/plan-author/system.md`: the cheapest-check rule, with the unit test that pins that prompt's bytes | done, `0de38a2` |
| OC4 | `awsf.config.yaml`: `risk.paths` and `policy.protected_paths`, as Q134 | not written. It ends any DRAFT attempt's snapshot (TR-10) |
| OC5 | The three edges removed, and the header of `task-machine.ts` | not written |
| OC6 | AM8, after AM6 and AM7 | draft below |

### AM8, for the spine (draft, not applied)

> **Evidence that the rule costs something:** `executeProductionCommand` is 2,820 lines with a complexity of 270, and its file changed in over 90 of 970 commits. W06 changes routing inside it, and three places run a provider on their own.
>
> **What will be true:** W18 splits the run loop by phase step and builds one provider loop, with no change to any journal byte a fixture run writes. It depends on W04. W06 depends on it.
>
> **What it costs:** one workstream before W06, and no new behaviour.
>
> **The alternative that leaves the rule alone:** W06 does it in its first milestone.

## 9. What finished looks like

| Number | Today | Finished |
| --- | --- | --- |
| Layers in CI | 5 of 5 | a test compares them |
| Unit suite in a gate | 319 s of 600, after T21 | under 300, and not growing with plans |
| Fences that cannot be shown to fail | 6 | 0, and a new one is refused |
| Tracked code files in no area | not measured | 0, and a new one is refused |
| Imports of `cli` from below | 25 | 0 after T24 |
| Parts in one cycle | 27 | 18 after T24, 0 after W06 |
| Functions over the limits | 18, 42 and 52 | may only shrink |
| Lines of landing and gate code in tier 1 | all | 0 after OC4 |
| Values no production code reads | 68 | may only shrink |
| Kinds of `--ticket` selection never compared after `awsf new` | 0, after T20 | 0 |

## 10. Not verified

- The counts of LC4 are candidates found by shape. Not every fixed-size cut is a fault.
- The complexity numbers are the linter's, and the function lengths quoted as 2,820 and similar count every line.
- The 80 replays of v2 W18 were reviewers. No builder ran narrow.
