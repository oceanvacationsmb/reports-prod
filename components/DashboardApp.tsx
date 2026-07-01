"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Building2,
  CircleDollarSign,
  Eye,
  FileArchive,
  Home,
  LogOut,
  MapPinned,
  Plus,
  Save,
  Settings,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
  Download,
  Mail,
  Pencil,
  Printer,
  Send
} from "lucide-react";
import { OwnerPortal } from "@/components/OwnerPortal";
import type { ReportKey, SessionUser } from "@/lib/types";

type Owner = {
  _id: string;
  name: string;
  email?: string;
  type: "draft" | "payout" | "split";
  percent?: number;
  splitOwnerPercent?: number;
  salesFeePercent?: number;
  cleaningFee?: number;
  cleaningCaps?: unknown[];
  taxFlags?: Record<string, boolean>;
  guestyReportUrl?: string;
  guestyAllPropertiesUrl?: string;
  properties?: string[];
  legacyImport?: {
    reservationCount?: number;
    warning?: string;
  };
  recurringCharges?: unknown[];
  monthlyRecurringCharges?: unknown[];
  specificDateRecurringCharges?: unknown[];
  dateRangeRecurringCharges?: unknown[];
};

type Expense = {
  _id: string;
  ownerId: string;
  property: string;
  type: string;
  vendor?: string;
  amount: number;
  notes?: string;
  invoiceUrl?: string;
  month: number;
  year: number;
};

type SavedReport = {
  _id: string;
  ownerId?: string | null;
  reportKey?: string;
  reportTitle: string;
  periodLabel: string;
  shareId: string;
  createdAt: string;
};

type Property = {
  _id: string;
  name: string;
  reportAddress?: string;
  municipality?: string;
  taxFlags?: Record<string, boolean>;
};

type Vendor = {
  _id: string;
  name: string;
  phone?: string;
};

type ExpenseTypeOption = {
  _id: string;
  name: string;
};

type StatementEdit = {
  kind: string;
  id: string;
  isOwnerStay: boolean;
  isNew?: boolean;
  fields: { key: string; label: string; type: "text" | "number" | "date" }[];
  values: Record<string, string>;
  originalValues: Record<string, string>;
};

type ReportResponse = {
  title: string;
  periodLabel: string;
  html: string;
  summary: Record<string, string | number>;
};

type SavedReportResponse = {
  savedReport: SavedReport;
};

type EmailDraft = {
  to: string;
  subject: string;
  message: string;
  reportLink: string;
};

type TabKey = "reports" | "owners" | "expenses" | "saved" | "settings";

const reportOptions: { key: ReportKey; label: string; adminOnly?: boolean }[] = [
  { key: "statement", label: "Statement" },
  { key: "income", label: "Income" },
  { key: "gri", label: "GRI" },
  { key: "1099", label: "1099" },
  { key: "summary", label: "Owner Summary", adminOnly: true },
  { key: "allOwnersTax", label: "Tax Summary", adminOnly: true }
];

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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}

function parseArray(value: string, label: string) {
  if (!value.trim()) return [];
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return parsed;
}

function stringify(value: unknown) {
  return JSON.stringify(value || [], null, 2);
}

function isAggregateOwner(owner: Owner) {
  return owner.name.trim().toLowerCase() === "all properties";
}

function parseFormArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const emptyOwnerForm = {
  name: "",
  email: "",
  type: "draft",
  percent: "0",
  splitOwnerPercent: "0",
  salesFeePercent: "0",
  cleaningFee: "0",
  guestyReportUrl: "",
  guestyAllPropertiesUrl: "",
  properties: "[]",
  portalPassword: "",
  recurringCharges: "[]",
  monthlyRecurringCharges: "[]",
  specificDateRecurringCharges: "[]",
  dateRangeRecurringCharges: "[]",
  cleaningCaps: "[]",
  taxFlags: new Set<string>()
};

function freshOwnerForm() {
  return { ...emptyOwnerForm, taxFlags: new Set<string>() };
}

type OwnerArrayField =
  | "recurringCharges"
  | "monthlyRecurringCharges"
  | "specificDateRecurringCharges"
  | "dateRangeRecurringCharges"
  | "cleaningCaps";

const emptyPropertyForm = {
  name: "",
  reportAddress: "",
  municipality: "",
  taxFlags: new Set<string>()
};

const emptyVendorForm = {
  name: "",
  phone: ""
};

const emptyExpenseTypeForm = {
  name: ""
};

const currentYear = new Date().getFullYear();
const reportYearOptions = [currentYear - 1, currentYear, currentYear + 1];
const ownerTaxFlagOptions = ["SC", "HC", "GTC", "NMB", "MB"];
const emptyExpenseForm = {
  property: "",
  type: "",
  vendor: "",
  amount: "",
  notes: "",
  invoiceUrl: "",
  month: String(new Date().getMonth() + 1),
  year: String(currentYear)
};

