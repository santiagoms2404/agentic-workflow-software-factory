#!/usr/bin/env bash
# marimba SessionStart banner.
#
# WHY IT EXISTS. Two measured ways a marimba session ends up with no boundary
# and no signal: a `--settings` path that does not resolve, and a payload parser
# that cannot run (both captured 2026-08-21; the second now fails closed in
# delegation-guard.sh). Neither announced itself, so there was no positive
# confirmation anywhere that a session was running guarded. This prints what can
# actually be confirmed, before the first tool call rather than after it.
#
# THE THREE RULES IT MAY NOT SOFTEN
#
#   1. IT REPORTS WHAT IT CHECKED, NEVER WHAT IT HOPES. Three things are
#      cheaply checkable and all three are checks about presence: that marimba's
#      settings file loaded (this banner is registered inside it, so it running
#      at all is the proof), that the guard script is present and executable,
#      and that the payload parser runs. WHETHER THE PreToolUse HOOK WILL FIRE
#      IS NOT AMONG THEM and no line below may imply it is. A hook registration
#      that loads is not a hook that fires, and the difference is exactly the
#      kind of gap this workstream exists to stop papering over.
#
#   2. IT ALWAYS EXITS 0. A SessionStart hook that fails is a new way to break a
#      session in exchange for nothing. That is why there is no `set -e` and no
#      `set -u` here: an unbound variable or a failing check must degrade into a
#      reported line, never into a nonzero exit.
#
#   3. IT IS NOT A SELF-TEST. Making marimba issue a deliberately-denied call at
#      session start was considered and refused: that puts a document in the
#      execution path of its own boundary, which this project refuses
#      everywhere else. The guard's behaviour is proven offline by the matrix in
#      core/test/unit/meta/, against the same bytes this banner points at.

# The guard is a sibling of this script, because the repository holds the only
# copy of both. MARIMBA_GUARD_PATH overrides it so the absence case can be
# exercised without moving a file.
here=$(cd "$(dirname "$0")" 2>/dev/null && pwd)
guard=${MARIMBA_GUARD_PATH:-$here/delegation-guard.sh}

ok=0
bad=0
line() {
  printf '  %-9s %s\n' "$1" "$2"
  if [ "$1" = "ok" ]; then
    ok=$((ok + 1))
  else
    bad=$((bad + 1))
  fi
}

printf 'marimba - what this banner was able to check at session start:\n'

line "ok" "marimba's settings file loaded (this banner is registered in it, and is running)"

if [ ! -e "$guard" ]; then
  line "MISSING" "no guard script at $guard"
  printf '            Nothing here can deny a delegation-shaped tool call or an owner act.\n'
  printf '            Check the PreToolUse hook command in marimba/settings.json - the\n'
  printf '            repository holds the only copy, so a moved checkout unresolves it.\n'
elif [ ! -x "$guard" ]; then
  line "NOT EXEC" "guard script present but not executable: $guard"
  printf '            A hook command that cannot execute does not fail loudly; the tool\n'
  printf '            call proceeds. Restore the executable bit.\n'
else
  line "ok" "guard script present and executable: $guard"
fi

if python3 -c 'pass' >/dev/null 2>&1; then
  line "ok" "payload parser runs (python3)"
else
  line "BROKEN" "python3 does not run here"
  printf '            The guard parses its payload with it and now fails CLOSED when it\n'
  printf '            cannot run, so tool calls will be denied until python3 works.\n'
fi

printf 'NOT CHECKED: whether the PreToolUse hook actually fires on the next tool call.\n'
printf 'This banner cannot determine that and does not claim it. %s confirmed, %s to fix.\n' "$ok" "$bad"

# Rule 2, restated as code: nothing above may change this.
exit 0
