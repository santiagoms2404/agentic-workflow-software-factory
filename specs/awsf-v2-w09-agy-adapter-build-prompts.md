# AWSF v2 W09 — The `agy` adapter, parser first · build prompts

Prompt source for [`awsf-v2-w09-agy-adapter.html`](./awsf-v2-w09-agy-adapter.html).
Every `### Tnn` block in Section B is **byte-identical** to the `## Build prompt` block of
[`specs/tickets/awsf-v2-w09-agy-adapter/Tnn.md`](./tickets/awsf-v2-w09-agy-adapter/); the
invariant-12 sync fence (`core/test/unit/meta/ticket-plan-sync.test.ts`) compares the two and
fails when either is edited alone. **Edit neither by hand — regenerate both.**

Twenty tasks, `T01`…`T20`, across five milestones. One ticket is one fresh session.

---

# Section A — Conventions used by every prompt

These are stated once here and once in
[`./tickets/awsf-v2-w09-agy-adapter/README.md`](./tickets/awsf-v2-w09-agy-adapter/README.md)
§ Conventions. They are not repeated inside the prompts.

**The workstream is optional.** Nothing in v2 waits on W09. Milestone M1 is a decision gate and
the owner may legitimately close the workstream there, with the bytes retained and the gap
recorded. A session that reaches a wall should say so rather than route around it.

**The route ends disabled.** No ticket enables it, and no ticket edits `awsf.config.yaml` —
that file is protected and `path-policy` rejects `protected-path` independently of the write
globs. Enabling the route is a separate owner act.

**Detection is described as detection.** The route is **detection-bounded**. The bare adjective
never describes it, in code, in comments, in tests or in prose. No session claims timely abort:
`ACTIVE` precedes completion, not proven initiation.

**The baseline rule.** Run `npm run test:unit` at the exact base SHA *before* changing anything,
and again after. `doctor` and `lint` do not catch a red baseline, and a red base blocks a
correct build. Record both counts in the commit body.

**Quota.** Every task here runs offline. No ticket starts a provider process, reaches the
network, or spends quota. The two live calls the plan names — the `--sandbox` probe and the
`--input-format=stream-json` shape — are owner acts outside this task graph.

---

# Section B — Task prompts (recommended)

### T01 — Retain the capture under the provider-fixture convention
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     careful, literal evidence work - the value is in getting the provenance exactly right,
          not in reasoning about it.

TASK 1 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M1.
PREDECESSORS: none. This is the first task.

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M1
  specs/fixtures/agy/README.md IN FULL, and every byte beside it - stream2 through stream6,
    help.txt, version.txt. Read the README BEFORE the spine's W09 prose: it corrects that prose.
  core/test/fixtures/providers/codex/PROVENANCE.md IN FULL - the convention you are copying,
    including its "what this capture could NOT measure" section
  core/test/fixtures/providers/claude/PROVENANCE.md - the second worked example

