# Liquid software brainstorm, 2026-11-09 to 2026-11-10

**Status:** brainstorm record. Nothing in this file is a rule. A rule changes only by an owner commit through gate GA of `specs/awsf-v3-plan.html`.

**Written:** 2026-11-10, in a direct session with the owner.

**Design reference:** the Marimba Harness Panel canvas, version 23, 45 frames. <https://claude.ai/artifact/KG8KPMBCPma35268R5yP6M> (private to the owner).

## How to read this

Every open item has three parts. **Plain** says it in simple words. **Detail** gives the mechanism and the evidence. **Recommendation** says what to do.

The codes are the ones used in the conversation.

| Code | Meaning |
| --- | --- |
| D | decided by the owner |
| A | planned step |
| G | gap: not built or not written |
| U | waiting on the owner |
| Q | open question |
| NR | rule a tecla must obey |
| C | conflict between an existing rule and the vision |
| TC | a tecla |
| FL | a flow through the canvas frames |
| SB | a lookup step for Marimba |
| B | lesson taken from BrainOS |
| I | idea from the first round |

## 1. The idea

Liquid software is software the owner reshapes by asking. The owner asks Marimba for a view the dashboard lacks and gets it at once as a **tecla**. The owner improves it, keeps it, and reuses it on another project. A tecla that proves useful is rebuilt by the factory as a normal feature. The controls that authorize all of this change only by an owner commit.

The ladder below says how much each kind of change costs.

| Rung | What changes | What it costs |
| --- | --- | --- |
| 0 | a view: filter, theme, layout | nothing |
| 1 | a tecla | one pin |
| 2 | a factory feature | a card, the gates, an owner landing |
| 3 | the controls | an owner commit |

## 2. Sources

- The TSF brainstorm package: two "Tiny Software Factories" lessons by IndyDevDan, with guides, transcripts, 65 screenshots and REA notes. It lives outside this repository. The owner has no TSF code.
- The Marimba Harness Panel canvas linked above.
- The live dashboard.
- `specs/owned-ai-platform-vision.md`, Draft 0.41.
- `specs/awsf-v3-plan.html`, `specs/awsf-v3-intent.md` and the W01 to W03 deep plans.
- `AGENTS.md`.
- The owner's earlier projects BrainOS/Evo and the SecondBrain vault, both outside this repository. They were read in part on 2026-11-10.

## 3. Rounds

| Round | What happened |
| --- | --- |
| R1 | The sources were read. Ideas I1 to I8 and the ladder were proposed. |
| R2 | The owner said the vision's Q5 task fits, rejected the word "pages", asked for a Marimba that can be summoned from every tab, and asked for the rules to be audited against the vision. |
| R3 | The owner chose the name "tecla" and chose to put AM6 inside v3. NR1 to NR5 were explained by consequence. |
| R4 | The order of action A1 to A6 was agreed. The owner ruled on the workspace home, W16, recipe and program teclas, and real buttons. |
| R5 | The owner picked the first teclas TC1, TC2 and TC4, and accepted the passkey approach as W17. |
| R6 | Canvas version 20: summon, owner presses, teclas and settings. |
| R7 | Canvas version 21: a three-pane workspace, the dock, Stop for anyone, ten settings frames. Version 22: the rejected glass overlay removed, the routines limit added. |
| R8 | The owner ruled on I3, I4, I6 and I7, and accepted the report, the map and the second-brain proposal. |
| R9 | Canvas version 23: the map, a cited answer, the report as a tecla, sources and factory config. This report was written. |

## 4. Decided

