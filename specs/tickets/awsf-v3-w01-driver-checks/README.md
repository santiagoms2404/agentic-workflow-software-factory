# Tickets — AWSF v3 W01, Driver checks

One file per task of [`../../awsf-v3-w01-driver-checks.html`](../../awsf-v3-w01-driver-checks.html), generated from
[`../../awsf-v3-w01-driver-checks-build-prompts.md`](../../awsf-v3-w01-driver-checks-build-prompts.md) § Section B, so every
`## Build prompt` is byte-identical to its Section B block. The plan is the authority for content
and status. Spine: [`../../awsf-v3-plan.html`](../../awsf-v3-plan.html) § Workstreams → Milestone M1 → W01, recorded by
[`../awsf-v3-plan/W01.md`](../awsf-v3-plan/W01.md).

## Execution

- **Managed by default** (spine decision 7): one `build-review` attempt per ticket, so a provider
  other than the builder's reviews it. `awsf new` derives the tier from the paths. A ticket starts
  after external `depends_on` tickets have landed. In an owner-approved accumulating shift,
  selected predecessors instead need host-committed, gate-passing heads in that worktree; no
  separate canonical landing or marker change is required mid-shift.
- **Manual is a logged exception**, for a factory that cannot carry the work. A manual session
  uses the prompt's `Manual:` lines and commits only with the owner's authorization.
- **From T11's landing on, K1 binds every start**, T12 and T13 included: the driver runs
  `awsf preflight`, the owner runs `awsf confirm`, then `awsf start`.
- **Writable repository:** this one. Builder writes: `core/src/**` outside protected paths,
  `core/test/**`, `dashboard/**`, `prompts/**`, `docs/cheatsheet.html`.
- **This ticket set was authored in a direct session**, a logged exception under the spine's gate GM.

## Gates

- **G01-F** before T08 — the owner confirms or corrects the forensics draft's eight `driver` rows;
  recorded as a dated Amendment of the plan; freezes K1's field list.
- **G01-G** with or after T04 — the guard fix, an owner commit to `docs/driving/marimba/`
  (`marimba-guard-rules.mts`, `delegation-guard.sh`) that flips T04's pinned rows.
- **G01-C** after T10, before T11 — `awsf confirm` wired in one owner commit: the `main.ts` arm,
  `CLI_COMMANDS`, K2's owner-act table, the cheatsheet's `commands` and `owner-acts` lines, the
  guard verb in `.sh` and `.mts`, `marimba-guard.test.ts`, and
  `docs/driving/skills/awsf/cookbooks/owner_acts.md` with any other driving document that
  enumerates owner acts.
- **G01-S** is not taken: the owner decided W01-Q2 for `awsf start` on 2026-10-04, so K1 stays out
  of L1's guard and `core/src/state/**` is unchanged.

GR does not bind this workstream: W01 adds refusals and records and widens nothing.

## Frontmatter

| Field | Rule |
|---|---|
| `id` | `T01`–`T13`, the plan's task number, zero-padded |
| `title` | the Section B heading, verbatim |
| `milestone` | the plan milestone holding the task |
| `state` | `todo` \| `wip` \| `done` \| `failed`, mirroring the plan's `[]` / `[wip]` / `[x]` / `[f]` |
| `depends_on` | real prerequisites only, always earlier ids (below) |
| `workflow` | `build-review`, the managed default; the driver may choose another recipe and says why |
| `serves` | the task's identifiers, mirrored from the plan's `Serves` line as a set |

`tier` is absent on purpose: `awsf new` derives it from the paths, and a declared tier that
disagreed would be refused.

## Dependencies

| Ticket | Milestone | Depends on | Gate | Title |
|---|---|---|---|---|
| `T01` | M1 | — | — | The driver cause, and attributing a cancelled attempt |
| `T02` | M1 | `T01` | — | awsf cancel requires a reason and a cause |
| `T03` | M1 | `T01`, `T02` | — | Testing Strategy for M1, and the cause readout |
| `T04` | M2 | — | G01-G | The owner-act spelling matrix, in both harnesses |
| `T05` | M3 | — | — | The next-steps model |
| `T06` | M3 | `T05` | — | awsf next, and the prose rendered from it |
| `T07` | M3 | `T05`, `T06` | — | Testing Strategy for M3 |
| `T08` | M4 | — | G01-F | The preflight record and its fields |
| `T09` | M4 | `T06`, `T08` | — | awsf preflight measures, reuses or runs the suite, and journals the record |
| `T10` | M4 | `T08`, `T09` | G01-C after it | awsf confirm, built unregistered |
| `T11` | M5 | `T06`, `T09`, `T10` | G01-C at its base | awsf start refuses L1 without a fresh record and a confirmation |
| `T12` | M5 | `T09`, `T11` | — | The runner refuses a writing phase that lacks its recorded grant |
| `T13` | M5 | `T03`, `T04`, `T07`, `T11`, `T12` | G01-G landed | Testing Strategy for M4, the forensics map, and the workstream's closing duties |

M1, M2 and M3 have no dependency on each other and can run in any order. M4 waits for G01-F; M5 waits for G01-C.

## K2 availability

The edge ids in `steps + waits + unavailable` partition `LEGAL_EDGES` filtered by state,
exactly once. CLI steps and host waits require implemented task-transition invocations.
Declared edges without one retain their machine actors and a `not-implemented` explanation in
`unavailable`, with no verb, argv or executable who. L10/L16 currently need this classification:
`rework` uses `human`, not their permitted actors, and phase corrections do not invoke task edges.
T05 does not implement those edges. T06 labels their explanations separately and never recommends
them. T07 tests completeness, uniqueness, actor preservation and non-executability.

## Design references

W01 builds no UI. Frames `mp-s2-owner-review`, `mp-s3-blocked`, `mp-s4-runs` and `mp-s5-checks` in
[`../../design/awsf-v3-plan/frame-index.json`](../../design/awsf-v3-plan/frame-index.json) show
W01's data inside W08's panel. They are data-shape references only, never visual acceptance.
Proposed `ticketFrames` for the owner to add: T01–T03 → mp-s3, mp-s4; T05–T07 → mp-s2;
T08–T13 → mp-s5.

## Post-landing responsibilities

After each landed ticket, the owner makes one commit: the task rows and the milestone header in
the plan, the ticket's `state`, the Handoff entries the builder returned, and a dated Amendment
(invariant 12). A milestone stays `[wip]` until every task in it is `[x]`. Only T13's landing moves
the spine's Milestone M1 / W01 marker and `../awsf-v3-plan/W01.md`, in that same commit. Current
plan-aligned states: **T01–T07 `done`; T08–T13 `todo`** (M1–M3 `[x]`; M4 and M5 `[]`).
