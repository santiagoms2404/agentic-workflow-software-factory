# Build Prompts — AWSF v2 W08, Publish

Companion to [`awsf-v2-w08-publish.html`](./awsf-v2-w08-publish.html) and
[`tickets/awsf-v2-w08-publish/`](./tickets/awsf-v2-w08-publish/). Created 2026-08-24, revised
2026-08-25 after the owner review.

**These prompts build the approved deep plan.** Twenty-four fresh sessions execute twenty-four
numbered tasks in plan order. **Every task is offline and spends no agent quota.** No task in this
workstream makes a live provider call, and no test it writes may touch the network — the only
remotes any of them know are bare repositories created in a temporary directory.

## Gates before execution

1. **The owner decided all eight Questionables on 2026-08-25.** Every one is a constraint, not a
   suggestion. Six were taken as recommended; **Q2 and Q3 went the other way and reshaped the
   workstream**: publication gets its own `PUBLISHED` state and its own legal edge, and the owner's
   configured credential helper is inherited rather than cleared. **Nothing in this plan is still an
   open question** — the only things it waits on are the three owner commits below.
2. **Gate G8-B blocks M5 (T12 onward).** `core/src/state/**` is a protected path. One
   owner-authored commit touching two files: `task-machine.ts` gains `PUBLISHED` in `TASK_STATES`
   and in `TERMINAL_STATES`, a new `SEALED_STATES` of exactly `BLOCKED`/`CANCELLED`/`PUBLISHED`,
   step 2 of `transition()` reading `SEALED_STATES` instead of `TERMINAL_STATES`, `L27` in the
   `EdgeId` union, and the `LEGAL_EDGES` row `L27 — LANDED → PUBLISHED` with actor `human`,
   `spawnSite: false`, `interactive: true`; `guards.ts` gains `L27`'s guard. **No agent may write
   either file.** T01–T11 do not wait on it.
3. **Gate G8-C blocks M5 (T12 onward).** `core/src/observability/migrations/**` is a protected
   path. One owner-authored commit adding `0004-published-state.sql`, which rebuilds `sessions`
   with the eleven-value `lifecycle_state` CHECK, copies every column, recreates
   `idx_sessions_recent`, `idx_sessions_state` and `idx_sessions_task`, and ends with
   `PRAGMA user_version = 4`. **T11 must land before this commit runs** — the migration runner does
   not hoist `foreign_keys` out of its transaction today, and without that hoist the rebuild fails
   with `FOREIGN KEY constraint failed` and every AWSF command stops opening the database.
4. **Gate G8-A blocks M7 (T19 onward).** Invariant 8 in `AGENTS.md` must carry the amended text
   drafted in the plan's § The Invariant 8 Amendment. `AGENTS.md` is a protected path and
   `path-policy` rejects `protected-path` independently of every write glob. T01–T18 do not wait
   on it.
5. **Read the ordering note in the plan's § Gates carefully.** `no-destructive-paths.test.ts`
   cannot see the argv site T06 creates — measured — so the suite stays green through M6 whether or
   not G8-A landed. **T19 is an explicit verification with a written `[f]` posture**, and it is the
   only thing that enforces that gate. Do not add an override, an exemption, an allowlist entry, or
   a comment telling a later session to skip it. The same posture applies to T12 for G8-B and G8-C.
6. W04's deep plan is complete and its spine marker is `[x]`. The allowlist extends the catalog
   W04 shipped, and `delivery` is not widened.
7. `CLAUDE.md` and `docs/TESTING.md` do not exist in this repository. Do not invent them. Read
   `AGENTS.md`, this plan, the named source files, and the package scripts instead.

## Conventions used by every prompt

- Read `AGENTS.md` in full. Invariants 1, 8, 9 and 10 are all directly in scope.
- **Flip this leaf plan's own markers.** In `specs/awsf-v2-w08-publish.html`, move the current
  task's checklist items `[]`→`[wip]`→`[x]`, and move the containing milestone header to `[wip]`
  on its first task and `[x]` only on its last. Flip the matching ticket's `state:` in the same
  commit.
- **Do not flip `specs/awsf-v2-plan.html`'s W08 marker before T24.** T24 alone closes the spine
  marker and `specs/tickets/awsf-v2-plan/W08.md`, after every leaf marker is `[x]`.
- **The six things no task in this workstream may do**, restated in every prompt because each one
  is a rule a plausible convenience would break: absorb any deployment scope, in code or in prose;
  write `AGENTS.md`, `awsf.config.yaml`, `awsf.project.yaml`, `core/src/state/**` or
  `core/src/observability/migrations/**`; let a test touch the network; put a URL into the push
  argv or into the journal; store a Git process's stdout or stderr anywhere; add a dependency
  outside the invariant 7 allowlist.
- **Publication is source publication.** The word *deploy* belongs in none of the code, none of
  the comments, and none of the operator messages this workstream writes. W13 is the deploy
  workstream and it is declared, not built.
- **Two claims that are now false and must not be written anywhere.** Publish does *not* guarantee
  that no credential is read — Q3 inherits the owner's helper, and `INV-4` is the narrower claim.
  `GIT_TERMINAL_PROMPT=0` is *not* a credential control — it exists because `spawnSync` captures
  stdio, so a prompt would hang rather than reach anybody.
- Never add a runtime report, receipt, or manifest file; never commit live task or session state.
- Append the modified date and an Amendment with the commit SHA after each completed task. Never
  put an agent, model, or AI tool in commit identity or message.

# Section B — Task prompts (recommended)

### T01 — The four input records and the closed refusal vocabulary

```
[MODEL: Opus 5 · EFFORT: high — the vocabulary and its order are what every later task depends on, and a wrong order is invisible until a rejection names the wrong defect]

TASK 1 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M1.
PREDECESSORS: none. Confirm the owner approved the plan. No gate is needed for M1.

READ FIRST
  AGENTS.md - in full, especially invariants 1, 8, 9 and 10
  specs/awsf-v2-w08-publish.html - The Truth Table in full, Relevant Files, and M1 task 1
  core/src/state/guards.ts - the header comment idiom: decides whether, never how, never looks
  core/src/state/task-machine.ts - the ordered rejection contract, steps 1 through 5
  core/test/unit/rejection-order.test.ts - the header explaining why order is not a nicety
  core/src/contracts/test-output.ts - SHA_PATTERN, imported rather than restated

DO
  Create core/src/publish/authorize.ts. Declare the four input records named in the plan's Truth
  Table section - PublishStatusFacts, PublishRepositoryFacts, PublishRemoteFacts, PublishRefspec -
  as VALUES ONLY: no handles, no paths to read, no functions, no promises. Declare
  PUBLISH_REFUSAL_ORDER as a readonly tuple of the fourteen codes in evaluation order and derive
  PublishRefusalCode from it, so the order and the vocabulary cannot disagree. Import SHA_PATTERN
  rather than writing ^[0-9a-f]{40}$ again. Write the header comment in the idiom of guards.ts:
  this file decides WHETHER, never HOW, and it never goes and looks.

DO NOT
  Import anything from node:, from core/src/execution/**, or from core/src/git/**. Read a clock.
  Touch the filesystem. Write authorizePublish yet. Add a field that would be needed for
  deployment - no environment, no endpoint, no release, no target.

DEFINITION OF DONE
  Every box in M1 task 1. The file's entire import list is type-only imports plus SHA_PATTERN and
  the code tuple. npm run typecheck and npm run lint green.
  Mark this leaf task and T01 together; set M1 to [wip] and leave the spine W08 marker untouched.
```

