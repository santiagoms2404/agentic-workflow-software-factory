# Build Prompts — AWSF v2 W01, marimba's operating contract

Companion to [`awsf-v2-w01-marimba-contract.html`](./awsf-v2-w01-marimba-contract.html). Created
2026-08-21 alongside the plan and
[`tickets/awsf-v2-w01-marimba-contract/`](./tickets/awsf-v2-w01-marimba-contract/).

**These prompts write implementation code.** That is the difference between this file and
[`awsf-v2-plan-build-prompts.md`](./awsf-v2-plan-build-prompts.md), whose fourteen prompts are
meta-prompts that author deep plans. This is the deep plan for workstream W01, and these nine
prompts build it.

Each prompt is **self-contained** and written for a **fresh session with no prior context**. Copy
one, paste it, let it run to completion, review what it produced, clear context, move to the next.

---

## Why there is no Section A

v1's prompts file had a Section A (one prompt per milestone) and a Section B (one per task). This
plan's five milestones hold nine tasks, and every milestone-level instruction that would go in a
Section A prompt — the marker rule, the read-first set, the never-do list — is identical across all
nine. Stating it once in **Conventions** below and once per prompt is enough; a Section A here would
be the same paragraph written five more times. **Section B is the whole file.**

---

## Before anything: three gates

1. **Owner approval of this deep plan.** The owner has read
   `specs/awsf-v2-w01-marimba-contract.html` — especially its **seven Questionables, all now
   decided** — and approved it. Recorded in the plan's Amendments.
2. **All seven Questionables were decided by the owner on 2026-08-21**, each taking the recommended
   option. Five came through an exported `plan-sota-review v1` block: **Q6** the repository holds the
   guard's only copy · **Q2** fail closed on a missing interpreter, keep failing open on a malformed
   payload · **Q4** add the `SessionStart` banner · **Q5** captured refusals are payload fixtures
   plus the plan's Amendments · **Q1** everything lives in `docs/driving/marimba/`. Two were decided
   by owner direction after that block left them without a verdict, **both as "do not build it"**:
   **Q3** the guard gets no fence over its own files, and **Q7** the launcher keeps `--settings`
   alone. **A decided Questionable is a constraint, not an assignment** — the prompts below hand
   each one to its task as something to apply, and no session re-litigates one. **Nothing is left
   open**, so a prompt that finds itself wanting to decide something has found a gap in the plan and
   should stop rather than choose.
3. **The `awsf.config.yaml` amendment has landed as its own owner-authored commit**, before task 3.
   It protects `docs/driving/**`, and the reason was measured on 2026-08-21 rather than assumed: the
   guard script is already unreachable by every role, and the documenter's `**/*.md` glob reaches
   every markdown document in the driving tree. No agent writes `awsf.config.yaml`; `path-policy`
   rejects `protected-path` independently of the write globs, and that is the boundary working. See
   the plan's M2 amendment card for the wording, the measurement, the replacement guarantee and the
   better alternative it surfaced — narrowing the documenter's glob instead.

---

## Decisions already made — do not re-litigate these

