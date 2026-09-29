# Tickets — AWSF v2 W19, Jev and the Delegate

One file per task of [`../../awsf-v2-w19-jev-delegate.html`](../../awsf-v2-w19-jev-delegate.html), generated together with
[`../../awsf-v2-w19-jev-delegate-build-prompts.md`](../../awsf-v2-w19-jev-delegate-build-prompts.md) § Section B from one source, so every
`## Build prompt` is byte-identical to its Section B block. The plan is the authority for content
and status. Spine: [`../../awsf-v2-plan.html`](../../awsf-v2-plan.html) § Milestone M19 → W19, recorded by
[`../awsf-v2-plan/W19.md`](../awsf-v2-plan/W19.md).

## Execution

- **M1 to M3: manual, one ticket per session.** The owner runs each prompt's `Manual:` lanes and
  makes one bookkeeping commit after each delivered and verified ticket: its plan rows, its
  `state`, the Handoff entries it returns, and a dated Amendment (invariant 12). A milestone stays
  `[wip]` until every task in it is `[x]`.
- **M4 to M8: one AWSF `shift` per milestone**, normally under a Delegate lease the owner grants
  (`awsf delegate grant`, available once G19-C lands). A milestone lands before the next starts.
- **Writable repository:** this one. Builder writes: `core/src/**`, `core/test/**`, `dashboard/**`,
  `prompts/**`, `docs/cheatsheet.html`.
- **Sizing for the shifts** (`awsf shift plan awsf-v2-w19-jev-delegate --milestone Mx` checks it):

| Milestone | Tickets | Calls (N + 1) | T2 ceiling 5 |
|---|---|---|---|
| M4 | T13–T16 | 5 | fits, no correction spare: `awsf raise <task> --calls 2` recommended, or leave it to the lease |
| M5 | T17–T20 | 5 | the same |
| M6 | T21–T22 | 3 | fits |
| M7 | T23–T25 | 4 | fits |
| M8 | T26–T28 | 4 | fits |

## Gates

- **G19-A** before M1 — `AGENTS.md` invariant 13 (the Delegate, the single Jev transport).
- **G19-S** with T08 — the `delegate` actor in `core/src/state/**`, written in the manual session
  with the owner's authorization and committed as the owner's.
- **G19-C** with T09 — the `delegate` verb family wired with its guard verb in one commit
  (`boundary-claims.test.ts` requires the arm and the verb together).
- **G19-Q** before M3's live drive — `routing.quota_stop` set in `awsf.config.yaml`.
- **G19-D** before M6's pilot — the Marimba compaction profile names the Jev extension; the owner's
  pi settings load it (machine-local, outside the task graph).
- **G19-T** before M7's shifts — every role's `tools.allow` names the Jev tools.
- **G19-W** before M8 — W18's T17 has landed.

## Frontmatter

| Field | Rule |
|---|---|
| `id` | `T01`–`T28`, the plan's task number, zero-padded |
| `title` | the Section B heading, verbatim |
| `milestone` | the plan milestone holding the task |
| `state` | `todo` \| `wip` \| `done` \| `failed`, mirroring the plan's `[]` / `[wip]` / `[x]` / `[f]` |
| `depends_on` | real prerequisites only, always earlier ids (below) |
| `serves` | the task's identifiers, mirrored from the plan's `Serves` line as a set |

`tier` and `workflow` are absent on purpose: a shift derives its tier and is the container, and
the manual milestones are run outside attempts.

## Dependencies

| Ticket | Milestone | Depends on | Title |
|---|---|---|---|
| `T01` | M1 | — | The Jev transport, its fence and the project switch |
| `T02` | M1 | `T01` | Versioned question sets and the journaled decision record |
| `T03` | M1 | `T01`, `T02` | Testing Strategy for M1, and the doctor row |
| `T04` | M2 | — | Stop facts: one host-built record for every stop |
| `T05` | M2 | `T02`, `T04` | The shadow policy and its journaled proposals |
| `T06` | M2 | `T05` | Agreement and earned autonomy, computed at read time |
| `T07` | M2 | `T03`, `T05`, `T06` | Testing Strategy for M2, and the historical replay |
| `T08` | M3 | `T02` | The Delegate actor: authority type, task-machine edges and the invariant |
| `T09` | M3 | `T06`, `T08` | The lease: grant, revoke, autonomy, and its record |
| `T10` | M3 | `T04` | The quota plan: when to resume, when to wait, when to stop |
| `T11` | M3 | `T05`, `T06`, `T08`, `T09`, `T10` | The runner hands stops to the Delegate: raise, resume, wait, cancel, notify |
| `T12` | M3 | `T07`, `T11` | Testing Strategy for M3: a leased shift through ceiling and quota stops |
| `T13` | M4 | `T11` | Rework, replacement review and degrade-review under the lease |
| `T14` | M4 | `T10`, `T11` | Route fallback when a provider's window is spent |
| `T15` | M4 | `T11` | Continuation after a ticket block or a BLOCKED attempt |
| `T16` | M4 | `T12`, `T13`, `T14`, `T15` | Testing Strategy for M4 |
| `T17` | M5 | `T02` | The decision socket: the host answers typed questions for its phases |
| `T18` | M5 | `T17` | jev-guard for pi roles: bash gate, result screen, reviewer-injection screen |
| `T19` | M5 | `T17` | Claude-route hooks and tools: prove the path, then wire it |
| `T20` | M5 | `T18`, `T19` | Testing Strategy for M5 |
| `T21` | M6 | `T01`, `T02` | The compaction question set, tiers and cut point for Marimba |
| `T22` | M6 | `T21` | Testing Strategy for M6, and the Marimba pilot |
| `T23` | M7 | `T17` | ask_jev_file and ask_jev_files for every configured role |
| `T24` | M7 | `T17`, `T18` | ask_jev over state, paths and an argv command |
| `T25` | M7 | `T20`, `T23`, `T24` | Testing Strategy for M7, and the token comparison |
| `T26` | M8 | `T07`, `T12`, `T16` | The Delegate and Jev read model |
| `T27` | M8 | `T26` | The Delegate view in the metrics tab, with the Jev model facet |
| `T28` | M8 | `T16`, `T20`, `T22`, `T25`, `T27` | Testing Strategy for M8, and the workstream's closing duties |

## Post-landing responsibilities

After each delivered ticket (M1 to M3) or landed milestone (M4 to M8), the owner makes one
commit: the task rows and milestone header in the plan, the tickets' `state`, the Handoff
entries the builders returned, and a dated Amendment. Only T28's landing moves the spine's
Milestone M19 / W19 marker and `../awsf-v2-plan/W19.md`, in that same commit. Current
plan-aligned states: **T01–T02 `done`; T03–T28 `todo`** (M1 `[wip]`, M2–M8 `[]`).
