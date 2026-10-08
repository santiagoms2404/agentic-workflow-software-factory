import type { Availability } from "./interface.ts";
import { filterEnv } from "./env.ts";
import { ExecutableNotFound, resolveExecutable } from "../execution/transport-broker.ts";

/** Resolution only, using the same filtered environment as the provider descriptor. */
export function executableAvailability(
  adapter: string,
  executable: string,
  source: Readonly<Record<string, string | undefined>>,
): Availability {
  const env = filterEnv(adapter, source);
  const path = env.PATH ?? "";
  if (executable.length === 0) {
    return { status: "blocked", code: "E_INVALID_REQUEST", executable, path,
      detail: `no executable named; launch PATH=${JSON.stringify(path)}` };
  }
  try {
    const resolved = resolveExecutable(executable, env);
    return { status: "available", executable, path, resolved };
  } catch (error) {
    if (!(error instanceof ExecutableNotFound)) throw error;
    return { status: "blocked", code: "ExecutableNotFound", executable, path,
      obstructions: error.obstructions,
      detail: `${error.message}; launch PATH=${JSON.stringify(path)}` };
  }
}
