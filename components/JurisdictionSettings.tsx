"use client";

import { useEffect, useState } from "react";
import { Save, Upload } from "lucide-react";

type Jurisdiction = {
  _id?: string;
  id?: string;
  name: string;
  slug: string;
  formKind: "georgetown" | "surfside";
  accountNumber?: string;
  federalId?: string;
  businessName?: string;
  ownerName?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  email?: string;
  accommodationRate?: number;
  hospitalityRate?: number;
  discountRate?: number;
  penaltyRatePerMonth?: number;
  signatureName?: string;
  position?: string;
  phone?: string;
  templateFilename?: string;
  hasTemplate?: boolean;
};

const emptyForm = {
  name: "",
  slug: "",
  formKind: "georgetown" as "georgetown" | "surfside",
  accountNumber: "",
  federalId: "",
  businessName: "",
  ownerName: "",
  street: "",
  city: "",
  state: "",
  postalCode: "",
  email: "",
  accommodationRate: "0.03",
  hospitalityRate: "0",
  discountRate: "0.02",
  penaltyRatePerMonth: "0.05",
  signatureName: "",
  position: "",
  phone: ""
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

function percent(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function JurisdictionSettings() {
  const [rows, setRows] = useState<Jurisdiction[]>([]);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setBusy("load");
    setError("");
    try {
      const data = await api<{ jurisdictions: Jurisdiction[] }>("/api/tax-jurisdictions");
      setRows(data.jurisdictions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load jurisdictions.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    let ignore = false;
    api<{ jurisdictions: Jurisdiction[] }>("/api/tax-jurisdictions")
      .then((data) => {
        if (!ignore) setRows(data.jurisdictions || []);
      })
      .catch((err: unknown) => {
        if (!ignore) setError(err instanceof Error ? err.message : "Unable to load jurisdictions.");
      });
    return () => {
      ignore = true;
    };
  }, []);

  function edit(row: Jurisdiction) {
    setEditingId(String(row._id || row.id || ""));
    setTemplateName(row.templateFilename || (row.hasTemplate ? "Official form on file" : ""));
    setForm({
      name: row.name || "",
      slug: row.slug || "",
      formKind: row.formKind === "surfside" ? "surfside" : "georgetown",
      accountNumber: row.accountNumber || "",
      federalId: row.federalId || "",
      businessName: row.businessName || "",
      ownerName: row.ownerName || "",
      street: row.street || "",
      city: row.city || "",
      state: row.state || "",
      postalCode: row.postalCode || "",
      email: row.email || "",
      accommodationRate: String(row.accommodationRate ?? 0),
      hospitalityRate: String(row.hospitalityRate ?? 0),
      discountRate: String(row.discountRate ?? 0),
      penaltyRatePerMonth: String(row.penaltyRatePerMonth ?? 0.05),
      signatureName: row.signatureName || "",
      position: row.position || "",
      phone: row.phone || ""
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    setNotice("");
    if (!form.name.trim()) {
      setError("Enter a jurisdiction name.");
      setBusy("");
      return;
    }
    const slug = (form.slug.trim() || form.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const body = {
      ...form,
      slug,
      accommodationRate: percent(form.accommodationRate),
      hospitalityRate: percent(form.hospitalityRate),
      discountRate: percent(form.discountRate),
      penaltyRatePerMonth: percent(form.penaltyRatePerMonth)
    };
    try {
      if (editingId) await api(`/api/tax-jurisdictions/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
      else await api("/api/tax-jurisdictions", { method: "POST", body: JSON.stringify(body) });
      setForm(emptyForm);
      setEditingId("");
      setNotice("Jurisdiction saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the jurisdiction.");
    } finally {
      setBusy("");
    }
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !editingId) return;
    setBusy("upload");
    setError("");
    try {
      const body = new FormData();
      body.set("template", file);
      const data = await api<{ templateFilename: string }>(`/api/tax-jurisdictions/${editingId}/template`, { method: "POST", body });
      setTemplateName(data.templateFilename || file.name);
      setNotice("Official form saved.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to store the official form.");
    } finally {
      setBusy("");
      event.target.value = "";
    }
  }

  function field(key: keyof typeof emptyForm, label: string) {
    if (key === "formKind") return null;
    return (
      <label key={key}>
        {label}
        <input value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
      </label>
    );
  }

  return (
    <form className="editor-panel compact" onSubmit={save}>
      <div className="panel-heading">
        <FileMark />
        <h2>{editingId ? "Edit jurisdiction" : "Tax jurisdictions"}</h2>
      </div>
      <p className="helper-line">Account numbers, Federal ID, and the official PDF stay in the database. Saved privately. Only admins can see them.</p>
      <p className="tax-mode">{editingId ? `Editing ${form.name || "this jurisdiction"}.` : "Adding a new jurisdiction."}</p>
      {editingId && (
        <button className="text-action" type="button" onClick={() => { setEditingId(""); setForm(emptyForm); setTemplateName(""); setError(""); }}>
          Add a new one instead
        </button>
      )}
      {busy === "load" && <p className="helper-line" role="status">Loading jurisdictions...</p>}
      {error && <div className="message error" role="alert"><span>{error}</span></div>}
      {notice && <p className="success-line" role="status">{notice}</p>}
      <label>
        Form
        <select
          value={form.formKind}
          onChange={(event) => {
            const formKind = event.target.value === "surfside" ? "surfside" : "georgetown";
            setForm({
              ...form,
              formKind,
              accommodationRate: formKind === "surfside" ? "0.005" : "0.03",
              hospitalityRate: formKind === "surfside" ? "0.01" : "0.02"
            });
          }}
        >
          <option value="georgetown">Georgetown County</option>
          <option value="surfside">Surfside Beach</option>
        </select>
      </label>
      {field("name", "Jurisdiction name")}
      {field("slug", "Short ID used in file names")}
      {field("accountNumber", "Account or customer number")}
      {field("federalId", "Federal ID")}
      {field("businessName", "Business name")}
      {field("ownerName", "Owner name on the form")}
      {field("street", "Mailing street")}
      {field("city", "City")}
      {field("state", "State")}
      {field("postalCode", "ZIP")}
      {field("email", "Email")}
      {field("accommodationRate", "Accommodations rate (0.03 = 3%)")}
      {field("hospitalityRate", "Hospitality rate (0.01 = 1%)")}
      {field("discountRate", "Timely filing discount (0.02 = 2%)")}
      {field("penaltyRatePerMonth", "Penalty per late month (0.05 = 5%)")}
      {field("signatureName", "Signature")}
      {field("position", "Position")}
      {field("phone", "Phone")}
      <button className="secondary-action" disabled={busy === "save"}>
        <Save size={17} />
        {busy === "save" ? "Saving..." : editingId ? "Update jurisdiction" : "Save jurisdiction"}
      </button>
      {editingId && (
        <label>
          Official fillable PDF
          <input type="file" accept="application/pdf" onChange={(event) => void upload(event)} disabled={busy === "upload"} />
        </label>
      )}
      {templateName && <p className="helper-line">Template on file: {templateName}</p>}
      {!rows.length && busy !== "load" && <p className="empty-state">No jurisdictions yet.</p>}
      <div className="chip-list">
        {rows.map((row) => (
          <button className="chip-button" type="button" key={row._id || row.id || row.slug} onClick={() => edit(row)}>
            {row.name}
          </button>
        ))}
      </div>
    </form>
  );
}

function FileMark() {
  return <Upload size={20} />;
}

export function JurisdictionSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [rows, setRows] = useState<Jurisdiction[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let ignore = false;
    fetch("/api/tax-jurisdictions")
      .then((response) => response.json())
      .then((data) => {
        if (!ignore) setRows(data.jurisdictions || []);
      })
      .catch(() => {
        if (!ignore) setError("Jurisdictions could not be loaded.");
      });
    return () => {
      ignore = true;
    };
  }, []);
  return (
    <label>
      Tax jurisdiction
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Unassigned</option>
        {rows.map((row) => (
          <option key={row._id || row.id || row.slug} value={String(row._id || row.id || "")}>
            {row.name}
          </option>
        ))}
      </select>
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
