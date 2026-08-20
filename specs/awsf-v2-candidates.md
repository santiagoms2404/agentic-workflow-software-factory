# AWSF — v2 Candidates and Closeout Work

A working record, not a plan. It captures decisions taken and options left open
after `specs/awsf-plan.html` closed on 2026-08-16 with every milestone `[x]` and
one honest `[f]`.

**Status of this file.** Two things live here and they are deliberately kept
apart. **Part 1** is closeout work on the existing plan — small, decided, and
appended to it as tasks. **Part 2** is candidate scope for a future
`awsf-v2-plan.html`, which is **parked**: nothing in it is committed, sequenced,
or estimated, and it stays parked until the candidate set is concrete enough to
be worth a planf3 pass.

This file flips no status marker and records no live task state
(`AGENTS.md` invariants 1 and 2). It is superseded, not amended, by the v2 plan
when that plan is authored.

---

## Part 1 — Closeout of the current plan (decided; appended as tasks)

### 1.1 Repair `npm run typecheck` and amend D2

**Decision: do it.** The plan's Validation row for `npm run typecheck` is `[f]`
with the design correction *"…make no repository-wide TypeScript-green claim
unless a later owner amendment permits Node declarations and resolves the
remaining strict diagnostics."* This is that amendment.

**Measured, 2026-08-18, on the WSL2 development machine.** `npm run typecheck`
emits **835 diagnostics**:

| Cause                                                                              | Count         |
| ---------------------------------------------------------------------------------- | ------------- |
| `node:*` modules unresolvable (TS2307)                                           | 527           |
| `process` / `console` / `window` / `setTimeout` missing (TS2580/2304/2584) | 213           |
| `NodeJS` namespace missing (TS2503)                                              | 15            |
| **Genuine type errors**                                                      | **~22** |

Verified in a throwaway copy by adding `@types/node@22` and pointing `tsc` at a
core-only project: **835 → 22 errors across 10 files.** Only four are in
`core/src`:

- `api/routes.ts:448` — `readonly BacklogTicket[]` vs mutable `BacklogTicket[]`
- `cli/commands/run.ts:35` — `exactOptionalPropertyTypes` on `evidence`
- `cli/commands/run.ts:81` — `string | null` assigned to `string | undefined`
- `execution/launcher.ts:104` — overload arity

The remaining 18 are in tests, mostly `never`-narrowing failures from the inline
discriminant pattern adopted *because* `node:assert` would not resolve — adding
node types removes the cause rather than requiring 18 individual fixes.
`npx vue-tsc --noEmit -p dashboard/tsconfig.json` already exits **0**.

**Why repair rather than keep the `[f]`.** The cost is not the red text; it is
that `core/` — the state machine, broker, budget math, and gates — currently has
**zero** static type coverage, because 835 lines of noise mean a real regression
can never be seen. The accepted design correction leaves the kernel unchecked.

**Shape of the fix:**

1. Amend D2 to admit `@types/node` as a **devDependency**. D2 exists to keep the
   *runtime* dependency surface minimal and mechanically checkable;
   `@types/node` ships nothing and executes nothing.
2. Split `typecheck` into two projects — `tsconfig.core.json` (`types: ["node"]`,
   includes `core/**`) plus the existing `dashboard/tsconfig.json` under
   `vue-tsc`. The plan's row already promised both; the script only ever invoked
   `tsc`.
3. Fix the ~22 diagnostics.
4. Update `dependency-allowlist.test.ts` and `AGENTS.md` invariant 7.

The `[f]` row stays as the historical record; closure comes via a new task and
an Amendments entry, never by editing history.

### 1.2 Close the seven deferred WSL2 portability rows

**Decision: do this before the MacBook Pro arrives.**

Matrix state at closeout: **WSL2** 4 `PASS` / 7 `DEFERRED`; **Linux desktop**
11 `PENDING`; **macOS** 11 `PENDING`; **Windows-native** 9 `PENDING`, 1 `N/A`,
1 `BLOCKED by design`.

Every WSL2 deferral reads as a variant of *"no TTY case in required suites"*,
*"no live broker case in required suites"*, *"required suites do not exercise
drvfs case folding"*, *"synthetic stdin launch passes; named CLIs not invoked"*.
Those are **test-coverage gaps, not hardware gaps** — all seven are coverable on
the development machine today:

- state root resolution
- sandbox broker
- worktree containment on case-insensitive filesystems
- provider CLI launch (named `claude` / `pi` / `agy` resolution)
- TTY detection for `awsf land`
- installed-vs-portable consistency (`package.json` `bin`)
- write-capable workflows end-to-end

**Why the ordering matters.** Running the current suites on the Mac would defer
the same 7 of 11 rows and buy almost nothing. With coverage closed first, the
Mac visit becomes a one-hour `test:contract && test:sim` that fills a real
column.

### 1.3 Linux desktop column

**Decided 2026-08-18: the owner does not own a Linux desktop.** The column must
therefore not sit at `PENDING`, which implies scheduled work. It takes a dated
deferral or `N/A` per row, recorded the same way every other non-applicable cell
is. Revisit only if such a machine is acquired.

### 1.4 macOS column

Genuinely blocked on the **M5 MacBook Pro**. No task; T27 executes as written
once the hardware is present, after 1.2 lands.

---

## Part 2 — Candidates for `awsf-v2-plan.html` (parked)

Nothing below is committed. Each entry records what exists today, what the work
is, and what must be decided before it can be planned.

### 2.1 Antigravity adapter graduation (`agy`, Google models)

**Already reserved.** `awsf.config.yaml` carries
`antigravity: { kind: antigravity, executable: agy, enabled: false }`;
`core/src/adapters/antigravity.ts` exists as an honest probe returning
`E_ADAPTER_UNVERIFIED`; it is registered in `registry.ts`; Q1 decided
*"ship the probe, verify later."*

**The graduation procedure is already written**, in the adapter's own header
comment: run ONE bounded `agy` session with a small read-only prompt; capture
raw stdout and stderr unedited; read the capture; then implement fixture-first
only if it proves machine-parseable. Then add Gemini entries to `catalog.ts`,
set usage/cost authority, and flip `enabled: true`.

**Probe findings, 2026-08-18 (zero quota spent).** Q1's premise — *"nobody has
run `agy` and read its output"* — is now partly resolved from the CLI's own help
and model listing, neither of which costs a call.

`agy.exe --help` advertises a print mode with a machine-parseable stream,
structurally the same shape as the claude adapter's:

| Flag                                | Meaning                                                          |
| ----------------------------------- | ---------------------------------------------------------------- |
| `--print` / `-p` / `--prompt` | run a single prompt non-interactively                            |
| `--output-format`                 | `text` \| `json` \| **`stream-json`**                |
| `--input-format`                  | `text` \| `stream-json` (NDJSON on stdin, one turn per line) |
| `--json-schema`                   | enforce structured output; for`stream-json`, final result only |
| `--model`                         | model for the session                                            |
| `--effort`                        | `low` \| `medium` \| `high`                                |
| `--sandbox`                       | terminal restrictions                                            |
| `--disable-slash-commands`        | suppress slash/skill expansion in print mode                     |
| `--mode`                          | `accept-edits` \| `plan`                                     |

**So a machine-parseable stream mode exists.** That removes the reason the
adapter shipped blocked, but it does **not** discharge the fixture-first rule:
no parser may be written from a help text. The captured bytes are still required.

`agy.exe models` returns 15 models at zero cost:

- `gemini-3.7-flash-{high,medium,low}`, `gemini-3.6-flash-{high,medium,low}`,
  `gemini-3.5-flash-{high,medium,low}`
- `gemini-3.1-pro-{high,low}`
- `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`

Note the effort level is baked into the **model id** here, unlike claude's
separate `--effort` flag. The catalog entry must reflect that, and the flag and
the model-id suffix must not be allowed to disagree.

**Two blockers found, neither anticipated by the plan:**

1. **The executable is `agy.exe`, not `agy`.** On WSL2 it resolves to a Windows
   binary under the Windows user profile, invoked across the WSL boundary.
   `awsf.config.yaml` declares `executable: agy`, which resolves to nothing on
   this machine. The adapter needs per-platform executable resolution, and this
   is a **portability-matrix row**, not a config typo.
2. **Authentication is an interactive OAuth flow.** A non-interactive `--print`
   run exits 1 with *"Authentication required… Waiting for authentication
   (timeout 60s)"* and a browser URL. `agy.exe models` succeeds without it, so
   the auth boundary sits between listing and inference. A headless adapter
   therefore depends on a **pre-authenticated cached token**, exactly as the
   claude and pi adapters depend on their subscriptions being logged in. The
   adapter must detect the unauthenticated case and report `blocked` rather than
   hanging for the full timeout.

**Argv shape, learned the hard way.** `agy.exe` uses Go's `flag` package, and
**`--print` takes the prompt as its value** — which is why `--prompt` is
documented as an alias for it. A run shaped as
`--print --output-format stream-json … "<prompt>"` silently binds
`--output-format` as the *prompt text*, answers a question about that flag, and
falls back to `text` output because the format flag was consumed. The correct
form puts the prompt immediately after `--print`:

```
agy.exe --print "<prompt>" --output-format stream-json --model <id>
```

This is exactly the class of error the fixture-first rule exists to catch: the
help text alone would have produced a wrong adapter.

**Stream format, confirmed from real bytes (the auth-failure terminal record):**

```json
{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"",
 "error":"authentication failed or timed out","duration_seconds":0,"num_turns":0,
 "usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,
          "cache_read_tokens":0,"total_tokens":0}}}
```

Established structurally, without a successful inference call:

- **NDJSON with an `event` discriminator.** The terminal record is
  `event: "result"`.
- **A `usage` block** carrying `input_tokens`, `output_tokens`,
  `thinking_tokens`, `cache_read_tokens`, `total_tokens` — this is the adapter's
  `usageAuthority` source, and it reports `thinking_tokens` separately, which
  the catalog's `supportsThinking` must reflect.
- **`conversation_id`** is the continuity locator, mapping to
  `core/src/persistence/continuity-store.ts`.
- **Failures are structured on stdout**, with human prose on stderr. Stdout is
  authoritative; a failed run still emits a well-formed terminal record with
  zero usage, so `blocked` detection can be structural rather than exit-code
  guesswork.

**Success-path capture taken 2026-08-18** — one bounded read-only prompt on
`gemini-3.7-flash-low`, exit 0, 5 NDJSON records over 2,267 bytes, **stderr
empty**. Q1 is now fully answered from observed bytes: **`agy` emits a
machine-parseable stream, and the adapter can graduate.**

Four event kinds, each one line of NDJSON:

| `event`       | Payload                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------- |
| `init`        | `conversation_id`, `init.{model, cwd, tools, permission_mode}`                          |
| `step_update` | `{conversation_id, step_index, state, step_type, text_delta?, duration_seconds?, usage?}` |
| `result`      | terminal —`{conversation_id, status, response, duration_seconds, num_turns, usage}`      |

`step_type` values observed: `user_input`, `checkpoint`, `agent_response`.
`state` observed: `DONE`. `status` observed: `SUCCESS` (and `ERROR` on the
earlier auth-failure path).

What maps cleanly onto AWSF's adapter contract:

- **Model identity is stream-authoritative.** `init.model` reports the
  *resolved* model, so this satisfies the dashboard's stronger identity class
  rather than the route-attributed fallback.
- **Usage is provider-authoritative**, appearing on both the `agent_response`
  step and the terminal `result`: `input_tokens`, `output_tokens`,
  `thinking_tokens`, `cache_read_tokens`, `total_tokens`.
- **`conversation_id`** is the continuity locator, and `--continue` /
  `--conversation <id>` are the resume flags.
- **Cost note:** 13,686 input tokens for a five-word prompt. The tool-schema
  overhead is fixed per call and any cost display must expect it.

