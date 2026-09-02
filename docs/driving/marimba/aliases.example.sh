# marimba's launch aliases, as an EXAMPLE. Installing them is an owner act.
#
# Copy what you want into your own shell profile and replace the one
# placeholder. No machine path is committed here, which is why the placeholder
# exists — the same reason `settings.example.json` carries two.
#
# WHAT THE NAMES MEAN: marimba-<harness>-<model>-<effort>. `cc` is the harness
# whose hooks the guard was written for; `pi` is the ported one. Bare `marimba`
# is the recommended build and is deliberately the strongest, for the reason in
# the next paragraph.
#
# WHY THE DEFAULT IS THE EXPENSIVE ONE. marimba spends none of the factory's
# ceiling — it is the driving session, not a phase — so its model is not a
# budget decision. It is a decision about which mistakes get caught, and two
# steps carry nearly all the risk: resolving a request against the repository
# (`cookbooks/preflight_a_task.md` §3), and reading a blocked attempt. A miss in
# either is not an error the owner sees; it is a whole run spent building the
# wrong thing. Everything else marimba does is retrieval and formatting, which
# is what the cheaper aliases are for.

MARIMBA_CHECKOUT="REPLACE_WITH_ABSOLUTE_PATH_TO_CHECKOUT"
MARIMBA_SETTINGS="$HOME/.claude/marimba/settings.json"
MARIMBA_PI_GUARD="$MARIMBA_CHECKOUT/docs/driving/marimba/marimba-guard.pi.ts"

# --- the reference harness ----------------------------------------------------
# Both fences are this harness's own hooks, registered in the settings file.
# `--settings` MERGES with settings already in scope rather than replacing them.

_marimba_cc='claude --settings "$MARIMBA_SETTINGS" --dangerously-skip-permissions'

alias marimba-cc-opus-high="$_marimba_cc --model opus --effort high"
alias marimba-cc-opus-xhigh="$_marimba_cc --model opus --effort xhigh"
alias marimba-cc-sonnet-medium="$_marimba_cc --model sonnet --effort medium"

# The recommended build. Change this line, not your habits.
alias marimba='marimba-cc-opus-high'

# --- the ported harness -------------------------------------------------------
# The guard is an extension here rather than a hook, so it is passed per launch
# with `-e`. THE `-e` IS NOT OPTIONAL: without it pi denies nothing and says
# nothing, which is the one failure mode this port has that the hook version
# does not. `--exclude-tools` is belt-and-braces against the same class the
# extension's fence 1 covers by shape.
#
# Confirm the banner names the guard at session start. A marimba session that
# does not announce it is not guarded, whatever the alias was called.

_marimba_pi='pi -e "$MARIMBA_PI_GUARD" --exclude-tools task,agent,subagent,spawn,dispatch'

alias marimba-pi-sol-high="$_marimba_pi --provider openai-codex --model gpt-5.6-sol --thinking high"
alias marimba-pi-sol-xhigh="$_marimba_pi --provider openai-codex --model gpt-5.6-sol --thinking xhigh"
alias marimba-pi-terra-high="$_marimba_pi --model '*terra*' --thinking high"
alias marimba-pi-luna-medium="$_marimba_pi --model '*luna*' --thinking medium"
alias marimba-pi-luna-xhigh="$_marimba_pi --model '*luna*' --thinking xhigh"

# --- choosing between them ----------------------------------------------------
#
# Preflight a task, or read a blocked attempt   -> marimba, or -cc-opus-xhigh
#                                                  for a large or previously
#                                                  failed task
# Status, watching a run, explaining an owner
# act, drafting a request                       -> -cc-sonnet-medium, or any pi
#                                                  alias
# Claude quota is tight and the work is real    -> -pi-sol-high
#
# The cheaper models are not weaker at reporting. They are weaker at noticing
# that a filter cannot match the filenames a request assumes, which is the whole
# of §3 and the reason the default is what it is.
