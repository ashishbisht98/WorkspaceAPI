import { NextRequest, NextResponse } from "next/server";
import { findWorkspaceAccountByEmail } from "@/lib/googleAdmin";
import { getDomain } from "@/lib/username";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface EmployeeAccountCheckRequestBody {
  employeeId: string;
}

interface EmployeeAccountCheckResult {
  employeeId: string;
  requestedEmail: string;
  found: boolean;
  account: {
    primaryEmail: string;
    fullName: string;
    suspended: boolean;
    orgUnitPath?: string;
    lastLoginTime?: string;
    isNewFormat: boolean;
  } | null;
  logs: string[];
}

export async function POST(req: NextRequest) {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  try {
    const body = (await req.json()) as EmployeeAccountCheckRequestBody;
    const employeeIdInput = (body.employeeId || "").trim();

    const match = /^([0-9]{8})\.([a-z0-9]+)$/i.exec(employeeIdInput);
    if (!match) {
      return NextResponse.json(
        {
          error:
            "Employee ID must be in the format 8-digit number followed by a dot and a username segment, e.g. 20192794.ashish.",
        },
        { status: 400 },
      );
    }

    const employeeId = match[1];
    const usernamePart = match[2];
    const expectedEmail = `${employeeId}.${usernamePart}@${getDomain()}`;

    log(`Checking new-format Workspace account ${expectedEmail}...`);
    const account = await findWorkspaceAccountByEmail(
      expectedEmail,
      employeeId,
      usernamePart,
    );

    const result: EmployeeAccountCheckResult = {
      employeeId,
      requestedEmail: expectedEmail,
      found: !!account,
      account,
      logs,
    };

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    log(`Error: ${message}`);
    console.error(err);
    return NextResponse.json({ error: message, logs }, { status: 500 });
  }
}
