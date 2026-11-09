import { test } from "node:test";
import assert from "node:assert/strict";
import {
  containsCredential,
  scrubCredentialString,
  REDACTED_VALUE,
} from "../../../src/policy/redaction.ts";

test("B13-03: Bearer pattern does not redact ordinary prose containing 'bearer of'", () => {
  const prose1 = "bearer of the bad news";
  assert.equal(containsCredential(prose1), false);
  assert.equal(scrubCredentialString(prose1), prose1);

  const prose2 = "the bond bearer was not identified";
  assert.equal(containsCredential(prose2), false);
  assert.equal(scrubCredentialString(prose2), prose2);

  const prose3 = "Bearer of gifts";
  assert.equal(containsCredential(prose3), false);
  assert.equal(scrubCredentialString(prose3), prose3);

  // Real Bearer token with 16+ chars is redacted
  const realBearer = "Bearer abcdef1234567890abcdef";
  assert.equal(containsCredential(realBearer), true);
  assert.equal(scrubCredentialString(realBearer), REDACTED_VALUE);

  const realJwtBearer = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
  assert.equal(containsCredential(realJwtBearer), true);
  assert.equal(scrubCredentialString(realJwtBearer), REDACTED_VALUE);
});

test("B13-03: Basic pattern does not redact English prose with long words after 'Basic'", () => {
  const prose1 = "Basic authentication failed on the retry";
  assert.equal(containsCredential(prose1), false);
  assert.equal(scrubCredentialString(prose1), prose1);

  const prose2 = "Basic configuration files were regenerated";
  assert.equal(containsCredential(prose2), false);
  assert.equal(scrubCredentialString(prose2), prose2);

  const prose3 = "basic understanding of the architecture";
  assert.equal(containsCredential(prose3), false);
  assert.equal(scrubCredentialString(prose3), prose3);

  // Real Basic auth credentials with padding or digits are redacted
  const realBasic = "Basic dXNlcjpwYXNzd29yZA==";
  assert.equal(containsCredential(realBasic), true);
  assert.equal(scrubCredentialString(realBasic), REDACTED_VALUE);

  const realBasicDigits = "Basic YWRtaW46c2VjcmV0"; // admin:secret in base64
  assert.equal(containsCredential(realBasicDigits), true);
  assert.equal(scrubCredentialString(realBasicDigits), REDACTED_VALUE);
});

test("B13-04: URL credential pattern does not exhibit quadratic backtracking on unbroken character runs", () => {
  const longRun = "a-".repeat(20000); // 40,000 characters
  const start = Date.now();
  const matched = containsCredential(longRun);
  const duration = Date.now() - start;

  assert.equal(matched, false);
  assert.ok(duration < 200, `Execution took ${duration}ms, expected under 200ms`);

  // Legitimate URL with credentials is still recognized and scrubbed
  const credentialUrl = "https://user:password@example.com/api";
  assert.equal(containsCredential(credentialUrl), true);
  assert.equal(scrubCredentialString(credentialUrl), `${REDACTED_VALUE}example.com/api`);
});
