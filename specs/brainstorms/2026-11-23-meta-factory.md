# Meta factory brainstorm, 2026-11-23

**Status:** brainstorm record. Nothing in this file is a rule. A rule changes only by an owner commit through gate GA of `specs/awsf-v3-plan.html`.

**Written:** 2026-11-23, in a direct session with the owner, after the owner ruled on Q64 to Q73 and HY1 to HY8 and asked for the record. **To resume work, read sections 2 and 12 first.**

**Follows:** `specs/brainstorms/2026-11-18-small-agent-teams.md`. The codes K10+, C17+, G21+, Q64+ and P7+ continue its series. HY, JB and S are new here.

**Captured:** the owner said on 2026-11-23 that the vision for the Meta Factory video is captured. The rest of the package is still in iteration.

**Sources:** a package of earlier brainstorms the owner iterated with a second assistant. It lives outside this repository. Its main source is IndyDevDan, "The Meta Software Factory: Advanced Agentic Engineering", <https://youtu.be/PuHDu3Kn8sQ>. Of the package's 100 frames from that video, 59 were opened for this record. The other 41 were read through the package's frame guide. A frame is cited by its timestamp, so frame 1607 is 16:07. Neither the transcript nor the frames are stored here. Two primary pages were also read: the Code Mode documentation at <https://code.claude.com/docs/en/code-mode> and the vision skill at <https://github.com/kunchenguid/vision>.

## How to read this

| Code | Meaning |
| --- | --- |
| Q | a question, with the owner's ruling in section 2 |
| HY | a hypothetical that tests the vision's boundary, with the owner's ruling in section 2 |
| K | a correction to the source package, checked against the frames or the primary page |
| C | conflict between the vision and what is decided |
| S | a reason that justifies a second installation |
| JB | a kind of job |
| G | gap: something the vision leaves out |
| P | planned step |

## 1. The idea

The video shows a factory that builds factories. Its team is a Lead, an agent that keeps the empty-factory templates, and one owner agent per running factory. A change moves through a fixed pipeline, waits for a human yes, and stays in a changelog. One factory's Lead tells another's what changed through a mailbox.

Here the idea is read for what it means in AWSF: how many factories and journals there are, what a changelog and a mailbox become, how the owner sees what Marimba may do, and where a project keeps its direction.

## 2. Rulings

All made on 2026-11-23, all as recommended. A ruling here sets direction. It authorizes no build, ticket, amendment or commit.

| Code | Question | Ruling | What it needs before it takes effect |
| --- | --- | --- | --- |
| Q64 | How does D31 read? | One installation, many project cells, and a host journal on top. A second installation only under S1 to S3 (section 5). | The host journal is designed in W05 and W06. |
| Q65 | Who holds the lease? | The Delegate holds it and acts. Marimba shows it. | Nothing. Invariant 13 and decision 14 stay. |
| Q66 | How is Marimba's access shown? | An access line, and a pendulum at rest or swinging. One colour. | Frames (P13). The one-colour ruling of 2026-11-20 stands, and the green gradient proposed on 2026-11-23 is dropped. |
| Q67 | What bounds a routine? | A lease that ends at most 12 hours after the owner's last press. It replaces D15's clause about the open dashboard from the day the always-on host exists. Until then D15 holds as written. | C22 and C24 are settled first. |
| Q68 | Name of the handoff surface | Puente. The record stays a handoff. | Nothing. |
| Q69 | Do code-only jobs need a lease? | No, as `doctor` does not. They run on open, on request, or in external CI. | Nothing. |
| Q70 | Where does a project keep its mission? | `MISSION.md` at the root of the project's plan repository, protected. | One protected-path amendment through GA per repository. |
| Q71 | When does Smart Health run its first attempt? | Right after T15. | T15, and the offline check in P9. |
| Q72 | Where does the changelog tecla go? | TC5, after TC3. | W16's deep plan. |
| Q73 | Sort the whole-project review's 859 findings by the cheapest layer that would have caught each? | Yes, read only. | Nothing. |

