import { NextResponse } from "next/server";
import { getKillSwitchEnabled } from "@/lib/killSwitch";

// Edge, not Node — this was the single most-invoked route in the app, and
// Edge Config reads here don't count as a Serverless Function Invocation.
export const runtime = "edge";
export const dynamic = "force-dynamic";

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
