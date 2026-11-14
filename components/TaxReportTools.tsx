"use client";

import { useEffect, useState } from "react";
import { ROSTER_SOURCES, emptyRosters, importFlaggedProperties, mergePropertyNames, parsePropertyList, type RosterKey, type TaxRosters } from "@/lib/tax/rosters";
import { emptyCompany, missingCompanyFields, type TaxCompanyProfile } from "@/lib/tax/setup";

type PropertyFlag = { name: string; taxFlags?: Record<string, boolean> };

type Packet = {
  id: string;
  jurisdiction: string;
  previewHtml: string;
  computation?: { remittance?: { paymentLabel?: string; payee?: string; deadlineLabel?: string; mailingAddress?: string[] } };
  stateReturns?: { index: number; kind: string; filename: string }[];
};

type Filing = {
  id: string;
  label: string;
  url: string;
  status: string;
  lines: { property: string; grossReceipts: number; taxesCollected: number }[];
  totalGross: number;
  totalTaxesCollected: number;
  paymentRequired: boolean;
  paymentNote: string;
  entryNote: string;
  executorMessage: string;
  confirmationId: string;
  receiptFilename: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}

function printHtml(html: string) {
  const popup = window.open("", "_blank");
  if (!popup) return;
  popup.document.write(`<!doctype html><html><head><title>Tax packet</title><style>body{font-family:Georgia,serif;color:#102622;margin:32px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #d8ded8;padding:6px;text-align:left}.source{color:#687a78;font-size:12px}</style></head><body>${html}<script>window.addEventListener("load", () => setTimeout(() => window.print(), 200));</script></body></html>`);
  popup.document.close();
}

