import { NextRequest, NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "@/lib/adminAuth";

const ADMIN_PUBLIC_PATHS = new Set(["/admin/login", "/api/admin/login"]);

// Account-management API routes backing the admin dashboard's "Manage accounts"
// tab. These read/write real Workspace accounts, so they're gated behind the
// admin session the same way /api/admin/* is, instead of the general
// API_SECRET_TOKEN check below.
const ADMIN_ONLY_API_PATH_PREFIXES = [
  "/api/employee", // covers /api/employee (see exemptions below for /check and /check-old-mail)
  "/api/workspace-email",
  "/api/process",
  "/api/tablet", // covers /api/tablet/details, /api/tablet/unregister
  "/api/guest", // covers /api/guest/password-reset
  "/api/workspace-alias", // covers /api/workspace-alias/remove
];

// Carved out of the /api/employee prefix above — these stay on the general
// API_SECRET_TOKEN gate instead of requiring an admin session.
const ADMIN_AUTH_EXEMPT_PATHS = new Set([
  "/api/employee/check",
  "/api/employee/check-old-mail",
]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const requiresAdminAuth =
    !ADMIN_AUTH_EXEMPT_PATHS.has(pathname) &&
    (pathname.startsWith("/admin") ||
      pathname.startsWith("/api/admin") ||
      ADMIN_ONLY_API_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)));

  if (requiresAdminAuth) {
    return handleAdminAuth(request, pathname);
  }

  const apiToken = process.env.API_SECRET_TOKEN;

  if (!apiToken || request.method === "OPTIONS") {
    return NextResponse.next();
  }

  const authorization = request.headers.get("authorization") || "";
  const bearerToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const headerToken = request.headers.get("x-api-key") || "";

  if (bearerToken === apiToken || headerToken === apiToken) {
    return NextResponse.next();
  }

  return NextResponse.json(
    { error: "Unauthorized" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Bearer realm="workspace-provisioner-api"',
      },
    },
  );
}

async function handleAdminAuth(request: NextRequest, pathname: string) {
  if (request.method === "OPTIONS" || ADMIN_PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const authenticated = token ? await verifyAdminSessionToken(token) : false;

  if (authenticated) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // /api/kill-switch is deliberately excluded: it's a public, unauthenticated
  // read so Vercel can serve it from CDN cache (see revalidate in its route)
  // instead of invoking this middleware on every poll.
  matcher: ["/api/((?!kill-switch$).*)", "/admin/:path*"],
};
