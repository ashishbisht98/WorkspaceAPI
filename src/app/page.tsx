"use client";

import { useState } from "react";
import {
  EmployeeDetailsResult,
  ProcessResult,
  RemoveAliasResult,
  TabletDetailsResult,
  WorkspaceEmailLookupResult,
} from "@/lib/types";

type ViewState =
  | { status: "idle" }
  | { status: "loading"; action: "details" | "process" | "tablet" }
  | { status: "error"; message: string; logs?: string[] }
  | { status: "details"; result: EmployeeDetailsResult }
  | { status: "tablet-details"; result: TabletDetailsResult }
  | { status: "done"; result: ProcessResult };

type TabletActionState = {
  action: "unregister" | "reset" | null;
  tone: "accent" | "danger";
  message: string;
};

type AliasRemovalState = {
  tone: "accent" | "danger";
  message: string;
  results?: RemoveAliasResult["results"];
  logs?: string[];
};

const ACTION_LABELS: Record<string, { label: string; tone: "accent" | "gold" | "danger" }> = {
  created: { label: "Account created", tone: "accent" },
  renamed: { label: "Account renamed", tone: "gold" },
  updated: { label: "Details updated", tone: "accent" },
  manual_review_multiple_accounts: { label: "Needs manual review", tone: "danger" },
  error: { label: "Error", tone: "danger" },
};

