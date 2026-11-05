import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CallBudget } from "../../../src/execution/call-budget.ts";
import { ProcessTransportBroker } from "../../../src/execution/transport-broker.ts";
import type { ProcessRegistration, ProcessSpec } from "../../../src/adapters/interface.ts";

test("the launch boundary filters an adapter descriptor environment", async () => {
  const directory = mkdtempSync(join(tmpdir(), "awsf-broker-env-"));
  try {
    const script = join(directory, "provider.mjs");
    writeFileSync(
      script,
      "process.stdout.write(JSON.stringify({ extra: process.env.EXTRA_SETTING ?? null, path: process.env.PATH, locale: process.env.LANG }));\n",
    );
    const budget = new CallBudget({ taskId: "T99", tier: 2 });
    const reservation = budget.reserve({ cost: 1, edge: "L4" });
    const broker = new ProcessTransportBroker({ register: async () => {}, ledger: budget });
    const registration: ProcessRegistration = {
      runId: "run-env-test",
      sessionId: "session-env-test",
      from: "PREPARED",
      to: "RUNNING",
      edge: "L4",
      reservationId: reservation.id,
      adapterId: "stub",
      role: "worker",
    };
    const spec: ProcessSpec = {
      executable: process.execPath,
      argv: [script],
      cwd: directory,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        EXTRA_SETTING: "not passed",
      },
      stdin: "",
      shell: false,
    };
    const transport = await broker.startProcess(registration, spec, new AbortController().signal);
    const chunks: Uint8Array[] = [];
    for await (const chunk of transport.stdout) chunks.push(chunk);
    const exit = await transport.exit;
    const output = new TextDecoder().decode(Buffer.concat(chunks));
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.deepEqual(JSON.parse(output), { extra: null, path: process.env.PATH ?? "", locale: "C.UTF-8" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
