// `awsf routes list` — the route vocabulary, so a driving session can compose
// a `--route` without a catalogue of every combination being written down.
//
// It spends nothing. Both adapters answer `getModelInfo` from constants, no
// process is started, no phase runs, and no call is reserved — so a session may
// read this as often as it likes.
//
// It also states what this CLI does NOT know. AWSF keeps no model catalogue on
// purpose: a selector is whatever the adapter's own CLI accepts, and inventing
// a list here would produce a name that reads as authoritative and is stale the
// week a provider retires it. So the models section names the enumeration
// command for the adapters that have one, and says plainly that the others have
// none rather than guessing on their behalf.

import { effortFor } from "../../adapters/claude-code.ts";
import { thinkingFor } from "../../adapters/pi-codex.ts";
import { ROUTE_EFFORT_LEVELS, type AwsfConfig } from "../../config/schema.ts";
import { AGENT_PHASE_IDS } from "../../config/workflow-ids.ts";
import { WORKFLOW_RECIPES } from "../../workflow/catalog.ts";
import { registeredAdapter } from "../../adapters/registry.ts";

/** How an adapter kind's own CLI enumerates the models it will accept. */
const ENUMERATION_COMMAND: Readonly<Record<string, string>> = Object.freeze({
  "pi-codex": "pi --list-models",
});

/**
 * The config spelling translated by each adapter that can represent it.
 *
 * `none` is the one that differs and the difference matters: pi has a real off
 * switch, and the Claude CLI has none, so its floor is `low`. A route asking
 * for no thinking on a Claude phase is asking for the least the CLI offers.
 */
function effortRow(level: string): { readonly claude: string; readonly codex: string } {
  const represent = (spell: (value: string) => string): string => {
    try {
      return spell(level);
    } catch {
      return "refused";
    }
  };
  return { claude: represent(effortFor), codex: represent(thinkingFor) };
}

/** Every workflow that contains this agent phase, so a route's reach is visible. */
function workflowsWith(phaseId: string): readonly string[] {
  return WORKFLOW_RECIPES
    .filter((recipe) => recipe.phases.some((phase) => phase.kind === "agent" && phase.id === phaseId))
    .map((recipe) => recipe.id);
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

export interface RoutesListOptions {
  readonly config: AwsfConfig;
  /** Injected so the listing can be asserted without a real adapter registry. */
  readonly providerFor?: (adapterId: string) => Promise<string | null>;
}

/**
 * The provider each adapter REPORTS, never the config's optional label.
 *
 * `getModelInfo` is a pure answer in both production adapters — it builds an
 * object from constants and starts nothing — which is what lets this listing
 * be free. The model name passed is a placeholder: only the provider field of
 * the answer is read.
 */
async function reportedProvider(config: AwsfConfig, adapterId: string): Promise<string | null> {
  const adapter = registeredAdapter(config.adapters, adapterId, config.runtime);
  if (adapter === null) return null;
  try {
    return (await adapter.getModelInfo("probe")).provider;
  } catch {
    return null;
  }
}

export async function routesListCommand(options: RoutesListOptions): Promise<readonly string[]> {
  const { config } = options;
  const lines: string[] = [];

  const providerFor = options.providerFor ?? ((adapterId: string): Promise<string | null> => reportedProvider(config, adapterId));

  lines.push("Adapters — the pair a route names is <adapter>/<provider>.");
  for (const [adapterId, entry] of Object.entries(config.adapters)) {
    const enabled = entry.enabled === false ? "disabled" : "enabled";
    const provider = (await providerFor(adapterId)) ?? entry.provider ?? "-";
    lines.push(`  ${pad(adapterId, 14)}${pad(entry.kind, 20)}${pad(provider, 16)}${enabled}`);
  }
  lines.push("  A disabled or undeclared adapter is refused before anything runs.");
  lines.push("");

  lines.push("Effort — the config spelling, and what each adapter sends for it.");
  lines.push(`  ${pad("level", 10)}${pad("claude", 12)}codex`);
  for (const level of ROUTE_EFFORT_LEVELS) {
    const row = effortRow(level);
    lines.push(`  ${pad(level, 10)}${pad(row.claude, 12)}${row.codex}`);
  }
  lines.push("");

  lines.push("Agent phases — every id a --route may name, and where each one runs.");
  for (const phaseId of AGENT_PHASE_IDS) {
    const workflows = workflowsWith(phaseId);
    lines.push(`  ${pad(phaseId, 22)}${workflows.length === 0 ? "(no shipped workflow)" : workflows.join(", ")}`);
  }
  lines.push("  A phase id outside this list is refused; host phases have no route to pick.");
  lines.push("");

  lines.push("Models — this CLI keeps no catalogue, on purpose.");
  lines.push("  A selector is whatever the adapter's own CLI accepts, and a list written here");
  lines.push("  would be stale the week a provider retires one. Enumerate at the source:");
  for (const [adapterId, entry] of Object.entries(config.adapters)) {
    if (entry.enabled === false) continue;
    const command = ENUMERATION_COMMAND[entry.kind];
    lines.push(`  ${pad(adapterId, 14)}${command ?? "no enumeration command; see the provider's own model documentation"}`);
  }
  lines.push("  A `family:model` prefix is optional and must match the adapter it routes to;");
  lines.push("  a prefix naming a different one is refused rather than guessed at.");
  lines.push("");

  lines.push("Selecting routes for one attempt");
  lines.push("  awsf new <task> \"<request>\" --route <phase>=<adapter>/<provider>/<model>@<effort>");
  lines.push("  Repeat --route per phase. Any part may be omitted: `--route builder=@max` keeps");
  lines.push("  the configured route and sharpens the effort; `--route reviewer=claude:opus`");
  lines.push("  keeps the configured adapter. The selection is recorded on the attempt, so the");
  lines.push("  config snapshot still matches the file and rework/review stay available.");
  lines.push("");
  lines.push(`  Review inversion: ${config.routing.review}. In a workflow that buys a review, the`);
  lines.push("  reviewer must resolve to a different PROVIDER than the builder — two models from");
  lines.push("  one provider are still one provider. To spend an attempt on a same-provider");
  lines.push("  review, the owner grants it: awsf degrade-review <task> --reason \"...\".");

  return Object.freeze(lines);
}
