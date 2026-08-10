import { fetchEmployeeData, EmployeeNotFoundError } from "./employeeApi";
import {
  findExistingAccounts,
  createAccount,
  renameAccount,
  updateContactAndRecovery,
  setTempPasswordForceChange,
} from "./googleAdmin";
import {
  sendAccountCreatedEmail,
  sendAccountRenamedEmail,
  sendPasswordResetEmail,
} from "./email";
import {
  buildExpectedUsername,
  generateTempPassword,
  isValidEmployeeId,
  isValidPersonalEmail,
} from "./username";
import { EmployeeData, ProcessRequestBody, ProcessResult } from "./types";

export class ProvisionError extends Error {
  status: number;
  logs: string[];
  constructor(message: string, status: number, logs: string[]) {
    super(message);
    this.status = status;
    this.logs = logs;
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

/**
 * Runs the full "look up + create/rename/reactivate" Workspace provisioning flow.
 * Shared by the manual admin form (/api/process) and the rename-request approval flow.
 */
export async function provisionEmployee(body: ProcessRequestBody): Promise<ProcessResult> {
  const logs: string[] = [];
  try {
    return await runProvisionEmployee(body, logs);
  } catch (err: unknown) {
    if (err instanceof ProvisionError) {
      throw err;
    }
    if (err instanceof EmployeeNotFoundError) {
      logs.push(`Error: ${err.message}`);
      throw new ProvisionError(err.message, 404, logs);
    }
    const message = err instanceof Error ? err.message : "Unexpected error";
    logs.push(`Error: ${message}`);
    throw new ProvisionError(message, 500, logs);
  }
}

async function runProvisionEmployee(
  body: ProcessRequestBody,
  logs: string[],
): Promise<ProcessResult> {
  const log = (msg: string) => logs.push(msg);

  const employeeId = (body.employeeId || "").trim();
  const oldWorkspaceEmail = body.oldWorkspaceEmail?.trim() || undefined;
  const fullNameOverride = body.fullName?.trim();
  const personalEmailOverride = body.personalEmail?.trim();
  const mobileOverride = body.mobile?.trim();
  const targetWorkspaceEmailOverride = body.targetWorkspaceEmail?.trim();

  if (!isValidEmployeeId(employeeId)) {
    throw new ProvisionError("Employee ID must be exactly 8 digits.", 400, logs);
  }

  let employee: EmployeeData;
  if (fullNameOverride && personalEmailOverride && mobileOverride) {
    // Full details already known (submitted by the app, or cached from an
    // earlier request) — skip the live DOE lookup entirely.
    const { firstName, lastName } = splitName(fullNameOverride);
    employee = {
      employeeId,
      firstName,
      lastName,
      fullName: fullNameOverride,
      mobile: mobileOverride,
      personalEmail: personalEmailOverride,
    };
    log(`Using submitted employee details for ${employeeId} (skipped live lookup).`);
  } else {
    log(`Fetching employee data for ${employeeId}...`);
    employee = await fetchEmployeeData(employeeId);
    if (fullNameOverride) {
      const { firstName, lastName } = splitName(fullNameOverride);
      employee.fullName = fullNameOverride;
      employee.firstName = firstName;
      employee.lastName = lastName;
    }
  }
  log(`Found: ${employee.fullName} (${employee.mobile}, ${employee.personalEmail})`);

  if (employee.personalEmail === "") {
    throw new ProvisionError("Employee personal email not updated", 400, logs);
  }
  if (!isValidPersonalEmail(employee.personalEmail)) {
    throw new ProvisionError(
      `Employee personal email "${employee.personalEmail}" looks invalid or incomplete (check for Gmail typos, e.g. gmail.co / gmai / gmaail.com).`,
      400,
      logs,
    );
  }

  const expectedUsername =
    targetWorkspaceEmailOverride || buildExpectedUsername(employeeId, employee.firstName);
  if (!isValidWorkspaceEmail(expectedUsername)) {
    throw new ProvisionError("Target Workspace email is not valid.", 400, logs);
  }
  log(`Expected new-format username: ${expectedUsername}`);

  log("Searching Google Workspace for existing accounts...");
  const matchedAccounts = (
    await findExistingAccounts(employeeId, employee.firstName, oldWorkspaceEmail)
  ).map((account) => ({
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
    return result;
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
    return result;
  }

  // Exactly one matching account.
  const account = matchedAccounts[0];

  if (account.isNewFormat) {
    // Already in the new format — just refresh contact info and reset password.
    log(`${account.primaryEmail} is already in the new format. Updating contact info...`);
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
    return result;
  }

  // Existing account in old format — rename, update, and reset password.
  log("Updating contact info...");
  await updateContactAndRecovery(account.primaryEmail, {
    mobile: employee.mobile,
    personalEmail: employee.personalEmail,
  });
  log("Updated. Setting temporary password and forcing change at next login...");
  await setTempPasswordForceChange(account.primaryEmail, tempPassword);

  log(`${account.primaryEmail} is in the old format. Renaming to ${expectedUsername}...`);
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
  return result;
}
