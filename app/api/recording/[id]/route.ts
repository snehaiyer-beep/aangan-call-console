import { VAANI_API } from "@/lib/vaani";

/**
 * Serves a call recording from Vaani, adding the API key server-side so it never reaches
 * the browser. Vaani streams without a length, which stops the player from seeking, so the
 * file (a few MB) is fetched whole and served with Content-Length and byte-range support.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[\w.-]{1,128}$/.test(id)) return new Response("Bad call id", { status: 400 });
  if (!process.env.VAANI_API_KEY) return new Response("Vaani API key not configured", { status: 503 });

  const upstream = await fetch(`${VAANI_API}/api/stream/${encodeURIComponent(id)}`, {
    headers: { "X-API-Key": process.env.VAANI_API_KEY },
    cache: "no-store",
  });
  if (!upstream.ok) return new Response("Recording unavailable", { status: upstream.status });

  const audio = new Uint8Array(await upstream.arrayBuffer());
  const type = upstream.headers.get("content-type") ?? "audio/ogg";
  const base = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=600" };

  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const size = audio.length;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
    }
    return new Response(audio.slice(start, end + 1), {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(audio, { status: 200, headers: { ...base, "Content-Length": String(audio.length) } });
}