**Still unknown:** whether `text_delta` streams incrementally. This capture's
output was one token, so it cannot distinguish incremental deltas from a single
terminal delta. One longer-output probe settles it; it is not needed before the
task is written.

### 2.1.1 Two blockers that gate the antigravity entry

**Blocker A — there is no tool allowlist or denylist flag, and this is the
binding constraint.** The captured session exposed **56 tools**, among them
`run_command`, `write_to_file`, `replace_file_content`,
`multi_replace_file_content`, `sed_file`, `notebook_edit`,
`execute_browser_javascript`, `search_web`, `read_url_content`, `send_message`,
and `schedule`.

AWSF's `readonly` profile is not a convention — for claude it is enforced by
passing an explicit deny list (`--disallowed-tools Bash,Write,Edit,NotebookEdit`)
rather than trusting a default, on the plan's stated reasoning that *"a default
that widens in a future release silently widens the ceiling."* `agy --help`
exposes **no equivalent**: only `--sandbox`, `--mode {accept-edits,plan}`, and
`--dangerously-skip-permissions`.

**Consequence: AWSF cannot currently express its `readonly` profile for `agy`
at all** — which is exactly what the planner, reviewer, and scout agents
require.

**`--mode plan` was probed on 2026-08-18 and does NOT close this.** Given an
explicit instruction to create a file in the working directory, plan mode did
not create it — but the stream shows *why*, and the reason is not enforcement:

```
step 3  tool  write_to_file  TargetFile=C:\Users\…\antigravity-cli\brain\<id>\create_probe_file.md
```

**`write_to_file` was available and executed.** The model simply aimed it at its
own brain directory to draft a plan document, then returned `SUCCESS` with a
"review the plan and click Proceed" message. So `--mode plan` **steers the model
rather than removing the tool** — precisely the kind of soft default the plan
refuses to rely on, on its stated reasoning that a readonly profile passes an
explicit deny list because *"a default that widens in a future release silently
widens the ceiling."* A convention the model can decline to follow is not a
permission profile.

Two useful things did come out of the same probe:

- **A permission-requiring action does not hang under `--print` with no TTY.**
  It completes and asks in its final response, exiting 0. The feared
  indefinite-block failure mode does not occur.
- **Tool events are richly structured** — `tool_name` plus
  `tool_info.parameters` including an absolute `TargetFile`. That is enough for
  AWSF to *observe* every write and abort on an out-of-bounds path, which is how
  the existing permission-breach journey already behaves. **Detection is
  available even though prevention is not** — a weaker guarantee than the deny
  list claude gets, and it must be described that way rather than equated with
  it.

So the routes out are now two, not three:

1. Admit `agy` only for **write-capable** roles inside a worktree, with
   host-side stream inspection plus `path-policy` doing the bounding, and leave
   readonly roles on claude and pi.
2. Leave the adapter a probe until Antigravity ships a tool-scoping flag.

Note the owner's own shell alias is `agy.exe --dangerously-skip-permissions`,
which is precisely the mode AWSF must never use. Separately, `send_message`,
`schedule`, `search_web`, and `read_url_content` are network- and
external-mutation-shaped, touching the `external-mutation` entry in
`policy.protected_operations`.

**Blocker B — the Windows/WSL path boundary is visible in the stream.**
`init.cwd` came back as a **Windows path** (`D:\…`) while AWSF's worktrees are
WSL paths. The adapter needs translation in both directions, and worktree
containment — a T2-tier policy concern — cannot be enforced by string comparison
across that boundary. This compounds the `agy.exe` resolution problem rather
than being separate from it.

**Blocker C — authentication does not survive into a non-interactive child, and
this may be the hardest of the three.** Observed on 2026-08-18: **two**
invocations from the owner's interactive shell succeeded, while **three** from a
non-interactive spawned process on the same machine, same Windows user, and
within minutes of a successful login were each challenged afresh, waited the
full 60 seconds, and exited 1 with zero usage. No plaintext token was found at
the conventional locations (`%LOCALAPPDATA%\agy` holds only `bin`; no `.agy` or
`.config/agy` exists), which is consistent with Windows Credential Manager or
another interactive-logon-bound store.

**Why this matters more than it first appears:** AWSF spawns every provider as a
non-interactive child through `transport-broker.ts`. If `agy` cannot
authenticate from such a child, the adapter cannot function *regardless* of how
the stream and permission questions resolve.

**RETRACTED 2026-08-18. There is no authentication blocker.** An earlier pass of
this document claimed `agy`'s keyring auth was bound to the interactive Windows
Console session and therefore "structurally incompatible" with AWSF's WSL2
routing. **That was wrong**, and it is recorded here rather than deleted because
a future session acting on it would have descoped a working adapter.

**The actual cause is the working directory.** Every failing invocation was
launched from a **WSL-only path** (`/tmp/...`), which has no Windows equivalent.
Launched from there, `agy.exe` cannot resolve its working directory, its
credential lookup fails, and it reports the thoroughly misleading *"You are not
logged into Antigravity"* — then falls back to the browser OAuth flow. Launched
from a Windows-accessible path (`/mnt/d/...`), the identical command
authenticates and succeeds non-interactively, stdin closed, sandboxed, with no
prompt. Three hypotheses were tested and eliminated first: it is **not** stdin
being a non-TTY (reproduced with `< /dev/null` on both sides), **not** the
observing tool's sandbox (fails equally with sandboxing off), and **not** the
Windows logon session (`tasklist` shows every spawned `agy.exe` in `Console`
session 1, the same as the working interactive one).

**Confirmed 2026-08-19 — the default worktree root fails this test.**
`defaultWorktreeRoot()` returns `join(dirname(stateRoot), "awsf-worktrees")`,
which on this machine resolves to
`/home/santiago_marin/.local/state/awsf-worktrees` — a **WSL-only path**. So
with the shipped default, `agy` cannot run at all: it would fail there with the
misleading authentication error described below. The v2 task must therefore
either relocate the worktree root for `agy`-routed tasks or translate the path
at the adapter boundary, and it cannot treat this as an edge case — it is the
default configuration.

**What survives as a real constraint — smaller, but genuine.** The `agy` adapter
**must be spawned with a Windows-accessible working directory**. Under Q8 the
per-machine worktree root lives outside the repository and the state root; if a
machine resolves that to a WSL-only path, `agy` will fail there with an error
message that names authentication and has nothing to do with it. The adapter
should detect a non-Windows-accessible `cwd` and refuse with a clear message
rather than letting the OAuth fallback disguise the cause. **This is a
portability-matrix row**, and it compounds blocker B rather than being separate
from it.

**Method note worth keeping.** The misleading error cost several rounds and one
confidently wrong architectural conclusion. The lesson is the fixture-first rule
again, one level up: a provider's *error text* is no more trustworthy than its
help text, and the variable that actually differed between a working and a
failing invocation was never mentioned by either.

**Net position on 2.1:** the stream question is closed and favourable; the
*permission* question has replaced it as the blocker. The v2 task must open with
a `--mode plan` probe, because the answer decides whether antigravity can serve
AWSF's readonly roles or only its write-capable ones.

**A third limitation was found on 2026-08-19 and is recorded in 2.5:** `agy`
exposes no system-prompt flag of any kind, so AWSF cannot give it a custom
operating contract either. See decision #26.

### 2.2 Fusion adapter via `mf` (fusion-harness)

**Already reserved.** Q5 decided *"fusion adapter in v1.1, contract reserved in
v1."* The contract is genuinely reserved: `awsf.config.yaml` carries
`fusion: { kind: composite-fusion, enabled: false }`, `transport: 'composite'`
is in the DDL, and the call ledger already implements composite reservation.
**The gap:** `core/src/adapters/fusion.ts` does not exist and
`RegisteredAdapterKind` is only `"claude-code" | "pi-codex" | "antigravity"`, so
`composite-fusion` resolves to `null` today.

**Decision 2026-08-18 — approach (c), `mf` as a declared-composite adapter.**
Three options were weighed:

- **(a) Port the pattern** — reimplement fusion natively inside AWSF. Correct but
  expensive, and forfeits the five other `mf` commands.
- **(b) Call `mf` opaquely** — cheap, but books 1 call for 3 and loses per-model
  identity, per-call usage, and partial settlement.
- **(c) Call `mf`, declaring composite cost and parsing its events** — chosen.

**Why (c).** `CallBudget.reserveComposite(2)` already declares `cost: 3` as one
reservation before launch, so accounting is truthful with no owner act. And
`extensions/fusion-harness/core/events.ts` already emits a normalized protocol —
`run.started`, `model.resolved`, `usage`, `run.completed/failed/cancelled` —
keyed per `ModelSlot`, with `TokenUsage { authority: "provider" }` and the same
"null means unreported, zero is authoritative" discipline AWSF uses (AWSF ported
its stream layer from these patterns). So per-model identity, per-call usage,
and partial settlement are all recoverable by parsing what `mf` already emits.

**Explicitly rejected: using `awsf raise` to pre-pay for fusion runs.** `raise`
moves the *ceiling*, not the *count*. Booking 1 per `mf` spawn and raising the
ceiling to compensate scales a miscount rather than correcting the unit — the
ledger's `spent + reserved <= ceiling` invariant only means something if `spent`
counts provider calls. `raise` is also built to resist routine use (interactive
TTY, `MAX_GRANT_CALLS` of 5, a hard `MAX_CALL_CEILING`, a journalled written
reason); routine grants would bury the runaway-spend signal it exists to raise.
`reserveComposite` achieves the same outcome for free.

**Both open items decided 2026-08-18:**

- **`mf` resolves via `PATH` lookup, never a machine path.** `mf` installs as a
  symlink to a specific checkout; `awsf.config.yaml` is explicitly "no machine
  paths." The adapter resolves `mf` on `PATH` and reports `blocked` with
  `E_ADAPTER_UNVERIFIED` when it is absent, mirroring the antigravity probe
  exactly. This adds a **portability-matrix row** that starts `PENDING` on every
  machine, the MacBook Pro included.
- **AWSF's `path-policy` owns the write boundary, not `mf`'s permission
  policy.** One policy owner, and it is the factory's — otherwise the
  breach-abort journey test stops covering a live write path, and the write
  boundary becomes whatever the subprocess happens to enforce.
  **Consequence, and the recommendation the owner asked for (2026-08-19).**
  The instinct was to extend `path-policy`'s glob language. **That is the wrong
  fix.** Both requirements dissolve by reusing machinery AWSF already has, and
  the policy semantics stay exactly as tested:

  1. **Several concurrent roles → one worktree per role, not one policy per
     worktree.** `path-policy` today is one worktree, one write set, one
     before/after fingerprint — and that is a *good* contract. Two roles writing
     into one worktree would make a mutation unattributable, which is precisely
     what the fingerprint exists to prevent. Instead give each constituent role
     **its own managed worktree**: two workers in two worktrees plus a fuser that
     reads both and writes a third. That is exactly the shape fusion-harness
     already runs (independent agents, then a merge), it needs **no new policy
     semantics at all**, and the change is to the *session model* — an attempt
     holds several `PermissionSession`s instead of one — rather than to the
     boundary itself. **Improvement it buys beyond compliance:** the owner can
     review the architect's diff and the builder's diff *separately* before the
     fuser merges them, which is the one thing the current fused-output view
     cannot show.
  2. **The out-of-worktree artifact directory → supply it, do not exempt it.**
     `mf` writes to a private `/tmp/fusion-harness-XXXXXX/` of its own choosing.
     Today that is not *forbidden* by `path-policy`, it is **unobserved**, which
     is worse. The fix is to stop letting `mf` choose: point it at the attempt's
     existing `sessionRuntime`, which is already an allowed writable root, is
     already outside the worktree by design, and which the sandbox broker
     already binds writable and already exports as `TMPDIR`. **No new writable
     root is created — an existing governed one is reused**, and the fusion
     artifacts become retained evidence under the attempt instead of litter in
     `/tmp`.

  Both are design recommendations and neither is validated yet; the v2 task
  should prove the per-role worktree shape before the adapter is written.

