import { test } from "node:test";
import { shiftTicketPathRefusal } from "../fixtures/shift-ticket-paths.ts";
import { ownMutant } from "./_mutate.ts";

test("TR-16 refusal assertion", shiftTicketPathRefusal);

ownMutant({ id: "TR-16", file: import.meta.filename });