### T02 — authorizePublish and the branded plan

```
[MODEL: Opus 5 · EFFORT: high — fourteen ordered rows, a brand that is the whole derivation fence, and two rows that exist because a measurement said so]

TASK 2 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M1.
PREDECESSORS: T01 is done and M1 is [wip].

READ FIRST
  specs/awsf-v2-w08-publish.html - The Truth Table, the What the bare-remote transcript settled
    block, Questionable Q8, and M1 task 2
  core/src/cli/commands/land.ts - authorizeLanding and where landingApproval is populated at L20
  core/src/state/task-machine.ts - TASK_STATES, TERMINAL_STATES, and why LANDED is terminal today
  core/src/git/land.ts - LandingBlocked, the closed-code shape this file's refusals mirror

DO
  Implement authorizePublish(status, repository, remote, refspec) evaluating the fourteen rows of
  PUBLISH_REFUSAL_ORDER and returning on the FIRST violation - the ordered contract, not a
  collected fault list, because a caller acting on the wrong defect publishes a different wrong
  thing. Return a discriminated union: { decision: "authorized", plan } or
  { decision: "refused", code, detail }, where detail is a fixed sentence per code with no
  interpolated URL and no interpolated path. Declare AuthorizedPublishPlan carrying a
  module-private unique symbol brand and construct it in this file and nowhere else; it carries
  remoteName, branch and sha, and no URL, host or path. Row 11 refuses an empty source AND a
  forty-zeros source independently of row 12, with a comment recording the measurement: an
  all-zeros source deleted the branch at exit 0. Row 14 treats fastForward === null as PASS,
  because an absent remote branch is a creation - ls-remote of an absent ref is empty stdout at
  exit 0, not an error. Q8 is decided as recommended: rows 2 and 3 require the landingApproval
  record and match its SHA against status.candidateSha.

DO NOT
  Call authorizePublish anywhere in this file. Read a clock or a file. Let any row throw. Build a
  plan object outside this file. Collect faults instead of returning the first. Special-case
  PUBLISHED - it is not in TASK_STATES yet, and row 1 covers it the moment G8-B lands.

DEFINITION OF DONE
  Every box in M1 task 2. The function is a pure expression of its four arguments. npm run
  typecheck and npm run lint green.
  Mark this leaf task and T02 together; leave M1 [wip] and the spine W08 marker untouched.
```

### T03 — Testing Strategy: totality, the thirteen adjacencies, and the state enumeration

```
[MODEL: Opus 5 · EFFORT: high — the adjacency proofs are the reason the order is trustworthy, and each one needs an input that genuinely violates both rows]

TASK 3 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M1.
PREDECESSORS: T01 and T02 are done.

READ FIRST
  specs/awsf-v2-w08-publish.html - The Truth Table and M1 task 3
  core/test/unit/rejection-order.test.ts - IN FULL. This file is the model: single-violation
    inputs proving reachability, one purpose-built double violation per adjacency, spot checks
  core/src/state/task-machine.ts - TASK_STATES, imported by the test rather than copied

DO
  Write core/test/unit/publish/authorize.test.ts. Fourteen reachability rows, one per code, each
  derived from a valid baseline by changing exactly one field. Thirteen adjacency tests, each an
  input violating both members of one adjacent pair, asserting the EARLIER code fires, each with a
  one-line comment saying what fixing the later complaint would have let through. A totality sweep
  over the cartesian product of the discrete dimensions asserting every result is either
  authorized or a member of PUBLISH_REFUSAL_ORDER and that no input throws. Enumerate the state row
  by iterating TASK_STATES AS IMPORTED: assert not-landed for every member except LANDED and assert
  the refused count equals TASK_STATES.length - 1, so the eleventh state G8-B adds is covered
  without editing this file. Include the one positive test: a valid baseline authorizes and the
  returned plan's fields equal the inputs they came from.

DO NOT
  Copy the state list into this file, or hardcode nine. Perform any I/O. Spawn anything. Assert on
  message text instead of on a code. Let a reachability row pass because two things were wrong at
  once.

DEFINITION OF DONE
  Every box in M1 task 3. npm run test:unit, npm run typecheck and npm run lint green.
  Mark this leaf task and T03 together; set M1 to [x] and leave the spine W08 marker untouched.
```

### T04 — The publish block in the catalog, keyed on a remote name

```
[MODEL: Sonnet 5 · EFFORT: medium — a closed schema addition whose sharpest requirement is what it must NOT accept]

TASK 4 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M2.
PREDECESSORS: T03 is done and M1 is [x]. Q1 and Q6 are decided as recommended.

READ FIRST
  specs/awsf-v2-w08-publish.html - Questionables Q1 and Q6, and M2 task 4
  core/src/registry/catalog-schema.ts - RepositorySchema, the delivery enum, additionalProperties
  core/src/registry/catalog.ts - assertNoAbsolutePaths and containsCredential over string leaves
  core/src/config/machine-path.ts - ABSOLUTE_PATH_PATTERN and what it does not match
  specs/awsf-v2-w04-project-registry.html - the row reserving delivery policy for this workstream

DO
  Add an optional publish object to RepositorySchema: remotes (non-empty array of Git remote
  names), branches (non-empty array of branch names), host (optional hostname). Closed with
  additionalProperties: false. Validate names AS NAMES: no whitespace, no slash in a remote name,
  no leading plus, no colon, and refuse a branch that would not survive git check-ref-format's
  obvious cases. host is a hostname only - a value containing @, / or : is refused by the schema
  before containsCredential ever sees it. Write the derivation rule as a comment beside the block:
  THE ALLOWLIST KEYS ON A REMOTE NAME because assertNoAbsolutePaths refuses a bare-remote path
  outright, and a file:// URL would pass that check only by smuggling a machine path past it.
  Regenerate the emitted JSON Schema through emitProjectCatalogJsonSchema.

DO NOT
  Widen delivery. Hand-maintain a JSON Schema copy. Add a field naming an environment, an
  endpoint, a release, or a target. Write awsf.project.yaml - it is a protected path, and this
  repository's own values are a separate optional owner commit that nothing here waits on.

DEFINITION OF DONE
  Every box in M2 task 4. npm run typecheck and npm run lint green, and
  node --test core/test/unit/meta/no-handwritten-schema.test.ts green.
  Mark this leaf task and T04 together; set M2 to [wip] and leave the spine W08 marker untouched.
```

### T05 — Testing Strategy: the loader rejections the block inherits

