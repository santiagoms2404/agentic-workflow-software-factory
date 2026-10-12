import { PlanAuthorOutputSchema } from "../../contracts/plan-author-output.ts";
import { DocumentOutputSchema } from "../../contracts/document-output.ts";
import { PlanOutputSchema } from "../../contracts/plan-output.ts";
import { ReviewContextSchema } from "../../contracts/review-context.ts";
import { ReviewOutputSchema } from "../../contracts/review-output.ts";
import { TestOutputSchema } from "../../contracts/test-output.ts";
import { assertTicketSelection, type TicketSelection } from "../../contracts/ticket-selection-record.ts";
import type { AwsfConfig } from "../../config/schema.ts";
import type { WorkflowRecipe } from "../compiler.ts";
import { loadUserPrompt, requireHostExecution } from "../recipe-support.ts";

export const PLAN_AUTHOR_WORKFLOW_ID = "plan-author";
export const PLAN_AUTHOR_TIER_FLOOR = 2;

/** Bound to exactly one registered spine ticket, never inferred from prose. */
export function assertPlanAuthorSelection(planRef: string | null | undefined, selection: TicketSelection | null | undefined): asserts selection is TicketSelection {
  if (selection == null) throw new Error("plan-author requires --plan <registered spine stem> --ticket Wnn");
  assertTicketSelection(selection);
  if (planRef == null || selection.plan !== planRef || selection.tickets.length !== 1 || !/^W\d{2}$/u.test(selection.tickets[0]!.id)) {
    throw new Error("plan-author requires exactly one sealed Wnn ticket from its registered spine plan");
  }
}

/** The author may write its private output, but no repository path or executable. */
export function assertPlanAuthorRole(config: AwsfConfig): void {
  const role = config.agents.find(agent => agent.name === PLAN_AUTHOR_WORKFLOW_ID);
  if (role === undefined || role.writes.length !== 0 || role.tools.profile !== "managed-worker" ||
      !role.tools.allow.includes("write") || role.tools.allow.some(tool => !["read", "grep", "find", "ls", "edit", "write"].includes(tool))) {
    throw new Error("plan-author requires an explicit managed-worker role with writes: [], runtime write tools and no exec");
  }
  if (config.routing.review !== "invert-provider") throw new Error("plan-author requires cross-provider review");
}

/** Compilation is selection-bound; the shipped config does not enable this role. */
export function compilePlanAuthor(input: {
  readonly planRef?: string | null;
  readonly ticketSelection?: TicketSelection | null;
  readonly prompts?: { readonly author: string; readonly reviewer: string };
}): WorkflowRecipe {
  assertPlanAuthorSelection(input.planRef, input.ticketSelection);
  return {
    id: PLAN_AUTHOR_WORKFLOW_ID,
    tier: PLAN_AUTHOR_TIER_FLOOR,
    phases: [
      { id: "request", kind: "engineer", owner: "engineer", description: "Capture the owner's deep-plan request and its sealed spine selection", schemaId: "awsf.plan-output/v1", outputSchema: PlanOutputSchema, maxCorrections: 0, gates: [], execute: context => requireHostExecution("request", context) },
      { id: "plan-author", kind: "agent", owner: "plan-author", description: "Author an idle plan, canonical prompts and frontmatter table in private session output", schemaId: "awsf.plan-author-output/v1", outputSchema: PlanAuthorOutputSchema, maxCorrections: 1, gates: [], prompt: input.prompts?.author ?? loadUserPrompt("plan-author") },
      { id: "plan-admit", kind: "code", owner: "host", description: "Verify the private documents and admit exactly one new plan set without changing existing files", schemaId: "awsf.document-output/v1", outputSchema: DocumentOutputSchema, maxCorrections: 0, gates: [], execute: context => requireHostExecution("plan-admit", context) },
      { id: "tests", kind: "code", owner: "host", description: "Measure the admitted candidate with every configured quality command", schemaId: "awsf.test-output/v1", outputSchema: TestOutputSchema, maxCorrections: 0, gates: [], execute: context => requireHostExecution("tests", context) },
      { id: "review-context", kind: "code", owner: "host", description: "Bind the admitted files and quality evidence to the owner's original request", schemaId: "awsf.review-context/v1", outputSchema: ReviewContextSchema, maxCorrections: 0, gates: [], execute: context => requireHostExecution("review-context", context) },
      { id: "reviewer", kind: "agent", owner: "reviewer", description: "Independently review the admitted plan on the provider opposite its author", schemaId: "awsf.review-output/v1", outputSchema: ReviewOutputSchema, maxCorrections: 1, gates: [], prompt: input.prompts?.reviewer ?? loadUserPrompt("reviewer") },
    ],
  };
}
