export interface EmployeeData {
  employeeId: string;
  employeeType?: string;
  firstName: string;
  lastName?: string;
  fullName: string;
  mobile: string;
  personalEmail: string;
  schoolId?: string;
  macId?: string;
}

export interface TabletRegistrationDetails {
  employeeId?: string;
  employeeType: string;
  name?: string;
  mobile?: string;
  email?: string;
  schoolId?: string;
  registeredDeviceId?: string;
}

export interface WorkspaceAccount {
  primaryEmail: string;
  fullName: string;
  suspended: boolean;
  orgUnitPath?: string;
  lastLoginTime?: string;
  isNewFormat: boolean;
}

export type ActionTaken =
  | "created"
  | "renamed"
  | "updated"
  | "manual_review_multiple_accounts"
  | "error";

export interface ProcessResult {
  employee: EmployeeData;
  expectedUsername: string;
  matchedAccounts: WorkspaceAccount[];
  action: ActionTaken;
  message: string;
  finalAccount?: WorkspaceAccount;
  tempPasswordEmailSent?: boolean;
  logs: string[];
}

export interface ProcessRequestBody {
  employeeId: string;
  oldWorkspaceEmail?: string;
  fullName?: string;
  /** With mobile, lets provisionEmployee skip the live DOE lookup entirely. */
  personalEmail?: string;
  mobile?: string;
  targetWorkspaceEmail?: string;
}

export interface EmployeeDetailsResult {
  employee: EmployeeData;
  expectedUsername: string;
  oldWorkspaceAccount?: WorkspaceAccount;
  logs: string[];
}

export interface TabletDetailsResult {
  employeeId: string;
  employeeType: string;
  employee?: EmployeeData;
  tabletRegistration: TabletRegistrationDetails;
  logs: string[];
}

export interface WorkspaceEmailLookupRequestBody {
  employeeId: string;
  firstName: string;
  oldWorkspaceEmail: string;
}

export interface WorkspaceEmailLookupResult {
  requestedEmail: string;
  account: WorkspaceAccount | null;
  logs: string[];
}

export interface OldMailCheckResult {
  requestedEmail: string;
  found: boolean;
  account: WorkspaceAccount | null;
  logs: string[];
}

/** Existence/status + storage usage for an arbitrary Workspace address, used by the admin review panel. */
export interface WorkspaceAccountStatus {
  account: WorkspaceAccount | null;
  /** Total Gmail+Drive+Photos usage in MB, from the Admin Reports API. Null if unavailable (e.g. brand-new account, data not yet propagated, or no account at all). */
  storageUsedMB: number | null;
}

export interface RemoveAliasRequestBody {
  oldWorkspaceEmails: string[];
}

export interface RemoveAliasItemResult {
  email: string;
  status: "removed" | "failed";
  primaryEmail?: string;
  message: string;
}

export interface RemoveAliasResult {
  total: number;
  removed: number;
  failed: number;
  results: RemoveAliasItemResult[];
  message: string;
  logs: string[];
}

export type RenameRequestStatus = "pending" | "approved" | "rejected";

/** 0 = creation (new account), 1 = reactivation/rename (existing account). */
export type RenameRequestType = 0 | 1;

export interface RenameRequest {
  id: string;
  employeeId: string;
  requestType: RenameRequestType;
  currentEmail: string | null;
  note: string | null;
  status: RenameRequestStatus;
  adminNote: string | null;
  processedBy: string | null;
  processedAt: string | null;
  createdAt: string;
  /** Cached employee details from the submitting app — null for old app builds/older requests. */
  fullName: string | null;
  personalEmail: string | null;
  mobile: string | null;
}

export interface CreateRenameRequestBody {
  employeeId: string;
  requestType: RenameRequestType;
  currentEmail?: string;
  note?: string;
  fullName?: string;
  personalEmail?: string;
  mobile?: string;
}

/**
 * Opaque paging position for listRenameRequests — the last row's sort key.
 * createdAtEpoch is EXTRACT(EPOCH FROM created_at), not an ISO string: a
 * TIMESTAMPTZ round-tripped through the driver as a string loses precision
 * (JS Date is millisecond-only, Postgres stores microseconds), which let the
 * boundary row re-match its own truncated cursor on the next page. A double
 * precision epoch value round-trips losslessly as a JS number.
 */
export interface RenameRequestCursor {
  createdAtEpoch: number;
  id: string;
}

export interface RenameRequestsPage {
  requests: RenameRequest[];
  /** Base64url-encoded RenameRequestCursor, or null if this is the last page. */
  nextCursor: string | null;
}

/**
 * An old address kept as a Workspace alias after a rename/reactivation
 * (see renameAccount() in googleAdmin.ts), pending manual removal from the
 * admin panel's Alias tab.
 */
export interface AliasRecord {
  id: string;
  employeeId: string;
  oldEmail: string;
  newEmail: string;
  requestId: string | null;
  createdAt: string;
}

export interface AliasRemovalItemResult {
  id: string;
  email: string;
  status: "removed" | "failed";
  primaryEmail?: string;
  message: string;
}

export interface AliasRemovalResult {
  total: number;
  removed: number;
  failed: number;
  results: AliasRemovalItemResult[];
  message: string;
}
