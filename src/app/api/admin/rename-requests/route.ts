import { NextRequest, NextResponse } from "next/server";
import { decodeRenameRequestCursor, encodeRenameRequestCursor, listRenameRequests } from "@/lib/requests";
import { RenameRequestStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: RenameRequestStatus[] = ["pending", "approved", "rejected"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;

    const statusParam = params.get("status");
    const status =
      statusParam && VALID_STATUSES.includes(statusParam as RenameRequestStatus)
        ? (statusParam as RenameRequestStatus)
        : undefined;

    const employeeId = params.get("employeeId")?.trim() || undefined;

    const startDate = params.get("startDate") || undefined;
    const endDate = params.get("endDate") || undefined;
    if (startDate && !DATE_RE.test(startDate)) {
      return NextResponse.json({ error: "startDate must be YYYY-MM-DD." }, { status: 400 });
    }
    if (endDate && !DATE_RE.test(endDate)) {
      return NextResponse.json({ error: "endDate must be YYYY-MM-DD." }, { status: 400 });
    }

    const cursor = decodeRenameRequestCursor(params.get("cursor"));

    const limitParam = params.get("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    if (limitParam && (!Number.isFinite(limit) || (limit as number) <= 0)) {
      return NextResponse.json({ error: "limit must be a positive number." }, { status: 400 });
    }

    const { requests, nextCursor } = await listRenameRequests({
      status,
      employeeId,
      startDate,
      endDate,
      cursor,
      limit,
    });

    return NextResponse.json({
      requests,
      nextCursor: nextCursor ? encodeRenameRequestCursor(nextCursor) : null,
    });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
