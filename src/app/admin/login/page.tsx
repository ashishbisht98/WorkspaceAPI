"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Login failed.");
        return;
      }
      const next = searchParams.get("next") || "/admin";
      router.push(next);
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="paper-card w-full max-w-sm rounded-sm p-8 shadow-sm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-(--ink-soft)">
          Directorate of Education &middot; Delhi
        </p>
        <h1 className="mt-1 mb-6 text-xl font-semibold tracking-tight">Admin sign in</h1>

        <label className="mb-1.5 block text-sm font-medium text-(--ink)">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          className="w-full rounded-sm border border-(--rule) bg-white px-3 py-2 font-mono text-sm outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)"
        />

        {error && <p className="mt-3 text-sm text-(--danger)">{error}</p>}

        <button
          type="submit"
          disabled={!password || submitting}
          className="mt-5 w-full rounded-sm bg-(--accent) px-5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