export default function Home() {
  const [employeeId, setEmployeeId] = useState("");
  const [oldEmail, setOldEmail] = useState("");
  const [aliasEmails, setAliasEmails] = useState("");
  const [view, setView] = useState<ViewState>({ status: "idle" });
  const [provisioning, setProvisioning] = useState(false);
  const [removingAlias, setRemovingAlias] = useState(false);
  const [aliasRemovalResult, setAliasRemovalResult] = useState<AliasRemovalState | null>(null);

  const idValid = /^\d{8}$/.test(employeeId);
  const tabletIdValid = /^\d{8,10}$/.test(employeeId);
  const parsedAliasEmails = parseEmailList(aliasEmails);
  const invalidAliasEmails = parsedAliasEmails.filter((email) => !isValidEmail(email));
  const aliasEmailsValid = parsedAliasEmails.length > 0 && invalidAliasEmails.length === 0;

  async function handleProvision(values: { fullName: string; targetWorkspaceEmail: string }) {
    if (!idValid) return;
    setProvisioning(true);
    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          oldWorkspaceEmail: oldEmail.trim() || undefined,
          fullName: values.fullName,
          targetWorkspaceEmail: values.targetWorkspaceEmail,
        }),
      });
      const data = (await res.json()) as Partial<ProcessResult> & {
        error?: string;
        logs?: string[];
      };
      if (!res.ok) {
        setView({ status: "error", message: data.error || "Request failed", logs: data.logs });
        return;
      }
      setView({ status: "done", result: data as ProcessResult });
    } catch (err: unknown) {
      setView({ status: "error", message: getErrorMessage(err) });
    } finally {
      setProvisioning(false);
    }
  }

  async function handleGetDetails() {
    if (!idValid) return;
    setView({ status: "loading", action: "details" });
    try {
      const res = await fetch("/api/employee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      const data = (await res.json()) as Partial<EmployeeDetailsResult> & {
        error?: string;
        logs?: string[];
      };
      if (!res.ok) {
        setView({ status: "error", message: data.error || "Request failed", logs: data.logs });
        return;
      }
      const employeeDetails = data as EmployeeDetailsResult;
      const trimmedOldEmail = oldEmail.trim();

      if (!trimmedOldEmail) {
        setView({ status: "details", result: employeeDetails });
        return;
      }

      const workspaceRes = await fetch("/api/workspace-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          firstName: employeeDetails.employee.firstName,
          oldWorkspaceEmail: trimmedOldEmail,
        }),
      });
      const workspaceData = (await workspaceRes.json()) as Partial<WorkspaceEmailLookupResult> & {
        error?: string;
        logs?: string[];
      };
      const logs = [...employeeDetails.logs, ...(workspaceData.logs || [])];

      if (!workspaceRes.ok) {
        setView({
          status: "error",
          message: workspaceData.error || "Workspace email lookup failed",
          logs,
        });
        return;
      }

      setView({
        status: "details",
        result: {
          ...employeeDetails,
          oldWorkspaceAccount: workspaceData.account || undefined,
          logs,
        },
      });
    } catch (err: unknown) {
      setView({ status: "error", message: getErrorMessage(err) });
    }
  }

  async function handleGetTabletDetails() {
    if (!tabletIdValid) return;
    setView({ status: "loading", action: "tablet" });
    try {
      const res = await fetch("/api/tablet/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      const data = (await res.json()) as Partial<TabletDetailsResult> & {
        error?: string;
        logs?: string[];
      };
      if (!res.ok) {
        setView({ status: "error", message: data.error || "Request failed", logs: data.logs });
        return;
      }
      setView({ status: "tablet-details", result: data as TabletDetailsResult });
    } catch (err: unknown) {
      setView({ status: "error", message: getErrorMessage(err) });
    }
  }

  async function handleRemoveAlias() {
    if (!aliasEmailsValid) return;
    setRemovingAlias(true);
    setAliasRemovalResult(null);
    try {
      const res = await fetch("/api/workspace-alias/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldWorkspaceEmails: parsedAliasEmails }),
      });
      const data = (await res.json()) as Partial<RemoveAliasResult> & {
        error?: string;
        logs?: string[];
      };

      if (!res.ok) {
        setAliasRemovalResult({
          tone: "danger",
          message: data.error || "Alias removal failed.",
          logs: data.logs,
        });
        return;
      }

      setAliasRemovalResult({
        tone: data.failed && data.failed > 0 ? "danger" : "accent",
        message: data.message || "Alias removed successfully.",
        results: data.results,
        logs: data.logs,
      });
      if (!data.failed) {
        setAliasEmails("");
      }
    } catch (err: unknown) {
      setAliasRemovalResult({
        tone: "danger",
        message: getErrorMessage(err),
      });
    } finally {
      setRemovingAlias(false);
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-14">
        {/* Header */}
        <header className="mb-10 flex items-baseline justify-between border-b border-(--rule) pb-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
              Directorate of Education &middot; Delhi
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Workspace Account Register
            </h1>
          </div>
          <p className="hidden font-mono text-xs text-(--ink-soft) sm:block">
            doe.delhi.gov.in
          </p>
        </header>

        {/* Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleGetDetails();
          }}
          className="paper-card mb-10 rounded-sm p-6 shadow-sm"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-(--ink)">
                Employee ID <span className="text-(--danger)">*</span>
              </label>
              <input
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="20162345"
                inputMode="numeric"
                className="w-full rounded-sm border border-(--rule) bg-white px-3 py-2 font-mono text-sm outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)"
              />
              {employeeId.length > 0 && !tabletIdValid && (
                <p className="mt-1 text-xs text-(--danger)">Must be 8 to 10 digits.</p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-(--ink)">
                Old Workspace email <span className="text-(--ink-soft)">(optional)</span>
              </label>
              <input
                value={oldEmail}
                onChange={(e) => setOldEmail(e.target.value)}
                placeholder="satish.kumar@doe.delhi.gov.in"
                className="w-full rounded-sm border border-(--rule) bg-white px-3 py-2 font-mono text-sm outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-(--ink-soft)">
              Target format:&nbsp;
              <span className="font-mono">employeeid.firstname@doe.delhi.gov.in</span>
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleGetDetails}
                disabled={!idValid || view.status === "loading"}
                className="rounded-sm border border-(--accent) bg-white px-5 py-2 text-sm font-medium text-(--accent) transition hover:bg-(--accent-soft) disabled:cursor-not-allowed disabled:opacity-40"
              >
                {view.status === "loading" && view.action === "details"
                  ? "Fetching..."
                  : "Get Details"}
              </button>
              <button
                type="button"
                onClick={handleGetTabletDetails}
                disabled={!tabletIdValid || view.status === "loading"}
                className="rounded-sm bg-(--gold) px-5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {view.status === "loading" && view.action === "tablet"
                  ? "Fetching..."
                  : "Tab details"}
              </button>
            </div>
          </div>
        </form>

        {/* Result */}
        {view.status === "error" && (
          <div className="rounded-sm border border-(--danger)/30 bg-(--danger-soft) p-5">
            <p className="text-sm font-medium text-(--danger)">{view.message}</p>
            {view.logs && view.logs.length > 0 && <LogList logs={view.logs} tone="danger" />}
          </div>
        )}

        {view.status === "details" && (
          <EmployeeDetailsPanel
            result={view.result}
            isProvisioning={provisioning}
            onProvision={handleProvision}
          />
        )}

        {view.status === "tablet-details" && <TabletDetailsPanel result={view.result} />}

        {view.status === "done" && <ResultPanel result={view.result} />}

        <RemoveAliasCard
          aliasEmails={aliasEmails}
          onAliasEmailsChange={setAliasEmails}
          isRemoving={removingAlias}
          canRemove={aliasEmailsValid}
          emailCount={parsedAliasEmails.length}
          invalidEmails={invalidAliasEmails}
          result={aliasRemovalResult}
          onRemoveAlias={handleRemoveAlias}
        />
      </div>
    </main>
  );
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Network error";
}