| Code | Case | Ruling |
| --- | --- | --- |
| HY1 | A landing breaks the host while a Smart Health run waits. Give Smart Health its own installation? | No. Pin the host revision. |
| HY2 | A trap learned in one project would help another. Apply it there without a press? | No. One card per project. |
| HY3 | A code-only check finds drift while the owner sleeps. May it add a backlog item? | It records the finding. The backlog item waits for the owner's next press. At a clock time this can only be external CI (C24). |
| HY4 | Under a live lease the owner tells Marimba "raise it by one". Is Marimba's message the act? | No. The Delegate checks the lease and acts. |
| HY5 | A better role prompt lands in AWSF. Does another project get it at its next attempt? | No. A one-line version bump the owner commits. |
| HY6 | The owner has approved things the mission note says to resist. May Marimba open a card with a mission diff? | Yes, as a card. Never as a commit. |
| HY7 | A planning member on one project wants to read another's lessons. | Yes for lessons marked factory. No for runs. |
| HY8 | Work for a client arrives. Same installation, separate cell? | No. That is S2. |

### How earlier decisions read now

| Decision | Reads now |
| --- | --- |
| D31 | One installation on an always-on Linux box, holding many project cells under one state root. "One journal" means that one root: a tree of journals with a host level on top, once W05 and W06 design it. The rest of D31 is unchanged. |
| D32 | Unchanged. There is one Marimba. |
| D15 and D33 | Unchanged until the always-on host exists. From then, Q67 replaces the clause about the open dashboard. |
| D16 (I6) | Unchanged, and it now has a file: `MISSION.md`. |
| D30 | Unchanged. It covers the cloud Marimba's handoffs. Section 7 adds the receiver's rules. |
| Tecla order | TC1, TC2, TC3, TC5, TC4. |

## 3. Corrections to the source package

| Code | Package says | What the source shows | Evidence |
| --- | --- | --- | --- |
| K12 | The notes harness is a concrete backport. | No backport runs in the frames. The harness was added straight to the template before any factory existed. The mailbox entry is labelled "at import". The agent says there are "no additions and nothing to backport". | frames 0600, 1112, 1311, 1312 |
| K13 | A feature in the template reaches every factory. | It reaches "every factory after it". Six jobs are listed, and none updates a factory that already runs. | frames 0902, 1156, and one full-screen frame of the Jobs panel |
| K14 | "One owner per factory" is the design. | The graduation check "measures each shortcut this factory takes (one process, a roster that restarts, one registry file, agents that create agents, one owner per factory)". The video's own code lists both as shortcuts. | the Jobs panel |
| K15 | The gate is code: a tool refuses without an approved decision. | The gate covers only the tools. The template was cloned without one: "there is no tool for creating a template, so I did it by hand". The agent edited the registry from a shell and committed. | frames 1104, 1436 |
| K16 | A factory message is data only. | The video's message says "Read it and act on it inside your own lane. It asks for no answer". Data-only is D30's rule. | frame 2332 |
| K17 | The video shows two message ids for one message. | It shows one, `FM-40A7FE5D`, and one commit, `cb5d1ee`. The thread is `FT-24A69B57`. | frames 2332, 2336, 2426, 2429 |
| K18 | Build cost, line counts, tool names. | Build $0.10. Owner diff +949 −82, with +243 for the Lead's settings and +234 for each of three members. `team_retire`. `factory_mailbox_list_factories` lists factories and not messages. | frames 2204, 2303, 2408, 1311 |
| K19 | The pipeline's stages map onto the machine's states. | "Approved" means two things. CH-1 was written and tested before it was asked, so its yes is a yes to land. CH-3 was approved before any work, ran on trial, then got a second yes. | frames 1452, 1607, 2138, 2303 |
| K20 | The changelog is a log like the journal. | A template's changelog is stored "in template.json beside the code". Invariants 1 and 10 refuse that here. | frame 1301 |
| K21 | Jobs run on cron. | Every schedule shown is off and never ran. The only timer running is the Lead's catch-up. "Run now" and "Schedule" are separate controls. | frames 0447, 1156, 2417, and the Cron panel |
| K22 | The first run cost $0.61. | That is one run. The per-agent counters at the end add to at least $12.19. No cost appears on CH-1's record. | frames 2204, 2303, 2332, 2426, 2441 |
| K23 | The features are F46 to F51. | Five of Level 4's 14 features appear. F47 and eight others were not captured, and no frame covers 0:00 to 4:37. | the package's frame guide |
| K24 | The vision skill writes `strategy.md` from 10 hypotheticals. | It writes `VISION.md` when one exists, and otherwise a Vision section of `STRATEGY.md`. It asks 8 to 12. "If you can predict the author's answer, replace the hypothetical." Its review board runs an unpinned package. | the skill's `SKILL.md` |
| K25 | Teclas are the reuse that backporting points at. | A tecla is a view. A backport moves tools and code. They sit on different rungs, and a recipe carries no HTML (D6). V1 still holds: on 2026-11-23 pi 1.5.2 lists GPT-6.2 only under OpenRouter. | `pi --list-models` |
| K26 | Code Mode is open for factory workers. | It needs an interactive session. The Claude worker runs `--print` and the pi worker runs `-p`. `core/src` has no MCP code, and a worker has at most seven tools. | the documentation, `core/src/adapters/claude-code.ts:438`, `core/src/adapters/pi-codex.ts:618` |

