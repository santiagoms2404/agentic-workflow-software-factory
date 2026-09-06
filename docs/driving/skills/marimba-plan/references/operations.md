# Operations and record semantics

Run `npm run awsf --silent -- group help` in the AWSF checkout. Every operation is
host-side, with no provider launch. Use `--state-root` only for an owner-authorized
state root outside Git checkouts. Project/group identifiers are explicit, not
inferred from an attempt or from the current shell session.

## Capture and inspect

`group capture` takes `--project`, `--group`, `--id` (event idempotency key),
`--expected` (current group revision, initially 0), `--input-id`, `--input-file`,
`--provenance` and `--narrative-file`. Optional `--attachments-file` is a JSON array
of references. Input files must contain the exact UTF-8 text, including its final
newline if one was present. Do not paste a rewrapped quotation instead. Admission
refuses invalid UTF-8, NUL, credential-shaped text and inputs over 1 MiB. It never
silently masks text. Attachment bytes stay at their provenance location.

Use `group schema --kind narrative` for the strict narrative schema. Every stage
has a title, ELI explanation, changes, reason, friction, task references and source
references. Capture/proposal narratives are explicitly assistant explanations.
Only the referenced input text is the exact owner input. Applying a proposal
records acceptance separately. Friction can be empty. An optional SVG can be an attachment reference,
not executable markup inside a stage. References carry absolute runtime paths,
repository identity, revision, locator and SHA-256. `group reference` hashes a
source through the CLI. It does not validate the author's claim about that source.

`group input --input-id ID` emits the original without adding a newline. `group
inspect` replays all history and inputs. Use `group inspect --input-id ID` for one
input with its complete attachment provenance, or `group inspect --proposal ID`
for one full delta and its approval hash. Reserve the full view for audits. Ordinary focus/orient views name original inputs and attachment digests without
copying their entire text or unrelated historical attachment records. Current
scope references are interned by stable content identity and printed once. Read each original and follow-up fully once before reasoning
from it. References to images/audio do not replace opening them.

## Propose and apply

`group schema --kind proposal` prints the complete strict JSON schema. Required
proposal fields are `id`, `base`, `narrative`, `alternatives` and `changes`.
`group propose --proposal-file FILE --id EVENT --expected REV` appends a proposal
stage. Its `base` must equal REV. Its returned group revision is REV + 1.

Each definition supplies the whole selected unit, not the whole group. Unit ids
are stable labels. New definitions start at revision 1. Redefinitions increment
that unit's revision and retain its prior versions. `scope` and `acceptance` must
be nonempty. `serves` refers to declared requirements, all of which must remain
covered. `decisions` lists unresolved choices, never fabricated approvals.

Change kinds:

- `define` adds or revises one unit. `constraints` and `requirements` replace
  their accepted sets while preserving old sets in the journal. Changed global
  constraints automatically revise every existing nonsplit unit. Changed requirement
  text revises the units serving it. The host retains unchanged unit fields, and
  the confirmation lists every affected revision. Prior completion cannot carry
  over through a change to this shared acceptance context. Explicit unit revisions
  in the same proposal are not incremented twice.
- `order` changes only scheduling preference. It must name every stable unit id.
- `split` retires the parent without deleting it, creates new child identities,
  retains lineage and coverage, and requires explicit retargeting of successors.
- `defer` records a reason and revisit condition. It revises the unit, preserves
  every attempt, and cannot cancel execution. Deferral is a separate checklist
  field from observed delivery.
- `bind` associates an exact unit revision with a task, attempt number and session
  identity. No execution state is written. An older binding never establishes
  completion for revised acceptance criteria.
- `accept-interface` approves a specific prerequisite contract for a unit revision
  with evidence references. Implementation completion cannot silently substitute
  for an accepted interface contract.
- `accept-delivery` records evidence-backed owner acceptance only for a unit whose
  completion policy is `owner-accepted`. For `landed`, the observed, revision-bound
  attempt must instead be LANDED or PUBLISHED with a candidate revision.
- `close` seals the group against further planning writes, including pending
  proposals. A handoff is a new group, not an attempt continuation.

The owner runs `group apply --proposal ID --proposal-hash SHA256 --reason TEXT
--id EVENT --expected REV` with the same project/group. Find the canonical proposal
hash in the proposal command result or an orientation/focus packet. Confirmation displays the complete proposal
and exact revision. No noninteractive approval flag exists. Every intervening stage
invalidates a pending proposal, so re-propose against the latest revision rather
than silently rebasing an approval. Approval is an owner-terminal act on the same
machine, not cryptographic identity verification. A same-user process with direct
filesystem access is outside the journal's integrity threat model.

## Progress, freshness and recovery

`group checklist` joins the group with existing execution journals and verifies
that their status projections agree. It never writes them. A readable, complete
task inventory with no matching attempts supports todo. Missing inventory supports
unknown. Missing revision bindings or mismatched sources support stale. Active
attempts remain visible even when their unit is deferred or revised.

`group focus --unit ID` includes applicable constraints, selected scope, prerequisite
contracts, relevant changes, unresolved decisions, evidence references and
freshness. `group orient` supplies an index. Add `--proposal ID` to either command
to preview an unapplied, current proposal. The result explicitly labels unapproved
scope, cannot manufacture acceptance evidence, and leaves the real checklist
unchanged. Amendment summaries link to full retained proposals through their ids
and hashes. Use inspect for the complete delta, not the summary, when approving it. Defaults are 16 KiB and 8 KiB. Both
refuse incomplete output with the required byte count. `--max-bytes` explicitly
raises a budget. Byte counts are not token counts or subscription savings.

The group uses the existing append-and-fsync Journal, exclusive lock and replay
scanner at `projects/PROJECT/groups/GROUP/journal.jsonl` under the state root.
There is no separate amendment database, saved checklist or packet cache. History
can be rebuilt from that journal alone. Hash chaining detects accidental mutation,
not malicious re-signing by someone who can rewrite the entire state root.

A duplicate event id with identical input returns the replayed group. A conflicting
id, stale revision, held lock, malformed journal or torn final write is refused.
A crash after a complete append is recovered by replay and an identical retry.
A torn tail or abandoned lock requires owner recovery. No command in this slice
truncates a journal or steals a lock. Retain the files and investigate before
repairing them. This is a named operational limitation, not an automatic repair.
