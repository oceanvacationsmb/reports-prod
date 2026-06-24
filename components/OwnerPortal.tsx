"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import type { SessionUser } from "@/lib/types";

type PortalRow = {
  id: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  property: string;
  propertyAddress: string;
  platform: string;
  netAccommodation: number;
  pmc: number;
  ownerPayout: number;
  isOwnerStay: boolean;
};

type PortalData = {
  owner: {
    id: string;
    name: string;
    email: string;
    pmcPercent: number;
    properties: { name: string; address: string }[];
  };
  period: {
    startDate: string;
    endDate: string;
    periodLabel: string;
  };
  summary: {
    totalAccommodation: number;
    totalPmc: number;
    totalOwnerPayout: number;
    bookedNights: number;
    ownerStayNights: number;
    expenses: number;
  };
  reservations: PortalRow[];
  ownerStays: PortalRow[];
  channelPaid: PortalRow[];
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

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}

function portalDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${month}/${day}/${year}`;
}

function expectedPayout(checkOut: string) {
  if (!checkOut) return "";
  const date = dateFromIso(checkOut);
  const payoutDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 5));
  return portalDate(isoDate(payoutDate));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateFromIso(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function firstName(name: string, fallback: string) {
  const cleaned = name.split("-").pop()?.trim() || fallback;
  return cleaned.split(/\s+/)[0] || fallback;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

function rowIsVrbo(row: PortalRow) {
  return row.platform.toLowerCase().includes("vrbo");
}

function buildCalendarRows(year: number, month: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const blanks = first.getUTCDay();
  const cells: Array<{ day: number | null; date: string | null }> = [];
  for (let i = 0; i < blanks; i += 1) cells.push({ day: null, date: null });
  for (let day = 1; day <= lastDay; day += 1) cells.push({ day, date: isoDate(new Date(Date.UTC(year, month - 1, day))) });
  while (cells.length % 7 !== 0) cells.push({ day: null, date: null });
  return cells;
}

function rowCoversDate(row: PortalRow, iso: string) {
  const target = dateFromIso(iso).getTime();
  const start = dateFromIso(row.checkIn).getTime();
  const end = dateFromIso(row.checkOut).getTime();
  return target >= start && target < end;
}

export function OwnerPortal({ user }: { user: SessionUser }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState("all");
  const [calendarMonth, setCalendarMonth] = useState(today.getMonth() + 1);
  const [calendarOpen, setCalendarOpen] = useState(false);
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
        if (active) setError(err instanceof Error ? err.message : "Unable to load owner portal.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [year, month]);

  useEffect(() => {
    if (month !== "all") setCalendarMonth(Number(month));
  }, [month]);

  const allRows = useMemo(() => [...(data?.reservations || []), ...(data?.ownerStays || [])], [data]);
  const calendarCells = useMemo(() => buildCalendarRows(year, calendarMonth), [year, calendarMonth]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function changeCalendar(delta: number) {
    setCalendarMonth((current) => {
      const next = current + delta;
      if (next < 1) {
        setYear((value) => value - 1);
        return 12;
      }
      if (next > 12) {
        setYear((value) => value + 1);
        return 1;
      }
      return next;
    });
  }

  if (error) {
    return (
      <main className="app-shell owner-shell">
        <section className="workspace owner-workspace">
          <h1>Ocean Vacations</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell owner-shell">
      <section className="workspace owner-workspace">
        <section className="owner-portal-card owner-welcome-card">
          <div>
            <span>Ocean Vacations</span>
            <h2>{greeting()} {firstName(data?.owner.name || user.displayName || "", user.displayName || "Owner")}</h2>
            <p>{data?.owner.properties[0]?.address || data?.owner.name || "Owner Account"}</p>
          </div>
          <button className="secondary-action owner-card-signout" onClick={logout}>
            <LogOut size={18} />
            Sign out
          </button>
          <div className="owner-total-line">
            <CalendarDays size={20} />
            <strong>{data?.period.periodLabel || year}</strong>
            <span>Booked nights: {data?.summary.bookedNights || 0}</span>
            <span>Owner stay nights: {data?.summary.ownerStayNights || 0}</span>
          </div>
        </section>

        <form className="control-grid owner-control-grid">
          <label>
            Month
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              <option value="all">All Months</option>
              {monthNames.map((name, index) => (
                <option key={name} value={String(index + 1)}>{name}</option>
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

        <section className="owner-portal-card">
          <div className="panel-heading">
            <h2>Summary</h2>
          </div>
          <div className="metric-grid owner-summary-grid">
          <div>
            <span>PMC %</span>
            <strong>{Math.round((data?.owner.pmcPercent || 0) * 100)}%</strong>
          </div>
          <div>
            <span>Total Accommodation</span>
            <strong>{money(data?.summary.totalAccommodation || 0)}</strong>
          </div>
          <div>
            <span>Total PMC</span>
            <strong>{money(data?.summary.totalPmc || 0)}</strong>
          </div>
          <div>
            <span>Total Owner Payout</span>
            <strong>{money(data?.summary.totalOwnerPayout || 0)}</strong>
          </div>
          <div>
            <span>Booked Nights</span>
            <strong>{data?.summary.bookedNights || 0}</strong>
          </div>
          </div>
        </section>

        <section className={`owner-portal-card owner-calendar-card ${calendarOpen ? "open" : "closed"}`}>
          <div className="owner-calendar-toggle-row">
            <button
              className="owner-calendar-toggle"
              type="button"
              aria-expanded={calendarOpen}
              onClick={() => setCalendarOpen((value) => !value)}
            >
              <CalendarDays size={18} />
              <span>Calendar</span>
              <strong>{monthNames[calendarMonth - 1]} {year}</strong>
              <ChevronDown size={18} />
            </button>
          </div>

          {calendarOpen && (
            <div className="owner-calendar-body">
              <div className="owner-calendar-title">
                <button type="button" onClick={() => changeCalendar(-1)} aria-label="Previous month"><ChevronLeft size={20} /></button>
                <h2>{monthNames[calendarMonth - 1]} {year}</h2>
                <button type="button" onClick={() => changeCalendar(1)} aria-label="Next month"><ChevronRight size={20} /></button>
              </div>
              <div className="owner-calendar-grid owner-calendar-weekdays">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => <span key={day}>{day}</span>)}
              </div>
              <div className="owner-calendar-grid">
                {calendarCells.map((cell, index) => {
                  const matches = cell.date ? allRows.filter((row) => rowCoversDate(row, cell.date || "")) : [];
                  const ownerStay = matches.some((row) => row.isOwnerStay);
                  const vrbo = matches.some((row) => rowIsVrbo(row));
                  const reserved = matches.length > 0;
                  const status = ownerStay ? "owner-stay" : vrbo ? "vrbo" : reserved ? "reservation" : "";
                  return (
                    <div className={`owner-calendar-cell ${status}`} key={`${cell.date || "blank"}-${index}`}>
                      {cell.day && <strong>{cell.day}</strong>}
                      {status && <span>{ownerStay ? "O" : vrbo ? "V" : "R"}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="owner-calendar-legend">
                <span><i className="reservation-dot" /> Reservation</span>
                <span><i className="vrbo-dot" /> VRBO</span>
                <span><i className="owner-dot" /> Owner Stay</span>
              </div>
            </div>
          )}
        </section>

      <OwnerTable
        title="Reservations"
        rows={data?.reservations || []}
        headers={["Guest Name", "Check In", "Check Out", "Net Accommodation", "PMC", "Owner Payout", "Expected Payout"]}
        render={(row) => [
          row.guestName,
          portalDate(row.checkIn),
          portalDate(row.checkOut),
          money(row.netAccommodation),
          money(row.pmc),
          money(row.ownerPayout),
          expectedPayout(row.checkOut)
        ]}
        loading={busy}
      />
      <OwnerTable
        title="Owner Stays"
        rows={data?.ownerStays || []}
        headers={["Check-In", "Check-Out"]}
        render={(row) => [portalDate(row.checkIn), portalDate(row.checkOut)]}
        loading={busy}
      />
      </section>
    </main>
  );
}

function OwnerTable({
  title,
  subtitle,
  rows,
  headers,
  render,
  loading
}: {
  title: string;
  subtitle?: string;
  rows: PortalRow[];
  headers: string[];
  render: (row: PortalRow) => string[];
  loading: boolean;
}) {
  return (
    <section className="owner-portal-card">
      <h2>{title}</h2>
      {subtitle && <p className="owner-table-note">{subtitle}</p>}
      <div className="owner-table-wrap">
        <table className="owner-portal-table">
          <thead>
            <tr>
              {headers.map((header) => <th key={header}>{header}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={headers.length}>Loading...</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={headers.length}>No rows for this period.</td>
              </tr>
            )}
            {!loading && rows.map((row) => (
              <tr key={row.id}>
                {render(row).map((value, index) => <td key={`${row.id}-${index}`}>{value}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
