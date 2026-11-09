// B3-14 — RECORD_SCHEMAS is the complete table of host-owned record schemas.
//
// Its own comment says it holds every host-owned record schema, and that the
// set is disjoint from the envelope table. The preview record is written by the
// host (awsf preview) and was missing, so any check that treats the table as
// the complete record set could not see it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ENVELOPE_SCHEMAS, RECORD_SCHEMAS } from "../../../src/contracts/registry.ts";
import { PREVIEW_RECORD_SCHEMA, PreviewRecordSchema } from "../../../src/contracts/preview-record.ts";

test("the preview record is a registered host record, not an envelope (B3-14)", () => {
  assert.equal(PREVIEW_RECORD_SCHEMA, "awsf.preview/v1");
  assert.equal(RECORD_SCHEMAS[PREVIEW_RECORD_SCHEMA], PreviewRecordSchema);
  assert.equal(Object.hasOwn(ENVELOPE_SCHEMAS, PREVIEW_RECORD_SCHEMA), false);
});