| # | Decision | Status |
|---|---|---|
| D1 | **The boundary is a denial at the tool surface**, performed by a `PreToolUse` hook delivered per invocation. It is not a terminal check, and no document this workstream writes or repairs may describe a terminal check as an authorisation boundary. | settled — v2 intent decision 3 |
| D2 | **The contract is command-free**, lives inside `docs/driving/`, and is delivered as an **appended** system prompt rather than a replacement. | settled — spine W01 scope |
| D3 | **Installing the guard is an owner act** and is not a task. Testing it is not an owner act, and its tests belong here. | settled — spine, Owner-side work |
| D4 | **The contract is route-free and short** (≤120 lines, ≤1,100 words), because it travels into sessions where this tree is not present and because it is re-sent on every request. | derived in this plan — see Solution |
| D5 | **Exactly six commands take an owner terminal**: `rework`, `review`, `raise`, `journey`, `land`, `cancel`. `retry` does not. The source is `core/src/cli/main.ts`, never a copied list. | measured 2026-08-21 |
| D6 | **`--settings` merges project settings rather than excluding them**; `--setting-sources` is the flag that excludes. A project `PreToolUse` hook returning *allow* does **not** override marimba's deny. | measured — spine probe 2026-08-21 and this plan's probe 1 |
| D7 | **The owner-act fence reads written command text, not resolved intent.** Indirection through a shell variable evades it, measured. That is the design's ceiling and it is stated, never patched around by widening the match. | measured 2026-08-21 |
| D8 | **No committed file stores a transcript, receipt or manifest**, and no committed file names a live session, run or attempt. Invariants 1 and 10, both enforced. | settled |
| D9 | **The repository holds the guard's only copy**, and the owner's `settings.json` points its hook command at that absolute path. The tested file and the executed file are the same bytes. | Q6, decided 2026-08-21 |
| D10 | **A payload the parser rejects fails open; a parser that cannot run at all fails closed.** Two different failures, no longer sharing one branch. The closed case must name its cause and its fix. | Q2, decided 2026-08-21 |
| D11 | **A `SessionStart` banner reports what it checked** — settings loaded, guard present and executable, parser runnable. It never claims the `PreToolUse` hook will fire, always exits 0, and is not a self-test. | Q4, decided 2026-08-21 |
| D12 | **Captured refusals are payload fixtures plus a redacted quotation in the plan's Amendments.** No transcript file is committed and no invariant amendment is needed. | Q5, decided 2026-08-21 |
| D13 | **Everything marimba installs lives in `docs/driving/marimba/`** — `CONTRACT.md`, `delegation-guard.sh`, `session-banner.sh`, `settings.example.json`, `README.md`. The directory is not a route target. | Q1, decided 2026-08-21 |
| D14 | **The guard gets no fence over its own files.** One on the file-writing tools would leave the shell route open while reading as though it had closed both. The gap is *stated* — in the header and in the contract's part 3 — and not fenced. Reopen only if an accidental edit actually happens. | Q3, decided 2026-08-21 |
| D15 | **The launcher keeps `--settings` alone**; no `--setting-sources user`. A project hook cannot weaken the deny (measured), and exclusion would discard every legitimate project setting. Reopen if the one unrun probe — a project `permissions.allow` list rather than a hook — beats the deny. | Q7, decided 2026-08-21 |

---

## Model selection

`EFFORT` is the session-level reasoning control (`/effort low|medium|high|xhigh|max`), calibrated to
the hardest judgement in the task. **No prompt in this file fans out to sub-agents.** Every task is
one file or one closely-coupled pair, where the integration tax of splitting exceeds anything
parallelism would buy — and a marimba-driven session cannot spawn one anyway, which is the whole
subject of the workstream.

| Task | Route | Why |
|---|---|---|
| 1, 8 | Sonnet 5 · `medium` | Prose and record-keeping against decisions this plan has already taken. |
| 2, 3, 6, 7 | Opus 5 · `high` | Fence and guard design. Each has a named over-fire or vacuous-green failure mode to design around — and task 3 was **raised from Sonnet after the 2026-08-21 review**, because Q2 turned it from a file move into a behaviour change in the script that holds the boundary, and Q4 added a script that must not overclaim. |
| 4 | Opus 5 · `high` | The matrix is the workstream's evidence. Getting a row wrong makes the guard look proven when it is not. |
| 5 | Opus 5 · `high` | The contract is the artifact every later planning session reads, and its subject was described wrongly once already. |
| 9 | Sonnet 5 · `medium` | Running the suite and flipping two marker sets in one commit. |

---

## Conventions used by every prompt

**Marker discipline — read this once, it applies nine times.**

- **Flip THIS plan's markers on every task, including the first.** In
  `specs/awsf-v2-w01-marimba-contract.html`: the milestone's `<h3>` marker to `[wip]` when you start
  and `[x]` when the milestone's last task is done, and each checklist `<code class="status">` item
  in your task as you complete it. Flip the matching ticket's `state:` in
  `specs/tickets/awsf-v2-w01-marimba-contract/` **in the same commit** — AGENTS.md invariant 12.
- **Do NOT flip the spine's W01 marker** in `specs/awsf-v2-plan.html`, or `W01.md`'s state in
  `specs/tickets/awsf-v2-plan/`, until **task 9**. Task 9 is the only task that touches them.
- Both halves matter. A session that reads only the negative leaves every marker alone, and the next
  task's "confirm the prior task is `[x]`" precondition fails for no reason.
- Append the date to the plan's `modified` metadata row and add an Amendment entry with the commit
  SHA when your task completes. Never overwrite a metadata row; every one of them is append-only.

**Read first, every time.** `specs/awsf-v2-w01-marimba-contract.html` — your milestone and task in
full, plus What Was Measured and Evidence · `AGENTS.md` — all twelve invariants · `README.md` ·
the files your task's checklist names. There is no `docs/TESTING.md` in this repository; the testing
convention is read from the meta-tests themselves, which is why each prompt below names the specific
fence to imitate.

**Never, in any of the nine.**

- Never describe a terminal-shape check as an authorisation boundary. That is the defect this whole
  workstream exists to repair.
- Never commit a transcript, a receipt, a manifest, a session id, a run id or a machine path.
- Never write `AGENTS.md` or `awsf.config.yaml`. If your task needs one changed, stop and hand the
  owner the amendment.
