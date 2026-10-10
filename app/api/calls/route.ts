import { NextResponse } from "next/server";
import { DESIGNERS } from "@/lib/designers";
import { integrationStatus } from "@/lib/integrations";
import { listCalls } from "@/lib/store";
import type { CallsResponse } from "@/lib/types";
import { toView } from "@/lib/view";

export const dynamic = "force-dynamic";

export async function GET() {
  const integrations = integrationStatus();
  const body: CallsResponse = {
    calls: (await listCalls()).map((c) => toView(c, integrations)),
    designers: DESIGNERS,
    integrations,
  };
  return NextResponse.json(body);
}