```
[MODEL: Sonnet 5 · EFFORT: medium — the two best assertions are about rejections that already existed, which is the point]

TASK 5 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M2.
PREDECESSORS: T04 is done and M2 is [wip].

READ FIRST
  specs/awsf-v2-w08-publish.html - M2 task 5
  core/test/unit/registry/ - the existing catalog loader suite and its YAML-text idiom
  core/src/registry/catalog.ts - the closed CatalogError hierarchy; assert on code, never on text

DO
  Write core/test/unit/publish/catalog-publish.test.ts over YAML text. A publish.host carrying
  user:token@host is refused with CatalogCredentialShapedError - INHERITED, not added, and the
  test says so in a comment. An absolute path or a drive-letter path anywhere in the block is
  refused with CatalogAbsolutePathError, same inheritance. An unknown key inside publish is
  refused by additionalProperties: false, and THE TEST NAMES environment, endpoint AND release
  as the three keys it is keeping out - this is the assertion that keeps deployment scope from
  entering through the schema. An empty remotes or branches array is refused. A repository with no
  publish block loads fine and is simply not publishable. A remote name containing a slash,
  whitespace, a leading plus or a colon is refused, each with its own row.

DO NOT
  Assert on error message text. Modify the existing catalog suite. Write a fixture carrying a real
  credential - assemble any credential-shaped literal from fragments so the file survives
  no-credentials-in-fixtures.test.ts.

DEFINITION OF DONE
  Every box in M2 task 5. npm run test:unit, npm run typecheck and npm run lint green, and
  node --test core/test/unit/meta/no-credentials-in-fixtures.test.ts green.
  Mark this leaf task and T05 together; set M2 to [x] and leave the spine W08 marker untouched.
```

### T06 — publishArgv, the only push token in core/src

```
[MODEL: Opus 5 · EFFORT: high — this file is what the whole fence is about, and the porcelain parser has a space-flag trap in it]

TASK 6 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M3.
PREDECESSORS: T05 is done and M2 is [x]. Q3 is decided: the argv carries NO -c credential.helper=.

READ FIRST
  specs/awsf-v2-w08-publish.html - What the bare-remote transcript settled, the derived rules in
    Notes, Questionable Q3, and M3 task 6
  core/src/publish/authorize.ts - the branded AuthorizedPublishPlan this file consumes
  core/test/unit/meta/child-process-fence.test.ts - the single-allowed-file idiom this file will
    be held to from T21 onward

DO
  Create core/src/publish/refspec.ts parsing a refspec into { source, destination, forced,
  deleting }: forced is a leading plus; deleting is an EMPTY source OR a source of forty zeros.
  Both spellings carry the measurement in a comment. Create core/src/publish/argv.ts exporting
  publishArgv(plan: AuthorizedPublishPlan): readonly string[], taking the branded type and nothing
  else, and being the ONLY file under core/src containing the push token. The argv is exactly
  ["push", "--porcelain", plan.remoteName, sha:refs/heads/branch] - a remote NAME, never a URL, a
  fully qualified destination, and NO credential.helper argument, because Q3 inherits the owner's
  helper chain. Add parsePorcelain in the same file: drop the first stdout line (To <url>) and the
  trailing Done, parse only tab-separated ref lines, and READ THE FLAG AS THE FIRST CHARACTER OF
  THE UNTRIMMED LINE because the fast-forward flag is a literal space. Map the closed flag
  vocabulary to a closed outcome vocabulary: * created, = already-current, space fast-forwarded,
  ! rejected; + and - map to a fault, because reaching either means something upstream failed.

DO NOT
  Write --force, --mirror, --delete, --all, --tags, --follow-tags or a bare plus anywhere in either
  file. Add -c credential.helper= - Q3 removed it, and reinstating it silently would restore a
  guarantee the owner declined. Accept anything but the branded type. Put a URL in the argv. Trim a
  porcelain line before reading its flag. Spawn anything - this file builds strings.

DEFINITION OF DONE
  Every box in M3 task 6. npm run typecheck and npm run lint green.
  Mark this leaf task and T06 together; set M3 to [wip] and leave the spine W08 marker untouched.
```

### T07 — The observation step and its closed failure vocabulary

```
[MODEL: Opus 5 · EFFORT: high — five Git observations whose exit codes mean the opposite of what they look like in two places]

TASK 7 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M3.
PREDECESSORS: T06 is done and M3 is [wip]. Q5 is decided as recommended: observe before deciding.

READ FIRST
  specs/awsf-v2-w08-publish.html - Questionable Q5, the transcript block, and M3 task 7
  core/src/git/land.ts - IN FULL. clean(), head(), isAncestor()'s 0/1/other handling, and
    LandingBlocked's closed code vocabulary
  core/src/git/changes.ts - GitRunner, systemGitRunner, runGit, GitCommandFailed
  core/src/quota/probe.ts - QuotaProbeFailure, the closed failure union whose comment says raw
    process bytes are deliberately absent

DO
  Create core/src/git/publish.ts with observePublishTarget(repository, remoteName, branch, runner)
  returning the facts the table needs, taking a GitRunner exactly as land.ts does. One command per
  observation: rev-parse HEAD; status --porcelain for cleanliness, copying land.ts's clean();
  remote get-url --push <name> for the host, parsed to a hostname and never stored whole;
  ls-remote <name> refs/heads/<branch> for the remote tip; merge-base --is-ancestor for
  fastForward, copying land.ts's exit-status handling. EMPTY ls-remote OUTPUT AT EXIT 0 MEANS THE
  BRANCH IS ABSENT, so fastForward is null and this is a creation - read the output, never the
  status. Declare PublishBlocked with the closed codes remote-unknown, remote-unreadable,
  credentials-required, mirror-configured, git-failure, with raw process bytes absent from every
  one. mirror-configured exists because it was measured: with remote.<name>.mirror=true an explicit
  refspec is fatal at exit 128 and every other branch survived. The run step calls authorizePublish
  ONCE and reaches publishArgv only through the returned plan.

DO NOT
  Import node:child_process. Store stdout or stderr in an error, a return value, or a log. Read an
  exit code as the branch-existence signal. Add a second authorization call or a branch that skips
  it. Put the remote URL anywhere but a discarded local variable.

DEFINITION OF DONE
  Every box in M3 task 7. npm run typecheck, npm run lint and
  node --test core/test/unit/meta/child-process-fence.test.ts green.
  Mark this leaf task and T07 together; leave M3 [wip] and the spine W08 marker untouched.
```

### T08 — Testing Strategy: the local bare remote

```
[MODEL: Sonnet 5 · EFFORT: medium — a harness plus six behaviours, all measured already and all reproducible offline]

TASK 8 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M3.
PREDECESSORS: T06 and T07 are done.

READ FIRST
  specs/awsf-v2-w08-publish.html - What the bare-remote transcript settled, and M3 task 8
  core/test/unit/git/dependency-seeds.test.ts - the mkdtempSync + git init harness idiom,
    including the explicit -c user.name / -c user.email that keeps invariant 11 intact

DO
  Write core/test/unit/publish/_bare.ts: a temporary root, a bare repository, a work repository
  with two commits, and origin pointing at the bare path, with the owner's identity set explicitly.
  Write core/test/unit/publish/bare-remote.test.ts and porcelain.test.ts. An exact-revision push to
  an absent branch CREATES it: flag *, exit 0, and ls-remote then reports that exact SHA. A
  fast-forward reports the SPACE flag with old..new in the last field, and assert explicitly that
  the parser read it correctly BECAUSE THE LINE WAS NOT TRIMMED. A non-fast-forward is refused by
  the TABLE before any push runs - proved by the remote ref being unchanged AND by the injected
  runner having recorded no push invocation. observePublishTarget against an absent remote name
  gives remote-unknown, and against a URL pointing at a missing path gives remote-unreadable, and
  neither error carries the path or the Git prose. parsePorcelain covers all six flags including
  the two that must never occur, and asserts the To <url> line is dropped rather than parsed.

DO NOT
  Resolve a hostname. Open a socket. Name a remote outside the test's own temporary root. Let a
  test depend on the machine's git config - set GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM, or pass
  every needed value with -c.

DEFINITION OF DONE
  Every box in M3 task 8. npm run test:unit, npm run typecheck and npm run lint green.
  Mark this leaf task and T08 together; set M3 to [x] and leave the spine W08 marker untouched.
```