K10 and K11 concern the package's own dates and are left out.

## 4. Conflicts with what is decided

| Code | The vision says | What is decided | Resolution |
| --- | --- | --- | --- |
| C17 | A lease gives Marimba powers. | Invariant 13: the Delegate acts under a lease. Decision 14: no model emits an owner act. W19: "Marimba stays denied every `awsf delegate` verb, so it can never create, widen or switch a lease." | Q65. One name on screen and two parts below it. The Delegate is host code and never talks. |
| C18 | A green for each agent, darkest for the one with the most access. | The canvas ruling of 2026-11-20: one colour for lanes, told apart by shape and icon. D28: a theme belongs to a project. | Q66, and section 8. |
| C19 | One agent owner per factory. | The owner's direction of the same day: Marimba is the only agent the owner talks to. | Take the owner's list, which is the changelog. Drop the agent and the hiring. |
| C20 | An agent lands a template change. | E4 and decision 14: generated work never rewrites the controls that authorize it. Role prompts, gates and config are rung 3. | A prepared patch and an owner commit (FL7). |
| C21 | Does D15 help or hold back? | D15 bounds a routine by the open dashboard. D31 puts the factory on an always-on box. | On a laptop the clause holds back. On an always-on box with a dashboard open it bounds nothing. Q67. |
| C22 | Routines run under a lease. | Invariant 13 defines a lease as task-scoped. A routine has no task. | Open. D15 needs an amendment or a task per routine. W05's re-cut settles it. |
| C23 | A vision file lets agents decide alone. | Landing is human-only. | The mission note may refuse, hold, or answer an author's fork. It never accepts or lands. |
| C24 | A routine may run at a clock time (D15). | `specs/tickets/awsf-v3-plan/W14.md` plans "a fence that no AWSF code registers a timer, service or background process". | Open. D26, "when this dashboard opens", fits that fence. A clock time does not. W05's re-cut and W14 settle it with Q67 and C22. |

## 5. One factory or many

### What the word means in each system

| | The video's factory | AWSF |
| --- | --- | --- |
| What it is | A copied app with its own server, port, repository, team and mailbox (frames 1643, 1723). An init command copies it into the product's repository (frame 0817). | One host program. A project is a registration: catalog, placement, config, roles and gates. |
| How a feature spreads | A change to the template, and only later copies get it. | A landing in `core/`. Every project has it at its next attempt. |
| What is copied per project | All of the code. | The prompts and the config. |
| Measured drift | Not shown. | On 2026-11-23, 37 prompt files copied into three Smart Health repositories. All 37 are byte-identical to AWSF's. |

