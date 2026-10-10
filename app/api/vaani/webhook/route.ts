import { NextResponse } from "next/server";
import { hubspotConfigured, pushToHubSpot, SYNCABLE } from "@/lib/hubspot";
import { bookDiscoveryCall, calcomConfigured } from "@/lib/calcom";
import { getCall, recordHubSpot, upsertCall } from "@/lib/store";
import { normalize, rememberStart, verifySignature, type VaaniEvent } from "@/lib/vaani";

/** Field names and types only (never values), for logs. */
function shape(v: unknown, depth = 0): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.length ? shape(v[0], depth + 1) : ""}]`;
  if (typeof v !== "object") return typeof v;
  if (depth > 2) return "{…}";
  return `{${Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => `${k}:${shape(x, depth + 1)}`)
    .join(",")}}`;
}

/** Vaani agent webhook — see lib/vaani.ts and https://docs.vaanivoice.ai/guides/webhook-setup */
export async function POST(req: Request) {
  const raw = await req.text();

  const check = verifySignature(raw, req.headers);
  if (!check.ok) {
    // Header names only (never values) to help diagnose the dashboard's "Test Connectivity".
    const names = [...req.headers.keys()].filter((h) => h.startsWith("x-")).join(", ");
    console.warn(`[vaani] rejected webhook: ${check.reason}. x-headers: ${names || "none"}`);    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: VaaniEvent;
  try {
    event = JSON.parse(raw) as VaaniEvent;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  event.event ??= req.headers.get("x-webhook-event") ?? undefined;
  console.info(`[vaani] ${event.event ?? "unknown"} ${event.call_id ?? event.room_name ?? ""} shape=${shape(event)}`);

  switch (event.event) {
    case "call_started":
      rememberStart(event);
      break;

    case "call_postprocessing": {
      const call = normalize(event);
      if (!call) {
        // Unrecognised report shape: keep it so it can be imported once mapped. Local dev writes to
        // gitignored .tools/; on Vercel (read-only disk) it is only logged.
        let saved = false;
        try {
          const { mkdir, writeFile } = await import("node:fs/promises");
          await mkdir(".tools/unparsed", { recursive: true });
          await writeFile(`.tools/unparsed/${Date.now()}.json`, raw);
          saved = true;
        } catch {
          console.warn(`[vaani] unrecognised call_postprocessing (shape=${shape(event)})`);
        }
        return NextResponse.json({ ok: false, saved });
      }
      // Test calls (call_id "test-…", see scripts/send-test-webhook.mjs) stay out of Cal.com and HubSpot.
      const isTest = call.reference.startsWith("test-");

      // Keep an existing booking if Vaani re-sends the same call, so it is never booked twice.
      const previous = await getCall(call.id);
      if (previous?.booking?.uid) call.booking = previous.booking;

      // Book the 15-min discovery call in Cal.com for qualified callers who gave an email.
      if (!isTest && call.booking?.status !== "booked" && calcomConfigured()) {
        const booking = await bookDiscoveryCall(call);
        if (booking) call.booking = booking;
      }
      await upsertCall(call);

      // Live leads go straight to the CRM — no one has to remember to push them.
      if (!isTest && hubspotConfigured() && SYNCABLE.includes(call.qualification)) {
        await recordHubSpot(call.id, await pushToHubSpot(call));
      }
      return NextResponse.json({ ok: true, id: call.id });
    }

    default:
      // Lifecycle events (ringing, ended, transfers…) and connectivity tests: acknowledge.
      break;
  }
  return NextResponse.json({ ok: true });
}