| Code | Plain | Detail | Date |
| --- | --- | --- | --- |
| D1 | An agent-made view is called a tecla, never a page. | A tecla is one bar of a marimba. One sketched by Marimba is untuned. One rebuilt by the factory is tuned. | 2026-11-09 |
| D2 | The creation surface goes inside v3 as amendment AM6. | Owner-only. Multi-user stays out. AM6 has no text yet (G1). | 2026-11-09 |
| D3 | NR1 to NR5 are AM6's guarantees. | See section 6. "Retire keeps the data" is part of the meaning of retire. | 2026-11-09 |
| D4 | The workspace of pinned teclas becomes home. | Sessions stays home until three teclas are pinned. | 2026-11-09 |
| D5 | Tecla work is its own workstream, W16. | It is not folded into W08. | 2026-11-09 |
| D6 | A tecla is a recipe or a program, chosen by its purpose. | A recipe is trusted blocks and runs no code. A program is code in a locked room. | 2026-11-09 |
| D7 | The dashboard gets real buttons. The terminal is for rare cases. | Some buttons only the owner can press. Others are safe for agents. | 2026-11-09 |
| D8 | W03's last ticket closes before the tecla deep plan is written. | W03 has 14 of 15 tickets done. T15 is open. | 2026-11-09 |
| D9 | The vision's Q5 task is this one: ask Marimba for a missing dashboard view, get it as a tecla, improve it, keep it, reuse it on Smart Health. | The owner is the first customer. The vision doc still records Q5's task as deferred (A4). | 2026-11-09 |
| D10 | The first teclas are TC1, TC2 and TC4, in that order. | See section 7. | 2026-11-09 |
| D11 | An owner button is signed by a passkey. This is workstream W17. | See section 8. It arrives in this order: `confirm`, then `close`, `raise`, `rework`, `cancel`, then `land`, `journey`, `publish`. | 2026-11-09 |
| D12 | A summoned Marimba is a dock on the right. | The glass overlay was rejected and removed from the canvas. | 2026-11-10 |
| D13 | Anyone may stop work. Stop halts the work and keeps the run. | `cancel` stays an owner act. No stop command exists yet (G4). | 2026-11-10 |
| D14 | Built-in views share one list with teclas and carry the label "tuned". | Frame 21. | 2026-11-10 |
| D15 | A routine runs only under a lease, and only while the dashboard the owner started is open. | Decision 6 stays unchanged. A missed time is reported and never caught up. Routines arrive after W05. | 2026-11-10 |
| D16 | I3, I4, I6 and I7 are kept. | I3: one "Waiting on you" inbox, built by the factory. I4: the facts half of the Marimba screen ships first, as the first milestone of W08's deep plan. I6: one mission note per project, changed only by owner commit. I7: step summaries come from a template. The model fallback is parked. | 2026-11-10 |
| D17 | Teclas and brainstorms join the Canvas tab's map as new kinds. | Every line is read from a record. See section 10. | 2026-11-10 |
| D18 | Marimba's memory uses four zones and no new store. Lookup goes links first, words second, meaning last. | See section 10. The SecondBrain vault is not imported. The owner called it outdated and its folders an example only. | 2026-11-10 |
| D19 | This report lives in the repository. | `specs/brainstorms/`. | 2026-11-10 |

## 5. Words

| Word | Meaning |
| --- | --- |
| tecla | a view Marimba makes on request |
| recipe | a tecla made of trusted blocks, with no code |
| program | a tecla that is code, run in a locked room |
| untuned | sketched by Marimba, not yet built by the factory |
| tuned | built by the factory, with gates and an owner landing |
| built in | a view the dashboard already ships, shown as tuned |
| retire | remove a tecla from the workspace and keep its data |
| owner press | a button press signed by the owner's passkey |
| dock | Marimba opened as a column beside the current tab |
| routine | a prompt on a schedule, run under a lease |
| zone | one of four groups of knowledge: why, thinking, doing, keeping |

## 6. What a tecla may do

| Code | Rule | What it prevents |
| --- | --- | --- |
| NR1 | No network and no same-origin access. A tecla reads only the GET routes it declared. | A tecla sending data out, or reading more than was agreed. |
| NR2 | The confirmation card, the owner buttons and Stop are drawn by the dashboard itself. A tecla's frame is labelled. | A tecla drawing a fake Land button. |
| NR3 | A tecla can only put text in Marimba's composer. | A tecla acting on its own. |
| NR4 | Declared access is shown before a pin. A change asks again. | Access widening without the owner seeing it. |
| NR5 | A tecla never writes a repository. Turning one into code is a factory run. | Code that skipped the gates. |

