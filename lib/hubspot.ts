import "server-only";
import { designerById } from "./designers";
import { isAfterHours } from "./policy";
import type { CallLead, CriterionKey, HubSpotSync, Qualification } from "./types";

/**
 * HubSpot CRM push via a Private App access token (HUBSPOT_ACCESS_TOKEN).
 * Required scopes: crm.objects.contacts.read/write, crm.objects.deals.read/write.
 * Idempotent: re-pushing a call updates the same deal (matched by deal name).
 */

const API = "https://api.hubapi.com";

export const SYNCABLE: Qualification[] = ["Qualified", "Nurture", "Out of Scope"];

/** Indicative internal rates (pricing.md, lowest band). For pipeline value only — never quoted to clients. */
const INDICATIVE_RATE_PER_SQFT = { residential: 1800, commercial: 1200 } as const;

const CRITERIA_LABEL: Record<CriterionKey, string> = {
  realProject: "Real project",
  serviceArea: "Service area",
  timeline: "Timeline",
  budget: "Budget",
  decisionMaker: "Decision-maker",
};

export function hubspotConfigured(): boolean {
  return Boolean(process.env.HUBSPOT_ACCESS_TOKEN?.trim());
}

function stageFor(q: Qualification): string {
  if (q === "Qualified") return process.env.HUBSPOT_STAGE_QUALIFIED || "appointmentscheduled";
  if (q === "Nurture") return process.env.HUBSPOT_STAGE_NURTURE || "qualifiedtobuy";
  return process.env.HUBSPOT_STAGE_OUT_OF_SCOPE || "closedlost";
}

export function dealAmount(call: CallLead): { amount?: number; indicative: boolean } {
  if (call.qualification === "Out of Scope") return { amount: 0, indicative: false };
  const { budgetInr, carpetSqft, segment } = call.dossier;
  if (budgetInr) return { amount: Math.round((budgetInr[0] + budgetInr[1]) / 2), indicative: false };
  if (carpetSqft) return { amount: carpetSqft * INDICATIVE_RATE_PER_SQFT[segment], indicative: true };
  return { indicative: false };
}

class HubSpotError extends Error {}

async function hs<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    if (res.status === 401) throw new HubSpotError("HubSpot rejected the access token — check HUBSPOT_ACCESS_TOKEN");
    if (res.status === 403) throw new HubSpotError("HubSpot token is missing a CRM scope — see README → Connect HubSpot");
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new HubSpotError(`HubSpot ${res.status}: ${body.message ?? res.statusText}`);
  }
  return (await res.json()) as T;
}

let portalCache: { portalId: number; uiDomain: string } | null = null;
/** Only used to build the "Open deal" link; some service keys can't read account info, so failure is non-fatal. */
async function portal() {
  if (!portalCache) {
    portalCache = await hs<{ portalId: number; uiDomain: string }>("/account-info/v3/details").catch(() => null);
  }
  return portalCache;
}

let stageLabelCache: Record<string, string> | null = null;
/** Stage IDs → names (e.g. "4416290495" → "Lead Captured"). Non-fatal: falls back to the raw ID. */
async function stageLabel(stageId: string): Promise<string> {
  if (!stageLabelCache) {
    const r = await hs<{ results: { stages: { id: string; label: string }[] }[] }>("/crm/v3/pipelines/deals").catch(() => null);
    stageLabelCache = Object.fromEntries((r?.results ?? []).flatMap((p) => p.stages.map((s) => [s.id, s.label])));
  }
  return stageLabelCache[stageId] ?? stageId;
}

interface SearchResult {
  total: number;
  results: { id: string }[];
}

async function findOne(object: "contacts" | "deals", filters: { propertyName: string; operator: "EQ"; value: string }[]) {
  const r = await hs<SearchResult>(`/crm/v3/objects/${object}/search`, {
    method: "POST",
    body: JSON.stringify({ filterGroups: [{ filters }], limit: 1 }),
  });
  return r.results[0]?.id;
}

