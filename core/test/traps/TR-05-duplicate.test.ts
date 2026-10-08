import { test } from "node:test";
import { k1Trap } from "./_k1.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-05 refusal assertion", () => k1Trap("TR-05", "duplicate"));

ownMutant({ id: "TR-05", file: import.meta.filename });
