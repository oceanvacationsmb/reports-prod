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

const reportChoices = [{ key: "gri", label: "GRI" }];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}

export function SimpleReportsPage({ owners }: { owners: OwnerChoice[] }) {
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
      <form className="control-grid screen-controls" onSubmit={generate}>
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
        </label>
        <button className="primary-action" disabled={generateDisabled}>
          {busy === "report" ? "Generating..." : "Generate"}
        </button>
      </form>

      {!report && <p className="helper-line screen-controls">Choose an owner. The properties assigned to that owner load next.</p>}

      {ownerId && properties.length === 0 && <p className="empty-state">No properties are assigned to {owner?.name}. Assign properties on the owner before generating.</p>}

      {ownerId && properties.length > 0 && !property && (
        <p className="helper-line">{properties.length === 1 ? "1 property assigned." : `${properties.length} properties assigned.`} Choose one, then generate.</p>
      )}

      {busy === "report" && (
        <p className="helper-line" role="status">
          Generating the report...
        </p>
      )}

      {error && (
        <div className="message error" role="alert">
          <span>{error}</span>
          <button className="secondary-action" type="button" onClick={() => setError("")}>
            Close
          </button>
        </div>
      )}

      <div className="report-toolbar screen-controls">
        <div className="report-actions">
          <button className="secondary-action" type="button" onClick={() => void download()} disabled={!report || busy === "pdf" || busy === "report"}>
            <Download size={18} />
            {busy === "pdf" ? "Downloading..." : "Download"}
          </button>
          <button className="secondary-action" type="button" onClick={() => window.print()} disabled={!report || busy === "report"}>
            <Printer size={18} />
            Print
          </button>
        </div>
      </div>

      {report && <div className="report-preview" dangerouslySetInnerHTML={{ __html: report.html }} />}
    </section>
  );
}
