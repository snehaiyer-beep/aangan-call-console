import "server-only";
import { designerById } from "./designers";
import { formatDay, formatINR, formatTime } from "./format";
import { SYNCABLE } from "./hubspot";
import { detectGuardrail, isAfterHours } from "./policy";
import type { AutomationOutput, CallLead, CallView, IntegrationStatus } from "./types";

const STAGE_LABEL: Record<string, string> = {
  appointmentscheduled: "Appointment scheduled",
  qualifiedtobuy: "Qualified to buy",
  presentationscheduled: "Presentation scheduled",
  closedlost: "Closed lost",
  closedwon: "Closed won",
};

const stamp = (iso: string) => `${formatDay(iso)} · ${formatTime(iso)}`;

function hubspotOutput(call: CallLead, connected: boolean): AutomationOutput {
  if (!SYNCABLE.includes(call.qualification)) {
    return { key: "hubspot", status: "skipped", detail: "Not a new enquiry — no deal created" };
  }
  if (!connected) {
    return { key: "hubspot", status: "not-connected", detail: "Add a HubSpot access token to push this lead" };
  }
  const s = call.hubspot;
  if (!s) return { key: "hubspot", status: "pending", detail: "Ready to push contact + deal" };
  if (s.status === "failed") return { key: "hubspot", status: "failed", detail: s.error ?? "Push failed", at: stamp(s.at) };

  const designer = designerById(call.assignedDesignerId)?.name ?? "Unassigned";
  return {
    key: "hubspot",
    status: "delivered",
    detail: "Deal synced with dossier summary & 5-criteria notes",
    at: stamp(s.at),
    link: s.dealUrl,
    meta: [
      { label: "Deal stage", value: STAGE_LABEL[s.stage ?? ""] ?? s.stage ?? "—" },
      {
        label: s.amountIsIndicative ? "Pipeline (indicative)" : "Pipeline value",
        value: s.amount !== undefined ? formatINR(s.amount) : "—",
      },
      { label: "Designer", value: designer },
      { label: "Source", value: call.source?.split(" · ")[0] ?? "Not stated" },
    ],
  };
}

function emailOutput(call: CallLead): AutomationOutput {
  if (call.qualification === "Out of Scope" || call.qualification === "Missed") {
    return { key: "email", status: "skipped", detail: "Not routed to a designer" };
  }
  if (call.qualification === "Escalation") {
    return { key: "email", status: "skipped", detail: "Escalated to studio head — no briefing needed" };
  }
  const designer = designerById(call.assignedDesignerId);
  if (!designer) return { key: "email", status: "pending", detail: "Assign a designer to route the briefing dossier" };
  return { key: "email", status: "not-connected", detail: `Briefing for ${designer.name} is ready — designer email not set up yet` };
}

/** "2026-10-11T18:00:00+05:30" → "Sat 11 Oct · 6:00 PM IST"; falls back to the raw text. */
function bookingLabel(at: string | undefined): string | undefined {
  if (!at) return undefined;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return at;
  const d = new Date(t);
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" }).format(d);
  return `${day} · ${formatTime(d.toISOString())} IST`;
}

function calendarOutput(call: CallLead): AutomationOutput {
  if (call.qualification === "Nurture") {
    return { key: "calendar", status: "pending", detail: "Re-engage when the timeline opens up — no hold yet" };
  }
  if (call.qualification !== "Qualified") {
    return { key: "calendar", status: "skipped", detail: "No discovery call needed" };
  }
  const b = call.booking;
  if (b?.status === "booked") {
    return {
      key: "calendar",
      status: "delivered",
      detail: `Booked on Cal.com by Vaani · ${bookingLabel(b.at) ?? "time confirmed on the call"}`,
      meta: [
        { label: "Meeting", value: "15-min discovery call" },
        { label: "Invite sent to", value: call.email ?? "email not captured" },
      ],
    };
  }
  if (call.handledBy !== "Vaani") {
    return { key: "calendar", status: "pending", detail: "Book a 15-min discovery call — taken by the front desk before Cal.com" };
  }
  return {
    key: "calendar",
    status: "pending",
    detail:
      b?.status === "not booked"
        ? "Offered on the call but not booked — email the caller two slots"
        : "No slot booked on the call — book a 15-min discovery call",
  };
}

export function toView(call: CallLead, integrations: IntegrationStatus): CallView {
  return {
    ...call,
    afterHours: isAfterHours(call.receivedAt),
    guardrail: detectGuardrail(call.transcript),
    outputs: [
      { key: "dashboard", status: "delivered", detail: "Live on the Front Desk & Designer console", at: stamp(call.receivedAt) },
      hubspotOutput(call, integrations.hubspot.connected),
      emailOutput(call),
      calendarOutput(call),
    ],
  };
}