### T09 — The env posture, and the failure that is no longer a refusal

```
[MODEL: Opus 5 · EFFORT: high — the decision narrowed a guarantee, and the job is to state the narrower one exactly rather than keep claiming the old one]

TASK 9 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M4.
PREDECESSORS: T08 is done and M3 is [x]. Q3 is decided AGAINST the plan's recommendation: inherit
the owner's configured credential helper.

READ FIRST
  AGENTS.md - invariant 9
  specs/awsf-v2-w08-publish.html - Questionable Q3 IN FULL, M4's card, and M4 task 9
  core/src/execution/transport-broker.ts - runSystemCommand's env and timeout parameters
  core/src/policy/redaction.ts and dashboard/shared/credential-patterns.ts - containsCredential
  awsf.config.yaml - policy.protected_operations, which lists credential-access

DO
  The argv carries NO -c credential.helper=. The owner's configured helper chain applies exactly as
  it does when they run the command themselves. Set GIT_TERMINAL_PROMPT=0 over the inherited
  environment and write the comment saying WHY: spawnSync captures stdio, so the subprocess has no
  terminal and a prompt would hang until the timeout rather than reach anybody. It is NOT a
  credential control. Narrow credentials-required to one case - the helper chain produced nothing
  and prompting is off - with an operator sentence naming the helper as the thing to fix, not AWSF;
  discard the stderr that carried the diagnosis. Before spawning, run the joined argv through
  containsCredential and refuse if it matches. Write the header comment stating both halves of
  INV-4 as the plan words them: what was given up (AWSF no longer guarantees no credential is read)
  and what is kept (no credential VALUE passes through AWSF; no URL in the argv; AWSF writes no
  credential configuration and no credential file).

DO NOT
  Write a comment claiming credential non-persistence - it is false after this decision. Describe
  GIT_TERMINAL_PROMPT=0 as a credential control. Read, hold, log or journal anything the helper
  returns. Accept a token from the environment. Write to ~, to the repository's git config, or to
  any file.

DEFINITION OF DONE
  Every box in M4 task 9. npm run typecheck and npm run lint green.
  Mark this leaf task and T09 together; set M4 to [wip] and leave the spine W08 marker untouched.
```

### T10 — Testing Strategy: the helper ran, and its answer went nowhere

```
[MODEL: Sonnet 5 · EFFORT: medium — the stub helper now proves the opposite of what it was going to prove, and the inversion is the whole task]

TASK 10 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M4.
PREDECESSORS: T09 is done and M4 is [wip]. Q4 is decided as recommended: stderr is never retained.

READ FIRST
  specs/awsf-v2-w08-publish.html - Questionables Q3 and Q4, and M4 task 10
  core/test/unit/meta/no-credentials-in-fixtures.test.ts - the sweep, and the fragment-assembly
    idiom its own specimen token uses to survive it

DO
  Write core/test/unit/publish/credentials.test.ts. THE HELPER IS INVOKED: with a stub helper
  configured, a publish causes it to run - asserted on the marker file the stub writes. A test that
  could not tell whether the helper ran cannot say anything about what happened to its answer. The
  stub's returned secret appears in NO argv the runner received, NO journal line and NO operator
  message - swept over the serialized journal and the captured argv, not over reconstructions;
  assemble the stub's password literal from fragments so the file survives the credential sweep.
  Assert the argv contains no -c credential.helper=, so a later reinstatement is a deliberate change
  rather than a drift. AWSF WROTE NOTHING: in a run against a repository with NO helper configured,
  git config --local --get-regexp on ^credential\. reports nothing afterwards - assert on the EMPTY
  OUTPUT, because it exits 1 when there are no matches and reading that exit code as failure
  inverts the test. remote.origin.url is byte-identical and no new dotfile appeared. The argv
  contains no ://, no @, and no value containsCredential matches.

DO NOT
  Assert that the helper did not run - that was the rejected option's claim. Write a real credential
  into any file. Assert on an exit status where the output is the signal. Reach the network.

DEFINITION OF DONE
  Every box in M4 task 10. npm run test:unit, npm run typecheck, npm run lint and
  node --test core/test/unit/meta/no-credentials-in-fixtures.test.ts green.
  Mark this leaf task and T10 together; set M4 to [x] and leave the spine W08 marker untouched.
```

### T11 — The two unprotected preconditions: the foreign-key hoist and the seal split

```
[MODEL: Opus 5 · EFFORT: high — two small edits to two careful files, and an owner commit that bricks the database if they land in the wrong order]

TASK 11 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M5.
PREDECESSORS: T10 is done and M4 is [x]. THIS TASK MUST LAND BEFORE THE OWNER'S G8-C COMMIT.

READ FIRST
  specs/awsf-v2-w08-publish.html - the G8-C card IN FULL, the Solution section's seal card, and
    M5 task 11
  core/src/observability/sqlite.ts - runMigrations, TRANSACTION_UNSAFE_PRAGMA, and the comment
    explaining why exactly two pragmas are hoisted today
  core/src/cli/commands/attempt.ts - persistAttempt's validate, isTerminalStatus, sealWhenTerminal
  core/src/persistence/attempt-lock.ts - SealedAttempt and the lock's own seal

DO
  In core/src/observability/sqlite.ts, add foreign_keys to TRANSACTION_UNSAFE_PRAGMA so
  PRAGMA foreign_keys = OFF is hoisted ahead of BEGIN IMMEDIATE, and RESTORE the previous value
  after the migration commits - capture it first, because node:sqlite's DatabaseSync defaults it to
  ON and leaving it off silently disables every foreign key for the life of the process. Extend the
  existing two-pragma comment to say why the third is there and what fails without it: measured,
  the rebuild fails with FOREIGN KEY constraint failed, and PRAGMA defer_foreign_keys = ON inside
  the transaction fails identically because SQLite's RESTRICT is not deferrable.
  In core/src/cli/commands/attempt.ts, split the seal. persistAttempt's validate refuses when the
  current state is in SEALED_STATES, AND refuses any event on a LANDED attempt whose
  next.lifecycleState is not PUBLISHED - two conditions where there was one, so the seal is
  narrowed and never removed. sealWhenTerminal becomes seal-when-SEALED, so the lock seals at
  PUBLISHED, BLOCKED and CANCELLED and not at LANDED. isTerminalStatus is UNCHANGED and still reads
  TERMINAL_STATES: read all six of its consumers - attempt-projection.ts's endedAt, retry.ts,
  raise.ts twice, watch.ts, and attempt.ts's own guard - and confirm each keeps today's behaviour
  for a landed attempt. G8-B has not landed yet, so declare SEALED_STATES locally with a comment
  naming G8-B as its future home; T12 replaces it with the import.

DO NOT
  Write core/src/state/** or core/src/observability/migrations/** - both are protected. Remove
  LANDED from TERMINAL_STATES; that breaks retry, raise, watch, endedAt and both seal sites, which
  is the whole reason this is a split rather than a deletion. Leave foreign_keys off after the
  migration. Block this task on G8-B - it does not need it.

DEFINITION OF DONE
  Every box in M5 task 11. npm run test:unit, npm run typecheck and npm run lint green, with the
  six isTerminalStatus consumers verified by reading them.
  Mark this leaf task and T11 together; set M5 to [wip] and leave the spine W08 marker untouched.
```