- Never add a dependency. The allowlist is invariant 7 and it is enforced.
- Never let a test `skip`. A fence that skips reports green and catches nothing.
- Never name an agent, model or AI tool as commit author, committer or co-author — invariant 11,
  enforced by a meta-test over this repository's own history.

---

# Section B — Task prompts (recommended)

Nine prompts, one per task, in plan order. Tasks 1–2 are milestone M1, 3–4 are M2, 5–6 are M3, 7 is
M4, and 8–9 are M5. The ticket for each is
`specs/tickets/awsf-v2-w01-marimba-contract/T<nn>.md`, carrying the same prompt verbatim.

### T01 — Repair the three documents that call a terminal check an authorisation boundary

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     prose edits against a decision already taken and evidence already measured.

TASK 1 of 9. Plan: specs/awsf-v2-w01-marimba-contract.html, milestone M1.
PREDECESSORS: none. This is the first task.

READ FIRST
  specs/awsf-v2-w01-marimba-contract.html - milestone M1 in full, plus the Problem section's
    table of the three false claims and the "What Was Measured" section
  AGENTS.md - all twelve invariants
  docs/driving/skills/awsf/SKILL.md, cookbooks/owner_acts.md, references/gotchas.md,
    commands/prime-awsf.md - the four documents in question
  core/src/cli/tty.ts and core/src/cli/main.ts - the eleven lines the false claim rests on,
    and the six case arms that construct an owner terminal

DO
  Repair the three documents that describe a terminal check as an authorisation boundary.
  Replace the claim; do not soften it. Each document gets the statement that fits its job:
  the router states the boundary in one line, the cookbook states what actually holds the
  line and what a driving session must therefore do, and the trap table's section 8 keeps
  its symptom and gets a corrected cause.

  SKILL.md         "Landing exists only through a human at a TTY" becomes: landing is
                   authorised by the owner at a terminal, the terminal check is a shape
                   test rather than the authorisation boundary, and the boundary marimba
                   operates under is the per-invocation tool-surface denial. The owner-act
                   list gains `raise`, making it six.
  owner_acts.md    The paragraph beginning "This is not merely a convention" is rewritten.
                   Keep "the lifecycle refuses a non-interactive invocation" - it is true.
                   Delete "structurally cannot take one of these edges".
  gotchas.md #8    Title and symptom unchanged - a piped stdin really does refuse. "All
                   five" becomes six, named. The cause becomes the terminal-shape
                   statement. "There is no flag that bypasses it and you should not look
                   for one" becomes the accurate version: no flag bypasses it, a PTY makes
                   the check pass, and the fence that holds is the hook.
  prime-awsf.md    Read it and leave it alone. Its "read-only by construction" is about
                   `doctor` having no repair path and is TRUE.

WHAT IS TRUE, AND MUST REPLACE WHAT IS NOT
  No push path exists anywhere in core/src. Nothing is auto-deleted. Writes are confined
  to a managed worktree by path-policy. Canonical movement happens only through a
  human-approved local fast-forward. The managed worktree root is a SIBLING of the state
  root, not a child - defaultWorktreeRoot returns join(dirname(stateRoot),
  "awsf-worktrees") - so do not write any sentence claiming nothing mutates outside the
  state root.

DO NOT
  Add a claim the suite cannot check. Every replacement sentence is either a measured fact
  recorded in the plan or a pointer to the file that owns it. Do not add a route, a
  command, or a schema restatement to any of these documents - five fences sweep this tree
  and they will tell you.

DEFINITION OF DONE
  The plan's task 1 checklist, every box. Then:
    npm run test:unit     -> 989 pass, 0 fail; the baseline is in the plan
    npm run lint          -> clean
  Flip task 1's checklist boxes and milestone M1 to [wip] in
  specs/awsf-v2-w01-marimba-contract.html, and T01.md's state to wip then done in the same
  commit. Do NOT touch specs/awsf-v2-plan.html.
