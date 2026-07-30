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
