# AWSF v2 candidates: adversarial second review

All review claims are dated **2026-08-20**. Each evidence tag states a source kind, the date observed, and a citable anchor. Recommendations are labelled `review-judgment`; they are decisions from this review, not facts imported from a source. [review-method, 2026-08-20, review brief §Method]

## A. Sources declared

### Roles

- **Target:** `agentic-workflow-software-factory` at `/mnt/d/Santiago Marin/Project Repositories/Agentic Orchestration/agentic-workflow-software-factory`. This role settles whether a candidate fits the current product and code. [owner-provided, 2026-08-20, review brief §Repositories]
- **Factory:** the same `agentic-workflow-software-factory` repository. Target and factory are the same repository, but this review keeps the checks separate: target evidence settles fit, while factory evidence must name a workflow, tier, worktree, and gates. [owner-provided, 2026-08-20, review brief §Repositories; document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md` §2.3.6]
- **Reference:** `firstmate` at commit `87681a4`, `blueprint` at `37d3a88`, `factory` at `6f18d8e`, and `quota-axi` v0.1.29. These sources settle only their own behavior and claims, not AWSF fit or buildability. [reference-source, 2026-08-20, commands `git -C ../firstmate rev-parse --short HEAD`, `git -C ../blueprint rev-parse --short HEAD`, `git -C ../factory rev-parse --short HEAD`; `../quota-axi/package.json:1-12`]

### Read

- I read all 2,244 lines of `specs/awsf-v2-candidates.md`, then re-read its decisions table, Still open list, and §2.3.6. [target-source, 2026-08-20, `specs/awsf-v2-candidates.md:1-2244`]
- I read all twelve invariants in `AGENTS.md`. [target-source, 2026-08-20, `AGENTS.md:1-65`]
- I skimmed the plan's M11 status, Portability Matrix, Explicitly Not Built, Validation, Questionables, and Rejected alternatives. [target-source, 2026-08-20, `specs/awsf-plan.html:1278-1332`, `specs/awsf-plan.html:1965-2050`, `specs/awsf-plan.html:2144-2164`]
- I read `awsf.config.yaml`, targeted portions of `core/src/state/**`, `core/src/workflow/**`, the CLI, adapters, broker, policy code, and the driving-document meta-tests. [target-source, 2026-08-20, `awsf.config.yaml:1-105`; `core/src/state/task-machine.ts:1-506`; `core/src/execution/transport-broker.ts:1-400`; `core/src/policy/sandbox-broker.ts:1-211`; `core/test/unit/meta/execution-isolation.test.ts:1-82`]
- I read the last 15 commits and inspected commit `5376c80`, which adds 632 lines total: 105 under §2.7 and 527 under §2.8. [command-output, 2026-08-20, commands `git log --oneline -15` and `git show --stat 5376c80`; output `specs/awsf-v2-candidates.md | 632 insertions(+)`]
- I read the `firstmate` delegation-guard contract and executable, its knowledge-placement rule, and its script index. I did not treat its prose as proof of AWSF fit. [reference-source, 2026-08-20, `../firstmate/docs/subagent-guard.md:1-190`; `../firstmate/bin/fm-subagent-pretool-check.sh:1-238`; `../firstmate/.agents/skills/firstmate-coding-guidelines/SKILL.md:1-120`]
- I read targeted Blueprint and Factory anchors for architecture review, requirement IDs, planning output, stopping points, and documentation lifecycle. [reference-source, 2026-08-20, `../blueprint/skills/architecture-review/SKILL.md:1-96`; `../blueprint/skills/plan/SKILL.md:1-73`; `../blueprint/guides/workflows.md:69`; `../factory/docs/README.md:1-58`]
- I read targeted quota-axi sources for its scope, schema, stale states, credential paths, and Codex fallback. [reference-source, 2026-08-20, `../quota-axi/VISION.md:1-75`; `../quota-axi/src/types.ts:1-274`; `../quota-axi/src/providers/codex.ts:1-154`; `../quota-axi/src/providers/claude.ts:1-180`]

### Executed read-only checks

- `npm run typecheck` exited 0 across core and dashboard. [command-output, 2026-08-20, command `npm run typecheck`; output ended with `vue-tsc -p dashboard/tsconfig.json --noEmit` and exit 0]
- `npm run test:contract` passed 53/53. [command-output, 2026-08-20, command `npm run test:contract`; output `tests 53`, `pass 53`, `fail 0`]
- `npm run test:unit` failed 1 of 988 because the repository-root `.claude/` directory exists. [command-output, 2026-08-20, command `npm run test:unit`; output `tests 988`, `pass 987`, `fail 1`, failing `the repository root contains no .claude/`]
- The focused execution-isolation test reproduced the same failure in 0.36 seconds. [captured-bytes, 2026-08-20, command `node --experimental-strip-types --test core/test/unit/meta/execution-isolation.test.ts`; output `tests 2`, `pass 1`, `fail 1`, exit 1]
- A harmless PTY probe showed that a non-TTY caller can allocate a pseudo-terminal and script a confirmation. [captured-bytes, 2026-08-20, command `python3` spawning `script -qec <node readline probe> /dev/null`; output `exit=0`, `stdin.isTTY=true`, `answer=yes`, `stderr=b''`]
- The installed delegation guard was exercised with five raw payloads. `ListAgents` was denied, `TaskOutput`, `mcp__foo__task`, and `Read` were allowed, and malformed JSON failed open. [captured-bytes, 2026-08-20, command `python3` invoking `~/.claude/marimba/delegation-guard.sh`; captured exit/stdout/stderr recorded under §2.8 below]
- The working tree remained clean after these checks. The local `.claude/settings.local.json` is ignored rather than absent. [command-output, 2026-08-20, commands `git status --short --untracked-files=all` and `git status --short --ignored .claude`; outputs empty and `!! .claude/` respectively]

### Not read, with reasons

- I did not read all of `specs/awsf-plan.html`, `core/src/state/**`, `core/src/workflow/**`, or `docs/driving/**`, because the brief required a skim and every finding below uses targeted anchors. [owner-provided, 2026-08-20, review brief §Read first]
- I did not read the Smart Health repositories. They exist according to §2.3, but the findings below challenge AWSF's one-repository state model rather than the stated stacks of those projects. [absent-source, 2026-08-20, reason: source exists and was not gathered because no finding depends on its contents; `specs/awsf-v2-candidates.md` §2.3]
- I did not read all of `blueprint`, `factory`, `firstmate`, or `quota-axi`. Targeted files were sufficient for the external claims this review uses. [absent-source, 2026-08-20, reason: sources exist and only named claims required them]
- I did not read `../fusion-harness` or run `mf`. The decisive 2.2 finding is in AWSF's broker and ledger, while the runtime event bytes needed for an executable parser are not retained in the target repository. [absent-source, 2026-08-20, reason: reference source exists but AWSF fit is already decidable from factory code; `core/src/execution/call-budget.ts:360-411`; `core/src/execution/transport-broker.ts:309-392`]

### Could not gather

- I could not gather the raw successful `agy`, `mf`, quota-axi, Claude prompt, Pi prompt, or delegation live-run byte streams described in the document. The document retains excerpts and summaries, but it names no durable capture path and the target fixtures contain no `agy`, `mf`, or quota-axi capture. [absent-source, 2026-08-20, reason: a source existed in an earlier session but was not retained at a citable target path; commands `find core/test/fixtures -type f -print | rg '/(agy|antigravity|fusion|mf|quota-axi)'` and `rg -n "quota-axi|effectiveAvailability" core/test/fixtures core/test core/src` returned no matching fixture]
- I could not gather macOS behavior because this machine is WSL2 and no macOS runner was supplied. [command-output, 2026-08-20, command `uname -a`; output contains `microsoft-standard-WSL2`; owner-provided, 2026-08-20, review brief §Today]
- I did not run inference, quota, authentication, remote-write, or publish probes. Those checks either spend provider capacity, touch credentials, mutate an external surface, or require unavailable hardware. [review-boundary, 2026-08-20, review brief §Hard constraints]

## B. Verdict table

| Id | Title | Strength | Ambiguous | One-line reason |
|---|---|---|---|---|
| 1.1 | Repair typecheck and amend D2 | strong | yes | Implemented evidence is current and reproducible, but the section still reads as pending work. [review-judgment, 2026-08-20, `specs/tickets/T37.md:1-19`; command `npm run typecheck`, exit 0] |
| 1.2 | Close WSL2 portability rows | strong | yes | T38 and 53/53 contract tests prove closure, while the candidate text remains prospective. [review-judgment, 2026-08-20, `specs/tickets/T38.md:1-18`; command `npm run test:contract`] |
| 1.3 | Linux desktop column | strong | no | The owner statement is the primary source for machine ownership and the plan now records dated deferrals. [review-judgment, 2026-08-20, `specs/awsf-plan.html:1278-1288`] |
| 1.4 | macOS column | medium | no | Pending status is honest, but neither the hardware claim nor Darwin behavior is independently verified here. [review-judgment, 2026-08-20, `specs/awsf-plan.html:1288`; command `uname -a`] |
| 2.1 | Antigravity adapter graduation | weak | yes | The stream evidence is promising, but the taken viability decision substitutes post-run detection for a write and external-mutation boundary. [review-judgment, 2026-08-20, `core/src/policy/sandbox-broker.ts:196-205`; `specs/awsf-v2-candidates.md` decisions 13-14] |
| 2.2 | Fusion adapter via `mf` | weak | yes | One outer `mf` GO spends the full reservation and bypasses per-provider broker registration, so parsed events cannot deliver the claimed economics and supervision. [review-judgment, 2026-08-20, `core/src/execution/call-budget.ts:384-411`; `core/src/execution/transport-broker.ts:309-392`] |
| 2.3 | Greenfield planning phase | weak | yes | It bundles bootstrap, registry, cross-repo execution, design governance, a skill migration, and a five-stage workflow while two state-shaping forks remain open. [review-judgment, 2026-08-20, `specs/awsf-v2-candidates.md` §2.3 and Still open] |
| 2.4 | `awsf publish` | medium | yes | Post-`LANDED` and human-initiated is the right boundary, but the replacement invariant and remote authorization contract are not designed. [review-judgment, 2026-08-20, `AGENTS.md:34-37`; `core/test/unit/meta/no-destructive-paths.test.ts:6-22`] |
| 2.5 | System prompt engineering | medium | yes | Per-role scoping is sound, but the claimed single insertion point and two-call efficacy test are too weak. [review-judgment, 2026-08-20, `core/src/cli/commands/production-run.ts:618`; `core/src/cli/commands/rework.ts:401-418`; `core/src/cli/commands/review-phase.ts:515-528`] |
| 2.6 | Non-technical cheatsheet | medium | yes | The deliverable is feasible, but “every command and flow” has no bounded information architecture or user test. [review-judgment, 2026-08-20, `core/src/cli/main.ts:32-36`; `docs/driving/skills/awsf/SKILL.md:69-93`] |
| 2.7 | Quota telemetry | weak | yes | O1 is useful, while O2 cannot attribute account-window movement to one task and the section's O3 identifier contradicts itself. [review-judgment, 2026-08-20, `specs/awsf-v2-candidates.md:1399-1497`, `:1565-1585`] |
| 2.8 | `marimba` | weak | yes | The applied local settings make the unit suite red, the TTY boundary is bypassable, and two claimed existing fences do not cover the proposed contract. [review-judgment, 2026-08-20, focused test and PTY captures in §2.8] |

## C. Disagreement register

| Code | Section | Original claim | Counter-claim | Evidence | What changes if this review is right | Cheapest upgrade and run status |
|---|---|---|---|---|---|---|
| DR1 | Part 1 | 1.1-1.3 are closeout work to do. [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md` Part 1] | They are completed historical records and must not enter a v2 backlog. [review-judgment, 2026-08-20, plan M11 and tickets T37-T38] | T37 and T38 are `state: done`; M11 is `[x]`; typecheck exits 0 and contract tests pass 53/53. [target-source and command-output, 2026-08-20, `specs/tickets/T37.md:1-19`; `specs/tickets/T38.md:1-18`] | Archive them as prerequisites and carry only 1.4's pending hardware gate. [review-judgment, 2026-08-20, same anchors] | Re-run the named commands, zero provider calls. Run: yes. [command-output, 2026-08-20, `npm run typecheck`; `npm run test:contract`] |
| DR2 | Part 2 status | Nothing below Part 2 is committed. [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md:113-117`] | Part 2 mixes parked proposals with applied owner-local changes and a committed `.gitignore` adaptation. [review-judgment, 2026-08-20, §§2.5, 2.7, 2.8] | Commit `5ad6f4c` adds `.claude/` to `.gitignore`; §§2.5 and 2.7 say their driving changes were applied. [command-output and target-source, 2026-08-20, `git show 5ad6f4c`; `specs/awsf-v2-candidates.md:1195-1216`, `:1593-1624`] | Add explicit states such as `implemented-outside-repo`, `taken`, and `candidate`; stop calling the whole part parked. [review-judgment, 2026-08-20, same anchors] | Inventory each section's actual state, under one hour. Run: yes for tracked and local 2.8 state. [command-output, 2026-08-20, `git log --oneline -15`; `git status --ignored .claude`] |
| DR3 | 2.1, decisions 13-14 | Worktree containment, stream inspection, and `path-policy` adequately bound write-capable `agy`. [document-under-review, 2026-08-20, decisions 13-14] | They detect a subset of repository writes after execution and do not prevent shell, network, schedule, message, or out-of-worktree mutation. [review-judgment, 2026-08-20, policy code] | `PermissionSession.enforce()` fingerprints one Git worktree after the provider returns; WSL2 currently reports `tool-policy`, not OS enforcement. [factory-source, 2026-08-20, `core/src/policy/sandbox-broker.ts:175-205`; command `npm run test:contract`, matrix output `badge=tool-policy`] | Reject decisions 13-14 and keep the adapter disabled until a captured preventive tool scope or OS boundary exists. [review-judgment, 2026-08-20, AGENTS invariants 3-4 and Explicitly Not Built] | One adversarial, throwaway, successful `agy` run across every mutating tool family. Cost: one provider call. Run: no. [review-boundary, 2026-08-20, no live inference authorized] |
| DR4 | 2.2, decisions 5, 9, 17 | Parsing `mf` events recovers per-call settlement while unchanged `path-policy` owns writes across role worktrees. [document-under-review, 2026-08-20, §2.2 and decisions 5, 9, 17] | Current AWSF spends the whole composite reservation when the single outer process gets GO, registers only that process, and owns one worktree per attempt. [review-judgment, 2026-08-20, broker, ledger, status model] | `spendOnGo()` settles full cost; `AttemptStatus` has one `repository` and one `worktree`; production opens one `PermissionSession`. [factory-source, 2026-08-20, `core/src/execution/call-budget.ts:384-411`; `core/src/cli/commands/attempt.ts:68-76`; `core/src/cli/commands/production-run.ts:1062-1073`] | Either port fusion orchestration into AWSF so every child crosses the broker, or weaken the promise to one fully spent opaque composite with no per-child supervision. [review-judgment, 2026-08-20, same anchors] | A fake-`mf` broker test demonstrating settlement and process rows, under one hour. Run: no because it requires new test code. [review-judgment, 2026-08-20, same anchors] |
| DR5 | 2.3, decisions 20 and 22 | A pre-repository skill and post-repository recipe can share a shape without putting a skill in execution. [document-under-review, 2026-08-20, §2.3.5 collision 4] | The proposed recipe explicitly invokes planf3, Pi disables skills, and marimba's guard removes the fresh subagent needed for pre-repository independent review. [review-judgment, 2026-08-20, target and reference sources] | The component list says the recipe invokes the skill; Pi passes `--no-skills`; Blueprint requires a fresh subagent; the local deny list removes `Task` and `Agent`. [target-source and reference-source, 2026-08-20, `specs/awsf-v2-candidates.md:496-498`; `core/src/adapters/pi-codex.ts:624-629`; `../blueprint/skills/architecture-review/SKILL.md:10-16`; `.claude/settings.local.json:1-4`] | Make bootstrap deterministic and minimal, then run design and review only as AWSF recipes inside the new repository. [review-judgment, 2026-08-20, same anchors] | Write the pre-repo/post-repo authority table, one to two hours, no calls. Run: no. [review-judgment, 2026-08-20, same anchors] |
| DR6 | 2.3.6, decision 24 | Naming one cheapest unused upgrade would have caught the `agy` error and is the main protection against confirmation. [document-under-review, 2026-08-20, §2.3.6] | That check is identifiable only after learning that cwd mattered; one guessed upgrade can preserve confirmation bias. [review-judgment, 2026-08-20, §2.1's own retraction chronology] | The earlier investigation tested three hypotheses before discovering cwd, and §2.3.8 still calls the rule undecided while decision 24 calls it taken. [target-source, 2026-08-20, `specs/awsf-v2-candidates.md:338-386`, `:1067-1068`, `:2199`] | Keep source roles and absence reasons, then add a falsification requirement for high-impact decisions and define a machine-readable claim record before calling the rule enforced. [review-judgment, 2026-08-20, same anchors] | Reconcile the section and decision row, then draft one falsification row. Cost: under one hour. Run: no because the reviewed file is read-only. [review-judgment, 2026-08-20, review brief §Hard constraints] |
| DR7 | 2.3, 2.6, decisions 7 and 22 | The ladder is last in v2 and the cheatsheet is also the closing deliverable. [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md:749-751`, `:1224-1234`] | Both cannot be last under one total order. [review-judgment, 2026-08-20, same anchors] | The two explicit sequencing statements conflict. [target-source, 2026-08-20, same anchors] | Sequence the ladder last among executable capabilities and the cheatsheet after it as the final artifact. [review-judgment, 2026-08-20, dependency on stable CLI and recipes] | Draw the dependency DAG, about 30 minutes. Run: done in §D. [review-judgment, 2026-08-20, §D below] |
| DR8 | 2.4, decision 16 | A state-aware replacement for the no-push string scan is enough to admit publish. [document-under-review, 2026-08-20, §2.4] | State is only one authorization dimension; exact SHA, canonical cleanliness, remote, refspec, force prohibition, credential handling, and idempotency also need executable guards. [review-judgment, 2026-08-20, current land and no-push code] | The current test is only a source scan, and `landCommand` proves exact-candidate authorization before canonical mutation. [factory-source, 2026-08-20, `core/test/unit/meta/no-destructive-paths.test.ts:6-22`; `core/src/cli/commands/land.ts:232-286`] | Specify `authorizePublish()` and fence the sole push argv site before adding the command. [review-judgment, 2026-08-20, same anchors] | Test against a local bare remote, no network, half a day. Run: no because publish code does not exist. [review-judgment, 2026-08-20, same anchors] |
| DR9 | 2.5, decision 25 | A shared worker preamble has one natural insertion point and a two-call comparison measures benefit. [document-under-review, 2026-08-20, §2.5] | Current prompt composition is repeated in production, rework, and review paths, and one sample per arm cannot separate prompt effect from model variance. [review-judgment, 2026-08-20, target code] | Three distinct readers assign `systemPrompt`; no deterministic seed or paired-control protocol is named. [factory-source, 2026-08-20, `core/src/cli/commands/production-run.ts:618`; `core/src/cli/commands/rework.ts:401-418`; `core/src/cli/commands/review-phase.ts:515-528`] | Centralize composition first and require a repeated role-specific benchmark before enabling worker-wide text. [review-judgment, 2026-08-20, same anchors] | Trace all composition sites, five minutes, no calls. Run: yes. [command-output, 2026-08-20, `rg -n "systemPrompt" core/src`] |
| DR10 | 2.7 and 2.8 | “O3 captured” in §2.7 is an implemented quota option. [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md:1399-1497`] | Those paragraphs describe marimba's delegation guard, while §2.7 later defines O3 as an untaken quota admission check. [review-judgment, 2026-08-20, `specs/awsf-v2-candidates.md:1565-1585`] | Commit `5376c80` inserted the guard material before §2.7's collision section, and decision 27 says quota O3 is not taken. [command-output and target-source, 2026-08-20, `git show 5376c80`; decisions 27 and 30] | Re-home the material under 2.8 and qualify option ids by candidate, such as `Q7-O3` and `M-O3`. [review-judgment, 2026-08-20, same anchors] | Inspect the commit hunk, under a minute. Run: yes. [command-output, 2026-08-20, `git show --unified=3 5376c80`] |
| DR11 | 2.7, decisions 27-29 | Phase-boundary quota snapshots tell what a task cost as a share of the week. [document-under-review, 2026-08-20, §2.7 Scope] | They show account-wide window observations that may include concurrent external use and integer rounding, so they cannot attribute a delta to one task. [review-judgment, 2026-08-20, quota schema and task model] | quota-axi reports provider windows and generated time, not AWSF task identity; AWSF already records per-call token usage separately. [reference-source and factory-source, 2026-08-20, `../quota-axi/src/types.ts:139-226`; `core/src/contracts/normalized-events.ts:179-188`] | Keep O1 as advisory telemetry; label any journal snapshot contextual and do not derive task cost from it. [review-judgment, 2026-08-20, same anchors] | Compare snapshots while another client consumes the same account. Cost: external quota and confounding by design. Run: no. [review-boundary, 2026-08-20, no live quota use] |
| DR12 | 2.8, decision 30 | Ignoring `.claude/` closes the local-settings hazard. [document-under-review, 2026-08-20, §2.8 Applied O3] | The directory's presence violates an existing absence fence even when Git ignores it. [review-judgment, 2026-08-20, focused test] | The focused test exits 1 with `.claude/ exists at the repository root`; `git check-ignore` points to `.gitignore:6`. [captured-bytes and command-output, 2026-08-20, focused test command; `git check-ignore -v .claude/settings.local.json`] | Move settings to an owner-home file and pass it per invocation through a captured, verified settings mechanism. [review-judgment, 2026-08-20, `core/test/unit/meta/execution-isolation.test.ts:26-47`] | Run the focused test. Cost: 0.36 seconds. Run: yes, and it changed the verdict. [captured-bytes, 2026-08-20, focused test output] |
| DR13 | 2.8, decision 30 | TTY requirements structurally keep marimba from owner acts under permission bypass. [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md:1904-1906`, `:2031-2036`] | `process.stdin.isTTY` authenticates a terminal shape, not a human; a same-user shell process can allocate a PTY and answer the prompt. [review-judgment, 2026-08-20, TTY code and capture] | `processOwnerTerminal()` checks only `process.stdin.isTTY`; the harmless `script` probe produced `stdin.isTTY=true` and `answer=yes`. [factory-source and captured-bytes, 2026-08-20, `core/src/cli/tty.ts:10-25`; PTY command in A] | Remove `--dangerously-skip-permissions` from marimba or add an out-of-band owner authorization boundary. Do not describe TTY as authentication. [review-judgment, 2026-08-20, same anchors] | The PTY probe, zero calls and no repository mutation. Run: yes. [captured-bytes, 2026-08-20, PTY output] |
| DR14 | 2.8 | Existing route and command fences automatically cover the proposed contract. [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md:1815-1829`] | The route test hardcodes only `docs/driving/skills/awsf/SKILL.md`, and command reconciliation intentionally ignores prose. [review-judgment, 2026-08-20, meta-tests] | `ROUTER_REL` names only the current router; the command scanner reads shell fences only and documents the prose gap. [factory-source, 2026-08-20, `core/test/unit/meta/driving-routes.test.ts:15-53`; `core/test/unit/meta/doc-reconciliation.test.ts:76-108`] | Extend the route scanner to every declared router or keep the contract route-free and test that property directly. [review-judgment, 2026-08-20, same anchors] | Add the proposed path to an in-memory matcher specimen, under 30 minutes. Run: no because it requires test changes. [review-judgment, 2026-08-20, same anchors] |
| DR15 | 2.8 | No AWSF command mutates outside the state root. [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md:1904-1906`] | `start` creates a managed worktree outside the state root and `land` fast-forwards the canonical repository. [review-judgment, 2026-08-20, CLI code] | `StartCommandOptions.worktreeRoot` is explicitly outside both roots; `land.finish()` calls canonical landing completion. [factory-source, 2026-08-20, `core/src/cli/commands/start.ts:16-24`, `:61-91`; `core/src/cli/commands/land.ts:170-203`] | Replace the claim with the actual guarantees: no push, no automatic deletion, bounded worktree writes, and human-approved local fast-forward. [review-judgment, 2026-08-20, `AGENTS.md:34-37`] | Static source trace, five minutes. Run: yes. [command-output, 2026-08-20, `rg -n "worktreeRoot|completeLanding" core/src/cli/commands`] |
| DR16 | Decision 18 and buildability | Revisable invariants and config can be paid for inside a v2 candidate. [document-under-review, 2026-08-20, decision 18 and candidate collision sections] | Current AWSF workers cannot write `AGENTS.md` or `awsf.config.yaml`, so a protected-file amendment has no factory build route. [review-judgment, 2026-08-20, current grants] | The builder's writes omit both files, the documenter writes Markdown only, and policy marks both paths protected. [factory-source, 2026-08-20, `awsf.config.yaml:32-47`, `:66-74`, `:87-94`; `core/src/policy/path-policy.ts:128-169`] | Every candidate that changes an invariant or protected config needs a separate owner-authored amendment before the managed build, or a new explicitly owner-authorized protected-change mechanism. [review-judgment, 2026-08-20, same anchors] | Compile the changed-path list against current agent grants, under 30 minutes. Run: source trace completed; no workflow was launched. [command-output, 2026-08-20, `awsf.config.yaml` and path-policy inspection] |

#### Decisions 1-30 coverage

The detailed evidence and cheapest upgrades are in the candidate sections named in the last column. [review-method, 2026-08-20, sections below]

| Decision | Disposition on 2026-08-20 | Detailed review |
|---|---|---|
| 1 | Archive as completed, do not plan again. [review-judgment, 2026-08-20, T37 done] | 1.1 |
| 2 | Archive as completed, do not plan again. [review-judgment, 2026-08-20, T38 done] | 1.2 |
| 3 | Keep the dated deferral. [review-judgment, 2026-08-20, plan Portability Matrix] | 1.3 |
| 4 | Revise because Part 2 already mixes proposals and applied work. [review-judgment, 2026-08-20, DR2] | E |
| 5 | Reject the claimed fit of approach (c) under the current broker. [review-judgment, 2026-08-20, DR4] | 2.2 |
| 6 | Keep external-repository support, after a scope cut. [review-judgment, 2026-08-20, one-repository status model] | 2.3 |
| 7 | Keep, with the ladder ordered immediately before the cheatsheet. [review-judgment, 2026-08-20, DR7] | 2.6, D |
| 8 | Keep PATH resolution, conditional on version and fixture checks. [review-judgment, 2026-08-20, executable broker] | 2.2 |
| 9 | Reject “owns the boundary” where no preventive sandbox exists. [review-judgment, 2026-08-20, DR4] | 2.2 |
| 10 | Keep the protocol conclusion, but the raw capture is unavailable to this review. [review-judgment, 2026-08-20, F] | 2.1 |
| 11 | Keep readonly as inexpressible. [review-judgment, 2026-08-20, §2.1.1] | 2.1 |
| 12 | Keep as a portability requirement, pending retained bytes. [review-judgment, 2026-08-20, §2.1.1] | 2.1 |
| 13 | Reject. Detection does not make the route write-bounded. [review-judgment, 2026-08-20, DR3] | 2.1 |
| 14 | Reject. The owner's tolerance does not turn detection into enforcement. [review-judgment, 2026-08-20, DR3] | 2.1 |
| 15 | Keep the registry need, defer its shape until task ownership is decided. [review-judgment, 2026-08-20, Still open] | 2.3 |
| 16 | Revise with an exact authorization contract and stronger fence. [review-judgment, 2026-08-20, DR8] | 2.4 |
| 17 | Mark unproven rather than taken. [review-judgment, 2026-08-20, one-worktree status model] | 2.2 |
| 18 | Keep the revision rule, but require a separate owner-authored protected-file amendment before the managed build. [review-judgment, 2026-08-20, DR16] | Collisions throughout |
| 19 | Split A-G from H and I; the ladder and rename are separate workstreams. [review-judgment, 2026-08-20, scope and buildability findings] | 2.3 |
| 20 | Reverse the pre-repository skill half; bootstrap first, then use recipes. [review-judgment, 2026-08-20, DR5] | 2.3 |
| 21 | Keep the envelope shape, but call the count a review gate rather than proof that the design is correct. [review-judgment, 2026-08-20, review schema limits] | 2.3 |
| 22 | Defer until stage bytes and envelopes exist; place it before 2.6, not after it. [review-judgment, 2026-08-20, Still open and DR7] | 2.3, D |
| 23 | Move to a separate, versioned skill migration outside the AWSF v2 build. [review-judgment, 2026-08-20, out-of-repo buildability] | 2.3 |
| 24 | Revise with falsification and reconcile the taken/undecided contradiction. [review-judgment, 2026-08-20, DR6] | 2.3 |
| 25 | Keep per-role scoping; hold the worker half pending a real benchmark and centralized composition. [review-judgment, 2026-08-20, DR9] | 2.5 |
| 26 | Keep as a conservative limitation, not a captured runtime fact. [review-judgment, 2026-08-20, help-only evidence] | 2.1, 2.5 |
| 27 | Split: take O1, reject task-cost attribution in O2. [review-judgment, 2026-08-20, DR11] | 2.7 |
| 28 | Keep structural rendering from effective availability. [review-judgment, 2026-08-20, quota-axi schema] | 2.7 |
| 29 | Revise; an import fence does not define refresh failure, attribution, or credential exposure. [review-judgment, 2026-08-20, §2.7] | 2.7 |
| 30 | Keep the name only; reject the current permission-bypass rationale and treat P1-P6 separately. [review-judgment, 2026-08-20, DR12-DR15] | 2.8 |

### 1.1 Repair `npm run typecheck` and amend D2

**Strength:** **strong** because the plan, ticket, package scripts, and current compiler run agree that T37 is complete. [target-source and command-output, 2026-08-20, `specs/tickets/T37.md:1-19`; `package.json:20-24`; command `npm run typecheck`, exit 0] Its material defect is temporal framing rather than technical evidence. [review-judgment, 2026-08-20, `specs/awsf-v2-candidates.md` §1.1 versus plan M11]

**Ambiguous:** “This is that amendment.” [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md:28`] Reading A is a proposal to apply the amendment later. [review-judgment, 2026-08-20, sentence tense and Part 1 status] Reading B is a historical statement that T37 already applied it. [target-source, 2026-08-20, `AGENTS.md:24-33`; `specs/tickets/T37.md:1-19`]

**Right, keep as is:** Keep the 835/813/22 history and the reason `@types/node` does not widen runtime dependencies. [review-judgment, 2026-08-20, plan T37 and `AGENTS.md` invariant 7]

**Wrong or unproven:**

- **Wrong as current scope:** this is no longer work to schedule. [review-judgment, 2026-08-20, `specs/awsf-plan.html:1965-1990`; `specs/tickets/T37.md:1-19`]
- **Unproven as a present repository-wide quality claim:** T37's 2026-08-18 full-suite result does not establish the suite on 2026-08-20. [review-judgment, 2026-08-20, `npm run test:unit` now fails 1/988 for an unrelated later local setting]

**Overlooked:** A current validation statement must separate typecheck success from full-suite health, because the former is green and the latter is red today. [command-output, 2026-08-20, `npm run typecheck`, exit 0; `npm run test:unit`, exit 1]

**Cheapest unused upgrade:** Re-run `npm run typecheck`, zero calls and about one compiler pass; I ran it and it exited 0 with both `tsc` and `vue-tsc`. [command-output, 2026-08-20, command and output named above]

**Buildability:** Already built through the `build-review` recipe at T2 in an AWSF-managed worktree, with owner landing and typecheck, all four test layers, lint, the dependency allowlist, and ticket-plan sync as gates. [factory-source, 2026-08-20, `specs/tickets/T37.md:1-19`; commit `94844ee` in `git log --oneline -15`]

**Collisions:** It touched AGENTS invariant 7 and D2; the paid cost was the explicit owner amendment plus the unchanged dependency-allowlist meta-test. [target-source, 2026-08-20, `AGENTS.md:24-33`; plan T37]

### 1.2 Close the seven deferred WSL2 portability rows

**Strength:** **strong** because T38 is done and the platform contract now emits evidence for all seven rows on this WSL2 machine. [target-source and command-output, 2026-08-20, `specs/tickets/T38.md:1-18`; command `npm run test:contract`] The section is stale only in presenting closure as future work. [review-judgment, 2026-08-20, §1.2 versus plan M11]

**Ambiguous:** “Decision: do this before the MacBook Pro arrives.” [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md:75`] Reading A is an outstanding ordering instruction. [review-judgment, 2026-08-20, Part 1 framing] Reading B is the historical ordering T38 already satisfied. [target-source, 2026-08-20, `specs/awsf-plan.html:1288`; `specs/tickets/T38.md:1-18`]

**Right, keep as is:** Keep the distinction between a test-coverage gap and a hardware gap. [review-judgment, 2026-08-20, plan Portability Matrix]

**Wrong or unproven:**

- **Wrong as current scope:** all seven WSL2 cells have already been promoted with qualifications where appropriate. [target-source, 2026-08-20, `specs/awsf-plan.html:1278-1288`]
- **Unproven beyond WSL2:** the 53/53 run says nothing about Darwin, a Linux desktop, or Windows-native. [factory-source, 2026-08-20, `core/test/contract/platform-behaviours.test.ts:1-18`; plan G7]

**Overlooked:** The provider row proves resolution and help/version launch only; it deliberately sends no inference prompt. [factory-source, 2026-08-20, `core/test/contract/platform-behaviours.test.ts:247-298`; contract output `resolution+launch only, no prompt sent`]

**Cheapest unused upgrade:** Re-run `npm run test:contract`, zero provider calls; I ran it and obtained 53/53, exit 0. [command-output, 2026-08-20, command output]

**Buildability:** Already built through `build-review` at T2 in an AWSF-managed worktree, with contract, unit, simulation, journey, typecheck, lint, matrix, and README reconciliation gates. [factory-source, 2026-08-20, `specs/tickets/T38.md:1-18`; commit `34dfee2`]

**Collisions:** It touches G7 and the plan's portability claims; the mechanically checkable guarantee remains that only a machine may promote its own column. [target-source, 2026-08-20, plan Portability Matrix and T38]

### 1.3 Linux desktop column

**Strength:** **strong** because the owner's machine-ownership statement is the primary source for whether work can be scheduled, and the plan now records dated deferrals. [owner-assertion and target-source, 2026-08-20, `specs/awsf-v2-candidates.md` §1.3; `specs/awsf-plan.html:1278-1288`] No repository probe could provide stronger evidence about equipment the owner possesses. [review-judgment, 2026-08-20, claim type]

**Right, keep as is:** Keep `DEFERRED` or `N/A` rather than a false `PENDING`. [review-judgment, 2026-08-20, plan Portability Matrix]

**Wrong or unproven:**

- **Unproven independently:** this review did not inventory the owner's hardware, and a command on WSL2 cannot do so. [absent-source, 2026-08-20, reason: only owner testimony settles ownership]
- **Wrong as current scope:** the column has already been changed from pending to dated deferrals. [target-source, 2026-08-20, `specs/awsf-plan.html:1278-1288`]

**Overlooked:** A future acquired Linux machine must start from `PENDING` and run the matrix locally rather than inheriting WSL2 results. [review-judgment, 2026-08-20, plan G7]

**Cheapest unused upgrade:** None is available beyond a fresh owner statement; I did not ask again because the reviewed document already records the owner decision and no code claim depends on it. [review-judgment, 2026-08-20, §1.3]

**Buildability:** Already landed as part of T38 through `build-review` at T2; future verification is a destination-machine contract/simulation run, not an AWSF feature build. [factory-source, 2026-08-20, `specs/tickets/T38.md:1-18`]

**Collisions:** It touches only G7's evidence rule; the adaptation keeps every unrun Linux cell explicitly unverified. [target-source, 2026-08-20, plan Portability Matrix]

### 1.4 macOS column

**Strength:** **medium** because pending status is accurate for this WSL2 review environment. [command-output and target-source, 2026-08-20, `uname -a`; `specs/awsf-plan.html:1288`] The stronger claim that work is genuinely blocked on one named future machine is owner testimony that this review cannot independently verify. [absent-source, 2026-08-20, reason: no macOS hardware or runner supplied]

**Right, keep as is:** Keep every macOS cell pending until commands run on Darwin. [review-judgment, 2026-08-20, plan G7]

**Wrong or unproven:**

- **Unproven:** possession, arrival date, Apple subscription state, and unattended Keychain behavior are not observable from this machine. [absent-source, 2026-08-20, reason: hardware unavailable; Still open macOS quota item]
- **Unproven:** the current T27 suite does not cover future quota-axi, `agy`, fusion, or publish behavior on macOS. [factory-source, 2026-08-20, `core/test/contract/platform-behaviours.test.ts:1-18` and its seven rows]

**Overlooked:** The first macOS visit needs a versioned checklist that separates existing T27 verification from portability rows introduced by v2 candidates. [review-judgment, 2026-08-20, 2.1, 2.2, 2.7 Still open items]

**Cheapest unused upgrade:** Run `npm run test:contract && npm run test:sim` on the actual Mac, then capture Keychain-gated quota behavior; cost is machine access and no inference calls. I did not run it because no Darwin machine was available. [review-judgment and absent-source, 2026-08-20, plan T27; `../quota-axi/src/providers/claude.ts:35-46`]

**Diagnosis and route to strong:** Define the exact Darwin command list and expected evidence rows now, then execute it unchanged on the destination machine and date each promoted cell. [review-judgment, 2026-08-20, plan G7] Do not turn hardware ownership into an AWSF task. [review-judgment, 2026-08-20, scope boundary]

**Buildability:** This is a platform-verification activity in the canonical checkout, followed by a documentation-only matrix update through `simple-sdlc` at T2 if code or plan evidence changes. The proving gates are contract, simulation, typecheck, unit, and the portability reconciliation test on Darwin. [factory-source, 2026-08-20, plan T27 and `core/test/contract/platform-behaviours.test.ts`]

**Collisions:** G7 forbids promoting a Darwin cell from WSL2 evidence; retain that guarantee unchanged and add new v2 rows only when their implementations exist. [target-source and review-judgment, 2026-08-20, plan Portability Matrix]

### 2.1 Antigravity adapter graduation (`agy`, Google models)

**Strength:** **weak** because runtime bytes support an NDJSON parser in principle, but the taken graduation decision lacks a preventive permission boundary. [document-under-review and factory-source, 2026-08-20, §2.1; `core/src/policy/sandbox-broker.ts:175-205`] The current target correctly remains disabled and returns `E_ADAPTER_UNVERIFIED`. [target-source, 2026-08-20, `awsf.config.yaml:25-29`; `core/src/adapters/antigravity.ts:20-66`]

**Ambiguous:** “the v2 task must open with a `--mode plan` probe” [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md:387-390`]. Reading A is to repeat a version-sensitive probe before implementation. [review-judgment, 2026-08-20, provider drift risk] Reading B is a stale instruction whose answer is already recorded as steering rather than enforcement. [target-source, 2026-08-20, `specs/awsf-v2-candidates.md:277-291`]

**Right, keep as is:** Keep fixture-first parsing, structured blocked detection, PATH/cwd portability checks, and `enabled: false` until graduation is earned. [review-judgment, 2026-08-20, §2.1 and current adapter]

**Wrong or unproven:**

- **Wrong:** `path-policy` does not bound `agy` while it runs; it compares one worktree's Git fingerprint after execution. [factory-source, 2026-08-20, `core/src/policy/sandbox-broker.ts:175-205`; `core/src/policy/path-policy.ts:128-169`]
- **Wrong:** observing `tool_info.parameters.TargetFile` for one tool does not cover `run_command`, messaging, scheduling, web, or writes whose event has another shape. [review-judgment, 2026-08-20, tool inventory in §2.1.1 and path-policy input contract]
- **Wrong:** decisions 13-14 call detection-only write-capable routing viable even though the current WSL2 grant is `tool-policy` and `agy` exposes no enforceable tool deny list. [command-output and document-under-review, 2026-08-20, `npm run test:contract` sandbox row; decisions 11, 13, 14]
- **Unproven:** launching the Windows executable from a Linux mount namespace confines Windows-side filesystem or network effects. [absent-source, 2026-08-20, reason: no cross-boundary containment capture was retained]
- **Unproven in this review:** the raw success, auth-error, plan-mode, and cwd byte streams are not present in target fixtures. [absent-source, 2026-08-20, reason: earlier source existed but no citable capture path remains]
- **Unproven:** help output establishes no advertised system-prompt flag, but it does not prove that every executable operating-contract mechanism is absent. [review-judgment, 2026-08-20, decision 26 relies on help and an empty list]

**Overlooked:** A tool event may arrive after the provider has already executed the tool, so stream inspection needs event-order evidence before it can even claim timely abort. [review-judgment, 2026-08-20, no adapter or fixture exists to establish ordering] The fixed 13,686-token tool-schema overhead also makes a low-effort route economically unlike existing workers and needs a catalog bound. [document-under-review, 2026-08-20, §2.1 success capture]

**Cheapest unused upgrade:** Run one adversarial call in a throwaway Windows-accessible worktree that requests an out-of-worktree file write, a shell write, and an external-mutation-shaped tool, while capturing event order and filesystem effects. [review-judgment, 2026-08-20, DR3] Cost is one provider call plus cleanup of a throwaway directory; I did not run it because this review was not authorized to spend inference quota or mutate an external surface. [review-boundary, 2026-08-20, review brief §Hard constraints]

**Diagnosis and route to strong:** Keep the parser graduation and permission graduation as separate decisions. [review-judgment, 2026-08-20, current evidence split] Implement and fixture-test the parser while leaving the route disabled; enable only after captured bytes prove a provider tool allow/deny flag or a host OS boundary that prevents filesystem, process, network, messaging, and scheduling effects before execution. [review-judgment, 2026-08-20, AGENTS invariants 3-4 and protected operations] If neither exists, the concrete implementation is to retain the probe indefinitely and route the ladder through Claude and Pi. [review-judgment, 2026-08-20, decision 22 already permits those routes]

**Buildability:** The parser-only work fits `build-review` at T2 in an AWSF-managed worktree. Gates are scrubbed raw fixtures for every event and terminal state, exact argv descriptor tests, parser limits, broker registration, cwd/path contract tests, typecheck, unit, contract, simulation, journeys, and one bounded live portability capture; enabling the adapter is a separate owner decision after preventive enforcement exists. [factory-source and review-judgment, 2026-08-20, existing adapter/broker test patterns]

**Collisions:** This touches AGENTS invariants 3-4, Explicitly Not Built's external-mutation and provider-fallback guarantees, and the T2 path boundary. [target-source, 2026-08-20, `AGENTS.md:12-18`; plan Explicitly Not Built] Restate the guarantee as “every provider effect is prevented or brokered before execution”; detection-only does not preserve it and is refused. [review-judgment, 2026-08-20, DR3]

### 2.2 Fusion adapter via `mf` (fusion-harness)

**Strength:** **weak** because the external event vocabulary may be useful, but current AWSF cannot make three provider launches appear by parsing one outer process after GO. [review-judgment, 2026-08-20, broker and ledger] The per-role-worktree design is also explicitly unvalidated and conflicts with the one-worktree attempt schema. [target-source, 2026-08-20, Still open; `core/src/cli/commands/attempt.ts:68-76`]

**Ambiguous:** “AWSF's `path-policy` owns the write boundary” [document-under-review, 2026-08-20, §2.2]. Reading A is preventive authority over every constituent process. [review-judgment, 2026-08-20, ordinary meaning of boundary] Reading B is a post-run audit of one worktree, which is what current code implements. [factory-source, 2026-08-20, `core/src/policy/sandbox-broker.ts:196-205`]

**Right, keep as is:** Keep full-cost reservation before any constituent call and PATH-based executable discovery with a blocked result when absent. [review-judgment, 2026-08-20, `core/src/execution/call-budget.ts:360-377`; `core/src/execution/transport-broker.ts:169-191`]

**Wrong or unproven:**

- **Wrong under current code:** `spendOnGo()` settles all three calls when the outer `mf` process is released, so later events cannot recover partial settlement without redesigning the barrier. [factory-source, 2026-08-20, `core/src/execution/call-budget.ts:384-411`; `core/src/execution/launcher-barrier.ts` settlement contract]
- **Wrong under current code:** only the `mf` PID crosses the broker; child provider launches made inside `mf` have no AWSF process registration, reservation id, or per-child GO. [factory-source, 2026-08-20, `core/src/execution/transport-broker.ts:309-392`]
- **Unproven:** one attempt holding several `PermissionSession`s does not create several durable repository/worktree owners. [factory-source and document-under-review, 2026-08-20, `AttemptStatus` one-worktree fields; §2.2 recommendation]
- **Unproven:** pointing `TMPDIR` at `sessionRuntime` makes `mf` honor that path; no captured bytes or fixture establish the external tool's directory selection. [absent-source, 2026-08-20, reason: no `mf` runtime capture gathered]
- **Unproven:** the normalized event stream is suitable for an AWSF parser under current versions. Source types are not captured runtime bytes. [absent-source, 2026-08-20, fixture-first rule and no target fixture]

**Overlooked:** If `bwrap` is absent, descendants inherit no OS write boundary and AWSF's post-run Git audit cannot see private `/tmp`, sibling worktrees, credentials, or external effects. [factory-source, 2026-08-20, `core/src/policy/sandbox-broker.ts:146-154`; contract output `badge=tool-policy`] A native fan-out also needs a deterministic rule for which worker result becomes fuser input after one worker fails. [review-judgment, 2026-08-20, partial-failure requirement absent from §2.2]

**Cheapest unused upgrade:** Add a fake `mf` that emits worker/fuser events around one outer broker launch and assert reservation history plus process rows. [review-judgment, 2026-08-20, DR4] Cost is under one hour and no provider calls; I did not run it because it requires adding test code, which this review may not do. [review-boundary, 2026-08-20, review brief §Hard constraints]

**Diagnosis and route to strong:** Reverse decision 5 for the multi-worktree goal and orchestrate the two workers plus fuser natively through AWSF's broker. [review-judgment, 2026-08-20, broker invariant] Give each child its own durable registration, reservation settlement, worktree, permission session, and retained envelope, then run the fuser in a third worktree with read-only access to the two retained diffs and write access only to its own tree. [review-judgment, 2026-08-20, concrete adaptation of decision 17] If `mf` remains the executable, weaken scope to one opaque composite that spends all three calls at outer GO and drop partial settlement and per-role worktree claims. [review-judgment, 2026-08-20, current ledger behavior]

**Buildability:** The native shape fits `simple-sdlc` at T2 in the AWSF repository's managed worktree. Gates must prove three broker registrations, reserve-all-before-first-GO, partial failure and cancellation, per-worktree path attribution, fuser input identity, crash recovery, exact provider usage settlement, typecheck, unit, contract, simulation, and journeys. [factory-source and review-judgment, 2026-08-20, broker, call-budget, and recipe patterns]

**Collisions:** Decisions 5, 9, and 17 touch AGENTS invariants 3-4, the one-worktree lifecycle, six-workflow restraint, and the path-policy guarantee. [target-source, 2026-08-20, `AGENTS.md:12-18`; plan Rejected alternatives] The mechanically checkable replacement guarantee is that every constituent provider process crosses the broker and every changed path is attributable to exactly one worktree; an outer opaque spawn cannot satisfy it. [review-judgment, 2026-08-20, DR4]

### 2.3 Planning phase — greenfield projects from zero

**Strength:** **weak** because the candidate contains several useful capabilities but no single bounded state model. [review-judgment, 2026-08-20, §2.3 and Still open] Cross-repo ownership, registry reach, stage envelopes, pre-repository authority, deployment meaning, and the external skill migration remain unresolved or contradictory. [target-source and review-judgment, 2026-08-20, §2.3, decisions 20-24, Still open]

**Ambiguous:** “Sequence it last in v2” [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md:749-751`]. Reading A is last among executable capabilities, followed by documentation. [review-judgment, 2026-08-20, reconciliation with decision 7] Reading B is literally the final v2 deliverable, which conflicts with §2.6. [review-judgment, 2026-08-20, DR7]

**Right, keep as is:** Keep the design-before-plan split, independent architecture review, stable `INV-n`/`AC-n` spine, explicit stopping points, and a registry grounded in real repositories. [review-judgment, 2026-08-20, Blueprint anchors and AWSF ticket-sync shape]

**Wrong or unproven:**

- **Wrong as one candidate:** bootstrap, project registry, cross-repo transactions, design governance, ladder automation, claim methodology, docs lifecycle, and a skill rename do not share one acceptance boundary. [review-judgment, 2026-08-20, §2.3.2-2.3.8]
- **Wrong, contradictory:** the component list puts the plan in the baseline commit, while the later inversion creates the baseline before the ladder produces the plan. [target-source, 2026-08-20, `specs/awsf-v2-candidates.md:499-501`, `:767-774`]
- **Wrong under current adapters:** a provider-agnostic recipe cannot depend on invoking an installed skill because Pi is launched with `--no-skills`. [factory-source, 2026-08-20, `core/src/adapters/pi-codex.ts:624-629`]
- **Wrong under the proposed marimba fence:** a pre-repository architecture-review skill cannot obtain Blueprint's required fresh subagent, while AWSF cannot yet run because there is no repository. [reference-source and target-source, 2026-08-20, `../blueprint/skills/architecture-review/SKILL.md:10-16`; decisions 20 and 30]
- **Unproven:** a deterministic count of model-reported blockers proves only envelope consistency, not that the reviewer found every material issue. [factory-source and review-judgment, 2026-08-20, `core/src/contracts/review-output.ts:7-55`; decision 21]
- **Wrong, contradictory:** §2.3.8 calls claim labelling undecided, while decision 24 calls it taken. [target-source, 2026-08-20, `specs/awsf-v2-candidates.md:1067-1068`, `:2199`]
- **Unproven:** “cheapest unused upgrade” prevents confirmation bias. It is a useful prompt, but the `agy` cwd check was obvious only in hindsight. [review-judgment, 2026-08-20, §2.1 retraction chronology]
- **Unproven:** `planf3` to `plan-sota` is buildable by AWSF, because the installed skill and memory files sit outside this repository and outside a managed worktree. [factory-source, 2026-08-20, §2.3.7 inventory]
- **Wrong if read broadly:** source publication, deployment, and operational readiness are distinct; the lifecycle ends at local landing and candidate 2.4 adds only push. [target-source and review-judgment, 2026-08-20, plan Explicitly Not Built; §2.4]

**Overlooked:** A cross-repo unit can partially land, leaving API and app repositories inconsistent, and no rollback or coordinated owner gate is specified. [review-judgment, 2026-08-20, cross-repo fork and current local fast-forward lifecycle] Invariant 12 currently assumes the plan and tickets share one checkout, so a separate plan repository needs a new mechanically checked source-of-truth relation. [factory-source, 2026-08-20, `AGENTS.md:53-65`] Requirement-ID uniqueness also needs a declared scope across plans, superseded designs, repositories, and amendments. [review-judgment, 2026-08-20, decision 19 C]

**Cheapest unused upgrade:** Write one page fixing the task ownership model: one task owns exactly one repository in v2, with cross-repo work represented by a parent coordination record and immutable contract artifacts between child tasks. [review-judgment, 2026-08-20, current one-repository `AttemptStatus`] Cost is one to two owner-review hours and no calls; I did not run it because it is an owner architecture decision. [review-judgment, 2026-08-20, decision 18]

**Diagnosis and route to strong:** Split 2.3 into four independently gated candidates. [review-judgment, 2026-08-20, scope analysis] First, add a deterministic host-owned `awsf init` that creates a directory, initializes Git, writes a minimal config, and commits with the owner's identity before any model runs. [review-judgment, 2026-08-20, concrete bootstrap] Second, add a registry whose first version supports a plan repository plus several target repositories but keeps each task and landing single-repository. [review-judgment, 2026-08-20, scope cut] Third, add `requirements -> design -> architecture-review -> plan` as compiled recipes with TypeBox envelopes and `AC`/`INV` coverage gates. [review-judgment, 2026-08-20, existing compiler shape] Fourth, capture ladder stage bytes and plan that workflow separately; migrate the owner-local skill in its own versioned source repository, outside the AWSF v2 task graph. [review-judgment, 2026-08-20, fixture and buildability gaps]

**Buildability:** Build the bootstrap, registry, and design recipe through `simple-sdlc` at T2 in an AWSF-managed worktree, after the owner separately amends any protected config surface the worker cannot write. [factory-source and review-judgment, 2026-08-20, `awsf.config.yaml` agent grants and protected paths] Gates must cover temp-directory `git init`, owner commit identity, no provider before baseline, registry schema and path containment, per-repo branch and gate resolution, single-repo task ownership, plan-ticket-AC reconciliation, architecture-review envelope consistency, crash recovery, typecheck, unit, contract, simulation, and journeys. [factory-source and review-judgment, 2026-08-20, existing recipe, state, and meta-test patterns]

**Collisions:** This touches AGENTS invariants 1, 3-5, 8, 11, and 12; Explicitly Not Built's no-skill execution, no fallback, and no autonomous routing lines; and the one-repository v1 state model. [target-source, 2026-08-20, `AGENTS.md`; plan Explicitly Not Built] The adaptation must keep live task state in journals, commit only as the owner, broker every process, preserve single-repository landing in the first slice, and redefine ticket-plan sync per registered plan source with a meta-test. [review-judgment, 2026-08-20, decision 18]

### 2.4 Publish path (`awsf publish`)

**Strength:** **medium** because post-`LANDED`, exact-revision, human-initiated publication is compatible with AWSF's owner gate in principle. [review-judgment, 2026-08-20, Q10 and current landing design] The candidate does not yet specify enough state and remote policy to replace invariant 8 with an equally strong machine check. [factory-source and review-judgment, 2026-08-20, `AGENTS.md:34-37`; no-push meta-test]

**Ambiguous:** “A project that is production-ready but can never leave the local machine” [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md:1081-1084`]. Reading A equates remote source publication with production readiness. [review-judgment, 2026-08-20, wording] Reading B says publication is one missing delivery step while deployment remains out of scope. [review-judgment, 2026-08-20, narrower defensible reading]

**Right, keep as is:** Keep publication after durable `LANDED` evidence and behind an interactive owner confirmation. [review-judgment, 2026-08-20, current landing pattern]

**Wrong or unproven:**

- **Unproven:** a “state-aware meta-test” by itself is strong enough; no proposed authorization API or sole push site is named. [factory-source, 2026-08-20, current scanner at `core/test/unit/meta/no-destructive-paths.test.ts:6-22`]
- **Unproven:** pilot evidence now justifies taking Q10 rather than retaining its reservation. §2.4 cites the production-ready goal, not a measured publication failure. [document-under-review, 2026-08-20, §2.4 and plan Q10]
- **Wrong if read broadly:** `publish` does not deploy, configure production, run release migrations, or prove operational readiness. [review-judgment, 2026-08-20, candidate scope]

**Overlooked:** The command needs an allowlisted remote and branch, exact candidate-to-canonical-HEAD equality, clean checkout, non-force refspec, protected-branch refusal, credential non-persistence, hook behavior, retry/idempotency, and a record of what remote accepted. [review-judgment, 2026-08-20, Git push threat surface and invariant 9]

**Cheapest unused upgrade:** Specify `authorizePublish(status, repository, remote, refspec)` and test it against a local bare remote with no network. [review-judgment, 2026-08-20, DR8] Cost is about half a day; I did not run it because no publish code or contract exists and this review cannot add one. [review-boundary, 2026-08-20, review brief §Hard constraints]

**Diagnosis and route to strong:** Permit one exact push site only when the loaded attempt is `LANDED`, canonical HEAD equals the landed candidate, the checkout is clean, the configured remote and destination branch match an allowlist, and argv contains no force or delete form. [review-judgment, 2026-08-20, concrete authorization] Require a fresh TTY confirmation displaying SHA, remote URL, and refspec; persist a scrubbed publication event only after remote success, with retries idempotent on the same SHA. [review-judgment, 2026-08-20, landing precedent and invariant 9]

**Buildability:** The owner must first amend invariant 8 because current workers cannot write protected `AGENTS.md`; after that, use `simple-sdlc` at T2 in an AWSF-managed worktree because this changes process execution, credentials, network mutation, and a hard invariant. [factory-source and review-judgment, 2026-08-20, `awsf.config.yaml:32-47`, `:87-94`; DR16] Gates are unit authorization matrices, exact argv tests, local bare-remote integration, pre-`LANDED` negative journeys, force/delete source fences, credential scans, idempotent retry, typecheck, all test layers, and an owner-run bounded remote pilot before claiming portability. [factory-source and review-judgment, 2026-08-20, current broker and meta-test patterns]

**Collisions:** AGENTS invariant 8 must be amended before implementation, and invariant 9 still forbids credential persistence. [target-source, 2026-08-20, `AGENTS.md:34-42`] The replacement guarantee is “no push except the sole publish module after exact `LANDED` authorization, and no force or delete form anywhere”; enforce both the sole site and the state matrix mechanically. [review-judgment, 2026-08-20, decision 18]

### 2.5 System prompt engineering — the driving layer and the AWSF agents

**Strength:** **medium** because the adapters already materialize and append private system prompts, and per-role scoping correctly protects the reviewer. [factory-source, 2026-08-20, `core/src/adapters/claude-code.ts:450-487`; `core/src/adapters/pi-codex.ts:610-668`; §2.5] Worker benefit and the integration point remain unmeasured and underdesigned. [review-judgment, 2026-08-20, DR9]

**Ambiguous:** “a shared preamble has one natural insertion point” [document-under-review, 2026-08-20, §2.5]. Reading A means one conceptual composition function should own the result. [review-judgment, 2026-08-20, desirable design] Reading B says one such code location already exists, which is false. [factory-source, 2026-08-20, three prompt readers]

**Right, keep as is:** Keep append-not-replace semantics, interactive-only aliases, role-specific scope, and the warning against compressing reviewer evidence. [review-judgment, 2026-08-20, §2.5]

**Wrong or unproven:**

- **Wrong in current code:** production run, owner rework, and replacement review each read and compose system prompts separately. [factory-source, 2026-08-20, `core/src/cli/commands/production-run.ts:618`; `core/src/cli/commands/rework.ts:401-418`; `core/src/cli/commands/review-phase.ts:515-528`]
- **Unproven:** one call with and one without the preamble measures token savings or prose quality. Model variance and task variance are uncontrolled. [review-judgment, 2026-08-20, §2.5 cheapest upgrade]
- **Unproven:** the help-only `agy` absence claim is runtime-complete. It is safe as a conservative capability refusal, but it is not captured executable behavior. [review-judgment, 2026-08-20, decision 26 and fixture-first rule]

**Overlooked:** Shared prompt bytes need to be part of the same immutable route evidence as role prompts, or rework and replacement review can read different instructions under the same config snapshot. [factory-source and review-judgment, 2026-08-20, prompt readers and `AttemptStatus.configSnapshotJson`] A global style block can also increase parse corrections even when final JSON is valid, so parse-failure rate is a first-class benchmark metric. [review-judgment, 2026-08-20, workflow correction budget]

**Cheapest unused upgrade:** Trace every `route.systemPrompt` producer and consumer, five minutes and no calls; I ran `rg -n "systemPrompt|writeSystemPrompt" core/src` and found distinct production-run, rework, and review-phase paths. [command-output, 2026-08-20, command output summarized in DR9]

**Diagnosis and route to strong:** Create one host function that loads the base role prompt, appends a role-specific shared fragment, validates credential safety, and returns bytes plus a digest used by production, rework, and review. [review-judgment, 2026-08-20, concrete centralization] Benchmark each affected role over repeated matched tasks and record input tokens, output tokens, parse corrections, finding specificity, and gate outcomes; ship only fragments that improve their declared metric without weakening reviewer evidence. [review-judgment, 2026-08-20, measurable route]

**Buildability:** Use `simple-sdlc` at T2 in an AWSF-managed worktree because prompts alter every model role and the independent review control. Gates include byte-exact composition tests for all roles and all three execution paths, digest persistence, no aliases in headless roles, reviewer evidence regression fixtures, parse-correction counts, typecheck, unit, contract, simulation, journeys, and a bounded benchmark recorded outside required offline gates. [factory-source and review-judgment, 2026-08-20, existing prompt and workflow code]

**Collisions:** It touches the no-skill execution rule, invariant 9's private material, and pillar 1's independent reviewer. [target-source, 2026-08-20, driving hard rules; `AGENTS.md:39-42`] Keep prompts advisory, keep schemas and gates authoritative, and mechanically assert that the shared block cannot remove role-specific evidence requirements. [review-judgment, 2026-08-20, decision 18]

### 2.6 Non-technical cheatsheet guide

**Strength:** **medium** because the CLI table and driving tree provide checkable source material for a guide. [factory-source, 2026-08-20, `core/src/cli/main.ts:32-36`; `docs/driving/skills/awsf/SKILL.md:69-93`] The intended reader, learning path, and completion test are not bounded enough for “full value” or “every flow” to be verifiable. [review-judgment, 2026-08-20, §2.6]

**Ambiguous:** “covering every command and flow” [document-under-review, 2026-08-20, §2.6]. Reading A is an exhaustive reference, which duplicates the routed tree. [review-judgment, 2026-08-20, one-owner rule] Reading B is a linear beginner path with links to the full reference, which is smaller and testable. [review-judgment, 2026-08-20, recommended shape]

**Right, keep as is:** Keep it last, after executable commands, recipes, and driver routes stop moving. [review-judgment, 2026-08-20, decision 7]

**Wrong or unproven:**

- **Unproven:** a single step-by-step file can cover every flow without becoming a second source of truth. [review-judgment, 2026-08-20, existing one-owner rule and nine routed documents]
- **Unproven:** a reader with no command-line experience can complete setup and an owner-gated landing from the proposed description. No usability walkthrough is named. [absent-source, 2026-08-20, reason: no user test exists]

**Overlooked:** The guide needs prerequisites, safe placeholder conventions, platform differences, how to stop before owner acts, how to read a block, and how to avoid opening `private/`; these should link to authoritative documents rather than duplicate them. [target-source and review-judgment, 2026-08-20, driving tree]

**Cheapest unused upgrade:** Build a coverage matrix from the 18 `CLI_COMMANDS` entries and nine current router rows, then choose which belong in the happy path versus reference links. [factory-source and review-judgment, 2026-08-20, `core/src/cli/main.ts:32-36`; `docs/driving/skills/awsf/SKILL.md:69-93`] I ran the source inventory; no prose or user walkthrough was created. [command-output, 2026-08-20, `rg -n` over those files]

**Diagnosis and route to strong:** Define acceptance as one clean-machine walkthrough by the intended reader: install, prime, create one throwaway task, observe it, inspect a block, and stop at an owner act with the correct evidence. [review-judgment, 2026-08-20, concrete user test] Structure the file as a short happy path, a decision tree for failures, and links to the existing command owners; generate or meta-test the command index from `CLI_COMMANDS`. [review-judgment, 2026-08-20, one-owner adaptation]

**Buildability:** Use `simple-sdlc` at T2 because the only shipped recipe with a documenter is T2, in an AWSF-managed worktree. Gates are doc reconciliation, route/link existence, no live identifiers, no credentials, no handwritten schemas, full tests, typecheck, lint, and the owner-observed clean-machine walkthrough. [factory-source and review-judgment, 2026-08-20, `core/src/workflow/recipes/simple-sdlc.ts:10-97`; driving meta-tests]

**Collisions:** It touches invariant 1, the one-owner rule, doc reconciliation, and decision 22's competing “last” claim. [target-source, 2026-08-20, `AGENTS.md:7-11`; DR7] Keep placeholders only, link rather than restate, and make it the final artifact after the ladder. [review-judgment, 2026-08-20, decision 18]

### 2.7 Quota telemetry — reading the window AWSF cannot price

**Strength:** **weak** because effective-availability rendering and no-routing separation are well grounded, but the candidate mixes telemetry, task attribution, credential access, cache refresh, and marimba guard evidence. [review-judgment, 2026-08-20, §2.7 and DR10-DR11] Its executable fixtures, refresh failure semantics, and portability bounds are not yet in the target repository. [factory-source and absent-source, 2026-08-20, fixture search and Still open]

**Ambiguous:** “O3 captured end to end” [document-under-review, 2026-08-20, `specs/awsf-v2-candidates.md:1399`]. Reading A refers to quota admission control, which §2.7 later marks not taken. [target-source, 2026-08-20, §2.7 Scope] Reading B refers to marimba's delegation guard, which belongs to §2.8. [target-source, 2026-08-20, inserted content and decision 30]

**Right, keep as is:** Keep rendering from `quotaSemantics.effectiveAvailability`, structural status handling, age stamps, no background refresh, no routing imports, and fixture-first parsing. [review-judgment, 2026-08-20, quota-axi schema and §2.7 decisions 28-29]

**Wrong or unproven:**

- **Wrong:** the §2.7 O3 capture and applied subsections concern marimba, not quota telemetry, and contradict the later O3 verdict. [target-source, 2026-08-20, DR10]
- **Wrong:** account-level percentage snapshots cannot establish one task's share of a week when other clients can consume the same account and percentages may be rounded. [reference-source and review-judgment, 2026-08-20, `../quota-axi/src/types.ts:139-226`; DR11]
- **Unproven:** identical integer `percentUsed` across two reads proves zero quota cost. It establishes only that no reported percentage point changed. [review-judgment, 2026-08-20, §2.7 measured claim]
- **Unproven:** phase-boundary probe failures never affect lifecycle progress. The candidate does not state fail-open behavior, timeout ownership, or what gets journalled when refresh fails. [review-judgment, 2026-08-20, §2.7 Scope]
- **Wrong, contradictory:** the implementation is PATH-resolved and versioned as 0.1.29, while later guidance prefers unpinned `npx -y quota-axi`, which may download another version. [target-source, 2026-08-20, `specs/awsf-v2-candidates.md:1385-1396`, `:1593-1624`]
- **Unproven:** GPT coverage without a Codex binary, unattended macOS Keychain reads, and rate-limited bytes remain open. [target-source, 2026-08-20, Still open and §2.7 Cheapest unused upgrades]
- **Unproven for implementation:** no quota-axi success or failure fixture exists in the target tree. [command-output, 2026-08-20, `rg -n "quota-axi|effectiveAvailability" core/test/fixtures core/test core/src`]

**Overlooked:** AWSF already normalizes provider quota/reset events, so a new snapshot schema needs an explicit relationship to the existing `quota` event rather than a second unrelated vocabulary. [factory-source, 2026-08-20, `core/src/contracts/normalized-events.ts:179-188`; `core/src/adapters/claude-code-stream.ts:373-405`] A binary on PATH can drift schema versions independently of AWSF, so version and `schemaVersion` compatibility must fail visibly. [reference-source and review-judgment, 2026-08-20, `../quota-axi/src/types.ts:224-230`]

**Cheapest unused upgrade:** Search the target for existing quota events and quota-axi fixtures, two minutes and no credential access; I ran it and found the existing normalized `quota` event but no quota-axi fixture or parser. [command-output, 2026-08-20, `rg` commands and anchors above]

**Diagnosis and route to strong:** Take O1 only through an explicit `awsf quota refresh` host command that invokes a version-checked PATH binary, writes one scrubbed age-stamped snapshot under the state root, and never blocks a task. [review-judgment, 2026-08-20, concrete no-daemon design] Make status, doctor, and dashboard read that cache without network or credential access; remove unpinned `npx` from the runtime contract. [review-judgment, 2026-08-20, latency and supply-chain bounds] Defer O2, or journal only attempt-open and attempt-close contextual snapshots labelled non-attributable, with no computed “task cost” delta. [review-judgment, 2026-08-20, DR11]

**Buildability:** Use `simple-sdlc` at T2 in an AWSF-managed worktree because the probe reads credentials, calls a network endpoint, and changes observability. Gates are scrubbed captured fixtures for fresh, stale, auth-required, error, rate-limit-contract, and missing-provider states; schema-version refusal; PATH/version checks; hard timeout; cache atomicity; no workflow/routing imports; no background process; no credential persistence; typecheck; all test layers; and destination-machine portability rows. [factory-source and review-judgment, 2026-08-20, broker, invariant, and quota-axi contracts]

**Collisions:** This touches AGENTS invariants 3-4, 7, and 9; Explicitly Not Built's quota-routing and daemon lines; and the offline-suite guarantee. [target-source, 2026-08-20, `AGENTS.md`; plan Explicitly Not Built] Restate the guarantee as “only an explicit operator refresh touches credentials or network, all consumers read a stale-aware cache, and no workflow or route selector can import it,” enforced by import and command-boundary tests. [review-judgment, 2026-08-20, decision 18]

### 2.8 `marimba` — the driving session as a named role

**Strength:** **weak** because the role name and command-free contract are low-cost, but the applied guard currently breaks a required unit fence and the claimed lifecycle bound is bypassable. [command-output and review-judgment, 2026-08-20, focused execution-isolation test; PTY capture] Two further claims about existing route coverage and mutation boundaries are false in current code. [factory-source and review-judgment, 2026-08-20, DR14-DR15]

**Ambiguous:** “The prompt is not what bounds marimba; the lifecycle is.” [document-under-review, 2026-08-20, §2.8 Card 4] Reading A is that ordinary non-TTY tool calls are rejected by lifecycle checks. [factory-source, 2026-08-20, `core/src/cli/tty.ts:10-25`] Reading B is that the lifecycle authenticates a human against a same-user agent with unrestricted shell access, which it does not. [captured-bytes and review-judgment, 2026-08-20, PTY probe]

**Right, keep as is:** Keep the settled name, a command-free contract inside `docs/driving/`, the one-owner documentation rule, and the guard described only as an owner-side seatbelt. [review-judgment, 2026-08-20, §2.8 collision 4 and firstmate knowledge-placement source]

**Wrong or unproven:**

- **Wrong:** adding `.claude/` to `.gitignore` did not close the hazard; the existing meta-test asserts physical absence and now fails. [captured-bytes, 2026-08-20, focused execution-isolation test]
- **Wrong:** TTY is a structural human boundary against marimba. A scripted PTY satisfies the exact check and confirmation shape. [factory-source and captured-bytes, 2026-08-20, `core/src/cli/tty.ts:10-25`; PTY output]
- **Wrong:** existing driving-route tests cover routes in a new contract. They hardcode only the current router. [factory-source, 2026-08-20, `core/test/unit/meta/driving-routes.test.ts:15-53`]
- **Wrong:** no AWSF command mutates outside the state root. Start creates an external worktree and land mutates the canonical repository. [factory-source, 2026-08-20, `core/src/cli/commands/start.ts:16-24`, `:61-91`; `core/src/cli/commands/land.ts:170-203`]
- **Unproven as a fence:** the adapted guard allows every `mcp__*` name and malformed JSON, and it denied `ListAgents`, which is observational by name. `ListAgents` returned exit 2, empty stdout, and a two-line denial on stderr; `TaskOutput`, `mcp__foo__task`, and `Read` returned exit 0 with empty streams; `not-json` also returned exit 0 with empty streams. [captured-bytes, 2026-08-20, Python subprocess capture of `~/.claude/marimba/delegation-guard.sh`]
- **Unproven:** summaries of prior live Claude guard runs are not retained raw byte streams in the target repository. [absent-source, 2026-08-20, reason: throwaway capture paths are not named]
- **Wrong, contradictory:** the section calls P1-P6 untaken while O3 and its repository-local settings are already applied outside tracked state. [target-source, 2026-08-20, §2.8 Applied O3 and Proposed, not taken]

**Overlooked:** Decision 20's pre-repository independent review has nowhere to run after `Task` and `Agent` are removed and before AWSF can create a repository. [review-judgment, 2026-08-20, DR5] The proposed shell function and owner-local settings also cannot be authored and landed by an AWSF worker whose writes are confined to a repository worktree. [factory-source, 2026-08-20, path-policy and candidate placement] The local guard copied firstmate's fail-open MCP and malformed-input choices without carrying firstmate's full primary-home scope or test suite. [reference-source and target-source, 2026-08-20, `../firstmate/docs/subagent-guard.md:39-68`, `:137-170`; local guard]

**Cheapest unused upgrade:** Run the focused execution-isolation test, 0.36 seconds and no provider call; I ran it and captured `pass 1`, `fail 1`, exit 1 because `.claude/` exists. [captured-bytes, 2026-08-20, command `node --experimental-strip-types --test core/test/unit/meta/execution-isolation.test.ts`] A separate zero-cost PTY falsification also ran and returned `stdin.isTTY=true` plus `answer=yes`. [captured-bytes, 2026-08-20, PTY command]

**Diagnosis and route to strong:** Take P1 as a small documentation candidate and separate it from launcher and guard security. [review-judgment, 2026-08-20, scope split] Store Claude settings under `~/.claude/marimba/` and pass them through a per-invocation settings mechanism only after a captured live proof shows project settings are not loaded; never create repository-root `.claude/`. [review-judgment, 2026-08-20, execution-isolation fence] Remove `--dangerously-skip-permissions` unless marimba is restricted to a dedicated tool surface that cannot invoke owner acts or allocate a PTY; under unrestricted same-user Bash, no prompt or `isTTY` check can distinguish the model from the owner. [review-judgment, 2026-08-20, PTY evidence] Extend route tests explicitly if the contract names documents, and classify the delegation hook as optional hardening with captured regression fixtures rather than a factory guarantee. [review-judgment, 2026-08-20, DR14]

**Buildability:** Build the repository-owned contract and tests through `simple-sdlc` at T2 in an AWSF-managed worktree. Gates are execution-isolation, route resolution for every contract pointer, no command/schema duplication, no live identifiers, no credentials, contract byte composition for Claude and Pi, guarded missing-path behavior, PTY adversarial tests documenting the limit, full unit/contract/simulation/journey suites, typecheck, and lint; owner-home installation is a separate explicit owner act after landing. [factory-source and review-judgment, 2026-08-20, driving meta-tests and path boundary]

**Collisions:** This touches invariant 1, the no-skill execution rule, owner-only lifecycle acts, the repository-root `.claude/` absence fence, provider agnosticism, and no background daemon. [target-source, 2026-08-20, `AGENTS.md`; driving hard rules; execution-isolation test; plan Explicitly Not Built] The enforceable adaptation is narrower: committed files contain no live handle or discoverable owner settings, no gate depends on the contract, and any owner-side hook is explicitly outside the factory guarantee. [review-judgment, 2026-08-20, decision 18]

## D. Sequencing

1. **Close review blockers before v2 planning:** remove repository-root owner settings through an owner action outside this review, restore 988/988 unit tests, re-home §2.8's misplaced O3 prose, and reconcile decision 24's taken/undecided state. [review-judgment, 2026-08-20, DR6, DR10, DR12]
2. **Archive 1.1-1.3 and retain 1.4 as an external platform gate:** completed work is a prerequisite, not v2 scope. [review-judgment, 2026-08-20, DR1]
3. **Take the safe part of 2.8 early:** land the command-free contract and its explicit tests, without permission bypass or repository-local settings. This precedes the driving-heavy work but does not claim a new security boundary. [review-judgment, 2026-08-20, §2.8 diagnosis]
4. **Resolve 2.3's state model:** choose single-repository child tasks with typed cross-repo contracts for the first v2 slice, define registry ownership, and define `AC`/`INV` scope. These decisions force every later bootstrap, gate, and publish shape. [review-judgment, 2026-08-20, `AttemptStatus` one-repository model and Still open]
5. **Build deterministic bootstrap and registry, then design/review/plan recipes:** a repository must exist before AWSF can govern provider work, and plan-ticket sync must know its source repository. [review-judgment, 2026-08-20, DR5 and invariant 12]
6. **Do 2.5 only after prompt composition is centralized and benchmark criteria are fixed:** new planning roles otherwise multiply duplicated prompt paths. [review-judgment, 2026-08-20, DR9]
7. **Build 2.7 O1 and 2.4 after the registry:** quota refresh needs an explicit host boundary, and publish needs per-repository remote/branch policy. [review-judgment, 2026-08-20, §2.7 and §2.4 diagnoses]
8. **Treat 2.1 and 2.2 as optional adapter workstreams:** they do not block the provider-agnostic core, and neither graduates until its prevention and broker gaps close. [review-judgment, 2026-08-20, decisions 11, 22; DR3-DR4]
9. **Capture and then build the 2.3 ladder:** this is last among executable v2 capabilities because it consumes bootstrap, registry, design, review, plan, and prompt composition. [review-judgment, 2026-08-20, decision 22 dependencies]
10. **Write 2.6 last:** the cheatsheet follows the final command and recipe surface. [review-judgment, 2026-08-20, decision 7]

This order disagrees with the original where it treats both ladder and cheatsheet as last, takes fusion and `agy` viability before their boundaries exist, and mixes a local marimba installation into a parked candidate set. [review-judgment, 2026-08-20, DR2-DR4, DR7, DR10-DR13] The cheapest unused upgrade was a dependency DAG; I produced the ordered dependency list above without provider calls. [review-judgment, 2026-08-20, this section]

## E. Set-level risks

- **F1, current validation is already red:** the newest candidate's local `.claude/` placement makes a required unit meta-test fail, while Git remains clean because the directory is ignored. [captured-bytes and command-output, 2026-08-20, focused test; `git status --ignored .claude`]
- **F2, status vocabulary is missing:** Part 2 contains taken decisions, applied owner-local changes, committed support changes, and parked proposals under one “nothing committed” label. [target-source and review-judgment, 2026-08-20, DR2]
- **F3, identifiers collide:** O3 means quota admission control and marimba delegation hardening in the same section, creating a direct taken/not-taken contradiction. [target-source, 2026-08-20, DR10]
- **F4, the set is unfunded:** 2.3 alone contains at least four architecture workstreams, while 2.1, 2.2, 2.4, 2.5, 2.7, and 2.8 each alter a security, process, credential, or lifecycle boundary. [review-judgment, 2026-08-20, candidate diagnoses]
- **F5, prevention is repeatedly weakened into observation:** `agy`, opaque `mf`, owner-local hooks, quota exposure, and TTY checks are described more strongly than their enforcement. [review-judgment, 2026-08-20, DR3-DR4 and DR12-DR15]
- **F6, external work is mixed into factory work:** skill renames, shell functions, settings, memory curation, upstream quota brokers, and reference-tool changes cannot land from an AWSF-managed target worktree. [factory-source and review-judgment, 2026-08-20, path-policy and candidate placement]
- **F7, evidence retention is weaker than the method requires:** several decisions cite earlier captured bytes that are not available as scrubbed fixtures or named raw captures. [absent-source, 2026-08-20, A §Could not gather]
- **F8, “production-ready” is undefined:** the set covers local build, source publication, and planning, but it does not define deployment, environment configuration, release migration, rollback, monitoring, or operational acceptance. [review-judgment, 2026-08-20, §§2.3-2.4]
- **F9, decision and section text drift:** decision 24 conflicts with §2.3.8, decision 27 conflicts with the misplaced O3 material, and decision 30 combines one settled name with an unsafe flag rationale and six untaken proposals. [target-source, 2026-08-20, decisions 24, 27, 30 and DR6, DR10]
- **F10, the method's single cheapest-upgrade rule is insufficient for high-impact claims:** it needs an explicit disconfirming test or alternative-hypothesis table so hindsight does not masquerade as a pre-existing check. [review-judgment, 2026-08-20, DR6]
- **F11, protected revisions are not factory-buildable today:** workers cannot edit `AGENTS.md` or `awsf.config.yaml`, yet several candidates require exactly those amendments. [factory-source and review-judgment, 2026-08-20, DR16]

The cheapest set-level upgrade is to split the candidate record into typed rows with `state`, `target`, `factory route`, `decision owner`, `evidence anchors`, `falsification`, and `open dependencies`; cost is a document-only schema and no provider calls. [review-judgment, 2026-08-20, F2-F4, F7, F9-F10] I did not implement it because the reviewed document is read-only and this review may write only this file. [review-boundary, 2026-08-20, review brief §Hard constraints]

## F. What I could not verify

| Absence on 2026-08-20 | Reason | What closes it |
|---|---|---|
| Incremental versus terminal `agy.text_delta` | A longer successful raw capture was not retained or run here. [absent-source, 2026-08-20, Still open] | One bounded longer-output capture, scrubbed into a fixture. [review-judgment, 2026-08-20, §2.1] |
| `agy` prevention across every mutating tool and WSL/Windows boundary | No preventive flag or cross-boundary containment capture exists in the gathered sources. [absent-source, 2026-08-20, §2.1.1] | One adversarial throwaway call plus OS-level effect checks, or a captured provider allow/deny mechanism. [review-judgment, 2026-08-20, §2.1] |
| Raw `agy` streams quoted by the document | A source existed earlier, but no citable capture path was provided and no target fixture contains it. [absent-source, 2026-08-20, fixture search] | Supply the raw stdout/stderr files and provenance, then scrub copies into fixtures. [review-judgment, 2026-08-20, fixture-first rule] |
| `mf` event bytes, TMPDIR behavior, and per-role worktrees | `../fusion-harness` and a live `mf` run were not gathered; AWSF fit already failed at the broker boundary. [absent-source, 2026-08-20, A §Not read] | Capture a no-provider replay if available, then a bounded live run only after the broker design is chosen. [review-judgment, 2026-08-20, §2.2] |
| Cross-repo task ownership | The owner has not chosen multi-worktree atomic tasks versus linked single-repo tasks. [target-source, 2026-08-20, Still open] | A reviewed state and failure model that names landing atomicity and rollback. [review-judgment, 2026-08-20, §2.3] |
| Registry reach | Config, state-root, worktree, branch, gate, remote, and plan-source ownership remain unspecified. [target-source, 2026-08-20, Still open] | A versioned registry schema and migration/compatibility decision. [review-judgment, 2026-08-20, §2.3] |
| Ladder stage envelopes | The document says the fused shape was produced once by hand and no captured stage corpus is named. [target-source, 2026-08-20, Still open] | Capture each stage's input/output bytes before authoring TypeBox schemas. [review-judgment, 2026-08-20, fixture-first rule] |
| Worker prompt benefit | No repeated matched-role benchmark exists, and I did not spend the two proposed calls. [absent-source, 2026-08-20, §2.5] | A repeated benchmark with token, parse, gate, and reviewer-specific quality measures. [review-judgment, 2026-08-20, §2.5] |
| quota-axi rate-limited runtime bytes | Provider throttling cannot be summoned safely on demand. [absent-source, 2026-08-20, §2.7] | Retain the next natural rate-limit response and keep the branch unproven until then. [review-judgment, 2026-08-20, fixture-first rule] |
| GPT quota on a Pi-only machine without Codex | This machine has `/snap/bin/codex`, so the fallback cannot be isolated without changing the environment. [absent-source, 2026-08-20, Still open] | Run on a machine with Pi credentials and no Codex binary, or add and test the upstream credential broker. [review-judgment, 2026-08-20, §2.7] |
| Unattended Claude quota on macOS | No Darwin machine was supplied and Keychain consent is platform-specific. [absent-source, 2026-08-20, `../quota-axi/src/providers/claude.ts:35-46`] | Run the exact unattended command on the destination Mac after explicit consent. [review-judgment, 2026-08-20, §1.4] |
| Raw quota-axi success and failure fixtures | The target has none; I did not invoke credential-reading live probes. [absent-source, 2026-08-20, fixture search and review boundary] | Supply scrubbed default-JSON captures with schema version and executable version. [review-judgment, 2026-08-20, §2.7] |
| Independent effect of `Task` versus `Agent` in this repository's settings | The document tested the pair; I did not spend two live Claude calls to separate them. [absent-source, 2026-08-20, Still open] | A/B each key with a nonsense-name control in isolated settings directories. [review-judgment, 2026-08-20, §2.8] |
| A running firstmate instance | It requires a provisioned fleet home and backend; source behavior relevant to this review was available without it. [absent-source, 2026-08-20, §2.8 source declaration] | Run firstmate only before proposing transfer of supervision mechanics, not for the contract or hook critique here. [review-judgment, 2026-08-20, §2.8] |
| Smart Health repository details | The repositories exist according to §2.3 but were not gathered because no finding depends on their stack details. [absent-source, 2026-08-20, A §Not read] | Read their current branches, gates, plans, and coordination files before freezing the registry schema. [review-judgment, 2026-08-20, §2.3] |
| Future reference ideas | The sources are not yet supplied by design. [absent-source, 2026-08-20, Still open final item] | Gather them in the declared later intake before authoring the v2 plan. [review-judgment, 2026-08-20, Still open] |
