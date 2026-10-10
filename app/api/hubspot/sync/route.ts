import { NextResponse } from "next/server";
import { hubspotConfigured, pushToHubSpot, SYNCABLE } from "@/lib/hubspot";
import { integrationStatus } from "@/lib/integrations";
import { getCall, listCalls, recordHubSpot } from "@/lib/store";
import type { CallLead } from "@/lib/types";
import { toView } from "@/lib/view";

/** POST { callId } to push one lead, or { all: true } to backfill every eligible lead that isn't synced yet. */
export async function POST(req: Request) {
  if (!hubspotConfigured()) {
    return NextResponse.json({ error: "HubSpot is not connected — set HUBSPOT_ACCESS_TOKEN in .env.local" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { callId?: string; all?: boolean };

  let targets: CallLead[];
  if (body.all) {
    targets = (await listCalls()).filter((c) => SYNCABLE.includes(c.qualification) && c.hubspot?.status !== "synced");
  } else {
    const call = body.callId ? await getCall(body.callId) : undefined;
    if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });
    targets = [call];
  }

  // Sequential on purpose: stays well under HubSpot's per-second rate limit.
  for (const call of targets) await recordHubSpot(call.id, await pushToHubSpot(call));

  const integrations = integrationStatus();
  const calls = await Promise.all(targets.map(async (c) => toView((await getCall(c.id)) as CallLead, integrations)));
  return NextResponse.json({
    synced: calls.filter((c) => c.hubspot?.status === "synced").length,
    failed: calls.filter((c) => c.hubspot?.status === "failed").length,
    calls,
  });
}
