# plan-sota review, 2026-11-11

**Status:** review, with the owner's rulings in section 13. The skill's text changed on 2026-11-11 (section 14). No plan and no format was changed. Every change below is the owner's to decide, and the rule changes go through gate GA.

**Asked for by the owner** on 2026-11-11, before any change to the plan format: judge the plan-sota skill and the plans it has produced, find what is redundant, and say how to spend fewer tokens without losing quality.

**Read for this review:** the skill (`~/.claude/skills/plan-sota/`, 11 files), all 22 plans in `specs/`, their prompt files and 377 tickets, the v3 spine and its three deep plans in detail, the latest v2 deep plans (W17, W18, W19), the factory's plan readers in `core/src/registry/`, and Marimba's priming command.

## 1. Verdict

The content of the plans is good. The format is not in its best state.

W01 and W02 were authored and closed in three and two days each, and the owner took the author's recommendation on all 37 questionables in v3. So the thinking in the plans holds up.

The weight is elsewhere. About 40% of what the skill makes the model write for a deep plan is styling, fixed script, HTML tags and a second copy of the build prompts. About 45% of what a later reader loads from a finished plan is history. Neither helps a builder, a driver or the owner.

A leaner format can cut the output of authoring a deep plan by roughly 40%, and what a later reader loads by roughly 60%, with the same content. Section 6 shows the arithmetic.

## 2. What was measured

All numbers come from the files at commit `39360f8`. Sizes are bytes. Token figures use 4 bytes per token and are estimates.

| Measure | Value | How |
| --- | --- | --- |
| Plans | 22 | `specs/*.html` |
| Plan HTML, total | 4.30 MB | sum of file sizes |
| Readable text in it | 2.96 MB | tags, styles and scripts stripped |
| Styling in it | 234 KB | `<style>` blocks |
| Script in it | 255 KB | `<script>` blocks |
| Distinct style blocks | 20 of 22 | hash of each plan's styles |
| Prompt files, total | 1.50 MB | `specs/*-build-prompts.md` |
| Tickets | 377, 1.88 MB | `specs/tickets/*/` |

The three v3 deep plans:

| Plan | HTML at first commit | HTML now | Prompt file | Tickets | Tickets, milestones |
| --- | --- | --- | --- | --- | --- |
| W01 driver checks | 105.7 KB | 140.2 KB | 60.5 KB | 85.9 KB | 13, 5 |
| W02 trap suite | 123.5 KB | 152.6 KB | 64.3 KB | 91.7 KB | 16, 6 |
| W03 ticket closure | 110.9 KB | 124.1 KB | 54.6 KB | 79.4 KB | 15, 7 |

Where the words of a finished plan sit, as a share of its readable text:

| Section | Spine v3 | W02 | W03 |
| --- | --- | --- | --- |
| Workstreams or implementation phases | 42% | 20% | 20% |
| Amendments | 11% | 28% | 18% |
| Questionables | 16% | 9% | 14% |
| Notes | 6% | 12% | 10% |
| Owner gates and fences | 8% | 7% | 10% |
| Everything else | 17% | 24% | 28% |

## 3. Findings

**PF1. One fifth of every plan is styling and fixed script.**
- Evidence: W03 carries 11.4 KB of styles and 13.0 KB of script, 19.7% of the file. The skill tells the model to derive a new theme for each plan and to copy the review layer verbatim (`SKILL.md`, lines 39 and 44). 20 of 22 plans have their own style block.
- Cost: about 6,000 output tokens per plan that carry no plan content. 489 KB across the corpus.
- Recommendation: no plan carries styles or script. The dashboard draws the plan (TC3, frame 44).

**PF2. The build prompts are stored twice.**
- Evidence: 60% of W03's ticket bytes (48.3 KB of 79.2 KB) are the build prompt, byte for byte the same as Section B of its prompt file (54.6 KB). Invariant 12 requires that equality. A script in the skill copies them (`scripts/sync_prompts.py`).
- Cost: about 1.1 MB of second copies in the repository. Each copy is one more thing a fence must check and a reader may load.
- Recommendation: one home for a prompt. The ticket holds it. The prompt file is generated when something needs it, or dropped.

