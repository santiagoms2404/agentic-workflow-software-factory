// Selector admission only. The OpenRouter adapter's argv and process tests
// belong to T04; today selectorFor is the boundary that supplies --model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSelector } from "../../../src/adapters/catalog.ts";
import { PI_PROVIDER, selectorFor as codexSelectorFor } from "../../../src/adapters/pi-codex.ts";
import {
  PI_OPENROUTER_ADAPTER_ID,
  selectorFor as openrouterSelectorFor,
} from "../../../src/adapters/pi-openrouter.ts";
import { AdapterError } from "../../../src/adapters/interface.ts";

const OPENROUTER_IDS = [
  "z-ai/glm-5.2",
  "deepseek/deepseek-v4-flash-0731",
  "~deepseek/deepseek-v4-flash-latest",
] as const;

function unresolved(selector: (model: string) => string, model: string, adapter: string): void {
  assert.throws(
    () => selector(model),
    (error: unknown) =>
      error instanceof AdapterError &&
      error.code === "E_MODEL_UNRESOLVED" &&
      error.adapter === adapter &&
      error.message.includes(`${JSON.stringify(model)} is not a model selector`),
    `${JSON.stringify(model)} should be refused by ${adapter}`,
  );
}

test("OpenRouter admits bare, vendor/model and ~vendor/model ids without rewriting them", () => {
  assert.equal(openrouterSelectorFor("glm-5.2"), "glm-5.2");
  assert.equal(openrouterSelectorFor("openrouter:glm-5.2"), "glm-5.2");
  for (const id of OPENROUTER_IDS) {
    assert.equal(openrouterSelectorFor(id), id);
    assert.equal(openrouterSelectorFor(`openrouter:${id}`), id);
  }
  // The bound covers the whole id, including the vendor and slash.
  const longest = `v/${"m".repeat(126)}`;
  assert.equal(longest.length, 128);
  assert.equal(openrouterSelectorFor(longest), longest);
});

test("OpenRouter refuses pi's thinking shorthand instead of overriding configured thinking", () => {
  unresolved(openrouterSelectorFor, "deepseek/deepseek-v4:high", PI_OPENROUTER_ADAPTER_ID);
  unresolved(openrouterSelectorFor, "openrouter:z-ai/glm-5.2:max", PI_OPENROUTER_ADAPTER_ID);
});

test("OpenRouter refuses malformed or oversized ids instead of sanitizing them", () => {
  for (const bad of [
    "z-ai/glm/5.2", // two slashes
    "/glm-5.2",
    "-glm-5.2",
    "z-ai/glm-5.2~",
    "~glm-5.2", // the alias marker needs a vendor/model
    "z~ai/glm-5.2",
    `v/${"m".repeat(127)}`, // 129 characters in the model id
    "",
    "openrouter:",
    "z-ai/glm 5.2",
  ]) {
    unresolved(openrouterSelectorFor, bad, PI_OPENROUTER_ADAPTER_ID);
  }
});

test("over-fire control: Codex still refuses every OpenRouter id and pins its provider", () => {
  assert.equal(PI_PROVIDER, "openai-codex");
  for (const id of OPENROUTER_IDS) {
    unresolved(codexSelectorFor, id, "pi-codex");
  }
});

test("catalog patterns are per-family; only OpenRouter resolves a slash-bearing id", () => {
  assert.equal(resolveSelector("codex:z-ai/glm-5.2"), null);
  const route = resolveSelector("openrouter:z-ai/glm-5.2");
  assert.ok(route !== null);
  assert.equal(route.alias, "openrouter");
  assert.equal(route.adapterKind, PI_OPENROUTER_ADAPTER_ID);
  assert.equal(route.provider, "openrouter");
  assert.equal(route.contextWindow, null);
  assert.equal(route.requestedModel, "z-ai/glm-5.2");
  assert.equal(resolveSelector("openrouter:z-ai/glm-5.2:high"), null);
});
