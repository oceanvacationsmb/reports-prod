"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";

type TaxLine = { line: string; label: string; amount: number; formula: string };

type ScheduleRow = {
  property: string;
  addressLine: string;
  taxableRevenue: number;
  tax: number;
};

type PreparedJurisdiction = {
  settings: { id: string; name: string; formKind: string; hasTemplate: boolean };
  rows: ScheduleRow[];
  result: { timely: boolean; monthsLate: number; lines: TaxLine[]; totalDue: number };
  note: string;
};

type Filing = {
  periodLabel: string;
  jurisdictions: PreparedJurisdiction[];
  unassigned: Array<{ property: string; amountToReport: number }>;
  inactive: Array<{ property: string; amountToReport: number }>;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}

export function TaxFormsPanel({ month, year }: { month: string; year: string }) {
  const [monthsLate, setMonthsLate] = useState("0");
  const [filing, setFiling] = useState<Filing | null>(null);
  const [periodEnding, setPeriodEnding] = useState("");
  const [hospitality, setHospitality] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function preview() {
    setBusy("preview");
    setError("");
    try {
      const response = await fetch(`/api/tax-forms?month=${month}&year=${year}&monthsLate=${monthsLate || "0"}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to preview tax forms.");
      setFiling(data.filing);
      setPeriodEnding(data.periodEnding || "");
      setHospitality(data.surfsideHospitality || "");
    } catch (err) {
      setFiling(null);
      setError(err instanceof Error ? err.message : "Unable to preview tax forms.");
    } finally {
      setBusy("");
    }
  }

  async function download(jurisdictionId: string, name: string) {
    setBusy(jurisdictionId);
    setError("");
    try {
      const response = await fetch("/api/tax-forms/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: Number(month), year: Number(year), monthsLate: Number(monthsLate || 0), jurisdictionId })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Unable to generate the PDF.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name || "tax-form"}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate the PDF.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="editor-panel tax-form-panel">
      <div className="panel-heading">
        <FileText size={18} />
        <h2>Tax forms</h2>
      </div>
      <p className="helper-line">Amounts come from the tax report above. Preview them, then download one PDF per jurisdiction.</p>
      <div className="control-grid screen-controls">
        <label>
          Months late
          <input value={monthsLate} inputMode="numeric" onChange={(event) => setMonthsLate(event.target.value.replace(/[^\d]/g, "").slice(0, 2))} />
        </label>
        <button className="primary-action" type="button" onClick={() => void preview()} disabled={busy === "preview"}>
          <FileText size={18} />
          {busy === "preview" ? "Preparing..." : "Generate Tax Forms"}
        </button>
      </div>
      <p className="helper-line">Leave months late at 0 to file on time. The discount applies, and no penalty is added.</p>

      {error && (
        <div className="message error" role="alert">
          <span>{error}</span>
          <button className="secondary-action" type="button" onClick={() => void preview()}>Retry</button>
        </div>
      )}

      {filing && filing.jurisdictions.length === 0 && (
        <p className="empty-state">No jurisdictions yet. Add one in Settings, assign properties, and upload the official PDF.</p>
      )}

      {filing && (
        <div className="tax-form-results">
          <p className="helper-line">{filing.periodLabel}. Period ending {periodEnding}. {Number(monthsLate) > 0 ? `${monthsLate} month${monthsLate === "1" ? "" : "s"} late.` : "Filing on time."}</p>
          {filing.unassigned.length > 0 && (
            <p className="ten-ninety-nine-note">Not on a form: {filing.unassigned.map((row) => `${row.property} (${money(row.amountToReport)})`).join(", ")}. Assign a jurisdiction in Settings.</p>
          )}
          {filing.inactive.length > 0 && (
            <p className="ten-ninety-nine-note">Not managed this month: {filing.inactive.map((row) => row.property).join(", ")}.</p>
          )}
          {filing.jurisdictions.map((item) => (
            <article className="tax-group" key={item.settings.id}>
              <h2>{item.settings.name}</h2>
              {item.rows.length === 0 && <p className="empty-state">No properties were actively managed in this jurisdiction for this month.</p>}
              {item.rows.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Property</th>
                        <th>Address</th>
                        <th>Taxable revenue</th>
                        <th>Tax</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.rows.map((row) => (
                        <tr key={row.property}>
                          <td>{row.property}</td>
                          <td>{row.addressLine || "Address needed"}</td>
                          <td>{money(row.taxableRevenue)}</td>
                          <td>{money(row.tax)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Line</th>
                      <th>Description</th>
                      <th>Math</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.result.lines.map((line) => (
                      <tr key={line.line}>
                        <td>{line.line}</td>
                        <td>{line.label}</td>
                        <td>{line.formula}</td>
                        <td>{money(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="helper-line">Total due {money(item.result.totalDue)}.</p>
              {item.note && <p className="ten-ninety-nine-note">{item.note}</p>}
              <button
                className="secondary-action"
                type="button"
                disabled={!item.settings.hasTemplate || busy === item.settings.id}
                onClick={() => void download(item.settings.id, item.settings.name)}
              >
                <Download size={16} />
                {busy === item.settings.id ? "Generating..." : item.settings.hasTemplate ? "Download PDF" : "Upload the official PDF in Settings"}
              </button>
            </article>
          ))}
          {hospitality && filing.jurisdictions.some((item) => item.settings.formKind === "surfside") && (
            <p className="ten-ninety-nine-note">{hospitality}</p>
          )}
        </div>
      )}
    </section>
  );
}