**PF3. The plan and its prompts describe the same tasks in two separately written texts.**
- Evidence: fewer than 450 bytes of prompt lines appear in any v3 plan's text. W03's phases section is about 14 KB and its prompt file is 54.6 KB.
- Cost: the author writes each task twice, in two voices, and the two can drift. The builder only ever receives the prompt.
- Recommendation: the plan lists each task in one line and links its ticket. The detail lives in the ticket only.

**PF4. Finished plans are mostly history.**
- Evidence: amendments are 18% to 28% of a deep plan's text, with 8 to 13 entries and 27 KB to 44 KB per plan. Decided questionables keep every rejected option at full length. Together with notes that is 39% to 49% of the text.
- Cost: Marimba's priming loads the workstream's deep plan when it works on it (`docs/driving/commands/prime-awsf.md:73`). Half of that load is the past.
- Recommendation: a plan holds what is true now. History moves to a file beside it, append-only, that nothing loads by default.

**PF5. The factory reads almost none of the plan.**
- Evidence: the parser takes milestone headings, task headings, status marks, the invariant and acceptance declarations and the `serves` codes (`core/src/registry/plan-source.ts`, lines 110, 154, 232, 250, 255). That is a few kilobytes of a 124 KB file.
- Cost: the factory parses HTML with patterns to recover what is really a small table.
- Recommendation: that table becomes data the factory reads directly.

**PF6. The factory already has a structured plan and a renderer, and the skill does not use them.**
- Evidence: `core/src/contracts/design-plan-output.ts` defines milestones, steps with files, `serves`, `dependsOn` and a build prompt, a test strategy, risks and open questions. `core/src/registry/plan-render.ts` turns that into plan HTML in 179 lines. The `design-to-plan` workflow has run 5 times. All 22 plans in `specs/` carry the skill's review layer, so all of them came through the skill instead.
- Cost: two ways to make a plan, with two shapes of output.
- Recommendation: one shape. The skill fills the factory's structure, extended with the sections worth keeping.

**PF7. Every questionable in v3 was decided as recommended.**
- Evidence: 37 of 37. Spine 13, W01 7, W02 8, W03 9. Each plan says "the owner took the recommendation on each".
- Cost: questionables are 9% to 16% of a plan's text, plus the owner's reading time, for decisions that never went the other way.
- Recommendation: a questionable is raised only when the choice is the owner's by rule (authority, money, something that cannot be undone) or when the author is unsure. Everything else is a one-line "decided by the author" that the owner may veto.

**PF8. Plans are amended within days of being written.**
- Evidence: 12 commits touch W01's plan between 2026-10-04 and 2026-10-07. W02 has 12 amendment entries in two days.
- Cost: detail written up front is corrected by what the build finds. The correction is then stored forever (PF4).
- Recommendation: the plan fixes intent, order and what done means. Step-by-step detail is written into the ticket just before it is built.

**PF9. The skill is heavy to load.**
- Evidence: `SKILL.md` is 35.2 KB. About a third of it is the review layer's style and script, and another third is the HTML template.
- Cost: about 9,000 tokens each time the skill is invoked, before any file is read.
- Recommendation: once plans carry no HTML, the skill shrinks to instructions and a short outline.

**PF10. Each diagram is written by hand and few readers see it.**
- Evidence: 7 to 9 diagram blocks per v3 deep plan. Only a browser draws them. A builder and the factory never do.
- Cost: small in bytes, larger in author attention.
- Recommendation: at most two per plan, and only where order or ownership is hard to say in words.

## 4. What to keep