DO
  Copy all eight files from specs/fixtures/agy/ to core/test/fixtures/providers/agy/, byte
    for byte. Do not reformat, re-indent, normalise line endings, or scrub anything.
  Write core/test/fixtures/providers/agy/PROVENANCE.md on the codex model. It records:
    - binary, version 1.1.15, capture date 2026-09-15, host, and the auth method
    - that every capture was taken WITHOUT --dangerously-skip-permissions, so what is recorded
      is the guarded default behaviour
    - the one scrub: stream3's Google OAuth URL carrying a PKCE code_challenge and a state
      nonce, replaced by <oauth-url-scrubbed>, one substitution and nothing else
    - per-stream: what it is and what it establishes (see the plan's Problem section)
  Add a test asserting each copied file is byte-identical to its specs/fixtures/agy/ original
    for as long as that directory exists - Q5 is open and two copies must not drift.
  Add a test asserting the scrub placeholder is present in stream3 and that no other file
    carries an authorization URL.
  RECORD THE FIXTURE-INTEGRITY GAP rather than papering over it: unlike codex/capture-probe.ts,
    these bytes came from hand-typed argv that no file records, so the argv under test is NOT
    the argv that produced them by construction. Write the per-stream argv if the owner supplies
    it; write "unrecorded" if not. Do not reconstruct it by inference.
  RECORD THE TWO ABSENCES: no stderr file beside any stream (the "root agent idle; waiting for
    1 background task(s)" line is QUOTED in the README, not retained), and no stream7 - the
    --sandbox probe the graduation condition needs.
  RECORD THE MACHINE-PATH DECISION under its own heading: the capture's cwd values carry the
    owner's home path in three spellings and this is DELIBERATE - the path is the evidence for
    two of this plan's four corrections, and scrubbing it would destroy what streams 4, 5 and 6
    exist to show. Note that the codex and claude probes avoided machine paths only because
    their cwd was a throwaway temporary directory.

DO NOT
  Do not scrub, normalise or "tidy" any captured byte. Do not delete specs/fixtures/agy/ -
    Q5 is the owner's, and the byte-identity test is what makes the eventual answer a one-liner.
  Do not write a capture-probe.ts. It would have to call buildSpec, which does not exist yet,
    and running it would spend quota to reproduce bytes already in the tree.

DONE WHEN
  npm run test:unit - green at the exact base SHA BEFORE any change, and green again after.
    Record both counts. See the never-do list in the README about a red baseline.
  The two new tests pass, and each has been seen to fail by inducing one drift.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 1's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T02 — Extend the credential sweep to reach the retained capture, and prove it bites
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     a small, well-precedented extension to an existing fence; the care is in not making the
          new leg vacuous.

TASK 2 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M1.
PREDECESSORS: T01 is [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M1
  core/test/unit/meta/no-credentials-in-fixtures.test.ts IN FULL - all four sweeps and the
    companion test that proves the driving-tree leg bites
  core/test/unit/meta/_fixture-scrub.ts and core/src/policy/redaction.ts - CREDENTIAL_PATTERNS
  AGENTS.md invariant 9

DO
  Extend the fixture sweep so it walks specs/fixtures/ as well as core/test/fixtures/, over
    the same extension list (.ts .json .jsonl .md .txt .yaml .yml).
  Record the measurement, not the assumption: run the sweep and report that both directories
    pass today, with the command that produced the result.
  Add a companion test that feeds the credential predicate a synthetic offender held in memory,
    so the new leg is not vacuous - walkFiles returns [] for a missing directory, and a sweep
    nobody has watched catch something is decoration.
  Keep the assembled-token convention: build the specimen by concatenation at runtime, never as
    one literal, so a repository-wide sweep does not report this fence's own source.

DO NOT
  Do not widen the sweep to all of specs/. The plan HTML files legitimately quote flag names
    and error strings, and a fence that over-fires teaches authors to stop writing plainly.

DONE WHEN
  npm run test:unit - green at the base SHA and green after, counts recorded.
  The new leg has been seen to fail by planting an assembled token in a scratch fixture under
    specs/fixtures/, and seen to pass again once removed.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 2's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T03 — Pin the containment obstacle to the bytes
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     the test is simple; its failure message is the artifact, because it is what a future
          session reads before bumping a constant.

TASK 3 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M1.
PREDECESSORS: T01 is [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M1
  The plan's Problem section 3 IN FULL - the containment picture
  specs/fixtures/agy/stream2.jsonl line 1 - init.tools and init.permission_mode
  awsf.config.yaml - policy.protected_operations, and the documenter role
  core/src/config/schema.ts - KNOWN_PROTECTED_OPERATIONS

DO
  Add core/test/unit/meta/agy-roster-pin.test.ts. It reads init.tools out of the retained
    capture - never a hand-copied list - and asserts:
    - the roster is exactly 57 entries
    - all four subagent tools are present: define_subagent, invoke_subagent, manage_subagents,
      browser_subagent
    - the shell subset is present: run_command, send_command_input, command_status
    - the file-write subset is present: write_to_file, replace_file_content,
      multi_replace_file_content, sed_file
    - the six external-reach tools are present: call_mcp_tool, schedule, send_message,
      manage_inbox, search_web, read_url_content
    - init.permission_mode is "request-review" in every stream that carries an init
  WRITE THE FAILURE MESSAGES AS THE ARTIFACT. The subagent assertion's message says, in one
    sentence, that the presence of these four tools is why no role may be assigned to this
    route. The permission_mode assertion's comment records that under this default the agent
    executed a PowerShell command unprompted when merely asked where it was.
  Keep it a META-test, not an adapter test. It must survive a decision to build no parser at
    all, which is the branch Q4 may take.

DO NOT
  Do not describe any of these tools as "detected" or "covered". The post-return worktree
    fingerprint sees writes to the worktree and nothing else; six of the tools above touch
    no worktree at all.

DONE WHEN
  npm run test:unit - green at the base SHA and green after, counts recorded.
  The roster assertion has been seen to fail by deleting one tool from a copied roster.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 3's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T04 — Testing Strategy, and the M1 decision gate
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this task can legitimately end the workstream. It is a judgement about evidence, and the
          owner needs the case for both branches stated fairly.

TASK 4 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M1.
PREDECESSORS: T02 and T03 are [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M1
  The plan's Questionables Q4 IN FULL, and Q1 and Q2
  specs/awsf-v2-plan.html - the W09 block's checklist and the optional-workstream note
  The Amendments section of this plan

DO
  Run the full offline validation set and record every count.
  Bump the four hard-coded corpus counts this plan's artifacts moved, in the same commit, or
    report the exact deltas to the owner:
      core/test/unit/registry/plan-kind.test.ts   - deep plans in the repository
      core/test/unit/api/routes.test.ts           - resolved tickets (+1 per ticket)
      core/test/unit/backlog.test.ts              - blocked aggregate (+1 per ticket with deps)
      core/test/unit/dashboard-backlog-selection.test.ts - ready tickets (+1)
    Establish the baseline FIRST by moving this plan's new artifacts aside and re-running:
    the working tree may already carry other untracked deep plans.
  PRESENT THE DECISION to the owner and stop for it. State plainly:
    - what M1 has already secured on every branch (the bytes retained where the fences reach
      them, the roster pinned, the sweep extended)
    - what M2-M5 would add, and its cost in lines of code nothing calls until Q1 changes
    - that the spine sanctions closing an optional workstream unbuilt with its gap recorded
  Append an Amendment recording the M1 close AND the owner's answer to Q4.

DO NOT
  Do not start M2 before the owner has answered Q4. This is a gate, not a preliminary.
  Do not present "build it" as the default because a plan exists. The capture made closing
    unbuilt MORE defensible, and a session that hides that is not doing the plan's job.

DONE WHEN
  npm run test:unit, npm run typecheck, npm run lint - green and clean, counts recorded.
  The four corpus constants are green, or their deltas are reported.
  The M1 Amendment is written, the milestone header reads [x], and the owner has answered Q4.
  If the answer closes the workstream: this ticket is the last one that runs. Record it in the
    Amendment, leave every later ticket at `state: todo`, and say so in their Handoff sections.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 4's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  This is the LAST task of milestone M1: flip the milestone header to [x] and every
  remaining checklist box in it, THEN append an Amendment to specs/awsf-v2-w09-agy-adapter.html
  recording the CLOSE of M1:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and its blocker
    - the friction it hit: what took longer, what the plan got wrong, what a later
      milestone must now do differently
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T05 — The decoder skeleton, and a stream that opens with prose
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     stream-decoder edge work, and the shape chosen here constrains the next three tasks.

TASK 5 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M2.
PREDECESSORS: T04 is [x] AND the owner answered Q4 in favour of building.

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M2
  core/src/adapters/pi-codex-stream.ts IN FULL - the decoder shape you are mirroring
  core/src/adapters/stream/line-framer.ts, event-sequencer.ts, output-budget.ts, snippet.ts
  core/src/contracts/normalized-events.ts - the twelve kinds, NOTICE_CODES, validateEventSequence
  core/test/fixtures/providers/agy/stream3.jsonl - seven prose lines, then a well-formed result

DO
  Add core/src/adapters/antigravity-stream.ts. It decodes ONE line to zero or more normalized
    events through an injected EventSequencer, mirroring PiStreamDecoder's constructor shape
    (adapter, provider, requestedModel, now, optional session record).
  START AT stream3, NOT at the happy path. A decoder built happy-path-first treats line 1 as
    corruption and never reaches the terminal.
  A non-JSON line yields one notice with code "non-json-output" and the line as truncated detail;
    parsing continues.
  CAP the notice count, and emit one final notice when the cap is reached. A CLI that prints a
    thousand prose lines must not flood the journal, and silence about the cap is worse.
  A JSON line whose "event" is none of init | step_update | result yields notice /
    unknown-provider-event. A step_update whose step_type is unrecognised yields the same.
  Reuse LineFramer, EventSequencer and OutputBudget. Introduce no second framing rule, no
    second sequencing rule, and no second opinion about the environment allowlist.

DO NOT
  Do not import node:child_process and do not call global fetch. Two meta-tests hold this and
    they name the whole adapters directory.
  Do not treat the first non-JSON line as a fatal parse error. That is the specific defect the
    fixture exists to prevent.

DONE WHEN
  Replaying stream3 produces exactly seven non-json-output notices followed by one terminal,
    and validateEventSequence returns [].
  npm run test:unit - green at the base SHA and green after, counts recorded.
  core/test/unit/meta/child-process-fence.test.ts and adapter-fence.test.ts stay green.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 5's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T06 — Steps to events: text, tools, and the two step types that carry nothing
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this is where the event-ordering evidence becomes code, and where a careless comment
          would turn detection into a claim of prevention.

TASK 6 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M2.
PREDECESSORS: T05 is [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M2
  The plan's "The Event Mapping" section IN FULL - every row is specified there
  core/test/fixtures/providers/agy/stream2.jsonl IN FULL, line by line
  core/src/contracts/normalized-events.ts - ToolRequestedEventSchema, ToolCompletedEventSchema,
    mintToolCallId

DO
  agent_response with text_delta yields text.delta at BOTH ACTIVE and DONE. The closing DONE
    carries one too (stream2 line 16 is "\n") - dropping it loses a byte of the response.
  agent_response WITHOUT text_delta emits no text event and is not an error (stream2 lines 3
    and 8 are thinking-only steps carrying usage and nothing else).
  step_type "tool" at ACTIVE yields tool.requested: a host-minted toolCallId from
    mintToolCallId, keyed through a map from step_index; name from tool_name; inputSummary from
    tool_info.parameters through the shared summarize helper and the output budget.
  The same step_index at DONE yields tool.completed carrying the SAME minted id,
    outcome "ok", durationMs = Math.round(duration_seconds * 1000), resultSnippet from
    tool_info.output.
  user_input and system_message emit nothing. Write a comment saying this is a decision about
    two step types OBSERVED to carry no payload, not a fallthrough.
  Assert against stream2: exactly two tool pairs - run_command as t1 at 8199 ms and view_file
    as t2 at 54 ms - and the t1 request carries CommandLine in its inputSummary.
  STATE THE LIMIT IN THE TEST THAT PROVES THE ORDERING, in a comment beside the assertion:
    ACTIVE precedes COMPLETION, not proven INITIATION. This is detection with latency. No
    abort is claimed to be timely.

DO NOT
  Do not propagate provider tool ids into normalized events. Ids are host-minted t1, t2, ...
  Do not invent a failure discriminator for tool.completed. The capture shows no failing tool
    call, so "error" and "cancelled" outcomes are unobserved here; only T08's settlement path
    produces "cancelled".
  Do not write the word "prevent", "block" or "stop" about anything in this file.

DONE WHEN
  Concatenating every text.delta of stream2, 4, 5 and 6 reproduces that stream's
    result.response BYTE FOR BYTE - asserted, not eyeballed.
  The two tool pairs assert green and validateEventSequence returns [] for stream2.
  npm run test:unit - green at the base SHA and green after, counts recorded.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 6's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T07 — Usage and identity: the sum rule, and a route that never names its model
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     two rules a reasonable implementer gets wrong in the same direction - by trusting the
          stream to be more informative than it is.

TASK 7 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M2.
PREDECESSORS: T05 is [x]. T06 may be in progress; these two do not collide.

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M2
  The plan's "The Event Mapping" section - the usage and identity rows, and the callout
  core/src/contracts/normalized-events.ts - TokenUsageSchema, UNREPORTED_TOKEN_USAGE,
    REASONING_RELATIONS, MODEL_RESOLUTION_PROVENANCES
  core/test/fixtures/providers/codex/PROVENANCE.md - the section headed "Two claims this file
    made that the review refuted" - the SAME correction, on the other route
  core/src/adapters/catalog.ts - MODEL_FAMILIES, and why contextWindow stays null

DO
  Emit EXACTLY ONE usage event per run, decoded from result.usage. Do NOT emit per-step usage.
  Write the test that proves WHY, because the reason is not obvious from the code: the per-step
    DONE usages of stream2 sum field-by-field to the result's - 21218 input, 1380 output,
    1197 thinking, 36365 cache-read, 22598 total - so a per-step emission would double every
    figure that reaches the ledger and the dashboard.
  Map input_tokens -> inputTokens, output_tokens -> outputTokens,
    cache_read_tokens -> cacheReadTokens, thinking_tokens -> reasoningTokens.
  Set cacheWriteTokens to null, NEVER 0. The provider reports no such field, and 0 would be
    authoritative data about something nobody measured.
  Set reasoningRelation to "unknown". Write the comment that records the arithmetic making
    "included-in-output" plausible (per-step total_tokens equals input + output exactly, and
    thinking <= output in all four steps) AND the absence of any vendor source that would make
    it provable - agy is closed-source, so the reading pi's decoder could do is unavailable.
  model.resolved carries provenance "route-attributed" and the requested selector.
  Add a test asserting NO retained stream contains the substring "model" at all, so the spine's
    "stream-authoritative model identity" claim cannot quietly return. Cite codex/PROVENANCE.md
    in its message, where the same correction was made on the other route.
  getModelInfo reports usageAuthority "provider" and costAuthority "unavailable", with the
    no-cost finding in a comment beside it.

DO NOT
  Do not set costAuthority to "catalog-estimate". There are no rate figures for this family,
    and MODEL_FAMILIES keeps contextWindow null for exactly this reason: a made-up ceiling is
    worse than no ceiling, and so is a made-up price.
  Do not set reasoningRelation to "included-in-output" because the arithmetic is consistent
    with it. Consistent is not proven, and the contract has an "unknown" case for this.

DONE WHEN
  The sum-rule test and the no-model-identity test both pass, and each has been seen to fail.
  npm run test:unit - green at the base SHA and green after, counts recorded.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 7's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T08 — Terminals: success, error, missing, and the open tool at the end
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the terminal path is where a stream decoder is most often quietly wrong, and one of the
          four cases has no fixture until you derive it.

TASK 8 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M2.
PREDECESSORS: T06 and T07 are [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M2
  core/src/adapters/pi-codex.ts - #settleHeld and the comment above it, on why the exit code
    is MEASURED rather than assumed
  core/src/contracts/normalized-events.ts - validateEventSequence, especially
    tool-unsettled-at-terminal
  core/test/fixtures/providers/codex/PROVENANCE.md - the derived cancelled fixture and the
    startsWith assertion that stops it drifting into fiction

DO
  status "SUCCESS" yields run.completed, HELD so its exitCode is measured from the process
    rather than assumed at the moment the terminal line was seen. null stays null when the
    process does not exit in time - a run whose exit nobody saw did not exit cleanly.
  status "ERROR" yields run.failed with errorCode "E_BACKEND_FAILURE" and result.error as the
    message. stream3 is the fixture; its zeroed usage still produces a usage event, because
    zero reported is authoritative data.
  A stream that ends with no result yields run.failed / E_TERMINAL_MISSING. Build the fixture
    as a BYTE PREFIX of stream2 cut mid-line, and assert capture.startsWith(prefix) in the
    suite so the derived file cannot drift.
  Cut the prefix INSIDE an open run_command so the next rule is exercised rather than asserted:
    any tool still at ACTIVE when a terminal arrives is settled first with outcome "cancelled",
    so tool-unsettled-at-terminal cannot fire.
  Write the comment recording what this route has NO terminal for: quota. No quota refusal has
    been captured, agy exposes no source to read the wording from, and a quota-shaped failure
    would arrive as E_BACKEND_FAILURE. State it as a gap; do not fill it.

DO NOT
  Do not map anything to E_QUOTA_EXHAUSTED on this route. Guessing a vendor's refusal wording
    is how a retry loop gets built on a sentence nobody has read.
  Do not synthesise a fixture for a shape nobody has observed. The prefix is legitimate because
    every byte in it is captured; an invented ERROR variant would not be.

DONE WHEN
  All three captured terminal paths and the derived fourth pass, and validateEventSequence
    returns [] for every one.
  The startsWith assertion is green.
  npm run test:unit - green at the base SHA and green after, counts recorded.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 8's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T09 — Testing Strategy: every retained stream replayed
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT high
  CLAUDE  claude:sonnet · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     table-driven replay plus a coverage assertion; the thinking was done in T05-T08, the
          discipline is in making 'fixture-complete' a test result rather than a claim.

TASK 9 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M2.
PREDECESSORS: T06, T07 and T08 are [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M2
  The plan's milestone M2 task 9 checklist
  core/test/unit/adapters/stream/ - the three existing stream tests, for shape

DO
  Make the replay TABLE-DRIVEN over the five streams, so a sixth joins by adding a row.
  Assert validateEventSequence returns [] for every stream: contiguous seq, exactly one
    terminal, it is last, and no tool left open.
  Add a COVERAGE assertion that enumerates the decoded kinds and fails if any of the three
    provider event kinds, four step types, or two terminal statuses is unexercised. This is
    what makes "fixture-complete" a test result rather than a claim.
  Induce one drift in at least two replay assertions and watch them go red: change a byte in a
    fixture, and delete the open-tool settlement.
  Append an Amendment recording the M2 close, including any row that closed [f] and the
    condition holding it.

DO NOT
  Do not add a live capture to close a coverage hole. If a case cannot be covered from the
    retained bytes, mark it [f] and name the capture that would close it.

DONE WHEN
  All five streams replay and the coverage assertion passes.
  npm run test:unit, npm run typecheck, npm run lint - green and clean, counts recorded.
  The M2 Amendment is written and the milestone header reads [x].

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 9's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  This is the LAST task of milestone M2: flip the milestone header to [x] and every
  remaining checklist box in it, THEN append an Amendment to specs/awsf-v2-w09-agy-adapter.html
  recording the CLOSE of M2:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and its blocker
    - the friction it hit: what took longer, what the plan got wrong, what a later
      milestone must now do differently
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T10 — buildSpec, and the flag that eats the prompt
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     a small function whose every element has a measured reason; the risk is dropping one of
          them because it looks optional.

TASK 10 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M3.
PREDECESSORS: T09 is [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M3
  specs/fixtures/agy/help.txt IN FULL - the whole flag surface
  The plan's milestone M3 task 10 checklist IN FULL - every flag has a stated reason
  core/src/adapters/pi-codex.ts - buildSpec, and its comment about stdin versus argv
  core/src/adapters/interface.ts - ProcessSpec

DO
  Add buildSpec to core/src/adapters/antigravity.ts.
  Use "=" form for EVERY flag, the prompt included, so the argv contains no positional argument
    at all and Go's stop-at-first-non-flag has nothing to trigger on. Place --print last as a
    second line of defence.
  Always include --output-format=stream-json. Without it the CLI emits prose.
  Always set --print-timeout= explicitly from the host's silence budget. The DEFAULT IS 5m0s
    against runtime.silence_timeout_seconds of 2700; leaving it unset caps every phase on this
    route at five minutes and no existing test would notice.
  Always include --disable-slash-commands. The spine's rule that no workstream may put a skill
    in the execution path is why pi launches with --no-skills; this is agy's analogue.
  Pass --model= only when the selector names one, guarded by the same safe-selector regex
    pi-codex.ts uses. Comment that NO model name on this route has been verified - the
    subcommand that would list them requires an authenticated session.
  Use the shared filterEnv allowlist for the environment, and shell: false.
  Write the comment for --mode=plan: it is NOT used as a containment mechanism, because the
    spine records that plan mode steers rather than enforces and that a write executed under it.
  Write the comment for --add-dir: not used, and the only workspace flag the CLI exposes
    WIDENS the workspace - none narrows it.

DO NOT
  Do not put --print before another flag. That is the trap: it makes the next flag the prompt,
    runs, and exits 0 with prose output and empty stderr.
  Do not use --dangerously-skip-permissions anywhere, in code, in a test, or in a comment as a
    suggestion.

DONE WHEN
  npm run test:unit - green at the base SHA and green after, counts recorded.
  npm run typecheck and npm run lint - clean.
  Every flag in the emitted argv has a comment naming why it is there.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 10's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T11 — The prompt's ceiling, and the path the capture did not take
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     a refusal and a comment; the value is in refusing rather than truncating, and in
          recording the alternative accurately instead of implying it was considered.

TASK 11 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M3.
PREDECESSORS: T10 is [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M3
  The plan's milestone M3 task 11 checklist and Questionable Q6 IN FULL
  specs/fixtures/agy/help.txt - --input-format and its stated requirement

DO
  Leave ProcessSpec's stdin field empty on this route, with a comment stating that the prompt
    travels in argv because that is the only shape the capture exercises.
  Carry a declared maximum prompt size and refuse above it with E_INVALID_REQUEST BEFORE any
    child starts, naming the ceiling and the reason in the message.
  Write the derivation beside the constant: the documented CreateProcess command-line limit of
    32,767 characters, less the rest of the argv.
  Assert THAT A REFUSAL HAPPENS, not the exact constant, so tuning the number later does not
    rewrite the test.
  Comment that whether WSL interop imposes exactly that limit is UNVERIFIED, and name the
    settlement: one offline probe invoking any Windows executable with a growing argv - no agy
    and no quota involved.
  Record the unexplored alternative rather than implying it: --input-format=stream-json reads
    one NDJSON message per line from stdin and requires --output-format=stream-json. It would
    remove the ceiling and take the prompt out of the process table. Its message shape is
    undocumented in help.txt and unobserved in the capture, which is why it is Q6.

DO NOT
  Do not truncate an over-long prompt. A truncated prompt produces a confident answer to a
    question nobody asked, and the run returns SUCCESS.
  Do not implement the --input-format path speculatively. Nobody has seen its envelope.

DONE WHEN
  The refusal is asserted by code and instanceof, never by message text.
  npm run test:unit - green at the base SHA and green after, counts recorded.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 11's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T12 — Effort, profiles, and the executable that cannot be named
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     three refusals that will each look like an unimplemented feature to the next reader;
          each needs its measurement written beside it or it will be 'fixed'.

TASK 12 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M3.
PREDECESSORS: T10 is [x]. T11 may be in progress; these two do not collide.

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M3
  specs/fixtures/agy/help.txt - --effort's stated values, and the ABSENCE of any allow/deny
    tool flag and any system-prompt flag
  core/src/adapters/pi-codex.ts - permissionArgs and the HOST_ONLY_PROFILE refusal; the
    THINKING_ALIASES comment about pi having a real off switch
  core/src/config/schema.ts - AgentDefinitionSchema's thinking union
  core/src/config/machine-path.ts - ABSOLUTE_PATH_PATTERN
  core/src/execution/transport-broker.ts - resolveExecutable
  awsf.config.yaml - the documenter role's tools block

DO
  EFFORT, declared lossy. Export a frozen mapping table so it is reviewable in one place:
    low -> low, medium -> medium, high -> high, xhigh -> high. One declared loss.
    Record the measured counts in a comment: the config's agent schema declares FIVE levels
    (none, low, medium, high, xhigh); the pi route accepts SEVEN; agy accepts THREE.
  REFUSE "none" with E_INVALID_REQUEST rather than silently raising it to low. pi-codex.ts's
    own comment sets the principle - it maps none to off so that "the harness says what it
    means" - and agy has no off switch to mean it with.
  PROFILES, all refused. Every profile the config can name - readonly, managed-worker,
    no-tools - raises E_POLICY_CEILING_UNENFORCEABLE, and the message names the absent flag.
  Use the documenter role as the worked example in the test, because it is the ONLY role the
    spine ever contemplates for this route: its allow list is read, grep, find, ls, edit, write
    - deliberately excluding exec - and on this route that exclusion has NO expression
    whatsoever while run_command sits in a 57-tool roster.
  THE EXECUTABLE, both refusals proven by test:
    - executable "agy" reaches resolveExecutable, which searches PATH and raises
      ExecutableNotFound; the alias is shell-local and the environment allowlist passes only
      PATH, HOME and TMPDIR
    - an absolute path cannot be committed instead: ABSOLUTE_PATH_PATTERN matches /, C:\, \\
      and ~ on EVERY string leaf, so that config key raises ConfigAbsolutePathError
    Comment the two exits: an owner-side PATH install, or the machine-local layer
    awsf-v2-w04-project-registry introduces. Both are outside this workstream.

DO NOT
  Do not approximate a tool ceiling. There is no flag to express one, and an adapter that
    accepts a profile it cannot enforce is the exact defect E_POLICY_CEILING_UNENFORCEABLE
    exists for.
  Do not add an absolute executable path to awsf.config.yaml. It is protected, and the loader
    would refuse it anyway.

DONE WHEN
  Every refusal is asserted by code and instanceof.
  The effort table is exported and asserted as a whole, so a silent row change fails.
  npm run test:unit - green at the base SHA and green after, counts recorded.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 12's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T13 — Testing Strategy: the exact-argv descriptor test
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     the one subtlety is that the trap must be DRIVEN, not described - a test that only
          asserts the right order never shows the wrong one failing.

TASK 13 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M3.
PREDECESSORS: T11 and T12 are [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M3
  core/test/unit/adapters/pi-codex.test.ts - the descriptor-test shape you are copying
  The plan's milestone M3 task 13 checklist

DO
  Assert buildSpec as a COMPLETE frozen array for three requests - a bare one, one with an
    effort, one with a model selector - and compare the whole descriptor, environment and
    shell: false included. A substring check passes on a transposition; an array compare does
    not.
  Give the trap its own test. Construct the TRANSPOSED argv, assert that
    --output-format=stream-json lands in the prompt position under Go's parsing rule, and state
    in the message that the observed consequence is exit 0 with prose output and empty stderr.
  Assert every refusal from T11 and T12 by code and instanceof.
  Confirm the two adapter fences stay green over the new modules.
  Induce one drift in each: reorder one flag; make the profile refusal return a flag array
    instead of throwing.
  Append an Amendment recording the M3 close and whether the owner answered Q6.

DO NOT
  Do not assert on message text anywhere. Codes and instanceof only.

DONE WHEN
  npm run test:unit, npm run typecheck, npm run lint - green and clean, counts recorded.
  Both induced drifts were seen to fail and then fixed.
  The M3 Amendment is written and the milestone header reads [x].

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 13's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  This is the LAST task of milestone M3: flip the milestone header to [x] and every
  remaining checklist box in it, THEN append an Amendment to specs/awsf-v2-w09-agy-adapter.html
  recording the CLOSE of M3:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and its blocker
    - the friction it hit: what took longer, what the plan got wrong, what a later
      milestone must now do differently
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T14 — The badge that would have lied
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     this one touches shared policy code that the two verified routes depend on; the change is
          small and the blast radius is not.

TASK 14 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M4.
PREDECESSORS: T13 is [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M4
  core/src/policy/sandbox-broker.ts IN FULL - grantSandbox, PermissionSession, bwrapSpec
  The plan's milestone M4 task 14 checklist
  Existing tests over sandbox-broker, so you can prove the verified routes are unchanged

DO
  Make the badge consult whether the route's adapter can express a tool ceiling, and degrade
    to "unavailable" / "none" when it cannot.
  DECLARE the capability on the adapter; do not infer it from an adapter id. A hard-coded
    adapter name in a policy module is the coupling driving-routes.test.ts already exists to
    punish elsewhere.
  Prove the two verified routes are UNCHANGED in every existing assertion, on both branches of
    the bwrap probe.
  Add a test covering all four combinations of platform-with-bwrap and adapter-can-express. The
    agy row reads "unavailable" in BOTH bwrap states.
  Comment the unmeasured case rather than assuming it: if bwrap ever IS present, bwrapSpec
    makes the executable bwrap and runs a Windows executable inside --unshare-all, and whether
    WSL interop survives that has never been tested. The settlement is offline and needs no
    agy: run any Windows executable under the same flags.

DO NOT
  Do not change what the badge reports for claude or pi. This task removes an overstatement on
    one route; it is not a redesign of the tri-state.

DONE WHEN
  The four-combination matrix passes and has been seen to fail by reverting the degrade.
  Every pre-existing sandbox-broker assertion is untouched and green.
  npm run test:unit - green at the base SHA and green after, counts recorded.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 14's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T15 — The cwd contract: a UNC working directory, and a prompt that must state it
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     it proves a mechanism UNAVAILABLE, which is a harder thing to write honestly than
          building one, and it lands a requirement in a composer another workstream owns.

TASK 15 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M4.
PREDECESSORS: T13 is [x]. T14 and T16 may be in progress; the three do not collide.

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M4
  core/src/policy/path-policy.ts IN FULL - normalizeRepositoryPath and its header on why
    refusing rather than repairing is the correct behaviour
  specs/fixtures/agy/README.md - the cwd table: three tool-free runs, three wrong answers
  specs/awsf-v2-w06-prompt-composition.html - where the composer lives
  The plan's milestone M4 task 15 checklist IN FULL

DO
  Write the cwd/path contract table into the plan and into the adapter's header, one row per
    captured case. init.cwd is the truth; the response text never is.
  Make the adapter assert init.cwd against the worktree it asked for and fail the run on a
    mismatch, after normalising the two spellings of the same directory.
  Land the requirement that PROMPT COMPOSITION MUST STATE THE WORKING DIRECTORY in the
    centralised composer W06 delivered. Write the per-route requirement and its test. Do NOT
    create a fourth composition site.
  PROVE in-stream path detection unavailable rather than asserting it: feed each captured tool
    parameter to normalizeRepositoryPath and assert InvalidPolicyPath for all of them -
    backslashes, a drive letter and a UNC prefix are each refused, and the refusal is CORRECT.
  Write the consequence where it will be read: a UNC-to-repository-relative mapping would have
    to be adapter-local and fail closed, nobody has written one, and until someone does the
    ONLY detection layer on this route is the post-return fingerprint - whole-turn, not
    per-call, attributing nothing.
  Record the throughput risk with its settlement: every file operation and every host gate
    command on a WSL-native worktree crosses the UNC redirector. The measurement is a timed
    file-heavy loop from the Windows side against a worktree-sized tree, versus the same work
    on ext4. No agy, no quota. Whether it gates anything is Q3.

DO NOT
  Do not relax normalizeRepositoryPath to accept backslashes or UNC prefixes. Its header states
    why: converting a backslash or dropping a traversal segment would authorize a different
    path from the one observed.
  Do not describe the post-return fingerprint as covering anything a tool does outside the
    worktree. Six of the 57 tools touch no worktree at all.

DONE WHEN
  The path-refusal table passes for every captured parameter.
  The composer requirement has a test and no new composition site exists - the
    prompt-composition-site meta-test stays green.
  npm run test:unit - green at the base SHA and green after, counts recorded.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 15's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T16 — Broker registration, and the spawn sites the broker will never see
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the positive half is routine; the negative half is this workstream's centre and must be
          written so it cannot be read without the positive half.

TASK 16 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M4.
PREDECESSORS: T13 is [x]. T14 and T15 may be in progress; the three do not collide.

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M4
  core/src/execution/transport-broker.ts - startProcess and the registration shapes
  core/src/adapters/pi-codex.ts - execute, and the comment on why there is no retry in an adapter
  core/src/adapters/stream/transport-loop.ts - drainStderr
  The plan's milestone M4 task 16 checklist IN FULL, and Problem section 3
  core/test/unit/meta/agy-roster-pin.test.ts - the pin T03 wrote

DO
  Against a FAKE broker, prove execute produces exactly one startProcess registration before
    any event is yielded, carrying the adapter id, the role and the reservation id it was handed.
  Keep the no-retry property: the adapter never starts anything itself and never starts
    anything twice, so a run that ends E_QUOTA_EXHAUSTED ends.
  Drain stderr from BEFORE the first stdout byte and never stop, so a child blocked writing to
    a full stderr pipe still reaches the part where it writes its result.
  WRITE THE NEGATIVE IN THE ADAPTER HEADER, referencing the roster pin by path so it cannot
    rot: invoke_subagent, define_subagent, manage_subagents and browser_subagent mean the TOOL
    creates spawn sites on the far side of transport-broker.ts - no registration, no
    reservation, no GO, no cancellation handle, no per-child worktree, no attribution.
  Record the second half in the same comment: stream2's stderr reports "root agent idle;
    waiting for 1 background task(s)", so work can outlive the visible turn. The CLI waits -
    but only until --print-timeout, and what becomes of a still-running background task when
    that timeout fires is UNMEASURED, as is whether it shares the process group AWSF's
    cancellation kills across the interop boundary.
  Keep the evidence discipline in the comment: that stderr line is QUOTED IN A README, NOT
    RETAINED AS BYTES, and closing that gap is one short session that spends no model tokens.

DO NOT
  Do not claim invariant 3 contains the provider's own spawns. It confines AWSF's spawns. The
    distinction is the whole point of this task.
  Do not add a retry, a fallback, or a second launch path anywhere in the adapter.

DONE WHEN
  The single-registration proof passes against the fake broker and has been seen to fail.
  child-process-fence and adapter-fence stay green over every new module.
  npm run test:unit - green at the base SHA and green after, counts recorded.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 16's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T17 — Testing Strategy
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     consolidation, plus one prose sweep that turns a spine checklist row into a grep.

TASK 17 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M4.
PREDECESSORS: T14, T15 and T16 are [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M4
  The plan's milestone M4 task 17 checklist, and Questionable Q3

DO
  Confirm the badge matrix, the path-refusal table and the single-registration proof all pass,
    and that each has been seen to fail by inducing one drift.
  Add the PROSE SWEEP: over specs/awsf-v2-w09-agy-adapter.html, its build prompts and its
    ticket set, assert the bare adjective never describes this route and that
    "detection-bounded" is the only form used. ONE exemption, allowlisted by exact string: the
    provider's own stderr line "bounded by --print-timeout", which is a quotation rather than a
    description. This is the spine's checklist row, made checkable.
  Record the UNC throughput measurement with the command that produced it and the numbers it
    produced - or mark the row [f] with the reason, per the owner's answer to Q3.
  Append an Amendment recording the M4 close, including anything the milestone discovered that
    a later reader would otherwise re-derive.

DO NOT
  Do not make the prose sweep a wide regex over all of specs/. It reads three named paths.

DONE WHEN
  npm run test:unit, npm run typecheck, npm run lint - green and clean, counts recorded.
  The prose sweep passes and has been seen to fail on a planted bare adjective.
  The M4 Amendment is written and the milestone header reads [x].

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 17's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  This is the LAST task of milestone M4: flip the milestone header to [x] and every
  remaining checklist box in it, THEN append an Amendment to specs/awsf-v2-w09-agy-adapter.html
  recording the CLOSE of M4:
    - what the milestone accomplished, in terms of what is now observably true
    - every task in it and its final state, naming any [f] row and its blocker
    - the friction it hit: what took longer, what the plan got wrong, what a later
      milestone must now do differently
    - the decisions made inside the milestone that the plan did not already carry
    - the landing commit SHA(s) and the suite counts at close
  Append the modified date to the metadata header in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T18 — Three doors, all shut
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-sol · reasoning medium
  WHY     mostly assertions over mechanisms that already exist; the judgement is in rewriting the
          availability reason so it stops saying something that is no longer true.

TASK 18 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M5.
PREDECESSORS: T17 is [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M5
  core/src/config/load.ts - ConfigUnverifiedAdapterError and assertKnownReferences
  core/src/adapters/antigravity.ts - the current isAvailable detail
  awsf.config.yaml - the adapters block and every agent's harness.adapter
  The plan's milestone M5 task 18 checklist

DO
  DOOR ONE, config. Assert the shipped config keeps enabled: false, and that setting
    enabled: true without verified: true raises ConfigUnverifiedAdapterError.
  DOOR TWO, availability. isAvailable() still returns blocked. REWRITE its code and detail: the
    honest reason is no longer "no captured stream" - there is one now - but that no tool
    ceiling can be expressed and the roster declares four subagent tools. Assert the new detail
    names the roster.
  DOOR THREE, roles. Assert no agent in awsf.config.yaml declares this adapter in its harness,
    and that the default worker is not it.
  Make each door FAIL INDEPENDENTLY against an in-memory config, by opening exactly one.
  Comment in the adapter what would have to change for the availability refusal to lift, and
    that it is not a code change: it is captured bytes, listed in the dossier T19 writes.

DO NOT
  Do not edit awsf.config.yaml. It is protected, path-policy rejects protected-path
    independently of the write globs, and inventing an owner-authorized change mechanism to
    route around that is the boundary working.
  Do not remove the unverified-adapter refusal because a parser now exists. The parser answers
    the READING question; the doors are about the PERMISSION question, which is still closed.

DONE WHEN
  All three doors assert green, and each has been seen to fail alone.
  npm run test:unit - green at the base SHA and green after, counts recorded.
  npm run typecheck and npm run lint - clean.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 18's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T19 — The graduation dossier
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     it fixes how a future session is allowed to read a result nobody has yet, which is a
          judgement about evidence rather than a piece of code.

TASK 19 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M5.
PREDECESSORS: T18 is [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M5
  specs/awsf-v2-plan.html - the W09 block's graduation condition, verbatim
  specs/fixtures/agy/help.txt - --sandbox's one-line description, and the absence of any
    allow/deny tool flag
  The plan's Questionables Q1 and Q7 IN FULL, and milestone M5 task 19 checklist

DO
  Write docs/design/agy-graduation-dossier.md. It states:
    - the spine's condition VERBATIM: graduation waits for captured bytes proving EITHER a
      provider tool-scoping flag OR an OS boundary, and it graduates for the DOCUMENTER ROLE
      ONLY
    - that no allow/deny flag exists, confirmed in help.txt, so the first branch is closed on
      read evidence rather than on absence of effort
    - that the second branch is UNANSWERED. --sandbox ("Run in a sandbox with terminal
      restrictions enabled") is the only untested candidate, and NO stream7 EXISTS IN THE
      CAPTURE. Say plainly that nobody has run it. Do not guess which way it would go.
    - the probe, exactly: the SAME prompt that produced stream2, the SAME argv with --sandbox
      added, in a throwaway directory. The question it answers: does --sandbox refuse the
      run_command that ran freely under request-review in stream2? The result lands as
      stream7-sandbox.jsonl with its stderr beside it.
    - WHAT EACH OUTCOME WOULD MEAN, fixed before the bytes arrive: REFUSED makes the OS
      boundary arguable for documenter and nothing more; RAN ANYWAY closes graduation and the
      route stays refused for every role.
    - WHAT NEITHER OUTCOME SETTLES: --sandbox is described as terminal restrictions, which on
      its face reaches run_command and says nothing about write_to_file, send_message, schedule,
      search_web, call_mcp_tool, twenty browser tools, or invoke_subagent. A green stream7 is
      necessary and nowhere near sufficient.
    - the two smaller fixture debts and their cost: the missing stderr beside stream2, and the
      unrecorded per-stream argv.
  Add the dossier to the plan's New Files list if it is not already there, and reference it
    from the adapter's isAvailable comment.

DO NOT
  Do not run the probe. It is an owner act outside the task graph, and this plan's
    recommendation is that it rides with Q6 in one session or not at all.
  Do not write the dossier as a to-do list. It is a decision record: graduation is CLOSED for
    want of evidence, not PENDING someone's attention.

DONE WHEN
  The dossier exists, and the doc-reconciliation meta-test is green over it.
  npm run test:unit, npm run typecheck, npm run lint - green and clean, counts recorded.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 19's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  Do NOT touch specs/awsf-v2-plan.html or its W09 marker. Only task 20 writes to the spine.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```

### T20 — Testing Strategy, and the workstream close
```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-sol · reasoning high
  WHY     the only ticket that writes to the spine, and the amendment it owes has to carry four
          corrections forward so a later reader inherits the corrected version.

TASK 20 of 20. Plan: specs/awsf-v2-w09-agy-adapter.html, milestone M5.
PREDECESSORS: T18 and T19 are [x].

READ FIRST
  AGENTS.md IN FULL
  specs/tickets/awsf-v2-w09-agy-adapter/README.md - the Conventions, the gates, and the never-do list
  specs/awsf-v2-w09-agy-adapter.html - Purpose, Problem, Solution, the Identifier Spine and
    "The Event Mapping" IN FULL, then milestone M5
  specs/awsf-v2-plan.html - the W09 block IN FULL, including its six checklist rows
  specs/tickets/awsf-v2-plan/W09.md
  The plan's Amendments section, and every milestone Amendment written so far
  The plan's Problem section 1 - the four corrections, which this amendment carries forward

DO
  Run the full validation set and record every count.
  Confirm the four fences are green: child-process-fence, adapter-fence,
    no-credentials-in-fixtures with its new leg, and ticket-plan-sync.
  Confirm every marker in specs/awsf-v2-w09-agy-adapter.html reads [x] or [f], and that every
    [f] names the condition holding it.
  Write the M5 Amendment, then the SPINE Amendment described in MARKERS below.
  Check the spine's six W09 checklist rows one at a time and record the answer for each:
    - deep plan authored with build prompts and ticket set, approved by the owner
    - says detection-bounded everywhere and the bare adjective nowhere, and names what
      detection does not cover
    - parser graduation complete with the route disabled; enabling it a separate owner act
    - event ordering settled by a capture, or the plan states plainly that timely abort is not
      claimed - THIS PLAN DOES BOTH
    - scrubbed fixtures for every event and terminal state exist in the tree
    - the deep plan's own milestones all reach [x], or the workstream closes unbuilt with its
      evidence gap recorded

DO NOT
  Do not enable the route as part of "finishing". The workstream ends with it disabled; that
    is the stop condition, not an incomplete state.
  Do not flip the spine marker before every marker in this plan reads [x] or [f].

DONE WHEN
  npm run test:unit - green at the base SHA and green after; typecheck and lint clean; all
    counts in the commit body.
  The four fences are green.
  Both Amendments are written, the spine marker and the spine ticket state are flipped in the
    same commit, and the route is still disabled and assigned to no role.

COMMIT
  When every DONE WHEN row is green, commit this task's work as ONE Conventional Commit:
    <type>(<scope>): <imperative summary, lower case, no trailing period, <=72 chars>

    <body: what changed and WHY - the decision behind the shape, the alternative rejected,
    and any row left [f] with the block that holds it. Wrap at 72 columns.>
  type in feat | fix | refactor | test | docs | chore | perf | build | ci
  scope = this plan's own vocabulary for the area (agy, adapter, fixtures, policy), not a file path.
  Include the plan HTML marker flips and this ticket's `state:` change IN THIS SAME COMMIT.
  Never put an agent, model, or AI tool in the commit identity, message, or trailers.
  If a DONE WHEN row cannot be made green, mark it [f], name the blocking condition in the body,
  and commit what is green - do not leave the tree dirty for the next session.

MARKERS
  Flip THIS plan's own markers in specs/awsf-v2-w09-agy-adapter.html: task 20's checklist boxes to [x]
  (or [f] with the reason), and this ticket's `state:` in the same commit.
  This is the FINAL task. Do task-20 duty for milestone M5 first, then - after every
  marker in specs/awsf-v2-w09-agy-adapter.html reads [x] or [f], and in the SAME commit -
  flip specs/awsf-v2-plan.html's Milestone M9 / W09 marker and its checklist to [x]
  and specs/tickets/awsf-v2-plan/W09.md's state to done.
  THEN append an Amendment to specs/awsf-v2-plan.html recording the CLOSE of W09:
    - what this workstream delivered against the spine's claim for it, claim by claim
    - THE FOUR CORRECTIONS this plan made to the spine's own W09 prose, restated so a
      later reader inherits the corrected version rather than the original
    - which spine Questionables it resolved, and how
    - the friction and the surprises, including anything a LATER workstream inherits
    - anything routed elsewhere rather than built, and to which workstream
    - every row that closed [f], with the block that holds it
    - the landing commit SHA and this plan's final suite counts
  State in one sentence a reader cannot miss that the route ends DISABLED and assigned
  to no role, and that permission graduation is closed for want of bytes rather than
  pending someone's attention.
  If the owner answered Q4 by closing the workstream early, record it instead as CLOSED
  UNBUILT with its evidence retained - which the spine sanctions by name.
  This is the only ticket that writes to specs/awsf-v2-plan.html.

HANDOFF
  Before you finish, open the ticket file(s) whose `depends_on` names this id and append to their
  `## Handoff` section anything that would otherwise make them start blind:
    - CONTRADICTIONS between their build prompt and what is now true (say which wins, and why)
    - MOVED or RENAMED files their READ FIRST block names
    - FINDINGS from this task that change what they should do
    - OPTIONS you considered and rejected, so they are not re-litigated
    - SCOPE they can now skip because this task already did it, or must now absorb
  Write it as dated, numbered entries (C1, C2, ...), each one actionable. Say plainly which source
  wins when two disagree - the plan, the code, or the prompt. Do NOT rewrite their build prompt.
  Append nothing if there is nothing - an empty Handoff is a real answer.
```
