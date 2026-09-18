# AWSF v2 W16 — The pi/OpenRouter adapter · build prompts

Companion to [`awsf-v2-w16-openrouter-adapter.html`](awsf-v2-w16-openrouter-adapter.html).
Section A states the conventions every prompt below assumes. Section B holds the twelve task
prompts, one per plan task, and each block is **byte-identical** to the matching ticket's
`## Build prompt` body in [`tickets/awsf-v2-w16-openrouter-adapter/`](tickets/awsf-v2-w16-openrouter-adapter/).
`core/test/unit/meta/ticket-plan-sync.test.ts` asserts that identity, so the two files are edited
together or not at all.

---

# Section A — Conventions

## Read first, every task

- `AGENTS.md` — in full. Invariants 1, 3, 7, 9, 11 and 12 all reach this workstream.
- `specs/awsf-v2-w16-openrouter-adapter.html` — the task's own milestone block and the Identifier
  Spine, plus **What Already Exists** before anything else, because every row in it was verified
  against this checkout rather than recalled.
- `core/src/adapters/pi-codex.ts` — the reviewed shape this workstream is modelled on. Read it in
  full once, at T01, and do not edit it in any task.

## Marker discipline

Two marker sets, and every prompt addresses both explicitly.

1. **This leaf plan's own markers**, in `specs/awsf-v2-w16-openrouter-adapter.html`: the task's
   checklist boxes and, at a milestone's last task, the milestone `<h3>` marker. **Flip them on
   every task, including the first.**
2. **The spine's W16 marker**, in `specs/awsf-v2-plan.html`: **do not touch it until T12**, which
   is the only task that writes to the spine.

Flip the matching ticket's `state:` in the same commit as the HTML marker.

## The never-do list

Each of these is a plausible convenience that would break a locked decision.

- **Do not edit `PI_PROVIDER`, its comment, or `PiCodexAdapter`'s argv.** Tempting because one
  parameter would save a file. The pin's own comment says why not: an unreviewed route would
  inherit a reviewed adapter's descriptor tests.
- **Do not widen `SAFE_MODEL_SELECTOR` in place.** Tempting because it is one regex. It would admit
  `vendor/model` on the Codex route too, where a slash still names a second provider inside a flag
  that already has one — and every positive test would still pass.
- **Do not widen `ENV_ALLOWLIST`.** Tempting because an API key sounds like something a provider
  needs. It is not: the key lives in `pi`'s own auth store, reached through `HOME`, already on the
  three-entry list. AWSF touches no credential.
- **Do not add a normalized event kind.** The twelve are a vocabulary every adapter shares and
  every consumer switches on. A retry is one CLI's transport behaviour, which is what `notice` is.
- **Do not charge a `pi`-level retry against the call ceiling.** Decided 2026-09-15 (Q1): a retry
  is one call. Charging it would mean mutating the ledger mid-run from a stream event, reopening
  the concurrency hole `reserve()`'s synchronicity closes.
- **Do not widen inversion to three providers.** Decided 2026-09-15 (Q3): the provider string is
  the unit and the pair rule stands. A three-way rule is a different mechanism.
- **Do not add a reviewer-provider allowlist.** Decided 2026-09-15 (Q2): any distinct provider may
  review. Tempting because "open-weight reviewers are now allowed" sounds like something to
  configure. It is the opposite — nothing ever forbade them, so implementing Q2 by adding a list of
  permitted reviewers builds the fence the verdict removed.
- **Do not claim `costAuthority: "provider"` before all four promotion-evidence items exist.** The
  Codex route was demoted for exactly this once already.
- **Do not regenerate a fixture to refresh it.** Fixtures here are replayed. A second live call is
  warranted only by a new fact nobody has captured.
- **Do not name an agent, model, or AI tool in a commit identity, message, or trailer.**

## Commit rule — every ticket, on green

When every DONE WHEN row is green, commit that task's work as ONE Conventional Commit:

```
<type>(<scope>): <imperative summary, lower case, no trailing period, ≤72 chars>

<body: what changed and WHY — the decision behind the shape, the alternative rejected,
and any row left [f] with the block that holds it. Wrap at 72 columns.>
```

`type ∈ feat | fix | refactor | test | docs | chore | perf | build | ci`. `scope` is this
workstream's own vocabulary — `adapters`, `catalog`, `stream`, `cost`, `registry`, `routing` — never
a file path. Include the plan HTML marker flips and the ticket's `state:` change in the same commit.
If a DONE WHEN row cannot be made green, mark it `[f]`, name the blocking condition in the body, and
commit what is green.

## Baseline

Before T01 does anything else, run `npm run test:unit` at the base SHA and record the pass count in
the commit body. A red baseline blocks a correct build, and neither `doctor` nor `lint` catches one.

---

# Section B — Task prompts (recommended)

### T01 — Route-owned selector guard for OpenRouter ids

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the guard is three lines of regex sitting on two deliberate refusals; getting one
          of them subtly wrong widens a reviewed route and breaks nothing visibly

