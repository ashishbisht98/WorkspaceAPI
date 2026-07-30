import { NextRequest, NextResponse } from "next/server";
import { findWorkspaceAccountByEmail } from "@/lib/googleAdmin";
import { isValidEmployeeId } from "@/lib/username";
import {
  WorkspaceEmailLookupRequestBody,
  WorkspaceEmailLookupResult,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  try {
    const body = (await req.json()) as WorkspaceEmailLookupRequestBody;
    const employeeId = (body.employeeId || "").trim();
    const firstName = (body.firstName || "").trim();
    const oldWorkspaceEmail = (body.oldWorkspaceEmail || "").trim();

    if (!isValidEmployeeId(employeeId)) {
      return NextResponse.json(
        { error: "Employee ID must be exactly 8 digits." },
        { status: 400 },
      );
    }

    if (!firstName) {
      return NextResponse.json(
        { error: "First name is required to check Workspace account format." },
        { status: 400 },
      );
    }

    if (!oldWorkspaceEmail) {
      return NextResponse.json(
        { error: "Old Workspace email is required." },
        { status: 400 },
      );
    }

    log(`Checking Workspace account ${oldWorkspaceEmail}...`);
    const account = await findWorkspaceAccountByEmail(
      oldWorkspaceEmail,
      employeeId,
      firstName,
    );
    log(account ? `Found ${account.primaryEmail}.` : "No Workspace account found.");

    const result: WorkspaceEmailLookupResult = {
      requestedEmail: oldWorkspaceEmail,
      account,
      logs,
    };

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    log(`Error: ${message}`);
    console.error(err);
    return NextResponse.json(
      { error: message, logs },
      { status: 500 },
    );
  }
}
