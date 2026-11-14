# Liquid software brainstorm, 2026-11-09 to 2026-11-10

**Status:** brainstorm record. Nothing in this file is a rule. A rule changes only by an owner commit through gate GA of `specs/awsf-v3-plan.html`.

**Written:** 2026-11-10, in a direct session with the owner. Updated 2026-11-14, when the owner closed the brainstorm (D36). **To resume work, read section 13 first.**

**Design reference:** the Marimba Harness Panel canvas, version 27, 50 frames. <https://claude.ai/artifact/KG8KPMBCPma35268R5yP6M> (private to the owner).

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
| GP | a graduation pattern taken from a v2 plan |
| AB | a line of the acceptance bar for an always-on host |
| AU | a use for the owner's current laptop |

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
- A critique of the panel written on 2026-11-10 by a second assistant the owner iterates with, Marimba on META Muse. It lives outside this repository. It compared 115 features of the TSF screenshots with the 45 frames then drawn: 36 carried, 48 partial, 23 missing, 8 not applicable.
- An inventory of 103 of the owner's earlier brainstorm notes with a cover note, written on 2026-11-12 by the same second assistant, and its draft of an end-to-end test from 2026-11-11. All three live outside this repository and stay there, because they mix personal context with factory context (D30).
- Three packages from the second assistant on 2026-11-14, all outside this repository: two videos by Kun Chen on one orchestrator across several machines, a video on Google's elephant-goldfish plugin, and a hardware brief. The plugin's public repository, `github.com/google/elephant-goldfish-model`, was read directly on that day.

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
| R10 | The owner iterated the panel with Marimba on META Muse and brought back its critique with decisions D20 to D23. Canvas version 27: the rooms, the vault, the plan viewer, the journal, frame 36 redrawn with real counts, and ten additions from the critique. |
| R11 | The owner ruled D24 to D26. A review of the plan-sota skill and its plans was written and handed to the owner. |
| R12 | The owner ruled on the review (D27). The skill's text was changed. Two owner ideas were answered in the review's sections 17 and 18: plan templates as tuned teclas, and a design that travels with its plan. |
| R13 | The second assistant sent the inventory and the test draft named in section 2. Most of the inventory is BrainOS history. The owner ruled D28 to D30. Gaps G10 and G11 came out of the inventory. |
| R14 | The owner brought the three packages of 2026-11-14 as brainstorm input, with nothing to be built or changed until the picture was agreed. The owner accepted the picture, ruled D31 to D35, and closed the brainstorm (D36). Section 22 holds the round. Section 13 holds the order of work. |

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
| D20 | The Canvas tab holds more than one map. Each map is a room. | Zoom out to see the rooms and zoom in to enter one. The current graph is Room 1 and opens first until the owner says otherwise. A new room is a layout tecla. See section 10. | 2026-11-10 |
| D21 | The vault is tecla TC3. It holds every plan and every important document. | A plan opens in full inside the dashboard, drawn in the harness's own design, with no summary first. Its questionables are buttons that put text in Marimba's composer. The journal gets its own section beside the vault. The order of teclas is TC1, TC2, TC3, TC4. | 2026-11-10 |
| D22 | The Routes settings frame names real models. | Naming them is its job. Grades stay the language everywhere else. | 2026-11-10 |
| D23 | Four open questions are answered. | Adding a source from outside the project is an owner press. The node marks are accepted, to revisit with real data. The key letters are accepted, and the step shapes are fixed in W08's deep plan. "Answer in Marimba" is the only way to answer from a tecla. | 2026-11-10 |
| D24 | Three rules are accepted. | A tecla is a tuning candidate when it was opened on 5 of the last 14 days, helped more than half the time and has not changed for 7 days, or when the owner says so. An item enters "Waiting on you" only when its next legal step is an owner act, and it leaves when the owner acts or the cause disappears. Settings are built starting with frame 27 Look and feel, then 29 and 28, because they work without Marimba. | 2026-11-11 |
| D25 | For plans, the viewer comes first and any format change second. | The viewer draws today's plan HTML. The format changes only after the owner has read a review of the plan-sota skill and its plans. | 2026-11-11 |
| D26 | A routine may run "when this dashboard opens". | This adds a second kind of schedule to D15. The lease rule does not change. | 2026-11-11 |
| D27 | The owner ruled on the plan-sota review. | The skill's text changes first (PS1, done). A questionable is raised only when the choice is the owner's by rule or the author is unsure. A ticket becomes the one home of a prompt, corrected by an owner amendment through GA (PS3). The leaner format reuses the factory's own plan structure and keeps Purpose, Problem and Solution as three sections. The format work starts after T15 closes. Q40 stays open. See section 13 of `specs/reviews/2026-11-11-plan-sota-review.md`. | 2026-11-11 |
| D28 | A theme belongs to a project. No single house theme is fixed. | Each user and project has its own look, and a theme tells at a glance which project a tecla belongs to. The plan-sota skill now uses a project's `plan-theme.css` when its plans directory has one, and falls back to the house theme. Reading a registered project's design to propose its theme is an idea and not a decision. If built, it belongs to W16 and the owner confirms the proposed theme. | 2026-11-13 |
| D29 | D9 stays the vision's Q5 task. | A second assistant proposed an end-to-end test built on a creator-account workflow (section 21). The owner kept D9. A review tecla for the owner's gameplay-clips project is a later third context, after the dashboard and Smart Health. Posting stays an owner press. | 2026-11-13 |
| D30 | A handoff between the two Marimbas carries three more things. | A context mark on each section, factory or personal. A pull rule: nothing marked personal enters git, the journal or an agent's notes. A "check locally" line that names the paths the writer could not reach. See section 19. | 2026-11-13 |
| D31 | The working setup is one picture. | One factory and one journal on an always-on Linux box. The MacBook is where the owner works, and it is a dashboard client. The phone reads, presses and signs. The Apple Watch stands beside the phone and carries presence and intent: Stop, status at a glance, the double tap. The cloud Marimba stays as research and iteration partner through the handoff format: it drafts and the owner commits. Nothing starts work unless the owner started it. | 2026-11-14 |
| D32 | There is one Marimba. | No second orchestrator runs on a second machine. Two orchestrators mean two journals, and the journal is the one evidence store. The single Marimba moves to the always-on box when that box exists, and the laptop and the phone are views. | 2026-11-14 |
| D33 | D15 holds as written. | A phone terminal session is the owner's terminal and does not count as "the dashboard is open". A phone dashboard session counts once a phone-width TC2 exists. An owner-started run may finish with the laptop closed, and that needs no rule change: decision 6 forbids a daemon that starts work, and D15 governs routines. | 2026-11-14 |
| D34 | The hosts are chosen. | The Mac is a MacBook Pro M5 Pro with 64 GB and 2 TB, which matches v3 decision 3. The owner's current laptop stays at 8 GB and is a candidate always-on host on Ubuntu Server 24.04 LTS, minimal, with no desktop. It earns that role only by passing AB1 to AB6 (section 22), and a test booted from USB comes before anything is spent. The sandbox's user-namespace need is met with the stock bwrap AppArmor profile and never with a machine-wide switch. If the laptop fails the bar, decision 3 stands: AWSF in a Linux VM on the Mac. A further machine is considered only if the laptop proves too weak or dies. | 2026-11-14 |
| D35 | A zero-context review of plans is backtested first, on W03. | One closed deep plan is reviewed as first committed, and the findings are scored against that plan's own Amendments list. Where the review then lives, and with which lenses, is decided after the backtest (section 22 holds the recommendation). | 2026-11-14 |
| D36 | The brainstorm is closed. | Work resumes on the planned steps, in the order section 13 gives. | 2026-11-14 |

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
| TC3 | Vault | recipe | the plan registry and the files in `specs/` | every plan and document, each opened in full |
| TC4 | Your time in the loop | program | run metrics and events | owner presses per landing |
| proposed | Brainstorm report | recipe | one brainstorm record | decided, planned, gaps, waiting on you |
| proposed | Journal | recipe | `GET /api/v1/groups` | each driving session: what was asked, applied and not taken, and the runs and plans it touched |

