"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EmployeeDetailsResult,
  ProcessResult,
  RenameRequest,
  RenameRequestStatus,
  RenameRequestType,
} from "@/lib/types";
import ManageAccountsPanel from "./ManageAccountsPanel";

type Tab = "requests" | "manage";

type ReviewState = {
  requestId: string;
  loading: boolean;
  error: string | null;
  details: EmployeeDetailsResult | null;
  fullName: string;
  targetWorkspaceEmail: string;
  adminNote: string;
  submitting: "approve" | "reject" | null;
  result: { tone: "accent" | "danger"; message: string } | null;
};

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RenameRequestStatus | "all">("pending");
  const [review, setReview] = useState<ReviewState | null>(null);
  const [killSwitchEnabled, setKillSwitchEnabled] = useState<boolean | null>(null);
  const [killSwitchBusy, setKillSwitchBusy] = useState(false);
  const [killSwitchError, setKillSwitchError] = useState<string | null>(null);

  const loadRequests = useCallback(async (status: RenameRequestStatus | "all") => {
    try {
      const url =
        status === "all" ? "/api/admin/rename-requests" : `/api/admin/rename-requests?status=${status}`;
      const res = await fetch(url);
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      const data = (await res.json()) as { requests?: RenameRequest[]; error?: string };
      if (!res.ok) {
        setLoadError(data.error || "Failed to load requests.");
        return;
      }
      setLoadError(null);
      setRequests(data.requests || []);
    } catch {
      setLoadError("Network error.");
    }
  }, [router]);

  useEffect(() => {
    // Standard fetch-on-mount/filter-change; the setState happens after the
    // await inside loadRequests, not synchronously in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRequests(filter);
  }, [filter, loadRequests]);

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

  async function openReview(request: RenameRequest) {
    setReview({
      requestId: request.id,
      loading: true,
      error: null,
      details: null,
      fullName: "",
      targetWorkspaceEmail: "",
      adminNote: "",
      submitting: null,
      result: null,
    });

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
            }
          : prev,
      );
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
      loadRequests(filter);
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
      loadRequests(filter);
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
              { key: "requests", label: "Rename requests" },
              { key: "manage", label: "Manage accounts" },
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

        {tab === "requests" && (
          <>
            <div className="mb-6 flex gap-2">
              {(["pending", "approved", "rejected", "all"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                    filter === s ? "bg-(--accent) text-white" : "bg-white text-(--ink-soft) border border-(--rule)"
                  }`}
                >
                  {s}
                </button>
              ))}
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
                  <div className="flex flex-wrap items-center justify-between gap-3">
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
                    </div>
                  </div>

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
          <div className="mb-5">
            <h3 className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
              Employee details
            </h3>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-(--ink-soft)">Employee ID</dt>
                <dd className="font-mono">{request.employeeId}</dd>
              </div>
              <div>
                <dt className="text-xs text-(--ink-soft)">Full Name</dt>
                <dd>{review.details?.employee.fullName || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-(--ink-soft)">Mobile number</dt>
                <dd>{review.details?.employee.mobile || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-(--ink-soft)">Email</dt>
                <dd>{review.details?.employee.personalEmail || "—"}</dd>
              </div>
            </dl>
          </div>

          <div className="mb-4">
            <h3 className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
              Workspace details
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs text-(--ink-soft)">Full name</span>
                <input
                  value={review.fullName}
                  onChange={(e) => onChange({ fullName: e.target.value })}
                  className="mt-1 w-full rounded-sm border border-(--rule) bg-white px-3 py-2 text-sm outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)"
                />
              </label>
              {request.requestType === 1 && (
                <div>
                  <span className="text-xs text-(--ink-soft)">Old Workspace email</span>
                  <p className="mt-1 text-sm font-mono">{request.currentEmail || "—"}</p>
                </div>
              )}
              <label className="block">
                <span className="text-xs text-(--ink-soft)">Target new email</span>
                <input
                  value={review.targetWorkspaceEmail}
                  onChange={(e) => onChange({ targetWorkspaceEmail: e.target.value })}
                  className="mt-1 w-full rounded-sm border border-(--rule) bg-white px-3 py-2 font-mono text-sm font-medium text-(--accent) outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)"
                />
              </label>
            </div>
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
