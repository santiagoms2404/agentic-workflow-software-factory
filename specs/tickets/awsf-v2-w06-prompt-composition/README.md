# Ticket set — AWSF v2 W06 prompt composition

This directory is the addressable execution surface for
[`../../awsf-v2-w06-prompt-composition.html`](../../awsf-v2-w06-prompt-composition.html).
The readable concatenated source is
[`../../awsf-v2-w06-prompt-composition-build-prompts.md`](../../awsf-v2-w06-prompt-composition-build-prompts.md)
§ Section B. Each ticket's build-prompt body is byte-identical to its Section B block.

## Frontmatter schema

```yaml
id: T01                 # filename and plan task number, zero-padded
title: "..."            # quoted; exact Section B heading
milestone: M1           # derived from the containing plan phase
state: todo             # todo | wip | done | failed; mirrors plan markers
depends_on: []          # plan dependency chain
```

`tier` and `workflow` are omitted because this plan defines neither vocabulary for its own tasks.
The T2 corpus discussed by M3 is benchmark input, not a ticket tier.

## Derived-field rules

- `milestone`: M1 for T01–T03, M2 for T04–T07, M3 for T08–T10.
- `depends_on`: T01 has none. T02–T10 depend on the immediately preceding ticket because each task
  consumes the accepted contract or evidence from its predecessor.
- `state`: mirrors both the containing milestone marker and the task's own checklist. Flip the HTML
  markers and ticket state in the same commit.
- Cross-plan G1 is not representable in `depends_on`: this plan releases the gate. W05 milestone M7
  checks that this plan's M1 is `[x]`; W05 M1–M6 do not wait.

## Shared read-first set

Every fresh session reads `AGENTS.md`, the named task and containing milestone in the HTML plan, the
spine's Shared Invariants and W05/W06 blocks when sequencing is relevant, and the source files named
by its prompt. `CLAUDE.md` and `docs/TESTING.md` did not exist when this plan was authored and must not
be invented to satisfy a template.

## Sync rule

`core/test/unit/meta/ticket-plan-sync.test.ts` resolves this plan through the registered plan source
and checks task coverage, milestone, marker/checklist state, title, dependency ordering, and exact
Section B prompt bytes. The HTML plan is the status source of truth.
