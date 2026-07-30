import { google, admin_directory_v1 } from "googleapis";
import { readFileSync } from "node:fs";
import { WorkspaceAccount } from "./types";
import { getDomain, isNewFormat, belongsToEmployeeId } from "./username";

const SCOPES = ["https://www.googleapis.com/auth/admin.directory.user"];

let cachedClient: admin_directory_v1.Admin | null = null;

/**
 * Authenticates as a service account with domain-wide delegation,
 * impersonating a super admin (GOOGLE_ADMIN_IMPERSONATE_EMAIL).
 *
 * Setup required (see README.md):
 *  1. Create a GCP service account, enable Admin SDK API.
 *  2. Grant it domain-wide delegation in Workspace Admin console with the
 *     scopes above.
 *  3. Put the service account JSON key path/contents in env vars below.
 */
function getAuth() {
  const impersonate = process.env.GOOGLE_ADMIN_IMPERSONATE_EMAIL;

  return new google.auth.GoogleAuth({
    credentials: getServiceAccountCredentials(),
    scopes: SCOPES,
    clientOptions: { subject: impersonate },
  });
}

function getServiceAccountCredentials() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const base64Json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;

  if (json) return parseCredentials(json);
  if (base64Json) {
    return parseCredentials(Buffer.from(base64Json, "base64").toString("utf8"));
  }
  if (keyFile) return parseCredentials(readFileSync(keyFile, "utf8"));

  throw new Error(
    "Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 in Vercel environment variables.",
  );
}


function parseCredentials(value: string) {
  const credentials = JSON.parse(value);
  if (
    credentials &&
    typeof credentials === "object" &&
    "private_key" in credentials &&
    typeof credentials.private_key === "string"
  ) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }
  return credentials;
}

async function getAdmin(): Promise<admin_directory_v1.Admin> {
  if (cachedClient) return cachedClient;
  const auth = getAuth();
  cachedClient = google.admin({ version: "directory_v1", auth });
  return cachedClient;
}

function toWorkspaceAccount(
  u: admin_directory_v1.Schema$User,
  employeeId: string,
  firstName: string,
): WorkspaceAccount {
  const primaryEmail = u.primaryEmail || "";
  return {
    primaryEmail,
    fullName: u.name?.fullName || "",
    suspended: !!u.suspended,
    orgUnitPath: u.orgUnitPath || undefined,
    lastLoginTime: u.lastLoginTime || undefined,
    isNewFormat: isNewFormat(primaryEmail, employeeId, firstName),
  };
}

/**
 * Finds every account that could plausibly belong to this employee:
 *  - any account whose local part is exactly employeeId or starts with "employeeid."
 *  - the explicitly provided old email (if it doesn't already match the pattern above)
 */
export async function findExistingAccounts(
  employeeId: string,
  firstName: string,
  oldEmailHint?: string,
): Promise<WorkspaceAccount[]> {
  const admin = await getAdmin();
  const domain = getDomain();
  const found = new Map<string, WorkspaceAccount>();

  // 1. Query Workspace directory for anything starting with the employee ID.
  const res = await admin.users.list({
    domain,
    query: `email:${employeeId}.*`,
    maxResults: 20,
  });
  for (const u of res.data.users || []) {
    if (u.primaryEmail && belongsToEmployeeId(u.primaryEmail, employeeId)) {
      found.set(
        u.primaryEmail.toLowerCase(),
        toWorkspaceAccount(u, employeeId, firstName),
      );
    }
  }

  // 2. If an old email was explicitly provided, check it directly too
  //    (covers accounts that don't start with the employee ID at all).
  if (oldEmailHint) {
    try {
      const u = await admin.users.get({ userKey: oldEmailHint });
      if (u.data.primaryEmail) {
        found.set(
          u.data.primaryEmail.toLowerCase(),
          toWorkspaceAccount(u.data, employeeId, firstName),
        );
      }
    } catch {
      // Provided old email doesn't exist in Workspace — that's fine, ignore.
    }
  }

  return Array.from(found.values());
}