### T12 — Verify G8-B and G8-C landed, then move the test-side tables

```
[MODEL: Opus 5 · EFFORT: high — the matrix arithmetic is the kind of thing that is either exactly right or quietly wrong, and L27 is not the single-cell amendment its two predecessors were]

TASK 12 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M5.
PREDECESSORS: T11 is done and M5 is [wip]. THIS TASK IS GATES G8-B AND G8-C.

READ FIRST
  specs/awsf-v2-w08-publish.html - the G8-B and G8-C cards IN FULL, and M5 task 12
  core/src/state/task-machine.ts and core/src/state/guards.ts - what the owner was asked to write
  core/src/observability/migrations/0004-published-state.sql - the owner's migration
  core/test/unit/_lifecycle-tables.ts - the four class lists and the arithmetic comment that
    already explains why the counts win over a literal reading of step 2
  core/test/unit/transitions.test.ts, actors.test.ts, rejection-order.test.ts
  core/test/simulation/_harness.ts - the duplicated TERMINAL_STATES literal

DO
  Confirm G8-B: PUBLISHED in TASK_STATES, PUBLISHED in TERMINAL_STATES, SEALED_STATES of exactly
  BLOCKED/CANCELLED/PUBLISHED, step 2 of transition() reading SEALED_STATES, L27 in EdgeId, and the
  LEGAL_EDGES row L27 - LANDED to PUBLISHED, actor human, spawnSite false, interactive true, plus
  L27's guard in guards.ts. Confirm G8-C: 0004-published-state.sql rebuilds sessions with the
  eleven-value CHECK, copies every column, recreates idx_sessions_recent, idx_sessions_state and
  idx_sessions_task, and ends with PRAGMA user_version = 4. IF EITHER HAS NOT LANDED: mark this
  task [f], mark M5 [f], STOP, and report. Then replace T11's local SEALED_STATES with the import.
  Move core/test/unit/_lifecycle-tables.ts: TASK_STATES and TERMINAL_STATES gain PUBLISHED, a
  SEALED_STATES mirror appears, and the four class lists move to TERMINAL_ATTEMPT_PAIRS 27 -> 30,
  ALREADY_IN_STATE_PAIRS 10 -> 11, HUMAN_GATE_BYPASS_PAIRS 6 UNCHANGED, everything-else 31 -> 47.
  EXTEND that file's arithmetic comment rather than replacing it, and say plainly that L25 and L26
  were single-cell amendments and L27 IS NOT - it adds a row, a column, and moves a source out of
  the sealed set. Move transitions.test.ts: 100 -> 121 pairs, 26 -> 27 legal, 74 -> 94 illegal, the
  partition to 30 + 11 + 6 + 47 = 94, LEGAL_EDGES.length to 27. Move actors.test.ts's others.length
  22 -> 23 and add L27's actor row. Add a rejection-order.test.ts reachability row proving
  TerminalAttempt fires from PUBLISHED, and confirm no adjacency changed - the eleven ordered steps
  are untouched. Move the duplicated literal in core/test/simulation/_harness.ts and note in a
  comment that no fence ties it to the real one.

DO NOT
  Write either protected path. Add an exemption. Proceed to M6 with either gate absent - every
  milestone after this assumes the state exists. Add a twelfth rejection step; a to-PUBLISHED pair
  from a wrong source falls to IllegalTransition, which is the adequate backstop because
  authorizePublish refuses it first with not-landed.

DEFINITION OF DONE
  Every box in M5 task 12, or this task and M5 both marked [f] with the reason recorded.
  npm run test:unit and npm run test:sim green.
  Mark this leaf task and T12 together; leave M5 [wip] and the spine W08 marker untouched.
```

### T13 — The dashboard's eleventh state

```
[MODEL: Sonnet 5 · EFFORT: low — a union member, a ribbon cell, and two mappings, with one thing nearby that must not be touched]

TASK 13 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M5.
PREDECESSORS: T12 is done and M5 is [wip].

READ FIRST
  specs/awsf-v2-w08-publish.html - M5 task 13
  dashboard/shared/types.ts - the LifecycleState union
  dashboard/src/components/StateRibbon.vue - the eight-state ribbon that ends at LANDED
  dashboard/src/display.ts - stateTone and stateLabel, and the twelve formatters around them

DO
  Add "PUBLISHED" to LifecycleState. Add PUBLISHED as the ribbon's ninth cell - the ribbon is the
  happy path, not the whole state set, and BLOCKED and CANCELLED are deliberately absent from it
  and stay absent. stateTone returns "ok" for PUBLISHED and stateLabel gives it a glyph in the
  idiom of the existing five.

DO NOT
  Perturb formatCost or any of the thirteen existing formatters - W02 pinned eighteen assertions
  across three files, and this task extends rather than touches them. Add BLOCKED or CANCELLED to
  the ribbon. Change what LANDED renders as.

DEFINITION OF DONE
  Every box in M5 task 13. npm run typecheck:dashboard green - the union is exhaustively switched
  in more than one place and the compiler is what finds them. npm run test:unit green.
  Mark this leaf task and T13 together; leave M5 [wip] and the spine W08 marker untouched.
```

### T14 — Testing Strategy: the widened matrix, the seal, and the migration

```
[MODEL: Opus 5 · EFFORT: high — three independent proofs, and the migration one has to be run twice to be believed]

TASK 14 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M5.
PREDECESSORS: T11, T12 and T13 are done.

READ FIRST
  specs/awsf-v2-w08-publish.html - the G8-C card's route table, and M5 task 14
  core/test/unit/transitions.test.ts - the exhaustive pair sweep, now over 121 pairs
  core/src/observability/sqlite.ts - runMigrations, as amended by T11

DO
  Confirm the full 121-pair sweep passes with 27 accepted and 94 rejected, each rejection in the
  class the table names. Write core/test/unit/publish/seal.test.ts: a LANDED attempt accepts an L27
  transition to PUBLISHED; the same attempt refuses an attempt.updated carrying no transition,
  refuses a transition to any other state, and refuses a second L27 once PUBLISHED. Assert each
  refusal by error name, never message text. A PUBLISHED attempt refuses every event with
  SealedAttempt AND its lock is sealed so a second withLock throws - two rows, because they are two
  mechanisms. One row each for the six isTerminalStatus consumers keeping today's behaviour for a
  landed attempt: retry mints attempt n+1, raise refuses with CeilingRaiseAttemptNotLive, watch
  returns, endedAt is set. Write core/test/unit/observability/migration-0004.test.ts against a
  database seeded at user_version = 3: every sessions row survives, PRAGMA foreign_key_check is
  empty afterwards, each child table's REFERENCES sessions(session_id) ON DELETE RESTRICT is intact
  in sqlite_master, a PUBLISHED row inserts, and an orphan child insert is still refused. Run the
  migration twice against the same database and assert the second run is a no-op.

DO NOT
  Assert the migration works by running it once. Skip the foreign_key_check - a rebuild that lost a
  key passes every other assertion in this file. Let a seal test pass on a message string.

DEFINITION OF DONE
  Every box in M5 task 14. npm run test:unit, npm run test:sim, npm run typecheck and npm run lint
  green.
  Mark this leaf task and T14 together; set M5 to [x] and leave the spine W08 marker untouched.
```

