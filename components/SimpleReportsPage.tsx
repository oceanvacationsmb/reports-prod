"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, Printer } from "lucide-react";
import { reportPropertyChoices, reportYearChoices, sameProperty } from "@/lib/reporting/report-options";
import { ownerReportReservationQuery } from "@/lib/reporting/reservation-query";

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

const reportKey = "gri";

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
  const [ownerId, setOwnerId] = useState("");
  const [selectedProperty, setProperty] = useState("");
  const [discoveredProperties, setDiscoveredProperties] = useState<string[]>([]);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [year, setYear] = useState(years.defaultYear);
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const owner = owners.find((item) => item._id === ownerId);
  const properties = useMemo(() => {
    const names: string[] = [];
    for (const name of reportPropertyChoices(owner?.properties || [], discoveredProperties)) {
      if (!names.some((existing) => sameProperty(existing, name))) names.push(name);
    }
    return names;
  }, [owner, discoveredProperties]);
  const property = properties.length === 1 ? properties[0] : selectedProperty;

  useEffect(() => {
    if (!ownerId || owner?.properties?.some((name) => name.trim())) return;
    const controller = new AbortController();
    const query = ownerReportReservationQuery(Number(year));
    const params = new URLSearchParams({
      ownerId, allProperties: "true", propertiesOnly: "true", startDate: query.startDate, endDate: query.endDate,
      limit: String(query.limit)
    });
    api<{ properties: string[] }>(`/api/guesty/reservations?${params}`, { signal: controller.signal })
      .then(({ properties }) => setDiscoveredProperties(reportPropertyChoices(properties)))
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLookupBusy(false); });
    return () => controller.abort();
  }, [owner, ownerId, year]);

  function chooseOwner(nextOwnerId: string) {
    setOwnerId(nextOwnerId);
    setDiscoveredProperties([]);
    setLookupBusy(!owners.find((item) => item._id === nextOwnerId)?.properties?.some((name) => name.trim()) && Boolean(nextOwnerId));
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
        {ownerId && properties.length === 1 ? (
          <label>Property<input readOnly value={property} /></label>
        ) : (
          <label>
            Property
            <select value={property} disabled={!properties.length} onChange={(event) => {
              setProperty(event.target.value);
              setReport(null);
              setError("");
            }}>
              <option value="">{lookupBusy ? "Looking up properties…" : properties.length ? "Choose a property" : "No properties found"}</option>
              {properties.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            {ownerId && !lookupBusy && !properties.length && (
              <button type="button" className="text-action" onClick={() => onEditOwner(ownerId)}>Assign properties</button>
            )}
          </label>
        )}
        <label>
          Year
          <select
            value={year}
            onChange={(event) => {
              setYear(event.target.value);
              if (ownerId && !owner?.properties?.some((name) => name.trim())) {
                setDiscoveredProperties([]);
                setProperty("");
                setLookupBusy(true);
              }
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
