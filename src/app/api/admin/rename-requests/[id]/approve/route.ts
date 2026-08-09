import { NextRequest, NextResponse } from "next/server";
import { createAliasRecord } from "@/lib/aliases";
import { getRenameRequestById, markRenameRequestProcessed } from "@/lib/requests";
import { ProvisionError, provisionEmployee } from "@/lib/provision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const request = await getRenameRequestById(id);
    if (!request) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }
    if (request.status !== "pending") {
      return NextResponse.json({ error: `Request is already ${request.status}.` }, { status: 409 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      fullName?: string;
      targetWorkspaceEmail?: string;
      adminNote?: string;
    };

    const result = await provisionEmployee({
      employeeId: request.employeeId,
      oldWorkspaceEmail: request.currentEmail || undefined,
      fullName: body.fullName,
      targetWorkspaceEmail: body.targetWorkspaceEmail || undefined,
    });

    // Best-effort — the account was already successfully provisioned above,
    // so a failure here shouldn't fail the whole approval.
    if (result.action === "renamed" && result.finalAccount) {
      const oldEmail = result.matchedAccounts[0]?.primaryEmail;
      const newEmail = result.finalAccount.primaryEmail;
      if (oldEmail && newEmail && oldEmail.toLowerCase() !== newEmail.toLowerCase()) {
        await createAliasRecord({
          employeeId: request.employeeId,
          oldEmail,
          newEmail,
          requestId: request.id,
        }).catch((err) => console.error("Failed to record alias:", err));
      }
    }

    const updated = await markRenameRequestProcessed(id, "approved", body.adminNote);
    return NextResponse.json({ request: updated, result });
  } catch (err: unknown) {
    if (err instanceof ProvisionError) {
      if (err.status >= 500) console.error(err);
      return NextResponse.json({ error: err.message, logs: err.logs }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
