import { NextRequest, NextResponse } from "next/server";
import { fetchEmployeeData, EmployeeNotFoundError } from "@/lib/employeeApi";
import { buildExpectedUsername, isValidEmployeeId } from "@/lib/username";
import { EmployeeDetailsResult, ProcessRequestBody } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  try {
    const body = (await req.json()) as ProcessRequestBody;
    const employeeId = (body.employeeId || "").trim();

    if (!isValidEmployeeId(employeeId)) {
      return NextResponse.json(
        { error: "Employee ID must be exactly 8 digits." },
        { status: 400 },
      );
    }

    log(`Fetching employee data for ${employeeId}...`);
    const employee = await fetchEmployeeData(employeeId);
    log(
      `Found: ${employee.fullName} (${employee.mobile}, ${employee.personalEmail})`,
    );

    const expectedUsername = buildExpectedUsername(
      employeeId,
      employee.firstName,
    );
    log(`Expected new-format username: ${expectedUsername}`);

    const result: EmployeeDetailsResult = {
      employee,
      expectedUsername,
      logs,
    };

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    log(`Error: ${message}`);
    if (err instanceof EmployeeNotFoundError) {
      return NextResponse.json({ error: err.message, logs }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json(
      { error: message, logs },
      { status: 500 },
    );
  }
}
