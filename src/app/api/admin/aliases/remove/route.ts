import { NextRequest, NextResponse } from "next/server";
import { deleteAliasRecords, getAliasesByIds } from "@/lib/aliases";
import { removeAliasByEmail } from "@/lib/googleAdmin";
import { AliasRemovalItemResult, AliasRemovalResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Removes the given tracked aliases from Workspace, then deletes only the
 * ones that were actually removed from the `alias` table — failures (e.g.
 * already gone) stay listed for a retry.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
    const ids = Array.from(
      new Set((body.ids || []).filter((id): id is string => typeof id === "string" && id.length > 0)),
    );

    if (ids.length === 0) {
      return NextResponse.json({ error: "No alias IDs given." }, { status: 400 });
    }

    const aliases = await getAliasesByIds(ids);
    const results: AliasRemovalItemResult[] = [];
    const removedIds: string[] = [];

    for (const alias of aliases) {
      try {
        const removed = await removeAliasByEmail(alias.oldEmail);
        results.push({
          id: alias.id,
          email: alias.oldEmail,
          status: "removed",
          primaryEmail: removed.primaryEmail,
          message: `Removed from ${removed.primaryEmail}.`,
        });
        removedIds.push(alias.id);
      } catch (err: unknown) {
        results.push({
          id: alias.id,
          email: alias.oldEmail,
          status: "failed",
          message: err instanceof Error ? err.message : "Unexpected error",
        });
      }
    }

    if (removedIds.length > 0) {
      await deleteAliasRecords(removedIds);
    }

    const removedCount = removedIds.length;
    const failedCount = results.length - removedCount;
    const result: AliasRemovalResult = {
      total: results.length,
      removed: removedCount,
      failed: failedCount,
      results,
      message:
        failedCount === 0
          ? `Removed ${removedCount} alias${removedCount === 1 ? "" : "es"} successfully.`
          : `Removed ${removedCount} alias${removedCount === 1 ? "" : "es"}; ${failedCount} failed.`,
    };

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error" },
      { status: 500 },
    );
  }
}
