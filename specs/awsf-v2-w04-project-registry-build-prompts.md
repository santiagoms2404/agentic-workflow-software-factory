# Build Prompts — AWSF v2 W04, Project registry v1

Companion to [`awsf-v2-w04-project-registry.html`](./awsf-v2-w04-project-registry.html). Created 2026-08-21 alongside the plan and
[`tickets/awsf-v2-w04-project-registry/`](./tickets/awsf-v2-w04-project-registry/).

**These prompts write implementation code.** This is the deep plan for workstream W04, and these
twenty-one prompts build it, one task at a time.

Each prompt is **self-contained** and written for a **fresh session with no prior context**. Copy
one, paste it, let it run to completion, review what it produced, clear context, move to the next.

---

## Why there is no Section A

Six milestones hold twenty-one tasks, and every milestone-level instruction that would go in a
Section A prompt — the marker rule, the read-first set, the never-do list — is identical across all
twenty-one. Stating it once in **Conventions** below and once per prompt is enough. **Section B is
the whole file.**

---

## Before anything: three gates

1. **Owner approval of this deep plan — already given.** All eight Questionables are settled: the
   two inherited from the spine (Q-A, Q-B) were decided on 2026-08-21 and are recorded as applied
   constraints with their implementation and cost; **this plan's own six were decided by the owner
   on 2026-08-22, each on the recommended option**, via an exported `plan-sota-review v1` block.
   **A decided Questionable is a constraint, not an assignment** — apply it, do not re-litigate it.
2. **The AGENTS.md invariant 12 amendment has landed as an owner-authored commit.** Ordering gate
   **G2**. Its exact replacement text is written out in the plan's *Amendment Required Before the
   Build* section so the owner commits text rather than an intention. **Tasks 1–15 do not need it;
   task 16 refuses to proceed without it.** No agent may write `AGENTS.md` — `path-policy` rejects
   `protected-path` independently of the write globs, and inventing an owner-authorized
   protected-change mechanism to route around it is the boundary working.
3. **A second owner-authored commit adds `awsf.project.yaml` to `policy.protected_paths` in
   `awsf.config.yaml`** — Questionable Q1, decided 2026-08-22. **Its sequence is the reverse of
   gate G2's usual direction and that is deliberate:** `path-policy` matches a `protected_paths`
   glob against a *path* whether or not the file exists, so protecting the catalog would reject
   **creating** it — and **task 10 creates it**. This amendment therefore lands **after task 10 and
   before task 21**, which reads `awsf.config.yaml` and refuses to close the workstream without it.

---

## Decisions this plan already made — do not re-litigate these

| # | Decision | Status |
|---|---|---|
| D1 | **Two layers, and the split is forced by code.** `core/src/config/load.ts` refuses absolute machine paths outright, so a committed catalog physically cannot hold a clone location. | settled — spine W04 scope |
| D2 | **The state root is in neither layer.** One per machine, projects already namespaced inside it by `attemptDir`; `doctor`, `gc` and `db rebuild` each take one root and `discoverAttempts` already walks `projects/*`. | source-verified |
| D3 | **Each task and each landing stays single-repository.** `AttemptStatus` carries one repository and one worktree; a partial cross-repository landing has no rollback story. | settled — spine W04 scope |
| D4 | **The cross-repository contract is an immutable, content-addressed artifact committed in each child**, with the parent naming `{child repository, contract digest}`. | **spine Q1 — DECIDED 2026-08-21** |
| D5 | **The catalog stays narrow and versioned, records gate commands and does not resolve them, and takes on no config loading.** | **spine Q2 — DECIDED 2026-08-21** |
| D6 | **Worktree roots are per repository, not per project** — the measured project keeps one repository's worktrees on a different filesystem from another's. | measured 2026-08-21 |
| D7 | **The catalog inherits its absolute-path rejection rather than re-implementing it** — one function, shared with `loadConfig`. | derived in this plan — see Solution |
| D8 | **The catalog is a protected path.** `awsf.project.yaml` joins `policy.protected_paths`, so no worker phase can rewrite a project's gate commands or repository set. The contract projection `awsf.contracts.yaml` is deliberately **not** protected — a contract revision must be committable as ordinary work in every child. | **Q1 — DECIDED 2026-08-22** |
| D9 | **The catalog lives at the plan repository's root**, exactly one per project. A project with one repository carries `role: plan` on it. Moving the plan repository later is a manual migration this plan does not automate. | **Q2 — DECIDED 2026-08-22** |
| D10 | **A plan source declares its format; an unimplemented format is refused by name**, never parsed to zero tasks. Do **not** generalise the heading grammar. | **Q3 — DECIDED 2026-08-22** |
| D11 | **`TicketSchema`, `TicketStore` and `intakeRequest` are not modified.** The divergence from the sync fence's vocabulary is named as a gap and left. | **Q4 — DECIDED 2026-08-22** |
| D12 | **The catalog records only the three `KNOWN_GATE_IDS`.** Do not widen the vocabulary; the measured project's contract-drift check is subsumed by D4's local fence. | **Q5 — DECIDED 2026-08-22** |
| D13 | **Registration requires an explicit path per declared repository and probes nothing** — no filesystem search, no worktree enumeration, no `--force`. | **Q6 — DECIDED 2026-08-22** |

---

## Model selection

`EFFORT` is the session-level reasoning control (`/effort low|medium|high|xhigh|max`), calibrated to
the hardest judgement in the task. No prompt in this file fans out to sub-agents — every task is
small enough for one session. The four tasks carrying real design judgement (2, 6, 12, 16) and the
three induced-drift proofs (15, 17, 18) are the ones worth spending the better model on.