TASK 1 of 12. Plan: specs/awsf-v2-w16-openrouter-adapter.html, milestone M1.
PREDECESSORS: none. This is the first task. Record the `npm run test:unit` baseline count first.

READ FIRST
  AGENTS.md - in full
  specs/awsf-v2-w16-openrouter-adapter.html - What Already Exists IN FULL, then M1 task 1
  core/src/adapters/pi-codex.ts - IN FULL. The comment above SAFE_MODEL_SELECTOR at :118 is the
    thing this task is built on; both refusals there are deliberate
  core/src/adapters/interface.ts - AdapterError and the eleven-code vocabulary

DO
  Create core/src/adapters/pi-openrouter.ts as a stub holding only the selector guard for now.
  Declare OPENROUTER_MODEL_SELECTOR in that file. Admit exactly three shapes: bare (glm-5.2),
  vendor/model, and a leading ~ marking OpenRouter's latest alias. At most one slash. The ~ only
  in first position. Keep a total-length bound.
  Keep the colon refusal and write down why IN THIS FILE'S OWN WORDS: `pi --model` accepts an
  id:<thinking> shorthand, so a colon would set the thinking level from the model field and
  outrank the --thinking this adapter puts on the line from the agent's config.
  Write down why the slash refusal does NOT carry over, on this route only: on OpenRouter a slash
  is how a model is spelled, and --provider openrouter is still the only provider on the line.
  Refuse an unrepresentable selector with E_MODEL_UNRESOLVED, same code and message shape as the
  Codex route. A refusal, never a sanitization.

DO NOT
  Edit SAFE_MODEL_SELECTOR, its comment, PI_PROVIDER, or anything else in pi-codex.ts.
  Put the new pattern in a shared module both adapters import — the file boundary is the fence.

DONE WHEN
  Every box in M1 task 1 is [x].
  `npm run typecheck` and `npm run lint` exit 0.
  `npm run test:unit` is at or above the recorded baseline.

COMMIT
  Per Section A. Suggested scope: `adapters`.

MARKERS
  Flip task 1's checklist boxes in specs/awsf-v2-w16-openrouter-adapter.html and this ticket's
  state: to done. Leave milestone M1's [] alone — T03 closes it.
  Do NOT touch specs/awsf-v2-plan.html's W16 marker. T12 is the only task that writes to the spine.

HANDOFF
  Before you finish, open T02.md and T03.md and append to their `## Handoff` section anything that
  would otherwise make them start blind: contradictions between their build prompt and what is now
  true (say which wins, and why), moved or renamed files their READ FIRST names, findings that
  change what they should do, options you considered and rejected, and scope they can now skip or
  must absorb. Dated, numbered entries (C1, C2, …). Do not rewrite their build prompt.
  Append nothing if there is nothing — an empty Handoff is a real answer.
```

### T02 — Per-family model patterns in the adapter catalog

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     a small, well-bounded change to one pure module, with the shape already decided by T01

TASK 2 of 12. Plan: specs/awsf-v2-w16-openrouter-adapter.html, milestone M1.
PREDECESSORS: T01 is [x]. Read its Handoff entries in this file before you start.

READ FIRST
  specs/awsf-v2-w16-openrouter-adapter.html - Problem §1 and M1 task 2
  core/src/adapters/catalog.ts - IN FULL. resolveSelector and MODEL_FAMILIES
  core/test/unit/adapters/catalog-registry.test.ts - the only caller of resolveSelector in the tree

DO
  Confirm the finding before acting on it: grep core/src, core/test and dashboard/src for
  resolveSelector and MODEL_FAMILIES and verify the only hits outside catalog.ts are in
  catalog-registry.test.ts. If a production caller has appeared since this plan was authored, STOP
  and record it in T03's Handoff — the change is larger than this ticket.
  Move the model-name pattern onto ModelFamily so each family admits its own shape.
  Add the openrouter family: alias openrouter, adapterKind pi-openrouter, provider openrouter,
  contextWindow null. A made-up ceiling is worse than no ceiling.
  Keep the exactly-one-colon rule on the whole selector.
  Record in the file header that this surface has no production caller today, so the next reader
  does not mistake a declaration for a gate.

DO NOT
  Give the Codex family a pattern that admits a slash.
  Add contextWindow numbers read from pi's local model store — that is the catalog's own scope and
  it is not this workstream's.

DONE WHEN
  Every box in M1 task 2 is [x].
  `npm run typecheck` and `npm run lint` exit 0.

COMMIT
  Per Section A. Suggested scope: `catalog`.

MARKERS
  Flip task 2's checklist boxes in specs/awsf-v2-w16-openrouter-adapter.html and this ticket's
  state: to done. Leave M1's milestone marker alone.
  Do NOT touch the spine's W16 marker.

HANDOFF
  Before you finish, open T03.md and append to its `## Handoff` section anything that would
  otherwise make it start blind, as dated numbered entries. Append nothing if there is nothing.
