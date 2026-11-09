import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { createServer, type Server } from "node:http";
import { dashCommand, guardedListener } from "../../../src/cli/commands/operator.ts";

/**
 * B9-02: `awsf dash` parsed the request target with `new URL` inside an async
 * listener and nothing caught it, so one malformed target rejected a promise no
 * one awaited and took the whole dashboard process down. These tests send the
 * raw request line over `node:net` because `fetch` and `http.get` normalise a
 * target like `//[` before it ever reaches the wire.
 */

interface RawReply { readonly status: number; readonly text: string }

/** One raw HTTP/1.1 request; an unanswered request resolves as status 0 after a bounded wait. */
function rawRequest(port: number, target: string): Promise<RawReply> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      const text = Buffer.concat(chunks).toString("utf8");
      const status = /^HTTP\/1\.1 (\d{3})/u.exec(text)?.[1];
      resolve({ status: status === undefined ? 0 : Number(status), text });
    };
    const timer = setTimeout(finish, 2_000);
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("error", finish);
    socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
  });
}

/**
 * Records every unhandled rejection while `body` runs; the record is the
 * assertion's subject. The runner's own listeners are set aside for the window
 * and restored after it, so an escaped rejection lands in this record (and the
 * unanswered request then fails its status assertion) instead of the runner
 * failing the test before any assertion is reached.
 */
async function watchingRejections(body: (rejections: unknown[]) => Promise<void>): Promise<void> {
  const rejections: unknown[] = [];
  const record = (reason: unknown): void => { rejections.push(reason); };
  const runnerListeners = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", record);
  try { await body(rejections); } finally {
    process.off("unhandledRejection", record);
    for (const listener of runnerListeners) process.on("unhandledRejection", listener);
  }
}

function builtDashboard(root: string): string {
  const dist = join(root, "dashboard", "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<script type=\"module\" src=\"/assets/app.js\"></script>");
  writeFileSync(join(dist, "assets", "app.js"), "document.body.dataset.ready = 'true';\n");
  return dist;
}

function portOf(server: Server | undefined): number {
  const address = server?.address();
  if (address === null || address === undefined || typeof address === "string") throw new Error("missing server address");
  return address.port;
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (server?.listening) await new Promise<void>((done) => server.close(() => done()));
}

test("dash answers 400 for the target //[ and keeps serving the next request", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-dash-bad-target-"));
  let server: Server | undefined;
  try {
    await watchingRejections(async (rejections) => {
      assert.equal(await dashCommand({
        cwd: root, assetRoot: builtDashboard(root), port: 0, write: () => {},
        onListening: (running) => { server = running; },
      }), "serving");
      const port = portOf(server);
      const bad = await rawRequest(port, "//[");
      assert.equal(bad.status, 400, `a malformed target is the client's error, got: ${JSON.stringify(bad.text)}`);
      assert.match(bad.text, /bad request target/u);
      const next = await rawRequest(port, "/assets/app.js");
      assert.equal(next.status, 200, "the dashboard is still up after the malformed request");
      assert.match(next.text, /dataset\.ready/u);
      assert.deepEqual(rejections, [], "nothing escaped the listener as a rejection");
    });
  } finally {
    await closeServer(server);
    rmSync(root, { recursive: true, force: true });
  }
});

test("dash answers 400 for the empty-authority target // as well, while a normal index request answers 200", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-dash-bad-target-"));
  let server: Server | undefined;
  try {
    await watchingRejections(async (rejections) => {
      await dashCommand({
        cwd: root, assetRoot: builtDashboard(root), port: 0, write: () => {},
        onListening: (running) => { server = running; },
      });
      const port = portOf(server);
      assert.equal((await rawRequest(port, "//")).status, 400);
      const index = await rawRequest(port, "/");
      assert.equal(index.status, 200);
      assert.match(index.text, /assets\/app\.js/u);
      assert.deepEqual(rejections, []);
    });
  } finally {
    await closeServer(server);
    rmSync(root, { recursive: true, force: true });
  }
});

test("a guarded listener that throws answers 500 without an unhandled rejection, and the next request is served", async () => {
  let server: Server | undefined;
  try {
    await watchingRejections(async (rejections) => {
      server = createServer(guardedListener(async (request, response) => {
        if (request.url === "/boom") throw new Error("listener failure");
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("fine");
      }));
      const running = server;
      await new Promise<void>((done) => running.listen(0, "127.0.0.1", done));
      const port = portOf(server);
      const failed = await rawRequest(port, "/boom");
      assert.equal(failed.status, 500);
      assert.doesNotMatch(failed.text, /listener failure/u, "the internal error text is not sent to the client");
      const fine = await rawRequest(port, "/fine");
      assert.equal(fine.status, 200);
      assert.match(fine.text, /\r\nfine\r\n/u);
      assert.deepEqual(rejections, []);
    });
  } finally {
    await closeServer(server);
  }
});
