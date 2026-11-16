"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Download, Printer } from "lucide-react";
import { reportYearChoices } from "@/lib/reporting/report-options";

type OwnerChoice = {
  _id: string;
  name: string;
  properties?: string[];
};

type GeneratedReport = {
  title: string;
  periodLabel: string;
  html: string;
  ownerId: string;
};

const reportChoices = [{ key: "gri", label: "Gross Rental Income (GRI)" }];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}

export function SimpleReportsPage({ owners, onEditOwner }: { owners: OwnerChoice[]; onEditOwner: (ownerId: string) => void }) {
  const years = reportYearChoices();
  const [reportKey, setReportKey] = useState(reportChoices[0].key);
  const [ownerId, setOwnerId] = useState("");
  const [property, setProperty] = useState("");
  const [year, setYear] = useState(years.defaultYear);
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const owner = owners.find((item) => item._id === ownerId);
  const properties = useMemo(() => {
    const names = (owner?.properties || []).map((name) => name.trim()).filter(Boolean);
    return [...new Set(names)].sort((left, right) => left.localeCompare(right, "en", { numeric: true, sensitivity: "base" }));
  }, [owner]);

  function chooseOwner(nextOwnerId: string) {
    setOwnerId(nextOwnerId);
    setProperty("");
    setReport(null);
    setError("");
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!ownerId || !property) return;
    setBusy("report");
    setError("");
    setReport(null);
    try {
      const data = await api<{ report: { title: string; periodLabel: string; html: string } }>("/api/reports", {
        method: "POST",
        body: JSON.stringify({
          reportKey,
          ownerId,
          property,
          year: Number(year),
          calculationSource: "reports"
        })
      });
      if (!data.report?.html) throw new Error("The report came back empty.");
      setReport({ ...data.report, ownerId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate the report.");
    } finally {
      setBusy("");
    }
  }

  async function download() {
    if (!report) return;
    setBusy("pdf");
    setError("");
    try {
      const saved = await api<{ savedReport: { shareId: string } }>("/api/reports/save", {
        method: "POST",
        body: JSON.stringify({
          ownerId: report.ownerId,
          reportKey,
          reportTitle: report.title,
          periodLabel: report.periodLabel,
          htmlSnapshot: report.html
        })
      });
      const link = document.createElement("a");
      link.href = `/api/reports/pdf/${saved.savedReport.shareId}`;
      link.download = `${report.title || "report"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to download the report.");
    } finally {
      setBusy("");
    }
  }

  const generateDisabled = busy === "report" || !ownerId || !property;

  return (
    <section className="view-band">
      <form className="control-grid screen-controls simple-report-form" onSubmit={generate}>
        <label>
          Report
          <select
            value={reportKey}
            onChange={(event) => {
              setReportKey(event.target.value);
              setReport(null);
              setError("");
            }}
          >
            {reportChoices.map((choice) => (
              <option key={choice.key} value={choice.key}>
                {choice.label}
              </option>
            ))}
          </select>
          <span className="field-hint">Gross rental income is the first report. More can be added later.</span>
        </label>
        <label>
          Owner
          <select value={ownerId} onChange={(event) => chooseOwner(event.target.value)}>
            <option value="">Choose an owner</option>
            {owners.map((item) => (
              <option key={item._id} value={item._id}>
                {item.name}
              </option>
            ))}
          </select>
          {!ownerId && <span className="field-hint">Choose an owner. The properties assigned to that owner load next.</span>}
          {ownerId && properties.length > 0 && <span className="field-hint">{owner?.name} is selected.</span>}
        </label>
        <label>
          Property
          <select
            value={property}
            disabled={!ownerId || properties.length === 0}
            onChange={(event) => {
              setProperty(event.target.value);
              setReport(null);
              setError("");
            }}
          >
            <option value="">{ownerId ? (properties.length ? "Choose a property" : "No properties assigned") : "Choose an owner first"}</option>
            {properties.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          {ownerId && properties.length === 0 && (
            <span className="field-notice">
              No properties are assigned to {owner?.name}.{" "}
              <button type="button" className="text-action" onClick={() => onEditOwner(ownerId)}>
                Assign properties on this owner
              </button>
            </span>
          )}
          {ownerId && properties.length > 0 && !property && (
            <span className="field-hint">
              {properties.length === 1 ? "1 property assigned." : `${properties.length} properties assigned.`} Choose one, then generate.
            </span>
          )}
          {property && !report && busy !== "report" && <span className="field-hint">Ready to generate {property}.</span>}
        </label>
        <label>
          Year
          <select
            value={year}
            onChange={(event) => {
              setYear(event.target.value);
              setReport(null);
            }}
          >
            {years.years.map((value) => (
              <option key={value} value={String(value)}>
                {value}
              </option>
            ))}
          </select>
          <span className="field-hint">The report covers this whole year.</span>
        </label>
        <div className="simple-report-generate">
          <button className="primary-action" disabled={generateDisabled}>
            {busy === "report" ? "Generating..." : "Generate"}
          </button>
          {busy === "report" && (
            <span className="field-hint" role="status">
              Generating the report...
            </span>
          )}
          {error && (
            <span className="field-notice field-error" role="alert">
              {error}
            </span>
          )}
        </div>
      </form>

      {report && (
        <div className="report-toolbar screen-controls">
          <div className="report-actions simple-report-actions">
            <button className="secondary-action" type="button" onClick={() => void download()} disabled={busy === "pdf"}>
              <Download size={18} />
              {busy === "pdf" ? "Downloading..." : "Download"}
            </button>
            <button className="secondary-action" type="button" onClick={() => window.print()}>
              <Printer size={18} />
              Print
            </button>
          </div>
        </div>
      )}

      {report && <div className="report-preview" dangerouslySetInnerHTML={{ __html: report.html }} />}
    </section>
  );
}