A program tecla needs more than a recipe. The dashboard forbids frames and inline scripts today: `core/src/api/security.ts` sets `script-src 'self'`, `frame-ancestors 'none'` and `x-frame-options: DENY`, and `core/test/unit/api/security.test.ts` pins them. A program also needs an owner press to activate.

## 7. The first teclas

| Code | Name | Kind | Reads | Shows |
| --- | --- | --- | --- | --- |
| TC1 | Spine board | recipe | `GET /api/v1/tickets` | each workstream's progress and what it waits on |
| TC2 | Loose ends | recipe | `GET /api/v1/groups` | proposals from driving sessions that were never taken |
| TC4 | Your time in the loop | program | run metrics and events | owner presses per landing |
| proposed | Brainstorm report | recipe | one brainstorm record | decided, planned, gaps, waiting on you |

The brainstorm report tecla needs brainstorms to be records first (G5). Frame 38 draws it with this report's own content.

## 8. Owner presses (W17)

**Plain.** A button on a web page cannot tell who pressed it. A passkey makes the laptop ask for a fingerprint or PIN and sign the exact command, so the factory knows the press was the owner's.

**Detail.** Today nothing proves a browser click is the owner's.

- The sandbox shares the network: `core/src/policy/sandbox-broker.ts:267` passes `--unshare-all --share-net`.
- The API checks Host and Origin only, and accepts a request with no Origin: `core/src/api/security.ts:79`.
- `awsf confirm` demands an interactive owner terminal: `core/src/cli/commands/confirm.ts`.

The accepted design:

- A button's class comes from K2's `who`: view, driver or owner.
- An owner button is signed with WebAuthn on `http://localhost`. The relying-party id is `localhost`. An IP address is not valid.
- The signature is verified with `node:crypto`, using the public key from `getPublicKey()`. No dependency is added.
- The passkey is enrolled once, at the terminal.
- The terminal keeps accepting every owner act.

W01's handoff to W08 already states the constraint: the card must write an equivalent `awsf.request-confirmation/v1` record through a path the driver cannot take, or `awsf confirm` stays the owner's step.

**Not verified.** Windows Hello with Chrome against a dashboard served from WSL (U1).

## 9. Rule conflicts

The audit compared the 13 invariants, the 14 v3 decisions and AM1 to AM5 against the vision. It found nothing to remove.

| Code | Conflict | Resolution |
| --- | --- | --- |
| C1 | Decision 6 bans an unattended daemon. Vision Q9-B wants routines while the owner is away. | Resolved by D15. No rule changes. |
| C2 | AM5 and the out-of-scope list keep creation surfaces out of v3. | AM6 (G1). |
| C3 | `core/test/unit/meta/no-write-route.test.ts` pins the API to 10 GET routes and one archive POST. | Any button that acts needs this fence amended. |
| C4 | The driver checks have no place for a tecla. K3 needs a sketch step and K4 needs a "view acts" class. | Part of AM6. |
| C5 | Invariant 13 says an owner act runs from the owner's interactive terminal. | Reword to proof of presence, once U1 passes. |

D7 implies these changes. Each is its own amendment through GA.

- Invariant 13.
- The v1 rule that landing is terminal-only (`specs/awsf-architecture-proposal.md`).
- The `no-land-route` and `no-write-route` fences.
- Decision 9.
- A new Stop act that anyone may take (D13).

Decision 14 does not change. The vision's rule E4 stays: generated code must not grant itself permissions or rewrite the controls that authorize it.

## 10. The map and Marimba's memory

### The map

The Canvas tab draws five kinds today: runs, driving sessions, plans, proving grounds and replay pairs (`dashboard/src/canvas-graph.ts:21`). It keeps its kind filter in the URL and already has pins, zoom and a panel that opens a node.