The video needs templates and backports because it copies the code. AWSF does not copy it, so that problem is mostly absent here.

### The journal tree

| Level | Holds | Today |
| --- | --- | --- |
| Host | leases across projects, daily quota ceilings, routines, signals, project registration, host revision | missing |
| Project | driving-session groups, closure records | 8 group journals |
| Task and attempt | every run | 195 attempt journals across two projects |

The database is a projection rebuilt from these. The part missing is the top.

### Options considered

| Option | Buys | Costs |
| --- | --- | --- |
| O1 Keep D31's wording | Nothing to change. | The wording hides the tree, and the top level has no owner. |
| O2 One installation, many cells, a host journal (taken) | Each project has its own mission, gates, roles, theme, changelog and goal threads. One quota ledger, one lease authority, one queue of presses. | One host-level journal, and project scope in every dashboard view. |
| O3 Several installations and a meta layer | Isolation from a bad host landing. Separate owners. | Two ledgers can both reserve the same subscription window, so W06's daily ceiling cannot hold. Passkeys, gates, traps, migrations and backups are done twice. Evidence spans two journals. |
| O4 One journal file for everything | One place to look. | It breaks per-attempt locks and gap detection, and every read grows. Reads that grew with the journal already caused stranded reviews (`833f8dc`). |

A subscription window is one resource, so it needs one ledger. That decides it.

### When a second installation is right

- **S1.** A second person signs landings (US25).
- **S2.** Records that may not share an operating-system account, such as an employer's or a client's.
- **S3.** A machine that must land while it cannot reach the first.

A bad AWSF landing stopping another project's work is the best argument for O3. The cheaper answer is to run that project from a host checkout pinned at a published revision (HY1).

## 6. The changelog and the journal as one thing

Nobody writes a changelog entry. The host's events are the entry. The reason is the owner's own words, already captured in the request and the group.

| The video's changelog | Frame | AWSF's record | Exists |
| --- | --- | --- | --- |
| Change id and title | 1607 | the task, with a display number per project | derivable |
| Reason | 1607 | `request_text`, and the group's captured input | yes |
| detected | 1607 | a captured ask, later a signal (W14) | partly |
| drafted | 1607 | DRAFT | yes |
| asked | 1452 | preflight passed, no confirmation yet | derivable |
| approved, to start | 2138 | `awsf.request-confirmation/v1` | yes |
| trial | 2303 | RUNNING to AWAITING_OWNER, with gates, review, preview and journey | yes |
| approved, to land | 1607 | the land act (edge L20, human only) | yes |
| promoted | 1607 | LANDED | yes |
| no failure stage | | BLOCKED and CANCELLED, with a cause | yes |
| no publish stage | | PUBLISHED | yes |
| "You approved it: M-12 and M-16" | 2303 | two rows, one for start and one for land (K19) | yes |
| Evidence bullets | 1607 | gate results, review verdict, review limitations | yes |
| Files and counts | 2303 | `candidateDiffStat` (`core/src/api/routes.ts:676`) | yes |
| Commit | 2303 | `candidate_sha` | yes |
| Cost and time | 2204 | window share labelled as an estimate (Q54), phase durations | yes |
| History with an actor | 2453 | `transitions.actor`: host, owner, human, delegate | yes |
| Rule commits and direct sessions | | none until W04 (Q11) | no |

Three rules follow.

1. Failures show. Of 95 attempts that are not prove replays, 35 landed and 51 ended BLOCKED or CANCELLED.
2. Starting and landing stay two rows with two records.
3. No changelog file is ever committed (K20).

**Readers.** The owner, as a view per project. Marimba, when a conversation opens, as "since you last looked". The next plan author, through W09.

## 7. The handoff and the mailbox as one thing

Transport is needed only between machines that do not share a state root.

| Case | Transport | Record |
| --- | --- | --- |
| Project to project, same installation | none | a handoff record in the host journal, shown as a row in the receiving project's Signals |
| Cloud Marimba to factory, and back | files in git (D30) | the handoff file |
| Installation to installation | mailbox tools, only after S1, S2 or S3 | the handoff file |

