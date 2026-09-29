# Tickets — AWSF v2 W18, Route Metrics

One file per task of [`../../awsf-v2-w18-route-metrics.html`](../../awsf-v2-w18-route-metrics.html),
generated together with [`../../awsf-v2-w18-route-metrics-build-prompts.md`](../../awsf-v2-w18-route-metrics-build-prompts.md)
§ Section B from one source, so every `## Build prompt` is byte-identical to its Section B block.
The plan is the authority for content and status. Spine: [`../../awsf-v2-plan.html`](../../awsf-v2-plan.html)
§ Milestone M18 → W18, recorded by [`../awsf-v2-plan/W18.md`](../awsf-v2-plan/W18.md).

## Execution

> **Amended 2026-09-28.** The owner executes the remaining tickets **manually, one ticket per
> session**, outside AWSF attempts, using each prompt's `Manual:` lanes (ROUTING, EXECUTION, COMMIT);
> Section B is unchanged. Gates, the write boundary and the never-do list still apply. Bookkeeping
> follows each delivered and verified ticket: its plan rows, its `state`, the Handoff entries it
> returns and a dated Amendment, in one owner commit (invariant 12). A milestone stays `[wip]`
> until every task in it is `[x]`. The shift-specific text below (one shift per milestone, host
> commits, sizing, raises, `degrade-review`) is kept as the original contract. See the plan's
> 2026-09-28 Amendment.

- **One AWSF `shift` per milestone**, started by the owner from Marimba. A milestone lands before the
  next one starts: `awsf start` bases the worktree on HEAD, so a shift started while another waits
  at `AWAITING_OWNER` builds without its code.
- **Writable repository:** this one. The shift builder writes `core/src/**`, `core/test/**`,
  `dashboard/**`, `prompts/**`, and `docs/cheatsheet.html` after gate G18-A.
- **The host** commits each ticket on the shift's accumulating head and runs its gates before the
  next ticket. **The owner** writes plan markers, ticket `state`, Handoff entries and Amendments in
  one bookkeeping commit after each landing (AGENTS.md invariant 12), never while a candidate waits.
- **Sizing** (`awsf shift plan awsf-v2-w18-route-metrics --milestone Mx` checks it):

| Milestone | Tickets | Calls (N + 1) | T2 ceiling 5 | Builder route |
|---|---|---|---|---|
| M1 | T01–T03 | 4 | fits, one correction spare | `claude/anthropic/claude:opus@xhigh` |
| M2 | T04–T06 | 4 | fits | `claude/anthropic/claude:opus@high` |
| M3 | T07–T10 | 5 | `awsf raise <task> --calls 2` before `awsf run` | `claude/anthropic/claude:opus@high` |
| M4 | T11–T14 | 5 | `awsf raise <task> --calls 2` before `awsf run` | `claude/anthropic/claude:opus@xhigh` |
| M5 | T15–T17 | 4 | fits | `claude/anthropic/claude:opus@high` |
| M6 | T18 | 2 | fits | `claude/anthropic/claude:opus@xhigh` |

Every milestone reviews on `claude/anthropic/claude:opus@high` and therefore needs the owner's
`awsf degrade-review <task> --reason "…"` before `awsf start`.

## Gates

- **G18-M** before M1 — the owner's migration 0007 (five nullable route columns on `phases`,
  `user_version` 7) and the seven terminal-version pins it moves. After M1 lands, one
  `awsf db rebuild` backfills legacy phases. Exact DDL in the plan's Execution section.
- **G18-A** before M1 — builder writes gain `docs/cheatsheet.html`.
- **G18-C** after M1 lands — the owner wires `awsf attribute` (built unregistered by T03): its
  `main.ts` arm, `CLI_COMMANDS`, the cheatsheet's `commands` and `owner-acts` lines, and the
  guard verb in `delegation-guard.sh`, `marimba-guard-rules.mts` and `marimba-guard.test.ts`, in one
  commit. `boundary-claims.test.ts` requires them together.
- **G18-B** after M4 lands — the owner wires `awsf prove` the same way, and `workflows.enabled`
  gains `prove` with the cheatsheet's `workflow|prove` line, in one commit.
- **Visual references for M3** — the owner's private binding (absolute root) passed at
  `awsf start <task> --visual-references <binding>`, selecting all eleven frames for phases
  `t07-build`, `t08-build`, `t09-build`, `t10-build` and `shift-review`. The tracked index and
  digests are `specs/design/awsf-v2-w18-route-metrics/frame-index.json` and `frame-digests.json`;
  the images stay in the ignored `docs/design/route-metrics/frames/`. Only `claude-code` opus and
  sonnet are admitted visual Claude routes. If the binding is refused, the attempt stays in DRAFT.