The vault differs from the spine board. The board says where each workstream stands. The vault opens the document itself. A workstream with no deep plan opens a "Draft the request" button, never an empty page.

Refreshing a tecla reads its route again and calls no model.

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

### Rooms

The Canvas tab holds rooms (D20). Each room is its own layout over the same records, and none stores anything.

| Room | Layout | State |
| --- | --- | --- |
| 1, the factory graph | the current Canvas, unchanged | opens first |
| 2, how an idea became software | the four zones, with runs folded | not proven with real use |
| a new room | a layout tecla Marimba makes on request | none yet |

Each room keeps its own filters. Room 1 has kind switches and Room 2 has lenses. Each room lists what it left out. The factory builds only the zoomed-out view and the move between rooms.

Measured on 2026-11-10 with the dashboard's own `buildCanvasGraph` over every session page:

- 194 run records stack into 156 run nodes, because the attempts of one task are one node.
- The map holds 177 nodes and 146 connections, and leaves 20 records unplaced.
- Of the 156 run nodes, 99 sit in 10 replay pairs under one proving ground, 22 sit in 5 driving sessions, 1 names only a plan, and 34 have no recorded parent.

Room 2 folds each run into what it ran under and shows the count beside the mark. Opening a mark fans its runs out. A plan node opens the plan in the vault, and an open question on the map is the same object as the questionable inside its plan.

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
| 10, memory | 38 Brainstorm report, 39 Sources, 40 Factory config |
| 11, canvas rooms | 41 Rooms zoomed out, 42 Room 1, 36 Room 2, 37 Cited answer |
| 12, vault and journal | 43 Vault, 44 Plan viewer, 45 Journal |

