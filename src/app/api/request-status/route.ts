import { NextRequest, NextResponse } from "next/server";
import { listRenameRequestsByEmployeeId } from "@/lib/requests";
import { isValidEmployeeId } from "@/lib/username";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lets an employee list and track the status of all requests (creation or
 * reactivation) filed under their employee ID.
 */
export async function GET(req: NextRequest) {
  const employeeId = (req.nextUrl.searchParams.get("employeeId") || "").trim();

  if (!isValidEmployeeId(employeeId)) {
    return NextResponse.json(
      { error: "Employee ID must be exactly 8 digits." },
      { status: 400 },
    );
  }

  try {
    const requests = await listRenameRequestsByEmployeeId(employeeId);
    return NextResponse.json({ requests });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
