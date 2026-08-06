import { NextRequest, NextResponse } from "next/server";
import { createRenameRequest } from "@/lib/requests";
import { isValidEmployeeId } from "@/lib/username";
import { CreateRenameRequestBody, RenameRequestType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_REQUEST_TYPES: RenameRequestType[] = [0, 1];

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateRenameRequestBody;
    const employeeId = (body.employeeId || "").trim();
    const requestType = body.requestType;
    const currentEmail = (body.currentEmail || "").trim().toLowerCase();
    const note = body.note?.trim();

    if (!isValidEmployeeId(employeeId)) {
      return NextResponse.json(
        { error: "Employee ID must be exactly 8 digits." },
        { status: 400 },
      );
    }
    if (!VALID_REQUEST_TYPES.includes(requestType)) {
      return NextResponse.json(
        { error: "requestType must be 0 (creation) or 1 (reactivation)." },
        { status: 400 },
      );
    }
    if (requestType === 1) {
      if (!isValidEmail(currentEmail)) {
        return NextResponse.json(
          { error: "currentEmail must be a valid email address for reactivation requests." },
          { status: 400 },
        );
      }
    } else if (currentEmail && !isValidEmail(currentEmail)) {
      return NextResponse.json(
        { error: "currentEmail must be a valid email address." },
        { status: 400 },
      );
    }
    const request = await createRenameRequest({
      employeeId,
      requestType,
      currentEmail: requestType === 1 ? currentEmail : currentEmail || undefined,
      note,
    });

    return NextResponse.json({ request }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
