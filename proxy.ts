import { NextResponse, type NextRequest } from "next/server";

/**
 * Password-protects the console (it shows client details). The Vaani webhook is
 * exempt — it authenticates with its own HMAC signature.
 * Credentials: CONSOLE_USER / CONSOLE_PASSWORD in .env.local. Set CONSOLE_PUBLIC=true to disable.
 */
export function proxy(req: NextRequest) {
  // CONSOLE_PUBLIC=true turns the login off entirely (owner's choice; exposes caller data).
  if (process.env.CONSOLE_PUBLIC === "true") return NextResponse.next();

  const user = process.env.CONSOLE_USER || "aangan";
  const password = process.env.CONSOLE_PASSWORD;
  if (!password) {
    return new NextResponse("Console locked: set CONSOLE_PASSWORD in .env.local", { status: 503 });
  }

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const [u, ...rest] = atob(header.slice(6)).split(":");
    if (u === user && rest.join(":") === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Aangan Call Console", charset="UTF-8"' },
  });
}

export const config = {
  // Everything except the Vaani webhook and Next's static assets.
  matcher: ["/((?!api/vaani/webhook|_next/static|_next/image|favicon.ico).*)"],
};
