import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiServer, forwardApiRequest } from "../../../src/api/server.ts";
import type { LoopbackHost } from "../../../src/api/security.ts";
import { apiFixture } from "./_fixture.ts";

test("the live server binds 127.0.0.1 and reports its exact local origin", async () => {
  const fixture = apiFixture();
  const api = createApiServer({ dbPath: fixture.path, config: fixture.config, port: 0 });
  try {
    const running = await api.start();
    assert.equal(running.host, "127.0.0.1");
    assert.ok(running.port > 0);
    assert.equal(running.origin, `http://127.0.0.1:${running.port}`);
    const address = api.nodeServer.address();
    assert.equal(typeof address === "object" && address !== null ? address.address : null, "127.0.0.1");
    await running.close();
  } finally {
    if (api.nodeServer.listening) await new Promise<void>((resolve) => api.nodeServer.close(() => resolve()));
    fixture.close();
  }
});

test("the shared HTTP forwarder maps dispatch rejection to the same internal response", async () => {
  const response = await forwardApiRequest({
    dispatch: async () => { throw new Error("private dispatch detail"); },
  }, { method: "GET", url: "/api/v1/health", headers: { host: "127.0.0.1" } });
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "request failed", code: "internal-error" });
});

test("a non-loopback bind is rejected before a router or socket is created", () => {
  const fixture = apiFixture();
  try {
    assert.throws(
      () => createApiServer({ dbPath: fixture.path, config: fixture.config, host: "0.0.0.0" as LoopbackHost }),
      /loopback/,
    );
  } finally {
    fixture.close();
  }
});