function EmployeeDetailsPanel({
  result,
  isProvisioning,
  onProvision,
}: {
  result: EmployeeDetailsResult;
  isProvisioning: boolean;
  onProvision: (values: { fullName: string; targetWorkspaceEmail: string }) => void;
}) {
  const [fullName, setFullName] = useState(result.employee.fullName);
  const [targetWorkspaceEmail, setTargetWorkspaceEmail] = useState(result.expectedUsername);
  const canProvision = fullName.trim().length > 0 && isValidEmail(targetWorkspaceEmail);
  const provisionButtonLabel =
    result.oldWorkspaceAccount?.primaryEmail === targetWorkspaceEmail.trim()
      ? "Activate account"
      : result.oldWorkspaceAccount
        ? "Rename & Activate"
        : "Create Account";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-sm border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-5 py-3 text-[var(--accent)]">
        <span className="text-sm font-semibold uppercase tracking-wide">Employee details</span>
        <span className="font-mono text-xs opacity-80">Record #{result.employee.employeeId}</span>
      </div>

      <EditableEmployeeRecordCard
        employee={result.employee}
        fullName={fullName}
        onFullNameChange={setFullName}
        targetWorkspaceEmail={targetWorkspaceEmail}
        onTargetWorkspaceEmailChange={setTargetWorkspaceEmail}
        oldWorkspaceAccount={result.oldWorkspaceAccount}
        isProvisioning={isProvisioning}
        canProvision={canProvision}
        buttonLabel={provisionButtonLabel}
        onProvision={() =>
          onProvision({
            fullName: fullName.trim(),
            targetWorkspaceEmail: targetWorkspaceEmail.trim(),
          })
        }
      />

      <details className="paper-card rounded-sm p-6 shadow-sm">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
          Lookup log
        </summary>
        <LogList logs={result.logs} tone="accent" />
      </details>
    </div>
  );
}

