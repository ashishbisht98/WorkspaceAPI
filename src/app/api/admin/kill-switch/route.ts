import { NextRequest, NextResponse } from "next/server";
import { getKillSwitchEnabled, setKillSwitchEnabled } from "@/lib/killSwitch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gated behind the admin session by the proxy middleware (paths under /api/admin).

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

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { enabled?: boolean };

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "`enabled` must be a boolean." }, { status: 400 });
  }

  try {
    const enabled = await setKillSwitchEnabled(body.enabled);
    return NextResponse.json({ enabled });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