Where the older screens live now:

| Screens | Reached from |
| --- | --- |
| 0, 1, 2, 3 | states of the Marimba pane, docked or full width |
| 4, 5, 9, 10, 12, 13, 14, 15 | the workspace list, under "Built in · tuned" |
| 2, 3, 8 when they need the owner | the workspace list, under "Waiting on you" |
| 6, 7, 11 | Settings: Routes, Leases, Context |
| 5b | Driver checks, on the Mac host |
| 16a, 16b | other surfaces, outside the dashboard |

The nav's Canvas link opens Room 1.

Ten additions from the critique were drawn on 2026-11-10: context marks (26), step summaries that unfold into the raw steps (17a, 21), the call ceiling held by code (4, 6), what done means on a closure (8), an owner override of Marimba's advice (3), self-correction (26, 17a), a model chooser with what each choice costs (31), no model call on a tecla refresh (20, 21, 43), a rating on a tecla and the tuning rule (21, 24), and a routine's contract with its runs (30). Frame 18 gained the path for when a passkey cannot answer.

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
| FL8 | A plan from draft to decided questionables | 21 or 43 "Draft the request", the factory authors it, 43, 44, an owner press to apply |
| FL9 | Move between maps | 41, then 42 or 36 |

## 13. Planned

| Code | Step | Waits on |
| --- | --- | --- |
| A4 | A source entry in the vision doc recording D9, the word tecla, AM6, recipe and program, W16 and W17. | U2 |
| A5 | AM6 and the rule changes of section 9, each as an owner commit through GA with evidence, a checkable replacement guarantee, the cost and the alternative. | G1, U1 |
| A6 | The deep plan for W16, with W08's ticket frame references. | U3 |
| A7 | The deep plan for W17. | U1 |
| A8 | A flow-map frame, a re-freeze of the frame index, and screenshots for the workers. | U2 |
| A9 | The plan viewer over today's plan HTML, as part of W16 (D25). | U3 |
| A10 | Any change to the plan format: PS3, then PS4 (D27). | U3 |
| A11 | The test booted from USB on the 8 GB laptop: AB1 to AB3, with timings (section 22). | U5 |
| A12 | The backtest of a zero-context plan review on W03 (D35). | U3, because W03's Amendments list is complete only when T15 closes |
| A13 | The phone step: from mobile data, attach to the running session, read what waits, and perform one owner act that was owed anyway. Nothing is built. | nothing |
| A14 | The Mac's acceptance, then the laptop's move to Ubuntu Server and AB4 to AB6 (D34). | A11, and the Mac's arrival |

