// Re-imports a call from Vaani's API into the console (e.g. if its webhook was missed).
// Builds the same signed `call_postprocessing` event Vaani would have sent.
// Usage: node scripts/import-vaani-call.mjs <call_id> [consoleBaseUrl] [--dry-run]
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [callId, base = "https://aangan-call-console-kappa.vercel.app"] = args.filter((a) => !a.startsWith("--"));
if (!callId) throw new Error("Usage: node scripts/import-vaani-call.mjs <call_id> [baseUrl] [--dry-run]");

const res = await fetch(`https://api.vaanivoice.ai/api/call_details/${encodeURIComponent(callId)}`, {
  headers: { "X-API-Key": env.VAANI_API_KEY },
});
if (!res.ok) throw new Error(`Vaani call_details ${res.status}: ${(await res.text()).slice(0, 200)}`);
const d = await res.json();

const event = {
  event: "call_postprocessing",
  call_id: callId,
  timestamp: new Date().toISOString(),
  data: {
    call_id: callId,
    room_name: callId,
    summary: d.summary,
    entities: d.entity ?? {},
    dispositions: d.call_eval_tag && typeof d.call_eval_tag === "object" ? d.call_eval_tag : {},
    transcript: d.transcription,
    recording_url: `https://api.vaanivoice.ai/api/stream/${callId}`,
  },
};

if (dryRun) {
  console.log("transcript starts:", JSON.stringify(String(d.transcription).slice(0, 200)));
  console.log("dispositions:", JSON.stringify(event.data.dispositions));
  process.exit(0);
}

const raw = JSON.stringify(event);
const post = await fetch(`${base}/api/vaani/webhook`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Event": "call_postprocessing",
    "X-Webhook-Signature": "sha256=" + createHmac("sha256", env.VAANI_WEBHOOK_SECRET).update(raw).digest("hex"),
  },
  body: raw,
});
console.log(`import ${callId} → ${post.status} ${await post.text()}`);
