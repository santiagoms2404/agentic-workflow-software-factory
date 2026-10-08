import { test } from "node:test";
import { k1Trap } from "./_k1.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-02 refusal assertion", () => k1Trap("TR-02", "write-boundary"));

ownMutant({ id: "TR-02", file: import.meta.filename });
