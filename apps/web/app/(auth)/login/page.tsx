"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";
import { LoginError } from "./login-error";

function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="w-full rounded-lg border bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:shadow-md hover:bg-primary/90 disabled:opacity-50 transition-all"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/50">
      <div className="w-full max-w-md space-y-8 px-6">
        {/* Logo / Brand */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-primary-foreground text-xl font-bold mb-2">
            LR
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Lead Router</h1>
          <p className="text-sm text-muted-foreground">
            Real-time lead routing for Salesforce
          </p>
        </div>

        {/* Login card */}
        <div className="rounded-xl border bg-card p-8 shadow-lg space-y-6">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Sign in</h2>
            <p className="text-sm text-muted-foreground">
              Enter your credentials to access your account.
            </p>
          </div>

          <Suspense fallback={null}>
            <LoginError />
          </Suspense>

          <LoginForm />

          <p className="text-center text-xs text-muted-foreground">
            Don&apos;t have an account? Contact your administrator for an invite.
          </p>
        </div>
      </div>
    </div>
  );
}
