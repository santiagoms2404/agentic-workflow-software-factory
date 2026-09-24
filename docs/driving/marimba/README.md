# marimba's installed files

marimba is the driving role: the session that reads this repository's driving
documents and operates AWSF through its CLI. It runs with
`--dangerously-skip-permissions`, so the thing that keeps it inside the
lifecycle is a per-invocation denial at the tool surface. That denial is
performed by the two scripts in this directory.

| File | What it is |
| --- | --- |
| `delegation-guard.sh` | The `PreToolUse` hook. Two fences: a delegation-shaped tool name, and a shell command invoking one of the eight acts the lifecycle reserves for the owner. |
| `session-banner.sh` | The `SessionStart` hook. Prints what it was able to confirm about the guard's presence, and names what it could not. |
| `settings.example.json` | The settings marimba is launched with, as a template. Two absolute paths are left as placeholders. |
| `marimba-guard-rules.mts` | All three fences as pure rules, importing nothing. The one place either harness's lists are written. |
| `marimba-guard.pi.ts` | The pi port of the guard: the same two shared fences, plus the pi-only lifecycle-timeout floor, bound to `tool_call` and `session_start`. |
| `aliases.example.sh` | Launch aliases per harness, model and effort, as a template. One absolute path is left as a placeholder. |
| `compaction/` | marimba's self-compaction profile for pi: thresholds, the summary prompt, the note template, and the re-prime pack read fresh from disk after every compaction. Read by the user-level `self-compact` pi extension when `PI_MARIMBA=1`; see below. |
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

**The fences are per-invocation denials at the tool surface, and each harness
supplies that surface differently.** `settings.example.json` declares them as
`PreToolUse` and `SessionStart` entries; the pi port registers `tool_call` and
`session_start` instead. marimba runs with permission prompts turned off, so
these are not one safeguard among several — they are the entire boundary.

A marimba launched under a harness with **no** such guard carries **neither
fence**. Nothing about the model changes that, and a stronger model does not
substitute for it: fence 2 exists precisely because a capable session asked to
drive will otherwise reach for an owner act when one looks like the obvious next
step. Treat such a session as read-only.

### The second harness: pi

`marimba-guard.pi.ts` is the port. Both harnesses read their rules from
`marimba-guard-rules.mts`, which imports nothing, and the suite asserts the shell
script's own `for` loops still name exactly what that module exports — so
editing one harness's list without the other fails a test rather than silently
producing two different boundaries.

Install is an owner act, and it is one step rather than four: the guard is
passed per launch instead of registered in a settings file.

```bash
pi -e /absolute/path/to/checkout/docs/driving/marimba/marimba-guard.pi.ts
```

`aliases.example.sh` in this directory carries that with the model and effort
variants already spelled out. Copy it into your own shell profile and replace
the one placeholder.

**The `-e` is not optional, and this port's one weakness is that forgetting it
is silent.** The shell guard fails *closed* when its interpreter cannot run — a
machine defect denies everything and says why. An extension that is simply not
loaded denies nothing and says nothing. The Pi aliases set `PI_MARIMBA=1` to
suppress the verbose startup widget and notification, but the named
`marimba-guard: active` status remains mandatory: a Pi session lacking that
status is not guarded, whatever the alias was called. That is a weaker signal
than failing closed, and the honest cost of this port.

Two differences beyond that, both stated in the extension's own header: there is
no external interpreter, so neither of the shell guard's two parser-failure
branches exists; and fence 2's ceiling and over-denials are identical by
construction, because both harnesses call the same function.

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

## Self-compaction on the pi path

`compaction/` is data for a pi extension that is **not** in this repository:
`self-compact`, installed user-level and loaded from the owner's pi settings.
It lets marimba compact its own context at a checkpoint it chooses, with a note
to itself that returns verbatim afterwards. With `PI_MARIMBA=1` and the
checkout as the working directory, the extension reads this directory instead
of its universal profile:

- `profile.json` — thresholds, the note budget, where notes are archived
  (outside the repository), and the re-prime pack.
- `USER_PROMPT_COMPACTION_MESSAGE.md` — the summary prompt. It points at the
  group journal and the status store instead of copying them, and it never lets
  a summary claim the session is still primed.
- `NOTE_TEMPLATE.md`, `USER_PROMPT_SOFT_SELF_COMPACT.md`,
  `USER_PROMPT_WARNING_SELF_COMPACT.md` — the note's shape and the two
  threshold messages.

**Priming does not survive a compaction.** The re-prime pack is the answer: the
files `profile.json` lists are read fresh from disk after every compaction and
delivered before the summary and the note, so the judgment layer comes back
without a full re-prime. `CONTRACT.md` and `AGENTS.md` are not in the pack
because they sit in the system prompt, which a compaction keeps.

None of these files carries live state; the notes themselves are archived under
the owner's state directory, never here.