```

### T03 — Testing Strategy: admission, refusal, and the over-fire control

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     known-pattern test writing over two pure regexes; the only subtle part is the
          over-fire control, and the plan already names exactly what it must assert

TASK 3 of 12. Plan: specs/awsf-v2-w16-openrouter-adapter.html, milestone M1. CLOSES M1.
PREDECESSORS: T01 and T02 are both [x]. Read their Handoff entries in this file before you start.

READ FIRST
  specs/awsf-v2-w16-openrouter-adapter.html - M1 task 3 and AC-2 in the Identifier Spine
  core/test/unit/adapters/pi-codex.test.ts - the two selector-refusal tests, as the idiom to mirror

DO
  Create core/test/unit/adapters/pi-openrouter.test.ts with the admission and refusal cases.
  Write the OVER-FIRE CONTROL in the same file: all three OpenRouter forms are still refused by
  selectorFor on the Codex route, and PI_PROVIDER is asserted equal to "openai-codex". A guard
  nobody has watched fail to over-fire is decoration.
  Assert resolveSelector("codex:z-ai/glm-5.2") is null while resolveSelector("openrouter:z-ai/glm-5.2")
  resolves — proving the per-family patterns are actually per-family.

DO NOT
  Weaken an assertion to make a row green. If a row cannot pass, mark it [f] and name the blocker.

DONE WHEN
  Every box in M1 task 3 is [x].
  `npm run test:unit` green and at or above the baseline; `npm run typecheck` and `npm run lint`
  exit 0.

COMMIT
  Per Section A. Suggested scope: `adapters`.

MARKERS
  Flip task 3's checklist boxes, then flip milestone M1's header to [x] and every remaining
  checklist box in it, in specs/awsf-v2-w16-openrouter-adapter.html. Flip this ticket's state: to
  done.
  THEN append an Amendment to specs/awsf-v2-w16-openrouter-adapter.html recording the CLOSE of M1:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and the block that holds it
    - the friction it hit: what took longer than the plan expected, what the plan got wrong, and
      what a later milestone must now do differently because of it
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch the spine's W16 marker.

HANDOFF
  Before you finish, open T04.md and append to its `## Handoff` section anything that would
  otherwise make it start blind, as dated numbered entries. Append nothing if there is nothing.
```

### T04 — The second adapter: pinned provider and exact argv

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     an adapter is the harness's boundary with an external process; the argv, the env
          filter and the system-prompt path check each have a silent failure mode

TASK 4 of 12. Plan: specs/awsf-v2-w16-openrouter-adapter.html, milestone M2.
PREDECESSORS: M1 is [x]. Read T03's Handoff entries in this file before you start.

READ FIRST
  specs/awsf-v2-w16-openrouter-adapter.html - M2 task 4, plus AC-1, INV-1 and INV-2
  core/src/adapters/pi-codex.ts - IN FULL again, this time for buildSpec, sessionArgs,
    permissionArgs, thinkingFor and execute
  core/src/adapters/env.ts - filterEnv and why the allowlist is an allowlist
  core/src/adapters/system-prompt-file.ts - assertPrivateSystemPrompt
  core/test/unit/meta/adapter-fence.test.ts - the two sweeps this file must survive

DO
  Fill out core/src/adapters/pi-openrouter.ts. Header states plainly that it is a SECOND adapter
  reusing pi as transport, and that it exists because PI_PROVIDER is pinned rather than because
  the pin is inconvenient.
  Pin PI_OPENROUTER_PROVIDER = "openrouter" with its own rationale, in this file. Do not read a
  provider from config on either route.
  PI_OPENROUTER_ADAPTER_ID = "pi-openrouter". Model prefix "openrouter:".
  buildSpec is PURE — spawns nothing, reads nothing — and carries the five clean-room flags in the
  reviewed order, restating --no-extensions' load-bearing role.
  The prompt rides stdin and appears nowhere in argv.
  --append-system-prompt takes a PATH, and execute calls assertPrivateSystemPrompt before any child
  starts: pi falls back to treating the value as literal TEXT when the path is missing, which is a
  property of the CLI and applies here identically.
  Reuse filterEnv unchanged. Reuse the tool profiles, thinking aliases and session flags from the
  Codex shape, and state in the header which were copied and which were re-derived.
  getModelInfo returns costAuthority: "catalog-estimate" at this point, with a comment naming M3 as
  the milestone that may promote it and AC-6 as the evidence required first.

DO NOT
  Import node:child_process. Call bare fetch. Widen ENV_ALLOWLIST. Set costAuthority to "provider".
  Touch pi-codex.ts.

DONE WHEN
  Every box in M2 task 4 is [x].
  `npm run test:unit` green with adapter-fence, child-process-fence and no-shell-true named
  individually. `npm run typecheck` and `npm run lint` exit 0.

COMMIT
  Per Section A. Suggested scope: `adapters`.

MARKERS
  Flip task 4's checklist boxes and this ticket's state: to done. Leave M2's milestone marker alone.
  Do NOT touch the spine's W16 marker.

HANDOFF
  Before you finish, open T05.md and T06.md and append to their `## Handoff` sections anything that
  would otherwise make them start blind, as dated numbered entries. Append nothing if there is
  nothing.
