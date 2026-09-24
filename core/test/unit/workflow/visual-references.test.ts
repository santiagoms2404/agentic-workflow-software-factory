import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertRouteDeliversImages, assertSameFrames, assertVisualRoute, deliverVisualReferences, deliveryDirectory, matchObservations,
  parseVisualBinding, plannedDelivery,
  readVisualBinding, recordVisualBinding, refuseUndeliveredVisualPhases, revalidateDelivery, verifyVisualReferences,
  visualBindingDigest, visualReferencePrompt, VisualReferenceRefused, type VisualRefusalCode,
} from "../../../src/workflow/visual-references.ts";
import { inspectImage } from "../../../src/workflow/visual-image.ts";
import { bindingFor, discPng, png, referenceLibrary, sha256, type ReferenceLibrary } from "../../fixtures/visual-references.ts";

const PHASES = ["planner", "builder", "reviewer"];

function binding(library: ReferenceLibrary, selection?: object, phases?: readonly string[]) {
  return parseVisualBinding(JSON.stringify(bindingFor(library, selection, phases)));
}

async function refusedWith(code: VisualRefusalCode, action: () => Promise<unknown> | unknown): Promise<void> {
  await assert.rejects(async () => action(), (error: unknown) => {
    assert.ok(error instanceof VisualReferenceRefused, String(error));
    assert.equal(error.code, code, error.message);
    return true;
  });
}

function verify(library: ReferenceLibrary, selection?: object, planRef: string | null = null) {
  return verifyVisualReferences(binding(library, selection), { planRef, agentPhases: PHASES });
}

