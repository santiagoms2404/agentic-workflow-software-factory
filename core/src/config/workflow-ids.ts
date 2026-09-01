/** Stable workflow vocabulary shared by config validation and recipe registration. */
export const WORKFLOW_IDS = [
  "scout",
  "plan",
  "build",
  "plan-build-test",
  "build-review",
  "simple-sdlc",
  "intake",
  "design-to-plan",
] as const;

export type WorkflowId = (typeof WORKFLOW_IDS)[number];