export async function findWorkspaceAccountByEmail(
  email: string,
  employeeId: string,
  firstName: string,
): Promise<WorkspaceAccount | null> {
  const admin = await getAdmin();

  try {
    const user = await admin.users.get({ userKey: email });
    if (!user.data.primaryEmail) return null;
    return toWorkspaceAccount(user.data, employeeId, firstName);
  } catch (err: unknown) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

function isNotFoundError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ("code" in err && err.code === 404) return true;
  if ("status" in err && err.status === 404) return true;

  const response = "response" in err ? err.response : undefined;
  return (
    typeof response === "object" &&
    response !== null &&
    "status" in response &&
    response.status === 404
  );
}

export async function createAccount(params: {
  employeeId: string;
  firstName: string;
  lastName?: string;
  fullName: string;
  primaryEmail: string;
  mobile: string;
  personalEmail: string;
  tempPassword: string;
  orgUnitPath?: string;
}): Promise<void> {
  const admin = await getAdmin();

  await admin.users.insert({
    requestBody: {
      primaryEmail: params.primaryEmail,
      name: {
        givenName: params.firstName,
        familyName: params.lastName || params.firstName,
        fullName: params.fullName,
      },
      password: params.tempPassword,
      changePasswordAtNextLogin: true,
      orgUnitPath: params.orgUnitPath || "/",
      recoveryEmail: params.personalEmail,
      recoveryPhone: normalizePhone(params.mobile),
      phones: params.mobile
        ? [{ value: params.mobile, type: "mobile", primary: true }]
        : undefined,
      emails: params.personalEmail
        ? [{ address: params.personalEmail, type: "home" }]
        : undefined,
    },
  });
}

export async function renameAccount(
  oldEmail: string,
  newEmail: string,
): Promise<void> {
  const admin = await getAdmin();
  await admin.users.update({
    userKey: oldEmail,
    requestBody: { primaryEmail: newEmail },
  });

  try {
    await admin.users.aliases.delete({
      userKey: newEmail,
      alias: oldEmail,
    });
  } catch {}
}

export async function removeAliasByEmail(aliasEmail: string): Promise<{
  removedAlias: string;
  primaryEmail: string;
}> {
  const admin = await getAdmin();
  const normalizedAlias = aliasEmail.trim().toLowerCase();

  const user = await admin.users.get({ userKey: normalizedAlias });
  const primaryEmail = user.data.primaryEmail || "";

  if (!primaryEmail) {
    throw new Error("No Workspace account was found for this email.");
  }

  if (primaryEmail.toLowerCase() === normalizedAlias) {
    throw new Error(
      "This email is the account's primary email, not an alias. No alias was removed.",
    );
  }

  await admin.users.aliases.delete({
    userKey: primaryEmail,
    alias: normalizedAlias,
  });

  return {
    removedAlias: normalizedAlias,
    primaryEmail,
  };
}

export async function updateContactAndRecovery(
  email: string,
  params: { mobile: string; personalEmail: string },
): Promise<void> {
  const admin = await getAdmin();
  await admin.users.update({
    userKey: email,
    requestBody: {
      recoveryEmail: params.personalEmail,
      recoveryPhone: normalizePhone(params.mobile),
      phones: params.mobile
        ? [{ value: params.mobile, type: "mobile", primary: true }]
        : undefined,
      emails: params.personalEmail
        ? [{ address: params.personalEmail, type: "home" }]
        : undefined,
      suspended: false,
    },
  });
}

/**
 * Google's Admin SDK has no "send password reset link" endpoint. The standard
 * admin-initiated flow is: set a temp password + force change at next login,
 * then email the user their temp password and the sign-in URL. This does that
 * password/force-change part; googleAccountSignInUrl() below gives the link.
 */
export async function setTempPasswordForceChange(
  email: string,
  tempPassword: string,
): Promise<void> {
  const admin = await getAdmin();
  await admin.users.update({
    userKey: email,
    requestBody: {
      password: tempPassword,
      changePasswordAtNextLogin: true,
    },
  });
}

export function googleAccountSignInUrl(email: string): string {
  return `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(
    email,
  )}&continue=${encodeURIComponent("https://mail.google.com/")}`;
}

// Recovery phone must be in E.164-ish format for the Admin SDK; best-effort normalize for India.
function normalizePhone(mobile: string): string | undefined {
  if (!mobile) return undefined;
  const digits = mobile.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (mobile.startsWith("+")) return mobile;
  return `+${digits}`;
}
