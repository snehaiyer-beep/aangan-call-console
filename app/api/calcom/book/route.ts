import { NextResponse } from "next/server";
import { bookDiscoveryCall, calcomConfigured } from "@/lib/calcom";
import { hubspotConfigured, pushToHubSpot } from "@/lib/hubspot";
import { integrationStatus } from "@/lib/integrations";
import { getCall, recordHubSpot, upsertCall } from "@/lib/store";
import { toView } from "@/lib/view";

/** POST { callId } — front desk books the 15-min discovery call for an existing lead. */
export async function POST(req: Request) {
  if (!calcomConfigured()) return NextResponse.json({ error: "Cal.com is not connected" }, { status: 400 });
  const { callId } = (await req.json().catch(() => ({}))) as { callId?: string };
  const call = callId ? await getCall(callId) : undefined;
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });
  if (!call.email) return NextResponse.json({ error: "No email on this call — Cal.com needs one for the invite" }, { status: 400 });
  if (call.qualification !== "Qualified") {
    return NextResponse.json({ error: "Only qualified leads get a discovery call" }, { status: 400 });
  }

  const booking = await bookDiscoveryCall(call);
  if (booking) call.booking = booking;
  await upsertCall(call);
  if (booking?.status === "booked" && call.hubspot?.status === "synced" && hubspotConfigured()) {
    await recordHubSpot(call.id, await pushToHubSpot(call));
  }

  const fresh = (await getCall(call.id)) ?? call;
  return NextResponse.json({ call: toView(fresh, integrationStatus()), booked: booking?.status === "booked", error: booking?.error });
}
