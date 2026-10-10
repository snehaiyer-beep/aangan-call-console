import type { PricingGuardrail, TranscriptItem } from "./types";

const IST = "Asia/Kolkata";

export function istHour(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", hourCycle: "h23" }).formatToParts(
    new Date(iso),
  );
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
}

/** Front desk hours are 10am–7pm IST. */
export function isAfterHours(iso: string): boolean {
  const h = istHour(iso);
  return h < 10 || h >= 19;
}

/* ── "The Cut": pricing guardrail (pricing.md) ──────────────────────────── */

const PRICING_ASK = /\b(cost|costs|price|pricing|rates?|ballpark|how much|charge|per\s*(sq|square))\b/i;

/** Anything that sounds like a quoted figure or rate. Echoing the caller's own budget is not a breach. */
const PRICING_BREACH = [
  /(₹\s?[\d,.]+|\b\d[\d,.]*\s?(k|lakh|lakhs|rupees|rs\.?))\s*(per|\/|a)\s*(sq|square)/i,
  /\b(rates?\s+start|starts?\s+at|cost\s+around|it'?ll\s+cost|typically\s+(costs?|₹|runs?))/i,
  /per\s*(sq|square)\s*(ft|feet|foot)?\s*(is|=|would be|comes to)\s*(₹|\d)/i,
];

/** The only approved reply to a pricing question (pricing.md). */
export const APPROVED_PRICING_REPLY =
  "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation. I can book that for you right now if you'd like.";

export function detectGuardrail(transcript: TranscriptItem[]): PricingGuardrail {
  const askIndex = transcript.findIndex((t) => t.speaker === "caller" && PRICING_ASK.test(t.text));
  if (askIndex === -1) return { triggered: false, breached: false };

  const replies = transcript.slice(askIndex + 1).filter((t) => t.speaker === "agent");
  const firstReply = replies[0];
  const breachLine = replies.find((r) => PRICING_BREACH.some((re) => re.test(r.text)));
  const shown = breachLine ?? firstReply;

  return {
    triggered: true,
    breached: Boolean(breachLine),
    time: shown?.time,
    callerAsk: transcript[askIndex].text,
    agentResponse: shown?.text,
  };
}

/* ── Transcript timing ─────────────────────────────────────────────────── */

/**
 * Seed transcripts have no per-line timestamps, so spread lines across the call
 * duration in proportion to how long each takes to say.
 */
export function estimateTimes<T extends { text: string }>(lines: T[], durationSec: number): (T & { time: number })[] {
  const weights = lines.map((l) => Math.max(12, l.text.length));
  const total = weights.reduce((a, b) => a + b, 0);
  const usable = durationSec * 0.92;
  let acc = 0;
  return lines.map((l, i) => {
    const time = Math.round((acc / total) * usable);
    acc += weights[i];
    return { ...l, time };
  });
}
