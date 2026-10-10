import "server-only";
import type { CallLead, CallBooking } from "./types";

/**
 * Books the 15-min discovery call in Cal.com right after a qualified call.
 * The agent collects the caller's email and preferred time; this books the slot
 * (or the nearest free one) and Cal.com emails the invite.
 * Env: CALCOM_API_KEY, CALCOM_EVENT_TYPE_ID.
 */

const API = "https://api.cal.com/v2";
const TZ = "Asia/Kolkata";

export function calcomConfigured(): boolean {
  return Boolean(process.env.CALCOM_API_KEY?.trim() && process.env.CALCOM_EVENT_TYPE_ID?.trim());
}

async function cal<T>(path: string, version: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.CALCOM_API_KEY}`,
      "cal-api-version": version,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { data?: unknown; error?: { message?: string }; message?: string };
  if (!res.ok) throw new Error(`Cal.com ${res.status}: ${body.error?.message ?? body.message ?? res.statusText}`);
  return body.data as T;
}

/** Open slot starts (ISO) between two instants, earliest first. */
async function openSlots(from: Date, to: Date): Promise<string[]> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const data = await cal<Record<string, { start: string }[]>>(
    `/slots?eventTypeId=${process.env.CALCOM_EVENT_TYPE_ID}&start=${day(from)}&end=${day(to)}&timeZone=${TZ}`,
    "2024-09-04",
  );
  return Object.values(data ?? {})
    .flat()
    .map((s) => s.start)
    .filter((s) => Date.parse(s) >= from.getTime())
    .sort((a, b) => Date.parse(a) - Date.parse(b));
}

/**
 * Picks the requested start if it is open; otherwise the first open slot at or after it.
 * With no usable request, the first open slot at least 2 hours from now.
 */
async function chooseSlot(requested: string | undefined): Promise<{ start: string; exact: boolean }> {
  const soonest = Date.now() + 2 * 3600_000;
  const want = requested && Date.parse(requested) > soonest ? new Date(Date.parse(requested)) : new Date(soonest);
  const slots = await openSlots(want, new Date(want.getTime() + 14 * 86400_000));
  if (!slots.length) throw new Error("No open slots in the next 14 days");
  const exact = slots.find((s) => Math.abs(Date.parse(s) - want.getTime()) < 60_000);
  return { start: exact ?? slots[0], exact: Boolean(exact && requested) };
}

/** Books the discovery call for a qualified caller. Never books twice for the same call. */
export async function bookDiscoveryCall(call: CallLead): Promise<CallBooking | undefined> {
  if (!calcomConfigured() || call.qualification !== "Qualified" || !call.email) return undefined;
  if (call.booking?.status === "booked" && call.booking.uid) return call.booking;

  try {
    const { start, exact } = await chooseSlot(call.booking?.requested);
    const booking = await cal<{ uid: string; start: string }>("/bookings", "2024-08-13", {
      method: "POST",
      body: JSON.stringify({
        start: new Date(start).toISOString(),
        eventTypeId: Number(process.env.CALCOM_EVENT_TYPE_ID),
        attendee: { name: call.callerName ?? "Aangan enquiry", email: call.email, timeZone: TZ, language: "en" },
        metadata: { callId: call.reference, source: "aangan-call-console" },
      }),
    });
    return {
      status: "booked",
      at: booking.start ?? start,
      uid: booking.uid,
      source: "console",
      requested: call.booking?.requested,
      note: call.booking?.requested && !exact ? "Requested time was taken — booked the nearest free slot" : undefined,
    };
  } catch (err) {
    return {
      status: "not booked",
      requested: call.booking?.requested,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
