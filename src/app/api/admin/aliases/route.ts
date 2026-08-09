import { NextResponse } from "next/server";
import { listAliases } from "@/lib/aliases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const aliases = await listAliases();
    return NextResponse.json({ aliases });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
