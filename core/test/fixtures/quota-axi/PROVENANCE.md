# quota-axi fixtures — where these bytes came from

The plan's **fixture integrity rule** says no task may satisfy itself with fixtures
invented from the same unverified protocol assumption it is testing. This file is how
that rule is checkable here rather than asserted: every fixture is either bytes from a
live `quota-axi` process or a stated transformation of those bytes, and the two are
never mixed up.

## The one live probe

**T01's entire live budget: one bounded call.** It was spent on 2026-08-24.

```
node --experimental-strip-types core/test/fixtures/quota-axi/capture-probe.ts <out.json>
```

`capture-probe.ts` is committed beside the fixture. It does not hard-code an argv. It
calls `buildQuotaAxiArgv()` and spawns exactly what that returns, so the argv under test
and the argv that produced these bytes are the same argv by construction.

| | |
|---|---|
| CLI | `quota-axi` 0.1.29 |
| version evidence | package metadata beside the PATH-resolved executable, read without spending a second invocation |
| argv | `--provider claude,codex --json` |
| bound | 30 seconds |
| capture started | `2026-08-24T20:26:39.088Z` |
| payload `generatedAt` | `2026-08-24T20:26:39.429Z` — pin parser `now` to this capture instant |
| exit | `0`, no signal |
| stdout | 3 411 bytes |
| stderr | empty, 0 bytes |

### `nominal.json` — CAPTURED, then SCRUBBED

The file is the process's complete stdout after the required scrub pass. The pass made
no substitutions and removed no fields because default `--json` emitted none of the
private shapes below. The committed 3 411 bytes therefore remain byte-for-byte equal to
the capture.

Scrub audit:

- No account identity, account label, or account id was present.
- No email-shaped or address-shaped string was present.
- No absolute path, home-relative path, cache path, or auth-source path was present.
- No `sourcesTried` entry was present.
- Generic window labels such as `session` and `week` were retained. They describe quota
  window kinds, not an account or machine identity.
- All timestamps were retained because the parser reads them. The capture instant is
  recorded in the table above so tests can inject `now` rather than read a clock.

## Derived fixtures — transformed from `nominal.json`

Each file begins as a complete copy of the captured, scrubbed `nominal.json`; the stated changes below are invented test conditions, and every other byte is retained from that capture.

- `derived-semantics-partial.json` changes Claude's `quotaSemantics.status` to `partial` and adds the invented `unresolvedWindowIds: ["seven_day"]`, retaining all other captured bytes.
- `derived-state-unauthenticated.json` changes both providers to the invented `auth_required` state with `credentials_unavailable` reason and `authenticate the provider` remedy, and replaces their captured windows and effective availability with empty arrays.
- `derived-stale.json` retains every captured raw window, changes both states to invented `stale`, and replaces each effective record with invented unknown availability, pace, runway, and selection values that name every raw id in `unmeasurableWindowIds`.
- `derived-exhausted-now.json` changes every captured raw and effective remaining percentage to the invented value `0` and replaces each runway with an invented zero-second projected exhaustion at captured `generatedAt`.
- `derived-runway-unknown.json` retains Claude's captured effective availability but replaces its runway with the invented `unknown` status and captured `boundedBy` ids named as `unmeasurableWindowIds`, without a duration or exhaustion time.
- `derived-windows-disagree.json` changes Claude's captured raw window percentages to the invented generous value `92` while changing its captured effective percentage to the invented limiting value `4`, retaining the remaining captured bytes.

## Named absence — quota-axi itself rate-limited

No fixture exists for the bytes `quota-axi` emits when it is itself rate-limited. Those
bytes cannot be summoned safely because doing so would require deliberately exhausting
or disrupting the tool's own upstream access. The approved plan is to retain the next natural occurrence
in the private uncommitted attempt area, then scrub and promote it with its exact
transformation recorded here. Until that happens, the absence remains explicit rather
than being filled with invented bytes.

## Rules for whoever reads this next

- **This fixture is replayed, never regenerated.** Re-running `capture-probe.ts` to
  refresh it would spend a second live call to prove something already provable from
  the file.
- A later fixture may be called captured only when its bytes came from a live process.
  Every edit to captured bytes is a scrub or derivation and is recorded above.
