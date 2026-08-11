import { NextResponse } from "next/server";
import { getKillSwitchEnabled } from "@/lib/killSwitch";

// Cached at Vercel's CDN for 60s (see revalidate below) so polling clients
// hit the cache instead of invoking this function on every request. That
// only works because this route is excluded from proxy.ts's auth check —
// an authenticated response can't be served from a shared public cache.
export const revalidate = 60;

/** Lets callers check whether the feature is currently enabled before proceeding. */
export async function GET() {
  try {
    const enabled = await getKillSwitchEnabled();
    return NextResponse.json({ enabled });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
