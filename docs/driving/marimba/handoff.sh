SETTINGS="$HOME/.claude/marimba/settings.json"
CONTRACT="docs/driving/marimba/CONTRACT.md"
HANDOFF_DIR="$HOME/.local/state/marimba-handoffs"

die() { printf 'handoff.sh: %s\n' "$1" >&2; exit 2; }

[ "$#" -eq 1 ] || die "usage: handoff.sh <handoff-file>"
case "$1" in -*) die "refused; the argument is a path, never a flag" ;; esac

file="$(readlink -f -- "$1")" || die "cannot resolve $1"
case "$file" in
  "$HANDOFF_DIR"/*) ;;
  *) die "refused; handoff files must live under $HANDOFF_DIR" ;;
esac
[ -f "$file" ] || die "not a regular file: $file"
[ -s "$file" ] || die "handoff file is empty: $file"
[ -r "$SETTINGS" ] || die "refused; marimba settings not readable at $SETTINGS"
[ -r "$REPO/$CONTRACT" ] || die "refused; contract not readable at $CONTRACT"

# Variant is a NAME checked against a fixed table, never argv. marimba may pick
# which entry runs; it may never compose one. That is what stops a driving
# session launching a successor with the guard omitted.
variant="${2:-cc-opus-high}"
case "$variant" in
  cc-opus-xhigh)    set -- claude --model opus   --effort xhigh ;;
  cc-opus-high)     set -- claude --model opus   --effort high ;;
  cc-sonnet-high)   set -- claude --model sonnet --effort high ;;
  cc-sonnet-medium) set -- claude --model sonnet --effort medium ;;
  pi-sol-xhigh)     set -- pi --model gpt-6-sol     --thinking xhigh ;;
  pi-sol-high)      set -- pi --model gpt-6-sol     --thinking high ;;
  pi-terra-high)    set -- pi --model gpt-5.6-terra --thinking high ;;
  pi-luna-high)     set -- pi --model gpt-6-luna    --thinking high ;;
  *) die "refused; unknown variant '$variant'. The variant is a name from this script's own table, never a command line." ;;
esac
# Each harness gets its own guard and its own contract flag. Neither is optional.
case "$1" in
  claude) set -- "$@" --dangerously-skip-permissions \
                      --settings "$SETTINGS" \
                      --append-system-prompt-file "$REPO/$CONTRACT" ;;
  pi)     export PI_MARIMBA=1
          set -- "$@" -e "$REPO/docs/driving/marimba/marimba-guard.pi.ts" \
                      --exclude-tools task,agent,subagent,spawn,dispatch \
                      --append-system-prompt "$(cat "$REPO/$CONTRACT")" \
                      --provider openai-codex ;;
esac

exec herdr agent start "marimba-$(date +%H%M%S)" \
  --cwd "$REPO" --split right \
  -- "$@" "Read docs/driving/commands/prime-awsf.md (the /prime-awsf command) and follow it fully before anything else. Do not print a status board. Then read the handoff at $file and follow it. Treat every fact in it as a claim to verify against the repository, not as settled truth."