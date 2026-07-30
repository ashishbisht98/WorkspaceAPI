import { NextRequest, NextResponse } from "next/server";
import {
  fetchTabletRegistrationDetailsForEmployee,
  isValidTabletEmployeeId,
  tabletEmployeeTypeForId,
} from "@/lib/doeTabletApi";
import { fetchEmployeeData } from "@/lib/employeeApi";
import { TabletDetailsResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  try {
    const body = (await req.json()) as {
      employeeId?: string;
      employeeType?: string;
    };
    const employeeId = (body.employeeId || "").trim();
    const employeeType = (body.employeeType || "").trim() || tabletEmployeeTypeForId(employeeId);

    if (!isValidTabletEmployeeId(employeeId)) {
      return NextResponse.json(
        { error: "Employee ID must be 8 to 10 digits.", logs },
        { status: 400 },
      );
    }

    log(`Fetching tablet registration details for ${employeeId}...`);
    const tabletRegistration =
      (await fetchTabletRegistrationDetailsForEmployee(employeeId, [employeeType], log)) ||
      undefined;
    const employee = await fetchTabletEmployeeProfile(employeeId, log);

    if (!tabletRegistration) {
      log("No tablet registration found.");
      if (employeeId.length <= 8) {
        return NextResponse.json(
          { error: "Employee registration details not found.", logs },
          { status: 404 },
        );
      }

      const result: TabletDetailsResult = {
        employeeId,
        employeeType,
        employee,
        tabletRegistration: {
          employeeId,
          employeeType,
          name: employee?.fullName,
          mobile: employee?.mobile,
          email: employee?.personalEmail,
        },
        logs,
      };

      return NextResponse.json(result);
    }

    if (tabletRegistration.registeredDeviceId) {
      log(`Registered device ID: ${tabletRegistration.registeredDeviceId}`);
    }

    const result: TabletDetailsResult = {
      employeeId,
      employeeType: tabletRegistration.employeeType || employeeType,
      employee,
      tabletRegistration: {
        ...tabletRegistration,
        name: tabletRegistration.name || employee?.fullName,
        mobile: tabletRegistration.mobile || employee?.mobile,
        email: tabletRegistration.email || employee?.personalEmail,
      },
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

async function fetchTabletEmployeeProfile(
  employeeId: string,
  log: (message: string) => void,
) {
  try {
    log("Fetching employee profile...");
    const employee = await fetchEmployeeData(employeeId);
    log(`Found employee profile: ${employee.fullName}`);
    return employee;
  } catch (err: unknown) {
    log(
      `Employee profile lookup failed: ${
        err instanceof Error ? err.message : "Unexpected error"
      }`,
    );
    return undefined;
  }
}
