import { NextResponse } from "next/server";
import { designerById } from "@/lib/designers";
import { integrationStatus } from "@/lib/integrations";
import { pushToHubSpot } from "@/lib/hubspot";
import { assignDesigner, recordHubSpot } from "@/lib/store";
import { toView } from "@/lib/view";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { designerId } = (await req.json().catch(() => ({}))) as { designerId?: string };
  if (!designerById(designerId)) {
    return NextResponse.json({ error: "Unknown designer" }, { status: 400 });
  }
  const call = await assignDesigner(id, designerId as string);
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });

  // Keep the CRM deal notes in step with the new designer if the lead was already pushed.
  if (call.hubspot?.status === "synced") {
    call.hubspot = await pushToHubSpot(call);
    await recordHubSpot(call.id, call.hubspot);
  }

  return NextResponse.json({ call: toView(call, integrationStatus()) });
}