---

## Conventions used by every prompt

- **Read first**, always: `specs/awsf-v2-w04-project-registry.html` (the named milestone/task in full), `AGENTS.md` (all
  twelve invariants, invariant 12 in its **amended** form from task 16 onward), and whatever source
  files that task's own `READ FIRST` names.
- **Marker discipline — the positive and the negative, together.** Flip **this leaf plan's** own
  checklist items and milestone `<h3>` to `[wip]` on start and `[x]` on completion, in
  `specs/awsf-v2-w04-project-registry.html`, on **every** task including the first. Flip the matching
  `specs/tickets/awsf-v2-w04-project-registry/T<nn>.md`'s `state:` in the same commit. **Never** touch
  `specs/awsf-v2-plan.html`'s W04 marker — **task 21 is the only task that does.**
- **Never do**: write implementation code beyond what the task names; add a dependency outside the
  D2 allowlist (AGENTS.md invariant 7); add a new `node:child_process` import site (invariant 3);
  use `shell: true` (invariant 4); commit a runtime artifact, receipt or manifest (invariant 10);
  write `AGENTS.md` or `awsf.config.yaml` (protected paths).
- **One vocabulary landmine, and it is easy to trip.** `no-destructive-paths.test.ts` scans **file
  contents** across `core/src` — comments included — for nine patterns, two of which are phrases a
  registry and placement module naturally reaches for: `/git\s+push/` and
  `/worktree\s+(?:remove|prune)\b/`. Write "no upstream write path exists" and "reclaiming a
  worktree" instead, and invariant 8's fence stays green for the right reason.

---

# Section B — Task prompts (recommended)

Twenty-one prompts, one per task, in plan order — ticket number equals the plan's own task number
exactly. Tasks 1–5 are milestone M1, 6–8 are M2, 9–11 are M3, 12–15 are M4, 16–18 are M5, and 19–21
are M6. The ticket for each is `specs/tickets/awsf-v2-w04-project-registry/T<nn>.md`, carrying the same prompt verbatim.

### T01 — Extract the machine-path guard

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     a pure extraction against an existing test suite; the suite is the oracle, not judgement.

TASK 1 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M1.
PREDECESSORS: none. This is the first task.

READ FIRST
  core/src/config/load.ts - IN FULL, especially ABSOLUTE_PATH_PATTERN, isAbsoluteMachinePath,
    scanStrings and assertNoAbsolutePaths
  specs/awsf-v2-w04-project-registry.html - Milestone M1 task 1 in full, and the "What the
    inherited rejection does not cover" card in the same phase
  core/test/unit/config/ - every existing config loader test, so you know what must not move

DO
  Move isAbsoluteMachinePath, ABSOLUTE_PATH_PATTERN, scanStrings and assertNoAbsolutePaths into
  a new core/src/config/machine-path.ts, carrying the "durable intent" comment across intact.
  Make assertNoAbsolutePaths take the error constructor as a parameter so load.ts keeps throwing
  ConfigAbsolutePathError and its closed error hierarchy is untouched. Import them back into
  load.ts. The new module does pure string and path inspection: no filesystem, no clock, no
  node:child_process.

DO NOT
  Change any behaviour. Change any existing test. Widen the pattern. Add a catalog, a schema or
  a registry directory - task 2 starts that. If an existing config test needs an edit to pass,
  the extraction is wrong: revert and redo it.

DEFINITION OF DONE
  The plan's task 1 checklist, every box.
  Flip task 1's checklist boxes and milestone M1 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T01.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  Every existing config/load test passes UNMODIFIED - that is the proof, not inspection.
```

### T02 — The awsf.project/v1 catalog schema

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     a closed vocabulary that freezes here; each member has to be justified against a real project.

TASK 2 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M1.
PREDECESSORS: T01 is [x] and core/src/config/machine-path.ts exists.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M1 task 2 IN FULL, the Solution section,
    and "What Was Measured" IN FULL - the role vocabulary and the mixed-branch, no-remote and
    three-way-name findings are what the schema is sized against
  core/src/config/schema.ts - GateEntrySchema, KNOWN_GATE_IDS, and the slug pattern
  core/src/contracts/ticket.ts - the one-TypeBox-definition convention this must follow

DO
  Write core/src/registry/catalog-schema.ts as a single TypeBox definition that is the
  validator's shape, the static type, and the emittable JSON Schema. Required literal
  version: "awsf.project/v1". project.slug held to the schema's EXISTING slug pattern, imported
  not restated. repositories keyed by explicit id, each with role, default_branch, optional
  identity.root_commit, optional gates, optional delivery. role is the closed five-member union
  plan | service | application | library | source. gates reuses GateEntrySchema's exact shape
  (argv minItems 1, timeout_seconds), keyed by an id from KNOWN_GATE_IDS, both imported. delivery
  records posture only: service | mobile | docs | none. plans: root, format (closed union, ONE
  member in v1), optional default. contracts: id, sha256 digest, one producer and one or more
  consumers, each {repository, path}. additionalProperties: false at every level.

DO NOT
  Add a remote, endpoint, URL or credential field anywhere - W08 owns delivery policy and its
  own invariant 8 amendment. Add any field a state root, clone location or worktree root could
  be written into. Extend AwsfConfigSchema. Write the loader - that is task 3.

DEFINITION OF DONE
  The plan's task 2 checklist, every box.
  Flip task 2's checklist boxes and milestone M1 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T02.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  A reviewer can point at each of the five role members and name the measured repository it exists for.
```