```

### T02 — Derive the six owner acts from the code rather than copying them, plus Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     a phrase-matching fence has two failure modes - it can miss and it can
          over-fire - and both have to be designed against in the same file.

TASK 2 of 9. Plan: specs/awsf-v2-w01-marimba-contract.html, milestone M1.
PREDECESSORS: task 1 must be [x]. The fence is written against the repaired tree.

READ FIRST
  specs/awsf-v2-w01-marimba-contract.html - milestone M1, task 2, and its cost card
  core/test/unit/meta/doc-reconciliation.test.ts - the precedent for naming an accepted
    residual gap rather than closing it with a cleverer regex
  core/test/unit/meta/driving-tree.test.ts and _driving.ts - why every tree-scoped fence
    ships a companion, and how the walkers work
  core/src/cli/main.ts - the six case arms that construct processOwnerTerminal()

DO
  Write core/test/unit/meta/boundary-claims.test.ts with two halves and a companion for
  each.

  HALF 1 - the claim ban. A small, commented pattern list that fires on an assertion that
  a terminal check AUTHORISES something. Scoped to drivingDocs(). Ship two controls: a
  synthetic offender in memory proving each pattern bites, and a synthetic innocent
  proving it does not over-fire - use prime-awsf.md's "read-only by construction" sentence
  as that innocent, since it is a real sentence in the tree that a careless pattern would
  catch.

  HALF 2 - the derivation. Parse core/src/cli/main.ts for the case arms that construct an
  owner terminal, and assert that every driving document enumerating owner acts enumerates
  exactly those six. A seventh fake name in a document must fail it.

NAME THE GAP IN THE FILE
  A banned-phrase list is escapable by paraphrase. Say so in a comment, the way
  doc-reconciliation.test.ts says so about prose naming a command that does not exist. Do
  not close it with a cleverer regex - the false positives cost more than the gap, and a
  fence that over-fires teaches authors to stop writing plainly.

DO NOT
  Import from core/src into a meta-test in a way that executes CLI code. Read main.ts as
  text, the way doc-reconciliation.test.ts reads the justfile - the fence is about what
  the file SAYS, and a value imported at runtime would pass even if the source text
  changed shape.

DEFINITION OF DONE
  The plan's task 2 checklist, every box. Then:
    node --experimental-strip-types --test core/test/unit/meta/boundary-claims.test.ts
    npm run test:unit     -> no count below 989 pass, 0 fail
    npm run lint          -> clean
  Prove both halves bite: restore one deleted sentence in a scratch copy and watch it go
  red; add a seventh fake act name and watch half 2 go red. Discard both scratch copies.
  Flip task 2's boxes and milestone M1 to [x], and T02.md to done, in the same commit. Do
  NOT touch specs/awsf-v2-plan.html.
```

### T03 — Land marimba's installed files in the tree, with the guard's real limits in its header

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     Q2 made this a behaviour change in the script that holds the boundary, not a
          file move, and Q4 added a second script whose whole risk is overclaiming.

TASK 3 of 9. Plan: specs/awsf-v2-w01-marimba-contract.html, milestone M2.
PREDECESSORS: task 2 must be [x].

FOUR OWNER DECISIONS THIS TASK APPLIES, all taken 2026-08-21. Apply them; do not
re-litigate them.
  Q6  the repository holds the guard's ONLY copy. The owner's settings.json points its
      hook command at that absolute path.
  Q1  everything lives in docs/driving/marimba/.
  Q2  a payload the parser REJECTS still fails open; a parser that CANNOT RUN fails closed.
  Q4  a SessionStart banner lands with the guard.
Q3 was decided the same day, and it decided AGAINST building: the guard gets no fence over
its own files. A fence on the file-writing tools would leave the shell route open while
reading as though it had closed both, and a half-closed hazard that looks closed is the
exact defect this workstream exists to repair. State the gap in the header instead.

GATE: the awsf.config.yaml amendment adding docs/driving/** to policy.protected_paths
must already have landed as its own owner-authored commit. If it has not, stop. Do NOT
write awsf.config.yaml - path-policy rejects protected-path independently of the write
globs, and that is the boundary working, not an obstacle. Note what the amendment is
actually for, measured 2026-08-21: the guard SCRIPT was already unreachable by every
role, and the exposure is the documenter's **/*.md glob over the tree's DOCUMENTS.

READ FIRST
  specs/awsf-v2-w01-marimba-contract.html - milestone M2 in full, its amendment card, and
    the "What Was Measured" matrix
  ~/.claude/marimba/delegation-guard.sh - the script as installed
  core/test/unit/meta/_driving.ts - the wide extension set the credential and shell sweeps
    walk, and the standing caution about basenames containing receipt or manifest

