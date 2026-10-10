// Logs a call into the live console from plain details — no phone call needed.
// Builds the same signed report Vaani sends, so the full path runs:
// dashboard (Supabase) → Cal.com booking + invite → HubSpot contact & deal.
// Usage: node scripts/log-call.mjs <details.json> [baseUrl]
// details.json: { name, email, location, society?, property, scope, carpetArea?, budgetInr?: [min,max],
//                 timeline?, slot (ISO with +05:30), decisionMaker?, askedPrice?, notes?: string[] }
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const [file, base = "https://aangan-call-console-kappa.vercel.app"] = process.argv.slice(2);
if (!file) throw new Error("Usage: node scripts/log-call.mjs <details.json> [baseUrl]");
const c = JSON.parse(readFileSync(file, "utf8"));

const first = c.name.split(" ")[0];
const lakh = (n) => `₹${+(n / 100000).toFixed(1)}L`;
const budgetText = c.budgetInr ? (c.budgetInr[0] === c.budgetInr[1] ? lakh(c.budgetInr[0]) : `${lakh(c.budgetInr[0])}–${lakh(c.budgetInr[1])}`) : null;
const slot = new Date(c.slot);
const slotSpoken = slot.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });

// Conversation following the agent's intake checklist.
const turns = [
  ["AGENT", "Namaskar, thank you for calling Aangan Studio. This is Vaani — how can I help you today?"],
  ["USER", `Hi, I'd like to get my flat done. It's a ${c.property} in ${c.location}${c.society ? `, ${c.society}` : ""}.`],
  ["AGENT", "Lovely! May I have your name, please?"],
  ["USER", `${c.name}.`],
  ["AGENT", `Thank you, ${first}. What email should we send the calendar invite to?`],
  ["USER", `${c.email}.`],
  ["AGENT", `So that is ${c.email} — correct?`],
  ["USER", "Yes."],
  ["AGENT", `And what would you like us to do in the ${c.property}?`],
  ["USER", `${c.scope}.`],
  ["AGENT", "Roughly how big is the carpet area? An estimate is fine."],
  ["USER", c.carpetArea ? `Around ${c.carpetArea.toLocaleString("en-IN")} square feet.` : "I'm not sure of the exact number."],
  ["AGENT", "When would you like it done, and will you be the one making the decisions?"],
  ["USER", `${c.timeline ?? "In the next few months"}. ${c.decisionMaker ?? "Yes, I'm the owner."}${budgetText ? ` Our budget is about ${budgetText}.` : ""}`],
  ...(c.askedPrice
    ? [
        ["USER", "What is your rate per square foot?"],
        ["AGENT", "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like."],
      ]
    : []),
  ["AGENT", "I'd love to set up a free 15-minute discovery call with one of our designers. Which day and time suit you?"],
  ["USER", `${slotSpoken.split(",")[0]} at ${slot.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}.`],
  ["AGENT", `So that is ${slotSpoken} IST — correct?`],
  ["USER", "Yes."],
  ["AGENT", `Perfect — you will get a calendar invite at ${c.email} within a few minutes. If that exact slot is taken, the invite will have the closest free time.`],
  ["USER", "Thank you."],
];
const t0 = Date.now() - 5 * 60_000;
let secs = 0;
const transcript = turns
  .map(([who, text]) => {
    const line = `[${new Date(t0 + secs * 1000).toISOString().slice(11, 19)}] ${who}: ${text}`;
    secs += Math.max(4, Math.round(text.length / 14));
    return line;
  })
  .join("\n\n");

const id = `logged-${Date.now()}`;
const event = {
  event: "call_postprocessing",
  call_id: id,
  timestamp: new Date().toISOString(),
  data: {
    room_name: id,
    call_id: id,
    call_type: "webrtc",
    call_started_at: new Date(t0).toISOString(),
    call_ended_at: new Date(t0 + (secs + 3) * 1000).toISOString(),
    summary: c.summary,
    entities: {
      caller_name: c.name,
      caller_email: c.email,
      segment: "residential",
      property_type: c.propertyLabel ?? c.property,
      project_scope: c.scope,
      carpet_area_sqft: c.carpetArea ? String(c.carpetArea) : null,
      budget_min_inr: c.budgetInr ? String(c.budgetInr[0]) : null,
      budget_max_inr: c.budgetInr ? String(c.budgetInr[1]) : null,
      site_location: c.location,
      location_detail: c.society ?? null,
      timeline: c.timeline ?? null,
      site_state: c.siteState ?? null,
      decision_maker: c.decisionMakerLabel ?? "Owner",
      lead_source: null,
      known_context: (c.notes ?? []).join(" | ") || null,
      qualification_reason: c.qualificationReason,
      crit_real_project: c.criteria.realProject,
      crit_service_area: c.criteria.serviceArea,
      crit_timeline: c.criteria.timeline,
      crit_budget: c.criteria.budget,
      crit_decision_maker: c.criteria.decisionMaker,
      booking_status: "not booked",
      booking_time: null,
      preferred_slot: c.slot,
    },
    dispositions: { qualification: c.qualification ?? "Qualified", pricing_quoted: "No" },
    transcript,
  },
};

const raw = JSON.stringify(event);
const res = await fetch(`${base}/api/vaani/webhook`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Event": "call_postprocessing",
    "X-Webhook-Signature": "sha256=" + createHmac("sha256", env.VAANI_WEBHOOK_SECRET).update(raw).digest("hex"),
  },
  body: raw,
});
console.log(`logged ${id} → ${res.status} ${await res.text()}`);
