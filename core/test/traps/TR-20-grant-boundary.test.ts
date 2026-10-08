import { test } from "node:test";
import { laterGrantRefusal } from "../fixtures/trap-remainder.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-20 refusal assertion", laterGrantRefusal);

ownMutant({ id: "TR-20", file: import.meta.filename });