### 2.3 Planning phase — greenfield projects from zero

**The largest candidate, and the only one with no reserved slot.**

**Today's limitation.** The factory assumes a repository, a plan, and tickets all
already exist. `awsf new` requires a `repository` path it resolves on disk plus a
`taskId`; the `plan` recipe plans *a task inside a repo*, not a project. There is
no path from "an idea and nothing else" to "a repository with a plan and a
backlog."

**Target lifecycle**, driven start to finish from one driver session: brainstorm
→ shaped plan → repository → backlog → build → review → land → production-ready.

**Components:**

- **A shaping phase.** Where fusion-harness earns its place: `/opinion` →
  `/fusion` is a two-model shaping ladder, with the `lens` skill as the critique
  layer above it.
- **A plan recipe emitting a planf3 HTML.** The `planf3` skill already produces
  the artifact; the factory needs a recipe that invokes it and validates the
  output against a contract, as every other phase validates an envelope.
- **A bootstrap step.** `git init`, baseline commit carrying the plan, scaffold
  `awsf.config.yaml`, cut `specs/tickets/` from the plan. Much of this exists —
  M9's intake recipe and `ticket-store.ts` already write tickets, and the
  ticket/plan-sync meta-test already keeps the two consistent.

#### Grounded in a real case — Smart Health Platform (inspected 2026-08-19)

The owner's live project is the reference implementation for the registry, and
it is **three repositories**, not one:

| Repository                | Branch               | Stack                               | Gates                                   |
| ------------------------- | -------------------- | ----------------------------------- | --------------------------------------- |
| `Smart Health Platform` | `main`             | specs and planning only, no code    | none                                    |
| `smart-health-api`      | **`master`** | Python — hatch, mypy, ruff, pytest | `pytest` / `ruff` / `mypy`        |
| `smart-health-app`      | `main`             | Expo / React Native / TypeScript    | `jest`, `expo lint`, `playwright` |

Five constraints fall straight out of it, none of which the current
single-repo shape can express:

1. **The plan repo is not the code repo.** The v4 plan lives at
   `Smart Health Platform/specs/smart-health-platform-v4.html`, while the code
   lives in two sibling repositories. AWSF today assumes `specs/` sits beside
   the code — `ticket-store.ts` reads `specs/tickets/**` and the plan-sync
   meta-test reads `specs/awsf-plan.html` from the same checkout. A registry
   must let a project's **plan repo differ from its target repos**.
2. **The default branch is not always `main`.** `smart-health-api` is on
   `master`. Landing is fast-forward-only, so the branch must be **read from
   each repo**, never assumed.
3. **Gates are per repository.** `awsf.config.yaml` declares one global
   `gates:` block, which is right for a single-repo factory and wrong here:
   `npm run test:unit` means nothing to the Python API. Each registered repo
   carries its own gate commands.
4. **Cross-repo coordination is an existing requirement, not a hypothetical.**
   The outgoing workflow implemented it by hand with `api_write_lock`,
   `app_write_lock`, `global_validation.done`, and `phase_10_contract.md` under
   `.orchestrate/`. A schema change in the API and its client regeneration in
   the app are **one unit of work across two repositories**, and AWSF has no way
   to express that today. **This is the v2 plan's second Questionable**, and the
   fork is real: either a task may own worktrees in several repos at once, or
   tasks stay single-repo and a declared contract artifact links them. Do not
   let a build session decide this by accident.
5. **The migration itself is scope.** All three repos carry the outgoing
   pattern — phase prompts rather than tickets, orchestrator/worker/verifier
   roles, `.done` marker files — which is exactly the machinery AWSF's
   Explicitly Not Built section removed. Onboarding them is a conversion, not a
   config edit.

**Sequencing note — and this is the strategic reason v2 exists now.** Smart
Health Platform is **the owner's priority project and the one that will demand
the most of AWSF**; carrying its development is the factory's job. It is
currently blocked on hardware (the M5 MacBook Pro, for RAM and an Apple developer
subscription) and on updating the v4 plan with the screen designs from Claude
Design before migrating.

That block is **an opportunity window, not merely a delay**: the registry and the
planning phase can be designed and built against these three repositories as the
worked example **without being blocked by them**, so that AWSF is ready to carry
Smart Health development the day the hardware lands. The requirements are already
known and the dependency runs one way. This is the ideal order, and it is why v2
is being specified during the block rather than after it.

**Decided 2026-08-18: the factory must be able to build repositories other than
its own.** This is a real scope expansion. Everything today is single-repo —
`awsf.config.yaml` sits at the repo root, worktrees hang off that repo, the state
root is keyed to it — and Q4's reasoning explicitly deferred multi-project. It
touches config loading, state-root resolution, and worktree resolution, and it
should be the v2 plan's first Questionable rather than an assumption inside a
task.

#### Grounded in a second real case — Blueprint and Factory (inspected 2026-08-19)

The Smart Health grounding above says what the *registry* must express. This
second grounding says what the *planning ladder itself* must produce, and it
comes from a working engineer's published skill set plus the repository he built
with it.

**Sources, labelled by claim strength** (see 2.3.6 — the labels are the point,
not decoration):

| Source                                                                                                 | Kind                | Path                                                                                                                           |
| ------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Owain Lewis, "design and planning" walkthrough                                                         | `transcript`      | `../agentic_design_skills_OwenLewis_youtube_transcript.txt`                                                                  |
| Three deck slides from the same talk                                                                   | `screenshot`      | `../agentic_design_skills_OwenLewis_youtube_screenshots/`                                                                    |
| `blueprint` — ten skills, guides, worked examples                                                   | `source-verified` | `../blueprint/`                                                                                                              |
| `factory` — the Go control plane built from `blueprint/examples/dispatch-control-plane/design.md` | `source-verified` | `../factory/`                                                                                                                |
| `planf3` skill as installed                                                                          | `source-verified` | `~/.claude/skills/planf3/`                                                                                                   |
| The owner's own three v1 prompt files                                                                  | `source-verified` | `../{agentic_workflow_software_factory_gemini3.1Pro,agentic_workflow_software_factory_opus4.6,awsf-planf3-build}-prompt*.md` |

`factory` matters more than a second reference repository normally would: its
design document is *in* `blueprint/examples/`, so the pair is a complete,
inspectable trace from skill → design doc → shipped system. That is the exact
artifact chain 2.3 is trying to produce.

##### 2.3.1 What planf3 already does better — stated first, so the comparison is fair

Blueprint has no HTML-native authoring, no in-file review layer, no
`planf3-review v1` export bridge, no Questionables with `data-review-options`,
no agent-owned `[]`/`[wip]`/`[x]`/`[f]` markers, no MODEL/EFFORT build prompts,
no dual-provider routing, no `specs/tickets/` emission, and no Amendments
ledger. Blueprint's `/plan` explicitly **refuses to write a plan document at
all** — *"Return the plan in chat. Never write a plan document."* On artifact
quality planf3 wins outright, and nothing below should be read as trading that
away.

The gaps are structural rather than cosmetic.

##### 2.3.2 The five structural gaps

**① Design and Plan are one skill in planf3, two in blueprint.** planf3's Create
Plan step 3 is a single bullet — *"Design Solution — develop technical
approach"* — inside plan authoring. Blueprint splits them: `/design` produces a
**decision document** (numbered §1–13, `INV-n`, `AC-n`, and a Decisions section
recording what was rejected and what the choice costs) that **stops for review**;
only then does `/plan` split it into tasks. AWSF's own v1 process did have this
split — `specs/awsf-architecture-proposal.md` is 112KB of exactly that — but it
was ad-hoc, produced by a hand-run fusion, and is not a repeatable stage. This
is the largest gap and it maps directly onto the owner's real pipeline (2.3.4).

**② An adversarial review that a different model runs, with a verdict that
blocks.** planf3's review layer is *human* review in a browser;
`workflows/review-plan.md` applies pasted human feedback. Neither runs an agent
review with a blocking verdict. `/architecture-review` requires a **fresh
subagent that did not write the proposal**, stays read-only, and returns one of
three verdicts — `Approve`, `Request changes`, `Blocked` — over two severity
classes (`Blocker`, `Important`) for both findings and open questions. The deck
states the gate as five checks and one rule:

> **Fit** (boundaries, data, rollback) · **Failure** (retries, concurrency,
> recovery) · **Scale** (limits, latency, throughput) · **Security** (identity,
> input, secrets) · **Proof** (observable criteria, not adjectives).
> *"Five checks. Nothing gets planned until it passes."* — then *"Revise, then
> review again."*

The owner's existing `lens` skill is a genuinely different tool and the two
compose rather than overlap: `lens` runs five *subjective* lenses (Devil's
Advocate, Expansionist, Objective, Researcher, Customer) at brainstorm stage and
closes with a recommendation; `architecture-review` runs *engineering* focus
areas at design stage and closes with a verdict that gates the next phase.
`lens` for shaping, `architecture-review` for the gate.

**③ Stable requirement IDs threaded design → task → test.** Blueprint mandates
`INV-n`/`AC-n` in the design, cited verbatim in every task's *Done when*, never
renumbered, never reused. `blueprint/examples/rag-chatbot/plan.md` shows it
working: *"Invalid, empty, and oversized files return the documented errors and
create no records. (`AC-3`; `INV-3`)"*. **AWSF has gates and envelopes but no
requirement-ID spine.** For a system whose pillars are "earned success" and
"evidence-gated", that is a conspicuous absence.

**④ `ARCHITECTURE.md` as verified current state, strictly separate from
proposals.** `factory` enforces it in one sentence: *"Current behavior belongs
in the root `ARCHITECTURE.md`. Proposed behavior belongs in a focused design
until it is implemented."* Its `docs/README.md` is an index carrying real
lifecycle — **Current implementation** / **Active design work** / **Design
records and superseded proposals** — where each superseded entry names what
replaced it and why. AWSF's `specs/` holds a plan, a proposal, an acceptance
doc, an evidence doc and this file, with **no index and no status**. This is
load-bearing for the registry: an `ARCHITECTURE.md` per registered repository is
*how a factory grounds an agent in a repository it did not build*.

**⑤ Requirements and Technical design are two jobs with different owners.** From
the deck: Requirements — what are we building, why, who for, how we know it
worked — *"You decide this alone."* Technical design — stack, database,
architecture, edge cases, operations — *"An agent is a real partner here."*
planf3 has no requirements stage; `USER_PROMPT` *is* the requirements,
undifferentiated. For greenfield-from-zero, which is precisely this section's
target, that is the missing front end.

Two further framings from the same sources are worth keeping verbatim because
they are the argument, compressed:

- *"Software has five stages, and they haven't changed."* Design · Plan · Build ·
  Verify · Deploy. **"Two are automated. One is halfway there. That is the whole
  argument."** Design stays *entirely yours*; Plan is *mostly the agent, once the
  design is good*; Verify is *the checking is automated, the standard is not*.
- *"Agents build things very quickly. That also means they build the wrong things
  very quickly."*

##### 2.3.3 Verdicts

**Decided 2026-08-19: A, B, C, D, E, F, G, H, I are taken; J, K, and L are
skipped.** The adaptations in 2.3.5 are taken with them. Each verdict below
keeps its original cost estimate.

