import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnvelope } from "../../src/contracts/parse-envelope.ts";
import { validReviewContext } from "../unit/contracts/fixtures.ts";

const oldContext = validReviewContext();
const delivery = { directory: "/private/review-diffs/run", indexFile: "index.json", indexSha256: "c".repeat(64),
  files: [{ path: oldContext.changedFiles[0]!, file: "000001.diff", bytes: 321, inlineOmitted: false, inlineTruncated: false }] };
const validates = (context: unknown) => parseEnvelope(JSON.stringify(context), "awsf.review-context/v1").valid;

test("review-context v1 accepts old retained contexts and optional closed full-diff delivery records", () => {
  assert.equal(validates(oldContext), true);
  assert.equal(validates({ ...oldContext, diffDelivery: delivery }), true);
  assert.equal(validates({ ...oldContext, diffDelivery: { ...delivery, token: "must not reach an envelope" } }), false);
  assert.equal(validates({ ...oldContext, diffDelivery: { ...delivery, indexSha256: "not a digest" } }), false);
});

test("delivered file names and index names are directory-relative, never absolute or escaping", () => {
  for (const name of ["../raw/private.diff", "/state/raw/private.diff", "./file.diff", "a//file.diff"]) {
    assert.equal(validates({ ...oldContext, diffDelivery: { ...delivery, indexFile: name } }), false);
    assert.equal(validates({ ...oldContext, diffDelivery: { ...delivery, files: [{ ...delivery.files[0], file: name }] } }), false);
  }
});
