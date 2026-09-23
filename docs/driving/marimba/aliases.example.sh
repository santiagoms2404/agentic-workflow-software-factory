# marimba's launch aliases, as an EXAMPLE. Installing them is an owner act.
#
# Copy what you want into your own shell profile and replace the one
# placeholder. No machine path is committed here, which is why the placeholder
# exists — the same reason `settings.example.json` carries two.
#
# WHAT THE NAMES MEAN: marimba-<harness>-<model>-<effort>. `cc` is the harness
# whose hooks the guard was written for; `pi` is the ported one. Bare `marimba`
# is the recommended build and is deliberately the strongest.
#
# TWO THINGS EVERY ALIAS MUST CARRY, and dropping either is silent:
#   * the GUARD — settings on `cc`, `-e` on `pi`. Without it there are no fences.
#   * the CONTRACT — `--append-system-prompt-file` on `cc`,
#     `--append-system-prompt` on `pi`. Without it marimba is guarded but does
#     not know its own posture, its hard rules, or which acts are the owner's.
# An earlier version of this file carried the first and not the second. A
# session launched from it was fenced and uninstructed, which is the failure
# this comment exists to stop recurring.
#
# WHY THE DEFAULT IS THE EXPENSIVE ONE. marimba spends none of the factory's
# ceiling — it is the driving session, not a phase — so its model is not a
# budget decision. It is a decision about which mistakes get caught, and two
# steps carry nearly all the risk: resolving a request against the repository
# (`cookbooks/preflight_a_task.md` §3), and reading a blocked attempt. A miss in
# either is not an error the owner sees; it is a whole run spent building the
# wrong thing. Everything else is retrieval and formatting, which is what the
# cheaper aliases are for.


MARIMBA_CHECKOUT="REPLACE_WITH_ABSOLUTE_PATH_TO_CHECKOUT"
MARIMBA_SETTINGS="$HOME/.claude/marimba/settings.json"
MARIMBA_CONTRACT="$MARIMBA_CHECKOUT/docs/driving/marimba/CONTRACT.md"
MARIMBA_PI_GUARD="$MARIMBA_CHECKOUT/docs/driving/marimba/marimba-guard.pi.ts"

# --- the reference harness: Claude Code, Claude models only -------------------
# Both fences are this harness's own hooks, registered in the settings file.
# `--settings` MERGES with settings already in scope rather than replacing them.

_marimba_cc() {
  cd "$MARIMBA_CHECKOUT" || return 1
  claude --dangerously-skip-permissions \
         --settings "$MARIMBA_SETTINGS" \
         --append-system-prompt-file "$MARIMBA_CONTRACT" "$@"
}

alias marimba-cc-opus-xhigh="_marimba_cc --model opus   --effort xhigh"
alias marimba-cc-opus-high="_marimba_cc --model opus   --effort high"
alias marimba-cc-opus-medium="_marimba_cc --model opus   --effort medium"
alias marimba-cc-opus-low="_marimba_cc --model opus   --effort low"
alias marimba-cc-sonnet-xhigh="_marimba_cc --model sonnet --effort xhigh"
alias marimba-cc-sonnet-high="_marimba_cc --model sonnet --effort high"
alias marimba-cc-sonnet-medium="_marimba_cc --model sonnet --effort medium"
alias marimba-cc-sonnet-low="_marimba_cc --model sonnet --effort low"
alias marimba-cc-haiku-medium="_marimba_cc --model haiku  --effort medium"
alias marimba-cc-haiku-low="_marimba_cc --model haiku  --effort low"

# The recommended build. Change this line, not your habits.
alias marimba='marimba-cc-opus-high'

# --- the ported harness: pi, OpenAI models only -------------------------------
# The guard is an extension here rather than a hook, so it is passed per launch
# with `-e`. THE `-e` IS NOT OPTIONAL: without it pi denies nothing and says
# nothing, which is the one failure mode this port has that the hook version
# does not. `--exclude-tools` is belt-and-braces against the same class the
# extension's fence 1 covers by shape.
#
# The provider is pinned to `openai-codex` on every alias. pi also serves Claude
# models through github-copilot; those are deliberately absent, because the
# harness/model pairing is the thing these names promise.
#
# Pi aliases suppress the verbose startup widget/notification. The persistent
# `marimba-guard: active` status remains the named loaded-guard signal; a Pi
# session lacking that status is not guarded, whatever the alias was called.

_marimba_pi() {
  cd "$MARIMBA_CHECKOUT" || return 1
  PI_MARIMBA=1 pi -e "$MARIMBA_PI_GUARD" \
     --exclude-tools task,agent,subagent,spawn,dispatch \
     --append-system-prompt "$(cat "$MARIMBA_CONTRACT")" \
     --provider openai-codex "$@"
}

alias marimba-pi-astra-xhigh="_marimba_pi --model gpt-6-astra   --thinking xhigh"
alias marimba-pi-astra-high="_marimba_pi --model gpt-6-astra   --thinking high"
alias marimba-pi-astra-medium="_marimba_pi --model gpt-6-astra   --thinking medium"
alias marimba-pi-astra-low="_marimba_pi --model gpt-6-astra   --thinking low"
alias marimba-pi-sol-xhigh="_marimba_pi --model gpt-6-sol     --thinking xhigh"
alias marimba-pi-sol-high="_marimba_pi --model gpt-6-sol     --thinking high"
alias marimba-pi-sol-medium="_marimba_pi --model gpt-6-sol     --thinking medium"
alias marimba-pi-sol-low="_marimba_pi --model gpt-6-sol     --thinking low"
alias marimba-pi-terra-xhigh="_marimba_pi --model gpt-5.6-terra --thinking xhigh"
alias marimba-pi-terra-high="_marimba_pi --model gpt-5.6-terra --thinking high"
alias marimba-pi-terra-medium="_marimba_pi --model gpt-5.6-terra --thinking medium"
alias marimba-pi-luna-xhigh="_marimba_pi --model gpt-6-luna    --thinking xhigh"
alias marimba-pi-luna-high="_marimba_pi --model gpt-6-luna    --thinking high"
alias marimba-pi-luna-medium="_marimba_pi --model gpt-6-luna    --thinking medium"
alias marimba-pi-55-high="_marimba_pi --model gpt-5.5       --thinking high"
alias marimba-pi-54-medium="_marimba_pi --model gpt-5.4       --thinking medium"

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