|             | Component                                                                   | Verdict                                                                    | Cost            |
| ----------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------- |
| **A** | Design stage producing a decision doc that stops for review                 | **Take**                                                             | Medium          |
| **B** | Adversarial design review — different model, blocking verdict, five checks | **Take**                                                             | Small–medium   |
| **C** | `INV-n`/`AC-n` IDs threaded design → ticket → gate                    | **Take — best leverage per unit cost**                              | **Small** |
| **D** | `ARCHITECTURE.md` + a docs index carrying lifecycle status                | **Take — load-bearing for the registry**                            | Small           |
| **E** | Requirements vs Technical design split                                      | **Take, reduced form**                                               | Small           |
| **F** | An explicit stopping point per stage                                        | **Take — essentially free**                                         | ~0              |
| **G** | Skill router (`choosing-a-skill` / `workflows` equivalents)             | **Take, but sequence with 2.6**                                      | Small           |
| **H** | The five-stage cross-provider ladder as a governed pipeline                 | **Flag — this is the actual vision**                                | Large           |
| **I** | `planf3` → `plan-sota` rename                                          | **Take, with the trap in 2.3.7 named**                               | Small           |
| **J** | GitHub issues as the task sink                                              | **Flag — must not ride in on decision 16**                          | —              |
| **K** | `html-doc` skill                                                          | **Skip** — planf3 authors HTML natively; adopting it is a downgrade | —              |
| **L** | `task-to-pr`, `codex-issue-coordinator`                                 | **Skip** — that is AWSF itself, and AWSF's version is stronger      | —              |

**Why C is the cheapest real win.** The `ticket/plan-sync` meta-test
(`AGENTS.md` invariant 12) already asserts that tickets and plan never disagree
on coverage, milestone grouping, `state`, prompt bytes, and `depends_on`
ordering. Adding *"every `AC-n` in the plan appears in at least one ticket's
Done-when, and no ID is ever reused"* is **the same shape of check over the same
files**. It converts "the plan says this is done" into "this specific acceptance
criterion is claimed by this specific ticket", which is the conversion pillar 4
exists to make.

**Why F is free.** `blueprint/guides/workflows.md` names a stopping point for
every skill and then says why: *"That boundary matters. It keeps one skill from
silently making decisions owned by another phase or by a person."* That is
AWSF's pillar 1 restated at the skill layer. Adopting it costs a sentence per
stage and buys vocabulary AWSF already believes in.

##### 2.3.4 The five-stage cross-provider ladder — the actual vision

The owner's three v1 prompt files are not three files. They are a **ladder in
which each stage's output is the next stage's input prompt**, run across
different providers on purpose:

```
Intent            owner, spoken, naming the grounding sources
  → Gemini 3.1 Pro (agy)     synthesizes; writes a prompt, not an answer
                             → agentic_workflow_software_factory_gemini3.1Pro_prompt.md   (9KB)
  → Opus 4.6 (agy)           refines into a master prompt
                             → agentic_workflow_software_factory_opus4.6_prompt.md       (43KB)
  → mf /fusion               Opus 5 + GPT 5.6 sol; claims carry [ARCHITECT]/[BUILDER] attribution
                             → specs/awsf-architecture-proposal.md                       (112KB)
  → SOTA + planf3            plan HTML + build-prompts + acceptance + specs/tickets/
```

Every stage is manual today: the owner opens sessions, pastes paths, and
hand-names the output files. **That ladder produced AWSF v1, and AWSF cannot
run it.** Making it a governed workflow is the strongest form of self-hosting
available to this project — the factory producing the artifacts that produced
the factory. It is also the honest answer to what the vision *is*: not "a
planning phase", but this specific ladder, run by the factory, with per-stage
evidence.

**Decided 2026-08-19: the ladder is built as a governed AWSF workflow inside
v2** — typed envelopes, gates, journal records, and reserved-then-spent calls per
stage — not merely codified as a manual runbook. Three conditions attach, and
they are the decision as much as the verdict is:

1. **Build it provider-agnostic, with routing declared in config.** The ladder's
   *stage structure* names no provider; only the routing does, and
   `awsf.config.yaml` already declares provider per agent role. The workflow is
   therefore built and tested end-to-end on `claude` + `pi`, with the `agy` and
   `mf` routes enabled when those adapters graduate — the same pattern v1 used
   when it reserved the fusion contract without building the adapter. **`agy` and
   `mf` are preferred routes, not preconditions.**
2. **Sequence it last in v2**, after bootstrap and after the design and review
   stages (verdicts A, B, C) exist — because the ladder's final rungs *are* those
   stages.
3. **State the degradation rule explicitly**: which stages may collapse to a
   single model, and what the workflow does when a preferred route is
   unavailable. This needs care against *"provider fallback or substitution — a
   failed declared route blocks."* The clean way to keep both: **a declared route
   never falls back at runtime; degradation is a different declared workflow
   variant the owner selects up front.** Same invariant, two recipes.

**Correction to an earlier claim in this section.** An earlier pass said the
ladder "depends on 2.2 for stage 3 and on 2.1 for stages 1–2" and therefore could
not be built first. That was too pessimistic, and it is recorded rather than
deleted because it would have mis-sequenced the plan. Routing is config: stages
1–2 are prompt refinement and run on any model; stage 3 *prefers* `mf` but
degrades to a single SOTA model producing the proposal; stages 4–5 are already
what the plan skill does. **If `agy` never gains a tool-scoping flag, the ladder
still works.**

**What it does depend on — and the chicken-and-egg, with its fix.** AWSF phases
run in a managed worktree of a repository, and a greenfield project has none.
Rather than inventing a pre-repository execution mode, **invert the order**:
`git init`, baseline commit, and `awsf.config.yaml` scaffold *first*, then run
the ladder inside a real repository, producing `specs/` artifacts as ordinary
governed phase outputs. That makes the ladder normal AWSF work instead of a
special case, and the bootstrap step is already in this section's component list.

**One convergence worth keeping:** stages 1–2 write `.md` files into a worktree,
which is a **write-capable role** — exactly and only the case decision 13 admits
`agy` for. The ladder never needs the `readonly` profile that `agy` cannot
express, so the blocker in 2.1.1 does not bind here.

**What option 1 would have bought, and why it is not lost.** Writing the ladder
down as a manual procedure is **not an alternative path but the first half of
this one**: no envelope schema can be written for a stage that has never been
captured. Nobody yet knows the typed shape of a fused proposal carrying
`[ARCHITECT]`/`[BUILDER]` attribution, because it has been produced exactly once,
by hand, as prose. Capturing the stages *is* the fixture-first step, one level up
from the adapter rule — and it remains the first task of this workstream.

##### 2.3.5 Collisions with v1 invariants, and how each one lands

Per decision 18: each collision is named with its cost and an adaptation, not
used as a veto.

**Collision 1 — a review verdict vs *"conversational evidence"* and pillar 1.** A
model returning `Approve` is conversational evidence, and letting it gate the
plan phase is a model advancing lifecycle state.
**Adaptation:** the verdict is an **envelope, never a transition**. Make
`architecture-review` a phase whose typed envelope carries
`{ verdict, findings[], openQuestions[] }` with `severity` on each element, and
make the **gate deterministic**: *zero `blocker` findings and zero `blocking`
open questions* — a host-side count over structured data, never a reading of
prose. The host advances; the model supplies structured facts only. Identical in
shape to the existing thirteen gates. **This strengthens "earned success" rather
than weakening it, and requires no invariant text to change.**

**Collision 2 — new phases vs *"six workflows, not twelve; a seventh only after a
repeated real use case appears — never speculatively."***
**Adaptation:** not a real collision, but record the demand signal so no build
session has to guess at it: the owner ran this ladder by hand to produce AWSF
v1, and is about to run it again for three Smart Health repositories. That is
the same countable standard under which `intake` was admitted.

**Collision 3 — the ladder vs *"provider fallback or substitution"* and
*"quota-aware routing."***
**Adaptation:** also not a collision, and worth stating precisely so nobody
drifts into one. The ladder is **declared per-stage routing** — stage 1 is
`agy`, stage 3 is `mf`, declared in config — and a failed stage **blocks**. What
*would* violate the invariant is "pick whichever subscription has quota left".
The owner's existing dual-provider build-prompt convention keeps that as a
**human** choice at build time. Human picks; the runner never picks. Hold that
line and both invariants survive intact.

**Collision 4 — V.7 rule 1 of the evidence document: *"No skill is ever in the
execution path."*** A `design` skill and a `design` recipe are different things
at different altitudes, and conflating them breaks the rule.
**Adaptation:** they are both, and the split falls straight out of this
section's own problem statement. Before a repository exists **AWSF cannot run at
all**, so greenfield bootstrap is a *skill* in the owner's driving session. Once
a project is registered it is a *recipe* inside the factory. Same document
shape, two execution homes, and rule 1 holds because no gate ever depends on a
skill having been read. **Adopted 2026-08-19** (2.3.8, fork 1).

**Collision 5 — GitHub issues as the task sink (verdict J).** The walkthrough
ends by creating GitHub issues with a parent ticket. Decision 16 opened a narrow
door for pushing **landed commits**; creating issues is a *different* network
write, to a *different* surface, at a *pre-`LANDED`* moment. It must not ride in
on 16. Either it is out of scope, or it earns its own decision.
**Closed 2026-08-19 by descope: verdict J is skipped, so no GitHub issue sink is
built and no new network write is introduced.** Should it ever be revisited it
starts as its own decision, never as an extension of #16.

##### 2.3.6 Research method — the claim-labelling rule

The owner asked whether the "back and forth" across transcript, screenshots,
clone repos, and AWSF's own code is a good way to brew ideas from heavy context.
**It is, and it is close to the only method that works for this class of source,
because the four source kinds fail in different directions:**

- **Transcript** carries the *why*; lossy on specifics, buried in disfluency.
- **Screenshots** carry the author's own compression — a deck slide is denser
  than the speech that accompanied it.
- **Clone repo** carries what was actually built. The only source that cannot
  lie about feasibility.
- **AWSF's own code and as a target system** is the only place where *fit* is decidable.

Worked proof from this pass. The transcript says "use the architecture review
skill to find edge cases, flaws" — true, vague, unbuildable. The screenshot
gives the actual gate: five named checks and *"Nothing gets planned until it
passes."* The repository gives the machine-readable form: three verdicts over
two severity classes. AWSF's own code says where it plugs in — a
thirteenth-gate-shaped thing, not a new subsystem. No single source spans that
distance.

**The failure mode, named: back-and-forth is confirmation-shaped.** With enough
passes one can always find a quote supporting a conclusion already reached. This
document contains a live instance — the `agy` "authentication blocker" in 2.1.1,
confidently concluded, architecturally consequential, wrong, and retracted. Its
own method note states the lesson one level too narrowly.

**The fix already exists here twice and has never been named.** First,
fixture-first for adapters: no parser may be written from help text, only from
captured bytes. Second, the evidence labels already used ad hoc in
`awsf-plan.html` § Rejected alternatives. Counted across `specs/` on 2026-08-19:
`source-verified` 5, `transcript claim` 3, `screenshot observation` 2,
`public-reference claim` 2, `unverified`/`inferred` ~44. **The vocabulary
exists, is applied inconsistently, and is defined nowhere.**

**A first draft of this rule was wrong, and the correction is the useful part.**
It read: *"Strength order: `source-verified` > `captured-bytes` > `screenshot` >
`transcript` > `public-reference` > `inferred`. A design decision may not rest on
a transcript-only claim."* Two defects. It assumed **all source kinds are
present**, when most intake is partial — the owner's reference folder holds
roughly fifteen transcripts, a minority with screenshots, fewer with repositories
— so a rule that only works on the complete set fires almost never. And its
linear ranking is **wrong on its own worked example**: for the claim *"this is
what the author considers the core of his argument"*, the deck slides were
**stronger** evidence than the transcript, because a slide is the author's own
compression while speech is not.

The defect is treating strength as one scalar. It is not: **each source kind is
primary for a different class of claim.**

