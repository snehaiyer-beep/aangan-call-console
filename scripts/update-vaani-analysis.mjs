// Pushes the `analysis` section of vaani/agent-config.json to the existing Vaani agent.
// Usage: node scripts/update-vaani-analysis.mjs
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const apiKey = env.match(/^VAANI_API_KEY=(.+)$/m)?.[1]?.trim();
const agentId = env.match(/^VAANI_AGENT_ID=(.+)$/m)?.[1]?.trim();
if (!apiKey || !agentId) throw new Error("VAANI_API_KEY and VAANI_AGENT_ID must be set in .env.local");

const { analysis } = JSON.parse(readFileSync(new URL("../vaani/agent-config.json", import.meta.url), "utf8")).config;
const res = await fetch(`https://api.vaanivoice.ai/api/agent/${agentId}/analysis`, {
  method: "PATCH",
  headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify(analysis),
});
const json = await res.json().catch(() => ({}));
const saved = json.analysis ?? json;
console.log(`HTTP ${res.status}`);
console.log("dispositions:", saved?.evaluations?.dispositions?.prompt_based?.map((d) => d.name).join(", "));
console.log("data points: ", saved?.extraction?.data_collection?.data_points?.map((d) => d.name).join(", "));
if (!res.ok) {
  console.log(JSON.stringify(json, null, 2).slice(0, 1500));
  process.exit(1);
}
