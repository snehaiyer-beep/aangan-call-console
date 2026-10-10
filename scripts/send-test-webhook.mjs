// Sends Vaani-style signed webhook events to the console, for local testing.
// Usage: node scripts/send-test-webhook.mjs [baseUrl]   (default http://localhost:3100)
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const base = process.argv[2] ?? "http://localhost:3100";
const secret = env.VAANI_WEBHOOK_SECRET;
// "test-" prefix keeps the call out of HubSpot (see app/api/vaani/webhook/route.ts).
const id = `test-${Date.now()}`;

async function send(body, { sign = true } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = { "Content-Type": "application/json" };
  if (sign) {
    // Agent-webhook style (what Vaani's dashboard webhooks send).
    headers["X-Webhook-Event"] = body.event;
    headers["X-Webhook-Signature"] = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  }
  const res = await fetch(`${base}/api/vaani/webhook`, { method: "POST", headers, body: raw });
  console.log(`${body.event.padEnd(20)} ${sign ? "signed  " : "unsigned"} → ${res.status} ${await res.text()}`);
}

await send({ event: "call_started", room_name: id, status: "dialing", phone_number: "+919800000000" }, { sign: false });
await send({ event: "call_started", room_name: id, status: "dialing", phone_number: "+919800000000" });
await send({
  event: "call_postprocessing",
  call_id: id,
  timestamp: new Date().toISOString(),
  data: {
    room_name: id,
    call_id: id,
    call_duration: 96000,
    end_reason: "Call ended",
    summary: "TEST CALL — a caller with a bare-shell 3BHK in Baner wants full interiors by March; asked for a per-sq-ft rate and Vaani held policy.",
    entities: {
      caller_name: "Test Caller",
      segment: "residential",
      property_type: "3BHK · Bare Shell",
      project_scope: "Kitchen, wardrobes, living room",
      carpet_area_sqft: "1180",
      budget_min_inr: null,
      budget_max_inr: null,
      site_location: "Baner",
      timeline: "Move in by March",
      decision_maker: "Owner",
      lead_source: "Instagram",
      known_context: "Warm minimal | Kids' study corner",
      caller_email: "test.caller@example.com",
      booking_status: "booked",
      booking_time: "2026-10-11T18:00:00+05:30",
    },
    dispositions: {
      qualification: "Qualified",
      qualification_reason: "Full home · in area · March move-in",
      crit_real_project: "pass: full home with execution",
      crit_service_area: "pass: Baner",
      crit_timeline: "pass: March move-in",
      crit_budget: "unclear: not volunteered — forward",
      crit_decision_maker: "pass: owner",
      pricing_quoted: "No",
    },
    recording_url: `https://api.vaanivoice.ai/api/stream/${id}`,
    transcript:
      "[22:47:01] AGENT: Namaskar, thank you for calling Aangan Studio. This is Vaani — how can I help you today?\n\n" +
      "[22:47:08] USER: Hi, I have a bare shell 3BHK in Baner, about 1180 square feet. What's your rate per square foot?\n\n" +
      "[22:47:17] AGENT: Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.\n\n" +
      "[22:47:31] USER: Okay. We want to move in by March.\n\n" +
      "[22:47:36] AGENT: That works well. I'll have the team confirm a consultation slot with you.",
  },
});
console.log(`\nTest call id: V-${id}`);
