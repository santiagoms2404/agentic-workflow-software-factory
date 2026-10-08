// Synthetic tools for doctor tests outside a configured project. Resolution
// succeeds; only the read-only git query is invoked and says "not a repository".
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export function unconfiguredDoctorEnvironment(root: string): NodeJS.ProcessEnv {
  const bin = join(root, "doctor-bin");
  mkdirSync(bin, { recursive: true });
  for (const name of ["git", "bwrap", "quota-axi"]) {
    const file = join(bin, name);
    writeFileSync(file, "#!/bin/sh\nexit 1\n");
    chmodSync(file, 0o700);
  }
  return { PATH: bin };
}
