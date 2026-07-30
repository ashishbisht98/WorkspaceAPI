import { NextRequest, NextResponse } from "next/server";
import { fetchEmployeeData, EmployeeNotFoundError } from "@/lib/employeeApi";
import {
  findExistingAccounts,
  createAccount,
  renameAccount,
  updateContactAndRecovery,
  setTempPasswordForceChange,
} from "@/lib/googleAdmin";
import {
  sendAccountCreatedEmail,
  sendAccountRenamedEmail,
  sendPasswordResetEmail,
} from "@/lib/email";
import {
  buildExpectedUsername,
  generateTempPassword,
  isValidEmployeeId,
} from "@/lib/username";
import { ProcessRequestBody, ProcessResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  try {
    const body = (await req.json()) as ProcessRequestBody;
    const employeeId = (body.employeeId || "").trim();
    const oldWorkspaceEmail = body.oldWorkspaceEmail?.trim() || undefined;
    const fullNameOverride = body.fullName?.trim();
    const targetWorkspaceEmailOverride = body.targetWorkspaceEmail?.trim();

    if (!isValidEmployeeId(employeeId)) {
      return NextResponse.json(
        { error: "Employee ID must be exactly 8 digits." },
        { status: 400 },
      );
    }

    log(`Fetching employee data for ${employeeId}...`);
    const employee = await fetchEmployeeData(employeeId);
    if (fullNameOverride) {
      const { firstName, lastName } = splitName(fullNameOverride);
      employee.fullName = fullNameOverride;
      employee.firstName = firstName;
      employee.lastName = lastName;
    }
    log(
      `Found: ${employee.fullName} (${employee.mobile}, ${employee.personalEmail})`,
    );

    if (employee.personalEmail === "") {
      return NextResponse.json(
        {
          error: "Employee personal email not updated",
          logs,
        },
        { status: 400 },
      );
    }

    const expectedUsername = targetWorkspaceEmailOverride || buildExpectedUsername(
      employeeId,
      employee.firstName,
    );
    if (!isValidWorkspaceEmail(expectedUsername)) {
      return NextResponse.json(
        {
          error: "Target Workspace email is not valid.",
          logs,
        },
        { status: 400 },
      );
    }
    log(`Expected new-format username: ${expectedUsername}`);

    log("Searching Google Workspace for existing accounts...");
    const matchedAccounts = (await findExistingAccounts(
      employeeId,
      employee.firstName,
      oldWorkspaceEmail,
    )).map((account) => ({
      ...account,
      isNewFormat: account.primaryEmail.toLowerCase() === expectedUsername.toLowerCase(),
    }));
    log(`Found ${matchedAccounts.length} matching account(s).`);

    const result: ProcessResult = {
      employee,
      expectedUsername,
      matchedAccounts,
      action: "error",
      message: "",
      logs,
    };

    // Case: multiple accounts — hand off to manual review, do nothing further.
    if (matchedAccounts.length > 1) {
      result.action = "manual_review_multiple_accounts";
      result.message = `Employee has ${matchedAccounts.length} existing Workspace accounts. No changes were made — please review and resolve manually.`;
      return NextResponse.json(result);
    }

    const tempPassword = generateTempPassword();

    // Case: no account exists — create it fresh in the new format.
    if (matchedAccounts.length === 0) {
      log(`No existing account found. Creating ${expectedUsername}...`);
      await createAccount({
        employeeId,
        firstName: employee.firstName,
        lastName: employee.lastName,
        fullName: employee.fullName,
        primaryEmail: expectedUsername,
        mobile: employee.mobile,
        personalEmail: employee.personalEmail,
        tempPassword,
      });
      log("Account created. Sending notification email...");
      await sendAccountCreatedEmail({
        personalEmail: employee.personalEmail,
        fullName: employee.fullName,
        workspaceEmail: expectedUsername,
        tempPassword,
      });
      log("Notification email sent.");

      result.action = "created";
      result.message = `Created new Workspace account ${expectedUsername} and emailed sign-in details to ${employee.personalEmail}.`;
      result.finalAccount = {
        primaryEmail: expectedUsername,
        fullName: employee.fullName,
        suspended: false,
        isNewFormat: true,
      };
      result.tempPasswordEmailSent = true;
      return NextResponse.json(result);
    }

    // Exactly one matching account.
    const account = matchedAccounts[0];

    if (account.isNewFormat) {
      // Already in the new format — just refresh contact info and reset password.
      log(
        `${account.primaryEmail} is already in the new format. Updating contact info...`,
      );
      await updateContactAndRecovery(account.primaryEmail, {
        mobile: employee.mobile,
        personalEmail: employee.personalEmail,
      });
      log("Setting temporary password and forcing change at next login...");
      await setTempPasswordForceChange(account.primaryEmail, tempPassword);
      log("Sending password reset email...");
      await sendPasswordResetEmail({
        personalEmail: employee.personalEmail,
        fullName: employee.fullName,
        workspaceEmail: account.primaryEmail,
        tempPassword,
      });
      log("Done.");

      result.action = "updated";
      result.message = `Updated contact info on existing account ${account.primaryEmail} and emailed a password reset to ${employee.personalEmail}.`;
      result.finalAccount = { ...account };
      result.tempPasswordEmailSent = true;
      return NextResponse.json(result);
    }

    // Existing account in old format — rename, update, and reset password.
    log("Updating contact info...");
    await updateContactAndRecovery(account.primaryEmail, {
      mobile: employee.mobile,
      personalEmail: employee.personalEmail,
    });
    log(
      "Updated. Setting temporary password and forcing change at next login...",
    );
    await setTempPasswordForceChange(account.primaryEmail, tempPassword);

    log(
      `${account.primaryEmail} is in the old format. Renaming to ${expectedUsername}...`,
    );
    await renameAccount(account.primaryEmail, expectedUsername);
    log("Renamed.");

    log("Sending notification + password reset email...");
    await sendAccountRenamedEmail({
      personalEmail: employee.personalEmail,
      fullName: employee.fullName,
      oldEmail: account.primaryEmail,
      newEmail: expectedUsername,
      tempPassword,
    });
    log("Done.");

    result.action = "renamed";
    result.message = `Renamed ${account.primaryEmail} to ${expectedUsername}, updated contact info, and emailed a password reset to ${employee.personalEmail}.`;
    result.finalAccount = {
      ...account,
      primaryEmail: expectedUsername,
      isNewFormat: true,
    };
    result.tempPasswordEmailSent = true;
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    log(`Error: ${message}`);
    if (err instanceof EmployeeNotFoundError) {
      return NextResponse.json({ error: err.message, logs }, { status: 404 });
    }
    console.error(err);
    return NextResponse.json(
      { error: message, logs },
      { status: 500 },
    );
  }
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function isValidWorkspaceEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