### T03 — The catalog loader and its closed error hierarchy

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT high
  CLAUDE  claude:sonnet · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     the rejection ORDER is load-bearing and the reuse must be the same function, not a lookalike.

TASK 3 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M1.
PREDECESSORS: T02 is [x] and core/src/registry/catalog-schema.ts exists.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M1 task 3 in full
  core/src/config/load.ts - IN FULL: the error-class hierarchy and loadConfig's fixed rejection order
  core/src/policy/path-policy.ts - normalizeRepositoryPath
  core/src/policy/redaction.ts - containsCredential

DO
  Write core/src/registry/catalog.ts exporting loadCatalog(yamlText): ProjectCatalog, with a
  closed error hierarchy in load.ts's shape - one base class carrying `code`, one subclass per
  rejection, so tests assert on code rather than message text. Reject in this order: TypeBox
  structure, unknown version, absolute machine path, escaping repository-relative path,
  credential-shaped value, unknown gate id, plan-role cardinality, contract reference integrity.
  The absolute-path rejection calls the EXTRACTED assertNoAbsolutePaths from task 1 - the same
  function, over keys and values alike. Repository-relative paths go through the EXISTING
  normalizeRepositoryPath. Exactly one repository may carry role: plan; zero or several is a
  rejection. Every contract producer and consumer must name a declared repository.

DO NOT
  Re-implement the absolute-path check. Write a second path normaliser. Make loadCatalog call
  loadConfig or read AwsfConfig. Touch awsf.config.yaml or AGENTS.md - both are protected paths.

DEFINITION OF DONE
  The plan's task 3 checklist, every box.
  Flip task 3's checklist boxes and milestone M1 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T03.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  loadCatalog shares ONE absolute-path implementation with loadConfig - grep proves there is no second copy.
```

### T04 — The awsf.placement/v1 schema, loader and inverse rule

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     the mirror-image rule is small; getting additionalProperties right is what makes it a fence.

TASK 4 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M1.
PREDECESSORS: T01 is [x]. This task does NOT depend on T02 or T03 - it shares only the extracted guard.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M1 task 4 in full, and the
    "Per-repository worktree roots" subsection of Solution
  core/src/persistence/platform-paths.ts - the pure-path-arithmetic convention
  core/src/persistence/ticket-store.ts - TicketStore.write's temp-file-then-rename pattern

DO
  Write core/src/registry/placement-schema.ts and core/src/registry/placement.ts. Schema:
  required literal version "awsf.placement/v1", project (the join key), repositories keyed by the
  catalog's id with path and optional worktree_root, plus an optional project-level worktree_root.
  EVERY path field is REQUIRED to be absolute - loadPlacement throws PlacementRelativePathError
  otherwise, the exact inverse of the catalog's rule. additionalProperties: false everywhere.
  readPlacement(stateRoot, slug) / writePlacement(stateRoot, slug, doc) resolve
  <state-root>/projects/<slug>/placement.yaml, writing through a temp file and a rename.

DO NOT
  Add role, default_branch, gates, delivery, plans, contracts or any durable-identity field.
  Add a state_root field or any field one could be written into. Import resolveStateRoot - the
  state root arrives as a parameter, as it does everywhere else.

DEFINITION OF DONE
  The plan's task 4 checklist, every box.
  Flip task 4's checklist boxes and milestone M1 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T04.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  A placement document carrying default_branch or role is REJECTED by the schema, not ignored.
```

### T05 — M1 testing: both rejections, and the disjointness fence

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT high
  CLAUDE  claude:sonnet · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     one assertion here - the key-not-value case - is the whole reason the inherited guard is worth inheriting.

TASK 5 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M1.
PREDECESSORS: T03 and T04 are both [x].

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M1 task 5 in full, and the phase's
    "What the inherited rejection does not cover" card
  specs/awsf-v2-w04-project-registry.html - "What Was Measured" - the fixtures come from there
  core/src/config/load.ts - scanStrings, to see WHY the key case matters

DO
  Write core/test/unit/registry/catalog.test.ts, core/test/unit/registry/placement.test.ts and
  core/test/unit/meta/layer-separation.test.ts. Build fixtures from the MEASURED shapes: five
  repositories, mixed default branches, one repository with no identity signal, a per-repository
  worktree root. Catalog tests: a valid five-repository catalog loads; POSIX absolute, Windows
  drive-letter, UNC and ~ paths each throw CatalogAbsolutePathError, AND ONE OF THE FOUR IS PLACED
  IN AN OBJECT KEY RATHER THAN A VALUE; a `..` segment rejected; zero and two role: plan rejected;
  unknown version rejected; unknown gate id rejected; a contract naming an undeclared repository
  rejected. Placement tests: relative rejected, absolute loads, a document carrying default_branch
  or role rejected by additionalProperties. layer-separation.test.ts walks BOTH emitted JSON
  Schemas and asserts their property-name sets intersect in EXACTLY the join key, and that neither
  holds a property matching a state-root or clone-path name pattern.

DO NOT
  Assert on message text - assert on `code`. Weaken a rejection to make a test pass. Leave any
  temp directory behind (AGENTS.md invariant 10).

DEFINITION OF DONE
  The plan's task 5 checklist, every box.
  Flip task 5's checklist boxes and milestone M1 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T05.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  node --experimental-strip-types --test core/test/unit/registry/catalog.test.ts - green
  node --experimental-strip-types --test core/test/unit/registry/placement.test.ts - green
  node --experimental-strip-types --test core/test/unit/meta/layer-separation.test.ts - green
  npm run typecheck && npm run lint - clean
