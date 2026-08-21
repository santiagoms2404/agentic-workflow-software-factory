#!/usr/bin/env bash
# marimba guard (PreToolUse). Two fences, one script.
#
# 1. DELEGATION SHAPE. Denies a tool whose NAME is delegation-shaped, so a
#    driving session cannot create work the factory has no attempt directory,
#    journal record, reserved call or gate for. Classification is by SHAPE, not
#    against a fixed list, so a tool name that does not exist yet is denied on
#    arrival rather than missed.
#
# 2. OWNER ACTS. Denies a shell command that invokes one of the six acts the
#    lifecycle reserves for the owner. This exists because the lifecycle's own
#    barrier is weaker than it reads: `processOwnerTerminal()` checks
#    `process.stdin.isTTY`, which is a terminal-SHAPE check, and a same-user
#    agent with shell access can allocate a PTY (`script -qec`) and answer the
#    confirmation. Captured 2026-08-20. The TTY requirement stops an accidental
#    non-interactive invocation; it stops nothing deliberate. This fence is what
#    makes the boundary real while marimba keeps --dangerously-skip-permissions.
#
# Stated limits, deliberately:
#   - malformed JSON fails OPEN. Failing closed on a payload-shape change would
#     brick every tool call the day the harness changes its schema.
#   - `mcp__*` names are never classified; an MCP server chooses its own nouns.
#   - PTY allocation itself is not denied, only the acts. A command that reaches
#     an owner act by a route this script cannot read is not covered.
#
# Deny protocol: exit 2 with the reason on stderr and NOTHING on stdout.
set -eu

payload=$(cat)
read -r name cmd <<EOF
$(printf '%s' "$payload" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    c = (d.get("tool_input") or {}).get("command", "") or ""
    print((d.get("tool_name","") or "") + " " + " ".join(c.split()))
except Exception:
    print(" ")' 2>/dev/null || printf ' ')
EOF

deny() {
  printf 'marimba: %s\n' "$1" >&2
  printf '%s\n' "$2" >&2
  exit 2
}

# --- fence 2: owner acts ------------------------------------------------------
# Checked first: an owner act reached through Bash is the more consequential of
# the two, and Bash is never delegation-shaped, so the order costs nothing.
if [ -n "${cmd:-}" ]; then
  for verb in land cancel rework review journey raise; do
    case " $cmd " in
      *"awsf $verb"*)
        deny "\`awsf $verb\` is an owner act and is denied in a driving session." \
"Prepare it and explain it: the handle, what the evidence supports, and what remains. The owner runs it themselves. The TTY prompt is a terminal-shape check, not an authorization boundary, so this fence is the one that holds."
        ;;
    esac
  done
fi

# --- fence 1: delegation shape ------------------------------------------------
case "$name" in
  mcp__*) exit 0 ;;
esac

norm=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
[ -n "$norm" ] || exit 0

# Whole-name exclusions, never substrings.
# Observe-or-stop: denying these could strand work already running with no way
# to inspect or end it. Plan-only: the harness's own session-local todo list has
# no executor, so it is a false positive of the `task` stem rather than policy.
# `listagents` enumerates and creates nothing, so it belongs here too.
for allowed in taskoutput taskstop taskget tasklist listagents cronlist bashoutput killshell taskcreate taskupdate; do
  [ "$norm" = "$allowed" ] && exit 0
done

for stem in agent subagent task workflow cron schedul worktree delegate spawn dispatch handoff remote sendmessage monitor; do
  case "$norm" in
    *"$stem"*)
      deny "$name is delegation-shaped and is denied in a driving session." \
"Work started this way has no attempt directory, no journal record, no reserved call and no gate, so every AWSF guard counts zero. Use the awsf CLI instead."
      ;;
  esac
done
exit 0
