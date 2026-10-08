import { test } from "node:test";
import { k1Trap } from "./_k1.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-03 refusal assertion", () => k1Trap("TR-03", "protected-paths"));

ownMutant({ id: "TR-03", file: import.meta.filename });