- **PK1. In Plain Language.** It is 3% of a plan and the only part written for the owner. Keep it first, and cap it near 250 words.
- **PK2. The identifier spine.** Invariants and acceptance criteria with ids, and tickets that say which they serve. This is what makes "done" checkable.
- **PK3. Owner gates named in the plan.** They are where a milestone is allowed to stop.
- **PK4. Deep plans written just in time.** Twelve workstreams have no deep plan, and that is correct.
- **PK5. The Handoff section of a ticket.** It is where one worker's findings reach the next.
- **PK6. One writable repository per milestone.**
- **PK7. Status marks that only a landing can earn.**

## 5. A leaner shape

This is a proposal to judge, and nothing here is built.

A plan is three kinds of file, each with one job:

| File | Holds | Who reads it |
| --- | --- | --- |
| The plan | plain language, decisions taken, identifiers, milestones with one line per ticket, owner gates, open questions | the owner, and Marimba when it works on the workstream |
| The tickets | one per task: what it is, handoff, the build prompt, what done means | the builder and the reviewer |
| The history | amendments and decided questions with their rejected options | whoever asks why |

Rules of the shape:

- No styles, no script, no HTML tags. Plain text with a small data header the factory reads.
- The header carries what the parser needs today: milestones, tasks, status, identifiers, `serves`.
- A prompt exists once, in its ticket.
- The dashboard draws the plan. Questionables become buttons there, which replaces the review layer and its export block.
- The existing 22 plans are converted by a script, checked against the current parser's output for the same plan.

How today's sections map:

| Today | Leaner shape |
| --- | --- |
| In Plain Language | kept |
| Purpose, Problem, Solution | folded into one short "What and why" |
| Relevant Files | moved to each ticket |
| Identifier Spine | kept, as data |
| Execution, owner gates and fences | kept, shorter |
| Implementation Phases | milestones with one line per ticket |
| Validation Commands | moved to the tickets and the gates |
| Questionables | open ones only |
| Notes | capped. Risks and rejected approaches only |
| Amendments | moved to the history file |
| Review layer, theme, diagram runtime | removed |

## 6. What it saves

Worked on W03 as first committed. These are estimates from measured sizes.

| | Today | Leaner | Change |
| --- | --- | --- | --- |
| Plan body | 110.9 KB | about 62 KB | no styles, script or tags |
| Prompt file | 54.2 KB | 0 | prompts live in tickets |
| Tickets | 76.6 KB | 76.6 KB | unchanged |
| Written at authoring | 241.7 KB, about 60,000 tokens | about 139 KB, about 35,000 tokens | about 42% less |

Loaded later, when Marimba works on the workstream:

| | Today | Leaner | Change |
| --- | --- | --- | --- |
| The W03 plan | 124.1 KB, about 31,000 tokens | about 50 KB, about 12,500 tokens | about 60% less |

Applying PF7 and PF8 would cut more. That part depends on judgment, so it is left out of the estimate.

For scale: every factory run recorded so far totals about 20.5 million tokens across 194 run records (`GET /api/v1/sessions`, summed by workflow). Plan authoring happens outside the factory, in direct sessions, and its real token cost was not measured.

## 7. Hierarchy and order

**PH1. Some milestones hold one ticket.**
- Evidence: W01 has 1 of 5, W02 has 2 of 6, W03 has 2 of 7, v2 W18 has 3 of 9.
- Judgment: a milestone costs an owner landing. A one-ticket milestone is right when it is a gate, as W03's last one is. It is wrong when it only splits work.
- Recommendation: a milestone exists where the owner must stop and look. Three or four per deep plan is the usual number. A one-ticket milestone states its gate.

**PH2. Four levels are enough, and the fifth copy is the problem.**
- The levels are spine, deep plan, milestone, ticket. Each has a job. The prompt file is a fifth artifact with no job of its own (PF2).

