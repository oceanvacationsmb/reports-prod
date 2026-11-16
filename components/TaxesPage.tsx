"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import type { PropertyTaxReport } from "@/lib/reporting/report-taxes";

const months = [
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

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}

async function readReport(month: number, year: number) {
  const response = await fetch(`/api/report-taxes?month=${month}&year=${year}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load report taxes.");
  return data.report as PropertyTaxReport;
}

export function TaxesPage() {
  const today = new Date();
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [year, setYear] = useState(String(today.getFullYear()));
  const [report, setReport] = useState<PropertyTaxReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const years = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];

  useEffect(() => {
    let ignore = false;
    setBusy(true);
    setError("");
    readReport(Number(month), Number(year))
      .then((next) => {
        if (!ignore) setReport(next);
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setReport(null);
          setError(err instanceof Error ? err.message : "Unable to load report taxes.");
        }
      })
      .finally(() => {
        if (!ignore) setBusy(false);
      });
    return () => {
      ignore = true;
    };
  }, [month, year, reloadKey]);

  const canPrint = Boolean(report && !busy && !error);

  return (
    <section className="view-band tax-sheet">
      <form className="control-grid screen-controls" onSubmit={(event) => event.preventDefault()}>
        <label>
          Month
          <select value={month} disabled={busy} onChange={(event) => setMonth(event.target.value)}>
            {months.map((label, index) => (
              <option key={label} value={String(index + 1)}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year
          <select value={year} disabled={busy} onChange={(event) => setYear(event.target.value)}>
            {years.map((value) => (
              <option key={value} value={String(value)}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-action" type="button" onClick={() => window.print()} disabled={!canPrint}>
          <Printer size={18} />
          Print
        </button>
      </form>

      {busy && (
        <p className="helper-line" role="status">
          Loading {months[Number(month) - 1]} {year} taxes...
        </p>
      )}

      {error && (
        <div className="message error" role="alert">
          <span>{error}</span>
          <button className="secondary-action" type="button" onClick={() => setReloadKey((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}

      {!busy && !error && report && report.properties === 0 && (
        <p className="empty-state">No properties are set up yet. Add properties before filing taxes.</p>
      )}

      {!busy && !error && report && report.properties > 0 && (
        <article className="tax-print">
          <header className="tax-print-heading">
            <span>Report Taxes</span>
            <h2>{report.periodLabel}</h2>
          </header>
          <div className="metric-grid">
            <div className="metric">
              <span>Properties</span>
              <strong>{report.properties}</strong>
            </div>
            <div className="metric">
              <span>Reservations used</span>
              <strong>{report.reservationsUsed}</strong>
            </div>
            <div className="metric">
              <span>Amount to report</span>
              <strong>{money(report.amountToReport)}</strong>
            </div>
            <div className="metric">
              <span>Total tax</span>
              <strong>{money(report.totalTax)}</strong>
            </div>
          </div>
          {report.groups.map((group) => (
            <section className="tax-group" key={group.destination}>
              <h2>{group.destination}</h2>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Property name</th>
                      <th>Amount to report</th>
                      <th>Total tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.property}>
                        <td>{row.property}</td>
                        <td>{money(row.amountToReport)}</td>
                        <td>{money(row.totalTax)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total</th>
                      <th>{money(group.amountToReport)}</th>
                      <th>{money(group.totalTax)}</th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ))}
        </article>
      )}
    </section>
  );
}