### Order of work

The brainstorm is closed (D36). This is the order.

1. **U3: close T15.** The format work and the tecla plans wait on it.
2. **U2 and U1, both the owner's.** Say the canvas is settled, and try the passkey.
3. **After U2:** A4 and A8. **After G1 and U1:** A5, which also carries Q40's spine amendment.
4. **After U3:** A12, then A10 (PS3, then PS4), then the deep plans in spine order: W04, W08, then A6 (W16) with A9, and A7 (W17) after U1.
5. **Hosts, at the owner's pace and independent of steps 1 to 4:** A11, the Mac, A14. A13 can happen any day.

Parked, with no step planned: the account test (section 21), AR glasses (Q42, Q43), reading a project's design to propose its theme (D28), and voice beyond dictation (G10).

Owner-side upkeep of the current machine comes before the host steps. It is tracked outside this repository (D30).

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
- Detail: `specs/design/awsf-v3-plan/frame-index.json` pins canvas version 14. The canvas is at version 27.
- Recommendation: re-freeze once, at U2.

**G8. Nothing connects the dashboard to a phone or a watch.**
- Plain: a watch cannot press a button on a dashboard it cannot reach.
- Detail: the API answers only on localhost (`core/src/api/security.ts`). Frame 16b already assumes a phone can reach it.
- Recommendation: design that path inside W15 before any watch or phone work.
- Update, 2026-11-14: a phone can already reach a terminal on the laptop over the owner's private network, and a terminal session there is an interactive terminal for an owner act (`core/src/cli/tty.ts`). The dashboard is still out of reach, because the API accepts a loopback host only. A phone-width TC2 needs one more accepted origin, which is a fence change and so an owner amendment. Until then the phone reads and acts through the terminal (A13).

**G9. The viewer has no renderer yet.**
- Plain: the dashboard cannot draw a plan today.
- Detail: the Backlog board reads a plan's markers. The full plan is only readable in a browser tab.
- Recommendation: build the renderer over today's plan HTML first (D25).

**G10. No way in for a spoken note.**
- Plain: the owner starts most ideas by speaking, and the design has no place to speak.
- Detail: voice as the way in is the most repeated idea in the inventory, in about ten notes. Before 2026-11-13 this report mentioned voice once, under AR glasses.
- Recommendation: start with the operating system's dictation into the dock's ask box, which needs no build. Decide on anything more after the first tecla exists.

**G11. No frame takes a brainstorm in.**
- Plain: nothing on the canvas takes a note, dates it and shows what it became.
- Detail: G5 covers the record. This gap is the screen. Today the path is a voice note, a second assistant, a file and a session.
- Recommendation: one frame can serve G10 and G11. Draw it only if it fits before U2. Otherwise leave it to W16's deep plan.

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

**U4. Rule on the plan-sota review.**
- Plain: answered on 2026-11-11 (D27).
- Detail: the review estimates about 42% less written per deep plan and about 60% less loaded later. Q40 stays open by the owner's choice.
- Recommendation: close U3 first. The format work waits on it.

**U5. Run the test booted from USB.**
- Plain: it decides whether the 8 GB laptop earns the job of always-on host before anything is spent.
- Detail: A11. The steps are in section 22. It changes nothing on the laptop's disks.
- Recommendation: run it at the next restart of that machine.

## 16. Open questions

Q29 to Q32 were answered on 2026-11-10 and are recorded as D23. Q45 was answered on 2026-11-13 and is recorded as D30.

**Q40. Should the spine mark one path as first?**
- Plain: the review proposed marking W03's last ticket, then W04, W08 and W16 as the line to finish first.
- Detail: the amendment would be made in the same step as AM6. The owner left it open on 2026-11-11, to decide after the format work.
- Recommendation: amend, when AM6 is written.

**Q42. When does a tecla first run on AR glasses?**
- Plain: a small web app on display glasses could show one tecla.
- Detail: Meta opened its display glasses to outside developers in May 2026, with a native toolkit and plain web apps. There is no public store yet.
- Recommendation: wait until TC1 exists. A tecla has no format before that, so a prototype now would be thrown away.