export function DashboardApp({ user }: { user: SessionUser }) {
  const isAdmin = user.role === "admin";
  if (!isAdmin) return <OwnerPortal user={user} />;

  const [tab, setTab] = useState<TabKey>("reports");
  const [owners, setOwners] = useState<Owner[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [expenseTypes, setExpenseTypes] = useState<ExpenseTypeOption[]>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState(user.ownerId || "");
  const [ownerEditingId, setOwnerEditingId] = useState("");
  const [expenseEditingId, setExpenseEditingId] = useState("");
  const [propertyEditingId, setPropertyEditingId] = useState("");
  const [vendorEditingId, setVendorEditingId] = useState("");
  const [expenseTypeEditingId, setExpenseTypeEditingId] = useState("");
  const [ownerForm, setOwnerForm] = useState(freshOwnerForm);
  const [expenseFile, setExpenseFile] = useState<File | null>(null);
  const [expenseForm, setExpenseForm] = useState(emptyExpenseForm);
  const [reportForm, setReportForm] = useState({
    reportKey: "statement" as ReportKey,
    month: String(new Date().getMonth() + 1),
    year: String(currentYear),
    property: "",
    calculationSource: "reports" as "reports" | "portal"
  });
  const [settingsForm, setSettingsForm] = useState({
    guestyCacheTtlMinutes: "30",
    defaultCleaningCaps: "[]"
  });
  const [propertyForm, setPropertyForm] = useState(emptyPropertyForm);
  const [vendorForm, setVendorForm] = useState(emptyVendorForm);
  const [expenseTypeForm, setExpenseTypeForm] = useState(emptyExpenseTypeForm);
  const [manageExpenseLists, setManageExpenseLists] = useState(false);
  const [currentReport, setCurrentReport] = useState<ReportResponse | null>(null);
  const [currentSavedReport, setCurrentSavedReport] = useState<SavedReport | null>(null);
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [statementEdit, setStatementEdit] = useState<StatementEdit | null>(null);
  const reportPreviewRef = useRef<HTMLDivElement | null>(null);
  const propertySettingsRef = useRef<HTMLFormElement | null>(null);

  const visibleOwners = useMemo(() => owners.filter((owner) => !isAggregateOwner(owner)), [owners]);
  const reportSupportsFullYear = reportForm.reportKey === "income" || reportForm.reportKey === "gri" || reportForm.reportKey === "1099";
  const reportRequiresFullYear = reportForm.reportKey === "1099";
  const reportSupportsPropertyFilter = reportForm.reportKey === "income" || reportForm.reportKey === "gri";
  const reportRequiresProperty = reportForm.reportKey === "gri";
  const selectedOwner = useMemo(
    () => visibleOwners.find((owner) => owner._id === selectedOwnerId) || visibleOwners[0],
    [visibleOwners, selectedOwnerId]
  );
  const reportPropertyOptions = useMemo(
    () => Array.from(new Set((selectedOwner?.properties || []).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [selectedOwner]
  );
  const ownerSavedReports = useMemo(
    () => savedReports.filter((report) => String(report.ownerId || "") === String(selectedOwner?._id || "")),
    [savedReports, selectedOwner]
  );

  const tabs = [
    { key: "reports" as const, label: "Reports", icon: BarChart3 },
    ...(isAdmin ? [{ key: "owners" as const, label: "Owners", icon: Building2 }] : []),
    { key: "expenses" as const, label: "Expenses", icon: CircleDollarSign },
    { key: "saved" as const, label: "Saved", icon: FileArchive },
    ...(isAdmin ? [{ key: "settings" as const, label: "Settings", icon: Settings }] : [])
  ];

  async function loadData() {
    setBusy("load");
    setError("");
    try {
      const [ownerData, expenseData, savedData, propertyData, vendorData, expenseTypeData, settingsData] = await Promise.all([
        api<{ owners: Owner[] }>("/api/owners"),
        api<{ expenses: Expense[] }>("/api/expenses"),
        api<{ savedReports: SavedReport[] }>("/api/saved-reports"),
        api<{ properties: Property[] }>("/api/properties"),
        api<{ vendors: Vendor[] }>("/api/vendors"),
        api<{ expenseTypes: ExpenseTypeOption[] }>("/api/expense-types"),
        api<{ settings: { guestyCacheTtlMinutes: number; defaultCleaningCaps: unknown[] } }>("/api/settings")
      ]);
      const visibleOwnerData = ownerData.owners.filter((owner) => !isAggregateOwner(owner));
      setOwners(ownerData.owners);
      setExpenses(expenseData.expenses);
      setSavedReports(savedData.savedReports);
      setProperties(propertyData.properties);
      setVendors(vendorData.vendors);
      setExpenseTypes(expenseTypeData.expenseTypes);
      setSettingsForm({
        guestyCacheTtlMinutes: String(settingsData.settings.guestyCacheTtlMinutes || 30),
        defaultCleaningCaps: stringify(settingsData.settings.defaultCleaningCaps)
      });
      if (selectedOwnerId && !visibleOwnerData.some((owner) => owner._id === selectedOwnerId)) setSelectedOwnerId("");
      if (!selectedOwnerId && visibleOwnerData[0]) setSelectedOwnerId(visibleOwnerData[0]._id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load data.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab !== "owners" || !selectedOwner?._id || ownerEditingId === selectedOwner._id) return;
    setOwnerEditingId(selectedOwner._id);
    setOwnerForm(ownerToForm(selectedOwner));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedOwner?._id]);

  useEffect(() => {
    if (tab !== "expenses" || expenseEditingId) return;
    const statementProperty = reportPropertyOptions.includes(reportForm.property) ? reportForm.property : "";
    const nextProperty = statementProperty || (reportPropertyOptions.length === 1 ? reportPropertyOptions[0] : "OWNER");
    setExpenseForm((current) => (current.property === nextProperty ? current : { ...current, property: nextProperty }));
  }, [tab, selectedOwner?._id, reportForm.property, reportPropertyOptions, expenseEditingId]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  function ownerToForm(owner: Owner) {
    return {
      name: owner.name || "",
      email: owner.email || "",
      type: owner.type || "draft",
      percent: String(owner.percent || 0),
      splitOwnerPercent: String(owner.splitOwnerPercent || 0),
      salesFeePercent: String(owner.salesFeePercent || 0),
      cleaningFee: String(owner.cleaningFee || 0),
      guestyReportUrl: owner.guestyReportUrl || "",
      guestyAllPropertiesUrl: owner.guestyAllPropertiesUrl || "",
      properties: stringify(owner.properties),
      portalPassword: "",
      recurringCharges: stringify(owner.recurringCharges),
      monthlyRecurringCharges: stringify(owner.monthlyRecurringCharges),
      specificDateRecurringCharges: stringify(owner.specificDateRecurringCharges),
      dateRangeRecurringCharges: stringify(owner.dateRangeRecurringCharges),
      cleaningCaps: stringify(owner.cleaningCaps),
      taxFlags: new Set(Object.entries(owner.taxFlags || {}).filter(([, enabled]) => enabled).map(([flag]) => flag))
    };
  }

  function editOwner(owner: Owner) {
    setOwnerEditingId(owner._id);
    setOwnerForm(ownerToForm(owner));
    setTab("owners");
  }

  async function saveOwner(event: React.FormEvent) {
    event.preventDefault();
    setBusy("owner");
    setError("");
    try {
      const taxFlags = Object.fromEntries(Array.from(ownerForm.taxFlags).map((flag) => [flag, true]));
      const body = {
        name: ownerForm.name,
        email: ownerForm.email,
        type: ownerForm.type,
        percent: Number(ownerForm.percent || 0),
        splitOwnerPercent: Number(ownerForm.splitOwnerPercent || 0),
        salesFeePercent: Number(ownerForm.salesFeePercent || 0),
        cleaningFee: Number(ownerForm.cleaningFee || 0),
        guestyReportUrl: ownerForm.guestyReportUrl,
        guestyAllPropertiesUrl: ownerForm.guestyAllPropertiesUrl,
        properties: parseArray(ownerForm.properties, "Properties"),
        portalPassword: ownerForm.portalPassword,
        recurringCharges: parseArray(ownerForm.recurringCharges, "Base recurring charges"),
        monthlyRecurringCharges: parseArray(ownerForm.monthlyRecurringCharges, "Monthly recurring charges"),
        specificDateRecurringCharges: parseArray(ownerForm.specificDateRecurringCharges, "Specific date recurring charges"),
        dateRangeRecurringCharges: parseArray(ownerForm.dateRangeRecurringCharges, "Date range recurring charges"),
        cleaningCaps: parseArray(ownerForm.cleaningCaps, "Cleaning caps"),
        taxFlags: ownerForm.type === "payout" ? taxFlags : {}
      };
      await api(ownerEditingId ? `/api/owners/${ownerEditingId}` : "/api/owners", {
        method: ownerEditingId ? "PATCH" : "POST",
        body: JSON.stringify(body)
      });
      await loadData();
      flash("Owner saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save owner.");
    } finally {
      setBusy("");
    }
  }

  async function deleteOwner(id: string) {
    if (!window.confirm("Delete this owner and their portal login?")) return;
    setBusy("owner-delete");
    try {
      await api(`/api/owners/${id}`, { method: "DELETE" });
      await loadData();
      flash("Owner deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete owner.");
    } finally {
      setBusy("");
    }
  }

  function updateArrayField<T extends Record<string, unknown>>(
    key: OwnerArrayField,
    index: number,
    field: keyof T,
    value: string
  ) {
    const rows = parseFormArray<T>(ownerForm[key]);
    rows[index] = { ...rows[index], [field]: value };
    setOwnerForm({ ...ownerForm, [key]: stringify(rows) });
  }

  function addArrayRow<T extends Record<string, unknown>>(key: OwnerArrayField, row: T) {
    setOwnerForm({ ...ownerForm, [key]: stringify([...parseFormArray<T>(ownerForm[key]), row]) });
  }

  function removeArrayRow<T>(key: OwnerArrayField, index: number) {
    setOwnerForm({ ...ownerForm, [key]: stringify(parseFormArray<T>(ownerForm[key]).filter((_, rowIndex) => rowIndex !== index)) });
  }

  async function uploadInvoice() {
    if (!expenseFile) return expenseForm.invoiceUrl;
    const form = new FormData();
    form.append("file", expenseFile);
    const data = await api<{ url: string }>("/api/invoices/upload", { method: "POST", body: form });
    return data.url;
  }

  async function saveExpense(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedOwnerId) {
      setError("Select an owner before saving an expense.");
      return;
    }
    setBusy("expense");
    setError("");
    try {
      const invoice = await uploadInvoice();
      await api(expenseEditingId ? `/api/expenses/${expenseEditingId}` : "/api/expenses", {
        method: expenseEditingId ? "PATCH" : "POST",
        body: JSON.stringify({
          ownerId: selectedOwnerId,
          property: expenseForm.property,
          type: expenseForm.type,
          vendor: expenseForm.vendor,
          amount: Number(expenseForm.amount || 0),
          notes: expenseForm.notes,
          invoiceUrl: invoice,
          month: Number(expenseForm.month),
          year: Number(expenseForm.year)
        })
      });
      setExpenseEditingId("");
      setExpenseForm(emptyExpenseForm);
      setExpenseFile(null);
      await loadData();
      flash(expenseEditingId ? "Expense updated." : "Expense saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save expense.");
    } finally {
      setBusy("");
    }
  }

  function editExpense(expense: Expense) {
    setExpenseEditingId(expense._id);
    setExpenseForm({
      property: expense.property || "",
      type: expense.type || "",
      vendor: expense.vendor || "",
      amount: String(expense.amount ?? ""),
      notes: expense.notes || "",
      invoiceUrl: expense.invoiceUrl || "",
      month: String(expense.month || new Date().getMonth() + 1),
      year: String(expense.year || currentYear)
    });
    setExpenseFile(null);
  }

  function openInvoice(url?: string) {
    const text = String(url || "").trim();
    if (!text) {
      setError("No invoice link is saved for this expense.");
      return;
    }
    try {
      const parsed = new URL(text);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Invalid invoice link.");
      window.open(parsed.toString(), "_blank", "noopener,noreferrer");
    } catch {
      setError("This invoice link is invalid. Edit the expense and replace the invoice.");
    }
  }

  async function deleteExpense(id: string) {
    if (!window.confirm("Delete this expense?")) return;
    try {
      await api(`/api/expenses/${id}`, { method: "DELETE" });
      await loadData();
      flash("Expense deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete expense.");
    }
  }

  async function generateReport(event: React.FormEvent) {
    event.preventDefault();
    await runReport();
  }

  async function runReport() {
    setBusy("report");
    setError("");
    setCurrentReport(null);
    setCurrentSavedReport(null);
    try {
      const month = reportForm.month === "full-year" ? undefined : Number(reportForm.month);
      const body = {
        ...reportForm,
        ownerId: isAdmin ? selectedOwnerId : user.ownerId,
        month,
        year: Number(reportForm.year)
      };
      const data = await api<{ report: ReportResponse }>("/api/reports", {
        method: "POST",
        body: JSON.stringify(body)
      });
      setCurrentReport(data.report);
      flash("Report generated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate report.");
    } finally {
      setBusy("");
    }
  }

  function moneyToNumber(value: string) {
    return Number(value.replace(/[^0-9.-]/g, "")) || 0;
  }

  function dateInputValue(value: string) {
    const text = value.trim();
    const usDate = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (usDate) return `${usDate[3]}-${usDate[1].padStart(2, "0")}-${usDate[2].padStart(2, "0")}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  }

  function calculatedReservationValues(netAccommodation: number, current: Record<string, string>) {
    if (!selectedOwner) return current;
    const pmcRate = selectedOwner.type === "split"
      ? 1 - Number(selectedOwner.splitOwnerPercent || 0) / 100
      : Number(selectedOwner.percent || 0);
    const pmc = netAccommodation * pmcRate;
    const ownerPayout = selectedOwner.type === "split"
      ? netAccommodation * (Number(selectedOwner.splitOwnerPercent || 0) / 100)
      : netAccommodation - pmc;
    const next: Record<string, string> = {
      ...current,
      pmc: pmc.toFixed(2),
      ownerPayout: ownerPayout.toFixed(2)
    };
    if ("amountDue" in current) {
      next.amountDue = (
        pmc +
        moneyToNumber(current.cleaningFee || "0") +
        moneyToNumber(current.vrboWebsiteFee || "0")
      ).toFixed(2);
    }
    return next;
  }

  function openMissingReservation() {
    const property = reportForm.property || selectedOwner?.properties?.[0] || "";
    const identityFields: StatementEdit["fields"] = [
      { key: "property", label: "Property", type: "text" },
      { key: "reservationCode", label: "Reservation Code", type: "text" },
      { key: "guestName", label: "Guest Name", type: "text" },
      { key: "checkIn", label: "Check In", type: "date" },
      { key: "checkOut", label: "Check Out", type: "date" },
      { key: "nights", label: "Nights", type: "number" }
    ];
    const amountFields: StatementEdit["fields"] = selectedOwner?.type === "draft"
      ? [
          { key: "grossPayout", label: "Gross Payout", type: "number" },
          { key: "cleaningFee", label: "Cleaning Fee", type: "number" },
          { key: "netAcc", label: "Net Accommodation", type: "number" },
          { key: "vrboWebsiteFee", label: "VRBO/Website Fee", type: "number" },
          { key: "pmc", label: "PMC", type: "number" },
          { key: "amountDue", label: "Amount Due", type: "number" }
        ]
      : [
          { key: "netAcc", label: "Net Accommodation", type: "number" },
          { key: "pmc", label: "PMC", type: "number" },
          { key: "ownerPayout", label: "Owner Payout", type: "number" },
          { key: "expectedPayout", label: "Expected Payout", type: "date" }
        ];
    const fields = [...identityFields, ...amountFields];
    const values: Record<string, string> = {
      property,
      reservationCode: "",
      guestName: "",
      checkIn: "",
      checkOut: "",
      nights: "0",
      netAcc: "0",
      pmc: "0.00"
    };
    if (selectedOwner?.type === "draft") {
      Object.assign(values, { grossPayout: "0", cleaningFee: "0", vrboWebsiteFee: "0", amountDue: "0.00" });
    } else {
      Object.assign(values, { ownerPayout: "0.00", expectedPayout: "" });
    }
    setStatementEdit({
      kind: "reservation",
      id: `manual-${Date.now()}`,
      isOwnerStay: false,
      isNew: true,
      fields,
      values,
      originalValues: { ...values }
    });
  }

  function fieldKey(label: string) {
    const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const map: Record<string, string> = {
      "reservation code": "reservationCode",
      guest: "guestName",
      "guest name": "guestName",
      property: "property",
      "check in": "checkIn",
      "check out": "checkOut",
      nights: "nights",
      source: "source",
      gross: "grossPayout",
      "gross payout": "grossPayout",
      "cleaning fee": "cleaningFee",
      cleaning: "cleaningFee",
      "net acc": "netAcc",
      "net accommodation": "netAcc",
      "vrbo website fee": "vrboWebsiteFee",
      pmc: "pmc",
      "owner payout": "ownerPayout",
      "expected payout": "expectedPayout",
      "amount due": "amountDue",
      "owner stay": "ownerStay",
      type: "type",
      note: "notes",
      vendor: "vendor",
      amount: "amount",
      period: "period",
      invoice: "invoiceUrl"
    };
    return map[normalized] || normalized.replace(/ ([a-z0-9])/g, (_, char: string) => char.toUpperCase());
  }

  function fieldType(key: string, label: string): "text" | "number" | "date" {
    if (["checkIn", "checkOut", "expectedPayout"].includes(key) || label.toLowerCase().includes("date")) return "date";
    if (
      ["nights", "grossPayout", "cleaningFee", "netAcc", "vrboWebsiteFee", "pmc", "ownerPayout", "amountDue", "ownerStay", "amount"].includes(key)
    ) {
      return "number";
    }
    return "text";
  }

  function printLink(savedReport: SavedReport) {
    return `${window.location.origin}/print/${savedReport.shareId}`;
  }

  function nextTransferDate() {
    const month = reportForm.month === "full-year" ? 12 : Number(reportForm.month);
    const year = Number(reportForm.year);
    const date = new Date(year, month, 5);
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  async function ensureSavedReport() {
    if (currentSavedReport) return currentSavedReport;
    return saveReport();
  }

  async function downloadPdf() {
    try {
      setBusy("pdf");
      const saved = await ensureSavedReport();
      if (!saved) return;
      const link = document.createElement("a");
      link.href = `/api/reports/pdf/${saved.shareId}`;
      link.download = `${currentReport?.title || "ocean-vacations-report"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to prepare PDF.");
    } finally {
      setBusy("");
    }
  }

  async function printPdf() {
    try {
      setBusy("print");
      const saved = await ensureSavedReport();
      if (!saved) return;
      window.open(`${printLink(saved)}?print=1`, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to prepare print view.");
    } finally {
      setBusy("");
    }
  }

  async function openEmailClient() {
    try {
      setBusy("email");
      const saved = await ensureSavedReport();
      if (!saved) return;
      const link = printLink(saved);
      const ownerEmail = selectedOwner?.email || "";
      setEmailDraft({
        to: ownerEmail,
        subject: "Your Ocean Vacations Statement is Ready",
        message: `Hi,\n\nHere is your statement for ${currentReport?.periodLabel || (reportForm.month === "full-year" ? reportForm.year : `${months[Number(reportForm.month) - 1]} ${reportForm.year}`)}.\nThe transfer will be processed on ${nextTransferDate()}.\n\nThank you,\nOcean Vacations.`,
        reportLink: link
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to prepare email.");
    } finally {
      setBusy("");
    }
  }

  function sendEmailDraft() {
    if (!emailDraft) return;
    const body = `${emailDraft.message}\n\nReport link:\n${emailDraft.reportLink}`;
    const params = new URLSearchParams({
      view: "cm",
      fs: "1",
      to: emailDraft.to,
      su: emailDraft.subject,
      body
    });
    const gmailUrl = `https://mail.google.com/mail/?${params.toString()}`;
    const gmailWindow = window.open(gmailUrl, "_blank");
    if (gmailWindow) {
      gmailWindow.opener = null;
    } else {
      window.location.assign(gmailUrl);
    }
    setEmailDraft(null);
  }

  async function handleStatementTableAction(event: MouseEvent | React.MouseEvent<HTMLDivElement>) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-report-action]");
    if (!button || reportForm.reportKey !== "statement") return;
    event.preventDefault();
    event.stopPropagation();

    const ownerId = isAdmin ? selectedOwnerId : user.ownerId;
    if (!ownerId) return;
    const kind = button.dataset.reportKind || "";
    const id = button.dataset.reportId || "";
    const action = button.dataset.reportAction || "";
    const row = button.closest("tr");
    const table = button.closest("table");
    const headers = Array.from(table?.querySelectorAll("th") || [])
      .map((cell) => cell.textContent?.trim() || "")
      .filter((label) => label && label !== "Actions");
    const cells = Array.from(row?.querySelectorAll("td") || [])
      .slice(0, headers.length)
      .map((cell) => cell.textContent?.trim() || "");
    const fields = headers.map((label) => {
      const key = fieldKey(label);
      return { key, label, type: fieldType(key, label) };
    });
    const values = fields.reduce<Record<string, string>>((acc, field, index) => {
      acc[field.key] = cells[index] || "";
      return acc;
    }, {});

    try {
      if (action === "delete") {
        if (!window.confirm("Delete this row from MongoDB?")) return;
        await api("/api/statement-items", {
          method: "DELETE",
          body: JSON.stringify({ ownerId, kind, id })
        });
      } else {
        const isOwnerStay = Boolean(button.closest("table")?.querySelector("th:nth-child(4)")?.textContent?.includes("Owner Stay"));
        const normalizedValues = fields.reduce<Record<string, string>>((acc, field) => {
          acc[field.key] = field.type === "date" ? dateInputValue(values[field.key] || "") : values[field.key] || "";
          return acc;
        }, {});
        setStatementEdit({ kind, id, isOwnerStay, fields, values: normalizedValues, originalValues: { ...normalizedValues } });
        return;
      }
      await loadData();
      await runReport();
      flash("Statement row updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update statement row.");
    }
  }

  useEffect(() => {
    const node = reportPreviewRef.current;
    if (!node || reportForm.reportKey !== "statement") return;
    const listener = (event: MouseEvent) => {
      void handleStatementTableAction(event);
    };
    node.addEventListener("click", listener, true);
    return () => node.removeEventListener("click", listener, true);
  });

  async function saveStatementEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!statementEdit) return;
    const ownerId = isAdmin ? selectedOwnerId : user.ownerId;
    if (!ownerId) return;

    const values: Record<string, string | number> = { ...statementEdit.values };
    if (statementEdit.kind === "reservation") {
      const accommodationChanged =
        moneyToNumber(String(values.netAcc || "0")) !== moneyToNumber(statementEdit.originalValues.netAcc || "0");
      if (values.nights !== undefined) values.nights = Number(values.nights) || 0;
      for (const key of ["grossPayout", "cleaningFee", "netAcc", "vrboWebsiteFee", "pmc", "ownerPayout", "amountDue", "ownerStay"]) {
        if (values[key] !== undefined) values[key] = moneyToNumber(String(values[key] || "0"));
      }
      if (accommodationChanged || statementEdit.isNew) {
        values.autoRecalculate = 1;
        delete values.pmc;
        delete values.ownerPayout;
        delete values.amountDue;
      }
    } else {
      if (values.amount !== undefined) values.amount = moneyToNumber(String(values.amount || "0"));
      if (statementEdit.kind === "recurring") {
        delete values.property;
        delete values.vendor;
        delete values.invoiceUrl;
      }
    }

    try {
      const itemId = statementEdit.isNew && typeof values.reservationCode === "string"
        ? values.reservationCode.trim()
        : statementEdit.id;
      await api("/api/statement-items", {
        method: statementEdit.isNew ? "POST" : "PATCH",
        body: JSON.stringify({ ownerId, kind: statementEdit.kind, id: itemId, values })
      });
      setStatementEdit(null);
      await loadData();
      await runReport();
      flash("Statement row updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update statement row.");
    }
  }

  async function saveReport() {
    if (!currentReport) return null;
    setBusy("save-report");
    setError("");
    try {
      const data = await api<SavedReportResponse>("/api/reports/save", {
        method: "POST",
        body: JSON.stringify({
          ownerId: isAdmin ? selectedOwnerId || null : user.ownerId,
          reportKey: reportForm.reportKey,
          reportTitle: currentReport.title,
          periodLabel: currentReport.periodLabel,
          htmlSnapshot: currentReport.html
        })
      });
      setCurrentSavedReport(data.savedReport);
      await loadData();
      flash("Snapshot saved.");
      return data.savedReport;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save report.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    setBusy("settings");
    setError("");
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          guestyCacheTtlMinutes: Number(settingsForm.guestyCacheTtlMinutes),
          defaultCleaningCaps: parseArray(settingsForm.defaultCleaningCaps, "Default cleaning caps")
        })
      });
      flash("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save settings.");
    } finally {
      setBusy("");
    }
  }

  async function saveProperty(event: React.FormEvent) {
    event.preventDefault();
    setBusy("property");
    try {
      const flags = Object.fromEntries(Array.from(propertyForm.taxFlags).map((flag) => [flag, true]));
      await api(propertyEditingId ? `/api/properties/${propertyEditingId}` : "/api/properties", {
        method: propertyEditingId ? "PATCH" : "POST",
        body: JSON.stringify({
          name: propertyForm.name,
          reportAddress: propertyForm.reportAddress,
          municipality: propertyForm.municipality,
          taxFlags: flags
        })
      });
      setPropertyEditingId("");
      setPropertyForm(emptyPropertyForm);
      await loadData();
      flash(propertyEditingId ? "Property updated." : "Property saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save property.");
    } finally {
      setBusy("");
    }
  }

  function loadPropertySettings(propertyName: string) {
    const property = properties.find((item) => item.name === propertyName);
    if (!property) return;
    setPropertyEditingId(property._id);
    setPropertyForm({
      name: property.name,
      reportAddress: property.reportAddress || "",
      municipality: property.municipality || "",
      taxFlags: new Set(Object.entries(property.taxFlags || {}).filter(([, enabled]) => enabled).map(([flag]) => flag))
    });
  }

  async function deleteProperty(id: string) {
    if (!window.confirm("Delete this property?")) return;
    setBusy("property-delete");
    setError("");
    try {
      await api(`/api/properties/${id}`, { method: "DELETE" });
      if (propertyEditingId === id) {
        setPropertyEditingId("");
        setPropertyForm(emptyPropertyForm);
      }
      await loadData();
      flash("Property deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete property.");
    } finally {
      setBusy("");
    }
  }

  function openTaxSettings(propertyName = "") {
    setTab("settings");
    if (propertyName) loadPropertySettings(propertyName);
    window.setTimeout(() => propertySettingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  async function saveVendor(event: React.FormEvent) {
    event.preventDefault();
    setBusy("vendor");
    try {
      const wasEditing = Boolean(vendorEditingId);
      const data = await api<{ vendor: Vendor }>(vendorEditingId ? `/api/vendors/${vendorEditingId}` : "/api/vendors", {
        method: vendorEditingId ? "PATCH" : "POST",
        body: JSON.stringify(vendorForm)
      });
      if (manageExpenseLists) setExpenseForm((current) => ({ ...current, vendor: data.vendor.name }));
      setVendorEditingId("");
      setVendorForm(emptyVendorForm);
      await loadData();
      flash(wasEditing ? "Vendor updated." : "Vendor saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save vendor.");
    } finally {
      setBusy("");
    }
  }

  function editVendor(vendor: Vendor) {
    setVendorEditingId(vendor._id);
    setVendorForm({ name: vendor.name || "", phone: vendor.phone || "" });
  }

  async function deleteVendor(id: string) {
    if (!window.confirm("Delete this vendor?")) return;
    setBusy("vendor-delete");
    setError("");
    try {
      const deletedVendor = vendors.find((vendor) => vendor._id === id);
      await api(`/api/vendors/${id}`, { method: "DELETE" });
      if (deletedVendor?.name === expenseForm.vendor) setExpenseForm((current) => ({ ...current, vendor: "" }));
      if (vendorEditingId === id) {
        setVendorEditingId("");
        setVendorForm(emptyVendorForm);
      }
      await loadData();
      flash("Vendor deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete vendor.");
    } finally {
      setBusy("");
    }
  }

  async function saveExpenseType(event: React.FormEvent) {
    event.preventDefault();
    setBusy("expense-type");
    setError("");
    try {
      const wasEditing = Boolean(expenseTypeEditingId);
      const data = await api<{ expenseType: ExpenseTypeOption }>(
        expenseTypeEditingId ? `/api/expense-types/${expenseTypeEditingId}` : "/api/expense-types",
        {
          method: expenseTypeEditingId ? "PATCH" : "POST",
          body: JSON.stringify(expenseTypeForm)
        }
      );
      setExpenseForm((current) => ({ ...current, type: data.expenseType.name }));
      setExpenseTypeEditingId("");
      setExpenseTypeForm(emptyExpenseTypeForm);
      await loadData();
      flash(wasEditing ? "Expense type updated." : "Expense type saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save expense type.");
    } finally {
      setBusy("");
    }
  }

  function editExpenseType(expenseType: ExpenseTypeOption) {
    setExpenseTypeEditingId(expenseType._id);
    setExpenseTypeForm({ name: expenseType.name });
    setManageExpenseLists(true);
  }

  async function deleteExpenseType(id: string) {
    if (!window.confirm("Delete this expense type? Existing expenses will keep their saved type.")) return;
    setBusy("expense-type-delete");
    setError("");
    try {
      const deletedType = expenseTypes.find((expenseType) => expenseType._id === id);
      await api(`/api/expense-types/${id}`, { method: "DELETE" });
      if (deletedType?.name === expenseForm.type) setExpenseForm((current) => ({ ...current, type: "" }));
      if (expenseTypeEditingId === id) {
        setExpenseTypeEditingId("");
        setExpenseTypeForm(emptyExpenseTypeForm);
      }
      await loadData();
      flash("Expense type deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete expense type.");
    } finally {
      setBusy("");
    }
  }

  async function deleteSavedReport(shareId: string) {
    if (!window.confirm("Delete this saved report?")) return;
    setBusy("saved-delete");
    setError("");
    try {
      await api(`/api/saved-reports/${shareId}`, { method: "DELETE" });
      setSavedReports((current) => current.filter((report) => report.shareId !== shareId));
      flash("Saved report deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete saved report.");
    } finally {
      setBusy("");
    }
  }

  const ownerExpenses = expenses
    .filter(
      (expense) =>
        (!selectedOwnerId || expense.ownerId === selectedOwnerId) &&
        expense.property === expenseForm.property &&
        expense.month === Number(expenseForm.month) &&
        expense.year === Number(expenseForm.year)
    )
    .sort((a, b) => a.property.localeCompare(b.property) || a.type.localeCompare(b.type));
  const reportIsAdminOnly = ["summary", "allOwnersTax"].includes(reportForm.reportKey);

  return (
    <main className="app-shell">
      <aside className="side-nav">
        <div className="nav-brand">
          <Home size={22} />
          <span>Ocean</span>
        </div>
        <nav>
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <button className="logout-button" onClick={logout}>
          <LogOut size={18} />
          <span>Sign out</span>
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span>{isAdmin ? "Admin" : "Owner"} workspace</span>
            <h1>{selectedOwner?.name || user.displayName || "Reports"}</h1>
          </div>
          <div className="topbar-actions">
            {isAdmin && (
              <select value={selectedOwnerId} onChange={(event) => setSelectedOwnerId(event.target.value)}>
                <option value="">All owners</option>
                {visibleOwners.map((owner) => (
                  <option key={owner._id} value={owner._id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </header>

        {(notice || error) && (
          <div className={error ? "message error" : "message"}>
            {error || notice}
            <button onClick={() => (error ? setError("") : setNotice(""))} aria-label="Close message">
              <X size={16} />
            </button>
          </div>
        )}

        {tab === "reports" && (
          <section className="view-band">
            <form className="control-grid" onSubmit={generateReport}>
              <label>
                Report
                <select
                  value={reportForm.reportKey}
                  onChange={(event) => {
                    const reportKey = event.target.value as ReportKey;
                    const supportsFullYear = reportKey === "income" || reportKey === "gri" || reportKey === "1099";
                    const requiresFullYear = reportKey === "1099";
                    setReportForm({
                      ...reportForm,
                      reportKey,
                      month: requiresFullYear
                        ? "full-year"
                        : (!supportsFullYear && reportForm.month === "full-year" ? String(new Date().getMonth() + 1) : reportForm.month),
                      property:
                        reportKey === "income" || reportKey === "gri"
                          ? (reportKey === "gri" && !reportForm.property ? reportPropertyOptions[0] || "" : reportForm.property)
                          : ""
                    });
                  }}
                >
                  {reportOptions
                    .filter((option) => isAdmin || !option.adminOnly)
                    .map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Month
                <select
                  value={reportRequiresFullYear ? "full-year" : reportForm.month}
                  onChange={(event) => setReportForm({ ...reportForm, month: event.target.value })}
                  disabled={reportRequiresFullYear}
                >
                  {reportSupportsFullYear && <option value="full-year">Full year</option>}
                  {!reportRequiresFullYear && months.map((month, index) => (
                    <option key={month} value={index + 1}>
                      {month}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Year
                <select value={reportForm.year} onChange={(event) => setReportForm({ ...reportForm, year: event.target.value })}>
                  {reportYearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              {reportSupportsPropertyFilter && (
                <label>
                  Property
                  <select value={reportForm.property} onChange={(event) => setReportForm({ ...reportForm, property: event.target.value })}>
                    {!reportRequiresProperty && <option value="">All properties</option>}
                    {reportPropertyOptions.map((property) => (
                      <option key={property} value={property}>
                        {property}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                className="primary-action"
                disabled={busy === "report" || (!reportIsAdminOnly && !selectedOwnerId) || (reportRequiresProperty && !reportForm.property)}
              >
                <BarChart3 size={18} />
                {busy === "report" ? "Generating..." : "Generate"}
              </button>
            </form>

            {currentReport && (
              <section className="report-stage">
                <div className="report-toolbar">
                  <div className="report-actions">
                    {reportForm.reportKey === "statement" && (
                      <button className="secondary-action" type="button" onClick={openMissingReservation}>
                        <Plus size={18} />
                        Add missing reservation
                      </button>
                    )}
                    <button className="secondary-action" onClick={saveReport} disabled={busy === "save-report"}>
                      <Save size={18} />
                      {busy === "save-report" ? "Saving..." : "Save snapshot"}
                    </button>
                    <button className="secondary-action" onClick={downloadPdf} disabled={busy === "pdf" || busy === "save-report"}>
                      <Download size={18} />
                      {busy === "pdf" ? "Downloading..." : "Download PDF"}
                    </button>
                    <button className="secondary-action" onClick={printPdf} disabled={busy === "print" || busy === "save-report"}>
                      <Printer size={18} />
                      {busy === "print" ? "Opening..." : "Print PDF"}
                    </button>
                    <button className="secondary-action" onClick={openEmailClient} disabled={busy === "email" || busy === "save-report"}>
                      <Mail size={18} />
                      Email client
                    </button>
                    {reportForm.reportKey === "allOwnersTax" && isAdmin && (
                      <button className="secondary-action" type="button" onClick={() => openTaxSettings()}>
                        <MapPinned size={18} />
                        Tax settings
                      </button>
                    )}
                  </div>
                </div>
                <div ref={reportPreviewRef} className="report-preview" dangerouslySetInnerHTML={{ __html: currentReport.html }} />
              </section>
            )}
          </section>
        )}

        {tab === "owners" && isAdmin && (
          <section className="split-view single-view">
            <form className="editor-panel" onSubmit={saveOwner}>
              <div className="panel-heading">
                <SlidersHorizontal size={20} />
                <h2>{selectedOwner?.name || "Owner"} Settings</h2>
              </div>
              <div className="form-grid">
                <label>
                  Name
                  <input value={ownerForm.name} onChange={(event) => setOwnerForm({ ...ownerForm, name: event.target.value })} required />
                </label>
                <label>
                  Email
                  <input value={ownerForm.email} onChange={(event) => setOwnerForm({ ...ownerForm, email: event.target.value })} type="email" />
                </label>
                <label>
                  Type
                  <select value={ownerForm.type} onChange={(event) => setOwnerForm({ ...ownerForm, type: event.target.value })}>
                    <option value="draft">Draft</option>
                    <option value="payout">Payout</option>
                    <option value="split">Split</option>
                  </select>
                </label>
                <label>
                  PMC percent
                  <input value={ownerForm.percent} onChange={(event) => setOwnerForm({ ...ownerForm, percent: event.target.value })} inputMode="decimal" />
                </label>
                <label>
                  Sales fee percent
                  <input value={ownerForm.salesFeePercent} onChange={(event) => setOwnerForm({ ...ownerForm, salesFeePercent: event.target.value })} inputMode="decimal" />
                </label>
                <label>
                  Split owner percent
                  <input value={ownerForm.splitOwnerPercent} onChange={(event) => setOwnerForm({ ...ownerForm, splitOwnerPercent: event.target.value })} inputMode="decimal" />
                </label>
                <label>
                  Owner stay cleaning fee
                  <input value={ownerForm.cleaningFee} onChange={(event) => setOwnerForm({ ...ownerForm, cleaningFee: event.target.value })} inputMode="decimal" />
                </label>
              </div>
              {ownerForm.type === "payout" && (
                <div className="fee-editor owner-tax-settings">
                  <div className="panel-heading small">
                    <MapPinned size={18} />
                    <h3>Property taxes</h3>
                  </div>
                  <p className="muted-copy">Set the tax groups used for this payout owner when a property does not have its own tax setting.</p>
                  <div className="flag-row">
                    {ownerTaxFlagOptions.map((flag) => (
                      <label key={flag}>
                        <input
                          type="checkbox"
                          checked={ownerForm.taxFlags.has(flag)}
                          onChange={(event) => {
                            const next = new Set(ownerForm.taxFlags);
                            if (event.target.checked) next.add(flag);
                            else next.delete(flag);
                            setOwnerForm({ ...ownerForm, taxFlags: next });
                          }}
                        />
                        {flag}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <label>
                Guesty report URL
                <input value={ownerForm.guestyReportUrl} onChange={(event) => setOwnerForm({ ...ownerForm, guestyReportUrl: event.target.value })} />
              </label>
              <label>
                Guesty all-properties URL
                <input value={ownerForm.guestyAllPropertiesUrl} onChange={(event) => setOwnerForm({ ...ownerForm, guestyAllPropertiesUrl: event.target.value })} />
              </label>
              <label>
                Properties
                <textarea value={ownerForm.properties} onChange={(event) => setOwnerForm({ ...ownerForm, properties: event.target.value })} />
              </label>
              <label>
                Portal password
                <input
                  value={ownerForm.portalPassword}
                  onChange={(event) => setOwnerForm({ ...ownerForm, portalPassword: event.target.value })}
                  type="password"
                  placeholder={ownerEditingId ? "Leave blank to keep current" : "Optional owner login"}
                />
              </label>
              <div className="fee-editor">
                <div className="panel-heading small">
                  <CircleDollarSign size={18} />
                  <h3>Fees and recurring charges</h3>
                </div>

                <div className="charge-section">
                  <div className="charge-heading">
                    <strong>Base recurring charges</strong>
                    <button className="secondary-action small" type="button" onClick={() => addArrayRow("recurringCharges", { label: "", amount: 0 })}>
                      <Plus size={16} />
                      Add
                    </button>
                  </div>
                  {parseFormArray<{ label?: string; amount?: number | string }>(ownerForm.recurringCharges).map((charge, index) => (
                    <div className="charge-row two" key={`recurring-${index}`}>
                      <input value={charge.label || ""} onChange={(event) => updateArrayField("recurringCharges", index, "label", event.target.value)} placeholder="Label" />
                      <input value={String(charge.amount ?? "")} onChange={(event) => updateArrayField("recurringCharges", index, "amount", event.target.value)} inputMode="decimal" placeholder="Amount" />
                      <button className="icon-button danger" type="button" onClick={() => removeArrayRow("recurringCharges", index)} title="Remove charge">
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="charge-section">
                  <div className="charge-heading">
                    <strong>Monthly recurring</strong>
                    <button className="secondary-action small" type="button" onClick={() => addArrayRow("monthlyRecurringCharges", { month: 1, label: "", amount: 0 })}>
                      <Plus size={16} />
                      Add
                    </button>
                  </div>
                  {parseFormArray<{ month?: number | string; label?: string; amount?: number | string }>(ownerForm.monthlyRecurringCharges).map((charge, index) => (
                    <div className="charge-row three" key={`monthly-${index}`}>
                      <input value={String(charge.month ?? "")} onChange={(event) => updateArrayField("monthlyRecurringCharges", index, "month", event.target.value)} inputMode="numeric" placeholder="Month" />
                      <input value={charge.label || ""} onChange={(event) => updateArrayField("monthlyRecurringCharges", index, "label", event.target.value)} placeholder="Label" />
                      <input value={String(charge.amount ?? "")} onChange={(event) => updateArrayField("monthlyRecurringCharges", index, "amount", event.target.value)} inputMode="decimal" placeholder="Amount" />
                      <button className="icon-button danger" type="button" onClick={() => removeArrayRow("monthlyRecurringCharges", index)} title="Remove charge">
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="charge-section">
                  <div className="charge-heading">
                    <strong>Specific date recurring</strong>
                    <button className="secondary-action small" type="button" onClick={() => addArrayRow("specificDateRecurringCharges", { month: 1, day: 1, label: "", amount: 0 })}>
                      <Plus size={16} />
                      Add
                    </button>
                  </div>
                  {parseFormArray<{ month?: number | string; day?: number | string; label?: string; amount?: number | string }>(ownerForm.specificDateRecurringCharges).map((charge, index) => (
                    <div className="charge-row four" key={`specific-${index}`}>
                      <input value={String(charge.month ?? "")} onChange={(event) => updateArrayField("specificDateRecurringCharges", index, "month", event.target.value)} inputMode="numeric" placeholder="Month" />
                      <input value={String(charge.day ?? "")} onChange={(event) => updateArrayField("specificDateRecurringCharges", index, "day", event.target.value)} inputMode="numeric" placeholder="Day" />
                      <input value={charge.label || ""} onChange={(event) => updateArrayField("specificDateRecurringCharges", index, "label", event.target.value)} placeholder="Label" />
                      <input value={String(charge.amount ?? "")} onChange={(event) => updateArrayField("specificDateRecurringCharges", index, "amount", event.target.value)} inputMode="decimal" placeholder="Amount" />
                      <button className="icon-button danger" type="button" onClick={() => removeArrayRow("specificDateRecurringCharges", index)} title="Remove charge">
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="charge-section">
                  <div className="charge-heading">
                    <strong>Date range recurring</strong>
                    <button className="secondary-action small" type="button" onClick={() => addArrayRow("dateRangeRecurringCharges", { startDate: "", endDate: "", label: "", amount: 0 })}>
                      <Plus size={16} />
                      Add
                    </button>
                  </div>
                  {parseFormArray<{ startDate?: string; endDate?: string; label?: string; amount?: number | string }>(ownerForm.dateRangeRecurringCharges).map((charge, index) => (
                    <div className="charge-row four" key={`range-${index}`}>
                      <input value={charge.startDate || ""} onChange={(event) => updateArrayField("dateRangeRecurringCharges", index, "startDate", event.target.value)} placeholder="Start date" />
                      <input value={charge.endDate || ""} onChange={(event) => updateArrayField("dateRangeRecurringCharges", index, "endDate", event.target.value)} placeholder="End date" />
                      <input value={charge.label || ""} onChange={(event) => updateArrayField("dateRangeRecurringCharges", index, "label", event.target.value)} placeholder="Label" />
                      <input value={String(charge.amount ?? "")} onChange={(event) => updateArrayField("dateRangeRecurringCharges", index, "amount", event.target.value)} inputMode="decimal" placeholder="Amount" />
                      <button className="icon-button danger" type="button" onClick={() => removeArrayRow("dateRangeRecurringCharges", index)} title="Remove charge">
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="charge-section">
                  <div className="charge-heading">
                    <strong>Cleaning caps</strong>
                    <button className="secondary-action small" type="button" onClick={() => addArrayRow("cleaningCaps", { property: "", maxAmount: 0 })}>
                      <Plus size={16} />
                      Add
                    </button>
                  </div>
                  {parseFormArray<{ property?: string; maxAmount?: number | string }>(ownerForm.cleaningCaps).map((cap, index) => (
                    <div className="charge-row two" key={`cap-${index}`}>
                      <input value={cap.property || ""} onChange={(event) => updateArrayField("cleaningCaps", index, "property", event.target.value)} placeholder="Property" />
                      <input value={String(cap.maxAmount ?? "")} onChange={(event) => updateArrayField("cleaningCaps", index, "maxAmount", event.target.value)} inputMode="decimal" placeholder="Max amount" />
                      <button className="icon-button danger" type="button" onClick={() => removeArrayRow("cleaningCaps", index)} title="Remove cap">
                        <Trash2 size={17} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="button-row">
                <button className="primary-action" disabled={busy === "owner"}>
                  <Save size={18} />
                  Save owner
                </button>
              </div>
            </form>
          </section>
        )}

        {tab === "expenses" && (
          <section className="split-view">
            {isAdmin && (
              <form className="editor-panel compact" onSubmit={saveExpense}>
                <div className="panel-heading">
                  <CircleDollarSign size={20} />
                  <h2>{expenseEditingId ? "Edit Expense" : "Add Expense"}</h2>
                </div>
                <div className="form-grid">
                  <label>
                    Apply expense to
                    <select value={expenseForm.property} onChange={(event) => setExpenseForm({ ...expenseForm, property: event.target.value })} required>
                      <option value="OWNER">Owner-level expense</option>
                      {reportPropertyOptions.map((property) => (
                        <option value={property} key={property}>
                          {property}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Type
                    <select
                      value={expenseForm.type}
                      onChange={(event) => {
                        if (event.target.value === "__add_new__") {
                          setExpenseTypeEditingId("");
                          setExpenseTypeForm(emptyExpenseTypeForm);
                          setManageExpenseLists(true);
                          return;
                        }
                        setExpenseForm({ ...expenseForm, type: event.target.value });
                      }}
                      required
                    >
                      <option value="">Select type</option>
                      {expenseTypes.map((expenseType) => (
                        <option value={expenseType.name} key={expenseType._id}>
                          {expenseType.name}
                        </option>
                      ))}
                      <option value="__add_new__">+ Add new type</option>
                    </select>
                  </label>
                  <label>
                    Vendor
                    <select
                      value={expenseForm.vendor}
                      onChange={(event) => {
                        if (event.target.value === "__add_new__") {
                          setVendorEditingId("");
                          setVendorForm(emptyVendorForm);
                          setManageExpenseLists(true);
                          return;
                        }
                        setExpenseForm({ ...expenseForm, vendor: event.target.value });
                      }}
                    >
                      <option value="">Select vendor</option>
                      {vendors.map((vendor) => (
                        <option value={vendor.name} key={vendor._id}>
                          {vendor.name}
                        </option>
                      ))}
                      <option value="__add_new__">+ Add new vendor</option>
                    </select>
                  </label>
                  <label>
                    Amount
                    <input value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} inputMode="decimal" required />
                  </label>
                  <label>
                    Month
                    <select value={expenseForm.month} onChange={(event) => setExpenseForm({ ...expenseForm, month: event.target.value })}>
                      {months.map((month, index) => (
                        <option key={month} value={index + 1}>
                          {month}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Year
                    <input value={expenseForm.year} onChange={(event) => setExpenseForm({ ...expenseForm, year: event.target.value })} inputMode="numeric" />
                  </label>
                </div>
                <button className="secondary-action small manage-lists-button" type="button" onClick={() => setManageExpenseLists((current) => !current)}>
                  <SlidersHorizontal size={17} />
                  {manageExpenseLists ? "Close type and vendor manager" : "Manage types and vendors"}
                </button>
                {manageExpenseLists && (
                  <div className="expense-lookup-manager">
                    <section>
                      <div className="charge-heading">
                        <strong>Types</strong>
                        <button
                          className="secondary-action small"
                          type="button"
                          onClick={() => {
                            setExpenseTypeEditingId("");
                            setExpenseTypeForm(emptyExpenseTypeForm);
                          }}
                        >
                          <Plus size={16} />
                          Add new
                        </button>
                      </div>
                      <div className="lookup-editor-row">
                        <input
                          value={expenseTypeForm.name}
                          onChange={(event) => setExpenseTypeForm({ name: event.target.value })}
                          placeholder="Type name"
                        />
                        <button className="secondary-action small" type="button" onClick={saveExpenseType} disabled={!expenseTypeForm.name.trim() || busy === "expense-type"}>
                          <Save size={16} />
                          {expenseTypeEditingId ? "Update" : "Add"}
                        </button>
                      </div>
                      <div className="lookup-list">
                        {expenseTypes.map((expenseType) => (
                          <div key={expenseType._id}>
                            <span>{expenseType.name}</span>
                            <div className="card-actions">
                              <button className="icon-button" type="button" onClick={() => editExpenseType(expenseType)} title="Edit type">
                                <Pencil size={16} />
                              </button>
                              <button className="icon-button danger" type="button" onClick={() => deleteExpenseType(expenseType._id)} title="Delete type">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section>
                      <div className="charge-heading">
                        <strong>Vendors</strong>
                        <button
                          className="secondary-action small"
                          type="button"
                          onClick={() => {
                            setVendorEditingId("");
                            setVendorForm(emptyVendorForm);
                          }}
                        >
                          <Plus size={16} />
                          Add new
                        </button>
                      </div>
                      <div className="lookup-editor-row">
                        <input
                          value={vendorForm.name}
                          onChange={(event) => setVendorForm({ ...vendorForm, name: event.target.value })}
                          placeholder="Vendor name"
                        />
                        <button className="secondary-action small" type="button" onClick={saveVendor} disabled={!vendorForm.name.trim() || busy === "vendor"}>
                          <Save size={16} />
                          {vendorEditingId ? "Update" : "Add"}
                        </button>
                      </div>
                      <div className="lookup-list">
                        {vendors.map((vendor) => (
                          <div key={vendor._id}>
                            <span>{vendor.name}</span>
                            <div className="card-actions">
                              <button className="icon-button" type="button" onClick={() => editVendor(vendor)} title="Edit vendor">
                                <Pencil size={16} />
                              </button>
                              <button className="icon-button danger" type="button" onClick={() => deleteVendor(vendor._id)} title="Delete vendor">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
                <label>
                  Notes
                  <textarea value={expenseForm.notes} onChange={(event) => setExpenseForm({ ...expenseForm, notes: event.target.value })} />
                </label>
                <label>
                  Invoice link
                  <input value={expenseForm.invoiceUrl} onChange={(event) => setExpenseForm({ ...expenseForm, invoiceUrl: event.target.value })} />
                </label>
                {expenseEditingId && expenseForm.invoiceUrl && (
                  <div className="inline-actions">
                    <button className="secondary-action small" type="button" onClick={() => openInvoice(expenseForm.invoiceUrl)}>
                      View current invoice
                    </button>
                    <button className="secondary-action small danger-text" type="button" onClick={() => setExpenseForm({ ...expenseForm, invoiceUrl: "" })}>
                      Remove invoice
                    </button>
                  </div>
                )}
                <label className="file-pick">
                  <Upload size={18} />
                  <span>{expenseFile ? expenseFile.name : expenseEditingId ? "Replace invoice PDF/JPG" : "Upload invoice PDF/JPG"}</span>
                  <input type="file" accept="image/*,application/pdf" onChange={(event) => setExpenseFile(event.target.files?.[0] || null)} />
                </label>
                <button className="primary-action" disabled={busy === "expense"}>
                  <Save size={18} />
                  {expenseEditingId ? "Update expense" : "Save expense"}
                </button>
                {expenseEditingId && (
                  <button className="secondary-action" type="button" onClick={() => { setExpenseEditingId(""); setExpenseForm(emptyExpenseForm); setExpenseFile(null); }}>
                    Clear
                  </button>
                )}
              </form>
            )}

            {!expenseEditingId && (
              <div className="list-panel wide">
                <div className="expense-period-heading">
                  <div>
                    <span>Showing</span>
                    <h2>
                      {expenseForm.property === "OWNER" ? "Owner-level" : expenseForm.property} · {months[Number(expenseForm.month) - 1]} {expenseForm.year}
                    </h2>
                  </div>
                  <strong>{ownerExpenses.length} expense{ownerExpenses.length === 1 ? "" : "s"}</strong>
                </div>
                {ownerExpenses.map((expense) => (
                  <article className="expense-row" key={expense._id}>
                    <div>
                      <span>{expense.property}</span>
                      <h3>{expense.type}</h3>
                      <p>
                        {expense.vendor || "No vendor"} · {expense.month}/{expense.year}
                      </p>
                    </div>
                    <strong>{money(expense.amount)}</strong>
                    <div className="card-actions">
                      {expense.invoiceUrl && (
                        <button className="secondary-action small" onClick={() => openInvoice(expense.invoiceUrl)}>
                          Invoice
                        </button>
                      )}
                      {isAdmin && (
                        <button className="icon-button" onClick={() => editExpense(expense)} title="Edit expense">
                          <Eye size={17} />
                        </button>
                      )}
                      {isAdmin && (
                        <button className="icon-button danger" onClick={() => deleteExpense(expense._id)} title="Delete expense">
                          <Trash2 size={17} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {ownerExpenses.length === 0 && (
                  <p className="empty-state">
                    No expenses for {months[Number(expenseForm.month) - 1]} {expenseForm.year}.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {tab === "saved" && (
          <section className="view-band">
            <div className="saved-grid">
              {ownerSavedReports.map((report) => (
                <article className="saved-card" key={report._id}>
                  <span>{report.periodLabel}</span>
                  <h3>{report.reportTitle}</h3>
                  <p>{new Date(report.createdAt).toLocaleString()}</p>
                  <div className="card-actions">
                    <a className="secondary-action" href={`/share/${report.shareId}`} target="_blank">
                      <Eye size={17} />
                      Open share link
                    </a>
                    <button
                      className="icon-button danger"
                      type="button"
                      onClick={() => deleteSavedReport(report.shareId)}
                      title="Delete saved report"
                      disabled={busy === "saved-delete"}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </article>
              ))}
              {ownerSavedReports.length === 0 && (
                <p className="empty-state">Saved reports for {selectedOwner?.name || "this owner"} will appear here.</p>
              )}
            </div>
          </section>
        )}

        {tab === "settings" && isAdmin && (
          <section className="split-view">
            <form className="editor-panel compact" onSubmit={saveSettings}>
              <div className="panel-heading">
                <Settings size={20} />
                <h2>App Settings</h2>
              </div>
              <label>
                Guesty cache TTL minutes
                <input
                  value={settingsForm.guestyCacheTtlMinutes}
                  onChange={(event) => setSettingsForm({ ...settingsForm, guestyCacheTtlMinutes: event.target.value })}
                  inputMode="numeric"
                />
              </label>
              <label>
                Default cleaning caps
                <textarea value={settingsForm.defaultCleaningCaps} onChange={(event) => setSettingsForm({ ...settingsForm, defaultCleaningCaps: event.target.value })} />
              </label>
              <button className="primary-action" disabled={busy === "settings"}>
                <Save size={18} />
                Save settings
              </button>
            </form>

            <div className="settings-stack">
              <form className="editor-panel compact" onSubmit={saveProperty} ref={propertySettingsRef}>
                <div className="panel-heading">
                  <Building2 size={20} />
                  <h2>{propertyEditingId ? "Edit Property" : "Properties"}</h2>
                </div>
                <label>
                  Select property
                  <select
                    value={propertyForm.name}
                    onChange={(event) => {
                      const propertyName = event.target.value;
                      if (!propertyName) {
                        setPropertyForm({ name: "", reportAddress: "", municipality: "", taxFlags: new Set() });
                        return;
                      }
                      loadPropertySettings(propertyName);
                    }}
                  >
                    <option value="">New property</option>
                    {properties.map((property) => (
                      <option key={property._id} value={property.name}>
                        {property.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Property name
                  <input value={propertyForm.name} onChange={(event) => setPropertyForm({ ...propertyForm, name: event.target.value })} required />
                </label>
                <label>
                  Report address
                  <input value={propertyForm.reportAddress} onChange={(event) => setPropertyForm({ ...propertyForm, reportAddress: event.target.value })} placeholder="1211 N Waccamaw Dr, Murrells Inlet, SC 29576" />
                </label>
                <label>
                  Municipality
                  <input
                    value={propertyForm.municipality}
                    onChange={(event) => setPropertyForm({ ...propertyForm, municipality: event.target.value })}
                    placeholder="Myrtle Beach, Horry County, North Myrtle Beach"
                  />
                </label>
                <div className="flag-row">
                  {["SC", "MB", "NMB", "SSB", "HC", "GTC"].map((flag) => (
                    <label key={flag}>
                      <input
                        type="checkbox"
                        checked={propertyForm.taxFlags.has(flag)}
                        onChange={(event) => {
                          const next = new Set(propertyForm.taxFlags);
                          if (event.target.checked) next.add(flag);
                          else next.delete(flag);
                          setPropertyForm({ ...propertyForm, taxFlags: next });
                        }}
                      />
                      {flag}
                    </label>
                  ))}
                </div>
                <button className="secondary-action">
                  <Save size={17} />
                  {propertyEditingId ? "Update tax settings" : "Save tax settings"}
                </button>
                {propertyEditingId && (
                  <div className="card-actions">
                    <button className="secondary-action" type="button" onClick={() => { setPropertyEditingId(""); setPropertyForm(emptyPropertyForm); }}>
                      Clear
                    </button>
                    <button className="icon-button danger" type="button" onClick={() => deleteProperty(propertyEditingId)} title="Delete property">
                      <Trash2 size={17} />
                    </button>
                  </div>
                )}
                <div className="chip-list">
                  {properties.map((property) => (
                    <button className="chip-button" type="button" key={property._id} onClick={() => loadPropertySettings(property.name)}>
                      {property.name}
                    </button>
                  ))}
                </div>
              </form>

              <form className="editor-panel compact" onSubmit={saveVendor}>
                <div className="panel-heading">
                  <CircleDollarSign size={20} />
                  <h2>{vendorEditingId ? "Edit Vendor" : "Vendors"}</h2>
                </div>
                <label>
                  Vendor name
                  <input value={vendorForm.name} onChange={(event) => setVendorForm({ ...vendorForm, name: event.target.value })} required />
                </label>
                <label>
                  Phone
                  <input value={vendorForm.phone} onChange={(event) => setVendorForm({ ...vendorForm, phone: event.target.value })} />
                </label>
                <button className="secondary-action">
                  <Save size={17} />
                  {vendorEditingId ? "Update vendor" : "Save vendor"}
                </button>
                {vendorEditingId && (
                  <div className="card-actions">
                    <button className="secondary-action" type="button" onClick={() => { setVendorEditingId(""); setVendorForm(emptyVendorForm); }}>
                      Clear
                    </button>
                    <button className="icon-button danger" type="button" onClick={() => deleteVendor(vendorEditingId)} title="Delete vendor">
                      <Trash2 size={17} />
                    </button>
                  </div>
                )}
                <div className="chip-list">
                  {vendors.map((vendor) => (
                    <button className="chip-button" type="button" key={vendor._id} onClick={() => editVendor(vendor)}>
                      {vendor.name}
                    </button>
                  ))}
                </div>
              </form>
            </div>
          </section>
        )}
      </section>

      {statementEdit && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form className="statement-edit-modal" onSubmit={saveStatementEdit}>
            <button className="modal-close" type="button" onClick={() => setStatementEdit(null)} aria-label="Close editor">
              <X size={22} />
            </button>
            <h2>{statementEdit.isNew ? "Add missing reservation" : "Edit statement row"}</h2>
            <div className="modal-field-grid">
              {statementEdit.fields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  {field.key === "property" && selectedOwner?.properties?.length ? (
                    <select
                      value={statementEdit.values[field.key] || ""}
                      required={Boolean(statementEdit.isNew)}
                      onChange={(event) => {
                        setStatementEdit({
                          ...statementEdit,
                          values: { ...statementEdit.values, [field.key]: event.target.value }
                        });
                      }}
                    >
                      {selectedOwner.properties.map((property) => (
                        <option key={property} value={property}>{property}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === "date" ? "date" : "text"}
                      value={statementEdit.values[field.key] || ""}
                      inputMode={field.type === "number" ? "decimal" : undefined}
                      required={Boolean(
                        statementEdit.isNew &&
                        ["property", "reservationCode", "guestName", "checkIn", "checkOut", "netAcc"].includes(field.key)
                      )}
                      onChange={(event) => {
                      const value = event.target.value;
                      const values = { ...statementEdit.values, [field.key]: value };
                      setStatementEdit({
                        ...statementEdit,
                        values: field.key === "netAcc" ? calculatedReservationValues(moneyToNumber(value), values) : values
                      });
                      }}
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="button-row">
              <button type="button" className="secondary-action" onClick={() => setStatementEdit(null)}>
                Cancel
              </button>
              <button className="primary-action">{statementEdit.isNew ? "Add reservation" : "Save"}</button>
            </div>
          </form>
        </div>
      )}

      {emailDraft && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <form className="email-modal" onSubmit={(event) => { event.preventDefault(); sendEmailDraft(); }}>
            <button className="modal-close" type="button" onClick={() => setEmailDraft(null)} aria-label="Close email client">
              <X size={22} />
            </button>
            <div>
              <span>Email client</span>
              <h2>Send statement</h2>
            </div>
            <label>
              Email to
              <input value={emailDraft.to} onChange={(event) => setEmailDraft({ ...emailDraft, to: event.target.value })} type="email" />
            </label>
            <label>
              Subject
              <input value={emailDraft.subject} onChange={(event) => setEmailDraft({ ...emailDraft, subject: event.target.value })} />
            </label>
            <label>
              Message
              <textarea value={emailDraft.message} onChange={(event) => setEmailDraft({ ...emailDraft, message: event.target.value })} />
            </label>
            <label>
              Report link
              <input value={emailDraft.reportLink} onChange={(event) => setEmailDraft({ ...emailDraft, reportLink: event.target.value })} />
            </label>
            <div className="button-row">
              <button type="button" className="secondary-action" onClick={() => setEmailDraft(null)}>
                Close
              </button>
              <button className="primary-action">
                <Send size={18} />
                Open Gmail
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
