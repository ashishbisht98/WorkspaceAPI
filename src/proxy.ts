import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
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

export const config = {
  matcher: "/api/:path*",
};
