# Antigravity (`agy`) — retained capture

Raw bytes from bounded `agy.exe` sessions, captured 2026-09-15. Retained because
`specs/awsf-v2-plan.html` records, as a W09 blocker, that *"the raw byte streams
that earlier sessions saw exist at no citable path and in no fixture in the
tree."* These are that path.

Nothing here is edited except one scrub, noted below. Line endings, key order
and whitespace are as the CLI emitted them.

## Provenance

| | |
|---|---|
| Binary | `C:\Users\Santiago Marin\AppData\Local\agy\bin\agy.exe` |
| Version | `1.1.15` (`version.txt`) |
| Captured | 2026-09-15 |
| Host | WSL2 Ubuntu on Windows; AWSF worktrees live on WSL-native ext4 (`/dev/sdd` at `/`) |
| Auth | Google OAuth, interactive, completed by the owner in a terminal pane |

`agy` does not resolve on `PATH`; the owner reaches it through a shell alias
(`ag='agy.exe --dangerously-skip-permissions'`). Every capture here was taken
**without** that flag, so what is recorded is the default guarded behaviour.

## Files

| File | What it is |
|---|---|
| `version.txt` | `--version` |
| `help.txt` | `--help` — the full flag surface and subcommands |
| `stream2.jsonl` | **Success with tool calls.** From `D:`. The event-ordering evidence |
| `stream3.jsonl` | **Failure path.** Auth required; human prose interleaved before a well-formed `result` |
| `stream4.jsonl` | Success, no tools, from `D:` |
| `stream5.jsonl` | Success, no tools, from WSL-native (`\\wsl.localhost\…`) |
| `stream6.jsonl` | Success, no tools, from a WSL-native directory never seen before |

## The scrub

`stream3.jsonl` contained a Google OAuth authorization URL carrying a PKCE
`code_challenge` and a `state` nonce. Both are single-use and neither is a live
credential, but a fixture in a repository should carry no authorization material
at all. The URL is replaced by `<oauth-url-scrubbed>`; one substitution, nothing
else in the file is altered. No other file needed scrubbing.

## What these bytes establish

1. **A machine-parseable stream exists.** Three event kinds — `init`,
   `step_update`, `result`. Everything else is `step_type`
   (`user_input` | `agent_response` | `tool` | `system_message`) crossed with
   `state` (`ACTIVE` | `DONE`), plus `text_delta` for streaming.

2. **Tool events precede their result.** In `stream2`, `run_command` appears at
   `ACTIVE` with full parameters (`CommandLine: "(Get-Location).Path"`) and
   again at `DONE` with its output, 8.2 seconds later; `view_file` likewise.
   Parameters are visible before the result. This is detection **with latency**,
   not prevention — `ACTIVE` precedes completion, not proven initiation.

3. **The failure path parses, but not cleanly.** `stream3` ends in a well-formed
   `result` with `status: "ERROR"`, a populated `error` and zeroed usage — but
   the bytes before it are human prose. A parser must tolerate non-JSON lines
   rather than treat the first as corruption.

4. **WSL-native working directories work.** `stream5` and `stream6` ran from
   `/home/...` with `init.cwd` reported as `\\wsl.localhost\Ubuntu\home\...`.
   An earlier failure from the same path was an authentication failure, not a
   placement failure — proved by `stream4` succeeding from `D:` minutes later
   on the same token.

5. **Authentication is context-dependent but not per-directory.** The CLI was
   signed in from `D:` and simultaneously reported no session from the WSL path
   (`models` refused). After one interactive login there, `stream6` ran from a
   directory it had never seen with no prompt. A fresh worktree per attempt
   therefore does **not** trigger a login.

6. **The agent cannot report its own working directory.** Three runs without a
   tool produced three different wrong answers; the one run that shelled out was
   correct. The truth is in `init.cwd`. A prompt must state the working
   directory, because the agent invents one and still returns `SUCCESS`.

   | run | tool used | `init.cwd` | answered |
   |---|---|---|---|
   | `stream2` | yes | `D:\…\work` | `D:\…\work` — correct |
   | `stream4` | no | `D:\…\work` | `C:\Users\Santiago Marin` |
   | `stream5` | no | `\\wsl.localhost\…\agy-probe` | `C:\…\antigravity-cli\scratch` |
   | `stream6` | no | `\\wsl.localhost\…\agy-probe2` | `C:\…\antigravity-cli` |

7. **The tool roster is 57 tools, declared in `init`.** It includes
   `run_command`, `send_command_input`, `command_status`; `write_to_file`,
   `replace_file_content`, `multi_replace_file_content`, `sed_file`; twenty-odd
   `browser_*` tools including `execute_browser_javascript`; `call_mcp_tool`,
   `schedule`, `send_message`, `manage_inbox`, `search_web`, `read_url_content`,
   `generate_image`, `delete_knowledge`; and `define_subagent`,
   `invoke_subagent`, `manage_subagents`, `browser_subagent`.

   The last group matters most: **the tool spawns its own agents**, which no
   AWSF broker registration would ever see. `stream2`'s stderr records the same
   class of problem — `"root agent idle; waiting for 1 background task(s)
   (bounded by --print-timeout)"`.

8. **`permission_mode: "request-review"` is the default and it is weaker than it
   sounds.** It is declared in `init`, and under it the agent executed a
   PowerShell command unprompted and unasked — the prompt requested the working
   directory, not a shell call.

9. **No allow/deny tool flag exists**, and no system-prompt flag. `--sandbox`
   ("Run in a sandbox with terminal restrictions enabled") is the only
   untested candidate for the OS boundary W09's graduation condition requires.

10. **Cost and usage.** Usage is reported per step and in aggregate as
    `input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_tokens`,
    `total_tokens` — its own field names, no cache-write, and **no cost**. One
    turn reading a 47-byte file spent 22,598 tokens against a 36,365-token cache
    read; the system prompt behind 57 tools is large.

11. **`--effort` accepts `low|medium|high` only**, against AWSF's six route
    levels, so this adapter needs a declared lossy mapping.

12. **Argv is order-sensitive.** `--print` takes the prompt as its value
    (`--prompt` is documented as its alias) and this is Go's `flag` package,
    which stops parsing at the first non-flag. `--print --output-format=X …`
    silently makes `--output-format` the prompt, runs, and exits `0` with
    prose output and empty stderr. An adapter that builds argv as a fixed array
    must use `=` form or place `--print` last.
