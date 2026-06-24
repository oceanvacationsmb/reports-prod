"use client";

import { useState } from "react";
import { Anchor, KeyRound } from "lucide-react";

type Mode = "login" | "reset";

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/reset-password";
      await postJson(path, {
        email,
        password
      });
      if (mode === "reset") {
        setPassword("");
        setMode("login");
        setNotice("Password reset. Sign in with your new password.");
        return;
      }
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError("");
    setNotice("");
  }

  const title = mode === "login" ? "Reports Console" : "Reset Password";

  return (
    <main className="login-screen">
      <section className="login-visual" aria-hidden="true">
        <div className="tidal-mark">
          <Anchor size={54} strokeWidth={1.4} />
        </div>
        <div className="harbor-lines" />
      </section>
      <section className="login-panel">
        <div className="brand-lockup">
          <span>Ocean Vacations</span>
          <h1>{title}</h1>
        </div>
        <form className="stack-form" onSubmit={submit}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </label>
          <label>
            {mode === "reset" ? "New password" : "Password"}
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder={mode === "reset" ? "Choose a new password" : undefined}
              minLength={mode === "login" ? undefined : 10}
              required
            />
          </label>
          {mode === "reset" && <p className="helper-line">Enter the new password you want to use.</p>}
          {mode === "login" && (
            <button className="text-action" onClick={() => switchMode("reset")} type="button">
              Forgot password?
            </button>
          )}
          {notice && <p className="success-line">{notice}</p>}
          {error && <p className="error-line">{error}</p>}
          <button className="primary-action" type="submit" disabled={busy}>
            <KeyRound size={18} />
            {busy ? "Working..." : mode === "login" ? "Sign in" : "Reset password"}
          </button>
          {mode === "reset" && (
            <button className="secondary-action" onClick={() => switchMode("login")} type="button">
              Back to sign in
            </button>
          )}
        </form>
      </section>
    </main>
  );
}
