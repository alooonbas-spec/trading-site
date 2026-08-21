export const TINYFISH_ENDPOINTS = {
  fetch: "https://api.fetch.tinyfish.ai",
  search: "https://api.search.tinyfish.ai",
  agentRun: "https://agent.tinyfish.ai/v1/automation/run",
} as const;

export const SAFE_FETCH_PURPOSE =
  "Extract public social profile title, description, and text for CRM";

export const SAFE_SEARCH_PURPOSE =
  "Find public posts matching workspace monitoring keywords on official social domains";