DO
  Land the script at docs/driving/marimba/delegation-guard.sh as an EXACT copy first, in
  its own commit, so the move is separable from the edit. Then make the Q2 change and
  correct the header.

  THE Q2 CHANGE is one guarded branch splitting two failures that share one branch today.
  A payload the parser rejects means the harness changed its schema: keep failing OPEN,
  because failing closed there would brick every tool call the day that happens. A parser
  that cannot run at all is a machine defect that affects every call: fail CLOSED, exit 2,
  and make the reason name BOTH the cause and the one-line fix. A session bricked by a
  guard that will not say why is the same failure arriving from the other direction.

  The header must name every measured limit, not only malformed JSON:
    - the payload is parsed by an external interpreter. Before this task a missing or
      broken one disabled both fences and exited 0 with no signal (measured 2026-08-21);
      after it, that case fails closed. State the resulting posture explicitly, both
      halves.
    - fence 2 reads WRITTEN COMMAND TEXT, not resolved intent. Indirection through a shell
      variable evades it - measured. State it as the design's ceiling.
    - fence 2 over-denies: a command that merely READS or QUOTES an act name, such as a
      grep or an echo, is refused.
    - the guard does not protect its own files. An Edit whose file_path is the script is
      allowed, because fence 2 only ever looks at a command field.
    - mcp__* names are never classified.
  Add one sentence saying what the guard is FOR, so a reader who stops at the header does
  not mistake it for a sandbox.

  Also land session-banner.sh, the Q4 deliverable. THREE RULES IT MAY NOT SOFTEN:
    - it reports WHAT IT CHECKED, never what it hopes. It can prove the settings file
      loaded, and can cheaply check that the guard script is present and executable and
      that the parser runs. It CANNOT prove the PreToolUse hook will fire, and no line it
      prints may imply otherwise.
    - it ALWAYS exits 0. A SessionStart hook that fails is a new way to break a session
      for no gain.
    - it is NOT a self-test. Making marimba issue a deliberately-denied call at session
      start was considered and refused: that puts a document in the execution path of its
      own boundary, which this project refuses everywhere else.

  And land settings.example.json - the permissions.deny pair, the PreToolUse hook and the
  SessionStart hook, with obvious placeholders where the two absolute paths go and NO
  machine path committed - plus a README.md stating the install steps as owner acts and
  saying plainly that the repository holds the only copy.

DO NOT
  Widen the guard's coverage beyond what Q2 and Q4 decided. Q3 - denying writes to the
  guard's own files - was decided AGAINST and stays unbuilt; record the gap in the header
  and the contract instead. Do not name any file with a basename containing "receipt" or
  "manifest" - the junk-drawer fence has nothing to do with this work and would still fail
  it.

DEFINITION OF DONE
  The plan's task 3 checklist, every box. Then:
    npm run test:unit     -> no count below 989 pass, 0 fail; the credential and shell
                             sweeps now walk a .sh and a .json inside the tree
    npm run lint          -> clean
  Flip task 3's boxes and milestone M2 to [wip], and T03.md to done, in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T04 — The offline denial matrix, plus Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this matrix is the workstream's evidence. A wrong row makes the guard look
          proven when it is not.

TASK 4 of 9. Plan: specs/awsf-v2-w01-marimba-contract.html, milestone M2.
PREDECESSORS: task 3 must be [x]. The test runs against the COMMITTED scripts - the guard
and the banner - and against no installed copy, because Q6 decided there is only one.

READ FIRST
  specs/awsf-v2-w01-marimba-contract.html - milestone M2, task 4, its collision card, and
    the full matrix in "What Was Measured"
  the committed delegation-guard.sh, including its deny protocol: exit 2 with the reason
    on stderr and NOTHING on stdout
  core/test/unit/meta/junk-drawer.test.ts - the precedent for a meta-test spawning a
    process; the child-process fence is scoped to core/src, so a test may do this

A COLLISION TO HANDLE, NOT DISCOVER
  The fixture text contains the six owner-act phrases, and a marimba session's own guard
  denies any Bash command whose text contains one - measured, exit 2, including echo and
  grep. So author the fixtures with the FILE-WRITING TOOLS, never with a shell heredoc:
  those payloads carry a file_path and no command, and fence 2 never sees them. Running
  the finished test is fine - the command line is a test-runner invocation and contains
  none of the phrases.

DO
  Write core/test/unit/meta/marimba-guard.test.ts, table-driven, spawning the committed
  script with a payload on stdin. Every row carries a one-line reason it is in the table.

  Cover both fences: delegation-shaped names, the six owner-act shapes through a wrapper
  and with normalised whitespace, the whole-name exclusions, and the mcp__* pass-through.

  ASSERT THE ALLOWS AS HARD AS THE DENIES. A guard that denied everything would pass a
  deny-only suite and be useless. `awsf status`, `awsf run` and `awsf retry` must pass -
  they are the spend the tier already authorised.

  For every deny row assert three things: exit 2, a non-empty reason on stderr, and EMPTY
  STDOUT. The third is the guard's own stated deny protocol and is the half a naive test
  forgets.

  Include the fail-open rows as EXPECTED behaviour with the reason in a comment: malformed
  JSON and an empty payload. Per Q2 the interpreter case is now the opposite - an
  UNRUNNABLE PARSER IS A DENY ROW, and the assertion covers the exit code AND that the
  reason names both the cause and the fix. Include the known evasion (an act named through
  a shell variable) as an ALLOW row, with a comment naming it as the design's ceiling
  rather than a bug to be fixed by widening the match.

  COVER THE BANNER TOO, in the same file. Three rows: it exits 0 with the guard present; it
  exits 0 AND REPORTS THE ABSENCE when the guard path points at nothing; and no line it
  prints claims the PreToolUse hook will fire. The third row is the one that matters - a
  banner that overclaims is worse than no banner, because it answers the question the owner
  actually has with something it does not know.

