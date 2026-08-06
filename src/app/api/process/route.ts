import { NextRequest, NextResponse } from "next/server";
import { ProvisionError, provisionEmployee } from "@/lib/provision";
import { ProcessRequestBody } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ProcessRequestBody;
    const result = await provisionEmployee(body);
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof ProvisionError) {
      if (err.status >= 500) console.error(err);
      return NextResponse.json({ error: err.message, logs: err.logs }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unexpected error", logs: [] },
      { status: 500 },
    );
  }
}