**PH3. The v3 spine no longer matches what was decided.**
- Evidence: the spine was written on 2026-10-02 with 15 workstreams. Since then the owner decided the vision's first task (D9), teclas as W16, owner presses as W17, the vault (D21) and the rooms (D20). None of them is in the spine.
- Judgment: the path to the vision's first task is short. It runs W03's last ticket, then W04, then W08, then W16 with its first tecla. W05, W06, W07 and W09 to W15 are not on that path.
- Recommendation: when AM6 is written, amend the spine in the same step. Mark the path to D9 as the line to finish first, and mark the rest as later.

**PH4. One open ticket has held the spine for a month.**
- Evidence: W03's plan was last changed on 2026-10-12. T15 is still `todo`. No deep plan has been written since 2026-10-09.
- Judgment: D8 makes the tecla plan wait on this ticket. The delay is in the factory, and the plan format did not cause it.
- Recommendation: close T15 before any format work starts.

**PH5. Small work does not need a deep plan.**
- Evidence: v3 decision 8 already provides a light tier, a task with no deep plan.
- Recommendation: use it for the first settings frame (27 Look and feel) and for the room container. Both are small and change no rule.

## 8. Alignment with the vision

The vision asks for software the owner reshapes by asking. Plans serve that in two ways, and both argue for the leaner shape.

- The owner reads plans inside the dashboard (D21). A plan that is data can be drawn there. A plan that is a styled page has to be taken apart first.
- Marimba answers from records (D18). A plan with current truth in one file and history in another gives it the right record for each question.

## 9. Order of change

| Step | What | Rule change needed |
| --- | --- | --- |
| PS0 | The viewer draws today's plan HTML. Decided on 2026-11-11. | none |
| PS1 | Stop making new weight: no per-plan theme, at most two diagrams, questionables only when PF7 says so, less up-front detail. | none. Skill text only |
| PS2 | New amendments go to a history file. | none, if the plan keeps a one-line pointer |
| PS3 | One home for prompts. | invariant 12, its fence, `core/src/registry/plan-admission.ts`, `core/src/cli/commands/production-run.ts` |
| PS4 | The leaner shape, with a converter for the 22 plans. | the plan format named in the catalog, the parser, `awsf close`, the Backlog board |

PS1 and PS2 save tokens on the next plan and touch no rule. PS3 and PS4 are the format change the owner asked to review first.

## 10. Risks

- **PR1.** The skill is also used outside this repository. A change to it changes those plans too.
- **PR2.** `awsf close` edits status marks inside the plan HTML. PS4 must move that edit and its tests together.
- **PR3.** The 22 existing plans must convert without changing what the parser reads from them. The converter needs that as its test.
- **PR4.** The owner reviews plans in a browser today. Until the viewer exists, a plan without styles is harder to read. This is why PS0 comes first.
- **PR5.** Cutting questionables (PF7) removes a check. The veto line keeps the owner able to overrule.

## 11. Questions for the owner

- **Q37.** Start PS1 now? It changes only the skill's text and saves tokens on the next plan.
- **Q38.** Accept PF7: raise a questionable only when the choice is yours by rule or the author is unsure?
- **Q39.** Accept PS3 in principle: the ticket is the one home of a prompt? It needs an amendment to invariant 12.
- **Q40.** Accept PH3: amend the spine around the path to the vision's first task when AM6 is written?
- **Q41.** Should the leaner shape reuse the factory's existing plan structure (PF6), or be designed fresh?

## 12. Not verified

- The token cost of authoring a plan. It happens in direct sessions, and the session logs did not give a clean figure.
- Whether the copy of each prompt in a ticket was written by the model or by the sync script. The estimate in section 6 assumes the model wrote both.
- How the skill's plans are used in other repositories.
- The v2 deep plans before W17 were measured for size only and not read.

## 13. The owner's rulings, 2026-11-11

