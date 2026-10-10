import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { estimateTimes } from "./policy";
import type { CallLead, CriterionKey, CriterionResult, CriterionStatus, Qualification, Speaker, TranscriptItem } from "./types";

/**
 * Vaani (app.vaanivoice.ai) → console adapter.
 * Docs: https://docs.vaanivoice.ai/guides/webhook-setup
 *
 * Vaani POSTs call lifecycle events to /api/vaani/webhook. The one that matters is
 * `call_postprocessing` (transcript, summary, entities, dispositions, recording).
 * Field names inside `entities` / `dispositions` are the ones defined in
 * vaani/agent-config.json (analysis → data_points / dispositions).
 */

export const VAANI_API = "https://api.vaanivoice.ai";

export function vaaniConfig() {
  return {
    apiKeyConfigured: Boolean(process.env.VAANI_API_KEY?.trim()),
    webhookSecretConfigured: Boolean(
      process.env.VAANI_WEBHOOK_SECRET?.trim() && process.env.VAANI_WEBHOOK_SECRET !== "change-me-to-a-long-random-string",
    ),
  };
}

/* ── Signature ─────────────────────────────────────────────────────────── */

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Describes a signature's shape for logs without revealing it. */
function describe(sig: string): string {
  const body = sig.replace(/^sha256=/i, "");
  const enc = /^[0-9a-f]+$/i.test(body) ? "hex" : /^[A-Za-z0-9+/=_-]+$/.test(body) ? "base64-ish" : "other";
  return `${/^sha256=/i.test(sig) ? "sha256= prefix, " : ""}${enc}, ${body.length} chars`;
}

/**
 * HMAC-SHA256 with VAANI_WEBHOOK_SECRET. Vaani uses two header styles:
 *  - Agent webhooks:    X-Webhook-Signature (+ X-Webhook-Event), signed over the raw body
 *  - Campaign webhooks: X-Vaani-Signature: sha256=<hex> + X-Vaani-Timestamp, signed over `${ts}.${body}`
 * Accepts hex or base64 digests, with or without a "sha256=" prefix. Everything requires the secret.
 */
export function verifySignature(rawBody: string, headers: Headers): { ok: boolean; reason?: string } {
  const secret = process.env.VAANI_WEBHOOK_SECRET ?? "";
  if (!vaaniConfig().webhookSecretConfigured) return { ok: false, reason: "VAANI_WEBHOOK_SECRET not set" };

  const signature = (headers.get("x-webhook-signature") ?? headers.get("x-vaani-signature"))?.trim();
  const timestamp = headers.get("x-vaani-timestamp") ?? headers.get("x-webhook-timestamp");
  if (!signature) return { ok: false, reason: "missing signature header" };

  const payloads = [rawBody];
  if (timestamp) {
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return { ok: false, reason: "stale timestamp" };
    payloads.unshift(`${timestamp}.${rawBody}`);
  }
  const stripped = signature.replace(/^sha256=/i, "");
  const provided = /^[0-9a-f]{64}$/i.test(stripped) ? stripped.toLowerCase() : stripped;
  for (const p of payloads) {
    const mac = createHmac("sha256", secret).update(p).digest();
    for (const candidate of [mac.toString("hex"), mac.toString("base64"), mac.toString("base64url")]) {
      if (safeEqual(candidate, provided)) return { ok: true };
    }
  }
  return { ok: false, reason: `signature mismatch (received ${describe(signature)}; timestamp header: ${timestamp ? "yes" : "no"})` };
}

/* ── Event payloads ───────────────────────────────────────────────────── */

export interface VaaniEvent {
  event?: string;
  room_name?: string;
  call_id?: string;
  phone_number?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  data?: VaaniPostprocessing;
}

export interface VaaniPostprocessing {
  room_name?: string;
  call_id: string;
  call_type?: string;
  /** Caller's number on inbound phone calls (absent / non-numeric for browser test calls). */
  phone_number?: string;
  call_started_at?: string;
  call_ended_at?: string;
  /** Unit is inconsistent between docs and live payloads — prefer the start/end timestamps. */
  call_duration?: number;
  end_reason?: string;
  summary?: string;
  entities?: Record<string, unknown>;
  dispositions?: Record<string, unknown>;
  recording_url?: string;
  transcript?: string;
}

