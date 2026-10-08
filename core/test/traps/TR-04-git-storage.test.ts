import { test } from "node:test";
import { k1Trap } from "./_k1.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-04 refusal assertion", () => k1Trap("TR-04", "git-storage"));

ownMutant({ id: "TR-04", file: import.meta.filename });
