import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A synthetic, repository-local registered store, without runtime owner data. */
export function registerShiftPlan(repository: string, project: string, plan: string, root = "specs"): void {
  writeFileSync(join(repository, "awsf.project.yaml"), `version: awsf.project/v1
project:
  slug: ${project}
repositories:
  fixture:
    role: plan
    default_branch: main
    gates:
      test: { argv: [node, -e, "process.exit(0)"], timeout_seconds: 10 }
    delivery: none
plans:
  root: ${root}
  format: awsf-plan-html/v1
  default: ${plan}
`);
  mkdirSync(join(repository, root, "tickets", plan), { recursive: true });
  writeFileSync(join(repository, root, `${plan}.html`), '<h3><code class="status">[]</code> Milestone M1: Synthetic</h3>\n');
}
