# Tickets — AWSF v3 W03, Ticket closure

One file per task of [`../../awsf-v3-w03-ticket-closure.html`](../../awsf-v3-w03-ticket-closure.html), generated from
[`../../awsf-v3-w03-ticket-closure-build-prompts.md`](../../awsf-v3-w03-ticket-closure-build-prompts.md) § Section B, so every
`## Build prompt` is byte-identical to its Section B block. The plan is the authority for content
and status. Spine: [`../../awsf-v3-plan.html`](../../awsf-v3-plan.html) § Workstreams → Milestone M3 → W03, recorded by
[`../awsf-v3-plan/W03.md`](../awsf-v3-plan/W03.md).

## Execution

- **M1 is owner work.** T01 and T02 edit `awsf.config.yaml`, a protected file. They are owner
  commits under gate GA, never managed attempts and never selected into a shift. A session may
  prepare each patch and its evidence.
- **M2–M7 are managed by default** (spine decision 7): one `build-review` attempt per ticket, so a
  provider other than the builder's reviews it. `awsf new` derives the tier from the paths. A
  ticket starts after its external `depends_on` tickets have landed. In an owner-approved
  accumulating shift, selected predecessors instead need host-committed, gate-passing heads in that
  worktree.
- **K1 binds every start:** the driver runs `awsf preflight`, the owner runs `awsf confirm`, then
  `awsf start`.
- **From T06's landing on,** every W03 attempt is created with
  `--plan awsf-v3-w03-ticket-closure --ticket Tnn`, so its landing can be closed by `awsf close`.
- **Writable repository:** this one. Builder writes: `core/src/**` outside protected paths,
  `core/test/**`, `dashboard/**`, `prompts/**`, `docs/cheatsheet.html`. No role writes
  `package.json` or anything under `specs/` beyond intake's flat light tickets.
- **This ticket set was authored in a direct session**, a logged exception under the spine's gate GM.
- **Owner decisions.** W03-Q1–Q9 were decided on 2026-10-09, each as recommended, and Q9 was
  revised the same day to keep design-to-plan enabled. Every prompt applies them.

## Gates

- **T01**, first — `specs/*.html` in `policy.protected_paths`, with the test adjustments in the
  same owner commit. design-to-plan stays enabled and unused until T12 (W03-Q9, revised).
  Nothing else starts until it lands.
- **T02**, after T01, per W03-Q2 — `specs/*-build-prompts.md` and `specs/tickets/*/**`.
- **G03-C**, after T08, before T09 — `close` wired as an owner act: the `main.ts` arm, the owner
  actor in `next-steps.ts`, `delegation-guard.sh`, `OWNER_ACTS`, the driving documents, the
  cheatsheet and README, in one owner commit (the G01-C pattern).
- **G03-I**, before T11 (W03-Q5 took the flat store) — invariant 12 names the light tier.
- **G03-W**, after T13, before T15 — the `plan-author` role and workflow in `awsf.config.yaml`.

## Closure, defined

A closing commit differs from its parent only in status-token values in registered plan files and
the frontmatter `state:` value in ticket files; no path is added, removed, renamed or re-moded; and
the result passes the invariant-12 agreement checks. Closure never writes `[f]` or `failed`, and it
refuses when a selected ticket's ask changed between the attempt's base and canonical HEAD.

## Frontmatter

| Field | Rule |
|---|---|
| `id` | `T01`–`T15`, the plan's task number, zero-padded |
| `title` | the Section B heading, verbatim |
| `milestone` | the plan milestone holding the task |
| `state` | `todo` \| `wip` \| `done` \| `failed`, mirroring the plan's `[]` / `[wip]` / `[x]` / `[f]` |
| `depends_on` | real prerequisites only, always earlier ids (below) |
| `workflow` | `build-review` for managed tickets; absent on T01 and T02, which are owner commits |
| `serves` | the task's identifiers, mirrored from the plan's `Serves` line as a set |

`tier` is absent on purpose: `awsf new` derives it from the paths, and a declared tier that
disagreed would be refused.

## Dependencies

| Ticket | Milestone | Depends on | Gate | Title |
|---|---|---|---|---|
| `T01` | M1 | — | owner, GA | Owner amendment: specs/*.html in policy.protected_paths |
| `T02` | M1 | `T01` | owner, GA | Owner amendment: build prompts and paired ticket sets protected |
| `T03` | M2 | `T01` | — | The agreement rules as one module |
| `T04` | M2 | `T03` | — | The closure delta and the asked-for comparison |
| `T05` | M2 | `T03`, `T04` | — | Testing Strategy for M2 |
| `T06` | M3 | `T01` | — | A sealed ticket selection on any plan attempt |
| `T07` | M3 | `T04`, `T06` | — | closeCommand: propose, confirm, check, commit, record |
| `T08` | M3 | `T07` | G03-C after it | Spine roll-up, approvals and owner rows |
| `T09` | M4 | `T08` | G03-C landed | Status, doctor, K2 and K1 read closure |
| `T10` | M4 | `T05`, `T07`, `T08`, `T09` | — | Testing Strategy for M4 |
| `T11` | M5 | `T07` | G03-I landed | Light tickets start, close and keep their state out of intake's reach |
| `T12` | M6 | `T02`, `T03` | — | Plan admission, and design-to-plan on it |
| `T13` | M6 | `T08`, `T12` | G03-W after it | The plan-author recipe, code half |
| `T14` | M6 | `T10`, `T12`, `T13` | — | Testing Strategy for M6 |
| `T15` | M7 | `T10`, `T11`, `T14` | G03-W landed | The closing record, and the workstream's closing duties |

M2 and M3's T06 may run in parallel once T01 lands, and T07 waits for T04 and T06; M6's T12 needs only T02 and T03. M3 and M4, with G03-C between them, are the critical
path. M7 waits for everything.

## Design references

W03 builds no UI. No frame in
[`../../design/awsf-v3-plan/frame-index.json`](../../design/awsf-v3-plan/frame-index.json) is
assigned to W03, and this set adds no `ticketFrames` entry, which also avoids the bare-ticket-id
collision W02's 2026-10-07 Amendment recorded.

## Post-landing responsibilities

Until G03-C lands, after each landed ticket the owner makes one commit: the task rows and the
milestone header in the plan, the ticket's `state`, the Handoff entries the builder returned, and a
dated Amendment (invariant 12). From G03-C on, the owner runs `awsf close` on each landing, which
moves rows, milestone markers and states only; Handoff entries and narrative Amendments, when
wanted, are separate owner commits. A milestone stays `[wip]` until every task in it is `[x]`. Only
T15's closure moves the spine's Milestone M3 / W03 marker and `../awsf-v3-plan/W03.md`, and it
retires gate GM. Current plan-aligned states: **T01–T02 `done`** (M1 `[x]`), **T03–T15 `todo`** (M2–M7 `[]`).
