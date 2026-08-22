import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { stringify as toYaml } from "yaml";
import {
  registerProject,
  verifyRegisteredProject,
} from "../../../src/cli/commands/project.ts";
import { main } from "../../../src/cli/main.ts";
import { contractDigest } from "../../../src/gates/contract-digest.ts";
import {
  ContractProjectionPathError,
  ContractProjectionSchema,
  ContractProjectionSchemaError,
  loadContractProjection,
} from "../../../src/registry/contracts.ts";
import {
  ContractDigestSchema,
  ProjectCatalogSchema,
} from "../../../src/registry/catalog-schema.ts";

function validProjection(): Record<string, unknown> {
  return {
    version: "awsf.contracts/v1",
    contracts: [
      {
        id: "openapi",
        role: "consumes",
        path: "lib/api/openapi.json",
        digest: `sha256:${"0".repeat(64)}`,
      },
    ],
  };
}

function cloneProjection(): Record<string, any> {
  return structuredClone(validProjection()) as Record<string, any>;
}

function assertCode(action: () => unknown, ErrorType: new (...args: any[]) => Error, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof ErrorType && (error as { code?: string }).code === code);
}

test("loads a repository-local contract projection with only participant fields", () => {
  const projection = loadContractProjection(toYaml(validProjection()));

  assert.deepEqual(projection, validProjection());
});

test("the catalog and projection reference one digest schema fragment", () => {
  const catalogDigest = ProjectCatalogSchema.properties.contracts.items.properties.digest;
  const projectionDigest = ContractProjectionSchema.properties.contracts.items.properties.digest;

  assert.equal(catalogDigest, ContractDigestSchema);
  assert.equal(projectionDigest, ContractDigestSchema);
});

for (const [name, mutate] of [
  ["an extra root field", (doc: Record<string, any>) => { doc.project = "smart-health"; }],
  ["an extra participant field", (doc: Record<string, any>) => { doc.contracts[0].repository = "application"; }],
  ["a parent producer field", (doc: Record<string, any>) => {
    doc.contracts[0].producer = { repository: "service", path: "openapi.json" };
  }],
] as const) {
  test(`rejects ${name}`, () => {
    const doc = cloneProjection();
    mutate(doc);

    assertCode(
      () => loadContractProjection(toYaml(doc)),
      ContractProjectionSchemaError,
      "E_CONTRACT_PROJECTION_SCHEMA",
    );
  });
}

for (const digest of [
  `sha256:${"A".repeat(64)}`,
  `sha256:${"0".repeat(63)}`,
  "sha512:" + "0".repeat(64),
] as const) {
  test(`rejects projection digest ${digest.slice(0, 12)}...`, () => {
    const doc = cloneProjection();
    doc.contracts[0].digest = digest;

    assertCode(
      () => loadContractProjection(toYaml(doc)),
      ContractProjectionSchemaError,
      "E_CONTRACT_PROJECTION_SCHEMA",
    );
  });
}

test("rejects a projection path with an upward segment", () => {
  const doc = cloneProjection();
  doc.contracts[0].path = "lib/../openapi.json";

  assertCode(
    () => loadContractProjection(toYaml(doc)),
    ContractProjectionPathError,
    "E_CONTRACT_PROJECTION_PATH",
  );
});

const FIXTURE_SLUG = "contract-fence-fixture";
const CONTRACT_ID = "openapi";
const CONTRACT_PATH = "contract.json";
const CONTRACT_BYTES = Buffer.from('{"openapi":"v1"}\n');

interface ContractFixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly producer: string;
  readonly consumer: string;
  readonly catalogPath: string;
  readonly digest: string;
}

function git(repository: string, ...argv: string[]): string {
  return execFileSync("git", ["-C", repository, ...argv], { encoding: "utf8" }).trim();
}

