// Pushes the `persona` section of vaani/agent-config.json (prompt, greeting, speech keywords)
// to the existing Vaani agent. Usage: node scripts/update-vaani-persona.mjs
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const apiKey = env.match(/^VAANI_API_KEY=(.+)$/m)?.[1]?.trim();
const agentId = env.match(/^VAANI_AGENT_ID=(.+)$/m)?.[1]?.trim();
if (!apiKey || !agentId) throw new Error("VAANI_API_KEY and VAANI_AGENT_ID must be set in .env.local");

const { persona } = JSON.parse(readFileSync(new URL("../vaani/agent-config.json", import.meta.url), "utf8")).config;
const res = await fetch(`https://api.vaanivoice.ai/api/agent/${agentId}/persona`, {
  method: "PATCH",
  headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify(persona),
});
const json = await res.json().catch(() => ({}));
const saved = json.persona ?? json;
const stt = saved?.senses_capabilities?.ears?.stt;
console.log(`HTTP ${res.status}`);
console.log("NAMES rule in prompt:", Boolean(saved?.identity?.system_prompt?.includes("\nNAMES\n")));
console.log("STT primary:", stt?.primary?.provider, stt?.primary?.model, "| keywords:", stt?.primary?.keywords?.length);
console.log("STT fallback kept:", stt?.fallback?.provider ?? "none");
console.log("LLM / voice kept:", saved?.senses_capabilities?.brain?.llm?.primary?.model, "/", saved?.senses_capabilities?.mouth?.tts?.primary?.voice_name);
if (!res.ok) {
  console.log(JSON.stringify(json, null, 2).slice(0, 1500));
  process.exit(1);
}
