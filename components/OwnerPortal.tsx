"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, FileText, LogOut } from "lucide-react";
import type { SessionUser } from "@/lib/types";

type PortalReport = {
  title: string;
  periodLabel: string;
  html: string;
  summary: Record<string, number | string>;
};

type CalendarRow = {
  id: string;
  property: string;
  propertyAddress: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  sourceLabel: string;
  isOwnerStay: boolean;
  isNew: boolean;
};

type PortalData = {
  owner: {
    id: string;
    name: string;
    email: string;
  };
  report: PortalReport;
  calendarRows: CalendarRow[];
  calendarProperties: Array<{ name: string; address: string }>;
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

function dateFromIso(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function calendarCells(year: number, month: number) {
  const blanks = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<{ day: number | null; date: string | null }> = [];
  for (let index = 0; index < blanks; index += 1) cells.push({ day: null, date: null });
  for (let day = 1; day <= lastDay; day += 1) {
    cells.push({ day, date: isoDate(new Date(Date.UTC(year, month - 1, day))) });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, date: null });
  return cells;
}

function rowCoversDate(row: CalendarRow, date: string) {
  const target = dateFromIso(date).getTime();
  const start = dateFromIso(row.checkIn).getTime();
  const end = dateFromIso(row.checkOut).getTime();
  return target >= start && target < end;
}

function downloadFilename(response: Response, fallback: string) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/i);
  return match?.[1] || fallback;
}

export function OwnerPortal({ user }: { user: SessionUser }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [calendarMonth, setCalendarMonth] = useState(today.getMonth() + 1);
  const [calendarProperty, setCalendarProperty] = useState("");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [data, setData] = useState<PortalData | null>(null);
  const [busy, setBusy] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);
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

  useEffect(() => {
    if (month !== "full-year") setCalendarMonth(Number(month));
  }, [month]);

  useEffect(() => {
    const properties = data?.calendarProperties || [];
    if (!properties.some((property) => property.name === calendarProperty)) {
      setCalendarProperty(properties[0]?.name || "");
    }
  }, [data, calendarProperty]);

  const propertyRows = useMemo(
    () => (data?.calendarRows || []).filter((row) => row.property === calendarProperty),
    [data, calendarProperty]
  );
  const cells = useMemo(() => calendarCells(year, calendarMonth), [year, calendarMonth]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  async function downloadPdf() {
    setPdfBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/owner-portal/pdf?year=${year}&month=${month}`);
      if (!response.ok) throw new Error((await response.text()) || "Unable to generate PDF.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadFilename(response, `Owner-Statement-${year}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to download your statement.");
    } finally {
      setPdfBusy(false);
    }
  }

  function moveCalendar(delta: number) {
    setCalendarMonth((current) => {
      const next = current + delta;
      return next < 1 ? 12 : next > 12 ? 1 : next;
    });
  }

  const selectedProperty = data?.calendarProperties.find((property) => property.name === calendarProperty);

  return (
    <main className="owner-statement-shell">
      <header className="owner-statement-header">
        <div>
          <span>Ocean Vacations</span>
          <h1>{data?.owner.name || user.displayName || "Owner Portal"}</h1>
          <p>Owner portal</p>
        </div>
        <button className="secondary-action" onClick={logout}>
          <LogOut size={18} />
          Sign out
        </button>
      </header>

      <section className="control-grid owner-statement-controls">
        <label>
          Period
          <select value={month} onChange={(event) => setMonth(event.target.value)}>
            <option value="full-year">Full year</option>
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
        <button className="secondary-action owner-download-action" type="button" onClick={downloadPdf} disabled={busy || pdfBusy || !data}>
          <Download size={18} />
          {pdfBusy ? "Preparing PDF..." : month === "full-year" ? "Download full-year PDF" : "Download statement PDF"}
        </button>
        <button
          className="secondary-action owner-calendar-toggle-action"
          type="button"
          onClick={() => setCalendarOpen((open) => !open)}
          disabled={busy || !data?.calendarProperties.length}
          aria-expanded={calendarOpen}
          aria-controls="owner-booking-calendar"
        >
          <CalendarDays size={17} />
          {calendarOpen ? "Hide calendar and rates" : "Show calendar and rates"}
          {calendarOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </section>

      {!busy && !error && data && data.calendarProperties.length > 0 && calendarOpen && (
        <section className="owner-calendar-panel" id="owner-booking-calendar">
          <div className="owner-calendar-panel-header">
            <div>
              <span>Booking calendar</span>
              <h2>{monthNames[calendarMonth - 1]} {year}</h2>
              <p>{selectedProperty?.address || calendarProperty}</p>
            </div>
            <div className="owner-calendar-tools">
              {data.calendarProperties.length > 1 && (
                <label>
                  Property
                  <select value={calendarProperty} onChange={(event) => setCalendarProperty(event.target.value)}>
                    {data.calendarProperties.map((property) => (
                      <option key={property.name} value={property.name}>{property.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <div className="owner-calendar-nav">
                <button type="button" onClick={() => moveCalendar(-1)} aria-label="Previous month"><ChevronLeft size={20} /></button>
                <button type="button" onClick={() => moveCalendar(1)} aria-label="Next month"><ChevronRight size={20} /></button>
              </div>
            </div>
          </div>
          <div className="owner-rate-calendar-grid owner-rate-weekdays">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="owner-rate-calendar-grid">
            {cells.map((cell, index) => {
              const matches = cell.date ? propertyRows.filter((row) => rowCoversDate(row, cell.date || "")) : [];
              const reservation = matches.find((row) => !row.isOwnerStay);
              const ownerStay = matches.some((row) => row.isOwnerStay);
              const isNew = matches.some((row) => row.isNew);
              const title = matches.map((row) => row.isOwnerStay
                ? `Owner stay: ${row.guestName}`
                : `${row.sourceLabel}: ${row.guestName}`).join("\n");
              return (
                <div
                  className={`owner-rate-cell${reservation ? " reserved" : ""}${ownerStay ? " owner-stay" : ""}${isNew ? " new" : ""}`}
                  key={`${cell.date || "blank"}-${index}`}
                  title={title}
                >
                  {cell.day && <strong>{cell.day}</strong>}
                  {reservation && <span>{reservation.sourceLabel}</span>}
                  {ownerStay && !reservation && <span>Owner</span>}
                  {isNew && <em>New</em>}
                </div>
              );
            })}
          </div>
          <div className="owner-rate-legend">
            <span><i className="rate-reservation-dot" /> Booked dates show source</span>
            <span><i className="rate-owner-dot" /> Owner stay</span>
            <span><i className="rate-new-dot" /> Newly added</span>
          </div>
        </section>
      )}

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
