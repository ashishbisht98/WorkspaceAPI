import { NextRequest, NextResponse } from "next/server";
import { getUserStorageUsageMB, getWorkspaceAccountByEmail } from "@/lib/googleAdmin";
import { WorkspaceAccountStatus } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Looks up an arbitrary Workspace address for the admin review panel — used
 * to check whether the old and target addresses on a rename request already
 * exist, their suspended state, and (best-effort) their storage usage.
 */
export async function POST(req: NextRequest) {
  const logs: string[] = [];

  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = (body.email || "").trim().toLowerCase();

    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "A valid email is required.", logs }, { status: 400 });
    }

    const account = await getWorkspaceAccountByEmail(email);

    let storageUsedMB: number | null = null;
    if (account) {
      try {
        storageUsedMB = await getUserStorageUsageMB(email);
      } catch (err: unknown) {
        console.error(`Storage usage lookup failed for ${email}:`, err);
        logs.push(
          `Storage usage lookup failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    }

    const result: WorkspaceAccountStatus = { account, storageUsedMB };
    return NextResponse.json({ ...result, logs });
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error", logs },
      { status: 500 },
    );
  }
}