/** call_started arrives first with the caller's number; remember it until post-processing lands. */
const globalForVaani = globalThis as unknown as { __vaaniStarts?: Map<string, { phone?: string; at: string }> };
const starts = (globalForVaani.__vaaniStarts ??= new Map());

export function rememberStart(e: VaaniEvent): void {
  const d = (e.data ?? {}) as Partial<VaaniEvent>;
  const room = e.room_name ?? d.room_name ?? e.call_id ?? d.call_id;
  if (!room) return;
  starts.set(room, { phone: e.phone_number ?? d.phone_number, at: new Date().toISOString() });
}

/* ── Normalisation ────────────────────────────────────────────────────── */

const QUALIFICATIONS: Qualification[] = ["Qualified", "Nurture", "Out of Scope", "Escalation"];
const CRITERIA: [CriterionKey, string][] = [
  ["realProject", "crit_real_project"],
  ["serviceArea", "crit_service_area"],
  ["timeline", "crit_timeline"],
  ["budget", "crit_budget"],
  ["decisionMaker", "crit_decision_maker"],
];

/** Case-insensitive lookup; treats "", "null", "N/A" as missing. */
function pick(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!obj) return undefined;
  const hit = Object.entries(obj).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
  if (hit === null || hit === undefined) return undefined;
  const s = String(hit).trim();
  return s === "" || /^(null|none|n\/a|na|not mentioned)$/i.test(s) ? undefined : s;
}

function num(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** ISO-ish timestamp → ms. Vaani omits the zone on some fields; those are UTC. */
function parseTime(s: string | undefined | null): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? t : undefined;
}

function inr(n: number): string {
  return n >= 100000 ? `₹${+(n / 100000).toFixed(1)}L` : `₹${n.toLocaleString("en-IN")}`;
}

function parseCriterion(v: string | undefined): CriterionResult {
  const m = v?.match(/^\s*(pass|fail|unclear)\s*[:\-–—]?\s*(.*)$/i);
  if (!m) return { status: "unclear", note: v ?? "Not assessed" };
  return { status: m[1].toLowerCase() as CriterionStatus, note: m[2] || m[1] };
}

/** "[13:33:14] AGENT: Hi…\n\n[13:33:19] USER: …" → items with offsets from the first line. */
export function parseTranscript(raw: string | undefined, durationSec: number, callId: string): TranscriptItem[] {
  if (!raw) return [];
  const lines = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(?:\[(\d{1,2}):(\d{2}):(\d{2})\]\s*)?(AGENT|USER|ASSISTANT|CALLER)\s*:\s*(.*)$/i);
      if (!m) return null;
      const clock = m[1] ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined;
      const speaker: Speaker = /agent|assistant/i.test(m[4]) ? "agent" : "caller";
      return { speaker, text: m[5], clock };
    })
    .filter((l): l is { speaker: Speaker; text: string; clock: number | undefined } => Boolean(l && l.text));

  const hasClock = lines.length > 0 && lines.every((l) => l.clock !== undefined);
  const timed = hasClock
    ? lines.map((l) => ({ ...l, time: ((l.clock as number) - (lines[0].clock as number) + 86400) % 86400 }))
    : estimateTimes(lines, durationSec);

  return timed.map((l, i) => ({ id: `${callId}-${i + 1}`, speaker: l.speaker, text: l.text, time: l.time }));
}