DO NOT
  Skip when either script is absent - fail loudly. A skip is how a fence stops meaning
  anything without anyone noticing. Do not assert on the exact wording of a reason string
  beyond it being non-empty and naming the act or the tool; pinning prose makes the test
  fail on an improvement.

DEFINITION OF DONE
  The plan's task 4 checklist, every box. Then:
    node --experimental-strip-types --test core/test/unit/meta/marimba-guard.test.ts
                          -> green, under two seconds
    npm run test:unit     -> no count below 989 pass, 0 fail
    npm run lint          -> clean
  Prove it bites: neutralise one branch of the committed script in a scratch copy, watch
  the matching row go red, discard the scratch copy. Flip task 4's boxes and milestone M2
  to [x], and T04.md to done, in the same commit. Do NOT touch specs/awsf-v2-plan.html.
```

### T05 — Author the contract

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this document is read by every later marimba session, and its subject was
          described wrongly once already.

TASK 5 of 9. Plan: specs/awsf-v2-w01-marimba-contract.html, milestone M3.
PREDECESSORS: task 4 must be [x]. Everything the contract asserts is now either measured
and recorded in the plan or enforced by a test that exists. That ordering is deliberate.

READ FIRST
  specs/awsf-v2-w01-marimba-contract.html - the Solution section's eight-part outline, the
    "What Was Measured" section in full, and the Evidence section's second table (what
    each mechanism does NOT cover)
  docs/driving/skills/awsf/SKILL.md and cookbooks/owner_acts.md - as REPAIRED by task 1,
    so the contract does not restate what they now say correctly
  AGENTS.md invariant 1

DO
  Write the contract at the path Q1 chose, in eight parts, in this order:
    1. What the driving role is, and the one line separating it from worker work.
    2. The boundary: a denial at the tool surface performed by a hook delivered per
       invocation, with two fences - delegation-shaped tool NAMES, and owner-act command
       TEXT.
    3. WHAT THE BOUNDARY DOES NOT COVER. Seven measured items, each one plain sentence.
       This is the longest part and it is why the document exists.
    4. The measured settings semantics: --settings merges rather than excludes;
       --setting-sources is what excludes; a project hook returning allow does not override
       the deny; the permissions.allow case is named as untested.
    5. The architecture-review exception, written so W05's deep plan can cite it VERBATIM:
       the guard is delivered per invocation, so a session launched without marimba's
       settings keeps the delegation tools, and that is the supported route for a review by
       an agent that did not write the proposal.
    6. The four guarantees that replace the retired claims - no push path exists, nothing
       is auto-deleted, writes are confined to a managed worktree by path-policy, and
       canonical movement happens only through a human-approved local fast-forward - and
       the fact that the managed worktree root is a SIBLING of the state root.
    7. What marimba does instead of an owner act: prepare and explain. One line.
    8. Invariant 1 applied to this document's own text.

THREE PROPERTIES, ALL MECHANICALLY CHECKED BY TASK 6
  COMMAND-FREE  no shell fence, and no backticked awsf/just/npm run invocation. Name the
                owner acts by their PROPERTY - the acts the lifecycle reserves for the
                owner - never by list. The list has one source: main.ts.
  ROUTE-FREE    no relative path to another document. The contract travels into sessions
                where this tree is not present, which is exactly what W04 makes routine.
  SHORT         120 lines and 1,100 words are hard ceilings. This text is re-sent on every
                request of every marimba session; a cookbook is read once when needed.

DO NOT
  Use the word "sandbox". Describe any terminal-shape check as an authorisation boundary.
  Restate anything the cookbooks already own. Include an example carrying a session id, a
  run id, an attempt id or a machine path. Write out a bypass as a runnable command - the
  evasions are described in prose, deliberately, because a committed recipe is a recipe.

DEFINITION OF DONE
  The plan's task 5 checklist, every box. Then:
    npm run test:unit     -> no count below 989 pass, 0 fail; the contract is now a
                             driving document and boundary-claims.test.ts covers it
    npm run lint          -> clean
  Flip task 5's boxes and milestone M3 to [wip], and T05.md to done, in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
```

### T06 — The contract's own fences — command-free, route-free, no live state, within budget, plus Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     four matchers, four ways to be vacuously green, and one import that must not
          become a copy.

