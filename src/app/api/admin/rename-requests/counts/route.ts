import { NextResponse } from "next/server";
import { getRenameRequestStatusCounts } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-status counts for the admin dashboard's filter tab badges. */
export async function GET() {
  try {
    const counts = await getRenameRequestStatusCounts();
    return NextResponse.json({ counts });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