```

### T05 — Retries become a named notice, and still cost one call

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     it touches a shared contract union and a shared decoder, and it sits next to a quota
          classifier that must NOT fire — a two-line change with a one-line trap under it

TASK 5 of 12. Plan: specs/awsf-v2-w16-openrouter-adapter.html, milestone M2.
PREDECESSORS: T04 is [x]. Read its Handoff entries in this file before you start.

READ FIRST
  specs/awsf-v2-w16-openrouter-adapter.html - M2 task 5, Questionable 1 IN FULL (DECIDED
    2026-09-15: a retry is ONE call, and the notice is what pays for that), plus AC-3 and INV-3
  core/src/adapters/pi-codex-stream.ts - the decode switch, #noteStop, #settle, and the QUOTA_SHAPED
    comment explaining why a plain 429 is not exhaustion
  core/src/contracts/normalized-events.ts - NOTICE_CODES and isPersistableKind
  core/src/execution/call-budget.ts - the header, for why a call is a host-launched process
  dashboard/src/event-summary.ts - summarizeNotice, which is generic over the code

DO
  Add "provider-retry" to NOTICE_CODES.
  Decode auto_retry_start to a notice naming the attempt, the ceiling and the delay; decode
  auto_retry_end to a notice naming the attempt and whether it succeeded.
  Pass the provider's errorMessage and finalError through the same summarizer every other payload
  uses, so a 429 body carrying a request id is bounded and scrubbed like any other provider text.
  THE TRAP: a retried 429's text is quota-shaped and must never reach the terminal classifier.
  #noteStop reads only assistant messages, so it does not today. Keep it that way and PIN IT WITH A
  TEST — pi retrying a 429 is exactly the transient throttle QUOTA_SHAPED's comment already refuses
  to call exhaustion, and misclassifying it loses a phase to a condition that clears on its own.
  Confirm dashboard/src/event-summary.ts needs no change. If it does, that is a finding: record it
  in T06's Handoff rather than widening this task.

DO NOT
  Add a normalized event kind. Touch core/src/execution/call-budget.ts. Make reserve() async.
  Charge a retry against the ceiling - Q1 settled this on 2026-09-15 and the answer is one call.

DONE WHEN
  Every box in M2 task 5 is [x].
  `npm run typecheck` and `npm run lint` exit 0.

COMMIT
  Per Section A. Suggested scope: `stream`.

MARKERS
  Flip task 5's checklist boxes and this ticket's state: to done. Leave M2's milestone marker alone.
  Do NOT touch the spine's W16 marker.

HANDOFF
  Before you finish, open T06.md and append to its `## Handoff` section anything that would
  otherwise make it start blind, as dated numbered entries. Append nothing if there is nothing.
```

### T06 — Testing Strategy: descriptor half and retry replay

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus orchestrator · EFFORT high → spawn Sonnet for the descriptor-half assertions
          (exact argv, env allowlist, stdin, tool profiles), keep the retry and quota-
          classification replays on Opus, then integrate and run the DONE WHEN rows yourself
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     two independent, substantial halves: a mechanical descriptor sweep and a subtle
          stream-classification argument. The orchestrator owns integration and the DoD check

TASK 6 of 12. Plan: specs/awsf-v2-w16-openrouter-adapter.html, milestone M2. CLOSES M2.
PREDECESSORS: T04 and T05 are both [x]. Read their Handoff entries in this file before you start.

READ FIRST
  specs/awsf-v2-w16-openrouter-adapter.html - M2 task 6, plus AC-1, AC-3 and INV-3
  core/test/unit/adapters/pi-codex.test.ts - IN FULL. It is the shape this suite mirrors
  core/src/contracts/normalized-events.ts - validateEventSequence

DO
  Spawn sub-agents explicitly for the two halves as the MODEL line describes; the harness will not
  spawn workers unless told to.
  Descriptor half: exact argv in order byte for byte with no child started; prompt in stdin and in
  no argv element; a system prompt as a path and never as content; the three-entry env allowlist
  plus five injected values; an allowlisted key holding credential-shaped bytes is a hard
  E_REDACTION.
  Parser half: replay a HAND-BUILT retry stream — the live capture is T08's and this milestone must
  not wait on it. A hand-built stream is honest here because what is asserted is the HOST's
  handling, exactly as the Codex suite does for its four reviewed-reading shapes; say so in the
  test file so nobody later mistakes it for a recording.
  Assert three auto_retry lines produce three provider-retry notices and EXACTLY ONE terminal.
  Assert a retried quota-shaped errorMessage completes normally and does NOT map to
  E_QUOTA_EXHAUSTED — and, in the very next test, that a run which retries and then genuinely
  exhausts still maps to E_QUOTA_EXHAUSTED with its reset, so the previous row narrowed nothing.
  Assert validateEventSequence passes on the retried stream.

DO NOT
  Present a hand-built stream as captured bytes anywhere, in a test name or a comment.

DONE WHEN
  Every box in M2 task 6 is [x].
  `npm run test:unit` green with adapter-fence, child-process-fence, no-shell-true,
  dependency-allowlist and junk-drawer named individually before the aggregate.
  `npm run typecheck` and `npm run lint` exit 0.

COMMIT
  Per Section A. Suggested scope: `adapters`.

MARKERS
  Flip task 6's checklist boxes, then flip milestone M2's header to [x] and every remaining
  checklist box in it. Flip this ticket's state: to done.
  THEN append an Amendment to specs/awsf-v2-w16-openrouter-adapter.html recording the CLOSE of M2,
  with the same six items T03's Amendment listed: what is now observably true, every task and its
  final state, the friction, the decisions the plan did not carry, the landing SHA(s), and the
  suite counts at close. Append the modified date in the same commit.
  Do NOT touch the spine's W16 marker.

HANDOFF
  Before you finish, open T07.md and T08.md and append to their `## Handoff` sections anything that
  would otherwise make them start blind, as dated numbered entries. Append nothing if there is
  nothing.
