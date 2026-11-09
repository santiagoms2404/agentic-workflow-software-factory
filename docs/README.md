# Factory documentation map

Use each document for its stated purpose. A design requirement, a recorded test
result and a live operating instruction are different kinds of evidence.

## Current operation

| Source | What it owns |
|---|---|
| [Repository README](../README.md) | Installation, architecture overview, validation commands and known differences between validation surfaces |
| [Cheatsheet](cheatsheet.html) | Owner-facing walkthrough and six source-reconciled reference sets |
| [Driving contract](driving/marimba/CONTRACT.md) and [setup](driving/marimba/README.md) | Marimba's authority, guard installation and measured limits |
| [Prime command](driving/commands/prime-awsf.md) | Session orientation and base checks |
| [AWSF driving skill](driving/skills/awsf/SKILL.md) | Routes to preflight, observation, owner acts, routing and evidence cookbooks |
| [Group planning skill](driving/skills/marimba-plan/SKILL.md) | Exact-input capture, revision-bound proposals and owner-applied planning decisions |
| [AGENTS.md](../AGENTS.md) | Repository invariants, their scopes and owner amendments |
| [Execution configuration](../awsf.config.yaml) and [project catalog](../awsf.project.yaml) | Committed runtime policy and project-specific gates |
| [Role prompts](../prompts/) | Shipped instructions used by managed worker phases |

The CLI and executable source own runtime behavior. The cheatsheet's marked
reference sets are checked against that source. Other prose is explanatory and
must not authorize an operation the code or owner boundary refuses.

Read `awsf workflows`, `awsf routes list`, `awsf status TASK --evidence` and
`awsf next TASK` when their answers are needed. Do not keep a parallel current
status board in a committed file.

## Scope, vision and completion

The [v3 intent](../specs/awsf-v3-intent.md) describes the owner's direction and
subsequent continuity/privacy amendments. The [v3 spine](../specs/awsf-v3-plan.html)
sequences that work. Its existing deep plans include
[driver checks](../specs/awsf-v3-w01-driver-checks.html),
[traps](../specs/awsf-v3-w02-trap-suite.html) and
[ticket closure](../specs/awsf-v3-w03-ticket-closure.html).

A registered plan's markers are the completion authority. Its ticket states and
Section B prompts must agree in the same commit. The ticket/plan agreement fence
checks that relationship. A documentation reconciliation does not earn a marker,
close W03, retire its temporary GM exception or approve another workstream.

The [v2 spine](../specs/awsf-v2-plan.html), its deep plans and
[v2 intent](../specs/awsf-v2-intent.md) retain earlier scope and decisions.
The [v1 plan](../specs/awsf-plan.html) retains the original build and platform
acceptance. Read a completed plan for its decisions and dated evidence, not as a
replacement for current CLI usage. Unfinished work stays unfinished until its
own evidence and closure process say otherwise.

The broader personal-AI direction is discussed in the whole-project assessment.
It guides alignment, but it does not turn future deployment, monitoring, local
learning or personal-assistant features into shipped factory capabilities.

## Assessments and historical records

| Source | How to read it |
|---|---|
| [Whole-project assessment](whole-project-assessment.html) and [appendix](whole-project-assessment-evidence.html) | Revision-bound assessment of `057370d`, retaining the earlier `1a5ccea` observations and original finding dossiers. Classification is not independent verification. |
| [v3 assessment and direction](../specs/awsf-v3-assessment-and-direction.md) | Dated 2026-10-01 baseline and 2026-10-20 re-grade. Its conditional predictions and runtime measurements belong to those snapshots, not the later integrated tree. |
| [Original architecture](../specs/awsf-architecture-proposal.md) | Accepted starting design and source-project audit, interpreted with later owner amendments and implementation evidence |
| [Original acceptance checklist](../specs/awsf-plan-acceptance.md) | Original claims and proof obligations. Unchecked rows are not a fresh test failure, and checked rows are not a fresh rerun. |
| [Candidate reuse design](../specs/awsf-candidate-reuse-and-review-evidence.md) | Dated decisions and immutable review record, not an instruction to start its original commit sequence again |
| [Protected/quota design](../specs/awsf-protected-quota-architecture.md) and [host-validation recovery](../specs/awsf-a3-host-validation-recovery.md) | Recovery contracts and dated implementation amendments. A designed reconnection capability requires its own actual proof. |
| [Pilot records](../records/pilots/) and [journey records](../records/journeys/) | Historical observations and attestation templates. An unfilled template establishes no executed journey. |
| `specs/awsf-v2-candidates*.md`, fixture provenance and completed build prompts | Historical inputs, captured protocol evidence and original work instructions. Do not rewrite them to imply newer measurements. |

The two whole-project reports include citations to machine-local review material
and owner-supplied vision sources. Those citations identify the assessment's
inputs. They do not imply that those private files ship with a clone.

## Validation and remaining limits

Run the commands in the root README on the exact tree being evaluated. Its root
suite, candidate gate configuration and CI workflow differ. Record that fact
rather than interpreting one green surface as all of them.

The assessment retains specific open concerns, including non-OS seed-fingerprint
strength, clock-based duration arithmetic, executable-mode portability, operator
recovery proof and closure after publication. Historical completion of the review
ledger does not erase these limits. New delivery evidence must come from an
actual managed task with fresh preflight, owner decisions and closure.

Tests under `core/test/unit/meta/` check command vocabulary, driving boundaries,
cheatsheet reference sets, repository invariants and ticket/plan agreement. They
do not prove every sentence in these documents. Source inspection, measured
commands and honest revision labels remain necessary.
