import { NextRequest, NextResponse } from "next/server";
import { findWorkspaceAccountByEmail } from "@/lib/googleAdmin";
import { getDomain } from "@/lib/username";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface EmployeeAccountCheckRequestBody {
  employeeId?: string;
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

function buildErrorResponse(message: string, logs: string[], status = 400) {
  return NextResponse.json({ error: message, logs }, { status });
}

async function runEmployeeCheck(employeeIdInput: string, logs: string[]) {
  const log = (msg: string) => logs.push(msg);

  const match = /^([0-9]{8})\.([a-z0-9]+)$/i.exec(employeeIdInput.trim());
  if (!match) {
    return buildErrorResponse(
      "Employee ID must be in the format 8-digit number followed by a dot and a username segment, e.g. 20192794.ashish.",
      logs,
      400,
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
}

export async function GET(req: NextRequest) {
  const logs: string[] = [];
  const employeeIdInput = (req.nextUrl.searchParams.get("employeeId") || "").trim();

  try {
    return await runEmployeeCheck(employeeIdInput, logs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    logs.push(`Error: ${message}`);
    console.error(err);
    return buildErrorResponse(message, logs, 500);
  }
}

export async function POST(req: NextRequest) {
  const logs: string[] = [];
  const queryEmployeeId = (req.nextUrl.searchParams.get("employeeId") || "").trim();

  try {
    const rawBody = await req.text();
    if (!rawBody.trim()) {
      return buildErrorResponse(
        "Missing request body. Send a JSON body like {\"employeeId\":\"20192794.ashish\"} or use ?employeeId=20192794.ashish.",
        logs,
        400,
      );
    }

    let body: EmployeeAccountCheckRequestBody;
    try {
      body = JSON.parse(rawBody) as EmployeeAccountCheckRequestBody;
    } catch {
      return buildErrorResponse("Request body must be valid JSON.", logs, 400);
    }

    const employeeIdInput = (body.employeeId || queryEmployeeId).trim();
    return await runEmployeeCheck(employeeIdInput, logs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    logs.push(`Error: ${message}`);
    console.error(err);
    return buildErrorResponse(message, logs, 500);
  }
}
