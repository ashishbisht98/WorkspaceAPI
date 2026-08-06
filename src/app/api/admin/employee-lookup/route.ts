import { NextRequest, NextResponse } from "next/server";
import { fetchEmployeeData, EmployeeNotFoundError } from "@/lib/employeeApi";
import { findWorkspaceAccountByEmail } from "@/lib/googleAdmin";
import { buildExpectedUsername, isValidEmployeeId } from "@/lib/username";
import { EmployeeDetailsResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Admin-only variant of /api/employee + /api/workspace-email combined into one call,
 * used to prefill the approval form for a pending rename request.
 */
export async function POST(req: NextRequest) {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  try {
    const body = (await req.json()) as { employeeId?: string; currentEmail?: string };
    const employeeId = (body.employeeId || "").trim();
    const currentEmail = (body.currentEmail || "").trim();

    if (!isValidEmployeeId(employeeId)) {
      return NextResponse.json(
        { error: "Employee ID must be exactly 8 digits.", logs },
        { status: 400 },
      );
    }

    log(`Fetching employee data for ${employeeId}...`);
    const employee = await fetchEmployeeData(employeeId);
    log(`Found: ${employee.fullName} (${employee.mobile}, ${employee.personalEmail})`);

    const expectedUsername = buildExpectedUsername(employeeId, employee.firstName);
    log(`Expected new-format username: ${expectedUsername}`);

    let oldWorkspaceAccount: EmployeeDetailsResult["oldWorkspaceAccount"];
    if (currentEmail) {
      log(`Checking Workspace account ${currentEmail}...`);
      const account = await findWorkspaceAccountByEmail(currentEmail, employeeId, employee.firstName);
      oldWorkspaceAccount = account || undefined;
      log(account ? `Found ${account.primaryEmail}.` : "No Workspace account found at that address.");
    }

    const result: EmployeeDetailsResult = {
      employee,
      expectedUsername,
      oldWorkspaceAccount,
      logs,
    };
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof EmployeeNotFoundError) {
      return NextResponse.json({ error: err.message, logs }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error(err);
    return NextResponse.json({ error: message, logs }, { status: 500 });
  }
}
