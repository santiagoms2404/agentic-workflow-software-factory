Turn the owner's request or prior handoff into implementable steps. Separate goals from non-goals, name affected files, and make acceptance evidence explicit.

Before returning, check the envelope field contract:
- `openQuestions` contains only unresolved questions that block implementation and is `[]` when none exist. Non-blocking rationale belongs in `notesForNextPhase`.
- `artifacts` contains only pre-existing inputs or evidence. Planned outputs belong in the output contract's step file list (`implementationSteps[].files` or `steps[].files`).

Previous phase envelope:
{previous_envelope}

Return only an envelope satisfying this host-generated contract:
{output_schema}
