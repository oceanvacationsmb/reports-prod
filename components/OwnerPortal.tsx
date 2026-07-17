"use client";

import { useEffect, useState } from "react";
import { FileText, LogOut } from "lucide-react";
import type { SessionUser } from "@/lib/types";

type PortalReport = {
  title: string;
  periodLabel: string;
  html: string;
  summary: Record<string, number | string>;
};

type PortalData = {
  owner: {
    id: string;
    name: string;
    email: string;
  };
  report: PortalReport;
};

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}

export function OwnerPortal({ user }: { user: SessionUser }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [data, setData] = useState<PortalData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const yearOptions = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    api<{ portal: PortalData }>(`/api/owner-portal?year=${year}&month=${month}`)
      .then((response) => {
        if (active) setData(response.portal);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load your statement.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [year, month]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <main className="owner-statement-shell">
      <header className="owner-statement-header">
        <div>
          <span>Ocean Vacations</span>
          <h1>{data?.owner.name || user.displayName || "Owner Portal"}</h1>
          <p>Owner statement</p>
        </div>
        <button className="secondary-action" onClick={logout}>
          <LogOut size={18} />
          Sign out
        </button>
      </header>

      <form className="control-grid owner-statement-controls">
        <label>
          Month
          <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
            {monthNames.map((name, index) => (
              <option key={name} value={index + 1}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Year
          <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
            {yearOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      </form>

      <section className="owner-statement-stage" aria-busy={busy}>
        {busy && (
          <div className="owner-statement-status">
            <FileText size={20} />
            Loading statement...
          </div>
        )}
        {!busy && error && <div className="message error owner-statement-message">{error}</div>}
        {!busy && !error && data?.report && (
          <div className="report-preview owner-statement-preview" dangerouslySetInnerHTML={{ __html: data.report.html }} />
        )}
      </section>
    </main>
  );
}
