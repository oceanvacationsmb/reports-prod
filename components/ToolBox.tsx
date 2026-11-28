"use client";

import { useEffect, useState, type FormEvent } from "react";

type Tool = { id: string; title: string; url: string };

async function requestTools(method = "GET", body?: { title: string; url: string } | { id: string }, signal?: AbortSignal) {
  const response = await fetch("/api/toolbox", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to update the ToolBox.");
  return data.tools as Tool[];
}

export function ToolBox({ edit = false }: { edit?: boolean }) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    requestTools("GET", undefined, controller.signal)
      .then(setTools)
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);

  async function update(event: FormEvent | null, id?: string) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setTools(await requestTools(id ? "DELETE" : "POST", id ? { id } : { title, url }));
      if (!id) { setTitle(""); setUrl(""); }
      setMessage(id ? "Tool removed." : "Tool added.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update the ToolBox.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="editor-panel toolbox-panel">
      <h2>{edit ? "Tools Settings" : "ToolBox"}</h2>
      {edit && (
        <form className="form-grid" onSubmit={update}>
          <label>Title<input value={title} required maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>URL<input type="url" value={url} required maxLength={2048} onChange={(event) => setUrl(event.target.value)} /></label>
          <button className="primary-action" disabled={busy}>Add tool</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!busy && !tools.length && <p>No tools added yet.</p>}
      <ul className="toolbox-list">
        {tools.map((item) => (
          <li key={item.id}>
            <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>
            {edit && <button type="button" className="secondary-action small" disabled={busy} onClick={() => void update(null, item.id)}>Remove</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