```

### T07 — Sub-cent cost rendering on both formatCost sites

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     two small pure functions, but eighteen existing assertions pin them across three
          files and the rule about rounding away from zero has to be stated once, correctly

TASK 7 of 12. Plan: specs/awsf-v2-w16-openrouter-adapter.html, milestone M3.
PREDECESSORS: M2 is [x]. Read T06's Handoff entries in this file before you start.

READ FIRST
  specs/awsf-v2-w16-openrouter-adapter.html - M3 task 7, the promotion-evidence card, and INV-4
  core/src/adapters/cost-display.ts - IN FULL, including the comment on why a measured-looking
    zero is the worst thing a cost chip can say
  dashboard/src/display.ts - formatCost, the second site
  Every existing formatCost assertion. Find them first: grep for formatCost across core/test and
    dashboard, and count them before changing anything

DO
  core/src/adapters/cost-display.ts renders usd.toFixed(2), so $0.0000216 becomes $0.00. Give it
  enough significant figures that a positive amount is never a string a reader could mistake for
  zero.
  dashboard/src/display.ts renders toFixed(usd < 1 ? 4 : 2), so it becomes $0.0000. Same fix, same
  rule.
  EXTEND the existing assertions rather than perturbing them. A change that rewrote their
  expectations would be a change nobody reviewed — if an existing expectation must change, say so
  explicitly in the commit body and name which one.
  Keep both existing behaviours exactly: "unavailable" renders "— subscription" and IGNORES any
  amount handed to it; "catalog-estimate" keeps its leading ≈.
  State the rule in the comment so the next reader does not re-derive it: a positive amount smaller
  than the displayed precision must round AWAY FROM zero, never to it.

DO NOT
  Change costAuthority on any adapter in this task. The promotion is T09's and it is gated.
  Let the two sites disagree about precision.

DONE WHEN
  Every box in M3 task 7 is [x].
  formatCost("provider", 0.0000216) is not a string that reads as zero, on both sites.
  `npm run test:unit` green and at or above baseline; `npm run typecheck` and `npm run lint` exit 0.

COMMIT
  Per Section A. Suggested scope: `cost`.

MARKERS
  Flip task 7's checklist boxes and this ticket's state: to done. Leave M3's milestone marker alone.
  Do NOT touch the spine's W16 marker.

HANDOFF
  Before you finish, open T09.md and append to its `## Handoff` section anything that would
  otherwise make it start blind, as dated numbered entries. Append nothing if there is nothing.
