"use client";

import { useEffect, useState } from "react";
import { emptyMapping, type WorkbookMapping } from "@/lib/workbook/update";

type Version = {
  id: string;
  ownerName: string;
  version: number;
  status: string;
  shareId: string;
  recipient: string;
  gmailMessageId: string;
  sentAt: string | null;
  lastError: string;
};

type Decision = {
  action: string;
  message?: string;
  waiting?: { name: string }[];
};

type Batch = {
  versions: Version[];
  decision: Decision;
  gmail: { enabled: boolean; connected: boolean; email: string };
  periodLabel?: string;
};

type SendResult = {
  decision: Decision;
  summary: {
    sent: { name: string; email: string; gmailMessageId: string }[];
    skipped: { name: string; reason: string }[];
    failed: { name: string; error: string }[];
  };
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

export function StatementBatchTools() {
  const now = new Date();
  const previous = now.getMonth() === 0 ? { year: now.getFullYear() - 1, month: 12 } : { year: now.getFullYear(), month: now.getMonth() };
  const [year, setYear] = useState(String(previous.year));
  const [month, setMonth] = useState(String(previous.month));
  const [batch, setBatch] = useState<Batch | null>(null);
  const [mapping, setMapping] = useState<WorkbookMapping>(emptyMapping());
  const [workbookNote, setWorkbookNote] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load(nextYear = year, nextMonth = month) {
    const data = await api<Batch>(`/api/statements/batch?year=${nextYear}&month=${nextMonth}`);
    setBatch(data);
  }

  useEffect(() => {
    api<Batch>(`/api/statements/batch?year=${previous.year}&month=${previous.month}`)
      .then(setBatch)
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to load statements."));
    api<{ mapping: WorkbookMapping }>("/api/workbook").then((data) => setMapping(data.mapping)).catch(() => undefined);
  }, [previous.year, previous.month]);

  async function generate() {
    setBusy("generate");
    setError("");
    try {
      const data = await api<Batch & { created: string[] }>("/api/statements/batch", {
        method: "POST",
        body: JSON.stringify({ year: Number(year), month: Number(month) })
      });
      setBatch(data);
      setMessage(data.created?.length ? `Pending statements generated for ${data.created.join(", ")}.` : "Statements already match the current numbers.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate statements.");
    } finally {
      setBusy("");
    }
  }

  async function approve(id: string) {
    setBusy(id);
    setError("");
    try {
      await api("/api/statements/batch/approve", { method: "POST", body: JSON.stringify({ versionId: id }) });
      await load();
      setMessage("Statement approved and locked. The share link now opens this version.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to approve the statement.");
    } finally {
      setBusy("");
    }
  }

  async function sendAll() {
    setBusy("send");
    setError("");
    try {
      const result = await api<SendResult>("/api/statements/batch/send", {
        method: "POST",
        body: JSON.stringify({ year: Number(year), month: Number(month) })
      });
      await load();
      if (result.decision.action === "deadline_miss") setMessage(result.decision.message || "No statements were sent by the deadline.");
      else if (result.decision.action === "hold" || result.decision.action === "hold_for_manual") setMessage(result.decision.message || "The batch is held.");
      else {
        const sent = result.summary.sent.length;
        const skipped = result.summary.skipped.length;
        const failed = result.summary.failed.length;
        setMessage(`Sent ${sent}, skipped ${skipped}, failed ${failed}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send statements.");
    } finally {
      setBusy("");
    }
  }

  async function connectGmail() {
    const data = await api<{ url: string }>("/api/gmail", { method: "POST" });
    window.location.href = data.url;
  }

  async function saveMapping() {
    setBusy("mapping");
    setError("");
    try {
      const data = await api<{ mapping: WorkbookMapping }>("/api/workbook", { method: "PUT", body: JSON.stringify(mapping) });
      setMapping(data.mapping);
      setMessage("Workbook mapping saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the workbook mapping.");
    } finally {
      setBusy("");
    }
  }

  async function updateWorkbook(file: File | null) {
    if (!file) return;
    setBusy("workbook");
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("year", year);
      body.set("month", month);
      const result = await api<{
        filename: string;
        fileBase64: string;
        updated: unknown[];
        unmatched: { owner: string; property: string }[];
        ambiguous: { owner: string; property: string }[];
        skippedFormulas: { row: number; column: string }[];
      }>("/api/workbook", { method: "POST", body });
      const blob = new Blob([Uint8Array.from(atob(result.fileBase64), (char) => char.charCodeAt(0))], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
      setWorkbookNote(`Updated ${result.updated.length}. Unmatched ${result.unmatched.length}. Ambiguous ${result.ambiguous.length}. Formulas left alone ${result.skippedFormulas.length}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update the workbook.");
    } finally {
      setBusy("");
    }
  }

  const decision = batch?.decision;
  const output = `/api/statements/batch/output?year=${year}&month=${month}`;

  return (
    <section className="editor-panel tax-tools">
      <div className="panel-heading"><h2>Owner statement batch</h2></div>
      <p className="muted-copy">
        Statements are generated as Pending. Approve &amp; Lock freezes that version on its existing share link. A later change creates a new version that has to be approved again.
        Automatic email runs from 12:00 AM ET on the 1st through 11:59 PM ET on the 3rd, and only after every statement for the month is approved. Gmail must be connected and GMAIL_SEND_ENABLED must be true. Tests and this build do not send mail.
      </p>
      {(message || error) && <p className={error ? "message error" : "message"}>{error || message}</p>}
      {decision?.action === "deadline_miss" && (
        <div className="message error">
          <strong>{decision.message}</strong>
          <p>Waiting: {(decision.waiting || []).map((item) => item.name).join(", ") || "none"}</p>
        </div>
      )}
      {decision?.action === "hold_for_manual" && <p className="message">{decision.message}</p>}
      <div className="form-grid">
        <label>Month<input value={month} onChange={(event) => setMonth(event.target.value)} inputMode="numeric" /></label>
        <label>Year<input value={year} onChange={(event) => setYear(event.target.value)} inputMode="numeric" /></label>
      </div>
      <div className="card-actions">
        <button className="secondary-action" type="button" onClick={() => load().catch((err) => setError(err.message))}>Refresh</button>
        <button className="primary-action" type="button" onClick={generate} disabled={busy === "generate"}>{busy === "generate" ? "Generating..." : "Generate pending statements"}</button>
        <button className="primary-action" type="button" onClick={sendAll} disabled={busy === "send"}>Send Statements to All Owners</button>
        <a className="secondary-action" href={`${output}&kind=download`}>Download All Statements</a>
        <a className="secondary-action" href={`${output}&kind=statements`} target="_blank" rel="noreferrer">Print All Statements</a>
        <a className="secondary-action" href={`${output}&kind=summaries`} target="_blank" rel="noreferrer">Print All Owner Summaries</a>
      </div>
      <p className="muted-copy">
        Gmail: {batch?.gmail.connected ? `connected as ${batch.gmail.email}` : "not connected"}.
        Sending is {batch?.gmail.enabled ? "enabled" : "disabled"}.
      </p>
      <button className="secondary-action" type="button" onClick={connectGmail}>Connect Ocean Vacations Gmail</button>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Owner</th><th>Version</th><th>Status</th><th>Sent</th><th></th></tr></thead>
          <tbody>
            {(batch?.versions || []).map((version) => (
              <tr key={version.id}>
                <td>{version.ownerName}</td>
                <td>{version.version}</td>
                <td>{version.status}{version.lastError ? ` — ${version.lastError}` : ""}</td>
                <td>{version.gmailMessageId ? `${version.recipient} · ${version.gmailMessageId}` : ""}</td>
                <td>
                  {version.status === "pending" && (
                    <button className="secondary-action small" type="button" onClick={() => approve(version.id)} disabled={busy === version.id}>Approved &amp; Locked</button>
                  )}
                  {version.shareId && <a className="secondary-action small" href={`/share/${version.shareId}`} target="_blank" rel="noreferrer">Open link</a>}
                  <a className="secondary-action small" href={`/api/statements/versions/${version.id}/preview`} target="_blank" rel="noreferrer">Preview</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel-heading"><h2>Workbook update</h2></div>
      <p className="muted-copy">Upload the .xlsx workbook, map the sheet and columns once, then download the updated file. OpenOffice Calc should save as .xlsx. Only the mapped payout and cleaning cells change. Formulas and other cells stay put. A row is matched by owner, month, and property, so running it again does not add a duplicate row.</p>
      <div className="form-grid">
        <label>Sheet<input value={mapping.sheetName} onChange={(event) => setMapping({ ...mapping, sheetName: event.target.value })} /></label>
        <label>Header row<input value={String(mapping.headerRow)} onChange={(event) => setMapping({ ...mapping, headerRow: Number(event.target.value || 1) })} inputMode="numeric" /></label>
        <label>Owner column<input value={mapping.columns.owner} onChange={(event) => setMapping({ ...mapping, columns: { ...mapping.columns, owner: event.target.value } })} /></label>
        <label>Month column<input value={mapping.columns.month} onChange={(event) => setMapping({ ...mapping, columns: { ...mapping.columns, month: event.target.value } })} /></label>
        <label>Property column<input value={mapping.columns.property} onChange={(event) => setMapping({ ...mapping, columns: { ...mapping.columns, property: event.target.value } })} /></label>
        <label>Owner payout column<input value={mapping.columns.ownerPayout} onChange={(event) => setMapping({ ...mapping, columns: { ...mapping.columns, ownerPayout: event.target.value } })} /></label>
        <label>Cleaning transfer column<input value={mapping.columns.cleaningTransfer} onChange={(event) => setMapping({ ...mapping, columns: { ...mapping.columns, cleaningTransfer: event.target.value } })} /></label>
      </div>
      <div className="card-actions">
        <button className="secondary-action" type="button" onClick={saveMapping} disabled={busy === "mapping"}>Save mapping</button>
        <label className="file-pick">
          Update workbook
          <input type="file" accept=".xlsx" onChange={(event) => updateWorkbook(event.target.files?.[0] || null)} />
        </label>
      </div>
      {workbookNote && <p>{workbookNote}</p>}
    </section>
  );
}