**Q43. Which tecla goes on glasses first?**
- Plain: the candidates are TC4, TC2, or a new "what waits on you now".
- Detail: the strip, a watch and glasses could all read one small "waiting on you" feed.
- Recommendation: "what waits on you now".

**Q44. How does a watch or a phone sign an owner press?**
- Plain: the owner wants a double tap on the Apple Watch to count as a press.
- Detail: see section 19 and G8.
- Recommendation: Stop and the inbox first, because they need no proof of presence. Signing follows U1.

**Q45. How do the two Marimbas talk?**
- Plain: one Marimba runs in the cloud and one in the factory, and the owner carries messages between them.
- Detail: see section 19.
- Recommendation: files in git, with the owner's commit as the gate. Answered on 2026-11-13 with three additions (D30).

**Q46. What is the panel not?**
- Plain: the panel grew from 19 frames to 50.
- Detail: the critique asked for one line that bounds it.
- Recommendation: it replaces neither Sessions, Backlog, Metrics nor the Sessions log. It rebuilds Settings and adds rooms to Canvas.

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
- Versions 24 to 26 of the canvas were published outside the session that published version 27, and the index was not re-read first.
- Whether a double tap triggers a notification's main action for an outside app, and how watchOS guards a key an app stores.
- The market and hardware figures in the critique's AR study.
- The token cost of authoring a plan.

## 19. Other surfaces, explored on 2026-11-10

Nothing in this section is decided, except the handoff format under "Marimba to Marimba" (D30).

### AR glasses

The full canvas does not fit today's display glasses. Voice and small cards do, and a tecla maps well to a single-purpose web app. See Q42 and Q43.

### Apple Watch

- An outside app can adopt the double tap from watchOS 11, with SwiftUI's `handGestureShortcut(.primaryAction)`. One main action per screen. The app gets no gesture event and cannot tell a double tap from a tap.
- A double tap is not proof of who pressed. The proof is an unlocked watch on the wrist plus a key no agent can reach.
- A double tap can fire by accident, so it should never land code alone.
- The owner's split holds: the watch gives presence and intent, and the phone signs. The phone signs with a key its app holds and the factory registers once, checked with `node:crypto` like a laptop press. A localhost passkey cannot be used from a phone app.
- The hard part is the path from the laptop to the phone (G8).
- The watch work is a W15 surface that carries W17 presses. It lives in the Smart Health Platform app.

Sources: Apple's "Enabling Double Tap" and `HandGestureShortcut.primaryAction` pages at developer.apple.com.

### Marimba to Marimba

- Channel: files in git. The cloud Marimba can never author a commit, by invariant 11, so the owner's commit is the gate.
- Inbound: a handoff arrives as a signal when the dashboard opens (W14) and stays data until the owner confirms it.
- Outbound: the factory writes a digest to the repository on the owner's press, because that text leaves the laptop.
- Format: who wrote it, the commit it read, what it prepared, what needs the owner, what it could not check.
- The cloud Marimba gets no direct read of the journal.

Accepted on 2026-11-13 (D30):

- Each section of a handoff is marked factory or personal.
- Nothing marked personal enters git, the journal or an agent's notes. This repository is public. The credential fence catches secrets and does not catch personal facts, so the rule holds through the owner's review of each commit.
- "What it could not check" names the paths to check on the laptop. The two sides reach different things: the cloud side holds the transcripts, and the laptop holds the repositories.

## 20. Corrections to the critique

- "194 runs and 156 runs disagree." They agree. 194 run records stack into 156 run nodes (section 10).
- "The panel shows no budget." Frame 4 already showed calls spent against the ceiling. The host enforces the ceiling.
- "No ticket says what done means." A ticket carries `serves` with its acceptance ids and an owner-acceptance block. Frame 8 now shows them.
- "No frame after 40 before the re-freeze." TC3 and D20 could not be drawn without new frames. The re-freeze still happens once, at U2.