### T15 — The command, the single authorization call, and the L27 transition

```
[MODEL: Opus 5 · EFFORT: high — the ordering of the push and the transition is the opposite of landing's, deliberately, and the residual has no rollback]

TASK 15 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M6.
PREDECESSORS: T14 is done and M5 is [x]. Q2 is decided: publication is an L27 transition.

READ FIRST
  specs/awsf-v2-w08-publish.html - Questionable Q2, and M6 task 15
  core/src/cli/commands/land.ts - IN FULL. The shape this command follows, and the OPPOSITE
    ordering: LANDING is made durable before Git moves
  core/src/git/land.ts - recoverLanding, the idiom for a residual with one honest interpretation
  core/src/cli/main.ts - CLI_COMMANDS and the case arms that construct processOwnerTerminal()
  core/test/unit/meta/no-write-route.test.ts and no-land-route.test.ts - what must stay green

DO
  Create core/src/cli/commands/publish.ts in the shape of land.ts: locate the attempt, resolve the
  repository's catalog publish block, observe, display, confirm ONCE, authorize ONCE, run, then
  transition. Display the exact revision, the remote name, the branch, whether this is a creation
  or a fast-forward, and the fourteen-row verdict - NEVER the URL. Declining returns without a
  push, without a transition and without a journal record. A repository with no publish block is
  refused BEFORE any observation runs, so an unpublishable repository never spawns Git at all.
  THE ORDERING THAT MATTERS: the push runs BEFORE the L27 transition is persisted, and the
  transition records what the remote did. A transition persisted first would claim a publication
  that had not happened. This is the opposite of L20, where LANDING is durable before Git moves,
  and the difference is deliberate: landing is recoverable locally, a push is not undoable. Name
  the residual in a comment - a push that succeeds and a transition that then fails leaves the
  remote ahead of the journal - and handle it as recoverLanding handles its own: a retry of
  awsf publish on the same revision observes already-current and completes the transition. Add the
  publish arm to core/src/cli/main.ts constructing processOwnerTerminal(), and add "publish" to
  CLI_COMMANDS.

DO NOT
  Invent a rollback - there is none for a push. Persist the transition before the push. Add
  anything to API_ROUTE_TABLE or let anything under core/src/api/** import the publish path.
  Display or log the remote URL. Authorize twice, or add a branch that reaches publishArgv without
  authorizing.

DEFINITION OF DONE
  Every box in M6 task 15. npm run typecheck, npm run lint,
  node --test core/test/unit/meta/no-write-route.test.ts and
  node --test core/test/unit/meta/no-land-route.test.ts green.
  Mark this leaf task and T15 together; set M6 to [wip] and leave the spine W08 marker untouched.
```

### T16 — The record, and what it must not carry

```
[MODEL: Sonnet 5 · EFFORT: medium — one additive union member whose whole design is the list of fields it does not have]

TASK 16 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M6.
PREDECESSORS: T15 is done and M6 is [wip]. Q4's decision applies: stderr is never retained.

READ FIRST
  AGENTS.md - invariants 1, 9 and 10
  specs/awsf-v2-w08-publish.html - M6 task 16, and Questionable Q4
  core/src/observability/attempt-evidence.ts - the AttemptEvidence union and the quota-snapshot
    member whose closed field list is the precedent
  core/src/observability/projector.ts - applyAttemptEvidence's switch, which has no default, and
    the lifecycle_state write, which is NOT a no-op

DO
  Add a publish member to AttemptEvidence: { type, remote, branch, publishedSha, outcome,
  remotePriorSha, at }. outcome is the closed vocabulary from T06; remotePriorSha is null for a
  creation. NO URL, no host, no stdout, no stderr, no Git prose, no exit code, no path - a closed
  field list is a stronger scrub than a redacted blob, because redaction runs per value and a Git
  error message is prose that can carry a credential-bearing URL inside it. The record rides the
  L27 transition's attempt.transitioned event rather than a separate attempt.updated: one event,
  one record, one state change, and it is the only record the seal admits after LANDED. A refused
  publish journals nothing and moves no state.

DO NOT
  Write a migration - G8-C already widened lifecycle_state and the evidence member is a silent
  no-op in the projector's switch. Write a summary file, a report, or a receipt. Store the
  porcelain text; store only the derived outcome. Journal a refusal.

DEFINITION OF DONE
  Every box in M6 task 16. npm run typecheck, npm run lint and
  node --test core/test/unit/meta/junk-drawer.test.ts green.
  Mark this leaf task and T16 together; leave M6 [wip] and the spine W08 marker untouched.
```

### T17 — The seventh owner act, and everything that moves with it

```
[MODEL: Sonnet 5 · EFFORT: medium — six sites and one shell script, all of which a single meta-test already knows about]

TASK 17 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M6.
PREDECESSORS: T16 is done and M6 is [wip]. Q7 is decided as recommended: the cascade is in scope.

READ FIRST
  specs/awsf-v2-w08-publish.html - Questionable Q7, the Collisions table in Notes, and M6 task 17
  core/test/unit/meta/boundary-claims.test.ts - IN FULL. It derives the owner acts from main.ts and
    holds every enumerating document to exactly that set
  docs/driving/marimba/delegation-guard.sh - fence 2's verb loop
  core/test/unit/meta/marimba-guard.test.ts - the three-part deny assertion every row carries
  docs/driving/skills/awsf/cookbooks/owner_acts.md, SKILL.md, references/gotchas.md,
    references/lifecycle.md - the five enumeration sites plus the state-machine description

DO
  Add publish to the verb loop in docs/driving/marimba/delegation-guard.sh. Add the matching deny
  rows to core/test/unit/meta/marimba-guard.test.ts with all three assertions: exit 2, the reason
  on stderr, and NOTHING on stdout. Update the five enumeration sites boundary-claims.test.ts will
  otherwise fail on: owner_acts.md line 3 (which says the literal word Six), its body section for
  the new act, SKILL.md twice, and gotchas.md twice. Add awsf publish to README.md so
  doc-reconciliation.test.ts sees a documented command that exists. Write the owner_acts.md section
  for publish saying what it settles and what it FORECLOSES - and it forecloses a great deal: the
  attempt becomes sealed, so this is the last act available on it. Add PUBLISHED and L27 to
  references/lifecycle.md, or the driving tree describes a machine that no longer exists.

DO NOT
  Write the guard's rows from memory - run the guard and observe the deny before asserting it.
  Widen any role's writes glob in awsf.config.yaml; it is a protected path, and these edits are
  made by the driving session running this task, exactly as W01's own were. Describe the TTY check
  as an authorization boundary anywhere - boundary-claims.test.ts bans that claim by pattern.

DEFINITION OF DONE
  Every box in M6 task 17. node --test core/test/unit/meta/boundary-claims.test.ts,
  core/test/unit/meta/marimba-guard.test.ts, core/test/unit/meta/doc-reconciliation.test.ts and
  core/test/unit/meta/driving-tree.test.ts green.
  Mark this leaf task and T17 together; leave M6 [wip] and the spine W08 marker untouched.
```

