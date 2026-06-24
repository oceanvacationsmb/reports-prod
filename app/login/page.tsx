"use client";

import { useEffect, useState } from "react";
import { Anchor, KeyRound, Mail } from "lucide-react";

type Mode = "login" | "requestReset" | "setPassword";

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
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (token) {
      setResetToken(token);
      setMode("setPassword");
    }
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "login") {
        await postJson("/api/auth/login", { identifier, password });
        window.location.href = "/dashboard";
        return;
      }

      if (mode === "requestReset") {
        const data = await postJson("/api/auth/request-password-reset", { identifier });
        setNotice(data.message || "If that account exists, a reset link has been sent.");
        return;
      }

      await postJson("/api/auth/reset-password", { token: resetToken, password });
      window.history.replaceState({}, "", "/login");
      setResetToken("");
      setPassword("");
      setMode("login");
      setNotice("Password reset. Sign in with your new password.");
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
    if (nextMode !== "setPassword") {
      setResetToken("");
      if (window.location.search.includes("token=")) window.history.replaceState({}, "", "/login");
    }
    if (nextMode !== "login") {
      setPassword("");
    }
  }

  const title = mode === "login" ? "Reports Console" : mode === "requestReset" ? "Reset Link" : "New Password";

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
        <form className="stack-form" onSubmit={submit} noValidate>
          {mode !== "setPassword" && (
            <label>
              Email or username
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                type="text"
                autoComplete="username"
                required
              />
            </label>
          )}
          {mode !== "requestReset" && (
            <label>
              {mode === "setPassword" ? "New password" : "Password"}
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder={mode === "setPassword" ? "Choose a new password" : undefined}
                minLength={mode === "login" ? undefined : 8}
                required
              />
            </label>
          )}
          {mode === "requestReset" && <p className="helper-line">Enter your email or username and we will email a reset link.</p>}
          {mode === "setPassword" && <p className="helper-line">Enter a new password for this reset link.</p>}
          {mode === "login" && (
            <button className="text-action" onClick={() => switchMode("requestReset")} type="button">
              Forgot password?
            </button>
          )}
          {notice && <p className="success-line">{notice}</p>}
          {error && <p className="error-line">{error}</p>}
          <button className="primary-action" type="submit" disabled={busy}>
            {mode === "requestReset" ? <Mail size={18} /> : <KeyRound size={18} />}
            {busy ? "Working..." : mode === "login" ? "Sign in" : mode === "requestReset" ? "Send reset link" : "Set password"}
          </button>
          {mode !== "login" && (
            <button className="secondary-action" onClick={() => switchMode("login")} type="button">
              Back to sign in
            </button>
          )}
        </form>
      </section>
    </main>
  );
}