TASK 6 of 9. Plan: specs/awsf-v2-w01-marimba-contract.html, milestone M3.
PREDECESSORS: task 5 must be [x].

READ FIRST
  specs/awsf-v2-w01-marimba-contract.html - milestone M3, task 6, and the Solution
    section's reasoning for why each property is required
  core/test/unit/meta/driving-routes.test.ts - the ROUTE matcher you will IMPORT
  core/test/unit/meta/no-handwritten-schema.test.ts - the precedent for a narrowed pattern
    set with its reasoning written down

DO
  Write core/test/unit/meta/driving-contract.test.ts with four assertions over the
  contract, and a bite companion for each matcher feeding a synthetic offender IN MEMORY.

    COMMAND-FREE  no ```bash/sh/console fence, and no backticked awsf <verb>,
                  just <target> or npm run <script> token.
    ROUTE-FREE    IMPORT the route matcher from driving-routes.test.ts rather than
                  re-declaring it. Two copies of one regex is how a property quietly stops
                  being the same property. If it is not exported, export it - that is a
                  smaller change than a copy.
    NO LIVE STATE a UUID-shaped and run-id-shaped pattern. Invariant 1, in the one file
                  every marimba session reads.
    BUDGET        line and word count, with the limits as named constants carrying their
                  reason in a comment: this text is re-sent on every request.

DO NOT
  Write a file from a companion test. Every synthetic offender is a string in memory.
  Do not widen the command-free matcher to inline prose mentioning a command generally -
  the contract must be able to say the word "command".

DEFINITION OF DONE
  The plan's task 6 checklist, every box. Then:
    node --experimental-strip-types --test core/test/unit/meta/driving-contract.test.ts
    node --experimental-strip-types --test core/test/unit/meta/doc-reconciliation.test.ts
    npm run test:unit     -> no count below 989 pass, 0 fail
    npm run lint          -> clean
  Flip task 6's boxes and milestone M3 to [x], and T06.md to done, in the same commit. Do
  NOT touch specs/awsf-v2-plan.html.
```

### T07 — Generalise the route scanner from one router to every driving document, plus Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     two known traps, either of which makes the generalised fence pass for the wrong
          reason.

TASK 7 of 9. Plan: specs/awsf-v2-w01-marimba-contract.html, milestone M4.
PREDECESSORS: task 6 must be [x].

READ FIRST
  specs/awsf-v2-w01-marimba-contract.html - milestone M4 in full, and the "five fences"
    table in "What Was Measured" that explains why this hole exists
  core/test/unit/meta/driving-routes.test.ts - in full, including its comments on why the
    matcher requires a directory component and why parent-relative paths are reported
    rather than skipped

DO
  Generalise the scan from the single hardcoded ROUTER to drivingDocs(). Extend, do not
  rewrite: the existing matcher-bites companion is kept verbatim and gains a case for a
  route declared in a non-router document.

  TRAP 1 - resolve each route relative to ITS OWN FILE, not the router's directory. A
  route in a reference would otherwise resolve against skills/awsf/ by accident and pass
  for the wrong reason. Prove it: place a fixture route that would resolve ONLY under the
  wrong base and assert it is reported.

  TRAP 2 - the "advertises at least two routes" floor belongs to the ROUTER and to nothing
  else. Applied tree-wide it fails on every cookbook immediately, because a cookbook with
  no routes is normal.

  Every failure message names the offending FILE and the route. A tree-wide scan that says
  only "a route is broken" is worse than the single-file version it replaces.

CONTEXT THAT MAKES THIS CHEAP
  The tree outside the router is route-free today - a scan for backticked relative markdown
  paths across docs/driving/ returns matches only in SKILL.md. So this generalisation is
  green on arrival rather than a migration.

DEFINITION OF DONE
  The plan's task 7 checklist, every box. Then:
    node --experimental-strip-types --test core/test/unit/meta/driving-routes.test.ts
    node --experimental-strip-types --test core/test/unit/meta/driving-tree.test.ts
    npm run test:unit     -> no count below 989 pass, 0 fail
    npm run lint          -> clean
  Prove it bites: add a broken route to a scratch copy of a cookbook, watch it go red,
  discard the scratch copy. Flip task 7's boxes and milestone M4 to [x], and T07.md to
  done, in the same commit. Do NOT touch specs/awsf-v2-plan.html.
