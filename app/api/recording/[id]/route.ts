import { VAANI_API } from "@/lib/vaani";

/**
 * Streams a call recording from Vaani, adding the API key server-side so it never
 * reaches the browser. Range headers pass through so the player can seek.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[\w.-]{1,128}$/.test(id)) return new Response("Bad call id", { status: 400 });
  if (!process.env.VAANI_API_KEY) return new Response("Vaani API key not configured", { status: 503 });

  const headers: Record<string, string> = { "X-API-Key": process.env.VAANI_API_KEY };
  const range = req.headers.get("range");
  if (range) headers.Range = range;

  const upstream = await fetch(`${VAANI_API}/api/stream/${encodeURIComponent(id)}`, { headers, cache: "no-store" });
  if (!upstream.ok && upstream.status !== 206) return new Response("Recording unavailable", { status: upstream.status });

  const out = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  out.set("cache-control", "private, max-age=300");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
