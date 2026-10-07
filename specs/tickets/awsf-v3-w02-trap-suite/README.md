# Tickets — AWSF v3 W02, Trap suite

One file per task of [`../../awsf-v3-w02-trap-suite.html`](../../awsf-v3-w02-trap-suite.html), generated from
[`../../awsf-v3-w02-trap-suite-build-prompts.md`](../../awsf-v3-w02-trap-suite-build-prompts.md) § Section B, so every
`## Build prompt` is byte-identical to its Section B block. The plan is the authority for content
and status. Spine: [`../../awsf-v3-plan.html`](../../awsf-v3-plan.html) § Workstreams → Milestone M2 → W02, recorded by
[`../awsf-v3-plan/W02.md`](../awsf-v3-plan/W02.md).

## Execution

- **Managed by default** (spine decision 7): one `build-review` attempt per ticket, so a provider
  other than the builder's reviews it. `awsf new` derives the tier from the paths. A ticket starts
  after external `depends_on` tickets have landed. In an owner-approved accumulating shift,
  selected predecessors instead need host-committed, gate-passing heads in that worktree; no
  separate canonical landing or marker change is required mid-shift.
- **K1 binds every start:** the driver runs `awsf preflight`, the owner runs `awsf confirm`, then
  `awsf start`.
- **Manual is a logged exception**, for a factory that cannot carry the work. A manual session
  uses the prompt's `Manual:` lines and commits only with the owner's authorization.
- **Writable repository:** this one. Builder writes: `core/src/**` outside protected paths,
  `core/test/**`, `dashboard/**`, `prompts/**`, `docs/cheatsheet.html`. No role writes
  `package.json`.
- **This ticket set was authored in a direct session**, a logged exception under the spine's gate GM.
- **Owner decisions.** W02-Q1–Q8 were decided on 2026-10-07, each as recommended, and every
  prompt applies them.

## Gates

- **G02-S** after T01, before T02 — the owner confirms or corrects every row of T01's seed ledger;
  recorded as a dated Amendment of the plan. A row that adds a trappable family adds its M4 task in
  the same Amendment.
- **G02-L** after T04 — the owner's commit adds `test:traps` to `package.json` and `npm test`, and,
  per W02-Q5, the `traps` gate to `awsf.config.yaml` (recorded in `awsf.project.yaml`) with twice
  T04's measured time as its timeout.
- **G02-Q** only if W02-Q7 takes a threshold — `routing.quota_stop` in `awsf.config.yaml`.
- **G02-D** after T05, before T16 — the cancel and attribute examples and `gotchas.md` under
  `docs/driving/**` gain the trap link.

GR does not bind this workstream's landings: W02 adds refusals, tests and read-only reports and
widens nothing. Its closing landing opens GR.

## The trap contract

A trap is four things that agree: a catalogue entry `TR-NN` in `core/src/traps/catalogue.ts`, one
test `core/test/traps/TR-NN-<slug>.test.ts`, one `// trap-refusal-begin TR-NN` …
`// trap-refusal-end TR-NN` marker pair in `core/src`, and a mutant that deletes the marked block in
a scratch copy and must turn the trap red. Every trap asserts the named refusal, zero calls
reserved, zero adapter invocations, and an attempt still DRAFT or PREPARED. A seed that cannot
have a trap is a no-trap entry of kind `fixed`, `after-spend`, `owner`, `unexplained` or
`not-a-stop`.

## Frontmatter

| Field | Rule |
|---|---|
| `id` | `T01`–`T16`, the plan's task number, zero-padded |
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
| `T01` | M1 | — | G02-S after it | Replay the seed stops on the stub adapter and pin today's outcome |
| `T02` | M2 | `T01` | G02-S at its base | The trap catalogue and its population rule |
| `T03` | M2 | `T02` | — | The harness, the mutant, and the catalogue fence |
| `T04` | M2 | `T02`, `T03` | G02-L after it | Testing Strategy for M2: the first traps from existing refusals, and the gate's code half |
| `T05` | M3 | `T02` | G02-D after it | The trap link on the cause record |
| `T06` | M3 | `T02`, `T05` | — | awsf traps, the coverage readout |
| `T07` | M3 | `T05`, `T06` | — | Testing Strategy for M3 |
| `T08` | M4 | `T01`, `T03` | G02-S | The launch environment: an executable that does not resolve refuses before L4 |
| `T09` | M4 | `T01`, `T03` | G02-S; G02-Q optional | Quota at run start: an exhausted window refuses before L4 |
| `T10` | M4 | `T01`, `T03` | G02-S | A shift ticket that demands a path the shift cannot write |
| `T11` | M4 | `T01`, `T03` | G02-S | Known open defects refused before spend |
| `T12` | M4 | `T04`, `T08`, `T09`, `T10`, `T11` | — | The confirmed remainder, and Testing Strategy for M4 |
| `T13` | M5 | — | — | Doctor's environment rows: storage, executables, logins and quota |
| `T14` | M5 | `T13` | — | Doctor's repository rows: branches, worktrees, the baseline, and open markers |
| `T15` | M5 | `T13`, `T14` | — | Testing Strategy for M5 |
| `T16` | M6 | `T04`, `T07`, `T12`, `T15` | G02-L, G02-D landed | The GR record, and the workstream's closing duties |

M5 depends on nothing else in W02 and may run first. M3 and M4 may run in either order once M2's
T02 and T03 have landed. M6 waits for everything.

## Design references

W02 builds no UI. Frames `mp-s3-blocked` and `mp-s5-checks` in
[`../../design/awsf-v3-plan/frame-index.json`](../../design/awsf-v3-plan/frame-index.json) show
W02's data inside W08's panel: the K5 card reads `awsf traps --json`, the Doctor card reads
`awsf doctor --json`. They are data-shape references only, never visual acceptance. Proposed
`ticketFrames` for the owner to add: T05–T07 → mp-s3, mp-s5; T13–T15 → mp-s5.

## Post-landing responsibilities

After each landed ticket, the owner makes one commit: the task rows and the milestone header in
the plan, the ticket's `state`, the Handoff entries the builder returned, and a dated Amendment
(invariant 12). A milestone stays `[wip]` until every task in it is `[x]`. Only T16's landing moves
the spine's Milestone M2 / W02 marker and `../awsf-v3-plan/W02.md`, in that same commit, and that
commit opens gate GR. Current plan-aligned states: **T01–T16 `todo`** (M1–M6 `[]`).