The map keeps one rule from that code: every node and every line is read from a record, and nothing is guessed from a name. A tecla's lines come from its own record: where it was asked for, what it declared it reads, the run that tuned it, the project that reuses it.

Kinds are told apart by shape and fill, because the palette has one accent. Orange marks only what waits on the owner.

| Kind | Mark | Today |
| --- | --- | --- |
| run, driving session, plan, proving ground, replay pair | as now | exists |
| tecla | a bar: dashed when untuned, filled when tuned, ringed when built in, faded when retired | new |
| brainstorm | diamond | new |
| question | hollow circle, orange while open | new |
| decision | hexagon | new |
| lesson | triangle | new |
| source | page | new |
| project | large ring, with its mission as the dot inside | new |

Lines can mean: cites, decided in, led to, ran under, asked in, reads, tuned by, reused in, learned from.

Routines, leases and signals can join once W05 and W14 exist.

### The four zones

| Zone | Kinds |
| --- | --- |
| Why | mission |
| Thinking | source, brainstorm, question, decision |
| Doing | plan, ticket, driving session, run |
| Keeping | tecla, lesson, design frame |

The chain source, brainstorm, question, decision, plan, run, then tecla or lesson is the map's backbone. It shows how an idea became software.

### Storage

There is no new store. A note is a file the owner commits or a record the journal already keeps. The map and the search index are rebuilt from them. Invariant 10 and AM4 both require this. AM4 says a retrieval index is not another archive (`specs/awsf-v3-intent.md:207`).

Brainstorm, question, decision, lesson and source are not records today (G5).

### Lookup

Lookup belongs to W09.

| Code | Step | When |
| --- | --- | --- |
| SB1 | Follow recorded links. | Always. This is W09 as planned. |
| SB2 | Search by word over notes and records. | When links find too little. |
| SB3 | Search by meaning, with vectors. | Only if a fixed question set shows SB1 and SB2 miss. It needs invariant 7 amended. |

Whatever Marimba reads to answer is sent to the model that answers. Every source therefore needs a scope the owner sets. AM4 already requires a project-scope check before retrieval.

### Lessons from BrainOS

| Code | Lesson |
| --- | --- |
| B1 | Split notes by heading. BrainOS embedded only the first 2000 characters of each note, and its own review called that fix the most valuable one. |
| B2 | Test retrieval with a fixed set of questions before trusting it. |
| B3 | Every answer lists what it read, and the map lights those nodes. |
| B4 | Retrieved text is data, never instructions. |
| B5 | One node table with a kind, a zone, tags and a status. |

BrainOS's stack is not carried over. Postgres, pgvector, Redis and an embedding model do not fit invariant 7, which allows the core two runtime dependencies.

## 11. Canvas frames

| Row | Frames |
| --- | --- |
| 1, the conversation | 0 Rest, 1 Main, 2 Owner review, 3 Blocked |
| 2, behind the header icons | 4 Runs, 5 Driver checks, 6 Routes, 5b Doctor in the VM |
| 3, the owner's touch points | 7 Lease, 8 Closure, 10 Validator |
| 4, data and context | 9 Session record, 11 Context, 12 Data loop |
| 5, phases C and D | 13 Readiness, 14 Deploy, 15 Signals, 16a Orb, 16b Phone |
| 6, in the dashboard | 17 Strip, 17a Dock, 17b Reshape, 18 Owner presses |
| 7, teclas | 19 Empty workspace, 20 Sketch, 21 Workspace, 22 Change, 23 Program, 24 Tune or retire, 25 Reuse |
| 8, settings | 26 At a glance, 27 Look and feel, 28 Bars, 29 Keys, 30 Routines |
| 9, settings | 31 Routes, 32 Prompt, 33 Steps, 34 Steps described, 35 Harness |
| 10, map and memory | 36 Map, 37 Cited answer, 38 Brainstorm report, 39 Sources, 40 Factory config |

Where the older screens live now:

