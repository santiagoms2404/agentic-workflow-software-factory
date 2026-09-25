// Spawned by shift-selection-record.test.ts as a SEPARATE node process, so the
// cross-process half of INV-4's digest property is measured rather than
// assumed: a manifest sealed in this process must equal one sealed in the
// caller's own process over the identical bytes. Not a test file itself (no
// .test.ts suffix), so the runner's glob never picks it up on its own.
import { sealShiftManifest } from "../../src/contracts/shift-selection-record.ts";
import { readPlanTicketFile } from "../../src/persistence/plan-ticket-body.ts";

const IDS = ["T01", "T02", "T03"] as const;

async function main(): Promise<void> {
  const [directory, plan] = process.argv.slice(2);
  if (!directory || !plan) throw new Error("usage: _shift-selection-child.ts <directory> <plan>");
  const tickets = [];
  for (const id of IDS) {
    const file = await readPlanTicketFile(`${directory}/${id}.md`);
    tickets.push({ id, path: `specs/tickets/${plan}/${id}.md`, digest: file.digest });
  }
  const manifest = sealShiftManifest({ plan, milestones: ["M1"], tickets });
  process.stdout.write(manifest.manifestDigest);
}

await main();
