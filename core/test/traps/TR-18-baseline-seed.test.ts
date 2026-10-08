import { test } from "node:test";
import { baselineRefusal } from "../fixtures/trap-remainder.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-18 refusal assertion", baselineRefusal);

ownMutant({ id: "TR-18", file: import.meta.filename });