### T18 — Testing Strategy: the sealed retry and the cascade meta-tests

```
[MODEL: Sonnet 5 · EFFORT: medium — the decision changed what proves idempotence, and both mechanisms are asserted separately]

TASK 18 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M6.
PREDECESSORS: T15, T16 and T17 are done.

READ FIRST
  specs/awsf-v2-w08-publish.html - M6 task 18, and the transcript block's idempotence row
  core/test/unit/publish/_bare.ts - the harness from T08

DO
  IDEMPOTENCE, AND Q2 CHANGED WHAT PROVES IT. A second awsf publish on a PUBLISHED attempt is
  refused by the state machine with SealedAttempt - assert that FIRST, because it is now the
  primary mechanism. Assert Git's already-current separately, at the module level, as the backstop
  for a retry that reaches the push after a transition failed. A declined confirmation runs no
  push, persists no transition and journals nothing - asserted on the injected runner having
  recorded no push AND on the journal length being unchanged. The journalled record round-trips and
  carries no ://, no @, and no value containsCredential matches - swept over the SERIALIZED line.
  The projection shows lifecycle_state = 'PUBLISHED' after a publish, which is the end-to-end proof
  that G8-C's migration and the projector agree. Run boundary-claims.test.ts and confirm SEVEN
  derived acts and that the derivation still discriminates: retry is a case arm and must still not
  be derived as an act. Run marimba-guard.test.ts having first observed the new deny row FAIL
  against the unmodified guard.

DO NOT
  Assert idempotence only on Git's behaviour - the state machine is now the primary mechanism.
  Sweep the record object instead of its serialized form. Reach the network.

DEFINITION OF DONE
  Every box in M6 task 18. npm run test:unit, npm run typecheck, npm run lint, and
  node --test core/test/unit/meta/boundary-claims.test.ts core/test/unit/meta/marimba-guard.test.ts
  core/test/unit/meta/doc-reconciliation.test.ts core/test/unit/meta/driving-tree.test.ts
  core/test/unit/meta/no-land-route.test.ts core/test/unit/meta/no-write-route.test.ts green.
  Mark this leaf task and T18 together; set M6 to [x] and leave the spine W08 marker untouched.
```

### T19 — Verify the invariant 8 amendment landed, and stop if it did not

```
[MODEL: Sonnet 5 · EFFORT: low — a read and a decision, and the decision is to stop]

TASK 19 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M7.
PREDECESSORS: T18 is done and M6 is [x]. THIS TASK IS GATE G8-A.

READ FIRST
  AGENTS.md - invariant 8, as it currently stands
  specs/awsf-v2-w08-publish.html - The Invariant 8 Amendment section IN FULL, and the Gates section
  awsf.config.yaml - policy.protected_paths, which lists AGENTS.md
  core/src/policy/path-policy.ts - protected-path as an independent rejection

DO
  Read AGENTS.md and confirm invariant 8 carries the amended text drafted in the plan - specifically
  the phrase "no push path exists from any pre-LANDED state" and the two named enforcing files. If
  it HAS landed, record the commit SHA in this plan's Amendments section in the same commit as the
  marker flip, and confirm no other invariant moved in that commit. IF IT HAS NOT LANDED: mark this
  task [f], mark M7 [f], STOP, and report to the owner that the workstream cannot proceed and that
  the alternative recorded in the plan's Amendment section part 5 stands.

DO NOT
  Edit AGENTS.md. Add an override, an exemption, an allowlist entry, or a comment asking a later
  session to skip this check. Propose a mechanism that lets an agent write a protected path. Carry
  on to T20 with the amendment absent. No agent may write a protected path, and routing around one
  is not an option this ticket set offers.

DEFINITION OF DONE
  Every box in M7 task 19, or this task and M7 both marked [f] with the reason recorded.
  Mark this leaf task and T19 together; set M7 to [wip] and leave the spine W08 marker untouched.
```

### T20 — Amend the absence scan: remove one clause, add three

```
[MODEL: Opus 5 · EFFORT: high — the amended fence must end up stricter than what it replaces, and each new pattern must be seen red]

TASK 20 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M7.
PREDECESSORS: T19 is done and the amendment has landed. If T19 is [f], STOP.

READ FIRST
  AGENTS.md - the AMENDED invariant 8
  specs/awsf-v2-w08-publish.html - The Invariant 8 Amendment part 3, the Problem section's
    six-specimen table, and M7 task 20
  core/test/unit/meta/no-destructive-paths.test.ts - the nine patterns as they stand

DO
  Remove /git\s+push/ and NOTHING ELSE; the other eight patterns stay exactly as they are. Add
  three patterns banned everywhere in core/src INCLUDING argv.ts: a plus-prefixed refspec literal,
  a refspec literal with an empty source, and a refspec literal with an all-zeros source. Each
  carries a comment citing what it was measured to do - (forced update) at exit 0, and [deleted] at
  exit 0 twice. Rewrite the file's header to say what the invariant now claims and which of the
  three legs holds which half, so a reader arriving at this file alone learns the push clause MOVED
  rather than that it vanished. Add a bite companion in the same file feeding each new pattern a
  synthetic offender held in memory, because the existing test walks real files and would pass
  vacuously against a pattern that never matches anything.

DO NOT
  Remove or weaken any of the other eight patterns. Exempt argv.ts from the three new ones - the
  force and delete clauses stay unconditional everywhere. Trust a pattern you have not seen match.

DEFINITION OF DONE
  Every box in M7 task 20. node --test core/test/unit/meta/no-destructive-paths.test.ts green
  against the tree, and each new pattern observed red against its synthetic offender.
  Mark this leaf task and T20 together; leave M7 [wip] and the spine W08 marker untouched.
```

### T21 — The three-leg publish fence, each leg seen red

