"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AliasRecord, AliasRemovalItemResult } from "@/lib/types";

type RemovalState = {
  tone: "accent" | "danger";
  message: string;
  results?: AliasRemovalItemResult[];
} | null;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function AliasPanel() {
  const router = useRouter();
  const [aliases, setAliases] = useState<AliasRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removalResult, setRemovalResult] = useState<RemovalState>(null);

  const loadAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/aliases");
      if (res.status === 401) {
        router.push("/admin/login");
        return;
      }
      const data = (await res.json()) as { aliases?: AliasRecord[]; error?: string };
      if (!res.ok) {
        setLoadError(data.error || "Failed to load aliases.");
        return;
      }
      setLoadError(null);
      setAliases(data.aliases || []);
    } catch {
      setLoadError("Network error.");
    }
  }, [router]);

  useEffect(() => {
    // Fetch-on-mount; the setState happens after the await inside
    // loadAliases, not synchronously in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAliases();
  }, [loadAliases]);

  async function handleRemoveAll() {
    if (!aliases || aliases.length === 0 || removing) return;
    setRemoving(true);
    setRemovalResult(null);
    try {
      const res = await fetch("/api/admin/aliases/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: aliases.map((a) => a.id) }),
      });
      const data = (await res.json()) as {
        message?: string;
        failed?: number;
        results?: AliasRemovalItemResult[];
        error?: string;
      };
      if (!res.ok) {
        setRemovalResult({ tone: "danger", message: data.error || "Alias removal failed." });
        return;
      }
      setRemovalResult({
        tone: data.failed && data.failed > 0 ? "danger" : "accent",
        message: data.message || "Aliases removed.",
        results: data.results,
      });
      loadAliases();
    } catch {
      setRemovalResult({ tone: "danger", message: "Network error." });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="rounded-sm border border-(--danger)/30 bg-(--danger-soft) p-4 text-sm text-(--danger)">
          {loadError}
        </div>
      )}

      {aliases === null && !loadError && <p className="text-sm text-(--ink-soft)">Loading...</p>}

      {aliases !== null && (
        <div className="paper-card rounded-sm p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
                Aliases pending cleanup
              </h2>
              <p className="mt-1 text-sm text-(--ink-soft)">
                Old addresses kept as Workspace aliases after a rename/reactivation. Remove them
                from Workspace once no longer needed.
              </p>
            </div>
            <button
              onClick={handleRemoveAll}
              disabled={aliases.length === 0 || removing}
              className="rounded-sm border border-(--danger) bg-white px-5 py-2 text-sm font-medium text-(--danger) transition hover:bg-(--danger-soft) disabled:cursor-not-allowed disabled:opacity-40"
            >
              {removing ? "Removing..." : `Remove aliases (${aliases.length})`}
            </button>
          </div>

          {aliases.length === 0 ? (
            <p className="text-sm text-(--ink-soft)">No aliases pending removal.</p>
          ) : (
            <ul className="divide-y divide-(--rule)">
              {aliases.map((alias) => (
                <li
                  key={alias.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
                >
                  <div>
                    <p className="font-mono text-xs font-medium">{alias.employeeId}</p>
                    <p className="font-mono text-xs text-(--ink-soft)">
                      {alias.oldEmail} &rarr; {alias.newEmail}
                    </p>
                  </div>
                  <span className="text-xs text-(--ink-soft)">{formatDate(alias.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}

          {removalResult && (
            <div
              className={`mt-4 rounded-sm border px-4 py-3 text-sm ${
                removalResult.tone === "accent"
                  ? "border-[var(--accent)]/25 bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--danger)]/25 bg-[var(--danger-soft)] text-[var(--danger)]"
              }`}
            >
              <p>{removalResult.message}</p>
              {removalResult.results && removalResult.results.length > 0 && (
                <ul className="mt-3 divide-y divide-(--rule) border-t border-(--rule)">
                  {removalResult.results.map((item) => (
                    <li
                      key={item.id}
                      className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
