import assert from "node:assert/strict";
import test from "node:test";

import {
  ATLAS_CLOUD_LLM_API_BASE,
  atlasCloudLlmPreset,
} from "./llmProviderPresets.js";

test("configures Atlas Cloud through the generic OpenAI-compatible driver", () => {
  assert.deepEqual(atlasCloudLlmPreset(), {
    apiBase: ATLAS_CLOUD_LLM_API_BASE,
    compatibility: "generic",
  });
  assert.equal(ATLAS_CLOUD_LLM_API_BASE, "https://api.atlascloud.ai/v1");
});
