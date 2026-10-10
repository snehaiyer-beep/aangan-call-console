// Creates the Aangan agent in Vaani from vaani/agent-config.json and saves its id to .env.local.
// Usage: node scripts/create-vaani-agent.mjs
import { readFileSync, writeFileSync } from "node:fs";

const envPath = new URL("../.env.local", import.meta.url);
let envText = readFileSync(envPath, "utf8");
const apiKey = envText.match(/^VAANI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) throw new Error("VAANI_API_KEY missing from .env.local");
if (/^VAANI_AGENT_ID=.+$/m.test(envText)) throw new Error("VAANI_AGENT_ID already set — agent exists; refusing to create a duplicate");

const body = readFileSync(new URL("../vaani/agent-config.json", import.meta.url), "utf8");
const res = await fetch("https://api.vaanivoice.ai/api/create-agent", {
  method: "POST",
  headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
  body,
});
const json = await res.json().catch(() => ({}));
console.log(`HTTP ${res.status}`, JSON.stringify(json, null, 2));
if (!res.ok || !json.agent_id) process.exit(1);

envText += `\n# Vaani agent created by scripts/create-vaani-agent.mjs\nVAANI_AGENT_ID=${json.agent_id}\n`;
writeFileSync(envPath, envText);
console.log("Saved VAANI_AGENT_ID to .env.local");
