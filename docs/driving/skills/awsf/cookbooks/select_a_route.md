# Select a route

The owner names a model, an effort or a provider for a phase. You attach it to
the attempt; you never edit configuration to do it.

## Read the vocabulary, do not carry it

```bash
just awsf routes list
```

It prints the declared adapters with the provider each one reports, the effort
levels beside what each adapter actually sends, every agent phase id a route may
name and the workflows it runs in, and the review rule. It starts no process and
reserves no call.

Read it when routing comes up. Do not memorise a model list into the primed
context: the CLI keeps no model catalogue on purpose, a list carried in context
is stale from the moment the session opens, and this command is not.

## Attach the route at creation

```bash
just awsf new TASK "REQUEST" --route builder=codex/openai-codex/gpt-6-astra@xhigh --route reviewer=claude/anthropic/claude:opus@high
```

`--route` repeats, one per phase, in the form
`<phase>=<adapter>/<provider>/<model>@<effort>`. Every part but the phase is
optional and the layers combine field by field, so `--route builder=@max`
sharpens the effort of a route the configuration already chose and leaves the
rest of it alone.

Three refusals happen before an attempt exists, and each names what it read: a
phase id that is not an agent phase, an adapter without its provider, and an
effort outside the six levels.

The selection is recorded on the attempt, not folded into its configuration
snapshot. That is what keeps `rework` and `review` available afterwards — both
refuse when the live configuration no longer matches the snapshot, and a route
written into `awsf.config.yaml` mid-task would trip exactly that.

## When the pair collapses onto one provider

In a workflow that buys a review, the reviewer must resolve to a different
**provider** than the builder. Two models from one provider are still one
provider: Opus reviewing Sonnet is a provider checking its own output.

`new` says so when the routes as written already collapse, names the act, and
creates the attempt anyway — refusing would leave nothing for that act to
address. The run is what refuses until the grant exists.

That grant is an owner act:

```bash
awsf degrade-review TASK --reason "WHY"
```

Prepare it and explain it. Never perform it, and never describe it as a way
around a quota wall without also saying what it costs: the candidate is checked
by the provider that wrote it, and the review that results is weaker evidence
than a cross-provider one. The grant is recorded on that attempt alone, is
unrepeatable, and does not survive into a retry — the next attempt asks the
owner again.

Nothing in the host can set it for you. A quota error, a transport failure or an
unavailable adapter never selects a same-provider review; if one appears to,
that is a defect in the CLI and is fixed there.

## What to report

Name the routes you attached alongside the usual handle — the task, the attempt,
the lifecycle state, and calls spent against the ceiling. `status` prints the
attempt's own routes and, if one was granted, the degradation and its reason, so
the owner can read back what this run was asked to do differently without
remembering the launch line.
