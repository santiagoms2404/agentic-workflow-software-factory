import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify as toYaml } from "yaml";
import {
  loadPlacement,
  PlacementRelativePathError,
  PlacementSchemaError,
} from "../../../src/registry/placement.ts";

function validPlacement(): Record<string, unknown> {
  return {
    version: "awsf.placement/v1",
    project: "smart-health",
    worktree_root: "/work/awsf-worktrees",
    repositories: {
      plans: { path: "/work/smart-health/plans" },
      service: { path: "/work/smart-health/service", worktree_root: "/work/smart-health/service-worktrees" },
      application: { path: "C:\\projects\\smart-health\\application", worktree_root: "/home/owner/application-worktrees" },
      "model-source-one": { path: "/work/smart-health/model-source-one" },
      "model-source-two": { path: "/work/smart-health/model-source-two" },
    },
  };
}

function clonePlacement(): Record<string, any> {
  return structuredClone(validPlacement()) as Record<string, any>;
}

function assertCode(action: () => unknown, ErrorType: new (...args: any[]) => Error, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof ErrorType && (error as { code?: string }).code === code);
}

test("loads absolute placement paths including a per-repository worktree root", () => {
  const placement = loadPlacement(toYaml(validPlacement()));

  assert.equal(Object.keys(placement.repositories).length, 5);
  assert.equal(placement.repositories.application?.worktree_root, "/home/owner/application-worktrees");
});

test("rejects a relative placement path", () => {
  const doc = clonePlacement();
  doc.repositories.service.path = "projects/smart-health/service";

  assertCode(() => loadPlacement(toYaml(doc)), PlacementRelativePathError, "E_PLACEMENT_RELATIVE_PATH");
});

for (const field of ["default_branch", "role"] as const) {
  test(`rejects durable ${field} in placement through additionalProperties`, () => {
    const doc = clonePlacement();
    doc.repositories.service[field] = field === "default_branch" ? "main" : "service";

    assertCode(() => loadPlacement(toYaml(doc)), PlacementSchemaError, "E_PLACEMENT_SCHEMA");
  });
}