async function upsertContact(call: CallLead): Promise<string | undefined> {
  if (!call.callerName && !call.phone && !call.email) return undefined; // nothing to identify them by
  const [firstname, ...rest] = (call.callerName ?? "").split(" ");
  const lastname = rest.join(" ");
  const props: Record<string, string> = {};
  if (firstname) props.firstname = firstname;
  if (lastname) props.lastname = lastname;
  if (call.phone) props.phone = call.phone;
  if (call.email) props.email = call.email;

  // Match the most reliable identifier first, falling through so a contact created
  // before we knew their email isn't duplicated when the email turns up.
  const existing =
    (call.email && (await findOne("contacts", [{ propertyName: "email", operator: "EQ", value: call.email }]))) ||
    (call.phone && (await findOne("contacts", [{ propertyName: "phone", operator: "EQ", value: call.phone }]))) ||
    (firstname &&
      (await findOne("contacts", [
        { propertyName: "firstname", operator: "EQ", value: firstname },
        ...(lastname ? [{ propertyName: "lastname", operator: "EQ" as const, value: lastname }] : []),
      ]))) ||
    undefined;
  if (existing) {
    await hs(`/crm/v3/objects/contacts/${existing}`, { method: "PATCH", body: JSON.stringify({ properties: props }) });
    return existing;
  }
  const created = await hs<{ id: string }>("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties: props }),
  });
  return created.id;
}

function dealName(call: CallLead): string {
  const who = call.callerName ?? "Unnamed caller";
  return `${who} · ${call.dossier.propertyScope.value} · ${call.dossier.location.value} (${call.reference})`;
}

function dealDescription(call: CallLead, indicative: boolean): string {
  const designer = designerById(call.assignedDesignerId)?.name ?? "Unassigned";
  const criteria = (Object.keys(CRITERIA_LABEL) as CriterionKey[])
    .map((k) => `• ${CRITERIA_LABEL[k]}: ${call.criteria[k].status.toUpperCase()} — ${call.criteria[k].note}`)
    .join("\n");
  return [
    call.dossier.summary,
    "",
    `Qualification: ${call.qualification} — ${call.qualificationReason}`,
    criteria,
    "",
    `Handled by: ${call.handledBy}${isAfterHours(call.receivedAt) ? " · after hours" : ""} · ${call.receivedAt}`,
    `Source: ${call.source ?? "Not stated"} · Designer: ${designer}`,
    call.booking?.status === "booked"
      ? `Discovery call booked on Cal.com: ${call.booking.at ? new Date(call.booking.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " IST" : "time confirmed on the call"}${call.email ? ` (invite to ${call.email})` : ""}`
      : "",
    indicative ? "Amount is an internal indicative estimate (carpet area × lowest band) — not a client quote." : "",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
}

export async function pushToHubSpot(call: CallLead): Promise<HubSpotSync> {
  const at = new Date().toISOString();
  if (!hubspotConfigured()) return { status: "failed", at, error: "HubSpot is not connected" };
  if (!SYNCABLE.includes(call.qualification)) {
    return { status: "failed", at, error: `${call.qualification} calls are not pushed as deals` };
  }

  try {
    const { amount, indicative } = dealAmount(call);
    const stage = stageFor(call.qualification);
    const properties: Record<string, string> = {
      dealname: dealName(call),
      pipeline: process.env.HUBSPOT_PIPELINE_ID || "default",
      dealstage: stage,
      description: dealDescription(call, indicative),
    };
    if (amount !== undefined) properties.amount = String(amount);
    if (call.qualification === "Out of Scope") properties.closed_lost_reason = call.qualificationReason;

    const contactId = await upsertContact(call);
    const existingDeal = await findOne("deals", [{ propertyName: "dealname", operator: "EQ", value: properties.dealname }]);

    let dealId: string;
    if (existingDeal) {
      await hs(`/crm/v3/objects/deals/${existingDeal}`, { method: "PATCH", body: JSON.stringify({ properties }) });
      dealId = existingDeal;
    } else {
      const created = await hs<{ id: string }>("/crm/v3/objects/deals", {
        method: "POST",
        body: JSON.stringify({
          properties,
          associations: contactId
            ? [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }]
            : [],
        }),
      });
      dealId = created.id;
    }

    const account = await portal();
    return {
      status: "synced",
      at,
      dealId,
      contactId,
      stage: await stageLabel(stage),
      amount,
      amountIsIndicative: indicative,
      dealUrl: account ? `https://${account.uiDomain}/contacts/${account.portalId}/record/0-3/${dealId}` : undefined,
    };
  } catch (err) {
    return { status: "failed", at, error: err instanceof Error ? err.message : String(err) };
  }
}