| Screens | Reached from |
| --- | --- |
| 0, 1, 2, 3 | states of the Marimba pane, docked or full width |
| 4, 5, 9, 10, 12, 13, 14, 15 | the workspace list, under "Built in · tuned" |
| 2, 3, 8 when they need the owner | the workspace list, under "Waiting on you" |
| 6, 7, 11 | Settings: Routes, Leases, Context |
| 5b | Driver checks, on the Mac host |
| 16a, 16b | other surfaces, outside the dashboard |

**Design language.** Forest palette (`#051F20` ground, `#DAF1DE` text, `#8EB69B` muted). One orange accent, `#F26A1B`, for the action that spends and for what waits on the owner. Archivo and JetBrains Mono. Owner buttons carry a key glyph. Unknown values are placeholders in brackets, such as `[N]`.

**Reference.** The settings frames follow the TSF lessons' settings screens, because the current Settings tab offers no customization. The look is the owner's own.

## 12. Flows

| Code | Flow | Frames |
| --- | --- | --- |
| FL1 | Drive a run | 0, 1, owner press, 4, 2, owner press, 8 |
| FL2 | Recover a stop | 17 or 16b, 3, then a new run or a rework press |
| FL3 | First tecla | 19, 20, 21, 22, 24, 25 |
| FL4 | Reshape the dashboard | 17, 17a, 17b, then 27, 28, 29 |
| FL5 | Away | 30, lease press, 7, then "Waiting on you" in 21 |
| FL6 | Look something up | 36, 37, 38 |
| FL7 | Change a rule | 40, a prepared patch, an owner commit |

## 13. Planned

| Code | Step | Waits on |
| --- | --- | --- |
| A4 | A source entry in the vision doc recording D9, the word tecla, AM6, recipe and program, W16 and W17. | U2 |
| A5 | AM6 and the rule changes of section 9, each as an owner commit through GA with evidence, a checkable replacement guarantee, the cost and the alternative. | G1, U1 |
| A6 | The deep plan for W16, with W08's ticket frame references. | U3 |
| A7 | The deep plan for W17. | U1 |
| A8 | A flow-map frame, a re-freeze of the frame index, and screenshots for the workers. | U2 |

AM5 is named in `specs/awsf-v3-intent.md`, `specs/awsf-v3-plan.html`, `specs/awsf-v3-plan-build-prompts.md` and the vision doc. Invariant 12 requires a plan and its tickets to change in the same commit.

## 14. Gaps

**G1. AM6 has no text.**
- Plain: the rule that lets teclas exist is not written.
- Detail: D2 and D3 fix its content. It must also resolve C2, C3 and C4.
- Recommendation: draft it right after the design settles.

**G2. The rule changes for real buttons are not written.**
- Plain: the factory's rules still say owner acts happen in a terminal.
- Detail: five changes, listed in section 9.
- Recommendation: one amendment at a time, `confirm` first.

**G3. The passkey path is unproven on the owner's laptop.**
- Plain: nobody has tried it there.
- Detail: see U1.
- Recommendation: run the spike before any amendment is drafted.

**G4. No Stop command exists.**
- Plain: the canvas draws a Stop button that the factory cannot honour yet.
- Detail: `core/src/cli/commands/` has `cancel.ts` and nothing for stop or halt. "Halt and keep the run" has no defined effect on a running phase.
- Recommendation: define that effect inside W17, as an act anyone may take.

**G5. Brainstorms, questions, decisions, lessons and sources are not records.**
- Plain: this report was written by hand because nothing recorded the brainstorm.
- Detail: a driving session's journal already stores asks, decisions, alternatives and not-taken proposals (`dashboard/src/group-layout.ts:22`), and `GET /api/v1/groups` serves it. A brainstorm has the same shape.
- Recommendation: record a brainstorm in that journal shape, in W16's deep plan. The report tecla then needs no new route. The trap suite already serves as the first source of lessons.

