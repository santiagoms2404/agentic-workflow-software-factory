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

# The prompt NAMES the handoff rather than embedding it. Embedding would put the
# handoff's words into marimba's own command string, where fence 2 refuses any
# text quoting an owner act - the documented over-denial in CONTRACT.md section 3.
exec herdr agent start "marimba-$(date +%H%M%S)" \
  --cwd "$REPO" \
  --split right \
  -- claude \
     --model opus \
     --effort high \
     --dangerously-skip-permissions \
     --settings "$SETTINGS" \
     --append-system-prompt-file "$CONTRACT" \
     "Read /prime-awsf and follow it fully before anything else. Do not print a status board. Then read the handoff at $file and follow it. Treat every fact in it as a claim to verify against the repository, not as settled truth."