---
name: marimba-plan
description: Capture exact owner requests, refine and order stable task units, propose revision-bound amendments, and inspect evidence-backed progress through AWSF group records. Use for recurring marimba planning, focus, deferral, and handoff.
---

# marimba-plan

This skill is a planning client. The AWSF group journal owns inputs, timeline stages,
units, proposals and accepted planning decisions. It lives in the state root.
Packets and checklists are read-only views. They grant no execution permission.

The primary value is exact-input retention, revision-bound decisions and honest
progress. Bounded reads support that workflow, but token or subscription savings
are not established. Do not justify this subsystem on packet size alone.

Keep mandatory priming, the marimba contract, and both guard fences unchanged.
Never launch a worker merely because a packet looks ready. Never edit an attempt,
a status marker, a checklist, the group journal, or the private continuity area.
Use normal factory requests and existing owner lifecycle channels separately.

## Route to shipped commands

From the AWSF checkout, load command help when syntax is needed:

```bash
npm run awsf --silent -- group help
```

- A group's FIRST capture is the original ask, and nothing else. The dashboard
  takes a group's title from that input's first line, so a group opened with a
  correction or a scheduling aside is titled with one for the life of the group.
  Capture the ask first, then the follow-ups.
- Capture each original or follow-up with `group capture`. Read its complete exact
  text once through `group inspect --input-id ID`, including attachment provenance,
  then verify its bytes through `group input`. Never replace English/Spanish
  input with a translation. Keep attachment provenance and hashes separately.
  Unsafe input is refused. Ask for sanitized replacement text, never claim that
  redacted content round-tripped exactly.
- Use `group orient` for the unit index and unresolved decisions. Use `group focus`
  for one selected unit and its prerequisite contracts. Add `--proposal ID` to
  preview proposed scope without treating it as accepted. Load cited files and
  attachments when needed to evaluate claims. A hash is not proof you read them.
- Use `group schema --kind proposal` and the [operations reference](references/operations.md)
  only when preparing changes. `group propose` records an assistant proposal,
  never owner approval. Scheduling order and technical prerequisites are separate.
- **The owner runs `group apply` from their own terminal.** Present the proposal
  hash, revision, reasons, alternatives and affected successors first. Do not
  allocate a terminal, inject confirmation, or claim an approval on their behalf.
  A planning approval never permits changing, stopping or restarting an attempt.
- Use `group checklist` for progress. Preserve unknown, stale, blocked,
  awaiting-owner, deferral and active-attempt observations. Builder success or
  green gates do not establish delivery. Never synthesize a check mark.
- For handoff, capture the exact follow-up separately and propose a closing stage.
  A new driving session starts a new group. Do not infer membership from timing or
  confuse it with task continuation. Prior source references remain addressable.

An overflow is a refusal, not a truncated packet. Narrow the unit or ask for a
larger byte budget. Never drop requirements or findings to fit. On a stale source,
refresh its reference and propose against the current revision. Read newly
captured input fully. Repeated focus reads may use its verified input identity.

These runtime units are not a new registered repository plan format. For work
requiring registered plans/tickets, preserve the existing deterministic HTML,
combined Section B build prompts and ticket synchronization contract. The model
does not generate HTML presentation code. Read [compatibility and activation](references/activation.md)
when exporting or enabling the skill.
