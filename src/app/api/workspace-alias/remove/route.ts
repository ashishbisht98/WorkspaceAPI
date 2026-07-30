import { NextRequest, NextResponse } from "next/server";
import { removeAliasByEmail } from "@/lib/googleAdmin";
import {
  RemoveAliasItemResult,
  RemoveAliasRequestBody,
  RemoveAliasResult,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  try {
    const body = (await req.json()) as RemoveAliasRequestBody;
    const oldWorkspaceEmails = Array.from(
      new Set(
        (body.oldWorkspaceEmails || [])
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    );

    if (oldWorkspaceEmails.length === 0) {
      return NextResponse.json(
        { error: "Enter at least one old Workspace email alias.", logs },
        { status: 400 },
      );
    }

    const invalidEmails = oldWorkspaceEmails.filter((email) => !isValidEmail(email));
    if (invalidEmails.length > 0) {
      return NextResponse.json(
        {
          error: `Invalid email address${invalidEmails.length === 1 ? "" : "es"}: ${invalidEmails.join(", ")}`,
          logs,
        },
        { status: 400 },
      );
    }

    const results: RemoveAliasItemResult[] = [];

    for (const oldWorkspaceEmail of oldWorkspaceEmails) {
      try {
        log(`Resolving Workspace account for alias ${oldWorkspaceEmail}...`);
        const removed = await removeAliasByEmail(oldWorkspaceEmail);
        log(`Removed alias ${removed.removedAlias} from ${removed.primaryEmail}.`);
        results.push({
          email: removed.removedAlias,
          status: "removed",
          primaryEmail: removed.primaryEmail,
          message: `Removed from ${removed.primaryEmail}.`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unexpected error";
        log(`Could not remove ${oldWorkspaceEmail}: ${message}`);
        results.push({
          email: oldWorkspaceEmail,
          status: "failed",
          message,
        });
      }
    }

    const removedCount = results.filter((item) => item.status === "removed").length;
    const failedCount = results.length - removedCount;
    const message =
      failedCount === 0
        ? `Removed ${removedCount} alias${removedCount === 1 ? "" : "es"} successfully.`
        : `Removed ${removedCount} alias${removedCount === 1 ? "" : "es"}; ${failedCount} failed.`;

    const result: RemoveAliasResult = {
      total: results.length,
      removed: removedCount,
      failed: failedCount,
      results,
      message,
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

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
