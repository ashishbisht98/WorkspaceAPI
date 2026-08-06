import { NextRequest, NextResponse } from "next/server";
import { listRenameRequests } from "@/lib/requests";
import { RenameRequestStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: RenameRequestStatus[] = ["pending", "approved", "rejected"];

export async function GET(req: NextRequest) {
  try {
    const statusParam = req.nextUrl.searchParams.get("status");
    const status =
      statusParam && VALID_STATUSES.includes(statusParam as RenameRequestStatus)
        ? (statusParam as RenameRequestStatus)
        : undefined;

    const requests = await listRenameRequests(status);
    return NextResponse.json({ requests });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
