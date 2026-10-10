export type Qualification = "Qualified" | "Nurture" | "Out of Scope" | "Escalation" | "Missed";
export type Speaker = "agent" | "caller";
export type Segment = "residential" | "commercial";

/** Who answered the call: the live Vaani agent, or the human front desk (Sept 2026 baseline). */
export type Handler = "Vaani" | "Front Desk";

export interface TranscriptItem {
  id: string;
  speaker: Speaker;
  /** Offset from call start, in seconds. */
  time: number;
  text: string;
  /** Dossier fields extracted from this utterance. */
  extracted?: string[];
}

export interface DossierEntity {
  value: string;
  note?: string;
}

export interface LeadDossier {
  segment: Segment;
  propertyScope: DossierEntity;
  carpetArea: DossierEntity;
  budget: DossierEntity;
  location: DossierEntity;
  timeline: DossierEntity;
  /** Numeric helpers for CRM sync — never shown to callers. */
  carpetSqft?: number;
  budgetInr?: [number, number];
  summary: string;
  /** Facts already captured on the call — designers shouldn't re-ask these. */
  knownContext: string[];
}

/** Nikhil's five-criteria rubric (qualified.md). */
export type CriterionKey = "realProject" | "serviceArea" | "timeline" | "budget" | "decisionMaker";
export type CriterionStatus = "pass" | "fail" | "unclear";
export interface CriterionResult {
  status: CriterionStatus;
  note: string;
}

export interface PricingGuardrail {
  /** Caller asked about cost / rates / ballpark. */
  triggered: boolean;
  /** The agent's reply contained a figure, range or "rates start at" — a policy breach. */
  breached: boolean;
  time?: number;
  callerAsk?: string;
  agentResponse?: string;
}

export interface HubSpotSync {
  status: "synced" | "failed";
  at: string;
  dealId?: string;
  contactId?: string;
  dealUrl?: string;
  stage?: string;
  amount?: number;
  amountIsIndicative?: boolean;
  error?: string;
}

export interface CallBooking {
  status: "booked" | "not booked" | "not offered";
  /** Confirmed start (ISO). */
  at?: string;
  /** Caller's preferred start as captured on the call (ISO, IST). */
  requested?: string;
  /** Cal.com booking uid. */
  uid?: string;
  source?: "console" | "vaani";
  note?: string;
  error?: string;
}

export interface CallLead {
  id: string;
  reference: string;
  callerName: string | null;
  /** null when withheld / redacted. */
  phone: string | null;
  /** Confirmed on the call; used for the Cal.com invite and the HubSpot contact. */
  email?: string | null;
  /** 15-min discovery call in Cal.com (booked by the console after the call, or by the agent). */
  booking?: CallBooking;
  receivedAt: string;
  durationSec: number;
  handledBy: Handler;
  /** How the caller found the studio, when they said so. */
  source?: string;
  qualification: Qualification;
  qualificationReason: string;
  /** Operational call-outs for the front desk, e.g. "Handle with care". */
  flags: string[];
  assignedDesignerId: string | null;
  recordingUrl?: string;
  dossier: LeadDossier;
  criteria: Record<CriterionKey, CriterionResult>;
  transcript: TranscriptItem[];
  hubspot?: HubSpotSync;
}

/* ── What the browser receives ─────────────────────────────────────────── */

export type OutputKey = "dashboard" | "hubspot" | "email" | "calendar";
export type OutputStatus = "delivered" | "syncing" | "pending" | "not-connected" | "skipped" | "failed";

export interface OutputMeta {
  label: string;
  value: string;
}

export interface AutomationOutput {
  key: OutputKey;
  status: OutputStatus;
  detail: string;
  at?: string;
  meta?: OutputMeta[];
  link?: string;
}

export interface CallView extends CallLead {
  afterHours: boolean;
  guardrail: PricingGuardrail;
  outputs: AutomationOutput[];
}

export interface Designer {
  id: string;
  name: string;
  specialty: string;
}

export interface IntegrationStatus {
  hubspot: { connected: boolean };
  vaani: { apiKeyConfigured: boolean; webhookSecretConfigured: boolean };
}

export interface CallsResponse {
  calls: CallView[];
  designers: Designer[];
  integrations: IntegrationStatus;
}
