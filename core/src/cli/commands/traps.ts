import type { TrapsReadout } from "../../contracts/traps-readout.ts";
import { readTrapsReadout, trapsExitCode } from "../../traps/readout.ts";

export const TRAPS_USAGE = "usage: awsf traps [--json] [--state-root PATH]";

export function renderTrapsReadout(model: TrapsReadout): string[] {
  const { stops, catalogue } = model;
  const lines = [
    `Trap coverage · ${model.schema} · seeded up to ${model.cut}`,
    `Catalogue: ${catalogue.traps} traps · ${catalogue.noTraps} no-trap seeds · next free id ${model.nextFreeTrapId}`,
    `No-trap kinds: ${Object.entries(catalogue.byNoTrapKind).map(([kind, count]) => `${kind} ${count}`).join(" · ")}`,
    `Stops since the cut: ${stops.total} · linked to trap ${stops.linkedToTrap.length} · linked to no-trap reason ${stops.linkedToNoTrap.length} · missing trap ${stops.missingTrap.length} · unlinked ${stops.unlinked.length}`,
  ];
  for (const [label, items] of [["Linked to catalogued trap", stops.linkedToTrap], ["Linked to no-trap reason", stops.linkedToNoTrap],
    ["Missing trap", stops.missingTrap], ["Unlinked", stops.unlinked]] as const) {
    lines.push(`${label}:`);
    for (const item of items) {
      const link = "trap" in item ? item.trap.kind === "trap" ? item.trap.id : `${item.trap.because}: ${item.trap.reason}`
        : item.preLink ? "v1 pre-link" : "no attribution";
      lines.push(`  ${item.project}/${item.taskId} attempt ${item.attempt} (${item.lifecycleState}, ${item.terminalAt}) · ${link}`);
    }
    if (items.length === 0) lines.push("  none");
  }
  for (const project of model.projects) {
    const landed = project.newestLanded;
    lines.push(landed === null ? `${project.project}: no landed attempt; traps not measured`
      : `${project.project}: newest landed ${landed.taskId} attempt ${landed.attempt} · traps ${landed.traps.passed === null ? "not measured" : landed.traps.passed ? "passed" : "failed"} at ${landed.traps.sha ?? "no measured base"} (attempt base ${landed.baseSha ?? "unknown"})`);
  }
  lines.push(trapsExitCode(model) === 1 ? "Coverage red: unlinked stops or missing traps remain (exit 1)." : "Coverage complete (exit 0).");
  lines.push("awsf traps reports and never repairs. It writes nothing and never runs the trap layer.");
  return lines;
}

export async function trapsCommand(stateRoot: string): Promise<{ model: TrapsReadout; lines: readonly string[]; exitCode: 0 | 1 }> {
  const model = await readTrapsReadout(stateRoot);
  return { model, lines: renderTrapsReadout(model), exitCode: trapsExitCode(model) };
}