```

### T06 — resolveProject and its four rejections

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     the join is the only place identity and location meet; every mismatch must be named here or nowhere.

TASK 6 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M2.
PREDECESSORS: M1 is [x] - both schemas load and the disjointness fence is green.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M2 task 6 in full, the Solution diagram,
    and the phase's "What the join does not cover" card
  core/src/cli/commands/start.ts - defaultWorktreeRoot
  core/src/gates/commands.ts - ConfiguredCommand and commandsPass, the resolver this must feed unchanged
  core/src/git/ - systemGitRunner / runGit, the ONLY route to a git invocation (AGENTS.md invariant 3)

DO
  Write core/src/registry/resolve.ts exporting resolveProject(catalog, placement, stateRoot):
  ResolvedProject. Four named rejections: ProjectSlugMismatchError, UnplacedRepositoryError (name
  the missing id and the command that adds it), OrphanPlacementError, RepositoryIdentityMismatchError
  (only where the catalog declares identity.root_commit; read the root commit through
  systemGitRunner/runGit). Resolve every worktree root through per-repository override, then project
  default, then defaultWorktreeRoot(stateRoot), and RETURN the resolved value per repository so no
  caller recomputes it. Expose gatesFor(repositoryId) returning ConfiguredCommand-shaped records
  commandsPass consumes UNCHANGED.

DO NOT
  Add a new node:child_process import site. Degrade instead of rejecting. Make identity
  verification mandatory - two of the measured project's repositories have no remote and any
  project may decline the field. Write the CLI - that is task 9. Write the words "git push" or
  "worktree remove"/"worktree prune" anywhere under core/src, in code OR in a comment: the
  invariant 8 scan reads file contents and will go red.

DEFINITION OF DONE
  The plan's task 6 checklist, every box.
  Flip task 6's checklist boxes and milestone M2 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T06.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  gatesFor's return value is handed to commandsPass with no adaptation - the catalog RECORDS, it does not RESOLVE.
```

### T07 — Placement's home in the state root, and the fence that keeps the root out of both layers

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     the containment argument becomes a test so a later schema change cannot re-open it by accident.

TASK 7 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M2.
PREDECESSORS: T06 is [x].

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M2 task 7 in full, and the Solution
    section's "The state root is in neither layer" subsection
  core/src/persistence/platform-paths.ts - IN FULL
  core/src/observability/rebuild.ts - discoverAttempts, and its isDirectory filter
  core/src/cli/commands/operator.ts and core/src/cli/commands/doctor.ts - each takes ONE stateRoot

DO
  Add placementFilePath(stateRoot, slug) to platform-paths.ts beside attemptDir - pure path
  arithmetic, no filesystem. Then write the tests that make the containment argument mechanical:
  discoverAttempts is unaffected by a placement.yaml sitting beside a project's tasks/ directory
  (it filters to directories - prove it, do not assume it); doctorCommand, gcCommand and
  rebuildCommand each still take exactly one state root and no registry module offers a
  per-project one; no registry module imports resolveStateRoot.

DO NOT
  Give any command a second state root. Namespace the state root per project. Import
  resolveStateRoot from a registry module.

DEFINITION OF DONE
  The plan's task 7 checklist, every box.
  Flip task 7's checklist boxes and milestone M2 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T07.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  A test would go RED if a future schema added a per-project state root to either layer.
```

### T08 — M2 testing: the join against real temporary repositories

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT high
  CLAUDE  claude:sonnet · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     the join's failures are documents disagreeing on disk; an in-memory fixture would not exercise the reader.

TASK 8 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M2.
PREDECESSORS: T07 is [x].

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M2 task 8 in full and the phase's
    "What the join does not cover" card
  core/test/unit/cli/init-command.test.ts - the temp-directory git fixture pattern to copy

DO
  Write core/test/unit/registry/resolve.test.ts. A catalog and placement pair resolving cleanly
  across five repositories. Each of the four rejections induced deliberately and asserted by
  `code`. The identity check exercised against a REAL temporary git repository whose root commit is
  read back, with the mismatch induced by pointing placement at a second repository, AND the case
  of a repository declaring no identity signal asserted to resolve without complaint. Worktree-root
  resolution asserted at all three fallback levels including the per-repository override.

DO NOT
  Skip the no-identity-signal case - it is the common case for two of the measured project's
  repositories. Leave any temp directory behind.

DEFINITION OF DONE
  The plan's task 8 checklist, every box.
  Flip task 8's checklist boxes and milestone M2 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T08.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  node --experimental-strip-types --test core/test/unit/registry/resolve.test.ts - green
  npm run test:unit - green, no count regression
```

### T09 — awsf project register | list | show

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     host-only and deterministic, in awsf init's shape; the refusals are the design.

TASK 9 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M3.
PREDECESSORS: M2 is [x] - the join resolves and its rejections are proven.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M3 task 9 in full, and Questionable Q6
  core/src/cli/commands/init.ts and core/src/cli/main.ts - how init is wired AHEAD of the generic
    configPath/loadConfig section, and why
  core/test/unit/meta/init-no-provider.test.ts - the import-graph fence to copy in task 11