function initializeRepository(repository: string): void {
  mkdirSync(repository, { recursive: true });
  git(repository, "init", "--initial-branch=main");
  git(repository, "config", "user.name", "AWSF Test Fixture");
  git(repository, "config", "user.email", "awsf-test@example.invalid");
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function projectionYaml(role: "produces" | "consumes", digest: string): string {
  return toYaml({
    version: "awsf.contracts/v1",
    contracts: [{ id: CONTRACT_ID, role, path: CONTRACT_PATH, digest }],
  });
}

function catalogYaml(digest: string): string {
  return toYaml({
    version: "awsf.project/v1",
    project: { slug: FIXTURE_SLUG },
    repositories: {
      producer: { role: "plan", default_branch: "main" },
      consumer: { role: "application", default_branch: "main" },
    },
    plans: { root: "specs", format: "awsf-plan-html/v1" },
    contracts: [{
      id: CONTRACT_ID,
      digest,
      producer: { repository: "producer", path: CONTRACT_PATH },
      consumers: [{ repository: "consumer", path: CONTRACT_PATH }],
    }],
  });
}

async function createContractFixture(root: string): Promise<ContractFixture> {
  const stateRoot = join(root, "state");
  const producer = join(root, "producer");
  const consumer = join(root, "consumer");
  const catalogPath = join(producer, "awsf.project.yaml");
  const digest = sha256(CONTRACT_BYTES);

  initializeRepository(producer);
  initializeRepository(consumer);
  writeFileSync(join(producer, CONTRACT_PATH), CONTRACT_BYTES);
  writeFileSync(join(producer, "awsf.contracts.yaml"), projectionYaml("produces", digest));
  writeFileSync(catalogPath, catalogYaml(digest));
  writeFileSync(join(consumer, CONTRACT_PATH), CONTRACT_BYTES);
  writeFileSync(join(consumer, "awsf.contracts.yaml"), projectionYaml("consumes", digest));

  for (const repository of [producer, consumer]) {
    git(repository, "add", ".");
    git(repository, "commit", "-m", "test: seed contract fixture");
    assert.equal(git(repository, "status", "--porcelain"), "");
    assert.equal(git(repository, "ls-files", "--error-unmatch", CONTRACT_PATH), CONTRACT_PATH);
  }

  await registerProject({
    stateRoot,
    catalogPath,
    repositories: [`producer=${producer}`, `consumer=${consumer}`],
  });
  return { root, stateRoot, producer, consumer, catalogPath, digest };
}

async function verifyViaCli(fixture: ContractFixture): Promise<{ readonly exitCode: number; readonly output: readonly string[] }> {
  const output: string[] = [];
  const errors: string[] = [];
  const exitCode = await main({
    argv: ["project", "verify", FIXTURE_SLUG, "--state-root", fixture.stateRoot],
    writeOut: (line) => { output.push(line); },
    writeError: (line) => { errors.push(line); },
  });
  assert.deepEqual(errors, []);
  return { exitCode, output };
}

function mutateOneByte(path: string): void {
  const original = readFileSync(path);
  const changed = Buffer.from(original);
  const index = changed.indexOf("1".charCodeAt(0));
  assert.notEqual(index, -1);
  changed[index] = "2".charCodeAt(0);
  assert.equal(changed.length, original.length);
  assert.equal(changed.reduce((count, byte, offset) => count + Number(byte !== original[offset]), 0), 1);
  writeFileSync(path, changed);
}

async function assertFixtureGreen(fixture: ContractFixture): Promise<void> {
  assert.equal(contractDigest(fixture.producer).passed, true);
  assert.equal(contractDigest(fixture.consumer).passed, true);
  const report = await verifyRegisteredProject(fixture.stateRoot, FIXTURE_SLUG);
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(await verifyViaCli(fixture), {
    exitCode: 0,
    output: [`project ${FIXTURE_SLUG}: contract verification passed`],
  });
}

function failureKeys(failures: readonly { readonly kind: string; readonly repositoryId: string }[]): string[] {
  return failures.map((failure) => `${failure.kind}:${failure.repositoryId}`);
}

test("two committed contract copies reconcile and all three drift modes are distinguished", async () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-contract-fences-"));
  try {
    const fixture = await createContractFixture(root);
    assert.equal(dirname(fixture.producer), fixture.root);
    assert.equal(dirname(fixture.consumer), fixture.root);
    await assertFixtureGreen(fixture);

    // A contradictory artifact at the same relative path in the sibling root
    // cannot affect the consumer's single-root local fence.
    const consumerBeforeSiblingDrift = contractDigest(fixture.consumer);
    mutateOneByte(join(fixture.producer, CONTRACT_PATH));
    assert.equal(contractDigest(fixture.producer).passed, false);
    assert.deepEqual(contractDigest(fixture.consumer), consumerBeforeSiblingDrift);
    git(fixture.producer, "restore", "--", CONTRACT_PATH);
    await assertFixtureGreen(fixture);

    // Drift 1: only the consumer artifact moves by one byte.
    mutateOneByte(join(fixture.consumer, CONTRACT_PATH));
    const consumerArtifactFence = contractDigest(fixture.consumer);
    assert.equal(consumerArtifactFence.passed, false);
    assert.equal(consumerArtifactFence.checks.length, 1);
    assert.equal(consumerArtifactFence.checks[0]?.item, `contract ${CONTRACT_ID}: ${CONTRACT_PATH}`);
    const artifactDrift = await verifyRegisteredProject(fixture.stateRoot, FIXTURE_SLUG);
    assert.equal(artifactDrift.ok, false);
    assert.deepEqual(failureKeys(artifactDrift.failures), ["artifact-disagrees:consumer"]);
    const artifactCommand = await verifyViaCli(fixture);
    assert.equal(artifactCommand.exitCode, 1);
    assert.equal(artifactCommand.output.length, 1);
    assert.match(artifactCommand.output[0] ?? "", /^artifact disagrees: contract=openapi, repository=consumer,/);
    git(fixture.consumer, "restore", "--", CONTRACT_PATH);
    await assertFixtureGreen(fixture);

    // Drift 2: only the consumer projection's digest moves. The report names
    // both broken relations while the producer's local fence remains green.
    const otherDigest = sha256(Buffer.from("a different contract"));
    assert.notEqual(otherDigest, fixture.digest);
    writeFileSync(join(fixture.consumer, "awsf.contracts.yaml"), projectionYaml("consumes", otherDigest));
    assert.equal(contractDigest(fixture.producer).passed, true);
    const projectionDrift = await verifyRegisteredProject(fixture.stateRoot, FIXTURE_SLUG);
    assert.equal(projectionDrift.ok, false);
    assert.deepEqual(failureKeys(projectionDrift.failures), [
      "projection-disagrees:consumer",
      "artifact-disagrees:consumer",
    ]);
    const projectionCommand = await verifyViaCli(fixture);
    assert.equal(projectionCommand.exitCode, 1);
    assert.match(projectionCommand.output[0] ?? "", /^projection disagrees: contract=openapi, repository=consumer;/);
    assert.match(projectionCommand.output[1] ?? "", /^artifact disagrees: contract=openapi, repository=consumer,/);
    git(fixture.consumer, "restore", "--", "awsf.contracts.yaml");
    await assertFixtureGreen(fixture);

    // Drift 3: only the parent catalog's digest moves. Both unchanged child
    // projections disagree with it, while both local artifact fences stay green.
    writeFileSync(fixture.catalogPath, catalogYaml(otherDigest));
    assert.equal(contractDigest(fixture.producer).passed, true);
    assert.equal(contractDigest(fixture.consumer).passed, true);
    const catalogDrift = await verifyRegisteredProject(fixture.stateRoot, FIXTURE_SLUG);
    assert.equal(catalogDrift.ok, false);
    assert.deepEqual(failureKeys(catalogDrift.failures), [
      "projection-disagrees:producer",
      "projection-disagrees:consumer",
    ]);
    const catalogCommand = await verifyViaCli(fixture);
    assert.equal(catalogCommand.exitCode, 1);
    assert.equal(catalogCommand.output.length, 2);
    assert.match(catalogCommand.output[0] ?? "", /^projection disagrees: contract=openapi, repository=producer;/);
    assert.match(catalogCommand.output[1] ?? "", /^projection disagrees: contract=openapi, repository=consumer;/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a repository with no contract projection passes with zero checks", () => {
  const root = mkdtempSync(join(tmpdir(), "awsf-contract-fence-empty-"));
  const repository = join(root, "repository");
  try {
    initializeRepository(repository);
    writeFileSync(join(repository, "README.md"), "fixture without contracts\n");
    git(repository, "add", "README.md");
    git(repository, "commit", "-m", "test: seed repository without contracts");

    const report = contractDigest(repository);
    assert.equal(report.gateId, "contract_digest");
    assert.equal(report.passWhenEmpty, true);
    assert.equal(report.passed, true);
    assert.deepEqual(report.checks, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
