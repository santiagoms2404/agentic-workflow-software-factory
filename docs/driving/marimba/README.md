# marimba's installed files

marimba is the driving role: the session that reads this repository's driving
documents and operates AWSF through its CLI. It runs with
`--dangerously-skip-permissions`, so the thing that keeps it inside the
lifecycle is a per-invocation denial at the tool surface. That denial is
performed by the two scripts in this directory.

| File | What it is |
| --- | --- |
| `delegation-guard.sh` | The `PreToolUse` hook. Two fences: a delegation-shaped tool name, and a shell command invoking one of the six acts the lifecycle reserves for the owner. |
| `session-banner.sh` | The `SessionStart` hook. Prints what it was able to confirm about the guard's presence, and names what it could not. |
| `settings.example.json` | The settings marimba is launched with, as a template. Two absolute paths are left as placeholders. |
| `README.md` | This file. |

**Read the guard's header before trusting it with anything.** It names, with
dates, every limit that was measured against it — what fails open, what fails
closed, the indirection that evades the second fence, the reads it over-denies,
and the fact that it does not protect its own files. It is not a sandbox.

## The repository holds the only copy

There is no second, installed copy of either script. The owner's settings point
their hook commands at the files in this directory by absolute path, so the file
that is tested and the file that executes are the same bytes and cannot drift
apart. Two costs come with that, and both are accepted rather than solved:

- **A moved or renamed checkout unresolves both hook commands.** A hook command
  that cannot execute does not fail loudly — the tool call simply proceeds. The
  banner is what surfaces this, at session start rather than afterwards.
- **marimba can still edit the files that constrain it.** The guard reads a
  command field and nothing else, so a write aimed at its own script is not
  denied. This is stated in the guard's header rather than fenced, because a
  fence on the file-writing tools would leave the shell route open while reading
  as though it had closed both.

## Install — these are owner acts

The owner performs all four. A driving session prepares them and explains them;
it does not run them.

1. Copy `settings.example.json` to wherever marimba's settings live —
   conventionally `~/.claude/marimba/settings.json`, which is outside this
   repository and is the owner's own file.
2. In that copy, replace both `REPLACE_WITH_ABSOLUTE_PATH_TO_CHECKOUT`
   placeholders with the absolute path of this checkout. No machine path is
   committed here, which is why the placeholders exist.
3. Make both scripts executable if the checkout did not preserve the bit:

   ```bash
   chmod +x docs/driving/marimba/delegation-guard.sh
   chmod +x docs/driving/marimba/session-banner.sh
   ```

4. Launch marimba with that settings file. `--settings` **merges** with the
   settings already in scope rather than replacing them; `--setting-sources` is
   the flag that excludes. A project's own `PreToolUse` hook returning *allow*
   does not override this deny — measured, with the project hook proven to have
   run.

Re-run step 2 after moving the checkout. Nothing else needs reinstalling,
because nothing else was installed.

## Choosing marimba's own harness, model and effort

marimba spends none of the factory's ceiling — it is the driving session, not a
phase — so its model is not a budget decision the way an agent's is. It is a
decision about which mistakes get caught. Two steps carry nearly all the risk:

- **Preflight §3, resolving a request against the repository.** Noticing that a
  filter cannot match the filenames a request assumes takes reading unfamiliar
  code and holding two facts against each other. A miss here is not a marimba
  error the owner sees; it is a whole run spent building the wrong thing.
- **Reading a blocked attempt.** The finding is the *disagreement* between what
  a phase claimed and what a gate measured, and locating it is diagnosis rather
  than retrieval.

Everything else marimba does — reporting a handle, watching a run, explaining an
owner act — is retrieval and formatting. So: put the strongest model available
on a preflight or a blocked-attempt read, and use a cheaper one freely for the
rest. Naming specific models here would go stale, and the choice is the owner's
at launch rather than anything this repository configures.

### A harness swap is a boundary change, not a preference

**The two fences are hooks of one specific harness.** `settings.example.json`
declares them as `PreToolUse` and `SessionStart` entries, and the deny list that
accompanies them is that harness's own. marimba runs with permission prompts
turned off, so those hooks are not one safeguard among several — they are the
entire boundary.

A marimba launched under a *different* harness therefore carries **neither
fence** unless an equivalent per-invocation hook has been wired up and proven
there. Nothing about the model changes that, and a stronger model does not
substitute for it: fence 2 exists precisely because a capable session asked to
drive will otherwise reach for an owner act when one looks like the obvious next
step.

Until an equivalent guard exists and is proven against the same payload matrix,
treat a marimba on another harness as **read-only**: status, watching, reading
evidence, drafting a request. Not launching, and never an owner act. That is a
real piece of work and deserves its own task rather than an assumption.

## What the banner tells you, and what it does not

It confirms three things: that marimba's settings file loaded (it is registered
in that file, so it running at all is the proof), that the guard script is
present and executable, and that the payload parser runs.

It cannot confirm that the `PreToolUse` hook will fire on the next tool call,
and no line it prints implies otherwise. It always exits `0`: a session-start
hook that fails is a new way to break a session in exchange for nothing.

It is deliberately **not** a self-test. Issuing a call designed to be denied,
just to watch it be denied, would put a document in the execution path of its
own boundary. The guard's behaviour is proven offline instead, by a payload
matrix under `core/test/unit/meta/` that runs against these same bytes.