DO
  Write core/src/cli/commands/project.ts with register, list and show. register --catalog <path>
  --repository <id>=<path> ... loads and validates the catalog, requires an explicit path for EVERY
  declared repository, resolves the pair, and only then writes placement - a failed resolution
  writes nothing. list reads <state-root>/projects/*/placement.yaml and reports slug, repository
  count and whether each resolves. show <slug> reports the resolved record per repository. Wire
  "project" into the frozen CLI_COMMANDS array and USAGE, ahead of the generic configPath section.
  Add one documented invocation to README.md.

DO NOT
  Probe the filesystem for clones or enumerate worktrees to guess a root - per Q6, a placement
  value nobody stated is one nobody can be held to. Add --force. Silently overwrite an existing
  registration - refuse it. Import anything under core/src/adapters/.

DEFINITION OF DONE
  The plan's task 9 checklist, every box.
  Flip task 9's checklist boxes and milestone M3 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T09.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  A failed resolution leaves NO placement file behind - proven in task 11, not assumed here.
```

### T10 — Author AWSF's own catalog - the degenerate case, on purpose

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     one repository whose role is both plan and code; it is what M5's self-placement rule resolves against.

TASK 10 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M3.
PREDECESSORS: T09 is [x] and awsf project register runs.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M3 task 10 in full
  awsf.config.yaml - project.slug, and the three gates as they are actually invoked
  package.json - what npm run test:unit, typecheck and lint really run, so the argv arrays are true

DO
  Write awsf.project.yaml at this repository's root: slug matching awsf.config.yaml's
  project.slug, ONE repository with role: plan, its real default branch, and its three gates as
  argv ARRAYS matching what the npm scripts actually invoke. plans.root: specs, plans.format set to
  v1's single member, plans.default: awsf-plan - that last field is what preserves today's
  argument-free `awsf ticket list` behaviour in task 19. NO contracts entry, and say in a comment
  that the absence is deliberate because this project has one repository.
  THEN TELL THE OWNER THIS TASK IS DONE. It is the trigger for the second owner amendment:
  Questionable Q1 was decided on 2026-08-22 in favour of protecting the catalog, and path-policy
  matches a protected_paths glob against a PATH whether or not the file exists - so the
  protected_paths commit can only land AFTER this file exists. Task 21 refuses to close the
  workstream until it has.

DO NOT
  Invent a gate argv that does not match what the npm script runs. Add a contracts entry. Edit
  awsf.config.yaml - it is a protected path, and adding awsf.project.yaml to policy.protected_paths
  is the OWNER's commit, not yours. Wait for that amendment before writing this file - the ordering
  runs the other way and this task must complete first.

DEFINITION OF DONE
  The plan's task 10 checklist, every box.
  Flip task 10's checklist boxes and milestone M3 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T10.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  awsf.project.yaml loads through loadCatalog in a test, and its slug equals awsf.config.yaml's.
```

### T11 — M3 testing: the command, the fence, and the committed catalog

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     the round-trip proof on a real committed file, in the shape W03 used for its minimal config.

TASK 11 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M3.
PREDECESSORS: T10 is [x] and awsf.project.yaml exists.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M3 task 11 in full
  core/test/unit/meta/init-no-provider.test.ts - the import-graph fence to copy
  core/test/unit/meta/doc-reconciliation.test.ts - the documentation fence

DO
  Write core/test/unit/cli/project-command.test.ts: register into a temporary state root, then
  list and show read it back; a resolution failure leaves NO placement file; a second registration
  against the same slug is refused AND the existing placement file is proven byte-unchanged. Add an
  import-graph fence asserting nothing under core/src/adapters/ is reachable from project.ts. Add a
  test that loads this repository's own committed awsf.project.yaml through loadCatalog and asserts
  its slug equals awsf.config.yaml's.

DO NOT
  Assert the byte-unchanged claim by re-reading the document object - read the FILE bytes.

DEFINITION OF DONE
  The plan's task 11 checklist, every box.
  Flip task 11's checklist boxes and milestone M3 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T11.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  node --experimental-strip-types --test core/test/unit/cli/project-command.test.ts - green
  node --experimental-strip-types --test core/test/unit/meta/doc-reconciliation.test.ts - green
  npm run test:unit && npm run typecheck && npm run lint - all clean
```

### T12 — The parent contract record and its projection into each child

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     Q1 is DECIDED; this task implements the shape it forces, and the projection is forced, not chosen.

TASK 12 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M4.
PREDECESSORS: M3 is [x] - a project registers, resolves and lists.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M4 task 12 in full, Questionable Q-A
    IN FULL, and "What Was Measured" - the real contract pair the shape was designed against
  specs/awsf-v2-plan.html - Questionable Q1 IN FULL - it is DECIDED and is a constraint
  core/src/policy/path-policy.ts - normalizeRepositoryPath

DO
  Add the contracts list to the catalog (it is already in task 2's schema) and write
  awsf.contracts/v1: a repository-root document listing, per contract the repository participates
  in, {id, role: produces|consumes, path, digest} and NOTHING ELSE. The digest format is "sha256:"
  plus 64 lowercase hex, validated by the SAME schema fragment in the catalog and in the projection
  - a format that differs between them is a drift the fence cannot see. path is repository-relative
  and rejects a `..` segment via normalizeRepositoryPath.

DO NOT
  Add awsf.contracts.yaml to policy.protected_paths - a contract revision must be committable as
  ordinary work, and Q1 accepted a coordinated commit in every child as the price. Give the
  projection any field the parent record has that the child does not need. Re-litigate Q1.

DEFINITION OF DONE
  The plan's task 12 checklist, every box.
  Flip task 12's checklist boxes and milestone M4 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T12.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  The digest format has ONE schema fragment, used in both documents - grep proves there is no second.
```

### T13 — The local fence - a gate that reads only inside one worktree

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT high
  CLAUDE  claude:sonnet · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     the signature IS the boundary claim; a reader must be able to check it by reading the function.

TASK 13 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M4.
PREDECESSORS: T12 is [x]. This task does NOT depend on T14 - they share only the digest record.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M4 task 13 in full, the phase diagram,
    and the phase's "What the digest fence does not cover" card
  core/src/gates/interface.ts and one existing structural gate - the GateReport shape
  core/src/policy/path-policy.ts - the worktree boundary this must NOT reach across

DO
  Write core/src/gates/contract-digest.ts returning a GateReport with one check per contract
  entry. It takes ONE repository root and reads <root>/awsf.contracts.yaml plus the paths that file
  names. It accepts NO catalog, NO placement, NO state root and NO second root. A missing
  awsf.contracts.yaml is a PASS WITH NO CHECKS, not a failure. A named artifact that is absent, or
  present and hashing differently, is a failed check naming the contract id, the path, the expected
  digest and the observed one. Hash with node:crypto over the RAW BYTES - no normalisation, no
  re-serialisation, no encoding assumption.

DO NOT
  Add a parameter that could carry a second root. Read the catalog. Normalise, pretty-print or
  re-serialise before hashing. Make a missing projection a failure - most repositories participate
  in no contract and that would make the mechanism unadoptable.

DEFINITION OF DONE
  The plan's task 13 checklist, every box.
  Flip task 13's checklist boxes and milestone M4 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T13.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  The function's SIGNATURE makes the single-root claim checkable without reading its body.
```

### T14 — The central reconciliation - awsf project verify

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT high
  CLAUDE  claude:sonnet · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     three failure modes must stay distinguishable, because collapsing them hides which copy moved.

TASK 14 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M4.
PREDECESSORS: T12 is [x]. This task does NOT depend on T13.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M4 task 14 in full and the phase diagram
  core/src/registry/resolve.ts - ResolvedProject, from task 6

DO
  Add verify to core/src/cli/commands/project.ts. Over a ResolvedProject: for every contract,
  for every participant, assert the participant's projection carries that contract with the
  catalog's digest, and that the artifact at the declared path hashes to it. Report THREE DISTINCT
  failures separately - projection MISSING the contract, projection DISAGREEING with the parent,
  artifact DISAGREEING with the projection. Non-zero exit on any failure, and name EVERY failing
  pair rather than stopping at the first: a half-landed contract revision fails in several places
  at once and the operator needs the set. Put a header comment on the function contrasting its
  cross-repository reach with task 13's single-root signature.

DO NOT
  Collapse the three failures into one message. Stop at the first failure. Reuse task 13's gate
  function by widening its signature - the asymmetry between the two IS the design.

DEFINITION OF DONE
  The plan's task 14 checklist, every box.
  Flip task 14's checklist boxes and milestone M4 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T14.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  A reader can tell from the report WHICH of the N+1 copies moved.
```

### T15 — M4 testing: the digest fence proven to bite, three ways

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     a fence nobody has watched fail is decoration, and this one guards N committed copies.

TASK 15 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M4.
PREDECESSORS: T13 and T14 are both [x].

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M4 task 15 in full and the phase's
    "What the digest fence does not cover" card
  core/test/unit/cli/init-command.test.ts - the temp git repository fixture pattern

DO
  Write core/test/unit/registry/contracts.test.ts. Build a TWO-REPOSITORY temporary fixture with
  a JSON contract committed in both, a catalog naming one digest, and a projection in each: prove
  awsf project verify green and both local fences green. Then prove it bites, THREE WAYS, reverting
  between each: (1) mutate ONE BYTE of the consumer's artifact - the consumer's local fence goes red
  AND verify goes red; (2) change only the consumer's projection digest - verify goes red while the
  producer's local fence stays GREEN; (3) change only the catalog's digest - verify goes red against
  BOTH participants. Assert each failure is the DISTINCT one task 14 names. Also: run the local
  fence in a fixture whose SIBLING directory holds a contradicting artifact and assert the verdict
  is unaffected by it. And a repository with no awsf.contracts.yaml passes with ZERO checks
  recorded, not a skipped or errored gate.

DO NOT
  Assert only that something failed - assert WHICH failure. Skip the sibling-directory case; it
  is the only test that proves the single-root claim empirically. Leave any temp repository behind.

DEFINITION OF DONE
  The plan's task 15 checklist, every box.
  Flip task 15's checklist boxes and milestone M4 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T15.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  node --experimental-strip-types --test core/test/unit/registry/contracts.test.ts - green
  All three drift modes have been SEEN to go red, each distinguished.
```

### T16 — Plan-source resolution, the declared format, and self-placement

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT xhigh
  CLAUDE  claude:opus · /effort xhigh
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     self-placement is what keeps invariant 12's fence hermetic in a fresh clone; getting it wrong makes the invariant unenforceable.

TASK 16 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M5.
PREDECESSORS: M4 is [x]. AND: the owner-authored AGENTS.md invariant 12 amendment has LANDED (ordering gate G2). If it has not, STOP and say so - do not proceed and do not edit AGENTS.md yourself; it is a protected path.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M5 task 16 IN FULL, the "Amendment
    Required Before the Build" section IN FULL, Questionable Q3, and the Solution section's two
    cards on the redefinition's second half and on hermeticity
  AGENTS.md - invariant 12, in its AMENDED form
  core/test/unit/meta/ticket-plan-sync.test.ts - IN FULL, especially planSets() and planTasks()

DO
  Write core/src/registry/plan-source.ts exporting resolvePlanSources(catalogPath, catalog,
  placement?) returning one record per plan stem: {project, repositoryId, planPath, promptsPath,
  ticketsPath, format}. SELF-PLACEMENT: when the catalog file sits inside the repository its own
  role: plan entry names, the plan repository resolves to THAT CHECKOUT and placement is NOT
  consulted - assert this directly, do not leave it as a consequence. A foreign plan source
  resolves only where placement locates it; its absence yields NO record and NO failure. Check
  plans.format against the formats implemented in code and throw UnsupportedPlanFormatError naming
  the format and the plan - NEVER a parse that yields zero tasks. Move the grammar for v1's one
  format out of the test file into this module as a named exported parser.

DO NOT
  Edit AGENTS.md - it is a protected path and the amendment is an owner act. Generalise the
  heading grammar to accept both Milestone and Phase - Q3 refused that, and a silently
  half-matching grammar is the vacuous pass the declaration exists to prevent. Make placement
  required for the self-placed case; the fence must run in a fresh clone with no registry state.

DEFINITION OF DONE
  The plan's task 16 checklist, every box.
  Flip task 16's checklist boxes and milestone M5 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T16.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  The fence can still run offline in a clone that has never registered anything.
```

### T17 — The sync fence, resolving through the registry rather than adjacency

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     changes how a set is FOUND, never what is asserted about it; the diff must show exactly that.

TASK 17 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M5.
PREDECESSORS: T16 is [x] and resolvePlanSources exists.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M5 task 17 in full and the phase diagram
  core/test/unit/meta/ticket-plan-sync.test.ts - IN FULL, every assertion
  AGENTS.md - invariant 12 in its amended form

DO
  Rebuild planSets() on resolvePlanSources. DELETE the hardcoded specs/tickets/<stem>/ ->
  specs/<stem>.html and specs/v2/<stem>.html candidate list - do not extend it. Every existing
  assertion - coverage, milestone grouping, state against marker and checklist, byte-identical
  prompts, depends_on ordering, frontmatter vocabularies - runs UNCHANGED over the resolved sets.
  Preserve and re-express the hard-failure-on-orphan rule: a ticket set inside a resolved plan
  source's tickets root whose plan does not exist fails loudly, naming the PLAN SOURCE rather than
  a directory. Rewrite the file's header comment to describe registry resolution, the
  self-placement rule and the format refusal - the existing comment explains adjacency and would
  otherwise become the most misleading text in the file. LEAVE the flat-set special case for
  awsf-plan in place: task 20 removes it, so this task's diff is resolution-only.

DO NOT
  Change what any assertion checks. Relax the orphan rule. Remove the flat-set special case here
  - that belongs with the move, so the two diffs stay separable.

DEFINITION OF DONE
  The plan's task 17 checklist, every box.
  Flip task 17's checklist boxes and milestone M5 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T17.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  npm run test:unit is green over this repository's real tree with NO change to any ticket or plan file.
```

### T18 — M5 testing: the redefinition proven to bite across a repository boundary

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Opus 5 · EFFORT high
  CLAUDE  claude:opus · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     the drift that matters is the one adjacency could never have seen.

TASK 18 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M5.
PREDECESSORS: T17 is [x].

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M5 task 18 in full and the phase's
    "What the redefined fence does not cover" card
  specs/awsf-v2-w04-project-registry.html - "What Was Measured", the plan-grammar row

DO
  Write core/test/unit/registry/plan-source.test.ts. Build a temporary FOREIGN plan repository
  holding a plan, its build prompts and a ticket set, register it into a temporary state root, and
  prove the fence's assertions pass across the repository boundary. Then prove it bites, reverting
  between each: flip ONE ticket's state so it disagrees with the plan's marker -> red, with a
  message naming the plan source; delete the plan -> the orphan rule fires; set plans.format to an
  unimplemented value -> UnsupportedPlanFormatError, NOT a vacuous pass. Add one regression
  assertion for the vacuous-pass hazard specifically: a plan whose headings use a Phase grammar
  under a DECLARED v1 format must fail loudly rather than parse to zero tasks.

DO NOT
  Skip the vacuous-pass regression - it is the assertion that encodes the measurement behind Q3.
  Leave any temp repository or state root behind.

DEFINITION OF DONE
  The plan's task 18 checklist, every box.
  Flip task 18's checklist boxes and milestone M5 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T18.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  node --experimental-strip-types --test core/test/unit/registry/plan-source.test.ts - green
  npm run test:unit - green over the real tree, no count regression
```

### T19 — ticketStoreForPlan and the default-plan rule

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT high
  CLAUDE  claude:sonnet · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     this is what gives the store a plan to resolve against; the move in task 20 is unsafe until it exists.

TASK 19 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M6.
PREDECESSORS: M5 is [x] - the fence resolves through the registry and has been seen to bite.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M6 task 19 in full, and Questionable Q4 IN FULL
  core/src/cli/commands/ticket.ts and core/src/persistence/ticket-store.ts - IN FULL
  core/src/cli/commands/backlog.ts and core/src/backlog.ts
  specs/awsf-v2-candidates-fuse-version.md - section 10.2, which reversed an earlier attempt at this

DO
  Add ticketStoreForPlan(resolved, planStem) returning a TicketStore over the resolved plan
  source's tickets root - INSIDE the plan repository, not the working one. RETAIN
  ticketStoreFor(repository) as the self-placed path so a repository with no catalog behaves
  exactly as it does today. Give awsf ticket list and awsf backlog an optional --plan <stem>,
  defaulting to the catalog's plans.default. With no default declared and more than one plan source
  present, LIST THE CANDIDATES and exit non-zero rather than guessing.

DO NOT
  Modify TicketStore, TicketSchema or intakeRequest - per Q4 the gap is NAMED and LEFT, and
  widening the id pattern without relaxing the six required fields makes the second case worse.
  Make TicketStore recursive. Move any ticket file - that is task 20 and it comes after this.

DEFINITION OF DONE
  The plan's task 19 checklist, every box.
  Flip task 19's checklist boxes and milestone M6 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T19.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  Only the RESOLUTION of the directory changes. The store's contract is untouched.
```

### T20 — Move v1's flat tickets, and prove nothing changed for the reader

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT high
  CLAUDE  claude:sonnet · /effort high
  GPT     codex:gpt-5.6-terra · reasoning high
  WHY     the failure mode here is silent by construction, so the baseline is captured BEFORE anything moves.

TASK 20 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M6.
PREDECESSORS: T19 is [x]. If it is not, STOP: moving first is exactly the mistake section 10.2 of the fuse record reversed.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - Milestone M6 task 20 in full
  core/src/persistence/ticket-store.ts - the /^T\d\d\.md$/ filter and the non-recursive readdir
  core/src/cli/commands/ticket.ts - showTicket's path-suffix branch
  core/test/unit/meta/ticket-plan-sync.test.ts - the flat-set special case you are removing

DO
  FIRST, before touching anything: capture the exact current output of `awsf ticket list` and
  `awsf backlog` as the comparison baseline. Then move specs/tickets/T01.md through T38.md into
  specs/tickets/awsf-plan/ using `git mv`, preserving history. Update every relative link inside
  the moved tickets - they point at ../awsf-plan.html and gain one level. Remove the flat-set
  special case from planSets(): after the move every set is uniform. Assert in a TEST that
  `awsf ticket list` and `awsf backlog` produce output IDENTICAL to the captured baseline, and that
  `awsf ticket show T17` still resolves through showTicket's path-suffix branch one level deeper.

DO NOT
  Use unlinkSync, rmSync, rmdirSync or rm -rf - three of the nine patterns the invariant 8 scan
  reads for. Move the files before capturing the baseline. Eyeball the comparison instead of
  asserting it.

DEFINITION OF DONE
  The plan's task 20 checklist, every box.
  Flip task 20's checklist boxes and milestone M6 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T20.md's state to wip then done in the same commit.
  Do NOT touch specs/awsf-v2-plan.html.
  awsf ticket list and awsf backlog match the captured baseline EXACTLY
  awsf ticket show T17 resolves
  npm run test:unit - green
```

### T21 — Full suite, marker flips, and the spine's W04 marker

```
[CHOOSE YOUR PROVIDER — pick by live quota]
  MODEL   Sonnet 5 · EFFORT medium
  CLAUDE  claude:sonnet · /effort medium
  GPT     codex:gpt-5.6-terra · reasoning medium
  WHY     the only task that touches specs/awsf-v2-plan.html.

TASK 21 of 21. Plan: specs/awsf-v2-w04-project-registry.html, milestone M6.
PREDECESSORS: T20 is [x] and every other checklist box in this plan reads [x]. AND: BOTH owner amendments have landed - AGENTS.md invariant 12's replacement text, and awsf.project.yaml in awsf.config.yaml's policy.protected_paths. Confirm the second by READING awsf.config.yaml.

READ FIRST
  specs/awsf-v2-w04-project-registry.html - the Validation Commands section in full
  specs/awsf-v2-plan.html - Milestone M4 / W04's block and checklist
  AGENTS.md - invariants 2 and 12

DO
  FIRST, read awsf.config.yaml and confirm awsf.project.yaml is in policy.protected_paths. If it
  is not, STOP AND REPORT - do not close the workstream with the catalog unprotected, and do not
  add it yourself: awsf.config.yaml is a protected path and that commit is the owner's.
  Then run the full suite, typecheck and lint. Confirm no-destructive-paths.test.ts is green - the
  two vocabulary patterns this workstream walks near are /git\s+push/ and
  /worktree\s+(?:remove|prune)\b/, and the scan reads file CONTENTS including comments. Flip every
  remaining marker in specs/awsf-v2-w04-project-registry.html to [x] and every ticket's state to
  done. Append an Amendment entry to this plan recording the landing commit and the suite count.
  ONLY THEN, in the SAME commit: flip specs/awsf-v2-plan.html's Milestone M4 / W04 marker and its
  checklist to [x].

DO NOT
  Flip the spine's marker in any earlier commit. Flip it if any box in this plan is still open.
  Mark the owner-run validation row [x] - it needs a provider call and stays [f] until the owner
  reports it.

DEFINITION OF DONE
  The plan's task 21 checklist, every box.
  Flip task 21's checklist boxes and milestone M6 to [wip] on start and [x] on completion in
  specs/awsf-v2-w04-project-registry.html, and T21.md's state to wip then done in the same commit.
  Task 21 IS the task that flips specs/awsf-v2-plan.html's W04 marker - in this same commit.
  npm run test:unit && npm run typecheck && npm run lint - all clean
  node --experimental-strip-types --test core/test/unit/meta/ticket-plan-sync.test.ts - green
  Every marker in this plan is [x]; the spine's W04 marker is [x], in this same commit.
```