## 21. A proposed end-to-end test, judged on 2026-11-13

The second assistant drafted a "graduation plan" on 2026-11-11. It is a proposal the owner has not adopted. The owner paused the account work on 2026-11-12 and kept D9 on 2026-11-13 (D29). The draft lives outside this repository.

**What it proposes.** One test of a creator-account workflow: record gameplay, cut clips, write captions, publish, reply, report. It means to test the cloud Marimba, the harness, the factory and the handoff channel at once, in six tasks the owner marks pass or fail.

**Its two patterns, renamed.** The draft calls them "W09" and "W12". Those are v2 labels. In v3, W09 is the context engine and W12 is the Mac host, so this report uses the names below.

| Code | Pattern | Source |
| --- | --- | --- |
| GP1 | Prove without enabling. A decision milestone comes first and may end the work. No milestone enables the route or spends. A dossier records what would reopen it. | `specs/awsf-v2-w09-agy-adapter.html` |
| GP2 | Acceptance by real runs. The plan supplies a request, and the factory plans and builds it. A defect found on the way is routed to the workstream that owns it. | `specs/awsf-v2-w12-cheatsheet.html` |

**Judgment.** This is the session's reading. The owner has not ruled on it.

- GP1 is used as written. The decision milestone, the owner press before any post and the owner act before any spending all match it.
- GP2 is used by name only. Its rule is that the plan gives a request and the factory does the planning, because a task the plan already planned proves nothing about the factory. The draft lists six operating steps and writes them itself, so no task asks the factory to plan or build anything.
- It is early. GP2 ran last in v2, after the commands stopped changing. The draft leans on the harness, the vault, owner presses and handoff signals, and none of those has a deep plan yet.
- It tests four systems at once. A failed task could not be traced to one of them.
- "The approved route" is not defined. The decision milestone has to fix the route, the content rule and the name on the mark before anything else.

**If the owner reopens it.** One system per task. The factory task is a request the factory plans, checked by a test that already exists. The harness task is the review tecla of D29. Publishing starts with the owner posting a prepared draft by hand, which needs no outside interface. Replies are left out of the first test. Nothing starts before the first owner press of W17 exists.

Not checked: whether the factory can register and gate a Python repository, and which platforms offer an approved route for posting and for replies.

## 22. The round of 2026-11-14: one picture, three inputs

The owner's rule for this round was that nothing is built, installed or changed until the picture is agreed. The picture is D31. The rulings are D32 to D36. Everything below that is not one of those decisions is the session's judgment.

### What was taken and what was refused

**From the two videos on one orchestrator across several machines.**

- Taken: a queue shown one item at a time, most important first. It belongs to TC2, in W16's deep plan.
- Taken: writing a project's mission note (I6) by probing its boundaries with hypothetical changes. A good note lets a plan's author decide without asking, which matters because all 37 of v3's questionables were decided as recommended.
- Taken: the phone's terminal as the bridge until owner presses exist (G8, A13).
- Refused: agents that merge on their own. Landing is human-only (v3 decision 4).
- Refused: an orchestrator that rewrites other agents' instructions. That is generated content changing its own controls. The legal form is a trap plus an owner commit.
- Refused: heavy work sent to paid cloud agents. W06 routes inside the owner's subscriptions.
- Refused: a second orchestrator on a second machine (D32), a terminal dial as the phone's main surface (D7), and voice profiles of real people.

**From the headless-host recipe, changed for this factory.**

- The agent's account is the unprivileged one. A separate owner account holds the push credential and performs owner acts. Otherwise the terminal check is the only barrier between an agent and an owner act.
- The setup is a script in git. An agent's memory of what it did ends with its session.
- A laptop used as a server keeps its battery charged for years, so a charge limit is part of the setup.
- A server with a browser kiosk runs on the built-in graphics adapter and needs no extra graphics driver.

**From the elephant-goldfish plugin.** Facts read from its public repository:

- Its review has five stages: a first zoom-out, a comprehension test on the document alone, a critic review, a second zoom-out, and an implementation-readiness test. A human gate follows each stage.
- Its resolve step sorts each finding into propose a fix, contest, escalate or decline, and edits the document only after the human answers.
- Its drift report compares a folder of design documents with the code, on request, and changes nothing.

