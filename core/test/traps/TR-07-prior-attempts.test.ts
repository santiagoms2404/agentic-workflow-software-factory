import { test } from "node:test";
import { k1Trap } from "./_k1.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-07 refusal assertion", () => k1Trap("TR-07", "prior-attempts"));

ownMutant({ id: "TR-07", file: import.meta.filename });
