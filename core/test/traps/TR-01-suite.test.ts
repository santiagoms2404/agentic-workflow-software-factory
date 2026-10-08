import { test } from "node:test";
import { k1Trap } from "./_k1.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-01 refusal assertion", () => k1Trap("TR-01", "suite"));

ownMutant({ id: "TR-01", file: import.meta.filename });
