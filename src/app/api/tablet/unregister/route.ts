import { NextRequest, NextResponse } from "next/server";
import {
  callDoeTabletApi,
  fetchTabletRegistrationDetailsByDeviceId,
  fetchTabletRegistrationDetailsForEmployee,
  isValidTabletEmployeeId,
  tabletEmployeeTypeForId,
} from "@/lib/doeTabletApi";
import { sendTabletDeregisteredEmail } from "@/lib/email";
import { fetchEmployeeData } from "@/lib/employeeApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      employeeId?: string;
      employeeType?: string;
      personalEmail?: string;
      fullName?: string;
    };
    const employeeId = (body.employeeId || "").trim();
    const employeeType = (body.employeeType || "").trim();
    let personalEmail = (body.personalEmail || "").trim();
    let fullName = (body.fullName || "").trim();

    if (!isValidTabletEmployeeId(employeeId)) {
      return NextResponse.json(
        { error: "Employee ID must be 8 to 10 digits." },
        { status: 400 },
      );
    }

    const activeRegistration = await fetchTabletRegistrationDetailsForEmployee(
      employeeId,
      employeeType ? [employeeType] : [],
    );

    if (!activeRegistration?.registeredDeviceId?.trim()) {
      return NextResponse.json(
        {
          error: "No registration found",
        },
        { status: 404 },
      );
    }

    const effectiveEmployeeType =
      activeRegistration.employeeType || employeeType || tabletEmployeeTypeForId(employeeId);

    const cargo = await callDoeTabletApi(
      `uspdelete_TeacherRegistrationForm_mobapp ${employeeId},'${effectiveEmployeeType}'`,
      "post",
    );

    if (cargo === "0") {
      return NextResponse.json(
        {
          error: `No device registered with employee ID ${employeeId}.`,
        },
        { status: 404 },
      );
    }
    if (cargo === "1" || cargo === "2") {
      if (activeRegistration?.registeredDeviceId) {
        const remainingRegistration = await fetchTabletRegistrationDetailsByDeviceId(
          activeRegistration.registeredDeviceId,
        );
        if (remainingRegistration?.registeredDeviceId) {
          return NextResponse.json(
            {
              error: `DOE returned success, but device ${remainingRegistration.registeredDeviceId} is still registered for employee ID ${employeeId}.`,
            },
            { status: 409 },
          );
        }
      }

      let emailMessage = "";
      if (!personalEmail) {
        const employee = await fetchEmployeeForNotification(employeeId);
        personalEmail = employee?.personalEmail || "";
        fullName = fullName || employee?.fullName || "";
      }
      if (personalEmail) {
        await sendTabletDeregisteredEmail({
          personalEmail,
          fullName,
        });
        emailMessage = ` Notification email sent to ${personalEmail}.`;
      } else {
        emailMessage = " Notification email was not sent because employee email was unavailable.";
      }

      return NextResponse.json({
        message: (activeRegistration?.registeredDeviceId
          ? `Device ${activeRegistration.registeredDeviceId} registered for ${effectiveEmployeeType} teacher with employee ID ${employeeId} was de-registered successfully.`
          : `DOE returned done for ${effectiveEmployeeType} teacher with employee ID ${employeeId}.`) + emailMessage,
      });
    }
    if (cargo === "Data Not Found") {
      return NextResponse.json(
        {
          error: `No data found for ${effectiveEmployeeType} teacher with employee ID ${employeeId}.`,
        },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { error: `De-register did not succeed. Cargo is ${String(cargo)}` },
      { status: 502 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    console.error(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function fetchEmployeeForNotification(employeeId: string) {
  try {
    return await fetchEmployeeData(employeeId);
  } catch {
    return undefined;
  }
}
