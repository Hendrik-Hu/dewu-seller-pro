import assert from "node:assert/strict";
import test from "node:test";
import { readHostedApiKey } from "../supabase/functions/_shared/apiKeys.ts";

test("reads a hosted key dictionary", () => {
  assert.equal(
    readHostedApiKey(JSON.stringify({ default: "modern-key" })),
    "modern-key",
  );
});

test("accepts hosted key metadata objects", () => {
  assert.equal(
    readHostedApiKey(JSON.stringify([{ name: "default", api_key: "modern-key" }])),
    "modern-key",
  );
});

test("never falls back when hosted values are unavailable", () => {
  assert.equal(readHostedApiKey("not-json"), undefined);
  assert.equal(readHostedApiKey(undefined), undefined);
});
