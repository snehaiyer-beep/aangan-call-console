// End-to-end trial without phoning: sends a realistic, signed Vaani call report for a
// qualified caller to the console. Unlike "test-" calls, this runs the full live path:
// Supabase → Cal.com booking (real invite email) → HubSpot.
// Usage: node scripts/run-trial-call.mjs <email> [preferredISO] [baseUrl]
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const [email, preferred = "2026-10-12T11:00:00+05:30", base = "https://aangan-call-console-kappa.vercel.app"] =
  process.argv.slice(2);
if (!email) throw new Error("Usage: node scripts/run-trial-call.mjs <email> [preferredISO] [baseUrl]");

const id = `trial-${Date.now()}`;
const t0 = Date.now() - 4 * 60_000;
const clock = (s) => new Date(t0 + s * 1000).toISOString().slice(11, 19);
const lines = [
  [0, "AGENT", "Namaskar, thank you for calling Aangan Studio. This is Vaani — how can I help you today?"],
  [6, "USER", "Hi, I want to do the full interiors of my new flat in Baner."],
  [12, "AGENT", "Lovely! May I have your name, please?"],
  [16, "USER", "Sneha Iyer."],
  [20, "AGENT", "Thank you, Sneha. What email should we send the calendar invite to?"],
  [26, "USER", `It's ${email}.`],
  [31, "AGENT", `So that is ${email} — correct?`],
  [35, "USER", "Yes."],
  [38, "AGENT", "Great. Is it a 2BHK or 3BHK, and what would you like done?"],
  [44, "USER", "3BHK, bare shell. Kitchen, wardrobes, living room, everything."],
  [52, "AGENT", "Roughly how big is the carpet area? An estimate is fine."],
  [57, "USER", "About 1,200 square feet."],
  [62, "AGENT", "Thank you. When would you like to move in, and are you the one deciding?"],
  [69, "USER", "By March. Yes, my husband and I decide together and he's on board. What is your rate per square foot?"],
  [80, "AGENT", "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like."],
  [93, "USER", "Okay. Monday at 11 AM works."],
  [98, "AGENT", "So that is Monday, 12 October at 11 AM IST — correct?"],
  [103, "USER", "Yes."],
  [106, "AGENT", `Perfect — you will get a calendar invite at ${email} within a few minutes. If that exact slot is taken, the invite will have the closest free time.`],
  [118, "USER", "Thank you."],
];
const transcript = lines.map(([s, who, text]) => `[${clock(s)}] ${who}: ${text}`).join("\n\n");

const event = {
  event: "call_postprocessing",
  call_id: id,
  timestamp: new Date().toISOString(),
  data: {
    room_name: id,
    call_id: id,
    call_type: "webrtc",
    call_started_at: new Date(t0).toISOString(),
    call_ended_at: new Date(t0 + 122_000).toISOString(),
    summary:
      "Sneha Iyer wants full interiors for a 1,200 sq.ft. bare-shell 3BHK in Baner — kitchen, wardrobes and living room — moving in by March; she and her husband decide together. She asked for a per-sq-ft rate and Vaani held the pricing policy. She chose Monday 12 October, 11 AM IST for the discovery call.",
    entities: {
      caller_name: "Sneha Iyer",
      caller_email: email,
      segment: "residential",
      property_type: "3BHK · Bare Shell",
      project_scope: "Kitchen, wardrobes, living room — full home",
      carpet_area_sqft: "1200",
      budget_min_inr: null,
      budget_max_inr: null,
      site_location: "Baner",
      timeline: "Move in by March",
      site_state: "Bare shell",
      decision_maker: "Owner + husband agreed",
      lead_source: null,
      known_context: "Bare shell | Husband on board | Asked per-sq-ft rate",
      qualification_reason: "Full home · in area · March move-in",
      crit_real_project: "pass: full home with execution",
      crit_service_area: "pass: Baner, Pune",
      crit_timeline: "pass: March move-in",
      crit_budget: "unclear: not volunteered — forward",
      crit_decision_maker: "pass: owner and husband",
      booking_status: "not booked",
      booking_time: null,
      preferred_slot: preferred,
    },
    dispositions: { qualification: "Qualified", pricing_quoted: "No" },
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
console.log(`trial ${id} → ${res.status} ${await res.text()}`);
