import { test } from "node:test";
import { adoptionRefusal } from "../fixtures/trap-remainder.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-19 refusal assertion", adoptionRefusal);

ownMutant({ id: "TR-19", file: import.meta.filename });
