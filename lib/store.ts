import "server-only";
import { SEED_CALLS } from "./seed";
import type { CallLead, HubSpotSync } from "./types";

/**
 * Call store.
 * - With SUPABASE_URL + SUPABASE_SECRET_KEY: rows in public.calls (see supabase/schema.sql), so
 *   every server instance (e.g. on Vercel) sees the same calls and nothing is lost on restart.
 * - Without them: in-memory (local development only).
 * The Sept 2026 seed calls come from code and are only listed when SHOW_SEED_CALLS=true; a stored
 * row with the same id (designer assignment, HubSpot sync) overrides the seed copy.
 */

const SEED = new Map(SEED_CALLS.map((c) => [c.id, c]));

function supabase() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  return url && key ? { url, key } : null;
}

export function storageMode(): "supabase" | "memory" {
  return supabase() ? "supabase" : "memory";
}

async function sb<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = supabase()!;
  const headers: Record<string, string> = {
    apikey: cfg.key,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys go in apikey only.
  if (cfg.key.startsWith("eyJ")) headers.Authorization = `Bearer ${cfg.key}`;
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, { ...init, headers, cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  // Writes with Prefer: return=minimal come back 201 with an empty body.
  return (text ? JSON.parse(text) : undefined) as T;
}

/* ── In-memory fallback ────────────────────────────────────────────────── */

const globalForStore = globalThis as unknown as { __aanganCalls?: Map<string, CallLead> };
function memory(): Map<string, CallLead> {
  globalForStore.__aanganCalls ??= new Map(SEED_CALLS.map((c) => [c.id, structuredClone(c)]));
  return globalForStore.__aanganCalls;
}

/* ── API ───────────────────────────────────────────────────────────────── */

/** The Sept 2026 example calls are hidden unless SHOW_SEED_CALLS=true (e.g. for a demo). */
function showSeed(): boolean {
  return process.env.SHOW_SEED_CALLS === "true";
}

export async function listCalls(): Promise<CallLead[]> {
  let calls: CallLead[];
  if (supabase()) {
    const rows = await sb<{ data: CallLead }[]>("calls?select=data&order=received_at.desc&limit=500");
    const merged = new Map(showSeed() ? SEED : []);
    for (const r of rows) if (showSeed() || !SEED.has(r.data.id)) merged.set(r.data.id, r.data);
    calls = [...merged.values()];
  } else {
    calls = [...memory().values()].filter((c) => showSeed() || !SEED.has(c.id));
  }
  return calls.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export async function getCall(id: string): Promise<CallLead | undefined> {
  if (supabase()) {
    const rows = await sb<{ data: CallLead }[]>(`calls?select=data&id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0]?.data ?? (SEED.has(id) ? structuredClone(SEED.get(id)!) : undefined);
  }
  return memory().get(id);
}

export async function upsertCall(call: CallLead): Promise<void> {
  if (supabase()) {
    await sb("calls?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: call.id, received_at: call.receivedAt, data: call, updated_at: new Date().toISOString() }),
    });
    return;
  }
  memory().set(call.id, call);
}

export async function assignDesigner(id: string, designerId: string): Promise<CallLead | undefined> {
  const call = await getCall(id);
  if (!call) return undefined;
  call.assignedDesignerId = designerId;
  await upsertCall(call);
  return call;
}

export async function recordHubSpot(id: string, sync: HubSpotSync): Promise<void> {
  const call = await getCall(id);
  if (!call) return;
  call.hubspot = sync;
  await upsertCall(call);
}
