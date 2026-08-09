import { NextRequest, NextResponse } from "next/server";
import { buildExpectedUsername, isValidEmployeeId } from "@/lib/username";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pure formatting — no employee API or Workspace calls. Lets the admin
 * review panel compute the target username from cached request details
 * without the network round trips employee-lookup normally does.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { employeeId?: string; fullName?: string };
  const employeeId = (body.employeeId || "").trim();
  const fullName = (body.fullName || "").trim();

  if (!isValidEmployeeId(employeeId)) {
    return NextResponse.json({ error: "Employee ID must be exactly 8 digits." }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ error: "fullName is required." }, { status: 400 });
  }

  const firstName = fullName.split(/\s+/)[0] || "";
  const expectedUsername = buildExpectedUsername(employeeId, firstName);
  return NextResponse.json({ expectedUsername });
}