function TabletDetailsPanel({ result }: { result: TabletDetailsResult }) {
  const registration = result.tabletRegistration;
  const employeeType =
    registration.employeeType || (result.employeeId.length === 8 ? "government" : "guest");
  const schoolId = registration.schoolId || "";
  const macId = registration.registeredDeviceId || "";
  const fullName = result.employee?.fullName || registration.name || "";
  const mobile = result.employee?.mobile || registration.mobile || "";
  const personalEmail = result.employee?.personalEmail || registration.email || "";
  const [tabletAction, setTabletAction] = useState<"unregister" | "reset" | null>(null);
  const [tabletResult, setTabletResult] = useState<TabletActionState | null>(null);
  const canResetPassword = result.employeeId.length > 8;

  async function handleTabletAction(
    action: "unregister" | "reset",
    url: string,
    body: Record<string, string>,
  ) {
    setTabletAction(action);
    setTabletResult(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { message?: string; error?: string };

      if (!res.ok) {
        setTabletResult({
          action,
          tone: "danger",
          message: data.error || "Request failed",
        });
        return;
      }

      setTabletResult({
        action,
        tone: "accent",
        message: data.message || "Request completed successfully.",
      });
    } catch (err: unknown) {
      setTabletResult({
        action,
        tone: "danger",
        message: getErrorMessage(err),
      });
    } finally {
      setTabletAction(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-sm border border-[var(--gold)]/30 bg-[var(--gold-soft)] px-5 py-3 text-[var(--gold)]">
        <span className="text-sm font-semibold uppercase tracking-wide">Tablet details</span>
        <span className="font-mono text-xs opacity-80">Record #{result.employeeId}</span>
      </div>

      <TabletActionsCard
        employeeId={result.employeeId}
        employeeType={employeeType}
        schoolId={schoolId}
        macId={macId}
        fullName={fullName}
        mobile={mobile}
        personalEmail={personalEmail}
        activeAction={tabletAction}
        actionResult={tabletResult}
        canResetPassword={canResetPassword}
        showPasswordReset={result.employeeId.length > 8}
        onUnregister={() =>
          handleTabletAction("unregister", "/api/tablet/unregister", {
            employeeId: result.employeeId,
            employeeType: employeeType.trim(),
            fullName,
            personalEmail,
          })
        }
        onResetPassword={() =>
          handleTabletAction("reset", "/api/guest/password-reset", {
            employeeId: result.employeeId,
            schoolId: schoolId.trim(),
            macId: macId.trim(),
            fullName,
            personalEmail,
          })
        }
      />

      <details className="paper-card rounded-sm p-6 shadow-sm">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
          Tablet lookup log
        </summary>
        <LogList logs={result.logs} tone="accent" />
      </details>
    </div>
  );
}

function TabletActionsCard({
  employeeId,
  employeeType,
  schoolId,
  macId,
  fullName,
  mobile,
  personalEmail,
  activeAction,
  actionResult,
  canResetPassword,
  showPasswordReset,
  onUnregister,
  onResetPassword,
}: {
  employeeId: string;
  employeeType: string;
  schoolId: string;
  macId: string;
  fullName: string;
  mobile: string;
  personalEmail: string;
  activeAction: "unregister" | "reset" | null;
  actionResult: TabletActionState | null;
  canResetPassword: boolean;
  showPasswordReset: boolean;
  onUnregister: () => void;
  onResetPassword: () => void;
}) {
  return (
    <div className="paper-card rounded-sm p-6 shadow-sm">
      <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
        Tablet and guest teacher actions
      </h2>

      <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        <ReadOnlyField label="Employee ID" value={employeeId} mono />
        <ReadOnlyField label="Employee type" value={employeeType} />
        <ReadOnlyField label="Full name" value={fullName} />
        <ReadOnlyField label="Mobile number" value={mobile} mono />
        <ReadOnlyField label="Email" value={personalEmail} />
        <ReadOnlyField label="School ID" value={schoolId} mono />
        <ReadOnlyField label="Registered device ID" value={macId} mono />
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onUnregister}
          disabled={activeAction !== null}
          className="rounded-sm border border-(--danger) bg-white px-5 py-2 text-sm font-medium text-(--danger) transition hover:bg-(--danger-soft) disabled:cursor-not-allowed disabled:opacity-40"
        >
          {activeAction === "unregister" ? "De-registering..." : "De-register employee"}
        </button>
        {showPasswordReset && (
          <button
            type="button"
            onClick={onResetPassword}
            disabled={!canResetPassword || activeAction !== null}
            className="rounded-sm bg-(--gold) px-5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {activeAction === "reset" ? "Resetting..." : "Reset guest teacher password"}
          </button>
        )}
      </div>

      {actionResult && (
        <p
          className={`mt-4 rounded-sm border px-4 py-3 text-sm ${
            actionResult.tone === "accent"
              ? "border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--danger)]/25 bg-[var(--danger-soft)] text-[var(--danger)]"
          }`}
        >
          {actionResult.message}
        </p>
      )}
    </div>
  );
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function parseEmailList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

function RemoveAliasCard({
  aliasEmails,
  onAliasEmailsChange,
  isRemoving,
  canRemove,
  emailCount,
  invalidEmails,
  result,
  onRemoveAlias,
}: {
  aliasEmails: string;
  onAliasEmailsChange: (value: string) => void;
  isRemoving: boolean;
  canRemove: boolean;
  emailCount: number;
  invalidEmails: string[];
  result: AliasRemovalState | null;
  onRemoveAlias: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onRemoveAlias();
      }}
      className="paper-card mt-10 rounded-sm p-6 shadow-sm"
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
            Remove old email aliases
          </h2>
          <p className="mt-1 text-sm text-(--ink-soft)">
            Paste a list of old Workspace email aliases. No emails are sent.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-start">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-(--ink)">
            Old email aliases
          </span>
          <textarea
            value={aliasEmails}
            onChange={(e) => onAliasEmailsChange(e.target.value)}
            placeholder={"old.name@doe.delhi.gov.in\nanother.old@doe.delhi.gov.in"}
            rows={5}
            className="w-full resize-y rounded-sm border border-(--rule) bg-white px-3 py-2 font-mono text-sm outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)"
          />
          <p className="mt-1 text-xs text-(--ink-soft)">
            Separate emails with a new line, comma, semicolon, or space.
          </p>
          {emailCount > 0 && invalidEmails.length === 0 && (
            <p className="mt-1 text-xs text-(--accent)">
              {emailCount} valid email{emailCount === 1 ? "" : "s"} ready.
            </p>
          )}
          {invalidEmails.length > 0 && (
            <p className="mt-1 text-xs text-(--danger)">
              Invalid: {invalidEmails.join(", ")}
            </p>
          )}
        </label>

        <button
          type="submit"
          disabled={!canRemove || isRemoving}
          className="mt-0 rounded-sm border border-(--danger) bg-white px-5 py-2 text-sm font-medium text-(--danger) transition hover:bg-(--danger-soft) disabled:cursor-not-allowed disabled:opacity-40 sm:mt-6"
        >
          {isRemoving ? "Removing..." : "Remove aliases"}
        </button>
      </div>

      {result && (
        <div
          className={`mt-4 rounded-sm border px-4 py-3 text-sm ${
            result.tone === "accent"
              ? "border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--danger)]/25 bg-[var(--danger-soft)] text-[var(--danger)]"
          }`}
        >
          <p>{result.message}</p>
          {result.results && result.results.length > 0 && (
            <ul className="mt-3 divide-y divide-(--rule) border-t border-(--rule)">
              {result.results.map((item) => (
                <li key={item.email} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-mono text-xs">{item.email}</span>
                  <span
                    className={`text-xs ${
                      item.status === "removed" ? "text-(--accent)" : "text-(--danger)"
                    }`}
                  >
                    {item.status === "removed" ? item.message : `Failed: ${item.message}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {result.logs && result.logs.length > 0 && (
            <LogList logs={result.logs} tone={result.tone} />
          )}
        </div>
      )}
    </form>
  );
}

function ResultPanel({ result }: { result: ProcessResult }) {
  const action = ACTION_LABELS[result.action] ?? ACTION_LABELS.error;
  const toneClasses = {
    accent: "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/25",
    gold: "bg-[var(--gold-soft)] text-[var(--gold)] border-[var(--gold)]/30",
    danger: "bg-[var(--danger-soft)] text-[var(--danger)] border-[var(--danger)]/25",
  }[action.tone];

  return (
    <div className="space-y-6">
      {/* Status strip */}
      <div className={`flex items-center justify-between rounded-sm border px-5 py-3 ${toneClasses}`}>
        <span className="text-sm font-semibold uppercase tracking-wide">{action.label}</span>
        <span className="font-mono text-xs opacity-80">Record #{result.employee.employeeId}</span>
      </div>

      <EmployeeRecordCard
        employee={result.employee}
        expectedUsername={result.expectedUsername}
      />

      {/* Matched accounts */}
      <div className="paper-card rounded-sm p-6 shadow-sm">
        <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
          Workspace accounts found ({result.matchedAccounts.length})
        </h2>
        {result.matchedAccounts.length === 0 ? (
          <p className="text-sm text-(--ink-soft)">No existing account — a new one was provisioned.</p>
        ) : (
          <ul className="divide-y divide-(--rule)">
            {result.matchedAccounts.map((acc) => (
              <li key={acc.primaryEmail} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="font-mono text-sm">{acc.primaryEmail}</p>
                  <p className="text-xs text-(--ink-soft)">{acc.fullName || "—"}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    acc.isNewFormat
                      ? "bg-(--accent-soft) text-(--accent)"
                      : "bg-(--gold-soft) text-(--gold)"
                  }`}
                >
                  {acc.isNewFormat ? "New format" : "Old format"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Outcome message */}
      <div className="paper-card rounded-sm p-6 shadow-sm">
        <h2 className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
          Outcome
        </h2>
        <p className="text-sm text-(--ink)">{result.message}</p>
        {result.tempPasswordEmailSent && (
          <p className="mt-2 text-xs text-(--ink-soft)">
            A temporary password with forced change at next login was set, and sign-in
            instructions were emailed to the employee&apos;s personal address.
          </p>
        )}
      </div>

      {/* Log */}
      <details className="paper-card rounded-sm p-6 shadow-sm">
        <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
          Processing log
        </summary>
        <LogList logs={result.logs} tone="accent" />
      </details>
    </div>
  );
}

function EmployeeRecordCard({
  employee,
  expectedUsername,
  oldWorkspaceAccount,
}: {
  employee: EmployeeDetailsResult["employee"];
  expectedUsername: string;
  oldWorkspaceAccount?: EmployeeDetailsResult["oldWorkspaceAccount"];
}) {
  return (
    <div className="paper-card rounded-sm p-6 shadow-sm">
      <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
        Employee record
      </h2>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        <Field label="Name" value={employee.fullName} />
        <Field label="Employee ID" value={employee.employeeId} mono />
        <Field label="Mobile" value={employee.mobile} mono />
        <Field label="Personal email" value={employee.personalEmail} mono />
        {oldWorkspaceAccount && (
          <>
            <Field label="Old account Name" value={oldWorkspaceAccount.fullName} />
            <Field label="Old Workspace email" value={oldWorkspaceAccount.primaryEmail} mono />
          </>
        )}
        <Field label="Target username" value={expectedUsername} mono highlight />
      </dl>
    </div>
  );
}

function EditableEmployeeRecordCard({
  employee,
  fullName,
  onFullNameChange,
  targetWorkspaceEmail,
  onTargetWorkspaceEmailChange,
  oldWorkspaceAccount,
  isProvisioning,
  canProvision,
  buttonLabel,
  onProvision,
}: {
  employee: EmployeeDetailsResult["employee"];
  fullName: string;
  onFullNameChange: (value: string) => void;
  targetWorkspaceEmail: string;
  onTargetWorkspaceEmailChange: (value: string) => void;
  oldWorkspaceAccount?: EmployeeDetailsResult["oldWorkspaceAccount"];
  isProvisioning: boolean;
  canProvision: boolean;
  buttonLabel: string;
  onProvision: () => void;
}) {
  return (
    <div className="paper-card rounded-sm p-6 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
          Employee record
        </h2>
        <button
          type="button"
          onClick={onProvision}
          disabled={!canProvision || isProvisioning}
          className="rounded-sm bg-(--accent) px-5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isProvisioning ? "Processing..." : buttonLabel}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        <EditableField label="Name" value={fullName} onChange={onFullNameChange} />
        <ReadOnlyField label="Employee ID" value={employee.employeeId} mono />
        <ReadOnlyField label="Mobile" value={employee.mobile} mono />
        <ReadOnlyField label="Personal email" value={employee.personalEmail} mono />
        {oldWorkspaceAccount && (
          <>
            <ReadOnlyField label="Old account Name" value={oldWorkspaceAccount.fullName} />
            <ReadOnlyField
              label="Old Workspace email"
              value={oldWorkspaceAccount.primaryEmail}
              mono
            />
          </>
        )}
        <EditableField
          label="Target username"
          value={targetWorkspaceEmail}
          onChange={onTargetWorkspaceEmailChange}
          mono
          highlight
        />
      </div>
      {!canProvision && (
        <p className="mt-3 text-xs text-(--danger)">
          Name and a valid target email are required before provisioning.
        </p>
      )}
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-(--ink-soft)">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full rounded-sm border border-(--rule) bg-white px-3 py-2 text-sm outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent) ${
          mono ? "font-mono" : ""
        } ${highlight ? "font-medium text-(--accent)" : ""}`}
      />
    </label>
  );
}

function ReadOnlyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-(--ink-soft)">{label}</dt>
      <dd className={`mt-0.5 text-sm ${mono ? "font-mono" : ""}`}>{value || "—"}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-(--ink-soft)">{label}</dt>
      <dd
        className={`mt-0.5 text-sm ${mono ? "font-mono" : ""} ${
          highlight ? "font-medium text-(--accent)" : ""
        }`}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

function LogList({ logs, tone }: { logs: string[]; tone: "accent" | "danger" }) {
  return (
    <ol className="mt-3 space-y-1 border-t border-(--rule) pt-3">
      {logs.map((line, i) => (
        <li key={i} className="flex gap-3 font-mono text-xs text-(--ink-soft)">
          <span className={tone === "danger" ? "text-(--danger)" : "text-(--accent)"}>
            {String(i + 1).padStart(2, "0")}
          </span>
          <span>{line}</span>
        </li>
      ))}
    </ol>
  );
}
