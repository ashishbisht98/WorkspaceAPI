import { NextRequest, NextResponse } from "next/server";
import { getRenameRequestById, markRenameRequestProcessed } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const request = await getRenameRequestById(id);
    if (!request) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }
    if (request.status !== "pending") {
      return NextResponse.json({ error: `Request is already ${request.status}.` }, { status: 409 });
    }

    const body = (await req.json().catch(() => ({}))) as { adminNote?: string };
    const updated = await markRenameRequestProcessed(id, "rejected", body.adminNote);
    return NextResponse.json({ request: updated });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