| Question | Ruling |
| --- | --- |
| Q37, start PS1 now | Yes. Skill text only. Applied the same day (section 14). |
| Q38, accept PF7 | Yes. |
| Q39, accept PS3 in principle | Yes. The ticket is the one home of a prompt. The fence that demands a second identical copy enforced a redundancy that should not have existed, and PS3 corrects it. The sync script's role ends. The owner makes the amendment through GA. |
| Q40, amend the spine around the path to the first task | Left open until the work is done. |
| Q41, reuse the factory's structure or design fresh | Reuse, extended with the sections worth keeping. Section 15 lists what is missing. |
| The leaner shape of section 5 | Accepted with one change: Purpose, Problem and Solution stay three separate sections. The review layer and the per-plan theme go. A diagram stays only where it is needed and beneficial. |
| Migration | Once the new shape works, all of `specs/` is converted. A plan is then data the harness can show. |
| Precondition | T15 closes before the format work starts. On 2026-11-11 its run is still a draft, last touched on 2026-10-12. |

One premise in the rulings does not hold. The skill is used outside this repository: Smart Health Platform has 6 plans that carry the skill's review layer. PR1 therefore applies, and the changes of section 14 reach the next Smart Health plan too.

## 14. PS1 as applied

Changed files: `~/.claude/skills/plan-sota/SKILL.md` and `workflows/create-plan.md`. The skill is not under version control, so the earlier text is kept only as a copy outside the repository.

| Change | Before | After |
| --- | --- | --- |
| Theme | a new theme designed for each plan | one house theme in the template, copied as it is |
| Diagrams | a slot in every section, all to be filled | only where needed and beneficial, two at most, and a plan with none is correct |
| Questionables | raised whenever a choice exists | raised only when the choice is the owner's by rule or the author is unsure. The rest are one-line decisions the owner may veto |
| Detail | each task described in the plan and again in its prompt | the plan fixes intent, order and what done means. The detail is written once, in the ticket |

The house theme uses the dashboard's palette. A UI mockup still uses the target app's own design system.

`SKILL.md` grew from 35.2 KB to 37.2 KB, because the house theme is now written out in it. A plan's own styles drop from 8 KB to 14 KB down to about 1.7 KB, so the change pays for itself on the first plan.

Not measured: no plan has been authored with the new text yet.

## 15. What the factory's structure lacks

`core/src/contracts/design-plan-output.ts` and the host-composed identifier set already hold:

- a title (`summary`)
- `milestones`: id, title
- `steps`: id, title, milestone, files, `serves`, `dependsOn`, `buildPrompt`
- `testStrategy`: a list of sentences
- `risks`: risk, mitigation
- `openQuestions`: a list of sentences
- invariants and acceptance criteria

Missing for a plan:

| Field | Why it is needed |
| --- | --- |
| kind, and for a deep plan its spine and workstream | today inferred from the file name |
| plain language, in its four parts | PK1 |
| purpose, problem, solution | three sections, by the owner's ruling |
| decisions: id, statement, decided by owner or author, date | PF7 |
| owner gates: id, where it sits, what is decided | PK3 |
| a question's parts: id, why it matters, options, the recommended one, the milestone it shapes, its answer and date | `openQuestions` is sentences only, and buttons need options |
| status per milestone | the four marks live only in the HTML today |
| validation commands: the command and what it proves | `testStrategy` is prose |
| rejected approaches: approach, why | `risks` exists, this does not |
| references: back, forward, and for a spine each workstream's deep plan and its state | the links between plans |
| design references: the frame index and the frame ids | section 17 |
| a pointer to the history file | PF4 |
| created and modified dates | metadata |

Missing for a step:

| Field | Why it is needed |
| --- | --- |
| what the ticket is, and its one writable repository | PK6 |
| handoff | PK5 |
| state, tier, workflow | they sit in the ticket's header today |
| what the owner checks | today a block inside the prompt |
| design references | section 17 |

One more gap: a step id must match `^T[0-9]{2}$`. A spine's steps are workstreams with W ids, so the pattern must admit them.