The session's recommendation, to be settled after the backtest (D35):

- The review belongs in plan authoring. The factory already has a zero-context reviewer for code and W07 is one for the product. The plan is the one artifact without one.
- Two lenses earn their cost: grounding, which checks a plan's claims against the code, and readiness, which asks whether a builder holding only the ticket could do the work. The readiness reviewer is handed the trap list as its checklist.
- Take the pattern and do not install the plugin. It would bring a second plan format beside the one invariant 12 checks.
- Two of resolve's rules are worth taking: a contest must be checkable, and a finding is escalated when the answer needs the owner's knowledge.
- The plan stays lean. Findings live in a review record, and only blockers and owner questions enter the plan.
- Non-Goals is the one section of the plugin's template that W02's and W03's plans lack by that name. PS4 should check it.
- For drift, commands are already fenced (`core/test/unit/meta/doc-reconciliation.test.ts`). Not covered: the vision doc against decisions, spine status, the frame index (G7) and counts in prose. Countable facts should become fences, and a model's drift read fits two moments only: when a workstream closes and before a deep plan is authored.

### The acceptance bar for an always-on host

| Code | Line |
| --- | --- |
| AB1 | `awsf doctor` is green on the box. |
| AB2 | The full `npm test` passes twice in a row, including the journeys that need the sandbox, in no more time than the current WSL host takes. |
| AB3 | The trap suite passes. |
| AB4 | One real shift lands with the Mac asleep, with no disk swap in steady state and no process killed for memory. |
| AB5 | It survives a restart, a network drop in the middle of a run, and seven days up. |
| AB6 | From the phone on mobile data: read status and perform one owner act. |

**Judged again at 8 GB.** The bar holds. The setup around it changes.

- One worker at a time. No parallel shifts.
- The kiosk browser runs only if AB4 still passes with it open.
- Swap is compressed memory first, with a small swap file on disk as overflow. A memory watchdog ends the worker before the box freezes, so a run fails as BLOCKED and can be retried.
- If AB2 fails for memory, the test runner's parallelism is capped before the laptop is given up. That is a change to how the gates are invoked and needs its own decision.
- Evidence that 8 GB is not the obstacle by itself: on 2026-11-14 the factory's own programs used about 1 GB at rest inside a WSL machine capped at 5 GB. The limit that remains is the processor, four cores from 2017. Suites will pass slowly. No native-Linux timing exists yet.

### The test booted from USB (A11)

It covers AB1 to AB3. AB4 to AB6 need a real install and provider logins, so they come later (A14).

1. Finish the owner-side upkeep of the machine first.
2. Write Ubuntu Desktop 24.04 LTS to a USB stick with a persistence partition, so the work lives on the stick and not in memory. The Server image has no live session. A desktop running during the test makes the result pessimistic, which is the safe direction.
3. Boot it and choose to try it. Do not open the installer. Do not mount the internal disks.
4. Install git, bubblewrap and Node 22, clone this repository from its public address, and run `npm ci`.
5. Enable the stock bwrap AppArmor profile (D34) and confirm that bwrap can create a user namespace.
6. Run `npm run awsf -- doctor`, then `npm test` twice. Record the time of each layer and the peak memory.
7. It passes when AB1 to AB3 are green on both runs. Rows of `doctor` about provider logins are out of scope here. Time on a USB stick is recorded and not judged.

Not verified: the path of the stock profile on 24.04, and how `doctor` behaves in a fresh clone with no providers. The session that helps run the test confirms both on the box.

### Uses for the laptop, whichever way the test goes

| Code | Use | Needs the bar? |
| --- | --- | --- |
| AU1 | The always-on factory host of D31. | Yes |
| AU2 | A touch kiosk that shows one tecla served by the host. | No |
| AU3 | The clean machine. W07's user-testing validator wants a machine that has never seen the factory. | No |
| AU4 | A place to run the sandboxed journeys that CI cannot run. On a public repository, outside pull requests must never run there. | AB1 to AB3 |