```

### T08 — The one bounded live capture, its fixtures and its provenance

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this is the workstream's ENTIRE live budget — one call — and the provenance note is
          the evidence chain everything in M3 rests on

TASK 8 of 12. Plan: specs/awsf-v2-w16-openrouter-adapter.html, milestone M3.
PREDECESSORS: M2 is [x]. This task does NOT depend on T07. Read T06's Handoff entries first.

READ FIRST
  specs/awsf-v2-w16-openrouter-adapter.html - M3 task 8, the promotion-evidence card IN FULL, AC-4
    and AC-6, and the Notes section on what a non-zero reasoning count does and does not confirm
  core/test/fixtures/providers/codex/PROVENANCE.md - IN FULL. The idiom to copy exactly, including
    its "what this capture could NOT measure" section and its replay rule
  core/test/fixtures/providers/codex/capture-probe.ts - the probe idiom to copy exactly
  core/test/unit/meta/no-credentials-in-fixtures.test.ts - the sweep the new files must survive
  core/test/unit/meta/_fixture-scrub.ts - the absolute-path predicate

DO
  Create core/test/fixtures/providers/openrouter/. Write capture-probe.ts that CALLS buildSpec()
  and spawns exactly what it returns, so the argv under test and the argv that produced the bytes
  are the same argv by construction.
  Shape ONE call to exercise the whole vocabulary at once: a tool request with its execution and
  result, streamed text, more than one turn so the per-turn usage sum has something to be wrong
  about, a non-zero reasoning count, and a settled terminal.
  Run it in a throwaway working directory OUTSIDE this repository, with three disposable files.
  Commit stdout verbatim. Commit stderr EVEN WHEN EMPTY — "the provider said nothing on stderr" is
  a fact an absent file leaves unstated.
  Derive the retry fixture from the measured free-tier 429 run, stating the transformation line by
  line, and assert the transformation in the suite so the file cannot drift into fiction.
  Derive a cancelled fixture as a byte PREFIX of the capture, cutting mid-line, and assert
  capture.startsWith(prefix).
  Write PROVENANCE.md separating captured bytes from stated transformations, naming the CLI version
  that produced them and the version of any source cited — and DO NOT write both down as one
  number. That conflation is what the cross-building review caught on the Codex route.
  Record what the capture could NOT measure in its own section, rather than letting silence read as
  coverage. In particular: whether reasoning is a breakdown of output or a sibling of it is NOT
  settled by a non-zero count.
  Scrub before committing: no absolute machine path, no session id, no credential-shaped value.

DO NOT
  Spend a second live call. Regenerate a fixture to "refresh" it. Invent bytes and present them as
  captured. Declare reasoningRelation "included-in-output" on this route by analogy with the Codex
  route — it is a different provider's API and the citation does not transfer.

DONE WHEN
  Every box in M3 task 8 is [x].
  no-credentials-in-fixtures and the absolute-path sweep are green over the new directory.
  `npm run typecheck` and `npm run lint` exit 0.

COMMIT
  Per Section A. Suggested scope: `adapters`.

MARKERS
  Flip task 8's checklist boxes and this ticket's state: to done. Leave M3's milestone marker alone.
  Do NOT touch the spine's W16 marker.

HANDOFF
  Before you finish, open T09.md and append to its `## Handoff` section anything that would
  otherwise make it start blind — above all, what the capture actually showed about how the cost
  figure is derived, because that decides whether T09's promotion row can go green at all.
  Dated, numbered entries. Append nothing if there is nothing.
```

### T09 — Testing Strategy: replay, and the cost-authority promotion it gates

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT xhigh
  CLAUDE  claude:opus · /effort xhigh
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this task decides whether AWSF gets its first provider-authoritative cost, and the
          wrong answer is the exact mistake a cross-building review already had to correct once

TASK 9 of 12. Plan: specs/awsf-v2-w16-openrouter-adapter.html, milestone M3. CLOSES M3.
PREDECESSORS: T07 and T08 are both [x]. Read BOTH their Handoff entries in this file before you
start — T08's names what the capture showed about how the cost figure is derived.

READ FIRST
  specs/awsf-v2-w16-openrouter-adapter.html - M3 task 9 and the promotion-evidence card IN FULL
  core/src/adapters/pi-codex.ts - the getModelInfo comment on why "provider" was demoted to
    "catalog-estimate". That paragraph is the standard this task is held to
  core/test/fixtures/providers/openrouter/PROVENANCE.md - as T08 left it
  pi's own source for the OpenRouter path - the decisive, currently-unread evidence item

DO
  Replay the captured bytes: one terminal, every tool settled, no malformed-usage notice on a
  healthy stream; usage summed per turn; a provider-reported zero is data rather than a missing
  metric; the non-zero reasoning count survives into reasoningTokens and the test's name claims
  only what it proves.
  Then work the four promotion-evidence rows in order:
    1. the non-zero-cost capture is in the tree with its provenance note
    2. pi's OpenRouter source path is READ and CITED, and it shows the provider's own figure
       carried through rather than computed locally. This is the decisive one. A value that matches
       OpenRouter's published price is exactly what a correct LOCAL rate card also produces, so the
       observation of the value is not evidence of its derivation
    3. the capture's cost is reconciled against OpenRouter's own record for that generation, with
       the limits of a single-model agreement stated
    4. T07's sub-cent rendering is landed
  With all four green: change costAuthority to "provider" in ONE commit and record in the adapter
  header that this is the first route in AWSF to hold it and exactly what earned it.
  Otherwise: leave "catalog-estimate", mark the failing row [f], and record the gap. THAT IS A
  COMPLETE OUTCOME for this workstream — every other capability it adds is independent of the
  authority label.

DO NOT
  Promote on rows 1 and 4 alone. Soften row 2 into "the number looks right". Weaken an assertion to
  make a row green.

DONE WHEN
  Every box in M3 task 9 is [x] or [f] with its blocker named.
  `npm run test:unit`, `npm run typecheck`, `npm run lint` and `npm test` all green, working tree
  clean.

COMMIT
  Per Section A. Suggested scope: `cost`.

MARKERS
  Flip task 9's checklist boxes, then flip milestone M3's header to [x] and every remaining
  checklist box in it. Flip this ticket's state: to done, or failed if a row closed [f] that the
  plan treats as blocking.
  THEN append an Amendment to specs/awsf-v2-w16-openrouter-adapter.html recording the CLOSE of M3,
  with the same six items T03's Amendment listed — and state the promotion outcome explicitly,
  either way. Append the modified date in the same commit.
  Do NOT touch the spine's W16 marker.

HANDOFF
  Before you finish, open T10.md and append to its `## Handoff` section anything that would
  otherwise make it start blind, as dated numbered entries. Append nothing if there is nothing.
