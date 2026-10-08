import { test } from "node:test";
import { k1Trap } from "./_k1.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-08 refusal assertion", () => k1Trap("TR-08", "confirmation"));

ownMutant({ id: "TR-08", file: import.meta.filename });
