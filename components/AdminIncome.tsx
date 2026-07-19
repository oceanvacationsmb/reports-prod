"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, CalendarRange, CircleDollarSign, Landmark, Users } from "lucide-react";
import type {
  AdminIncomeData,
  AdminIncomeOwnerRow,
  AdminIncomePropertyRow,
  AdminIncomeTotals
} from "@/lib/reporting/reports";

type IncomeResponse = {
  income: AdminIncomeData;
  warnings: string[];
};

const monthLabels = [
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

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatMoney(value: number) {
  return money.format(value || 0);
}

function SummaryMetric({ label, value, count = false }: { label: string; value: number; count?: boolean }) {
  return (
    <div className="income-metric">
      <span>{label}</span>
      <strong>{count ? value.toLocaleString("en-US") : formatMoney(value)}</strong>
    </div>
  );
}

function FinancialCells({ row }: { row: AdminIncomeTotals }) {
  return (
    <>
      <td>{formatMoney(row.grossPayout)}</td>
      <td>{formatMoney(row.cleaning)}</td>
      <td>{formatMoney(row.netAccommodation)}</td>
      <td>{formatMoney(row.pmc)}</td>
      <td>{formatMoney(row.websiteVrboFee)}</td>
      <td>{formatMoney(row.expenses)}</td>
      <td>{formatMoney(row.recurringCharges)}</td>
      <td>{formatMoney(row.ownerPayout)}</td>
      <td>{row.bookedNights.toLocaleString("en-US")}</td>
      <td>{row.stays.toLocaleString("en-US")}</td>
    </>
  );
}

function FinancialHeaders() {
  return (
    <>
      <th>Gross payout</th>
      <th>Cleaning</th>
      <th>Net accommodation</th>
      <th>PMC</th>
      <th>Website fees</th>
      <th>Expenses</th>
      <th>Recurring</th>
      <th>Owner payout</th>
      <th>Nights</th>
      <th>Stays</th>
    </>
  );
}

function PropertyRows({ rows }: { rows: AdminIncomePropertyRow[] }) {
  const grouped = useMemo(() => {
    const result = new Map<string, AdminIncomePropertyRow[]>();
    for (const row of rows) result.set(row.area, [...(result.get(row.area) || []), row]);
    return Array.from(result.entries());
  }, [rows]);

  return (
    <table className="income-table">
      <thead>
        <tr>
          <th>Property</th>
          <th>Owner</th>
          <FinancialHeaders />
        </tr>
      </thead>
      {grouped.map(([area, areaRows]) => (
        <tbody key={area}>
          <tr className="income-group-row">
            <th colSpan={12}>{area}</th>
          </tr>
          {areaRows.map((row) => (
            <tr key={`${row.ownerId}:${row.property}`}>
              <td className="income-name-cell">
                <strong>{row.property}</strong>
                {row.address && <span>{row.address}</span>}
              </td>
              <td>{row.owner}</td>
              <FinancialCells row={row} />
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

function OwnerRows({ rows }: { rows: AdminIncomeOwnerRow[] }) {
  return (
    <table className="income-table">
      <thead>
        <tr>
          <th>Owner</th>
          <th>Type</th>
          <th>Properties</th>
          <FinancialHeaders />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.ownerId}>
            <td className="income-name-cell"><strong>{row.owner}</strong></td>
            <td className="income-owner-type">{row.ownerType}</td>
            <td>{row.properties}</td>
            <FinancialCells row={row} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AdminIncome() {
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear, currentYear + 1];
  const [period, setPeriod] = useState("full-year");
  const [year, setYear] = useState(String(currentYear));
  const [breakdown, setBreakdown] = useState<"property" | "owner">("property");
  const [data, setData] = useState<AdminIncomeData | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const search = new URLSearchParams({ year });
    if (period !== "full-year") search.set("month", period);
    setLoading(true);
    setError("");

    fetch(`/api/admin-income?${search}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Income data could not be loaded.");
        return payload as IncomeResponse;
      })
      .then((payload) => {
        setData(payload.income);
        setWarnings(payload.warnings || []);
      })
      .catch((requestError) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "Income data could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [period, year]);

  return (
    <section className="income-page">
      <section className="income-controls">
        <div className="income-section-heading">
          <CalendarRange size={20} />
          <div>
            <span>Portfolio period</span>
            <h2>{data?.periodLabel || (period === "full-year" ? year : `${monthLabels[Number(period) - 1]} ${year}`)}</h2>
          </div>
        </div>
        <div className="income-filter-grid">
          <label>
            Period
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="full-year">Full year</option>
              {monthLabels.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
            </select>
          </label>
          <label>
            Year
            <select value={year} onChange={(event) => setYear(event.target.value)}>
              {years.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </section>

      {error && <div className="message error">{error}</div>}
      {warnings.length > 0 && (
        <details className="income-warning">
          <summary>{warnings.length} owner feed{warnings.length === 1 ? "" : "s"} need attention</summary>
          <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </details>
      )}

      {loading && !data && <div className="income-loading">Loading portfolio income...</div>}

      {data && (
        <>
          <section className={`income-summary${loading ? " is-updating" : ""}`}>
            <div className="income-primary-total">
              <div className="income-primary-icon"><Landmark size={22} /></div>
              <span>Company income</span>
              <strong>{formatMoney(data.summary.companyIncome)}</strong>
              <small>PMC + cleaning + website fees</small>
            </div>
            <div className="income-summary-grid">
              <SummaryMetric label="Gross payout" value={data.summary.grossPayout} />
              <SummaryMetric label="Cleaning" value={data.summary.cleaning} />
              <SummaryMetric label="Net accommodation" value={data.summary.netAccommodation} />
              <SummaryMetric label="My PMC" value={data.summary.pmc} />
              <SummaryMetric label="Website fees" value={data.summary.websiteVrboFee} />
              <SummaryMetric label="Expenses" value={data.summary.expenses} />
              <SummaryMetric label="Recurring charges" value={data.summary.recurringCharges} />
              <SummaryMetric label="Owner payout" value={data.summary.ownerPayout} />
              <SummaryMetric label="Booked nights" value={data.summary.bookedNights} count />
              <SummaryMetric label="Stays" value={data.summary.stays} count />
            </div>
          </section>

          <section className="income-ledger-section">
            <div className="income-section-heading">
              <CircleDollarSign size={20} />
              <div><span>Income ledger</span><h2>Monthly totals</h2></div>
            </div>
            <div className="income-table-wrap">
              <table className="income-table monthly">
                <thead><tr><th>Month</th><th>Company income</th><FinancialHeaders /></tr></thead>
                <tbody>
                  {data.monthly.map((row) => (
                    <tr key={row.month}>
                      <td className="income-name-cell"><strong>{row.label}</strong></td>
                      <td className="income-company-value">{formatMoney(row.companyIncome)}</td>
                      <FinancialCells row={row} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="income-ledger-section">
            <div className="income-breakdown-heading">
              <div className="income-section-heading">
                {breakdown === "property" ? <Building2 size={20} /> : <Users size={20} />}
                <div><span>Portfolio detail</span><h2>Totals by {breakdown}</h2></div>
              </div>
              <div className="income-segments" role="group" aria-label="Income breakdown">
                <button type="button" className={breakdown === "property" ? "active" : ""} onClick={() => setBreakdown("property")}>
                  <Building2 size={16} /> Properties
                </button>
                <button type="button" className={breakdown === "owner" ? "active" : ""} onClick={() => setBreakdown("owner")}>
                  <Users size={16} /> Owners
                </button>
              </div>
            </div>
            <div className="income-table-wrap">
              {breakdown === "property" ? <PropertyRows rows={data.properties} /> : <OwnerRows rows={data.owners} />}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
