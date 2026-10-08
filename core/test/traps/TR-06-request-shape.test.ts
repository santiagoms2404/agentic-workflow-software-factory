import { test } from "node:test";
import { k1Trap } from "./_k1.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-06 refusal assertion", () => k1Trap("TR-06", "request-shape"));

ownMutant({ id: "TR-06", file: import.meta.filename });