```

### T10 — Register the route, shipped disabled

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     three small edits across a union, a switch and a config file, with one judgement
          call the plan has already made: it ships off

TASK 10 of 12. Plan: specs/awsf-v2-w16-openrouter-adapter.html, milestone M4.
PREDECESSORS: M3 is [x]. Read T09's Handoff entries in this file before you start.

READ FIRST
  specs/awsf-v2-w16-openrouter-adapter.html - M4 task 10, plus AC-5 and INV-1
  core/src/config/schema.ts - KNOWN_ADAPTER_KINDS
  core/src/adapters/registry.ts - RegisteredAdapterKind, adapterFor, registeredAdapter
  awsf.config.yaml - the adapters block and the agents that name them

DO
  Add "pi-openrouter" to KNOWN_ADAPTER_KINDS and to RegisteredAdapterKind.
  Add the adapterFor case, passing through executable and the runtime limits exactly as the Codex
  case does.
  Add `openrouter: { kind: pi-openrouter, executable: pi, enabled: false }` to awsf.config.yaml,
  with a comment saying enabling it is an owner act.
  Confirm by test that registeredAdapter returns null for the disabled entry, so the shipped
  configuration cannot start a child on this route by accident.
  Re-assert INV-1 mechanically: a test reads pi-codex.ts and asserts PI_PROVIDER is still
  "openai-codex" and that the file contains no reference to openrouter.

DO NOT
  Add an agent that routes to it. A configured adapter nothing names is a route; a configured agent
  is a decision the owner has not taken.
  Set enabled: true.

DONE WHEN
  Every box in M4 task 10 is [x].
  `npm run test:unit` green and at or above baseline; `npm run typecheck` and `npm run lint` exit 0.

COMMIT
  Per Section A. Suggested scope: `registry`.

MARKERS
  Flip task 10's checklist boxes and this ticket's state: to done. Leave M4's milestone marker
  alone.
  Do NOT touch the spine's W16 marker.

HANDOFF
  Before you finish, open T11.md and T12.md and append to their `## Handoff` sections anything that
  would otherwise make them start blind, as dated numbered entries. Append nothing if there is
  nothing.
```

### T11 — Make the three-provider inversion refusal legible

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     it sits on the one rule that decides who reviews whom, and both tempting fixes —
          widening inversion, and adding an allowlist to "enable" open-weight reviewers — are
          the two things the owner's verdicts specifically do not ask for

TASK 11 of 12. Plan: specs/awsf-v2-w16-openrouter-adapter.html, milestone M4.
PREDECESSORS: T10 is [x]. Read its Handoff entries in this file before you start.
OWNER GATE: SATISFIED. Questionables 2 and 3 were decided on 2026-09-15.
  Q2 - any distinct provider may review. Open-weight routes are admissible for reviewer phases.
  Q3 - the provider string is the unit of inversion, with NO per-recipe cap on OpenRouter phases.
Neither needs code. This task records them and proves the code already matches.

READ FIRST
  specs/awsf-v2-w16-openrouter-adapter.html - M4 task 11, Problem §4, Questionables 2 and 3 IN FULL,
    and INV-5
  core/src/workflow/review-routing.ts - IN FULL. providerPairFrom and oppositeProvider
  core/src/cli/commands/production-run.ts around the providerPairFrom call - how the phase list is
    built
  core/src/cli/commands/review-phase.ts around the providerPairFrom call - the second call site

DO
  Reproduce the collision FIRST, as a failing test: a compiled recipe whose agent phases resolve to
  anthropic, openai-codex and openrouter raises InvalidReviewInversion at preflight, at zero cost,
  before any child starts.
  Change providerPairFrom's message so it NAMES the distinct providers it found, not only how many.
  Verify against the code first — the current message already appends the list when the count is
  non-zero — and extend it only if the verification says it is needed.
  Have the refusal say which phase contributed each provider, so a reader can narrow the recipe
  without reading the compiler.
  Verify Q2 needs no code and WRITE THE VERIFICATION DOWN: read providerPairFrom and BOTH call
  sites and confirm neither carries an allowlist of permitted reviewer providers. oppositeProvider
  asks only that the reviewer be DIFFERENT, so an open-weight reviewer was already admissible.
  Prove Q3's dropped cap costs nothing, by assertion rather than by reasoning: a recipe with an
  OpenRouter builder AND an OpenRouter reviewer resolves to ONE distinct provider and is refused by
  the exactly-two rule. That is the case the cap was meant to prevent, and it is already closed.
  Record in this plan's Amendments that Q2 and Q3 were applied as decided rather than reopened.

DO NOT
  Widen inversion to three providers. Q3 kept the pair rule rather than replacing it.
  ADD A REVIEWER-PROVIDER ALLOWLIST. Q2 admitted any distinct provider; implementing it by adding
  a list of permitted reviewers builds the fence the verdict removed. If you are writing a list,
  you have read the verdict backwards.
  Make quota or availability an input to oppositeProvider.

DONE WHEN
  Every box in M4 task 11 is [x].
  `npm run test:unit` green and at or above baseline; `npm run typecheck` and `npm run lint` exit 0.

COMMIT
  Per Section A. Suggested scope: `routing`.

MARKERS
  Flip task 11's checklist boxes and this ticket's state: to done. Leave M4's milestone marker
  alone.
  Do NOT touch the spine's W16 marker.

HANDOFF
  Before you finish, open T12.md and append to its `## Handoff` section anything that would
  otherwise make it start blind — above all the owner's answers to Questionables 2 and 3, because
  T12's spine Amendment must record which spine question this workstream resolved and how.
  Dated, numbered entries. Append nothing if there is nothing.