| The claim is about…                              | Primary evidence                                         | Hearsay for this claim            |
| ------------------------------------------------- | -------------------------------------------------------- | --------------------------------- |
| **Someone asserts, ranks, or recommends X** | transcript, screenshot — nothing stronger exists        | —                                |
| **X exists and is shaped this way**         | the repository or code; captured bytes for runtime shape | transcript, screenshot, help text |
| **X works / is feasible**                   | running it, or a repository that demonstrably ships it   | transcript, screenshot, help text |
| **X fits the target system**                | **only the target repositories' own code**         | everything else, at any volume    |
| **AWSF can build X**                        | **only AWSF's own code**                           | everything else, at any volume    |

Two consequences worth stating plainly. **A transcript-only source is fully
sufficient** for the whole first row, which is a large share of real intake — no
repository would strengthen *"the author believes design deserves the token
budget."* And **no external evidence, however strong, can settle the last two
rows**; that is already how `awsf-plan.html` § Rejected alternatives behaves, rejecting
well-evidenced outside ideas purely on fit.

**Revised rule — three parts, and it works on partial evidence:**

> **1. Label every claim** with its source kind and a citable anchor —
> `path:line`, screenshot filename, or transcript span.
>
> **2. Record absent sources, with the reason.** *"No repository exists"* and
> *"a repository exists and has not been gathered"* are completely different
> statements, and only the second is a gap. An unstated absence is the actual
> defect; a stated one is a bounded risk.
>
> **3. For any claim carrying a decision, name the cheapest unused upgrade** —
> the single cheapest action that would raise that claim's strength, and whether
> it has been done. `none available` is a valid and useful answer.
>
> **A decision may rest on a single weak source — but it must say so, and it must
> name what would settle it. What is forbidden is an unlabelled claim, or one
> whose cheapest upgrade was available and skipped.**

Part 3 is the load-bearing one, and it is what would have caught the `agy` error:
the cheapest unused upgrade there was *"run the identical command from a
Windows-accessible working directory"* — minutes of work, never named as
outstanding, and the reason a wrong architectural conclusion survived several
rounds. **The failure was never "only one source." It was not knowing that a
cheap check was missing.**

Unchanged and still absolute: for anything that becomes **executable** — a
parser, an adapter, a schema — fixture-first binds with no ladder at all. Only
captured bytes count, and help text, error text, and prose never substitute.

**Sources have roles, and the roles matter more than the list.** The matrix above
originally carried a single row reading *"X fits AWSF"*. That was correct only by
accident: in **this** brainstorm AWSF is both the system being changed and the
system that will do the building, so two distinct checks collapsed into one and
the flaw was invisible. Brainstorming any other project separates them
immediately.

Every brainstorm therefore declares its sources in **three roles**:

| Role                | What it is                                                      | What it alone can settle                                                                  |
| ------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Target**    | the system the idea is*for*                                   | product fit, current shape, feasibility in that stack                                     |
| **Factory**   | the system that will*build* the idea — **always AWSF** | buildability: which workflow and tier, whose worktree, which gates prove it, how it lands |
| **Reference** | outside systems and material studied for ideas                  | *"someone asserts X"*, *"X was built this way elsewhere"*                             |

Worked contrast:

|                                  | Target                                                                                             | Factory | Reference                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| **This session**           | AWSF —**target == factory**; state the collapse so a reader does not read it as an omission | AWSF    | `blueprint`, `factory`, the transcript, the screenshots |
| **A Smart Health session** | `Smart Health Platform`, `smart-health-api`, `smart-health-app`                              | AWSF    | whatever is being studied that day                          |

**AWSF is a source in every brainstorm, for every project, permanently** — because
whatever survives will be built by it. What changes is its role, never its
presence.

Three consequences, and they are why this is worth the words:

1. **A brainstorm output must declare buildability, not only desirability.** Each
   surviving idea names the workflow or recipe that builds it, its tier, whose
   worktree it runs in, and the gates that would prove it. That turns a brainstorm
   from prose someone must re-derive into something the factory can consume.
2. **Factory-fit findings flow back as AWSF requirements.** When a Smart Health
   idea needs something AWSF cannot do — a cross-repo task, per-repo gate
   commands, a Python gate where `npm run test:unit` is assumed — that is not a
   blocker for the idea. It is a **derived AWSF requirement**, and it is how the
   registry work gets its requirements: from real projects hitting real walls
   rather than from speculation. This two-way channel does not exist today.
3. **It is why verdict D is load-bearing.** *"X exists and is shaped this way"*
   about a target repository needs a primary source, and for a repository the
   factory did not build, a verified `ARCHITECTURE.md` **is** that source. D and
   this rule reinforce each other: without D, every target-shape claim about a
   registered repository is `inferred`. The registry entry is also the natural
   home for the target source list, so a brainstorm's source manifest is largely
   derived rather than hand-assembled.

**Honest note on mechanizing it, per #18.** Roughly half is checkable: that every
claim row carries a `kind` and an `anchor`, that the vocabulary is closed, and
that a decision-bearing claim carries an upgrade line. Whether an anchor is
*honest* is not checkable by a test. The rule should therefore be adopted as a
convention with one mechanized half and that limitation written down, rather than
described as enforced.

It applies to this document as much as to whatever skill comes out of 2.3, and it
belongs in the skill rather than only in a session's memory, because it has to
travel to sessions that did not derive it.

##### 2.3.7 The rename: `planf3` → `plan-sota`

**Decided 2026-08-19: rename and extend.** One skill, renamed; `planf3` is not
kept alive alongside it. A second surface would drift, and 2.6's cheatsheet would
have to explain both.

**`planf3` is three separable strings, not one, and only one carries real risk.**
Measured 2026-08-19:

| String                               | Where it lives                                                                                                      | Kind                        | Risk if renamed                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| `planf3` — skill identity         | directory name, frontmatter, 19 in-skill mentions, 4 in the`orchestrate` skill                                    | a name                      | **none**                                                |
| `planf3-review v1` — block header | emitted at`SKILL.md:445`, parsed by `review-plan.md` Mode B, 4 doc mentions, plus a copy inside every plan HTML | **wire format**       | blocks exported*before* and applied *after* fail to parse |
| `planf3-review:` + filename        | `SKILL.md:315` — `var KEY = 'planf3-review:' + FILE`                                                           | **browser state key** | **orphans un-exported review state**                    |

**Blast radius: 16 plan HTML files carry the embedded review layer** — 8 live
(`awsf-plan.html`, `agentic-workflow-redesign-plan.html`,
`model-fusion-opus5-codex-pilot.html`, four Smart Health plans, the WezTerm plan)
and 8 disposable copies in the five `-verify-*` worktrees and three
`aw-worktrees` workers. Two checks came back clean: **no meta-test hashes or
byte-pins `awsf-plan.html`** (`doc-reconciliation` and `ticket-plan-sync` assert
on content, not identity), and **`planf3` appears nowhere in `core/src`** — so
this is not a code change.

**Both risks collapse to near-zero for about four lines of work:**

- **localStorage orphaning →** a three-line migration shim in the review layer:
  on load, if the new key is empty and the old key exists, copy it across.
  Self-healing, retroactive, no owner action.
- **Stale exported blocks →** one sentence in Mode B: accept
  `plan-sota-review v1` **or** the legacy `planf3-review v1` header, parsed
  identically. Kills the whole class, including blocks sitting in a clipboard or
  a forgotten scratch file.

With those two the rename costs roughly **45–60 minutes of mechanical work and
loses nothing**.

**The line, and it is the decision: rename everything that executes; leave
everything that testifies.** Two places keep the old name permanently:

1. **`core/test/fixtures/providers/claude/*.jsonl`** — four captured-byte
   fixtures whose `slash_commands`/`skills` arrays list `planf3` because that is
   what the CLI actually reported when the bytes were captured. Editing them
   falsifies a capture, straight against the fixture-first rule.
2. **`specs/awsf-architecture-proposal.md` (8 mentions), `awsf-plan.html` prose
   (3), `README.md` (1)** — these record what was done in August 2026 with a
   skill that was called `planf3`. Rewriting them makes the record lie, which is
   the same discipline as *"the `[f]` row stays as the historical record;
   closure comes via a new task and an Amendments entry, never by editing
   history."*

A full inventory to work from, measured 2026-08-19: skill directory + `SKILL.md`
(10 mentions), `workflows/create-plan.md` (4), `workflows/review-plan.md` (4),
`workflows/build-plan.md` (1); `orchestrate/SKILL.md` (4, including its
`description`); four memory files under `~/.claude/projects/*/memory/`, one of
whose own filename and `name:` slug is `planf3-prompts-dual-provider`.

##### 2.3.8 Three forks, all resolved 2026-08-19

1. **Where the design/review layer lives** → **both, at two altitudes**, split at
   "does a repository exist yet". Before one does, AWSF cannot run at all, so
   greenfield bootstrap is a *skill* in the owner's driving session; once a
   project is registered it is a *recipe* inside the factory. Same document
   shape, two execution homes. V.7 rule 1 holds because no gate ever depends on
   a skill having been read. See 2.3.5 Collision 4.
2. **`plan-sota` — rename-and-extend, or a new skill alongside?** →
   **rename and extend**, one skill. See 2.3.7 for the measured cost and the
   "rename what executes, leave what testifies" line.
3. **How far the ladder is automated in v2?** → **built as a governed AWSF
   workflow inside v2**, under the three conditions in 2.3.4. The manual
   codification is not skipped; it is that workstream's first task, because no
   envelope can be typed for a stage never captured.

**Still undecided in this section:** the claim-labelling rule proposed in 2.3.6.
It was written up as a recommendation and has not been taken or rejected.

### 2.4 Publish path (`awsf publish`)

**Decided 2026-08-19: `awsf publish` is in v2 scope, in Q10's narrow form.**

Raised by the "100% ready for production" goal. Explicitly Not Built currently
says *"any push implementation"*, and Q10 reserved a publish path for v1.1 in a
narrow post-`LANDED`, human-initiated form. That reservation is now taken up.
The cost Q10 named must be paid explicitly rather than absorbed: the sentence
*"any push implementation"* becomes *"no push path from any pre-`LANDED`
state"*, and its meta-test is rewritten from a **string scan into a state-aware
check**. A weaker meta-test than the one it replaces would be a net loss, so the
v2 task is not done when `publish` works — it is done when the new meta-test
refuses a pre-`LANDED` push. A project that is production-ready
but can never leave the local machine is a real tension. Q10's own analysis
stands: the cost is restating a mechanically-checked invariant as a state-aware
one, and it should be bought deliberately rather than as a side effect.

### 2.5 System prompt engineering — the driving layer and the AWSF agents

**Applied to the driving layer on 2026-08-19; the AWSF agent prompts are v2
scope.** This is the one candidate that pays off before the v2 plan exists.

**Sources declared** (per 2.3.6). **Target == factory**: AWSF's own prompt
surface and the owner's driving sessions — `source-verified` at
`prompts/*/system.md`, the `agents:` block of `awsf.config.yaml`,
`core/src/adapters/{claude-code,pi-codex}.ts`, `core/src/contracts/review-output.ts`.
**Reference**: `fixing_opus5_prompt_engineering_is_is_not_dead_IndyDevDan_youtube_transcript.txt`
(`transcript`), `../fixing-smartass-opus-5/` (`source-verified`), its eight
`images/*.svg` (`screenshot`). **Absent**: no before/after output-token
measurement of the owner's own runs — *not gathered*, not unavailable.
**Cheapest unused upgrade**: run one AWSF phase twice, with and without the
appended block, and read output tokens straight from the journal; AWSF already
records provider-authoritative usage per call, so this costs two calls and no
new tooling.

#### The problem, measured in this repository

