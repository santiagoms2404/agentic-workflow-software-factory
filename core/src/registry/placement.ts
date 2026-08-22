import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { parse as parseYaml, stringify } from "yaml";
import { isAbsoluteMachinePath } from "../config/machine-path.ts";
import { placementFilePath } from "../persistence/platform-paths.ts";
import {
  PLACEMENT_VERSION,
  PlacementSchema,
  type Placement,
} from "./placement-schema.ts";

export class PlacementError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "PlacementError";
  }
}

export class PlacementSchemaError extends PlacementError {
  readonly violations: string[];

  constructor(violations: string[]) {
    super("E_PLACEMENT_SCHEMA", `placement does not match ${PLACEMENT_VERSION}: ${violations.join("; ")}`);
    this.name = "PlacementSchemaError";
    this.violations = violations;
  }
}

export class PlacementRelativePathError extends PlacementError {
  constructor(path: string, value: string) {
    super("E_PLACEMENT_RELATIVE_PATH", `${path} must be an absolute machine path: ${JSON.stringify(value)}`);
    this.name = "PlacementRelativePathError";
  }
}

function assertStructure(doc: unknown): asserts doc is Placement {
  if (Value.Check(PlacementSchema, doc)) return;
  const violations = [...Value.Errors(PlacementSchema, doc)]
    .map((error) => `${error.path || "(root)"}: ${error.message}`);
  throw new PlacementSchemaError(violations);
}

function assertAbsolutePath(path: string, value: string): void {
  if (!isAbsoluteMachinePath(value)) throw new PlacementRelativePathError(path, value);
}

function assertAbsolutePaths(placement: Placement): void {
  if (placement.worktree_root !== undefined) {
    assertAbsolutePath("worktree_root", placement.worktree_root);
  }
  for (const [repositoryId, repository] of Object.entries(placement.repositories)) {
    assertAbsolutePath(`repositories.${repositoryId}.path`, repository.path);
    if (repository.worktree_root !== undefined) {
      assertAbsolutePath(`repositories.${repositoryId}.worktree_root`, repository.worktree_root);
    }
  }
}

function assertPlacement(doc: unknown): Placement {
  assertStructure(doc);
  assertAbsolutePaths(doc);
  return doc;
}

/** Parses and validates machine-local placement YAML. */
export function loadPlacement(yamlText: string): Placement {
  return assertPlacement(parseYaml(yamlText));
}

/** Reads a project's machine-local placement document. */
export async function readPlacement(stateRoot: string, slug: string): Promise<Placement> {
  return loadPlacement(await readFile(placementFilePath(stateRoot, slug), "utf8"));
}

/** Validates and atomically writes a project's machine-local placement document. */
export async function writePlacement(stateRoot: string, slug: string, doc: Placement): Promise<void> {
  const placement = assertPlacement(doc);
  const path = placementFilePath(stateRoot, slug);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, stringify(placement));
  await rename(temporary, path);
}
