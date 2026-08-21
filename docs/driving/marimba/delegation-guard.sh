#!/usr/bin/env bash
# marimba guard (PreToolUse). Two fences, one script.
#
# WHAT IT IS FOR, in one sentence: it keeps a driving session inside the
# factory's own lifecycle by refusing two shapes of tool call at the tool
# surface. IT IS NOT A SANDBOX. It does not confine what the session reads,
# writes or runs, it does not protect its own files, and a session that decides
# to route around it can. The measured limits below say exactly how.
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
# ---------------------------------------------------------------------------
# MEASURED LIMITS. Every item below was captured on 2026-08-21 against this
# script. They are stated rather than closed, and each says why.
# ---------------------------------------------------------------------------
#
#   THE PAYLOAD IS PARSED BY AN EXTERNAL INTERPRETER (python3), and the two ways
#   that can go wrong now get opposite answers:
#     * a payload the parser REJECTS fails OPEN. Malformed JSON, an empty
#       payload, or a shape this script does not recognise exit 0 and the call
#       proceeds. Failing closed there would brick every tool call on the day
#       the harness changes its payload schema, which is the worse failure.
#     * an interpreter that CANNOT RUN fails CLOSED - exit 2, with both the
#       cause and the fix on stderr. Before this branch existed, a missing or
#       broken python3 disabled BOTH fences and exited 0 with no signal at all
#       (measured 2026-08-21). That is how marimba could have run unguarded
#       without anyone noticing, and it is the whole reason for the split.
#
#   FENCE 2 READS WRITTEN COMMAND TEXT, NOT RESOLVED INTENT. This is the
#   design's ceiling rather than an oversight. `script -qec "awsf land T"` is
#   denied; the same act reached through a shell variable is ALLOWED - measured:
#       v=land; script -qec "awsf $v T"      -> exit 0
#   No arrangement of substring matching closes that, and widening the match
#   until it might would cost more in false denials than the gap costs.
#
#   FENCE 2 OVER-DENIES. A command that merely READS or QUOTES an act name is
#   refused: `grep -rn "awsf land" docs/` and `echo awsf land > f.txt` both exit
#   2, measured. Accepted, because separating a mention from an invocation means
#   parsing shell, and a guard that parses shell stops being reviewable.
#
#   THE GUARD DOES NOT PROTECT ITS OWN FILES. An Edit whose file_path is this
#   script is ALLOWED, because fence 2 only ever looks at a `command` field. A
#   third fence over the file-writing tools was considered and REFUSED on
#   2026-08-21: it would leave the `sed -i` route wide open while reading as
#   though it had closed both, and a half-closed hazard that looks closed is the
#   exact defect this guard's own documents exist to retire.
#
#   `mcp__*` NAMES ARE NEVER CLASSIFIED. An MCP server chooses its own nouns, so
#   fence 1 does not read them at all.
#
#   PTY ALLOCATION ITSELF IS NOT DENIED, only the acts. A command that reaches
#   an owner act by a route this script cannot read is not covered.
#
# Deny protocol: exit 2 with the reason on stderr and NOTHING on stdout.
set -eu

deny() {
  printf 'marimba: %s\n' "$1" >&2
  printf '%s\n' "$2" >&2
  exit 2
}

# --- parse --------------------------------------------------------------------
# The interpreter's exit STATUS is captured apart from its output, because the
# two failures it can have are different failures and get opposite answers. The
# python program below exits 0 even for a payload it cannot parse - it prints a
# blank pair instead - so a nonzero status here means the interpreter never ran,
# not that the payload was bad.
payload=$(cat)

set +e
parsed=$(printf '%s' "$payload" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    c = (d.get("tool_input") or {}).get("command", "") or ""
    print((d.get("tool_name","") or "") + " " + " ".join(c.split()))
except Exception:
    print(" ")' 2>/dev/null)
parser_status=$?
set -e

if [ "$parser_status" -ne 0 ]; then
  deny "the payload parser could not run (python3 exited $parser_status), so BOTH fences are disabled." \
"Failing closed on purpose: an interpreter that cannot run is a machine defect that affects every call, and a guard that is silently absent is the failure this branch exists to stop. Fix: make \`python3\` runnable on this machine, then start a new session."
fi

read -r name cmd <<EOF
$parsed
EOF

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