```
[MODEL: Opus 5 · EFFORT: xhigh — the derivation leg is a TypeScript-compiler-API fence, and the header must state the ceiling honestly]

TASK 21 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M7.
PREDECESSORS: T20 is done and M7 is [wip].

READ FIRST
  specs/awsf-v2-w08-publish.html - The Invariant 8 Amendment part 3's three-leg table, and M7
    task 21
  core/test/unit/meta/quota-fence.test.ts - IN FULL. The compiler-API idiom, its caching, and its
    header's honesty about where a fence is necessarily weaker
  core/test/unit/meta/child-process-fence.test.ts - the locality idiom
  core/src/state/task-machine.ts - TASK_STATES, imported by the condition leg

DO
  Write core/test/unit/meta/publish-fence.test.ts with three legs. LOCALITY: walk core/src and
  assert the push token appears in exactly one file, core/src/publish/argv.ts. DERIVATION: through
  the TypeScript compiler API, assert publishArgv declares exactly one parameter, that its type
  resolves to a declaration in core/src/publish/authorize.ts, and that no file under core/src other
  than authorize.ts constructs that type or casts to it. CONDITION: import TASK_STATES and assert
  authorizePublish returns not-landed for every member except LANDED, and that the refused count
  equals TASK_STATES.length - 1 - which now includes PUBLISHED, so this leg also proves a second
  publish is refused by the TABLE and not only by the seal. Write the header naming the residual
  the amendment already names: the brand is defeatable by a sufficiently indirect cast, the
  derivation leg scans for a cast, and the locality leg is what still holds if the scan is evaded.
  STATE THE CEILING rather than implying there is none. Prove each leg red before trusting it: add
  the token to a second file; construct a plan by hand in a third; add a synthetic state to a copy
  of the state list and watch the count assertion fail. Revert all three.

DO NOT
  Copy the state list into this file, or hardcode ten. Write a regex clever enough to over-fire -
  the surrounding fences' headers explain why an over-firing fence teaches authors to stop writing
  plainly. Skip the red proof for any leg.

DEFINITION OF DONE
  Every box in M7 task 21. node --test core/test/unit/meta/publish-fence.test.ts green, with each
  leg recorded as having been seen red against a deliberate violation that was then reverted.
  Mark this leaf task and T21 together; leave M7 [wip] and the spine W08 marker untouched.
```

### T22 — Testing Strategy: the fences bite and nothing else moved

```
[MODEL: Sonnet 5 · EFFORT: medium — a sweep whose most important assertion is that one file has no diff]

TASK 22 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M7.
PREDECESSORS: T20 and T21 are done.

READ FIRST
  specs/awsf-v2-w08-publish.html - M7 task 22
  core/test/unit/meta/no-land-route.test.ts - the second fence invariant 8 names

DO
  Confirm all three fence legs green against the tree and each recorded as having been seen red.
  Confirm no-destructive-paths.test.ts green with its three new patterns each seen red against a
  synthetic offender. Confirm no-land-route.test.ts green AND UNMODIFIED - a diff on that file
  would mean scope crossed a line, so check git status on it explicitly rather than only running
  it. Confirm child-process-fence.test.ts green: the publish path added no importer. Confirm
  dependency-allowlist.test.ts green: this workstream added no dependency. Confirm
  state-purity-fence.test.ts and sqlite-write-fence.test.ts green: the state module stayed pure
  through G8-B, and only the three permitted files write SQLite through G8-C.

DO NOT
  Modify no-land-route.test.ts. Lower any assertion to get a green. Skip the explicit unmodified
  check on the strength of the test passing.

DEFINITION OF DONE
  Every box in M7 task 22. npm run test:unit, npm run typecheck and npm run lint green, and
  node --test core/test/unit/meta/publish-fence.test.ts
  core/test/unit/meta/no-destructive-paths.test.ts core/test/unit/meta/no-land-route.test.ts
  core/test/unit/meta/child-process-fence.test.ts
  core/test/unit/meta/dependency-allowlist.test.ts
  core/test/unit/meta/state-purity-fence.test.ts
  core/test/unit/meta/sqlite-write-fence.test.ts green.
  Mark this leaf task and T22 together; set M7 to [x] and leave the spine W08 marker untouched.
```

### T23 — The journey: landed candidate to bare remote, offline

```
[MODEL: Opus 5 · EFFORT: high — one test carries the workstream's whole claim, including the ten-state refusal sweep]

TASK 23 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M8.
PREDECESSORS: T22 is done and M7 is [x].

READ FIRST
  specs/awsf-v2-w08-publish.html - M8 task 23
  core/test/journeys/human-gate.test.ts - IN FULL. The owner-act journey idiom, and the assertion
    that the API source reaches neither commands/land nor git/land
  core/test/unit/publish/_bare.ts - the harness from T08

DO
  Create core/test/journeys/publish.test.ts. Drive a task to LANDED through the real command
  surface, then publish it to a bare remote created in a temporary directory. The bare repository's
  ls-remote reports the exact landed candidate afterwards; the attempt is PUBLISHED; the journal
  carries exactly one publish record naming that revision, on the L27 transition. A second
  awsf publish on the same task is refused because the attempt is sealed, and the remote ref is
  byte-identical. For EVERY member of TASK_STATES except LANDED - PUBLISHED INCLUDED - drive or
  construct an attempt in that state, attempt a publish, and assert the refusal is not-landed AND
  that the bare repository's refs are unchanged. Extend human-gate.test.ts's API-source assertion
  by name: the API source reaches neither commands/publish nor git/publish. Assert structurally
  that the only remote URLs configured in the whole file are paths under the test's own root.

DO NOT
  Resolve a hostname or open a socket. Copy the state list - iterate TASK_STATES as imported. Let a
  refusal pass on the message text rather than the code. Leave a temporary directory referenced
  from a committed file.

DEFINITION OF DONE
  Every box in M8 task 23. npm run test:journeys, npm run typecheck and npm run lint green.
  Mark this leaf task and T23 together; set M8 to [wip] and leave the spine W08 marker untouched.
```

### T24 — Testing Strategy and the close

```
[MODEL: Opus 5 · EFFORT: high — the full offline suite, the deployment-absence check, and the only task that touches the spine]

TASK 24 of 24. Plan: specs/awsf-v2-w08-publish.html, milestone M8.
PREDECESSORS: T23 is done. Every other leaf marker is [x].

READ FIRST
  specs/awsf-v2-w08-publish.html - Validation Commands, M8 task 24, and the What This Workstream Is
    Not section one final time
  specs/awsf-v2-plan.html - the W08 block's checklist, which this task closes

DO
  Run the full offline suite: npm run test:unit, npm run test:contract, npm run test:sim,
  npm run test:journeys, npm run typecheck, npm run lint. The simulation suite is named explicitly
  because it carries the second TERMINAL_STATES literal. Confirm ticket-plan-sync.test.ts green:
  every task has a ticket, states mirror markers, each ticket's prompt is byte-identical to its
  Section B block, and the identifier-spine coverage rows all pass. Confirm every milestone is [x]
  and every ticket in specs/tickets/awsf-v2-w08-publish/ is done. Confirm ALL THREE amendments are
  recorded in this plan's Amendments section with their commit SHAs - G8-A's invariant, G8-B's
  state and edge, and G8-C's migration. Check that the word deploy appears ZERO times in
  core/src/publish/**, core/src/git/publish.ts and core/src/cli/commands/publish.ts, and that no
  field in the catalog's publish block names an environment, an endpoint or a release - absorbing
  W13's scope is the failure mode the spine names for this workstream specifically. ONLY THEN flip
  W08's marker in specs/awsf-v2-plan.html to [x] and specs/tickets/awsf-v2-plan/W08.md to done, in
  the same commit.

DO NOT
  Flip the spine marker before every other box is checked. Lower any assertion to reach a green.
  Record a Questionable as open - all eight were decided on 2026-08-25.

DEFINITION OF DONE
  Every box in M8 task 24 and every box in the plan's Validation Commands section. The whole suite
  green with no network anywhere in it.
  Mark this leaf task and T24 together; set M8 to [x]; flip the spine W08 marker LAST.
```
