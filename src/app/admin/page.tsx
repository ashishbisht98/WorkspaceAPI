"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EmployeeDetailsResult,
  ProcessResult,
  RenameRequest,
  RenameRequestStatus,
  RenameRequestType,
  WorkspaceAccount,
  WorkspaceAccountStatus,
} from "@/lib/types";
import ManageAccountsPanel from "./ManageAccountsPanel";
import AliasPanel from "./AliasPanel";

type Tab = "requests" | "manage" | "alias";

type AccountStatusState = {
  loading: boolean;
  error: string | null;
  account: WorkspaceAccount | null;
  storageUsedMB: number | null;
};

type ReviewState = {
  requestId: string;
  requestType: RenameRequestType;
  currentEmail: string | null;
  loading: boolean;
  error: string | null;
  details: EmployeeDetailsResult | null;
  fullName: string;
  targetWorkspaceEmail: string;
  adminNote: string;
  submitting: "approve" | "reject" | null;
  result: { tone: "accent" | "danger"; message: string } | null;
  oldAccountStatus: AccountStatusState | null;
  targetAccountStatus: AccountStatusState | null;
};

const STORAGE_LIMIT_MB = 15 * 1024; // 15 GB
const STORAGE_WARNING_NOTE =
  "Note that your accounts exceed the storage limit of 15gb so kindly remove the excess data from this account immediately.";

function formatSubmittedDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function buildAdminNote(requestType: RenameRequestType, personalEmail: string): string {
  return requestType === 0
    ? `Account created and credentials sent to your email: ${personalEmail}`
    : `Account reactivated and credentials sent to your mail: ${personalEmail}`;
}

