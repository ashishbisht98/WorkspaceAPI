import { google, admin_directory_v1, admin_reports_v1 } from "googleapis";
import { readFileSync } from "node:fs";
import { WorkspaceAccount } from "./types";
import { getDomain, isNewFormat, belongsToEmployeeId } from "./username";

const DIRECTORY_SCOPES = ["https://www.googleapis.com/auth/admin.directory.user"];
// Needed for getUserStorageUsageMB(). Requires separately authorizing this
// scope for the service account's domain-wide delegation in the Workspace
// Admin console (Security > API controls > Domain-wide delegation) — see
// README. Kept on its own auth client (below) so that a not-yet-authorized
// Reports scope can't take down the Directory API calls too — Google's
// domain-wide delegation check is all-or-nothing per requested scope set.
const REPORTS_SCOPES = ["https://www.googleapis.com/auth/admin.reports.usage.readonly"];

let cachedClient: admin_directory_v1.Admin | null = null;
let cachedReportsClient: admin_reports_v1.Admin | null = null;

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
function getAuth(scopes: string[]) {
  const impersonate = process.env.GOOGLE_ADMIN_IMPERSONATE_EMAIL;

  return new google.auth.GoogleAuth({
    credentials: getServiceAccountCredentials(),
    scopes,
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
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is empty.");
  }

  try {
    const credentials = JSON.parse(trimmed);
    return normalizeCredentials(credentials);
  } catch (jsonError) {
    try {
      const credentials = new Function(`return (${trimmed});`)();
      return normalizeCredentials(credentials);
    } catch (jsError) {
      const repaired = repairJsonWithLiteralNewlines(trimmed);
      if (!repaired) {
        throw new Error(
          `GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${
            jsonError instanceof Error ? jsonError.message : "Unknown parse error"
          }`,
        );
      }

      try {
        const credentials = JSON.parse(repaired);
        return normalizeCredentials(credentials);
      } catch (parseError) {
        throw new Error(
          `GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${
            parseError instanceof Error ? parseError.message : "Unknown parse error"
          }`,
        );
      }
    }
  }
}

function normalizeCredentials(credentials: unknown) {
  if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must contain a JSON object.");
  }

  const normalized = credentials as Record<string, unknown>;
  if (
    "private_key" in normalized &&
    typeof normalized.private_key === "string"
  ) {
    normalized.private_key = normalized.private_key.replace(/\\n/g, "\n");
  }

  return normalized;
}

function repairJsonWithLiteralNewlines(value: string): string | null {
  let result = "";
  let inString = false;
  let escaped = false;
  let stringQuote: '"' | "'" | null = null;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }

    if (inString) {
      if (char === stringQuote) {
        inString = false;
        stringQuote = null;
        result += char;
      } else if (char === "\n" || char === "\r") {
        result += "\\n";
      } else {
        result += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      result += '"';
      continue;
    }

    result += char;
  }

  return inString ? null : result;
}

async function getAdmin(): Promise<admin_directory_v1.Admin> {
  if (cachedClient) return cachedClient;
  const auth = getAuth(DIRECTORY_SCOPES);
  cachedClient = google.admin({ version: "directory_v1", auth });
  return cachedClient;
}

async function getReportsAdmin(): Promise<admin_reports_v1.Admin> {
  if (cachedReportsClient) return cachedReportsClient;
  const auth = getAuth(REPORTS_SCOPES);
  cachedReportsClient = google.admin({ version: "reports_v1", auth });
  return cachedReportsClient;
}

function isReportsDataUnavailableError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = "code" in err ? err.code : "status" in err ? err.status : undefined;
  // The Reports API returns 400/404 for dates it hasn't generated usage data
  // for yet (recent days, or accounts too new to have a report). Treat those
  // as "not available", distinct from real errors like 403 (missing scope).
  return code === 400 || code === 404;
}

/**
 * Best-effort total storage usage (Gmail + Drive + Photos, in MB) via the
 * Admin Reports API. Usage reports typically lag 1-3 days behind, so this
 * walks backward from yesterday looking for the most recent available report.
 * Returns null if no report is available in that window (e.g. a brand-new
 * account) — callers should treat that as "unknown", not an error.
 */
export async function getUserStorageUsageMB(email: string): Promise<number | null> {
  const admin = await getReportsAdmin();

  for (let daysAgo = 1; daysAgo <= 5; daysAgo++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - daysAgo);
    const dateStr = date.toISOString().slice(0, 10);

    try {
      const res = await admin.userUsageReport.get({
        userKey: email,
        date: dateStr,
        parameters: "accounts:used_quota_in_mb",
      });
      const raw = res.data.usageReports?.[0]?.parameters?.find(
        (p) => p.name === "accounts:used_quota_in_mb",
      )?.intValue;
      if (raw !== undefined && raw !== null) return Number(raw);
    } catch (err: unknown) {
      if (!isReportsDataUnavailableError(err)) throw err;
    }
  }

  return null;
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
    if (!isNotFoundError(err)) {
      throw err;
    }
  }

  return findWorkspaceAccountByEmployeeId(employeeId, firstName);
}

/**
 * Looks up a Workspace account by its exact email address, with no fallback.
 * Used to check whether an old/legacy email still exists in Workspace.
 */
export async function getWorkspaceAccountByEmail(
  email: string,
): Promise<WorkspaceAccount | null> {
  const admin = await getAdmin();

  try {
    const user = await admin.users.get({ userKey: email });
    const primaryEmail = user.data.primaryEmail;
    if (!primaryEmail) return null;

    // isNewFormat needs an employeeId to compare against; derive it from the
    // account's own local part (the digits before the first dot), since this
    // lookup has no employeeId of its own to pass in.
    const localPart = primaryEmail.split("@")[0] || "";
    const employeeId = /^(\d+)\./.exec(localPart)?.[1] || "";

    return toWorkspaceAccount(user.data, employeeId, "");
  } catch (err: unknown) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

export async function findWorkspaceAccountByEmployeeId(
  employeeId: string,
  firstName: string,
): Promise<WorkspaceAccount | null> {
  const admin = await getAdmin();
  const domain = getDomain();

  try {
    const res = await admin.users.list({
      domain,
      query: `email:${employeeId}.*`,
      maxResults: 20,
    });

    const matches = (res.data.users || []).filter((user) => {
      const primaryEmail = user.primaryEmail || "";
      return primaryEmail.toLowerCase().startsWith(`${employeeId.toLowerCase()}.`);
    });

    const match = matches[0];
    if (!match?.primaryEmail) return null;

    return toWorkspaceAccount(match, employeeId, firstName);
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

/**
 * Renames the account's primary email. Google Workspace automatically keeps
 * the old address as an alias of the renamed account — that's intentional
 * here (not cleaned up immediately) so the old address keeps working during
 * a grace period. It's tracked in the `alias` table by the approval flow and
 * removed later via the admin panel's Alias tab, not deleted at rename time.
 */
export async function renameAccount(
  oldEmail: string,
  newEmail: string,
): Promise<void> {
  const admin = await getAdmin();
  await admin.users.update({
    userKey: oldEmail,
    requestBody: { primaryEmail: newEmail },
  });
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
