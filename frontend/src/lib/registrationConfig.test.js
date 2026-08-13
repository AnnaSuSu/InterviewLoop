import assert from "node:assert/strict";
import test from "node:test";

import { loadRegistrationConfig } from "./registrationConfig.js";

test("retries transient failures before returning the registration flag", async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts < 3) throw new TypeError("temporary network failure");
    return {
      ok: true,
      json: async () => ({ allow_registration: true }),
    };
  };

  const allowed = await loadRegistrationConfig({
    fetchImpl,
    retries: 2,
    sleep: async () => {},
  });

  assert.equal(allowed, true);
  assert.equal(attempts, 3);
});

test("rejects malformed config instead of treating it as registration disabled", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({}),
  });

  await assert.rejects(
    loadRegistrationConfig({ fetchImpl, retries: 0 }),
    /allow_registration/,
  );
});

test("times out a stalled response so the page can offer a retry", async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("request aborted")));
  });

  await assert.rejects(
    loadRegistrationConfig({ fetchImpl, retries: 0, timeoutMs: 5 }),
    /aborted/,
  );
});