export function TaxReportTools({ month, year, properties }: { month: number; year: number; properties: PropertyFlag[] }) {
  const [company, setCompany] = useState<TaxCompanyProfile>(emptyCompany());
  const [rosters, setRosters] = useState<TaxRosters>(emptyRosters());
  const [paste, setPaste] = useState<Record<RosterKey, string>>({
    surfside: "",
    georgetown: "",
    mydorway: "",
    horry: "",
    myrtleBeach: "",
    northMyrtleBeach: ""
  });
  const [packets, setPackets] = useState<Packet[]>([]);
  const [filings, setFilings] = useState<Filing[]>([]);
  const [adjustments, setAdjustments] = useState({ foodGross: "0", admissionsGross: "0", nontaxableRetail: "0", longTermRentalDeduction: "0" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    api<{ company: TaxCompanyProfile; rosters: TaxRosters }>("/api/tax/setup")
      .then((setup) => {
        setCompany(setup.company);
        setRosters(setup.rosters);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load tax setup."));
  }, []);

  useEffect(() => {
    if (!month || !year) return;
    api<{ packets: Packet[] }>(`/api/tax/packets?year=${year}&month=${month}`).then((data) => setPackets(data.packets)).catch(() => undefined);
    api<{ filings: Filing[] }>(`/api/tax/filings?year=${year}&month=${month}`).then((data) => setFilings(data.filings)).catch(() => undefined);
  }, [month, year]);

  async function saveSetup() {
    setBusy("setup");
    setError("");
    try {
      const saved = await api<{ company: TaxCompanyProfile; rosters: TaxRosters }>("/api/tax/setup", {
        method: "PUT",
        body: JSON.stringify({ company, rosters })
      });
      setCompany(saved.company);
      setRosters(saved.rosters);
      setMessage("Tax setup saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save tax setup.");
    } finally {
      setBusy("");
    }
  }

  function updateRoster(key: RosterKey, names: string[]) {
    setRosters((current) => ({ ...current, [key]: names }));
  }

  async function preparePackets() {
    setBusy("packets");
    setError("");
    try {
      const data = await api<{ packets: Packet[] }>("/api/tax/packets", {
        method: "POST",
        body: JSON.stringify({
          year,
          month,
          foodGross: Number(adjustments.foodGross || 0),
          admissionsGross: Number(adjustments.admissionsGross || 0),
          nontaxableRetail: Number(adjustments.nontaxableRetail || 0),
          longTermRentalDeduction: Number(adjustments.longTermRentalDeduction || 0)
        })
      });
      setPackets(data.packets);
      setMessage("Monthly packets are ready.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to prepare packets.");
    } finally {
      setBusy("");
    }
  }

  async function uploadStateReturn(packetId: string, file: File | null, kind: string) {
    if (!file) return;
    setBusy("upload");
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("kind", kind);
      await api(`/api/tax/packets/${packetId}/state-return`, { method: "POST", body });
      const data = await api<{ packets: Packet[] }>(`/api/tax/packets?year=${year}&month=${month}`);
      setPackets(data.packets);
      setMessage("Filed MyDORWAY return stored.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to store the state return.");
    } finally {
      setBusy("");
    }
  }

  async function prepareFilings() {
    setBusy("filings");
    setError("");
    try {
      const data = await api<{ filings: Filing[] }>("/api/tax/filings", { method: "POST", body: JSON.stringify({ year, month }) });
      setFilings(data.filings);
      setMessage("Portal returns are ready for review. Nothing has been filed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to prepare filings.");
    } finally {
      setBusy("");
    }
  }

  async function approveFiling(id: string) {
    setBusy(id);
    setError("");
    try {
      const data = await api<{ filing: Filing }>(`/api/tax/filings/${id}/approve`, { method: "POST" });
      setFilings((current) => current.map((filing) => (filing.id === id ? data.filing : filing)));
      setMessage(data.filing.executorMessage || "Approval recorded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to approve the filing.");
    } finally {
      setBusy("");
    }
  }

  async function uploadReceipt(id: string, file: File | null) {
    if (!file) return;
    const body = new FormData();
    body.set("file", file);
    await api(`/api/tax/filings/${id}/receipt`, { method: "POST", body });
    setFilings((current) => current.map((filing) => (filing.id === id ? { ...filing, receiptFilename: file.name } : filing)));
  }

  const missing = missingCompanyFields(company);

  return (
    <section className="tax-tools">
      {(message || error) && <p className={error ? "message error" : "message"}>{error || message}</p>}

      <form className="editor-panel" onSubmit={(event) => { event.preventDefault(); saveSetup(); }}>
        <div className="panel-heading"><h2>Tax setup</h2></div>
        <p className="muted-copy">Company information is saved once and reused on the Surfside Beach and Georgetown County forms. Portal lists say which properties belong to each online return. Import starts from the property tax flags already saved here, including the SC list for MyDORWAY and the MB list for Myrtle Beach. Paste the list from a portal to add or replace names.</p>
        <div className="form-grid">
          {([
            ["legalName", "Legal name"],
            ["dba", "DBA"],
            ["ownerName", "Owner name"],
            ["address1", "Mailing address"],
            ["address2", "Address line 2"],
            ["city", "City"],
            ["state", "State"],
            ["zip", "ZIP"],
            ["phone", "Phone"],
            ["email", "Email"],
            ["federalId", "Federal EIN"],
            ["scSalesTaxNumber", "SC sales tax number"],
            ["surfsideAccountNumber", "Surfside account number"],
            ["georgetownCustomerNumber", "Georgetown customer number"],
            ["signerName", "Signer name"],
            ["signerTitle", "Signer title"]
          ] as [keyof TaxCompanyProfile, string][]).map(([key, label]) => (
            <label key={key}>
              {label}
              <input value={company[key]} onChange={(event) => setCompany({ ...company, [key]: event.target.value })} />
            </label>
          ))}
        </div>
        {missing.length > 0 && <p className="muted-copy">Still blank: {missing.join(", ")}</p>}
        {ROSTER_SOURCES.map((source) => (
          <div className="charge-section" key={source.key}>
            <div className="charge-heading">
              <strong>{source.label}</strong>
              {source.url && <a href={source.url} target="_blank" rel="noreferrer">Portal</a>}
            </div>
            <p className="muted-copy">{source.importHelp}</p>
            <textarea
              value={rosters[source.key].join("\n")}
              onChange={(event) => updateRoster(source.key, parsePropertyList(event.target.value))}
              rows={Math.min(8, Math.max(3, rosters[source.key].length + 1))}
            />
            <div className="card-actions">
              <button
                className="secondary-action small"
                type="button"
                onClick={() => updateRoster(source.key, mergePropertyNames(rosters[source.key], importFlaggedProperties(properties, source.flag)))}
              >
                Import {source.flag} properties
              </button>
              <button className="secondary-action small" type="button" onClick={() => updateRoster(source.key, mergePropertyNames(rosters[source.key], parsePropertyList(paste[source.key])))}>
                Add pasted names
              </button>
              <button className="secondary-action small" type="button" onClick={() => updateRoster(source.key, parsePropertyList(paste[source.key]))}>
                Replace with paste
              </button>
            </div>
            <textarea
              value={paste[source.key]}
              onChange={(event) => setPaste({ ...paste, [source.key]: event.target.value })}
              placeholder="Paste one property per line"
              rows={3}
            />
          </div>
        ))}
        <button className="primary-action" disabled={busy === "setup"}>{busy === "setup" ? "Saving..." : "Save setup"}</button>
      </form>

      <section className="editor-panel">
        <div className="panel-heading"><h2>Monthly PDF packets</h2></div>
        <p className="muted-copy">Prepares Surfside Beach and Georgetown County for {month}/{year}, including properties with $0 income. Georgetown can store the filed MyDORWAY ST-3, or ST-388 with ST-3T and ST-389.</p>
        <div className="form-grid">
          <label>Food gross<input value={adjustments.foodGross} onChange={(event) => setAdjustments({ ...adjustments, foodGross: event.target.value })} inputMode="decimal" /></label>
          <label>Admissions gross<input value={adjustments.admissionsGross} onChange={(event) => setAdjustments({ ...adjustments, admissionsGross: event.target.value })} inputMode="decimal" /></label>
          <label>Georgetown nontaxable retail<input value={adjustments.nontaxableRetail} onChange={(event) => setAdjustments({ ...adjustments, nontaxableRetail: event.target.value })} inputMode="decimal" /></label>
          <label>Georgetown 30-day rentals<input value={adjustments.longTermRentalDeduction} onChange={(event) => setAdjustments({ ...adjustments, longTermRentalDeduction: event.target.value })} inputMode="decimal" /></label>
        </div>
        <button className="primary-action" type="button" onClick={preparePackets} disabled={busy === "packets"}>{busy === "packets" ? "Preparing..." : "Prepare packets"}</button>
        {packets.map((packet) => (
          <article key={packet.id} className="saved-card">
            <h3>{packet.jurisdiction === "surfside" ? "Surfside Beach" : "Georgetown County"}</h3>
            <p>{packet.computation?.remittance?.paymentLabel} · {packet.computation?.remittance?.payee} · Postmark {packet.computation?.remittance?.deadlineLabel}</p>
            <div className="card-actions">
              <button className="secondary-action small" type="button" onClick={() => printHtml(packet.previewHtml)}>Print</button>
              <a className="secondary-action small" href={`/api/tax/packets/${packet.id}/pdf`}>Download PDF</a>
            </div>
            <div className="report-preview" dangerouslySetInnerHTML={{ __html: packet.previewHtml }} />
            {packet.jurisdiction === "georgetown" && (
              <div className="card-actions">
                <label className="file-pick">
                  Upload filed ST-3 / ST-388 packet
                  <input type="file" accept="application/pdf" onChange={(event) => uploadStateReturn(packet.id, event.target.files?.[0] || null, "st-3")} />
                </label>
                {(packet.stateReturns || []).map((file) => (
                  <a key={file.index} className="secondary-action small" href={`/api/tax/packets/${packet.id}/state-return?index=${file.index}`} target="_blank" rel="noreferrer">
                    Print {file.filename}
                  </a>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="editor-panel">
        <div className="panel-heading"><h2>Online filing</h2></div>
        <p className="muted-copy">Review the exact gross receipts for each portal, including $0 properties. Approve and File is required before anything is submitted. The connected executor is a stub, so this click records approval and does not file or pay.</p>
        <button className="primary-action" type="button" onClick={prepareFilings} disabled={busy === "filings"}>{busy === "filings" ? "Preparing..." : "Prepare portal returns"}</button>
        {filings.map((filing) => (
          <article key={filing.id} className="saved-card">
            <h3>{filing.label}</h3>
            <p>{filing.entryNote}</p>
            <p>{filing.paymentNote}</p>
            <p>Status: {filing.status}{filing.confirmationId ? ` · Confirmation ${filing.confirmationId}` : ""}</p>
            {filing.executorMessage && <p>{filing.executorMessage}</p>}
            <div className="table-wrap">
              <table>
                <thead><tr><th>Property</th><th>Gross receipts</th><th>Taxes collected</th></tr></thead>
                <tbody>
                  {filing.lines.map((line) => (
                    <tr key={line.property}>
                      <td>{line.property}</td>
                      <td>{line.grossReceipts.toFixed(2)}</td>
                      <td>{line.taxesCollected.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-actions">
              <a className="secondary-action small" href={filing.url} target="_blank" rel="noreferrer">Open portal</a>
              <button className="primary-action" type="button" disabled={filing.status !== "prepared" || busy === filing.id} onClick={() => approveFiling(filing.id)}>
                {busy === filing.id ? "Working..." : "Approve and File"}
              </button>
              <label className="file-pick">
                Store confirmation / receipt
                <input type="file" accept="application/pdf" onChange={(event) => uploadReceipt(filing.id, event.target.files?.[0] || null)} />
              </label>
              {filing.receiptFilename && <a className="secondary-action small" href={`/api/tax/filings/${filing.id}/receipt`} target="_blank" rel="noreferrer">Print receipt</a>}
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