The renderer `core/src/registry/plan-render.ts` draws only the title, the identifier spine and the implementation phases. Every field above also needs its place in what the viewer draws.

## 16. What enforces the second copy of a prompt

PS3 has to change these together:

- Invariant 12 in `AGENTS.md`: "A ticket's build prompt stays byte-identical to its build-prompts § Section B block".
- `core/src/registry/plan-agreement.ts:194`, which reports drift from Section B.
- `core/src/registry/plan-admission.ts:55`, which reads the Section B headings at admission.
- `core/src/cli/commands/production-run.ts:870`, which carries the prompt file into a planning run.
- The tests `core/test/unit/meta/ticket-plan-sync.test.ts`, `core/test/unit/registry/plan-agreement.test.ts` and `core/test/unit/registry/plan-admission.test.ts`.
- The skill's `scripts/sync_prompts.py`, its test, and `workflows/ticket-prompts.md`.

What replaces the guarantee: a prompt exists in one file, so it cannot drift from itself. The check that remains is that a ticket's prompt did not change after its plan was accepted, which closure already tests (`core/src/closure/asked-for.ts`).

## 17. Plan templates as tuned teclas

The owner's idea: keep a spine template and a deep-plan template in the harness as tuned teclas, so a new plan is data poured into a template.

**It is the same thing as the leaner shape, seen from the harness.** It has two halves, and they belong in different places.

| Half | What it is | Where it belongs |
| --- | --- | --- |
| The shape | the fields of sections 5 and 15 | the factory's plan contract, with PS4. The fence, `awsf close` and admission depend on it, so it changes only by owner landing |
| The view | how the dashboard draws a spine and a deep plan | W16. Two tuned views inside the vault (TC3, frame 44) |

A tecla never writes a repository (NR5). So the template shows a plan, and the factory's planning run writes one. "Poured into a template" means the author fills fields and the host checks them.

**How much it saves.** The template removes what PF1 and PF9 measured, and nothing more.

| What stops | Saving |
| --- | --- |
| styles and script written into each plan | about 24 KB per deep plan, a fifth of the file |
| HTML tags around the text | about 24 KB per deep plan |
| the template and the review layer inside the skill | about 23 KB of the skill's 37 KB, on every use |

That is about 20% of what authoring a deep plan writes, and about 60% of what loading the skill costs. The larger savings come from PS3 and from moving history out, and they do not depend on templates.

It does not shorten the thinking: reading the code, choosing milestones, writing prompts. That is probably most of the cost of a plan, and it was not measured.

## 18. The design travels with the plan

The owner's point: Smart Health's plans reference designs, and a plan cannot show them today.

**What exists.** A frame index per plan, tracked in git (`specs/design/<plan>/frame-index.json`). It names the design's source and how it was captured, lists each frame with its image path and digest, and maps frames to workstreams and tickets (`workstreamFrames`, `ticketFrames`). A ticket's prompt carries a DESIGN INPUTS block naming its frames. A run binds the frames by digest (`core/src/contracts/visual-references.ts`). The images themselves are not in git.

**How a design reference lives in a plan.** As a reference by frame id, never as an embedded copy.

- One field, at three levels: the plan, a milestone, a ticket. It holds the index and the frame ids.
- The viewer draws those frames beside the section or ticket they belong to, with the frame's title and whether its image is present.
- The builder's target does not change. It is still the frames the run bound by digest.
- The DESIGN INPUTS text in a prompt becomes generated from the field, so the frames are named once.

**One template, for both repositories.** Smart Health's plans and the factory's use the same shape. A design-heavy plan fills the design field more often. A second template would be a second thing to keep in step.

**No tool is fixed.** The index already records its source and its capture method. The plan refers to frame ids only, so any tool that produces frames fits.

**What it needs.** The dashboard has no route that serves a frame's image, and the images are outside git. Adding a route means amending the fence that pins the API's routes.

**The rule for all of it,** in the owner's words: do not complicate. The simplest shape that carries what a builder needs.