**The record.** Id, thread, from, to, the change it reports (task and landed commit), what it prepared, what needs the owner, what it could not check, the context mark, and the commit it was read at.

**Rules for the receiver.**

1. Take it in, send nothing back, tell nobody unless it changes their work. The video's definition of done.
2. The owner's requests, the mission and a human gate come first. The video's.
3. It is data until the owner confirms it. D30's, in place of the video's "act on it".
4. Check every claim against your own records before using it. In frame 2325 the receiving Lead found one claim already out of date.
5. One notice per landed change, keyed by the landed commit.

## 8. Seeing how much access Marimba has

Three facts that records already hold: the class of the next step (K2's `who`), the live lease, and the role's tool profile.

**The access line** is one line in the strip and the dock header, always visible. It says what Marimba does without a lease, or the live lease's end and acts, and always the acts Marimba never takes. Frame 7 of the canvas already draws the full detail. What is missing is the line seen without opening it.

**The pendulum** is Marimba's mark. At rest means no lease. Swinging means a lease is live. Members hang on the same beam, with their name and list label.

**Why not a ramp of greens.** Contrast of each Forest green against its ground. A mark needs 3 to 1.

| Green | On the dark ground `#051F20` | On the light ground `#DAF1DE` |
| --- | --- | --- |
| `#051F20` | 1.00 | 14.40 |
| `#0B2B26` | 1.13 | 12.70 |
| `#163832` | 1.35 | 10.70 |
| `#235347` | 1.96 | 7.34 |
| `#8EB69B` | 7.61 | 1.89 |
| `#DAF1DE` | 14.40 | 1.00 |

1. On the dark ground the darkest green is the least visible, so the agent with the most access would be the hardest to see.
2. On the dark ground two of six pass. On the light ground four pass, but neighbours differ by 1.13, 1.19 and 1.46 to 1.
3. Access changes when a lease starts or ends, and identity does not. One colour cannot carry both.
4. Forest greens exist only in the Forest palette, and D28 uses the palette to tell which project is open.

## 9. Jobs

A job is a workflow. A routine is a schedule. D15 binds only the third kind below.

| Code | Kind | The video's example | Here | Lease |
| --- | --- | --- | --- | --- |
| JB1 | code only, reads, no model | templates-scan, templates-sync, graduation-check | same class as `doctor` | none (Q69) |
| JB2 | code with one agent step that makes a candidate | template-change, backport | an ordinary attempt | the owner's confirmation |
| JB3 | a prompt on a schedule | none shown on | a routine | yes (D15, Q67) |
| JB4 | a timer that wakes the Lead | team catch-up | not adopted. The host emits events and the dashboard polls them. | |

`templates-sync` "reports anything the spec claims that the code does not have", as code, with no model (frame 1156). It supports section 22 of the 2026-11-09 record: countable facts become fences.

## 10. Recommendations the owner has not ruled on

| Topic | Recommendation |
| --- | --- |
| Gate in code or host gate | One gate, and it is the host's. A tool's refusal is early notice. An agent with a shell walks around a tool's gate (K15). |
| Templates | Files in the repository. A change lands as a commit. A view travels as a recipe version (canvas frame 25). Build nothing while the copies match. |
| F46 to F51 in the design | F46 and F49 are drawn. F50's list is TC5. F51 is one row in Signals. F48 waits for a third project. Hiring is not adopted. |
| Skill candidates | Sort review findings by the cheapest layer first (Q73), then hypotheticals, then tagging lines that A12 can test by removing them, then a words list. |
| Bitter-lesson tagging | plan-sota first. Not role prompts, because each is copied into three repositories. |
| Grilling | Before the plan, as hypotheticals. Questionables sit inside the plan. The team reviews after it. All 37 of v3's questionables went as recommended, so the vision skill's replacement rule (K24) is the fix. |
| RLVR | Unverified. The re-grade of 2026-10-20 measured 5.7 bugs per kLOC in factory code and 5.9 in direct code, so more prose has no support here. It argues for checks. |
| Code Mode | A client-side choice. The model may chain, filter, dedupe and read in parallel inside one phase. The host keeps state, gates, evidence, diffs and landing. A REPL, if ever, is per member, and nothing in a variable is evidence. Not in a driving session, because a hook can receive `cd 'app' && git push`. |
| Plan as a variable | Complementary. PS3 and PS4 come first. |
| Fork or chat room | The room for planning, since every line is a record. `prove` already is fork and compare. |
| Plan review, EGM | As section 22 of the 2026-11-09 record says. It waits on A12. |
| Distilled self-bot | No. Mission notes and cited lookup (W09) give the useful half. A personal corpus stays out of git (D30). |
| Distilling other people | Cited sources yes. A persona or a voice, no. |
| Voice in (G10) | Dictation from the operating system first. Take only a custom word list, generated from the project's words. |
| The mission note | 40 to 70 lines. The opening paragraph is the mission. The rest is what aligns and what is resisted. A planning session drafts it from history, the owner answers hypotheticals, and the owner commits it. Each verdict maps to a named edit. |

## 11. Gaps

| Code | Gap |
| --- | --- |
| G21 | The last attempt started on 2026-10-12. Since then the design grew from 19 frames to 65, and T15 is still open. A meta layer multiplies what the factory does. |
| G22 | No host-level journal (section 5). |
| G23 | No project scope in the dashboard. The sessions list mixes projects with no filter (`core/src/observability/queries.ts:105`). Health and groups answer only for the project the server was started on (`core/src/api/routes.ts:607`, `:785`, `:792`). |
| G24 | Rule commits and direct sessions are in no journal until W04, so a changelog drawn earlier is incomplete. |
| G25 | A routine's lease has no legal shape (C22), and a clock-time routine has no legal timer (C24). |
| G26 | No measure for the meta layer. Proposed: days, owner minutes and attempts from registering a project to its first landing. Smart Health was configured on 2026-09-23 and has no attempt. |
| G27 | F47, eight more features and 0:00 to 4:37 are unseen. |
| G28 | The canvas rulings of 2026-11-20 reused D1, D4 and D5, which already name brainstorm decisions. They are CD1, CD4 and CD5 from here on. |

## 12. Planned

| Code | Step | Waits on |
| --- | --- | --- |
| P7 | Record this round. Done by this file. | |
| P8 | T15, then A12, as already ordered. | |
| P9 | One Smart Health attempt, landed. One ticket, one repository, measured by G26. Before any spend, check offline that one Smart Health ticket can run outside a shift. | T15 (Q71). A12 does not block it. |
| P10 | Two mission notes by hypotheticals, AWSF and Smart Health. Documents only, owner commits, with the protected path through GA. | P8 |
| P11 | Sort the 859 findings by the cheapest layer that would have caught each. Read only. Feeds W07, W11 and new fences. | |
| P12 | Carry these into deep plans as each is authored. W04: the changelog's missing row. W05's re-cut: the access line's record, and C22 and C24. W06: the daily ceiling in a host journal. W08: the project switcher. W16: TC5. | each deep plan |
| P13 | Three frames in the second canvas, ported once as P1 was: the changelog, the access line's states, the project switcher. | W08's authoring |

The order of work in section 13 of the 2026-11-09 record still holds, with T15 first.

**Not to build:** a template agent, hiring, a meta service, mailbox tools between projects, a minute timer, a backport job, a changelog file, a second installation, the vision skill as a package, a Code Mode worker.

## 13. Not verified

- Whether a pinned older host reads a state root that a newer host has migrated (HY1).
- Whether one Smart Health ticket can run outside a shift from its own repository (P9).
- The token size of Smart Health's 47 tool schemas.
- What F47 is.
- The 41 frames read only through the guide.
- Kun Chen's RLVR claim, and the video's claim that 80 to 90% of daily engineering work repeats.
