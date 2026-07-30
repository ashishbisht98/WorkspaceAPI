import { NextRequest, NextResponse } from "next/server";
import {
  callDoeTabletApi,
  convertEmployeeIdToMac,
  isValidTabletEmployeeId,
} from "@/lib/doeTabletApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      employeeId?: string;
      newPassword?: string;
    };
    const employeeId = (body.employeeId || "").trim();
    const newPassword = (body.newPassword || "New").trim();

    if (!isValidTabletEmployeeId(employeeId)) {
      return NextResponse.json(
        { error: "Employee ID must be 8 to 10 digits." },
        { status: 400 },
      );
    }
    const proc = `USPupdate_passward_guestteacher '${employeeId}','${newPassword}','','${convertEmployeeIdToMac(
      employeeId,
    )}'`;

    const cargo = await callDoeTabletApi(
      proc,
      "post",
    );

    if (cargo === "3") {
      return NextResponse.json({
        message: "Password reset to 'New'",
      });
    }

    return NextResponse.json(
      { error: `Password reset did not succeed. Cargo is ${String(cargo)}` },
      { status: 502 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