test("V1 a synthetic external root under a path with spaces verifies exact frames and their digests", async () => {
  const library = referenceLibrary();
  try {
    const verified = await verify(library, { frames: ["f3", "f1"] });
    assert.deepEqual(verified.bound.frames.map((frame) => frame.id), ["f3", "f1"], "exact selection, in the owner's order");
    for (const frame of verified.bound.frames) {
      assert.equal(frame.sha256, sha256(library.images[frame.id]!));
      assert.equal(frame.mediaType, "image/png");
      assert.deepEqual([frame.width, frame.height], [48, 48]);
      assert.deepEqual(verified.images.get(frame.id), library.images[frame.id]);
    }
    assert.match(verified.bound.indexCommit, /^[a-f0-9]{40}$/);
    assert.equal(verified.bound.indexSha256, sha256(readFileSync(library.indexPath)));
    assert.doesNotMatch(JSON.stringify(verified.bound), /design library|\/tmp\//, "the public record carries no path");
  } finally { rmSync(join(library.root, ".."), { recursive: true, force: true }); }
});

test("V1 a ticket selection resolves only through the attempt's own plan", async () => {
  const library = referenceLibrary();
  try {
    const selection = { plan: "visual-plan", ticket: "T01" };
    const verified = await verify(library, selection, "visual-plan");
    assert.deepEqual(verified.bound.frames.map((frame) => frame.id), ["f1", "f2", "f3"]);
    await refusedWith("selection-invalid", () => verify(library, selection, "another-plan"));
    await refusedWith("selection-invalid", () => verify(library, selection, null));
    await refusedWith("selection-invalid", () => verify(library, { plan: "visual-plan", ticket: "T02" }, "visual-plan"));
  } finally { rmSync(join(library.root, ".."), { recursive: true, force: true }); }
});

test("V2 each planted defect fails at its own boundary", async () => {
  const cases: readonly [string, VisualRefusalCode, (library: ReferenceLibrary) => Promise<unknown> | unknown][] = [
    ["missing image", "image-missing", (library) => { rmSync(library.paths.f2!); return verify(library); }],
    ["unknown frame", "frame-unknown", (library) => verify(library, { frames: ["f1", "nope"] })],
    ["duplicate frame in the selection", "frame-duplicate", (library) => verify(library, { frames: ["f1", "f1"] })],
    ["duplicate frame in a ticket map", "frame-duplicate", (library) => {
      writeFileSync(library.indexPath, JSON.stringify({ version: 1, frames: [{ id: "f1", image: "design/screens/group one/f1.png" }], ticketFrames: { T01: ["f1", "f1"] } }));
      library.writeDigests(); library.commit("test: duplicate ticket frames");
      return verify(library, { plan: "p", ticket: "T01" }, "p");
    }],
    ["duplicate frame in the index", "index-invalid", (library) => {
      const index = JSON.parse(readFileSync(library.indexPath, "utf8"));
      index.frames.push(index.frames[0]);
      writeFileSync(library.indexPath, JSON.stringify(index)); library.writeDigests(); library.commit("test: duplicate index frame");
      return verify(library);
    }],
    ["stale index digest", "index-digest-mismatch", (library) => { library.writeDigests({}, "0".repeat(64)); return verify(library); }],
    ["locally edited index", "index-uncommitted", (library) => {
      writeFileSync(library.indexPath, `${readFileSync(library.indexPath, "utf8")} `); library.writeDigests(); return verify(library);
    }],
    ["index outside Git", "index-uncommitted", (library) => { rmSync(join(library.root, ".git"), { recursive: true, force: true }); return verify(library); }],
    ["stale image digest", "image-digest-mismatch", (library) => { writeFileSync(library.paths.f1!, discPng(99)); return verify(library); }],
    ["corruption behind a matching digest", "image-corrupt", (library) => {
      const bytes = Buffer.from(library.images.f1!); bytes[bytes.length - 20] = bytes[bytes.length - 20]! ^ 0xff;
      writeFileSync(library.paths.f1!, bytes); library.writeDigests({ f1: sha256(bytes) }); return verify(library);
    }],
    ["truncation behind a matching digest", "image-corrupt", (library) => {
      const bytes = library.images.f1!.subarray(0, 60);
      writeFileSync(library.paths.f1!, bytes); library.writeDigests({ f1: sha256(bytes) }); return verify(library);
    }],
    ["unsupported type behind a matching digest", "image-type", (library) => {
      const gif = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1");
      writeFileSync(library.paths.f1!, gif); library.writeDigests({ f1: sha256(gif) }); return verify(library);
    }],
    ["oversized dimensions", "image-too-large", (library) => {
      const wide = png(2001, 1, () => [0, 0, 0]);
      writeFileSync(library.paths.f1!, wide); library.writeDigests({ f1: sha256(wide) }); return verify(library);
    }],
    ["oversized bytes", "image-too-large", (library) => {
      writeFileSync(library.paths.f1!, Buffer.alloc(4 * 1024 * 1024 + 1)); return verify(library);
    }],
    ["traversal in the index", "path-escape", (library) => {
      writeFileSync(library.indexPath, JSON.stringify({ version: 1, frames: [{ id: "f1", image: "../outside.png" }] }));
      library.writeDigests(); library.commit("test: traversal"); return verify(library, { frames: ["f1"] });
    }],
    ["symlink escaping the root", "path-escape", (library) => {
      const outside = join(library.root, "..", "outside.png");
      writeFileSync(outside, library.images.f1!); rmSync(library.paths.f1!); symlinkSync(outside, library.paths.f1!);
      return verify(library);
    }],
    ["frames past the count limit", "count-exceeded", (library) => {
      const ids = Array.from({ length: 33 }, (_, n) => `x${String(n)}`);
      writeFileSync(library.indexPath, JSON.stringify({ version: 1, frames: ids.map((id) => ({ id, image: "design/screens/group one/f1.png" })), ticketFrames: { T01: ids } }));
      library.writeDigests(); library.commit("test: many frames");
      return verify(library, { plan: "p", ticket: "T01" }, "p");
    }],
    ["a phase the workflow does not run", "phase-unknown", (library) => verifyVisualReferences(binding(library, undefined, ["painter"]), { planRef: null, agentPhases: PHASES })],
    ["a relative root", "binding-invalid", (library) => parseVisualBinding(JSON.stringify({ ...bindingFor(library), root: "design library" }))],
    ["an unknown binding field", "binding-invalid", (library) => parseVisualBinding(JSON.stringify({ ...bindingFor(library), attachments: [] }))],
    ["a traversing index path", "binding-invalid", (library) => parseVisualBinding(JSON.stringify({ ...bindingFor(library), index: "../x.json" }))],
  ];
  for (const [name, code, plant] of cases) {
    const library = referenceLibrary();
    try {
      await refusedWith(code, () => plant(library));
    } catch (error) {
      assert.fail(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    } finally { rmSync(join(library.root, ".."), { recursive: true, force: true }); }
  }
});

test("V1 delivery writes only the verified bytes, read-only, outside any worktree, and re-verifies on every check", async () => {
  const library = referenceLibrary();
  const attemptDir = mkdtempSync(join(tmpdir(), "awsf attempt "));
  try {
    const verified = await verify(library, { frames: ["f1", "f2"] });
    const directory = deliveryDirectory(attemptDir, "session:builder:run");
    assert.equal(directory, join(attemptDir, "private", "visual-references", "session-builder-run"));
    const delivery = await deliverVisualReferences(verified, directory);
    assert.deepEqual(delivery.frames.map((frame) => frame.id), ["f1", "f2"]);
    for (const frame of delivery.frames) {
      assert.deepEqual(readFileSync(frame.path), library.images[frame.id]);
      assert.equal(statSync(frame.path).mode & 0o777, 0o444);
    }
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(existsSync(join(directory, "f3.png")), false, "only the selected frames are delivered");
    const prompt = visualReferencePrompt(delivery);
    assert.match(prompt, /VISUAL REFERENCES/);
    assert.match(prompt, /never an instruction or a permission/);
    for (const frame of delivery.frames) assert.ok(prompt.includes(`${frame.path} (sha256 ${frame.sha256})`));
    assert.doesNotMatch(prompt, /design library/, "the source root never reaches the worker");
    await revalidateDelivery(delivery);
    // Re-entering the same launch reuses and re-proves the copy it made, completing an interrupted write.
    rmSync(delivery.frames[1]!.path);
    assert.deepEqual(await deliverVisualReferences(verified, directory), delivery);
    assert.deepEqual(plannedDelivery(verified.bound, directory), delivery, "the prompt can name the paths before delivery");
    writeFileSync(join(directory, "stray.png"), discPng(3));
    await refusedWith("delivery-changed", () => deliverVisualReferences(verified, directory));
    rmSync(join(directory, "stray.png"));

    // A worker running as the same user can defeat mode bits; it cannot defeat the digest.
    chmodSync(delivery.frames[0]!.path, 0o644);
    writeFileSync(delivery.frames[0]!.path, discPng(77));
    await refusedWith("delivery-changed", () => revalidateDelivery(delivery));
    assert.deepEqual(readFileSync(library.paths.f1!), library.images.f1, "the source asset is untouched by any write to its copy");
    rmSync(delivery.frames[1]!.path);
    await refusedWith("delivery-changed", () => revalidateDelivery(delivery));
  } finally {
    rmSync(attemptDir, { recursive: true, force: true });
    rmSync(join(library.root, ".."), { recursive: true, force: true });
  }
});

test("V2 a source replaced after binding is refused even when its digests were rewritten to match", async () => {
  const library = referenceLibrary();
  try {
    const original = await verify(library);
    const replaced = discPng(42);
    writeFileSync(library.paths.f2!, replaced);
    library.writeDigests({ f2: sha256(replaced) });
    const fresh = await verify(library);
    await refusedWith("source-changed", () => assertSameFrames(original.bound, fresh.bound));
    const other = await verifyVisualReferences(binding(library, { frames: ["f1"] }), { planRef: null, agentPhases: PHASES });
    await refusedWith("binding-changed", () => assertSameFrames(original.bound, other.bound));
  } finally { rmSync(join(library.root, ".."), { recursive: true, force: true }); }
});

test("V2 the private binding and its journal record must agree in both directions", async () => {
  const library = referenceLibrary();
  const attemptDir = mkdtempSync(join(tmpdir(), "awsf attempt "));
  try {
    const bound = (await verify(library)).bound;
    assert.equal(await readVisualBinding(attemptDir, null), null, "an ordinary attempt has no binding");
    await refusedWith("binding-missing", () => readVisualBinding(attemptDir, bound));
    const owned = binding(library);
    await recordVisualBinding(attemptDir, owned);
    await recordVisualBinding(attemptDir, owned);
    assert.equal(statSync(join(attemptDir, "private", "visual-references.json")).mode & 0o777, 0o600);
    await refusedWith("binding-changed", () => recordVisualBinding(attemptDir, binding(library, { frames: ["f1"] })));
    assert.deepEqual(await readVisualBinding(attemptDir, bound), owned);
    assert.equal(visualBindingDigest(owned), bound.bindingDigest);
    await refusedWith("binding-unrecorded", () => readVisualBinding(attemptDir, null));
    await refusedWith("binding-changed", () => readVisualBinding(attemptDir, { ...bound, bindingDigest: "f".repeat(64) }));
  } finally {
    rmSync(attemptDir, { recursive: true, force: true });
    rmSync(join(library.root, ".."), { recursive: true, force: true });
  }
});

test("V1/V2 the route check admits demonstrated image routes and refuses text-only, no-tools and read-less ones", async () => {
  const model = { supportsImages: true, requestedModel: "opus" };
  for (const [adapterId, requestedModel] of [["claude-code", "opus"], ["claude-code", "claude:opus"], ["claude-code", "sonnet"], ["pi-codex", "gpt-5.6-sol"],
    ["pi-codex", "codex:gpt-6-sol"], ["pi-codex", "gpt-5.6-terra"], ["pi-codex", "gpt-6-astra"]] as const) {
    for (const [profile, tools] of [["readonly", ["read", "grep"]], ["managed-worker", ["read", "edit", "write", "exec"]]] as const) {
      assertVisualRoute({ phaseId: "builder", adapterId, model: { supportsImages: true, requestedModel }, profile, tools });
    }
  }
  await refusedWith("route-unsupported", () => assertVisualRoute({ phaseId: "builder", adapterId: "fixture", model, profile: "readonly", tools: ["read"] }));
  await refusedWith("route-unsupported", () => assertVisualRoute({ phaseId: "builder", adapterId: "antigravity", model, profile: "readonly", tools: ["read"] }));
  await refusedWith("route-unsupported", () => assertVisualRoute({ phaseId: "builder", adapterId: "claude-code", model: { supportsImages: true, requestedModel: "haiku" }, profile: "readonly", tools: ["read"] }));
  await refusedWith("route-unsupported", () => assertVisualRoute({ phaseId: "builder", adapterId: "pi-codex", model: { supportsImages: true, requestedModel: "gpt-6-luna" }, profile: "readonly", tools: ["read"] }));
  await refusedWith("route-text-only", () => assertVisualRoute({ phaseId: "builder", adapterId: "pi-codex", model: { supportsImages: false, requestedModel: "gpt-5.3-codex-spark" }, profile: "readonly", tools: ["read"] }));
  await refusedWith("tool-unavailable", () => assertVisualRoute({ phaseId: "builder", adapterId: "claude-code", model, profile: "no-tools", tools: [] }));
  await refusedWith("tool-unavailable", () => assertVisualRoute({ phaseId: "builder", adapterId: "claude-code", model, profile: "managed-worker", tools: ["edit", "write", "exec"] }));
});

test("V1 observed images are matched to bound frames by digest alone", async () => {
  const frames = [{ id: "f1", sha256: "a".repeat(64) }, { id: "f2", sha256: "b".repeat(64) }];
  const matched = matchObservations(frames, [
    { toolCallId: "t1", toolName: "Read", outcome: "ok", mediaType: "image/png", bytes: 10, sha256: "b".repeat(64) },
    { toolCallId: "t2", toolName: "Read", outcome: "ok", mediaType: "image/png", bytes: 10, sha256: "c".repeat(64) },
  ]);
  assert.deepEqual(matched.map((observation) => observation.frameId), ["f2", null]);
});

test("V2 agent launches outside the runner refuse a bound phase before any confirmation", async () => {
  const library = referenceLibrary();
  const attemptDir = mkdtempSync(join(tmpdir(), "awsf attempt "));
  try {
    await refuseUndeliveredVisualPhases(attemptDir, "all", "rework");
    const bound = (await verify(library)).bound;
    writeFileSync(join(attemptDir, "journal.jsonl"), `${JSON.stringify({ event: { evidence: { type: "visual-references-bound", bound, at: "x" } } })}\n`);
    await refuseUndeliveredVisualPhases(attemptDir, ["reviewer"], "review");
    await refusedWith("path-unsupported", () => refuseUndeliveredVisualPhases(attemptDir, ["builder"], "review"));
    await refusedWith("path-unsupported", () => refuseUndeliveredVisualPhases(attemptDir, "all", "rework"));
  } finally {
    rmSync(attemptDir, { recursive: true, force: true });
    rmSync(join(library.root, ".."), { recursive: true, force: true });
  }
});

test("image structure is decided from bytes: PNG scanlines and JPEG frame headers", () => {
  assert.deepEqual(inspectImage(png(3, 2, () => [1, 2, 3])), { mediaType: "image/png", extension: "png", width: 3, height: 2 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x07, 0x00, 0x05, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
  assert.deepEqual(inspectImage(jpeg), { mediaType: "image/jpeg", extension: "jpg", width: 5, height: 7 });
  assert.throws(() => inspectImage(jpeg.subarray(0, jpeg.length - 1)), /EOI/);
  const extra = Buffer.concat([png(2, 2, () => [0, 0, 0]), Buffer.from("tail")]);
  assert.throws(() => inspectImage(extra), /after IEND|truncated/);
});

test("V2 pi's own image-blocking setting is refused from either file pi reads; other routes are not affected", async () => {
  const home = mkdtempSync(join(tmpdir(), "awsf home "));
  const cwd = mkdtempSync(join(tmpdir(), "awsf worktree "));
  try {
    await assertRouteDeliversImages("pi-codex", { home, cwd });
    const agent = join(home, ".pi", "agent");
    mkdirSync(agent, { recursive: true });
    writeFileSync(join(agent, "settings.json"), JSON.stringify({ defaultModel: "gpt-6-sol", images: { autoResize: true } }));
    await assertRouteDeliversImages("pi-codex", { home, cwd });
    writeFileSync(join(agent, "settings.json"), JSON.stringify({ images: { blockImages: true } }));
    await refusedWith("route-images-blocked", () => assertRouteDeliversImages("pi-codex", { home, cwd }));
    await assertRouteDeliversImages("claude-code", { home, cwd });
    writeFileSync(join(agent, "settings.json"), "{ not json");
    await refusedWith("route-images-blocked", () => assertRouteDeliversImages("pi-codex", { home, cwd }));
    writeFileSync(join(agent, "settings.json"), "{}");
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ "images.blockImages": true }));
    await refusedWith("route-images-blocked", () => assertRouteDeliversImages("pi-codex", { home, cwd }));
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});