```

### T08 — The owner's install note, the amendment record, and the captured refusals

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     recording work already done, in the two places two invariants allow.

TASK 8 of 9. Plan: specs/awsf-v2-w01-marimba-contract.html, milestone M5.
PREDECESSORS: task 7 must be [x].

Q5 WAS DECIDED 2026-08-21: captured refusals are payload fixtures plus a redacted
quotation in this plan's Amendments. This task executes that reading. No invariant
amendment is needed, which is the point - the literal reading would have required one
against invariant 10, and that amendment would have had to CONTRADICT "Git and the journal
are the only evidence store" rather than restate it.

READ FIRST
  specs/awsf-v2-w01-marimba-contract.html - milestone M5, task 8, and Q5 in full
  AGENTS.md invariants 1 and 10
  core/test/unit/meta/junk-drawer.test.ts - what it scans and why

DO
  Execute Q5's answer:
    - quote the live denial from a real marimba session in the plan's Amendments, with
      every session id, run id and machine path removed;
    - leave the mechanical proof where it already is - the payload matrix, which reruns on
      demand and needs no stored transcript;
    - commit no transcript file anywhere.

  Re-verify the two probe records in "What Was Measured" - their date and the Claude Code
  version - and correct them if the version has moved since 2026-08-21. A measured figure
  with a stale version attached is a claim about a system that no longer exists.

  Record the awsf.config.yaml amendment from milestone M2 in the plan's Amendments with
  its evidence, its replacement guarantee, and the alternative that avoided it.

  Hand the owner one row for the versioned Darwin checklist the spine already names: the
  guard's payload parser is not guaranteed present on macOS, and without it the guard fails
  open silently. A note to the owner, not a ticket.

  Confirm the install: the owner follows the tree README's steps once on this machine, and
  the result is confirmed by ONE denied call. Reading a settings file is not confirmation;
  a denial is. The Q4 banner is a SECOND, WEAKER signal and must not be mistaken for the
  first - it proves the settings loaded and the guard file is there, not that the hook
  fired.

DO NOT
  Commit anything matching *receipt*, *manifest*, or holding a transcript. Quote a session
  id anywhere, including inside a plan. Turn the Darwin row into a task.

DEFINITION OF DONE
  The plan's task 8 checklist, every box. Then:
    node --experimental-strip-types --test core/test/unit/meta/junk-drawer.test.ts
    npm run test:unit     -> no count below 989 pass, 0 fail
  Flip task 8's boxes and milestone M5 to [wip], and T08.md to done, in the same commit.
  Do NOT touch specs/awsf-v2-plan.html - that is task 9's job and only task 9's.
```

### T09 — Full offline acceptance and the spine roll-up, plus Testing Strategy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     running everything and flipping two marker sets in one commit. The judgement was
          spent in the eight tasks before this one.

TASK 9 of 9. Plan: specs/awsf-v2-w01-marimba-contract.html, milestone M5.
PREDECESSORS: tasks 1-8 all [x], and milestones M1-M4 all [x].

THIS IS THE ONLY TASK THAT TOUCHES THE SPINE. Every earlier task was told not to. Read the
two-marker-set rule in the plan's Implementation Phases section before you flip anything.

READ FIRST
  specs/awsf-v2-w01-marimba-contract.html - the Validation Commands section in full
  specs/awsf-v2-plan.html - the W01 block, its six checklist boxes, and the Shared
    Invariants section's marker discipline
  AGENTS.md invariants 2, 11 and 12

DO
  Run the whole Validation Commands list, in order, nothing skipped:
    npm test              -> unit, contract, simulation and journeys, all green
    npm run lint          -> clean
    npm run typecheck     -> clean
    just awsf doctor      -> read-only, no finding attributable to this work
  plus each named meta-fence individually, so a failure names itself rather than arriving
  inside a 989-test run.

  Confirm every milestone marker in specs/awsf-v2-w01-marimba-contract.html is [x] and
  every checklist box is checked. A single unchecked box means this task is not done.

  THEN, and only then, in ONE commit:
    - specs/awsf-v2-plan.html: milestone M1 / W01 to [x], and its six checklist boxes
    - specs/tickets/awsf-v2-plan/W01.md: state to done
    - specs/tickets/awsf-v2-w01-marimba-contract/T09.md: state to done
    - this plan's modified row and an Amendment entry carrying the commit SHA
  Invariant 12 is enforced: a plan and its tickets never disagree, and the flip happens in
  the same commit, never a later one.

DO NOT
  Flip a spine box whose claim you have not verified. The spine's W01 checklist has six
  boxes and one of them - the hook-precedence absence - was closed by the probe recorded in
  this plan's "What Was Measured", not by anything built in these nine tasks. Verify it
  reads correctly before you check it. Never name an agent, model or AI tool as commit
  author, committer or co-author.

DEFINITION OF DONE
  Every box in the plan's Validation Commands section, every box in task 9's checklist, and
  the spine's W01 milestone at [x] with W01.md at done in the same commit.
```