async function fetchAccountStatus(email: string): Promise<AccountStatusState> {
  try {
    const res = await fetch("/api/admin/workspace-account-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await res.json()) as Partial<WorkspaceAccountStatus> & { error?: string };
    if (!res.ok) {
      return { loading: false, error: data.error || "Lookup failed.", account: null, storageUsedMB: null };
    }
    return { loading: false, error: null, account: data.account ?? null, storageUsedMB: data.storageUsedMB ?? null };
  } catch {
    return { loading: false, error: "Network error.", account: null, storageUsedMB: null };
  }
}

const STATUS_LABEL: Record<RenameRequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_TONE: Record<RenameRequestStatus, string> = {
  pending: "bg-(--gold-soft) text-(--gold)",
  approved: "bg-(--accent-soft) text-(--accent)",
  rejected: "bg-(--danger-soft) text-(--danger)",
};

const REQUEST_TYPE_LABEL: Record<RenameRequestType, string> = {
  0: "Creation",
  1: "Reactivation",
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("requests");
  const [requests, setRequests] = useState<RenameRequest[] | null>(null);
  const requestsFetchSeqRef = useRef(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RenameRequestStatus | "all">("pending");
  const [review, setReview] = useState<ReviewState | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [killSwitchEnabled, setKillSwitchEnabled] = useState<boolean | null>(null);
  const [killSwitchBusy, setKillSwitchBusy] = useState(false);
  const [killSwitchError, setKillSwitchError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusCounts, setStatusCounts] = useState<Record<RenameRequestStatus | "all", number> | null>(null);

  const loadStatusCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/rename-requests/counts");
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      const data = (await res.json()) as {
        counts?: Record<RenameRequestStatus | "all", number>;
        error?: string;
      };
      if (res.ok && data.counts) setStatusCounts(data.counts);
    } catch {
      // Leave statusCounts as-is — the badges just won't update this round.
    }
  }, [router]);

  const loadRequests = useCallback(
    async (opts: {
      status: RenameRequestStatus | "all";
      employeeId: string;
      startDate: string;
      endDate: string;
      cursor?: string | null;
      append?: boolean;
    }) => {
      // Guards against out-of-order responses — e.g. a "Load more" fetch
      // that's still in flight when Approve/Reject triggers a fresh (non-
      // append) reload; without this, the stale append can land after the
      // reload and duplicate rows already present in the new list.
      const seq = ++requestsFetchSeqRef.current;
      try {
        const params = new URLSearchParams();
        if (opts.status !== "all") params.set("status", opts.status);
        if (opts.employeeId) params.set("employeeId", opts.employeeId);
        if (opts.startDate) params.set("startDate", opts.startDate);
        if (opts.endDate) params.set("endDate", opts.endDate);
        if (opts.cursor) params.set("cursor", opts.cursor);

        const res = await fetch(`/api/admin/rename-requests?${params.toString()}`);
        if (res.status === 401) {
          router.push("/admin/login");
          return;
        }
        const data = (await res.json()) as {
          requests?: RenameRequest[];
          nextCursor?: string | null;
          error?: string;
        };
        if (seq !== requestsFetchSeqRef.current) return; // a newer call has since started — drop this stale response
        if (!res.ok) {
          setLoadError(data.error || "Failed to load requests.");
          return;
        }
        setLoadError(null);
        setRequests((prev) => (opts.append ? [...(prev || []), ...(data.requests || [])] : data.requests || []));
        setNextCursor(data.nextCursor ?? null);
      } catch {
        if (seq === requestsFetchSeqRef.current) setLoadError("Network error.");
      }
    },
    [router],
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    // Fresh load (not append) whenever the filter/search/date range changes.
    // The setState happens after the await inside loadRequests, not
    // synchronously in this effect — except resetting the list to show the
    // loading state, which is a deliberate synchronous reset.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRequests(null);
    void loadRequests({ status: filter, employeeId: debouncedSearch, startDate, endDate });
  }, [filter, debouncedSearch, startDate, endDate, loadRequests]);

  useEffect(() => {
    // Fetch-on-mount; the setState happens after the await inside
    // loadStatusCounts, not synchronously in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatusCounts();
  }, [loadStatusCounts]);

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await loadRequests({
      status: filter,
      employeeId: debouncedSearch,
      startDate,
      endDate,
      cursor: nextCursor,
      append: true,
    });
    setLoadingMore(false);
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/kill-switch");
        if (res.status === 401) {
          router.push("/admin/login");
          return;
        }
        const data = (await res.json()) as { enabled?: boolean; error?: string };
        if (res.ok) setKillSwitchEnabled(data.enabled ?? null);
      } catch {
        // Leave killSwitchEnabled null — the toggle just won't render.
      }
    })();
  }, [router]);

  useEffect(() => {
    if (!review || !review.details) return;
    const email = review.targetWorkspaceEmail.trim();
    const requestId = review.requestId;

    if (!email) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReview((prev) => (prev && prev.requestId === requestId ? { ...prev, targetAccountStatus: null } : prev));
      return;
    }

    // Debounce: wait for the admin to stop typing before hitting the Workspace API.
    setReview((prev) =>
      prev && prev.requestId === requestId
        ? { ...prev, targetAccountStatus: { loading: true, error: null, account: null, storageUsedMB: null } }
        : prev,
    );
    const timer = setTimeout(() => {
      fetchAccountStatus(email).then((status) => {
        setReview((prev) =>
          prev && prev.requestId === requestId && prev.targetWorkspaceEmail.trim() === email
            ? { ...prev, targetAccountStatus: status }
            : prev,
        );
      });
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review?.requestId, review?.details, review?.targetWorkspaceEmail]);

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  }

  async function handleToggleKillSwitch() {
    if (killSwitchEnabled === null || killSwitchBusy) return;
    setKillSwitchBusy(true);
    setKillSwitchError(null);
    try {
      const res = await fetch("/api/admin/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !killSwitchEnabled }),
      });
      const data = (await res.json()) as { enabled?: boolean; error?: string };
      if (!res.ok) {
        setKillSwitchError(data.error || "Failed to update.");
        return;
      }
      setKillSwitchEnabled(data.enabled ?? null);
    } catch {
      setKillSwitchError("Network error.");
    } finally {
      setKillSwitchBusy(false);
    }
  }

  function triggerOldAccountStatusCheck(request: RenameRequest) {
    if (request.requestType !== 1 || !request.currentEmail) return;
    const currentEmail = request.currentEmail;
    setReview((prev) =>
      prev && prev.requestId === request.id
        ? { ...prev, oldAccountStatus: { loading: true, error: null, account: null, storageUsedMB: null } }
        : prev,
    );
    fetchAccountStatus(currentEmail).then((status) => {
      setReview((prev) => {
        if (!prev || prev.requestId !== request.id) return prev;
        let adminNote = prev.adminNote;
        if (
          status.storageUsedMB !== null &&
          status.storageUsedMB > STORAGE_LIMIT_MB &&
          !adminNote.includes(STORAGE_WARNING_NOTE)
        ) {
          adminNote = adminNote ? `${adminNote} ${STORAGE_WARNING_NOTE}` : STORAGE_WARNING_NOTE;
        }
        return { ...prev, oldAccountStatus: status, adminNote };
      });
    });
  }

  async function openReview(request: RenameRequest) {
    setReview({
      requestId: request.id,
      requestType: request.requestType,
      currentEmail: request.currentEmail,
      loading: true,
      error: null,
      details: null,
      fullName: "",
      targetWorkspaceEmail: "",
      adminNote: "",
      submitting: null,
      result: null,
      oldAccountStatus: null,
      targetAccountStatus: null,
    });

    const cachedFullName = request.fullName?.trim();
    const cachedPersonalEmail = request.personalEmail?.trim();
    const cachedMobile = request.mobile?.trim();

    // Fast path: the submitting app already sent full name/email/mobile with
    // the request, so skip the live employee-lookup call entirely — just
    // compute the target username (pure formatting, no external I/O).
    if (cachedFullName && cachedPersonalEmail && cachedMobile) {
      try {
        const res = await fetch("/api/admin/expected-username", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId: request.employeeId, fullName: cachedFullName }),
        });
        const data = (await res.json()) as { expectedUsername?: string; error?: string };
        if (!res.ok) {
          setReview((prev) =>
            prev && prev.requestId === request.id
              ? { ...prev, loading: false, error: data.error || "Lookup failed." }
              : prev,
          );
          return;
        }
        const details: EmployeeDetailsResult = {
          employee: {
            employeeId: request.employeeId,
            firstName: cachedFullName.split(/\s+/)[0] || "",
            fullName: cachedFullName,
            mobile: cachedMobile,
            personalEmail: cachedPersonalEmail,
          },
          expectedUsername: data.expectedUsername || "",
          logs: [],
        };
        setReview((prev) =>
          prev && prev.requestId === request.id
            ? {
                ...prev,
                loading: false,
                details,
                fullName: details.employee.fullName,
                targetWorkspaceEmail: prev.targetWorkspaceEmail || details.expectedUsername,
                adminNote: prev.adminNote || buildAdminNote(request.requestType, details.employee.personalEmail),
              }
            : prev,
        );
        triggerOldAccountStatusCheck(request);
      } catch {
        setReview((prev) =>
          prev && prev.requestId === request.id ? { ...prev, loading: false, error: "Network error." } : prev,
        );
      }
      return;
    }

    // Fallback: no cached details (old app build, or a request submitted
    // before this field existed) — do the full live lookup, as before.
    try {
      const res = await fetch("/api/admin/employee-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: request.employeeId, currentEmail: request.currentEmail }),
      });
      const data = (await res.json()) as Partial<EmployeeDetailsResult> & { error?: string };
      if (!res.ok) {
        setReview((prev) =>
          prev && prev.requestId === request.id
            ? { ...prev, loading: false, error: data.error || "Lookup failed." }
            : prev,
        );
        return;
      }
      const details = data as EmployeeDetailsResult;
      setReview((prev) =>
        prev && prev.requestId === request.id
          ? {
              ...prev,
              loading: false,
              details,
              fullName: details.employee.fullName,
              targetWorkspaceEmail: prev.targetWorkspaceEmail || details.expectedUsername,
              adminNote: prev.adminNote || buildAdminNote(request.requestType, details.employee.personalEmail),
            }
          : prev,
      );
      triggerOldAccountStatusCheck(request);
    } catch {
      setReview((prev) =>
        prev && prev.requestId === request.id ? { ...prev, loading: false, error: "Network error." } : prev,
      );
    }
  }

  async function handleApprove(request: RenameRequest) {
    if (!review) return;
    setReview({ ...review, submitting: "approve", result: null });
    try {
      const res = await fetch(`/api/admin/rename-requests/${request.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: review.fullName,
          targetWorkspaceEmail: review.targetWorkspaceEmail,
          adminNote: review.adminNote || undefined,
        }),
      });
      const data = (await res.json()) as { result?: ProcessResult; error?: string };
      if (!res.ok) {
        setReview((prev) => (prev ? { ...prev, submitting: null, result: { tone: "danger", message: data.error || "Approval failed." } } : prev));
        return;
      }
      setReview((prev) =>
        prev
          ? { ...prev, submitting: null, result: { tone: "accent", message: data.result?.message || "Approved." } }
          : prev,
      );
      loadRequests({ status: filter, employeeId: debouncedSearch, startDate, endDate });
      loadStatusCounts();
    } catch {
      setReview((prev) => (prev ? { ...prev, submitting: null, result: { tone: "danger", message: "Network error." } } : prev));
    }
  }

  async function handleReject(request: RenameRequest) {
    if (!review) return;
    setReview({ ...review, submitting: "reject", result: null });
    try {
      const res = await fetch(`/api/admin/rename-requests/${request.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminNote: review.adminNote || undefined }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setReview((prev) => (prev ? { ...prev, submitting: null, result: { tone: "danger", message: data.error || "Rejection failed." } } : prev));
        return;
      }
      setReview((prev) => (prev ? { ...prev, submitting: null, result: { tone: "accent", message: "Request rejected." } } : prev));
      loadRequests({ status: filter, employeeId: debouncedSearch, startDate, endDate });
      loadStatusCounts();
    } catch {
      setReview((prev) => (prev ? { ...prev, submitting: null, result: { tone: "danger", message: "Network error." } } : prev));
    }
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-4xl px-6 py-14">
        <header className="mb-8 flex items-baseline justify-between border-b border-(--rule) pb-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
              Directorate of Education &middot; Delhi
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Admin dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            {killSwitchEnabled !== null && (
              <button
                onClick={handleToggleKillSwitch}
                disabled={killSwitchBusy}
                title={killSwitchEnabled ? "Feature is on — click to turn off" : "Feature is off — click to turn on"}
                className={`rounded-sm border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  killSwitchEnabled
                    ? "border-(--accent) bg-white text-(--accent) hover:bg-(--accent-soft)"
                    : "border-(--danger) bg-(--danger-soft) text-(--danger) hover:opacity-90"
                }`}
              >
                {killSwitchBusy ? "Updating..." : killSwitchEnabled ? "Feature: On" : "Feature: Off"}
              </button>
            )}
            <button
              onClick={handleLogout}
              className="rounded-sm border border-(--rule) bg-white px-4 py-2 text-sm font-medium text-(--ink-soft) transition hover:bg-(--accent-soft)"
            >
              Sign out
            </button>
          </div>
        </header>

        {killSwitchError && (
          <div className="mb-6 rounded-sm border border-(--danger)/30 bg-(--danger-soft) p-4 text-sm text-(--danger)">
            {killSwitchError}
          </div>
        )}

        <div className="mb-8 flex gap-2 border-b border-(--rule)">
          {(
            [
              { key: "requests", label: "Requests" },
              { key: "alias", label: "Alias" },
              { key: "manage", label: "TabMan" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === t.key
                  ? "border-(--accent) text-(--accent)"
                  : "border-transparent text-(--ink-soft) hover:text-(--ink)"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "manage" && <ManageAccountsPanel />}

        {tab === "alias" && <AliasPanel />}

        {tab === "requests" && (
          <>
            <div className="mb-4 flex gap-2">
              {(["pending", "approved", "rejected", "all"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                    filter === s ? "bg-(--accent) text-white" : "bg-white text-(--ink-soft) border border-(--rule)"
                  }`}
                >
                  {s}
                  {statusCounts && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        filter === s ? "bg-white/25 text-white" : "bg-(--rule) text-(--ink-soft)"
                      }`}
                    >
                      {statusCounts[s]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="mb-6 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="block text-xs text-(--ink-soft)">Search employee ID</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g. 20171146"
                  className="mt-1 rounded-sm border border-(--rule) bg-white px-3 py-1.5 text-sm outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-(--ink-soft)">From</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 rounded-sm border border-(--rule) bg-white px-3 py-1.5 text-sm outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-(--ink-soft)">To</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1 rounded-sm border border-(--rule) bg-white px-3 py-1.5 text-sm outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)"
                />
              </label>
              {(search || startDate || endDate) && (
                <button
                  onClick={() => {
                    setSearch("");
                    setStartDate("");
                    setEndDate("");
                  }}
                  className="text-xs text-(--ink-soft) underline underline-offset-2"
                >
                  Clear filters
                </button>
              )}
            </div>

            {loadError && (
              <div className="mb-6 rounded-sm border border-(--danger)/30 bg-(--danger-soft) p-4 text-sm text-(--danger)">
                {loadError}
              </div>
            )}

            {requests === null && !loadError && <p className="text-sm text-(--ink-soft)">Loading...</p>}

            {requests !== null && requests.length === 0 && (
              <p className="text-sm text-(--ink-soft)">No {filter === "all" ? "" : filter} requests.</p>
            )}

            <ul className="space-y-3">
              {requests?.map((request) => (
                <li key={request.id} className="paper-card rounded-sm p-5 shadow-sm">
                  <div
                    className={`flex flex-wrap items-center justify-between gap-3 ${
                      request.status !== "pending" ? "cursor-pointer" : ""
                    }`}
                    onClick={() => {
                      if (request.status === "pending") return;
                      setExpandedId((prev) => (prev === request.id ? null : request.id));
                    }}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-sm font-medium">{request.employeeId}</p>
                        <span className="rounded-full bg-(--rule) px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-(--ink-soft)">
                          {REQUEST_TYPE_LABEL[request.requestType]}
                        </span>
                      </div>
                      {request.currentEmail && (
                        <p className="text-xs text-(--ink-soft)">{request.currentEmail}</p>
                      )}
                      <p className="text-xs text-(--ink-soft)">Submitted {formatSubmittedDate(request.createdAt)}</p>
                      {request.note && <p className="mt-1 text-sm">{request.note}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[request.status]}`}>
                        {STATUS_LABEL[request.status]}
                      </span>
                      {request.status === "pending" && (
                        <button
                          onClick={() => openReview(request)}
                          className="rounded-sm border border-(--accent) bg-white px-4 py-1.5 text-sm font-medium text-(--accent) transition hover:bg-(--accent-soft)"
                        >
                          Review
                        </button>
                      )}
                      {request.status !== "pending" && (
                        <span className="text-xs text-(--ink-soft) underline underline-offset-2">
                          {expandedId === request.id ? "Hide details" : "Show details"}
                        </span>
                      )}
                    </div>
                  </div>

                  {request.status !== "pending" && expandedId === request.id && (
                    <dl className="mt-4 grid gap-3 border-t border-(--rule) pt-4 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-(--ink-soft)">Request ID</dt>
                        <dd className="font-mono text-xs">{request.id}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-(--ink-soft)">Employee ID</dt>
                        <dd className="font-mono">{request.employeeId}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-(--ink-soft)">Request type</dt>
                        <dd>{REQUEST_TYPE_LABEL[request.requestType]}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-(--ink-soft)">Current email</dt>
                        <dd className="font-mono">{request.currentEmail || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-(--ink-soft)">Note</dt>
                        <dd>{request.note || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-(--ink-soft)">Admin note</dt>
                        <dd>{request.adminNote || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-(--ink-soft)">Processed by</dt>
                        <dd>{request.processedBy || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-(--ink-soft)">Processed at</dt>
                        <dd>{request.processedAt ? formatSubmittedDate(request.processedAt) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-(--ink-soft)">Submitted</dt>
                        <dd>{formatSubmittedDate(request.createdAt)}</dd>
                      </div>
                    </dl>
                  )}

                  {review?.requestId === request.id && (
                    <ReviewPanel
                      request={request}
                      review={review}
                      onChange={(patch) => setReview((prev) => (prev ? { ...prev, ...patch } : prev))}
                      onApprove={() => handleApprove(request)}
                      onReject={() => handleReject(request)}
                      onClose={() => setReview(null)}
                    />
                  )}
                </li>
              ))}
            </ul>

            {nextCursor && (
              <div className="mt-6 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="rounded-sm border border-(--rule) bg-white px-5 py-2 text-sm font-medium text-(--ink-soft) transition hover:bg-(--accent-soft) disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loadingMore ? "Loading..." : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function ReviewPanel({
  request,
  review,
  onChange,
  onApprove,
  onReject,
  onClose,
}: {
  request: RenameRequest;
  review: ReviewState;
  onChange: (patch: Partial<ReviewState>) => void;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const canSubmit = review.fullName.trim().length > 0 && review.targetWorkspaceEmail.trim().length > 0;

  return (
    <div className="mt-4 border-t border-(--rule) pt-4">
      {review.loading && <p className="text-sm text-(--ink-soft)">Looking up employee...</p>}
      {review.error && <p className="text-sm text-(--danger)">{review.error}</p>}

      {!review.loading && !review.error && (
        <>
          <div className="mb-5 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-1/2 border-b border-(--rule) pb-2 text-left font-mono text-xs font-medium uppercase tracking-[0.2em] text-(--ink-soft)">
                    Employee details
                  </th>
                  <th className="w-1/2 border-b border-(--rule) py-2 pl-6 text-left font-mono text-xs font-medium uppercase tracking-[0.2em] text-(--ink-soft)">
                    Workspace details
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-2.5 pr-6 align-top">
                    <span className="block text-xs text-(--ink-soft)">Employee ID</span>
                    <span className="font-mono">{request.employeeId}</span>
                  </td>
                  <td className="py-2.5 pl-6 align-top">
                    {request.requestType === 1 ? (
                      <>
                        <span className="block text-xs text-(--ink-soft)">Old Workspace email</span>
                        <span className="font-mono">{request.currentEmail || "—"}</span>
                        <AccountStatusBadge status={review.oldAccountStatus} />
                      </>
                    ) : (
                      <span className="text-(--ink-soft)">— (new account)</span>
                    )}
                  </td>
                </tr>
                <tr className="border-t border-(--rule)/60">
                  <td className="py-2.5 pr-6 align-top">
                    <span className="block text-xs text-(--ink-soft)">Full Name</span>
                    <span>{review.details?.employee.fullName || "—"}</span>
                  </td>
                  <td className="py-2.5 pl-6 align-top">
                    <label className="block">
                      <span className="block text-xs text-(--ink-soft)">Full name (Workspace)</span>
                      <input
                        value={review.fullName}
                        onChange={(e) => onChange({ fullName: e.target.value })}
                        className="mt-1 w-full rounded-sm border border-(--rule) bg-white px-3 py-2 text-sm outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)"
                      />
                    </label>
                  </td>
                </tr>
                <tr className="border-t border-(--rule)/60">
                  <td className="py-2.5 pr-6 align-top">
                    <span className="block text-xs text-(--ink-soft)">Mobile number</span>
                    <span>{review.details?.employee.mobile || "—"}</span>
                  </td>
                  <td className="py-2.5 pl-6 align-top">
                    <label className="block">
                      <span className="block text-xs text-(--ink-soft)">Target new email</span>
                      <input
                        value={review.targetWorkspaceEmail}
                        onChange={(e) => onChange({ targetWorkspaceEmail: e.target.value })}
                        className="mt-1 w-full rounded-sm border border-(--rule) bg-white px-3 py-2 font-mono text-sm font-medium text-(--accent) outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)"
                      />
                    </label>
                    <AccountStatusBadge status={review.targetAccountStatus} />
                  </td>
                </tr>
                <tr className="border-t border-(--rule)/60">
                  <td className="py-2.5 pr-6 align-top">
                    <span className="block text-xs text-(--ink-soft)">Email</span>
                    <span>{review.details?.employee.personalEmail || "—"}</span>
                  </td>
                  <td className="py-2.5 pl-6 align-top" />
                </tr>
              </tbody>
            </table>
          </div>

          <label className="mb-4 block">
            <span className="text-xs text-(--ink-soft)">Admin note (optional)</span>
            <input
              value={review.adminNote}
              onChange={(e) => onChange({ adminNote: e.target.value })}
              className="mt-1 w-full rounded-sm border border-(--rule) bg-white px-3 py-2 text-sm outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)"
            />
          </label>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={onApprove}
          disabled={!canSubmit || review.submitting !== null}
          className="rounded-sm bg-(--accent) px-5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {review.submitting === "approve" ? "Approving..." : "Rename & Activate"}
        </button>
        <button
          onClick={onReject}
          disabled={review.submitting !== null}
          className="rounded-sm border border-(--danger) bg-white px-5 py-2 text-sm font-medium text-(--danger) transition hover:bg-(--danger-soft) disabled:cursor-not-allowed disabled:opacity-40"
        >
          {review.submitting === "reject" ? "Rejecting..." : "Reject"}
        </button>
        <button
          onClick={onClose}
          className="text-sm text-(--ink-soft) underline underline-offset-2"
        >
          Close
        </button>
      </div>

      {review.result && (
        <p
          className={`mt-3 rounded-sm border px-4 py-3 text-sm ${
            review.result.tone === "accent"
              ? "border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--danger)]/25 bg-[var(--danger-soft)] text-[var(--danger)]"
          }`}
        >
          {review.result.message}
        </p>
      )}
    </div>
  );
}

function formatStorage(storageUsedMB: number | null): string {
  if (storageUsedMB === null) return "storage unavailable";
  if (storageUsedMB >= 1024) return `${(storageUsedMB / 1024).toFixed(1)} GB used`;
  return `${storageUsedMB} MB used`;
}

function AccountStatusBadge({ status }: { status: AccountStatusState | null }) {
  if (!status) return null;

  if (status.loading) {
    return <p className="mt-1 text-xs text-(--ink-soft)">Checking...</p>;
  }
  if (status.error) {
    return <p className="mt-1 text-xs text-(--danger)">{status.error}</p>;
  }
  if (!status.account) {
    return <p className="mt-1 text-xs text-(--ink-soft)">No Workspace account at this address.</p>;
  }

  return (
    <p className={`mt-1 text-xs ${status.account.suspended ? "text-(--danger)" : "text-(--gold)"}`}>
      {status.account.suspended ? "Suspended" : "Active"} · {formatStorage(status.storageUsedMB)}
    </p>
  );
}