The claim is not hypothetical and not about someone else's model. Measured
2026-08-19 over the 503 lines authored into `specs/awsf-v2-candidates.md` §2.3
in a single session:

| Pattern | Count |
|---|---|
| `load-bearing` | 4 |
| `worth stating plainly` | 1 |
| em dashes | 80 |

`core/src/adapters/pi-codex.ts:661` carries "Load-bearing on this route" in a
source comment. The tics are already in the committed artifacts.

#### What the reference ships

One 6KB markdown file appended with `--append-system-prompt-file`: a purpose
statement, four instruction sections — **Positive/Negative Patterns**,
**Reference Points**, **Hard Operational Boundaries**, **Aliases** — and worked
do/do-not example pairs the author calls in-context distillation. Append, never
replace: the harness keeps its own system prompt underneath.

**What only the diagrams said.** `images/01_verbal_tics_top_five.svg` names five
tics as *structural patterns*, two of which the shipped system prompt never
bans: **negative parallelism** (`"It's not X, it's Y"`) and
**`"You're absolutely right"`**. The transcript names neither as a pattern. The
reference's own diagram is ahead of the reference's own artifact, and reading
either source alone misses it. This is the back-and-forth of 2.3.6 earning its
keep on a live example.

#### Fit with AWSF — the mechanism is already built

`claude-code.ts:451` pushes `--append-system-prompt-file`; `pi-codex.ts:617`
pushes `--append-system-prompt`. Identical flags, identical append-not-replace
semantics, plus `writeSystemPromptFile` and `assertPrivateSystemPrompt`
materializing the composed prompt into `private/`. **No adapter change, no config
schema change, no new dependency.**

**But the benefit splits unevenly, and the split is the design.** AWSF worker
agents emit typed JSON envelopes — `ReviewOutputSchema` carries `findings[]` with
`id`, `title`, `detail`, `evidence`, plus `limitations[]`. The structural tics
(six headers, `## KEY TAKEAWAYS`, bold theater, decorative markdown) are
therefore **already impossible**: the schema prevents them, not a prompt. What
survives for workers:

1. **Prose inside envelope fields.** `Type.String({ minLength: 1 })`, no upper
   bound. Fully exposed.
2. **Output-token burn during reasoning**, which spends quota whatever the
   envelope looks like.
3. **The driving session**, where no envelope protection applies at all. This is
   where the owner reads every word and pays for every token, and where the fix
   lands at full strength.

**Two sections are interactive-only.** Aliases (`scr`, `eli`, `foc`, `ref`) are
useless to a headless worker because nobody is present to type them. Pasting all
four sections into all six worker prompts would be a mistake.

**One hazard, and it is specific.** Compressing the reviewer is dangerous: its
`detail` and `evidence` fields must stay specific enough to check, and a tersely
agreeable reviewer is exactly the rubber-stamped closure pillar 1 exists to
prevent. **The negative-pattern block must be scoped per role, never applied
uniformly.**

#### Three convergences with what AWSF already believes

- *"Do not claim completion without evidence"* is **pillar 4** restated. An
  outside engineer independently reached AWSF's own invariant.
- *"Never add a co-author to a commit message"* is **invariant 11**, already
  mechanically enforced, and agents cannot commit at all under pillar 5.
  Redundant for workers, useful for driving sessions.
- **Reference points (`D1`/`F1`/`R1`) are the same family as verdict C's
  `INV-n`/`AC-n`.** The review envelope already carries `findings[].id`. Adopting
  both yields one ID discipline spanning conversation and artifacts.

Also worth noting: *"deliver only what was requested at the intended scope"* is
already enforced structurally by `path-policy` and the per-agent `writes:`
allowlists. AWSF is stronger here than the prompt line; the line is belt and
braces.

#### A third `agy` limitation, measured 2026-08-19

`agy.exe --help` exposes **no system-prompt flag of any kind** — the full flag
list carries `--print`, `--prompt`, `--prompt-interactive`, `--agent`, `--model`,
`--effort`, `--mode`, `--sandbox`, `--add-dir`, and no `--system-prompt` or
`--append-system-prompt`. `agy.exe agents` returns empty and the subcommand only
*lists*; it cannot define one. **Antigravity cannot express a custom system
prompt at all**, which is independent of the two limitations already recorded in
2.1.1 and reinforces decision 14: special-purpose provider, not first-class.

#### What was applied now, and what is v2 scope

**Applied 2026-08-19, outside this repository:** an adapted contract at
`~/.claude/senior-engineer-system-prompt.md`, wired into the owner's `cc` and
`pi` shell aliases. It extends the reference with the two tics only its diagram
named, the phrases measured in this repository, and an `ev` alias demanding the
file, line, or command behind a claim. `ag` is left unchanged because it cannot
carry one.

**Trap recorded for the `pi` route:** `--append-system-prompt` decides between
text and file by `existsSync`, so a wrong path is appended as its **literal
string** with no error, and the session's system prompt silently becomes the
path. AWSF already defends this host-side via `assertPrivateSystemPrompt`
(`pi-codex.ts:662-668`); a hand-written shell alias has no such guard.

**v2 scope — the AWSF agent prompts.** Three paths were weighed:

| Path | Cost | Trade |
|---|---|---|
| Edit six `prompts/*/system.md` files | ~1 hr, zero code | Six copies of a shared block, guaranteed to drift |
| **One shared prompt file concatenated where `route.systemPrompt` is built** | ~2 hr, one small code change | No drift, one edit point. **Recommended** |
| Leave workers unchanged | 0 | Forfeits the token saving and the field-prose quality |

`route.systemPrompt` is composed before `infra.writeSystemPrompt`
(`production-run.ts:1061`, `review-phase.ts:700`), so a shared preamble has one
natural insertion point rather than six. The v2 task is not done when the block
is appended; it is done when **each role's scoping is stated** and the reviewer's
evidence fields are shown not to have degraded.

### 2.6 Non-technical cheatsheet guide

**Deliberately last.** A step-by-step `.md` covering every command and flow, for
a reader with no command-line, agent-driving, or AWSF experience — enabling them
to get full value from the factory by following it.

**Why it is sequenced after everything else:** it must reconcile against
`CLI_COMMANDS` in `core/src/cli/main.ts` and the `docs/driving/` skill tree, both
of which move when the planning phase lands. Writing it before the surface
settles means writing it twice. It is the closing deliverable of v2, not a
parallel one.

### 2.7 Quota telemetry — reading the window AWSF cannot price

**Numbered after 2.6 for identity, not for order.** 2.6 remains the closing
deliverable; this candidate is small and independent of the command surface.

**Sources declared** (per 2.3.6). **Target == factory**: AWSF's own cost surface
and process model — `source-verified` at `core/src/adapters/cost-display.ts`,
`dashboard/src/display.ts`, `core/src/execution/transport-broker.ts`,
`core/src/execution/call-budget.ts`, `core/src/policy/sandbox-broker.ts`.
**Reference**: `../quota-axi` at v0.1.29 (`source-verified`), plus
`captured-bytes` from nine invocations on this machine, success and failure paths
alike. **Absent**: macOS behaviour — *not gathered*, and not gatherable until the
M5 lands, because on darwin the Claude token moves to Keychain behind a
`--allow-keychain-prompt` consent gate (`quota-axi/src/providers/claude.ts:40`)
and the unattended path there is unproven. Also absent: a **rate-limited**
capture — *cannot be gathered on demand*, since it requires the provider to
actually throttle the usage endpoint. `retryAfter` and `status: "rate_limited"`
are declared in the published type (`quota-axi/src/types.ts:33,237`), so the
parser can be written against the contract, but the bytes are unconfirmed and
that is the one shape a first implementation should treat as unproven.

#### Today's limitation

`cost-display.ts:17` renders `SUBSCRIPTION_COST_DISPLAY = "— subscription"`, and
the reasoning above it is correct and stays: a subscription run's cost is a share
of a monthly fee, and `$0.00` would be a measured-looking zero. But the
consequence has never been stated. On the claude route AWSF reports **no
consumption signal of any kind** — not a wrong one, none. The unit that actually
binds a subscription is percent-of-window, and AWSF has never had it because it
was not observable.

#### It is observable, and it was measured here

`quota-axi` (MIT, published npm, v0.1.29) reads local credential stores and calls
first-party usage endpoints. Its charter is close enough to AWSF's to be worth
quoting: *"It reports, the caller decides"*, *"Absent data stays absent — it
never invents a window duration, a reset deadline, or a percentage"*, and
*"never runs anything that spends the quota being measured"*
(`quota-axi/VISION.md`). The middle one is `cost-display.ts:7-12` reached
independently by another engineer.

**Captured 2026-08-19, timestamps in UTC:**

| Provider          | Window      | Remaining | Resets               |
| ----------------- | ----------- | --------- | -------------------- |
| claude (`pro`)  | `five_hour` | 70%       | 2026-08-20T02:00Z    |
| claude (`pro`)  | `seven_day` | 95%       | 2026-08-26T11:00Z    |
| codex (`plus`)  | `weekly`    | 39%       | 2026-08-20T22:28:24Z |

Exactly the three figures the owner asked for. **Zero-cost is proven, not
assumed:** two consecutive codex reads both returned `percentUsed: 61` with
different `refreshedAt` stamps.

**Latency, measured over three runs each** — and this one changes the design:

| Invocation                 | Times                    |
| -------------------------- | ------------------------ |
| `--provider claude,codex`  | 1.35s / 1.24s / 1.41s    |
| `--provider claude`        | 0.80s / 1.33s / 0.40s    |
| `--provider codex`         | 1.58s / 1.51s / 1.58s    |

At ~1.3s for both providers the probe **cannot sit inline in the dashboard's
cursor poll**. It must be read on a cache with an age stamp, which is what
quota-axi's own `state.stale` and `state.refreshedAt` fields exist for. The codex
half is the slow one because that path spawns a CLI rather than calling an
endpoint.

#### The GPT number is real, and its coverage is conditional

This is the finding that would have been missed by reading the file layout.
`~/.codex/auth.json` does **not** exist on this machine — pi keeps its ChatGPT
token at `~/.pi/agent/auth.json` under key `openai-codex`, and quota-axi has
brokers for pi's `xai` and `kimi-coding` keys
(`providers/pi-xai-credential.ts:5`, `providers/pi-kimi-credential.ts:5`) but
**none for `openai-codex`**.

It reported the number anyway, via a fallback:
`attempts: [{oauth, skipped, credentials_missing}, {cli-rpc, success}]`. The
`codex` binary happens to be installed at `/snap/bin/codex`, and the RPC path
answered.

**The cross-check that proves it is the right account.** quota-axi's codex reset
is `2026-08-20T22:28:24Z`; pi's own `~/.pi/agent/quota-cache.json` carries
`resetAtEpochSeconds: 1787264904`, which is **the same instant**. Same ChatGPT
Plus weekly window. pi's cache also shows why it is not a substitute source: it
read 49% used and was 76 hours stale, against quota-axi's live 61%.

**So the coverage is real but undeclared, and it depends on the `codex` CLI being
installed rather than on pi.** A machine with pi and no codex binary reports
nothing for GPT. **This is a portability-matrix row**, and the cheapest fix is
upstream: a `pi-codex-credential.ts` broker following the two that already exist
in that repository.

#### Failure paths, captured 2026-08-19 — and one of them is a trap

The success capture alone would have produced a wrong renderer. Four shapes were
forced with environment overrides only, moving nothing on disk:
`CLAUDE_CONFIG_DIR` at an empty directory (`quota-axi/src/lib/fs.ts:57`),
`QUOTA_AXI_CODEX_BINARY` at a non-existent path (`providers/codex.ts:36`), and
`XDG_CACHE_HOME` at an empty directory (`lib/fs.ts:95`).

