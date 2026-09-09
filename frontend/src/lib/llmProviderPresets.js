export const ATLAS_CLOUD_LLM_API_BASE = "https://api.atlascloud.ai/v1";

export function atlasCloudLlmPreset() {
  return {
    apiBase: ATLAS_CLOUD_LLM_API_BASE,
    compatibility: "generic",
  };
}
