import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./_walk.ts";

const PACKAGES = ["core/package.json", "dashboard/package.json", "package.json"];
const FENCE = "core/test/unit/meta/dependency-allowlist.test.ts";
const FIELDS = ["optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"];

// Run the real fence, unchanged, in an isolated tree. No repository package is
// mutated, and the regression does not reimplement the allowlist assertions.
function runFence(path: string, mutate: (pkg: Record<string, unknown>) => void): string {
  const root = mkdtempSync(join(tmpdir(), "awsf-dependencies-b5-12-"));
  try {
    for (const file of [FENCE, "core/test/unit/meta/_walk.ts", ...PACKAGES]) {
      const target = join(root, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(repoRoot(), file), target);
    }
    const target = join(root, path);
    const pkg = JSON.parse(readFileSync(target, "utf8")) as Record<string, unknown>;
    mutate(pkg);
    writeFileSync(target, JSON.stringify(pkg));
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "--test-reporter=tap", FENCE], {
      cwd: root, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    const output = result.stdout + result.stderr;
    assert.match(output, /# tests 3\b/, output);
    assert.equal(result.status, output.includes("# fail 0\n") ? 0 : 1, output);
    return output;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const path of PACKAGES) {
  for (const field of FIELDS) {
    test(`B5-12: ${path} rejects an unallowlisted ${field} dependency`, () => {
      const output = runFence(path, (pkg) => {
        pkg[field] = field.includes("bundle") ? ["left-pad"] : { "left-pad": "1.3.0" };
      });
      assert.match(output, /# fail 1\b/, `${path} must reject left-pad in ${field}:\n${output}`);
      assert.match(output, /ERR_ASSERTION/, output);
    });
  }

  test(`B5-12: ${path} accepts empty supplemental declarations`, () => {
    assert.match(runFence(path, (pkg) => {
      pkg.optionalDependencies = {};
      pkg.peerDependencies = {};
      pkg.bundleDependencies = [];
      pkg.bundledDependencies = [];
    }), /# fail 0\b/);
  });

  for (const field of ["bundleDependencies", "bundledDependencies"]) {
    for (const value of [true, false]) {
      test(`B5-12: ${path} accepts ${field}=${value} over allowed declarations`, () => {
        assert.match(runFence(path, (pkg) => { pkg[field] = value; }), /# fail 0\b/);
      });
    }
  }
}

for (const [path, names] of [
  ["core/package.json", ["@sinclair/typebox", "yaml"]],
  ["dashboard/package.json", ["vue", "lucide-vue-next", "vite", "@vitejs/plugin-vue"]],
] as const) {
  test(`B5-12: ${path} accepts its D2 names in every supplemental field`, () => {
    assert.match(runFence(path, (pkg) => {
      pkg.optionalDependencies = Object.fromEntries(names.map((name) => [name, "*"]));
      pkg.peerDependencies = Object.fromEntries(names.map((name) => [name, "*"]));
      pkg.bundleDependencies = [...names];
      pkg.bundledDependencies = [...names];
    }), /# fail 0\b/);
  });
}

for (const [path, name] of [
  ["core/package.json", "vue"],
  ["dashboard/package.json", "yaml"],
  ["package.json", "@types/node"],
] as const) {
  test(`B5-12: ${path} cannot borrow ${name} from another D2 scope`, () => {
    const output = runFence(path, (pkg) => { pkg.optionalDependencies = { [name]: "*" }; });
    assert.match(output, /# fail 1\b/, output);
    assert.match(output, /ERR_ASSERTION/, output);
  });
}

for (const field of ["bundleDependencies", "bundledDependencies"]) {
  test(`B5-12: an allowed bundling alias cannot hide a forbidden ${field} entry`, () => {
    const output = runFence("core/package.json", (pkg) => {
      pkg.bundleDependencies = ["yaml"];
      pkg.bundledDependencies = ["yaml"];
      pkg[field] = ["yaml", "left-pad"];
    });
    assert.match(output, /# fail 1\b/, output);
    assert.match(output, /ERR_ASSERTION/, output);
  });

  test(`B5-12: ${field}=true cannot hide a forbidden optional dependency`, () => {
    const output = runFence("core/package.json", (pkg) => {
      pkg[field] = true;
      pkg.optionalDependencies = { "left-pad": "1.3.0" };
    });
    assert.match(output, /# fail 1\b/, output);
    assert.match(output, /ERR_ASSERTION/, output);
  });
}

for (const field of FIELDS) {
  test(`B5-12: ${field} rejects a malformed declaration rather than skipping it`, () => {
    const output = runFence("core/package.json", (pkg) => {
      pkg[field] = field.includes("bundle") ? { "left-pad": "1.3.0" } : ["left-pad"];
    });
    assert.match(output, /# fail 1\b/, output);
    assert.match(output, /ERR_ASSERTION/, output);
  });
}

for (const path of PACKAGES) {
  test(`B5-12: ${path} retains the exact existing dependency checks`, () => {
    const output = runFence(path, (pkg) => {
      const field = path === "package.json" ? "devDependencies" : "dependencies";
      (pkg[field] as Record<string, string>)["left-pad"] = "1.3.0";
    });
    assert.match(output, /# fail 1\b/, output);
    assert.match(output, /ERR_ASSERTION/, output);
  });
}