| Forced condition                       | `state.status` | `windows[]`      | `effectiveAvailability` | Exit       |
| -------------------------------------- | -------------- | ---------------- | ----------------------- | ---------- |
| claude, no credential                  | `auth_required` | empty            | empty                   | 1          |
| codex, no oauth and no binary          | `stale`        | **populated**    | `status: "unknown"`     | **0** |
| codex, no oauth, no binary, no cache   | `error`        | empty            | empty                   | 1          |
| both unavailable, default TOON         | —              | `quota[0]:`      | —                       | 1          |

**The trap is the second row.** With every live source failing, quota-axi serves
its own on-disk cache: `source: "cache"`, a fully populated
`weekly` window still reading `percentUsed: 61`, **and exit 0**. What protects
the reader is one level up — `quotaSemantics.status` goes `unknown`,
`effectivePercentRemaining` is withheld, and `runway`, `pace` and `selection`
each carry `unmeasurableWindowIds`. The raw window is deliberately preserved as
diagnostic data, and the tool says so in the payload: *"the raw quota windows are
stale diagnostic data, so effective remaining is unknown until the provider
refreshes successfully."*

**Two rules fall straight out, and both belong in the task:**

1. **Render from `quotaSemantics.effectiveAvailability`, never from
   `windows[]`.** A renderer wired to the raw window would have displayed a
   four-day-old 39% as a live figure, with no staleness anywhere on screen. This
   is `— subscription`'s own discipline in a new place: a stale number is a
   measured-looking figure where there is no current measurement.
2. **Exit code is not a status.** Stale returns 0 and auth-required returns 1, so
   detection is structural over `state.status`, exactly as decision #10 concluded
   for `agy`: *"a failed run still emits a well-formed terminal record… so
   `blocked` detection can be structural rather than exit-code guesswork."*

The degenerate TOON form is well-behaved and worth recording, because it is what
a driving session sees on a fresh machine: `quota[0]:` empty, every fact moved
into `attention[]` as `provider,scope,kind,detail,remedy`.

**No credential-shaped value appears in any failure capture**, so these four cut
directly into fixtures under invariant 9. The success captures do not: the codex
`--full` payload carries `account.email`, and it must be scrubbed before any of
it is committed.

#### Fit — no dependency, no `fetch`, no new machinery

**`core/src` makes zero outbound network calls today.** Measured 2026-08-19:
`node:http` appears only as a *server* (`api/server.ts:1`,
`cli/commands/operator.ts:3`), and there is no `fetch(` anywhere in `core/src`.

Spawning the probe keeps that true, because the child makes the call exactly as
`claude` and `pi` children already do. Both pieces are already built and already
fenced:

- `transport-broker.ts:169 resolveExecutable()` — PATH lookup, throws
  `ExecutableNotFound`
- `transport-broker.ts:212 runSystemCommand()` — argv array, `shell: false`,
  `timeoutMs`, bounded `maxBuffer`

That is **decision #8's `mf` shape verbatim**: resolve on `PATH`, report
`blocked` when absent. Invariants 3 and 4 are untouched and **D2 needs no
amendment**.

**The rejected alternative is the obvious one.** Importing `quota-axi` as a
library pulls `axi-sdk-js` and `@toon-format/toon` into the runtime import graph,
forcing a D2 amendment for a number that renders in a chip. Spawning costs one
subprocess and buys the whole thing for free.

#### Collisions with v1, each with its adaptation (per #18)

**Collision 1 — *"Quota-aware routing — the runner never picks a provider by
remaining allowance."*** Display is not routing, but nothing structural would
stop a later session from wiring the figure into the compiler.
**Adaptation, in #18's required form — a new mechanically-checked guarantee
rather than a weakened one:** an **import fence** barring `core/src/workflow/**`
and the routing resolver from importing the quota module, enforced by a meta-test
of the same shape as the state-purity fence (invariant 5). The number reaches the
dashboard, the CLI, and the journal, and reaches the runner nowhere. Worth
noting that the reference refuses to route from its own side: *"quota-axi is not
a router, not a proxy, not a gateway."*

**Collision 2 — *"Background monitors or watchdog daemons."*** A refreshing quota
panel is precisely that shape, and quota-axi ships `--refresh` and `--tui` which
would make it one. **Adaptation:** neither flag is ever used. One bounded
`--json` read on demand, cached with its age stamp, and a stale read renders as
stale rather than as a number.

**Collision 3 — *"every command below is credential-free and offline"***
(`awsf-plan.html:1468`, Validation). A live probe cannot enter the required
suites. **Adaptation:** fixture-first, which binds here regardless because a
parser is executable. Captured bytes become contract fixtures; the live run is a
portability-matrix row, never a gate.

**Collision 4 — credentials and the sandbox. The rule holds; the reason given for
it was wrong, and the correction matters more than the rule.**

An earlier pass of this section said the probe must be host-side because *"inside
a session `--unshare-all` would break it anyway."* **That was wrong on both
counts, and it is recorded rather than deleted because it would have made the
bound look self-enforcing when nothing enforces it.**

Checked 2026-08-19 against the descriptor and its test
(`sandbox-broker.ts:88-104`, `core/test/unit/policy/sandbox-broker.test.ts:75`),
which pins the argv exactly:

```
--die-with-parent --new-session --unshare-all --share-net --ro-bind / /
```

1. **`--share-net` immediately follows `--unshare-all`, so the network is
   shared.** The usage endpoint is reachable from inside the namespace.
2. **`--ro-bind / /` makes the whole host filesystem readable**, and the only
   mask is `--tmpfs` over the state root. `~/.claude/.credentials.json` is not
   under the state root, so **the credential is readable inside the namespace**.
   AWSF's own test says as much at line 58: *"`--ro-bind / /` makes the WHOLE
   host filesystem readable, and `writes: []` confines writes and confines reads
   not at all."*

**So the probe would run inside a session, not fail.** The adaptation is
unchanged and the argument for it is now the right one: **host-side only is an
exposure bound, not a feasibility one.** Running it in-session would place a
credential-reading, network-calling process inside an agent's reach, in a
namespace that already confines no reads. Nothing structural prevents it, so the
rule has to be stated and held deliberately.

**A third fact makes the point sharper.** `bwrap` is **not installed on this
WSL2 machine**, so `hostProbe("bwrap")` returns false, the badge degrades to
`tool-policy`, and `grantSandbox` returns the spec unwrapped
(`sandbox-broker.ts:148-154`). On the current development machine there is no OS
enforcement to lean on at all.

Invariant 9 concerns commits and is untouched, but the `--full` codex capture
carries `account.email`: success fixtures must be scrubbed, and the reference's
own charter requires the same.

#### Scope

|             | Option                                                             | Verdict                          |
| ----------- | ------------------------------------------------------------------ | -------------------------------- |
| **O1** | Quota chip in the dashboard plus a line in `awsf status`/`doctor` | **Take**                   |
| **O2** | A quota snapshot journalled at each phase boundary                 | **Take — the leverage**   |
| **O3** | Preflight admission check below a threshold                        | **Not taken; own decision** |
| **O4** | Driving-session use outside AWSF                                   | **Applied 2026-08-19**     |

**Why O2 is the leverage and O1 alone is not.** The call ledger enforces
`spent + reserved <= ceiling` in *calls*, and calls were chosen as the unit
because quota was unobservable (`call-budget.ts:9-13`). It is observable now.
Snapshotting the two windows at phase open and close lets the journal answer what
a task cost **as a share of the week** — the measurement `— subscription` exists
to admit it cannot make. It costs one field on a record that is already written.

**Why O3 stays out.** It is admission control rather than provider selection, so
it does not break the routing line, but it lets an unverifiable external number
gate a transition. The #21 precedent applies if it is ever built: a typed
snapshot and a deterministic host-side threshold. It earns its own decision and
must not ride in on this one.

**Do not overload `costAuthority`.** Dollars and window-percent are different
axes. A sibling `quota` block leaves `formatCost` untouched, along with the 18
assertions pinning it across `dashboard-display.test.ts`, `claude-code.test.ts`
and `pi-codex.test.ts`. `— subscription` keeps its present meaning and gains a
neighbour: `— subscription · 5h 70% · wk 95%`.

#### Applied 2026-08-19, outside this repository (O4)

`npm i -g quota-axi@0.1.29` (three packages, resolved to
`~/.nvm/versions/node/v22.23.1/bin/quota-axi`), and the reference's own
`skills/quota-axi/SKILL.md` copied verbatim to `~/.claude/skills/quota-axi/`.
Copied unmodified on purpose: it is upstream content, and `npx -y quota-axi`
resolves the global binary without a download (0.65s against 0.07s direct), so
the skill's own instructions work as written with no fork to maintain. No
statusline: a per-render network call is exactly the daemon shape Collision 2
refuses.

**Hazard observed during this work, with its cause explicitly NOT established.**
Twice on 2026-08-19, `@anthropic-ai/claude-code`'s native optional package
(`@anthropic-ai/claude-code-linux-x64`) went missing from the global tree and
`claude` refused to start with *"native binary not installed"*. Both times
`npm i -g @anthropic-ai/claude-code@2.1.236 --include=optional` restored it.

**A first pass blamed the `npm i -g quota-axi` install. That attribution is
unproven and probably wrong**, and it is corrected here rather than deleted
because acting on it would have descoped a harmless install. Two facts against
it: the failure **recurred with no global install in between**, and the machine
already carries two `claude-code.corrupt-20260814*` directories dated five days
before this session. A recurring cause independent of quota-axi — the background
auto-updater dropping the optional native package is the obvious candidate — fits
the evidence better. **Cheapest unused upgrade:** watch whether it recurs with no
`npm -g` activity at all, which separates the two hypotheses in a day of ordinary
use. Not done.

The practical guidance survives the correction, weaker and honestly labelled:
**prefer `npx -y quota-axi`, which touches no global tree**, and re-verify
`claude --version` after any global install. It also supports spawn-not-import
from an unexpected angle: a probe AWSF resolves on `PATH` can be delivered by
`npx` and need never enter a shared install.

#### Cheapest unused upgrades

- **Failure-path capture — done 2026-08-19**, four shapes, recorded above. It
  was the right call: it overturned the renderer design.
- **Sandbox confirmation — done 2026-08-19, and it overturned the reasoning.**
  A live `bwrap` run was impossible (`bwrap` is not installed here), so the
  descriptor and its pinning test were read instead. The probe would *succeed*
  in-session, not fail. See Collision 4. A live run remains worth taking on a
  machine that has `bwrap`, but the conclusion no longer depends on it.
- **Rate-limited bytes** — no cheap upgrade exists; it needs the provider to
  throttle. Write the parser against the published type and mark that branch
  unproven.
- **macOS** — nothing available until the hardware lands. The row is declared now
  so it is not discovered late.

---

## Decisions taken (2026-08-18 and 2026-08-19)

