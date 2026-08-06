import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceAccountByEmail } from "@/lib/googleAdmin";
import { OldMailCheckResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface OldMailCheckRequestBody {
  email?: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildErrorResponse(message: string, logs: string[], status = 400) {
  return NextResponse.json({ error: message, logs }, { status });
}

async function runOldMailCheck(emailInput: string, logs: string[]) {
  const log = (msg: string) => logs.push(msg);

  const email = emailInput.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return buildErrorResponse(
      "A valid email address is required, e.g. old.user@example.gov.in.",
      logs,
      400,
    );
  }

  log(`Checking Workspace for ${email}...`);
  const account = await getWorkspaceAccountByEmail(email);
  log(account ? `Found ${account.primaryEmail}.` : "No Workspace account found.");

  const result: OldMailCheckResult = {
    requestedEmail: email,
    found: !!account,
    account,
    logs,
  };

  return NextResponse.json(result);
}

export async function GET(req: NextRequest) {
  const logs: string[] = [];
  const emailInput = (req.nextUrl.searchParams.get("email") || "").trim();

  try {
    return await runOldMailCheck(emailInput, logs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    logs.push(`Error: ${message}`);
    console.error(err);
    return buildErrorResponse(message, logs, 500);
  }
}

export async function POST(req: NextRequest) {
  const logs: string[] = [];
  const queryEmail = (req.nextUrl.searchParams.get("email") || "").trim();

  try {
    const MAX_BODY = 10 * 1024; // 10 KB
    const contentLengthHeader = req.headers.get("content-length");
    if (contentLengthHeader) {
      const len = parseInt(contentLengthHeader, 10);
      if (!Number.isNaN(len) && len > MAX_BODY) {
        return buildErrorResponse("Request body too large", logs, 413);
      }
    } else {
      // Reject requests without a Content-Length header to avoid streaming
      // chunked requests that could exhaust memory when clients send large
      // or malformed bodies (mobile clients sometimes use chunked uploads).
      return buildErrorResponse(
        "Missing Content-Length header; request not accepted",
        logs,
        411,
      );
    }

    const rawBody = await req.text();
    if (!rawBody.trim()) {
      return buildErrorResponse(
        "Missing request body. Send a JSON body like {\"email\":\"old.user@example.gov.in\"} or use ?email=old.user@example.gov.in.",
        logs,
        400,
      );
    }

    let body: OldMailCheckRequestBody;
    try {
      body = JSON.parse(rawBody) as OldMailCheckRequestBody;
    } catch {
      return buildErrorResponse("Request body must be valid JSON.", logs, 400);
    }

    const emailInput = (body.email || queryEmail).trim();
    return await runOldMailCheck(emailInput, logs);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    logs.push(`Error: ${message}`);
    console.error(err);
    return buildErrorResponse(message, logs, 500);
  }
}
