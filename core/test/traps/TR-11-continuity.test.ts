import { test } from "node:test";
import { continuityRefusal } from "../fixtures/trap-remainder.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-11 refusal assertion", continuityRefusal);

ownMutant({ id: "TR-11", file: import.meta.filename });