| #  | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | Repair`npm run typecheck`; amend D2 to admit `@types/node` as a devDependency; split the check into core (`tsc`) and dashboard (`vue-tsc`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2  | Close the seven deferred WSL2 matrix rows**before** the MacBook Pro arrives.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3  | No Linux desktop is owned; that column takes a dated deferral or`N/A`, not `PENDING`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4  | Append closeout work to the existing plan;**park** the v2 plan until the candidate set is concrete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5  | Fusion integrates as approach**(c)** — `mf` spawned as a declared-composite adapter whose events are parsed. `awsf raise` is rejected as the accounting mechanism.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6  | The factory must be able to build repositories other than its own; multi-project is the v2 plan's first Questionable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 7  | The non-technical cheatsheet is authored last, after the command surface stops moving.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 8  | `mf` resolves via `PATH` lookup with `E_ADAPTER_UNVERIFIED` when absent; a new portability-matrix row is added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 9  | AWSF's`path-policy` owns the write boundary for `mf`, not `mf`'s own permission policy — one policy owner, and it is the factory's. *(This row once continued "and is extended to express the multi-role ladder rather than exempting it"; that clause is **superseded by #17** — the boundary is reused unchanged, never extended.)*                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 10 | `agy` does expose `--output-format stream-json`; a success capture on 2026-08-18 confirms a four-event NDJSON protocol with stream-authoritative model identity and provider-authoritative usage. Q1 is closed favourably.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 11 | The antigravity blocker is**no longer parsing, and no longer authentication** (that claim was tested and retracted). What remains: `agy` exposes no tool allow/deny flag, and `--mode plan` steers rather than enforces, so AWSF's `readonly` profile is inexpressible for it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 12 | `agy` must be spawned with a **Windows-accessible working directory**; from a WSL-only path it fails with a misleading authentication error. A portability-matrix row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 13 | Antigravity is viable for**write-capable roles only**, bounded by worktree containment plus host-side stream inspection of `tool_info.parameters.TargetFile`. Readonly roles stay on claude and pi.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 14 | **Detection-only bounding meets the owner's bar for `agy`** (2026-08-19). It is deliberately a special-purpose provider for specific tasks, not a first-class one like claude or pi, and is not to be routed as though it were.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 15 | Multi-project takes the shape of a**project registry**, grounded on Smart Health Platform's three repositories. The plan repo may differ from the target repos, branches and gates are per repo, and cross-repo tasks are the v2 plan's second Questionable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 16 | **`awsf publish` is in v2**, in Q10's narrow post-`LANDED` human-initiated form, and the no-push meta-test is rewritten from a string scan into a state-aware check rather than deleted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 17 | `path-policy` is **not** extended for `mf`. Each constituent role gets its own managed worktree, and `mf`'s artifact directory is pointed at the attempt's existing `sessionRuntime`. The boundary is reused, never exempted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 18 | **v1 pillars, Explicitly Not Built lines, and `AGENTS.md` invariants are revisable in v2 where an idea earns it.** They are dated decisions with stated prices, not a constitution. Each revision must restate the guarantee in a still-mechanically-checkable form and name its cost, per the **#16 precedent** — where *"any push implementation"* narrows to *"no push path from any pre-`LANDED` state"* and the string-scan meta-test is **rewritten as a state-aware check rather than deleted**. A revision that leaves a guarantee unenforced, or unenforceable, is a net loss and is refused on that ground alone.                                                                                                                                                                                                                                                                                                                           |
| 19 | **Blueprint/Factory intake (2.3.3): verdicts A, B, C, D, E, F, G, H, I taken; J, K, L skipped.** Taken: a design stage that stops for review; an adversarial design review with a blocking verdict; `INV-n`/`AC-n` IDs threaded design → ticket → gate; `ARCHITECTURE.md` plus a docs index carrying lifecycle status; the requirements/technical-design split; explicit stopping points; a skill router; the cross-provider ladder; the `plan-sota` rename. Skipped: GitHub issues as a task sink, the `html-doc` skill (a downgrade — the plan skill authors HTML natively), and `task-to-pr`/`codex-issue-coordinator` (that is AWSF itself, and AWSF's version is stronger).                                                                                                                                                                                                                                                                          |
| 20 | **The design/review layer lives at two altitudes**, split at "does a repository exist yet": a driving-session **skill** before one does, an AWSF **recipe** after. V.7 rule 1 — no skill is ever in the execution path — holds because no gate depends on a skill having been read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 21 | **A design-review verdict is an envelope, never a transition.** `architecture-review` is a phase whose typed envelope carries `{ verdict, findings[], openQuestions[] }` with `severity` per element; the **gate** is a deterministic host-side count — zero `blocker` findings and zero `blocking` open questions — never a reading of prose. The host advances; the model supplies structured facts. No invariant text changes, and "earned success" is strengthened rather than weakened.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 22 | **The five-stage cross-provider ladder is built as a governed AWSF workflow inside v2**, not merely codified as a runbook, under three conditions: (a) **provider-agnostic**, routing declared in config, so `agy` and `mf` are preferred routes and not preconditions; (b) **sequenced last in v2**, after bootstrap and after verdicts A/B/C exist; (c) a **degradation rule stated up front** — a declared route never falls back at runtime, degradation is a *different declared workflow variant* the owner selects in advance. Greenfield's chicken-and-egg is fixed by **inverting the order**: `git init` + baseline commit + config scaffold first, then the ladder runs inside a real repository as ordinary governed phases.                                                                                                                                                                                                  |
| 23 | **`planf3` is renamed to `plan-sota` — rename and extend, one skill, no second surface.** The name splits into three strings and only the `localStorage` key risks data loss; both risks are erased by a three-line migration shim and a dual-header parser. **Rename everything that executes; leave everything that testifies** — the captured provider fixtures and the historical prose in `awsf-architecture-proposal.md`, `awsf-plan.html` and `README.md` keep the old name, because rewriting them would falsify the record. Measured cost: 45–60 minutes, nothing lost.                                                                                                                                                                                                                                                                                                                                                                      |
| 24 | **The claim-labelling rule (2.3.6) is taken.** Label every claim with its source kind and a citable anchor; record absent sources *with the reason* ("does not exist" and "not yet gathered" are different, and only the second is a gap); and for any claim carrying a decision, name the **cheapest unused upgrade** and whether it has been done. A decision may rest on a single weak source provided it says so and names what would settle it; what is forbidden is an unlabelled claim, or one whose cheapest upgrade was available and skipped. Strength is **per claim-type, not a single scalar**. Every brainstorm declares its sources in three roles — **target**, **factory** (always AWSF), **reference** — and where target and factory are the same repository, says so. Adopted with its limits stated per #18: label presence, closed vocabulary and upgrade lines are mechanically checkable; anchor honesty is not. |
| 25 | **System prompt engineering is taken (2.5), and split by altitude.** The **driving layer is done now** — an adapted contract at `~/.claude/senior-engineer-system-prompt.md`, wired into the `cc` and `pi` aliases via the same `--append-system-prompt[-file]` flags AWSF's own adapters already use. The **AWSF agent prompts are v2 scope**, built as **one shared prompt file concatenated where `route.systemPrompt` is composed**, not as six edited `prompts/*/system.md` copies that would drift. Typed envelopes already prevent the structural tics, so the worker benefit is narrower than the driving benefit and is confined to field prose and output-token cost. Scoping is **per role**: aliases are interactive-only, and the reviewer must not be compressed, because a tersely agreeable reviewer is the rubber-stamped closure pillar 1 exists to prevent. |
| 26 | **`agy` cannot express a custom system prompt at all** (measured 2026-08-19: no `--system-prompt` or `--append-system-prompt` anywhere in `agy.exe --help`; `agy.exe agents` returns empty and only lists). This is a **third** antigravity limitation, independent of the missing tool allow/deny flag and the Windows-accessible-cwd requirement in 2.1.1, and it further supports #14 — special-purpose provider, never first-class. |
| 27 | **Quota telemetry is taken as candidate 2.7, scoped to O1 + O2.** A quota chip in the dashboard and a line in `awsf status`/`doctor`, plus a snapshot journalled at each phase boundary so the call ledger's proxy unit gains a real denominator. `quota-axi` is **spawned as a PATH-resolved read-only probe** through the existing `resolveExecutable` / `runSystemCommand` (`transport-broker.ts:169,212`), exactly as #8 resolves `mf` — **never imported as a library**, which would pull two runtime dependencies and force a D2 amendment for a number that renders in a chip. Measured 2026-08-19 on this machine: claude `five_hour` 70% / `seven_day` 95%, codex `weekly` 39%, zero quota spent (two reads, identical `percentUsed`). At ~1.3s per read it is **cached with an age stamp, never called inline in the dashboard poll**. **O3 — a preflight admission check — is explicitly not taken** and earns its own decision under the #21 precedent rather than riding in on this one. **O4 was applied 2026-08-19** outside the repository: `quota-axi@0.1.29` installed globally and its own skill copied verbatim to `~/.claude/skills/quota-axi/`. |
| 28 | **2.7 renders from `quotaSemantics.effectiveAvailability`, never from `windows[]`, and detects state structurally rather than by exit code.** Established from captured failure bytes on 2026-08-19, not from the contract: with every live source failing, quota-axi serves its on-disk cache with a fully populated window still reading `percentUsed: 61` **and exits 0**, while withholding `effectivePercentRemaining` and marking `runway`, `pace` and `selection` `unmeasurable`. A renderer wired to the raw window would have shown a four-day-old figure as live — the same defect `— subscription` exists to prevent, in a new place. Stale exits 0 and auth-required exits 1, so status comes from `state.status`, per the #10 precedent that detection is structural rather than exit-code guesswork. The four captured failure shapes carry no credential-shaped value and cut directly into fixtures; the success captures carry `account.email` and must be scrubbed first. |
| 29 | **The guarantee 2.7 must add, in #18 form: an import fence.** `core/src/workflow/**` and the routing resolver may not import the quota module, enforced by a meta-test of the same shape as the state-purity fence (invariant 5). This is what keeps the figure a readout and prevents it becoming the *"quota-aware routing"* Explicitly Not Built removed. Three further bounds hold with no invariant text changing: the probe is **host-side only, and nothing structural enforces that** — checked 2026-08-19 against the pinned descriptor, `--share-net` follows `--unshare-all` and `--ro-bind / /` leaves `~/.claude/.credentials.json` readable, so an in-session probe would succeed rather than fail, which makes this an exposure bound to hold deliberately rather than a limit to rely on (and `bwrap` is absent on the WSL2 machine, so the badge is `tool-policy` and nothing is OS-enforced there at all); `--refresh` and `--tui` are **never used**, because a resident refresher is the daemon shape Explicitly Not Built also removed; and the parser is **fixture-first**, so the live read is a portability-matrix row and never enters the credential-free offline suites. |

## Still open

- Does `text_delta` stream incrementally? One longer-output probe settles it.
  (Not blocking: the terminal `result` record carries the full response either
  way, so a first implementation can ignore deltas.)
- **Cross-repo tasks:** may one task own worktrees in several repositories at
  once, or do tasks stay single-repo with a declared contract artifact linking
  them? The v2 plan's second Questionable — see 2.3's Smart Health grounding.
- How far does the registry reach into config loading, state roots, and
  worktree resolution?
- Does the per-role-worktree shape for `mf` hold up in practice? Recommended in
  2.2, not yet validated.
- **Does the appended system prompt measurably cut output tokens on an AWSF
  phase?** 2.5's cheapest unused upgrade: run one phase twice, with and without
  the block, and read provider-authoritative usage from the journal. Two calls,
  no new tooling. Worth doing before 2.5's negative-pattern list grows long.
- **What the ladder's per-stage envelopes actually look like.** Decision #22
  makes the first task of that workstream a capture pass — no envelope can be
  typed for a stage that has never been captured, and the fused proposal's
  `[ARCHITECT]`/`[BUILDER]` shape has been produced exactly once, by hand.
- **Does the GPT quota read survive a machine with `pi` but no `codex` CLI?**
  2.7 measured the number coming from quota-axi's `cli-rpc` fallback, because
  `~/.codex/auth.json` does not exist here and `/snap/bin/codex` does. Coverage
  therefore depends on a binary the owner does not otherwise need. A
  portability-matrix row, and the cheapest fix is upstream: an
  `openai-codex` credential broker alongside the `pi-xai` and `pi-kimi` ones
  that repository already ships.
- **Does the Claude quota read work unattended on macOS?** On darwin the token
  moves to Keychain behind a `--allow-keychain-prompt` consent gate. Not
  gatherable until the M5 arrives, and it belongs in the same visit as T27.
- Further ideas the owner is preparing (transcripts, screenshots, reference
  repositories) — to be gathered in a dedicated session before the v2 plan is
  authored.