**G6. A program tecla cannot be shown.**
- Plain: the dashboard refuses to host the locked room.
- Detail: see section 6.
- Recommendation: build recipes first (TC1, TC2). Amend the frame rule only when TC4 is built.

**G7. The frozen frame index is behind the canvas.**
- Plain: the workers' reference still points at an old design.
- Detail: `specs/design/awsf-v3-plan/frame-index.json` pins canvas version 14. The canvas is at version 23.
- Recommendation: re-freeze once, at U2.

## 15. Waiting on the owner

**U1. Try a passkey on the laptop.**
- Plain: owner buttons need the laptop to prove a press is the owner's.
- Detail: enrol a passkey with Windows Hello in Chrome against the dashboard at `http://localhost:43223`, served from WSL. Sign one challenge. Verify it with `node:crypto`.
- Recommendation: do it before any presence amendment. If it fails, owner buttons fall back to copy lines and W17 changes shape.

**U2. Say when the canvas is settled.**
- Plain: the flow map and the workers' screenshots wait for that word.
- Detail: A4 and A8 depend on it. The owner said on 2026-11-10 that the design still has room to improve.
- Recommendation: review rows 6 to 10 once more.

**U3. Close W03's last ticket.**
- Plain: the tecla plan is written after W03 closes.
- Detail: D8 set this order. T15 is the open ticket.
- Recommendation: keep the order.

## 16. Open questions

**Q29. Is adding a source from outside the project an owner press?**
- Plain: should only the owner be able to let Marimba read a new folder?
- Detail: frame 39 draws it as an owner press. A new source widens what is sent to a model provider.
- Recommendation: yes.

**Q30. Are the node marks right?**
- Plain: bar, diamond, hexagon, triangle, page and ring.
- Detail: frame 36. The five existing kinds keep their marks.
- Recommendation: accept, and revisit with real data.

**Q31. Are the key letters and the step shapes right?**
- Plain: frames 29 and 34 show proposals.
- Detail: the letters can be rebound in frame 29.
- Recommendation: accept the letters. Fix the step shapes in W08's deep plan.

**Q32. Is "Answer in Marimba" the only way to answer from a tecla?**
- Plain: the report puts words in Marimba's box and presses nothing.
- Detail: this is NR3 applied to frame 38.
- Recommendation: yes.

## 17. What a builder needs to read

| For | Read |
| --- | --- |
| The API a tecla may read | `core/src/api/routes.ts` (10 GET routes and one archive POST) |
| The fences that block buttons | `core/test/unit/meta/no-write-route.test.ts`, `core/test/unit/meta/no-land-route.test.ts` |
| The dashboard's security headers | `core/src/api/security.ts`, `core/test/unit/api/security.test.ts` |
| The sandbox | `core/src/policy/sandbox-broker.ts` |
| The owner acts | `docs/driving/marimba/owner-acts.mts` (18 acts) |
| Owner confirmation | `core/src/cli/commands/confirm.ts`, `core/src/cli/tty.ts` |
| The dashboard's routes and themes | `dashboard/src/App.vue`, `dashboard/src/theme.ts` (seven palettes) |
| The current Settings tab | `dashboard/src/components/SettingsRoute.vue` (read-only, plus a sound toggle) |
| The map | `dashboard/src/canvas-graph.ts`, `dashboard/src/canvas-view.ts`, `dashboard/src/routes/canvas.vue` |
| The planning journal | `dashboard/src/group-layout.ts` |
| Protected paths | `awsf.config.yaml`, policy block |
| Retrieval rules | `specs/awsf-v3-intent.md`, AM4 |
| Routines and autonomy | `specs/owned-ai-platform-vision.md`, Q9 and US36 |

## 18. Not verified

- The canvas on claude.ai was never opened by the session that drew it. Frames were checked by rendering the same markup locally.
- The passkey path on the owner's machine (U1).
- BrainOS was read in part: its overview, the opening of two plans, and its graph model. No full audit was done.
- A brainstorm ledger that the SecondBrain vault mentions was not found.