export function normalize(e: VaaniEvent): CallLead | null {
  // Docs nest the report under `data`; accept it at the top level too.
  const d = { ...(e as unknown as VaaniPostprocessing), ...(e.data ?? {}) } as VaaniPostprocessing;
  d.call_id ??= d.room_name ?? e.call_id ?? e.room_name ?? "";
  if (!d.call_id || (!d.transcript && !d.summary)) return null;

  const ent = d.entities;
  const dis = d.dispositions;
  // Free-text checks live in extraction (entities); tag-style ones in dispositions. Read either.
  const both = { ...(ent ?? {}), ...(dis ?? {}) };
  const start = starts.get(d.room_name ?? d.call_id);

  // Start time: Vaani's call_started_at, else the epoch embedded in ids like "webrtc-1791622479-…".
  const idEpoch = d.call_id.match(/-(\d{10})-/)?.[1];
  const startedMs =
    parseTime(d.call_started_at) ?? (idEpoch ? Number(idEpoch) * 1000 : undefined) ?? parseTime(start?.at);
  const endedMs = parseTime(d.call_ended_at);
  const transcriptPreview = parseTranscript(d.transcript, 60, d.call_id);
  const lastLine = transcriptPreview.at(-1)?.time ?? 0;
  const durationSec = Math.max(
    1,
    startedMs && endedMs && endedMs > startedMs ? Math.round((endedMs - startedMs) / 1000) : lastLine + 5,
  );
  const receivedAt = new Date(
    startedMs ?? new Date(e.timestamp ?? Date.now()).getTime() - durationSec * 1000,
  ).toISOString();
  const phoneCandidate = d.phone_number ?? start?.phone ?? e.from;
  const phone = phoneCandidate && /^\+?\d[\d\s-]{7,16}$/.test(phoneCandidate) ? phoneCandidate : null;

  const qualRaw = pick(both, "qualification");
  const qualification = QUALIFICATIONS.find((q) => q.toLowerCase() === qualRaw?.toLowerCase()) ?? "Nurture";

  const carpetSqft = num(pick(ent, "carpet_area_sqft"));
  const bMin = num(pick(ent, "budget_min_inr"));
  const bMax = num(pick(ent, "budget_max_inr")) ?? bMin;
  const budgetInr: [number, number] | undefined = bMin && bMax ? [bMin, bMax] : undefined;
  const callback = pick(ent, "callback_needed");
  const emailRaw = pick(ent, "caller_email")?.toLowerCase().replace(/\s+/g, "");
  const email = emailRaw && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(emailRaw) ? emailRaw : null;
  const bookingRaw = pick(ent, "booking_status")?.toLowerCase();
  const bookingStatus = bookingRaw === "booked" || bookingRaw === "not booked" ? bookingRaw : "not offered";
  const bookingAt = bookingStatus === "booked" ? pick(ent, "booking_time") : undefined;
  const pricingQuoted = /^(yes|true)$/i.test(pick(both, "pricing_quoted") ?? "");

  const flags = [
    ...(callback ? [callback] : []),
    ...(pricingQuoted ? ["Vaani flagged a quoted figure"] : []),
  ];

  return {
    id: `V-${d.call_id}`,
    reference: d.call_id,
    callerName: pick(ent, "caller_name") ?? null,
    phone,
    email,
    booking: { status: bookingStatus, at: bookingAt },
    receivedAt,
    durationSec,
    handledBy: "Vaani",
    source: pick(ent, "lead_source"),
    qualification,
    qualificationReason: pick(both, "qualification_reason") ?? (qualRaw ? qualRaw : "Not classified by Vaani"),
    flags,
    assignedDesignerId: null,
    recordingUrl: d.recording_url ? `/api/recording/${encodeURIComponent(d.call_id)}` : undefined,
    dossier: {
      segment: pick(ent, "segment")?.toLowerCase() === "commercial" ? "commercial" : "residential",
      propertyScope: { value: pick(ent, "property_type") ?? "Not captured", note: pick(ent, "project_scope") },
      carpetArea: { value: carpetSqft ? `${carpetSqft.toLocaleString("en-IN")} sq.ft.` : "Not stated" },
      budget: {
        value: budgetInr ? (budgetInr[0] === budgetInr[1] ? inr(budgetInr[0]) : `${inr(budgetInr[0])} – ${inr(budgetInr[1])}`) : "Not mentioned",
        note: budgetInr ? "Volunteered by caller" : undefined,
      },
      location: { value: pick(ent, "site_location") ?? "Not stated", note: pick(ent, "location_detail") },
      timeline: { value: pick(ent, "timeline") ?? "Not stated", note: pick(ent, "site_state") },
      carpetSqft,
      budgetInr,
      summary: d.summary ?? "Summary pending.",
      knownContext: (pick(ent, "known_context") ?? "")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean)
        .concat(pick(ent, "decision_maker") ? [`Decision: ${pick(ent, "decision_maker")}`] : [])
        .slice(0, 6),
    },
    criteria: Object.fromEntries(CRITERIA.map(([k, field]) => [k, parseCriterion(pick(both, field))])) as Record<
      CriterionKey,
      CriterionResult
    >,
    transcript: parseTranscript(d.transcript, durationSec, d.call_id),
  };
}