## Visual reference mapping (the index's `ticketFrames`)

| Ticket | Frames |
|---|---|
| T07 | `rm-matrix-forest-dark`, `rm-matrix-forest-light`, `rm-run-forest-dark`, `rm-run-forest-light` |
| T08 | the five `rm-matrix-*` frames, `rm-frontier-forest-dark`, `rm-frontier-forest-light` |
| T09 | `rm-ledger-forest-dark`, `rm-ledger-forest-light`, `rm-run-forest-dark`, `rm-run-forest-light` |
| T10 | all eleven |

## Frontmatter

| Field | Rule |
|---|---|
| `id` | `T01`–`T17`, the plan's task number, zero-padded |
| `title` | the Section B heading, verbatim |
| `milestone` | the plan milestone holding the task |
| `state` | `todo` \| `wip` \| `done` \| `failed`, mirroring the plan's `[]` / `[wip]` / `[x]` / `[f]` |
| `depends_on` | real prerequisites only, always earlier ids (below) |
| `serves` | the task's identifiers, mirrored from the plan's `Serves` line as a set |

`tier` and `workflow` are absent on purpose: a shift derives its tier (at least T2) and is the
container, and no ticket may declare `workflow: shift`. `task_class` does not exist until T15
adds it; classifying these tickets afterwards is owner-side (D6).

## Dependencies

| Ticket | Milestone | Depends on | Title |
|---|---|---|---|
| `T01` | M1 | — | Per-phase facts: route, effort and its source, tokens by kind, and tool classes |
| `T02` | M1 | `T01` | Role-row outcomes and the block-attribution heuristic |
| `T03` | M1 | `T01`, `T02` | Testing Strategy for M1, and the owner's attribution override |
| `T04` | M2 | `T02` | The pure metrics module: intervals, depth, frontier, verdicts and the recommendation rule |
| `T05` | M2 | `T01`, `T04` | The dated rate card, the list-price equivalent, and the metrics API |
| `T06` | M2 | `T03`, `T04`, `T05` | Testing Strategy for M2, and the awsf metrics readout |
| `T07` | M3 | `T04`, `T05` | The metrics tab shell: routes, lens rail, summary and the run-card button |
| `T08` | M3 | `T04`, `T07` | The Matrix and Frontier views |
| `T09` | M3 | `T03`, `T04`, `T07` | The Ledger and Run views |
| `T10` | M3 | `T07`, `T08`, `T09` | Testing Strategy for M3: palettes, modes, accessibility and the visual record |
| `T11` | M4 | `T04` | The frozen corpus, the seeded-defect reviewer suite and the route-arm scorer |
| `T12` | M4 | `T11` | The prove workflow: a seeded candidate at a pinned base, reviewed on the arm's route |
| `T13` | M4 | `T05`, `T06`, `T07`, `T12` | awsf prove, and the proving-ground evidence source end to end |
| `T14` | M4 | `T11`, `T12`, `T13` | Testing Strategy for M4: one replay end to end, and replays never land |
| `T15` | M5 | `T04`, `T06`, `T07` | The ticket task class: field, fence vocabulary and comparisons within a class |
| `T16` | M5 | `T06`, `T15` | The advisory: awsf metrics --advise and the route evidence in awsf shift plan |
| `T17` | M5 | `T03`, `T06`, `T10`, `T14`, `T15`, `T16` | Testing Strategy for M5, awsf metrics export, and the workstream's closing duties |
| `T18` | M6 | `T12`, `T13`, `T14` | Confine a replay's agent to its worktree |

## Post-landing responsibilities

After each milestone lands, the owner (with Marimba drafting) makes one commit: the milestone's
task rows and header in the plan, the tickets' `state`, the Handoff entries the builders returned,
and a dated Amendment. Only T17's landing moves the spine's Milestone M18 / W18 marker and
`../awsf-v2-plan/W18.md`, in that same commit, and only once M6 is `[x]` too (added 2026-09-29). If M6 lands after M5, the spine
marker moves with M6's bookkeeping commit instead. Current plan-aligned states: **T01–T14 and T18 `done`; T15–T17 `todo`** (M1 `[x]`, M2 `[x]`, M3 `[x]`, M4 `[x]`, M5 `[]`, M6 `[x]`).