```

### T12 — Testing Strategy: full suite, fences, and the two closing amendments

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the only task that writes to the spine, and the two closing amendments are what a
          later session reads instead of re-deriving this workstream from commits

TASK 12 of 12. Plan: specs/awsf-v2-w16-openrouter-adapter.html, milestone M4. CLOSES M4 AND W16.
PREDECESSORS: T10 and T11 are both [x]. Read both their Handoff entries in this file before you
start.

READ FIRST
  specs/awsf-v2-w16-openrouter-adapter.html - M4 task 12, the Validation Commands section IN FULL,
    and every Amendment T03, T06 and T09 already wrote
  specs/awsf-v2-plan.html - Milestone M16 IN FULL, and the Amendments section's own idiom
  AGENTS.md - invariants 1, 11 and 12

DO
  Run the whole Validation Commands list, nothing skipped, naming each meta-fence individually
  before the aggregate: adapter-fence, child-process-fence, no-shell-true, dependency-allowlist,
  no-credentials-in-fixtures, state-purity-fence, layer-separation, junk-drawer, ticket-plan-sync.
  Assert by test that ENV_ALLOWLIST is still exactly ["PATH", "HOME", "TMPDIR"], and that no file
  under core/src/** names a credential store path.
  Verify each box before flipping it. Do not flip a claim this task has not checked.

DO NOT
  Flip a box on the strength of an earlier milestone's Amendment alone. Fabricate a suite count.

DONE WHEN
  Every row of the plan's Validation Commands section is [x], or [f] with its blocker named.
  `npm test` green in one invocation, leaving `git status --porcelain` clean.
  `just awsf doctor` healthy.

COMMIT
  Per Section A. Suggested scope: `adapters`.

MARKERS
  Flip task 12's checklist boxes, then milestone M4's header to [x] and every remaining checklist
  box in specs/awsf-v2-w16-openrouter-adapter.html. Flip this ticket's state: to done.
  THEN append an Amendment to specs/awsf-v2-w16-openrouter-adapter.html recording the CLOSE of M4,
  with the same six items the earlier milestone Amendments listed.
  THEN, after every marker in specs/awsf-v2-w16-openrouter-adapter.html reads [x], and IN THE SAME
  COMMIT, flip specs/awsf-v2-plan.html's Milestone M16 / W16 marker and its checklist to [x].
  THEN append an Amendment to specs/awsf-v2-plan.html recording the CLOSE of W16:
    - what this workstream delivered against the spine's claim for it, claim by claim
    - which of its own Questionables it resolved, and how, and whether the answer to Questionable 3
      changes anything the spine says about routing.review
    - the friction and the surprises, including anything it found that the spine assumed wrongly
      and that a LATER workstream now inherits
    - anything it routed to another workstream rather than building, and to which one
    - every row that closed [f], with the block that holds it
    - the landing commit SHA and this plan's final suite counts
  This is the only ticket that writes to specs/awsf-v2-plan.html. Append the modified date and the
  agent name to the metadata header of both files.

HANDOFF
  There is no successor ticket. If anything found here changes what a FUTURE workstream should do —
  in particular anything about inversion, cost authority, or a second non-subscription route —
  record it in the spine Amendment above rather than losing it.
```
