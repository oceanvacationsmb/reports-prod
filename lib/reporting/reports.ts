import crypto from "crypto";
import type { AppSettings, CalculatedReservation, ExpenseLike, NormalizedReservation, OwnerLike, PropertyLike, ReportKey } from "@/lib/types";
import { calculateReservation, pmcPercent } from "@/lib/reporting/formulas";

export type ReportRequest = {
  reportKey: ReportKey;
  ownerId?: string | null;
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
  property?: string;
  calculationSource?: "reports" | "portal";
  readOnly?: boolean;
  hideZeroReservations?: boolean;
};

type ReportResult = {
  title: string;
  periodLabel: string;
  html: string;
  summary: Record<string, number | string>;
};

export type AdminIncomeTotals = {
  companyIncome: number;
  grossPayout: number;
  cleaning: number;
  netAccommodation: number;
  pmc: number;
  websiteVrboFee: number;
  expenses: number;
  recurringCharges: number;
  ownerPayout: number;
  bookedNights: number;
  stays: number;
};

export type AdminIncomeOwnerRow = AdminIncomeTotals & {
  ownerId: string;
  owner: string;
  ownerType: OwnerLike["type"];
  properties: number;
};

export type AdminIncomePropertyRow = AdminIncomeTotals & {
  ownerId: string;
  owner: string;
  property: string;
  address: string;
  area: string;
};

export type AdminIncomeMonthRow = AdminIncomeTotals & {
  month: number;
  label: string;
};

export type AdminIncomeData = {
  periodLabel: string;
  summary: AdminIncomeTotals;
  monthly: AdminIncomeMonthRow[];
  owners: AdminIncomeOwnerRow[];
  properties: AdminIncomePropertyRow[];
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
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

export function formatMoney(value: number) {
  return money.format(value || 0);
}

function formatShortDate(value?: string) {
  const date = parseDate(value);
  if (!date) return value || "";
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${month}-${day}-${year}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeHttpUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\/api\/invoices\/[a-f0-9]{24}$/i.test(text)) return text;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function parseDate(value?: string) {
  if (!value) return null;
  const text = value.trim();
  const usDate = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  const normalized = usDate
    ? `${usDate[3]}-${usDate[1].padStart(2, "0")}-${usDate[2].padStart(2, "0")}`
    : text;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function periodFromRequest(request: ReportRequest) {
  if (request.startDate && request.endDate) {
    return { startDate: request.startDate, endDate: request.endDate, label: `${request.startDate} to ${request.endDate}` };
  }

  const year = request.year || new Date().getUTCFullYear();
  if (request.reportKey === "1099") {
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31`, label: String(year) };
  }

  if (request.month) {
    const start = new Date(Date.UTC(year, request.month - 1, 1));
    const end = new Date(Date.UTC(year, request.month, 0));
    const startLabel = start.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
    const endLabel = end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      label: `${startLabel} - ${endLabel}`
    };
  }

  return { startDate: `${year}-01-01`, endDate: `${year}-12-31`, label: String(year) };
}

function inPeriod(row: NormalizedReservation, startDate: string, endDate: string) {
  const date = parseDate(row.checkIn);
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return true;
  if (!date) return false;
  return date >= start && date <= end;
}

function expenseInPeriod(expense: ExpenseLike, startDate: string, endDate: string) {
  const date = new Date(Date.UTC(expense.year, expense.month - 1, 1));
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return true;
  return date >= new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)) && date <= end;
}

function overlaps(startA: string, endA: string, startB: string, endB: string) {
  const a1 = parseDate(startA);
  const a2 = parseDate(endA);
  const b1 = parseDate(startB);
  const b2 = parseDate(endB);
  if (!a1 || !a2 || !b1 || !b2) return false;
  return a1 <= b2 && b1 <= a2;
}

export function recurringExpenses(owner: OwnerLike, startDate: string, endDate: string) {
  const charges: ExpenseLike[] = [];
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const year = start?.getUTCFullYear() || new Date().getUTCFullYear();
  const month = start ? start.getUTCMonth() + 1 : 1;
  const recurringMonths: Array<{ month: number; year: number }> = [];

  if (start && end) {
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    while (cursor <= last) {
      recurringMonths.push({ month: cursor.getUTCMonth() + 1, year: cursor.getUTCFullYear() });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  } else {
    recurringMonths.push({ month, year });
  }

  for (const [index, charge] of (owner.recurringCharges || []).entries()) {
    for (const periodMonth of recurringMonths) {
      charges.push({
        _id: `recurringCharges:${index}:${periodMonth.year}-${periodMonth.month}`,
        ownerId: String(owner._id || owner.id || ""),
        property: "Recurring",
        type: charge.label,
        amount: charge.amount,
        month: periodMonth.month,
        year: periodMonth.year,
        vendor: "Recurring",
        notes: "Base recurring charge"
      });
    }
  }

  for (const [index, charge] of (owner.monthlyRecurringCharges || []).entries()) {
    for (const periodMonth of recurringMonths) {
      charges.push({
        _id: `monthlyRecurringCharges:${index}:${periodMonth.year}-${periodMonth.month}`,
        ownerId: String(owner._id || owner.id || ""),
        property: "Recurring",
        type: charge.label,
        amount: charge.amount,
        month: periodMonth.month,
        year: periodMonth.year,
        vendor: "Recurring",
        notes: "Monthly recurring charge"
      });
    }
  }

  for (const [index, charge] of (owner.specificDateRecurringCharges || []).entries()) {
    const chargeDate = new Date(Date.UTC(year, charge.month - 1, charge.day));
    if (start && end && (chargeDate < start || chargeDate > end)) continue;
    charges.push({
      _id: `specificDateRecurringCharges:${index}`,
      ownerId: String(owner._id || owner.id || ""),
      property: "Recurring",
      type: charge.label,
      amount: charge.amount,
      month: charge.month,
      year,
      vendor: "Recurring",
      notes: `Recurring on ${charge.month}/${charge.day}`
    });
  }

  for (const [index, charge] of (owner.dateRangeRecurringCharges || []).entries()) {
    if (!overlaps(charge.startDate, charge.endDate, startDate, endDate)) continue;
    charges.push({
      _id: `dateRangeRecurringCharges:${index}`,
      ownerId: String(owner._id || owner.id || ""),
      property: "Recurring",
      type: charge.label,
      amount: charge.amount,
      month,
      year,
      vendor: "Recurring",
      notes: `${charge.startDate} to ${charge.endDate}`
    });
  }

  return charges;
}

function filterRows(rows: NormalizedReservation[], request: ReportRequest, startDate: string, endDate: string) {
  return rows
    .filter((row) => {
      const propertyOk = !request.property || row.property === request.property;
      return propertyOk && inPeriod(row, startDate, endDate);
    })
    .sort((a, b) => {
      const aTime = parseDate(a.checkIn)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bTime = parseDate(b.checkIn)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime || a.checkOut.localeCompare(b.checkOut) || a.id.localeCompare(b.id);
    });
}

function filterExpenses(expenses: ExpenseLike[], request: ReportRequest, startDate: string, endDate: string) {
  return expenses.filter((expense) => {
    const propertyOk = !request.property || expense.property === request.property || expense.property === "Recurring";
    return propertyOk && expenseInPeriod(expense, startDate, endDate);
  });
}

function editActions(
  kind: "reservation" | "expense" | "recurring",
  id?: string,
  options: { allowDelete?: boolean; readOnly?: boolean } = {}
) {
  if (!id || options.readOnly) return "";
  return `
    <td class="row-actions">
      <button type="button" data-report-action="edit" data-report-kind="${kind}" data-report-id="${escapeHtml(id)}">Edit</button>
      ${options.allowDelete === false ? "" : `<button type="button" data-report-action="delete" data-report-kind="${kind}" data-report-id="${escapeHtml(id)}">Delete</button>`}
    </td>
  `;
}

function totals(rows: CalculatedReservation[], expenses: ExpenseLike[], recurring: ExpenseLike[] = []) {
  const expenseTotal = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const recurringTotal = recurring.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const chargeTotal = expenseTotal + recurringTotal;
  return {
    reservations: rows.length,
    bookedNights: rows.reduce((sum, row) => sum + row.nights, 0),
    grossPayout: rows.reduce((sum, row) => sum + row.grossPayout, 0),
    netAccommodation: rows.reduce((sum, row) => sum + row.netAccommodation, 0),
    cleaning: rows.reduce((sum, row) => sum + row.cleaning, 0),
    taxes: rows.reduce((sum, row) => sum + row.taxes, 0),
    websiteVrboFee: rows.reduce((sum, row) => sum + row.websiteVrboFee, 0),
    pmc: rows.reduce((sum, row) => sum + row.pmc, 0),
    ownerPayout: rows.reduce((sum, row) => sum + row.ownerPayoutBeforeExpenses, 0) - chargeTotal,
    expenses: expenseTotal,
    recurringCharges: recurringTotal,
    draftDue: rows.reduce((sum, row) => sum + row.pmc + row.cleaning + row.websiteVrboFee, 0) + chargeTotal
  };
}

function lower(value: string | undefined) {
  return (value || "").toLowerCase();
}

function isTaxReportableReservation(row: CalculatedReservation) {
  const source = lower(row.source).replace(/[\s-]+/g, "_");
  const platform = lower(row.platform);
  return (
    platform.includes("homeaway") ||
    platform.includes("vrbo") ||
    source.includes("vrbo") ||
    source.includes("direct") ||
    source.includes("website")
  );
}

function taxReportingTotal(owner: OwnerLike, rows: CalculatedReservation[]) {
  if (owner.type !== "payout") return 0;
  return rows.reduce((sum, row) => (isTaxReportableReservation(row) ? sum + row.taxes : sum), 0);
}

function amountToReportTotal(owner: OwnerLike, rows: CalculatedReservation[]) {
  if (owner.type !== "payout") return 0;
  return rows.reduce((sum, row) => (isTaxReportableReservation(row) ? sum + row.netAccommodation : sum), 0);
}

function taxFlagLabel(flag: string) {
  const labels: Record<string, string> = {
    SC: "SC",
    MB: "Myrtle Beach",
    NMB: "North Myrtle Beach",
    SSB: "Surfside Beach",
    HC: "Horry County",
    GTC: "GTC"
  };
  return labels[flag] || flag;
}

function taxDestination(propertyName: string, properties: PropertyLike[], owner: OwnerLike) {
  const property = properties.find((item) => item.name.trim().toLowerCase() === propertyName.trim().toLowerCase());
  if (property?.municipality?.trim()) return property.municipality.trim();
  const propertyFlags = property?.taxFlags || {};
  const hasPropertyFlags = Object.values(propertyFlags).some(Boolean);
  const flagsSource = hasPropertyFlags ? propertyFlags : owner.type === "payout" ? owner.taxFlags || {} : {};
  const flags = Object.entries(flagsSource)
    .filter(([, enabled]) => enabled)
    .map(([flag]) => taxFlagLabel(flag));
  return flags.length ? flags.join(", ") : "Set in property settings";
}

function propertyReportAddress(propertyName: string, properties: PropertyLike[]) {
  const property = properties.find((item) => item.name.trim().toLowerCase() === propertyName.trim().toLowerCase());
  return property?.reportAddress?.trim() || propertyName;
}

function propertyOfficialAddress(propertyName: string, properties: PropertyLike[]) {
  const property = properties.find((item) => item.name.trim().toLowerCase() === propertyName.trim().toLowerCase());
  return property?.reportAddress?.trim() || "";
}

function reportTaxRows(owner: OwnerLike, rows: CalculatedReservation[], properties: PropertyLike[]) {
  if (owner.type !== "payout") return [];
  const grouped = new Map<string, { property: string; amountToReport: number; totalTax: number }>();

  for (const row of rows) {
    if (!isTaxReportableReservation(row) || row.taxes <= 0) continue;
    const property = row.property || "Unassigned";
    const current = grouped.get(property) || { property, amountToReport: 0, totalTax: 0 };
    current.amountToReport += row.netAccommodation;
    current.totalTax += row.taxes;
    grouped.set(property, current);
  }

  return Array.from(grouped.values())
    .sort((a, b) => a.property.localeCompare(b.property))
    .map((row) => ({ ...row, destination: taxDestination(row.property, properties, owner) }));
}

function line(label: string, value: number, options: { strong?: boolean; negative?: boolean } = {}) {
  const amount = options.negative ? -Math.abs(value) : value;
  return `
    <div class="statement-summary-line${options.strong ? " strong" : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${formatMoney(amount)}</strong>
    </div>
  `;
}

function statementSummarySections(
  owner: OwnerLike,
  total: ReturnType<typeof totals>,
  rows: CalculatedReservation[],
  properties: PropertyLike[],
  options: { includePmcTransferSection?: boolean } = {}
) {
  const taxReporting = taxReportingTotal(owner, rows);
  const salesFeePercent = Number(owner.salesFeePercent || 0);
  const pmcRate = pmcPercent(owner) * 100;
  const commissionDue = total.pmc * (salesFeePercent / 100);
  const transferExpenses = total.expenses + total.recurringCharges;
  const transferTotal = total.cleaning + transferExpenses + taxReporting;
  const taxRows = reportTaxRows(owner, rows, properties);
  const taxBody = taxRows.length
    ? taxRows
        .map(
          (row) => `
          <tr>
            <td>${escapeHtml(row.property)}</td>
            <td>${escapeHtml(row.destination)}</td>
            <td>${formatMoney(row.amountToReport)}</td>
            <td>${formatMoney(row.totalTax)}</td>
          </tr>`
        )
        .join("")
    : '<tr><td colspan="4" class="empty-tax-row">No taxes collected for this period</td></tr>';

  return `
    <section class="statement-summary-stack">
      <div class="statement-summary-card">
        <div class="statement-summary-lines">
          ${line("Total net accommodation", total.netAccommodation)}
          ${line("Minus PMC", total.pmc, { negative: true })}
          ${line("Minus expenses", total.expenses, { negative: true })}
          ${line("Minus recurring charges", total.recurringCharges, { negative: true })}
          ${line("Total taxes collected", taxReporting)}
          ${line(owner.type === "draft" ? "Draft due" : "Owner payout", owner.type === "draft" ? total.draftDue : total.ownerPayout, { strong: true })}
        </div>
      </div>

      <div class="statement-summary-card">
        <h2>Sales Commission</h2>
        <div class="statement-summary-lines">
          ${line("Net accommodation", total.netAccommodation)}
          ${line("PMC collected", total.pmc)}
          ${line(`Commission fee (${salesFeePercent.toFixed(2).replace(/\.00$/, "")}%)`, commissionDue)}
          ${line("Commission due", commissionDue, { strong: true })}
        </div>
      </div>

      ${options.includePmcTransferSection
        ? `
      <div class="statement-summary-card">
        <h2>Transfer PMC From Trust To PMC Account</h2>
        <div class="statement-summary-lines">
          ${line("Total net accommodation", total.netAccommodation)}
          ${line(`PMC (${pmcRate.toFixed(2)}%)`, total.pmc, { strong: true })}
        </div>
      </div>`
        : ""}

      <div class="statement-summary-card">
        <h2>Report Taxes</h2>
        <div class="table-wrap compact-table">
          <table>
            <thead><tr><th>Property Name</th><th>Report Tax To</th><th>Amount To Report</th><th>Total Tax</th></tr></thead>
            <tbody>${taxBody}</tbody>
          </table>
        </div>
      </div>

      <div class="statement-summary-card">
        <h2>Transfer Expenses From Trust To Operation Account</h2>
        <div class="statement-summary-lines">
          ${line("Total cleaning", total.cleaning)}
          ${line("Total expenses", transferExpenses)}
          ${line("Taxes collected", taxReporting)}
          ${line("Total transfer", transferTotal, { strong: true })}
        </div>
      </div>
    </section>
  `;
}

function reportShell(title: string, period: string, body: string, summary: Record<string, number | string>) {
  const countKeys = new Set(["reservations", "bookedNights", "owners"]);
  const summaryRows = Object.entries(summary)
    .map(([key, value]) => {
      const displayValue = typeof value === "number" && !countKeys.has(key) ? formatMoney(value) : value;
      return `<div class="metric"><span>${escapeHtml(key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase()))}</span><strong>${escapeHtml(displayValue)}</strong></div>`;
    })
    .join("");

  return `
    <article class="report-document">
      <header class="report-hero">
        <p>Ocean Vacations</p>
        <h1>${escapeHtml(title)}</h1>
        <span>${escapeHtml(period)}</span>
      </header>
      ${summaryRows ? `<section class="metric-grid">${summaryRows}</section>` : ""}
      ${body}
    </article>
  `;
}

function statementReservationTable(rows: CalculatedReservation[], owner: OwnerLike, readOnly = false) {
  const isDraft = owner.type === "draft";
  const body = rows
    .map(
      (row) => isDraft
        ? `
        <tr${row.isNew ? ' class="new-reservation-row"' : ""}>
          <td>${escapeHtml(row.confirmationCode || row.id)}${row.isNew ? '<span class="new-reservation-badge">New</span>' : ""}</td>
          <td>${escapeHtml(formatShortDate(row.checkIn))}</td>
          <td>${escapeHtml(formatShortDate(row.checkOut))}</td>
          <td>${row.nights}</td>
          <td>${formatMoney(row.grossPayout)}</td>
          <td>${formatMoney(row.cleaning)}</td>
          <td>${formatMoney(row.netAccommodation)}</td>
          <td>${formatMoney(row.websiteVrboFee)}</td>
          <td>${formatMoney(row.pmc)}</td>
          <td>${formatMoney(row.manualAmountDue != null ? row.manualAmountDue : row.pmc + row.cleaning + row.websiteVrboFee)}</td>
          ${editActions("reservation", row.id, { allowDelete: false, readOnly })}
        </tr>`
        : `
        <tr${row.isNew ? ' class="new-reservation-row"' : ""}>
          <td>${escapeHtml(row.guestName)}${row.isNew ? '<span class="new-reservation-badge">New</span>' : ""}</td>
          <td>${escapeHtml(formatShortDate(row.checkIn))}</td>
          <td>${escapeHtml(formatShortDate(row.checkOut))}</td>
          <td>${row.nights}</td>
          <td>${formatMoney(row.netAccommodation)}</td>
          <td>${formatMoney(row.pmc)}</td>
          <td>${formatMoney(row.ownerPayoutBeforeExpenses)}</td>
          <td>${escapeHtml(row.isOwnerStay ? "" : formatShortDate(row.expectedPayoutDate))}</td>
          ${editActions("reservation", row.id, { allowDelete: false, readOnly })}
        </tr>`
    )
    .join("");

  const header = isDraft
    ? `<th>Reservation Code</th><th>Check In</th><th>Check Out</th><th>Nights</th><th>Gross Payout</th><th>Cleaning Fee</th><th>Net Acc.</th><th>VRBO/Website Fee</th><th>PMC</th><th>Amount Due</th>${readOnly ? "" : "<th>Actions</th>"}`
    : `<th>Guest Name</th><th>Check In</th><th>Check Out</th><th>Nights</th><th>Net Acc.</th><th>PMC</th><th>Owner Payout</th><th>Expected Payout</th>${readOnly ? "" : "<th>Actions</th>"}`;
  const colspan = isDraft ? (readOnly ? 10 : 11) : (readOnly ? 8 : 9);

  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${header}</tr></thead>
        <tbody>${body || `<tr><td colspan="${colspan}">No reservations found.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function ownerStayCharge(row: CalculatedReservation) {
  return row.manualAmountDue != null ? row.manualAmountDue : Math.abs(row.ownerPayoutBeforeExpenses || row.cleaning);
}

function ownerStayTable(rows: CalculatedReservation[], readOnly = false) {
  const body = rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.guestName)}</td>
        <td>${escapeHtml(formatShortDate(row.checkIn))}</td>
        <td>${escapeHtml(formatShortDate(row.checkOut))}</td>
        <td>${formatMoney(ownerStayCharge(row))}</td>
        ${editActions("reservation", row.id, { allowDelete: false, readOnly })}
      </tr>`
    )
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Guest Name</th><th>Check In</th><th>Check Out</th><th>Owner Stay</th>${readOnly ? "" : "<th>Actions</th>"}</tr></thead>
        <tbody>${body || `<tr><td colspan="${readOnly ? 4 : 5}">No owner stays found.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}


function reservationTable(rows: CalculatedReservation[], includeOwnerPayout = true) {
  const ownerColumn = includeOwnerPayout ? "<th>Owner Payout</th>" : "";
  const body = rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.property)}</td>
        <td>${escapeHtml(row.guestName)}</td>
        <td>${escapeHtml(formatShortDate(row.checkIn))}</td>
        <td>${escapeHtml(formatShortDate(row.checkOut))}</td>
        <td>${row.nights}</td>
        <td>${escapeHtml(row.source || row.platform)}</td>
        <td>${formatMoney(row.grossPayout)}</td>
        <td>${formatMoney(row.netAccommodation)}</td>
        <td>${formatMoney(row.cleaning)}</td>
        <td>${formatMoney(row.pmc)}</td>
        ${includeOwnerPayout ? `<td>${formatMoney(row.ownerPayoutBeforeExpenses)}</td>` : ""}
      </tr>`
    )
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Property</th><th>Guest</th><th>Check In</th><th>Check Out</th><th>Nights</th>
            <th>Source</th><th>Gross</th><th>Net Acc.</th><th>Cleaning</th><th>PMC</th>${ownerColumn}
          </tr>
        </thead>
        <tbody>${body || `<tr><td colspan="${includeOwnerPayout ? 11 : 10}">No reservations found.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function griReservationTable(rows: CalculatedReservation[]) {
  const body = rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.confirmationCode || row.id)}</td>
        <td>${escapeHtml(`${formatShortDate(row.checkIn)} - ${formatShortDate(row.checkOut)}`)}</td>
        <td>${formatMoney(row.grossPayout)}</td>
      </tr>`
    )
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Reservation Code</th><th>Check-In/Out</th><th>Gross Payout</th></tr></thead>
        <tbody>${body || '<tr><td colspan="3">No reservations found.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function griReportDocument(property: string, propertyAddress: string, rows: CalculatedReservation[], year: number, periodLabel: string) {
  const grossPayout = rows.reduce((sum, row) => sum + row.grossPayout, 0);
  const reportDate = new Date().toLocaleDateString("en-US");
  const hasOfficialAddress = Boolean(propertyAddress.trim());
  const displayAddress = hasOfficialAddress ? propertyAddress : "Property address needed";

  return `
    <article class="report-document gri-document">
      <header class="report-hero">
        <p>Ocean Vacations</p>
        <h1>Gross Rental Income Report</h1>
        <span>${escapeHtml(periodLabel)}</span>
        <div class="report-hero-details">
          <span>oceanvacationsmb@gmail.com</span>
          <span>843-222-6516</span>
        </div>
      </header>
      <section class="gri-property-card${hasOfficialAddress ? "" : " missing-address"}">
        <span>Property Address</span>
        <strong>${escapeHtml(displayAddress)}</strong>
        ${hasOfficialAddress ? "" : `<small>Add the official report address for ${escapeHtml(property)} in Settings > Properties before sending this report.</small>`}
      </section>
      <section class="metric-grid">
        <div class="metric"><span>Report Date</span><strong>${escapeHtml(reportDate)}</strong></div>
        <div class="metric"><span>Gross Payout</span><strong>${formatMoney(grossPayout)}</strong></div>
      </section>
      <section class="property-section">
        ${griReservationTable(rows)}
      </section>
    </article>
  `;
}

function propertyReservationSummary(rows: CalculatedReservation[], includeOwnerPayout = true) {
  const total = {
    grossPayout: rows.reduce((sum, row) => sum + row.grossPayout, 0),
    netAccommodation: rows.reduce((sum, row) => sum + row.netAccommodation, 0),
    cleaning: rows.reduce((sum, row) => sum + row.cleaning, 0),
    pmc: rows.reduce((sum, row) => sum + row.pmc, 0),
    ownerPayout: rows.reduce((sum, row) => sum + row.ownerPayoutBeforeExpenses, 0),
    reservations: rows.length
  };
  const summary = includeOwnerPayout
    ? {
        totalPayout: total.grossPayout,
        netAccommodation: total.netAccommodation,
        cleaning: total.cleaning,
        pmc: total.pmc,
        ownerPayout: total.ownerPayout
      }
    : {
        grossPayout: total.grossPayout,
        reservations: total.reservations,
        netAccommodation: total.netAccommodation,
        cleaning: total.cleaning,
        pmc: total.pmc
      };

  return `
    <div class="property-metric-grid">
      ${Object.entries(summary)
        .map(([key, value]) => {
          const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
          const displayValue = key === "reservations" ? value : formatMoney(value);
          return `<div class="property-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(displayValue)}</strong></div>`;
        })
        .join("")}
    </div>
    ${reservationTable(rows, includeOwnerPayout)}
  `;
}

function propertySections(rows: CalculatedReservation[], includeOwnerPayout = true) {
  const keys = [...new Set(rows.map((row) => row.property || "Unassigned"))].sort((a, b) => a.localeCompare(b));
  return keys
    .map((property) => {
      const propertyRows = rows.filter((row) => (row.property || "Unassigned") === property);
      return `
        <section class="property-section">
          <header class="property-header">
            <div>
              <span>Property</span>
              <h2>${escapeHtml(property)}</h2>
            </div>
          </header>
          ${propertyReservationSummary(propertyRows, includeOwnerPayout)}
        </section>
      `;
    })
    .join("");
}

function monthly1099Table(rows: CalculatedReservation[], expenses: ExpenseLike[], year: number) {
  const body = monthLabels
    .map((label, index) => {
      const month = index + 1;
      const monthRows = rows.filter((row) => {
        const checkIn = parseDate(row.checkIn);
        return checkIn && checkIn.getUTCFullYear() === year && checkIn.getUTCMonth() + 1 === month;
      });
      const monthExpenses = expenses.filter((expense) => expense.year === year && expense.month === month);
      const netAccommodation = monthRows.reduce((sum, row) => sum + row.netAccommodation, 0);
      const pmc = monthRows.reduce((sum, row) => sum + row.pmc, 0);
      const expenseTotal = monthExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
      const netToOwner = netAccommodation - pmc - expenseTotal;
      return `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td>${formatMoney(netAccommodation)}</td>
        <td>${formatMoney(pmc)}</td>
        <td>${formatMoney(expenseTotal)}</td>
        <td>${formatMoney(netToOwner)}</td>
      </tr>`;
    })
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Month</th><th>Net Accommodation</th><th>PMC</th><th>Expenses</th><th>Net To Owner</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function expensesTable(
  expenses: ExpenseLike[],
  title = "Expenses",
  options: { includeProperty?: boolean; readOnly?: boolean } = {}
) {
  const includeProperty = options.includeProperty !== false;
  const columnCount = (includeProperty ? 6 : 5) + (options.readOnly ? 0 : 1);
  const body = expenses
    .map((expense) => {
      const kind = String(expense._id || "").includes(":") ? "recurring" : "expense";
      const invoiceUrl = safeHttpUrl(expense.invoiceUrl);
      return `
      <tr>
        ${includeProperty ? `<td>${escapeHtml(expense.property)}</td>` : ""}
        <td>${escapeHtml(expense.type)}</td>
        <td>${escapeHtml(expense.notes || "")}</td>
        <td>${escapeHtml(expense.vendor || "")}</td>
        <td>${formatMoney(Number(expense.amount || 0))}</td>
        <td>${invoiceUrl ? `<a href="${escapeHtml(invoiceUrl)}" target="_blank" rel="noreferrer">Invoice</a>` : ""}</td>
        ${editActions(kind, expense._id, { readOnly: options.readOnly })}
      </tr>`
    })
    .join("");

  return `
    <h2>${escapeHtml(title)}</h2>
    <div class="table-wrap">
      <table>
        <thead><tr>${includeProperty ? "<th>Property</th>" : ""}<th>Type</th><th>Note</th><th>Vendor</th><th>Amount</th><th>Invoice</th>${options.readOnly ? "" : "<th>Actions</th>"}</tr></thead>
        <tbody>${body || `<tr><td colspan="${columnCount}">No ${escapeHtml(title.toLowerCase())} found.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function propertyStatementSummary(owner: OwnerLike, rows: CalculatedReservation[], expenses: ExpenseLike[]) {
  const total = totals(rows, expenses);
  const summary = owner.type === "draft"
    ? {
        grossPayout: total.grossPayout,
        netAccommodation: total.netAccommodation,
        cleaning: total.cleaning,
        pmc: total.pmc,
        websiteVrboFee: total.websiteVrboFee,
        expenses: total.expenses,
        draftDue: total.draftDue
      }
    : {
        netAccommodation: total.netAccommodation,
        pmc: total.pmc,
        expenses: total.expenses,
        ownerPayout: total.ownerPayout,
        bookedNights: total.bookedNights
      };

  return `
    <div class="property-metric-grid">
      ${Object.entries(summary)
        .map(([key, value]) => {
          const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
          const displayValue = key === "bookedNights" ? value : formatMoney(value);
          return `<div class="property-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(displayValue)}</strong></div>`;
        })
        .join("")}
    </div>
  `;
}

function byProperty(
  rows: CalculatedReservation[],
  owner: OwnerLike,
  expenses: ExpenseLike[] = [],
  properties: PropertyLike[] = [],
  readOnly = false
) {
  const isOwnerLevel = (expense: ExpenseLike) => ["", "owner", "recurring"].includes(lower(expense.property).trim());
  const keys = [
    ...new Set([
      ...(owner.properties || []).filter(Boolean),
      ...rows.map((row) => row.property || "Unassigned"),
      ...expenses.filter((expense) => !isOwnerLevel(expense)).map((expense) => expense.property)
    ])
  ].sort((a, b) => a.localeCompare(b));

  return keys
    .map((property) => {
      const propertyRows = rows.filter((row) => (row.property || "Unassigned") === property);
      const guestRows = propertyRows.filter((row) => !row.isOwnerStay);
      const ownerStayRows = propertyRows.filter((row) => row.isOwnerStay);
      const propertyExpenses = expenses.filter((expense) => expense.property === property);
      const address = propertyOfficialAddress(property, properties);
      return `
        <section class="property-section">
          <header class="property-header">
            <div>
              <span>Property</span>
              <h2>${escapeHtml(property)}</h2>
              ${address && address !== property ? `<p class="property-address">${escapeHtml(address)}</p>` : ""}
            </div>
          </header>
          ${propertyStatementSummary(owner, propertyRows, propertyExpenses)}
          <h3 class="statement-subhead">Reservations</h3>
          ${statementReservationTable(guestRows, owner, readOnly)}
          ${ownerStayRows.length ? `<h3 class="statement-subhead">Owner Stays</h3>${ownerStayTable(ownerStayRows, readOnly)}` : ""}
          ${expensesTable(propertyExpenses, "Property Expenses", { includeProperty: false, readOnly })}
        </section>
      `;
    })
    .join("");
}

function calculateRows(rows: NormalizedReservation[], owner: OwnerLike, settings: AppSettings, request: ReportRequest) {
  return rows.map((row) =>
    calculateReservation(row, owner, settings, {
      calculationSource: request.calculationSource || "reports"
    })
  );
}

function cleanCanceledRows(rows: CalculatedReservation[]) {
  return rows
    .filter((row) => {
      const isCanceled = row.status.toLowerCase().includes("cancel");
      if (!isCanceled) return true;
      return row.netAccommodation > 0 || row.grossPayout > 0 || row.ownerPayoutBeforeExpenses > 0;
    })
    .map((row) => {
      const isCanceled = row.status.toLowerCase().includes("cancel");
      if (!isCanceled) return row;
      return { ...row, guestName: `${row.guestName || row.confirmationCode || "Reservation"} (canceled with payout)` };
    });
}

export function buildOwnerReport(
  owner: OwnerLike,
  rows: NormalizedReservation[],
  rawExpenses: ExpenseLike[],
  settings: AppSettings,
  request: ReportRequest,
  properties: PropertyLike[] = []
): ReportResult {
  const period = periodFromRequest(request);
  const calculatedRows = cleanCanceledRows(calculateRows(filterRows(rows, request, period.startDate, period.endDate), owner, settings, request));
  const reportRows = request.hideZeroReservations
    ? calculatedRows.filter((row) => row.isOwnerStay || [row.grossPayout, row.netAccommodation, row.ownerPayoutBeforeExpenses].some((value) => Math.abs(value) >= 0.005))
    : calculatedRows;
  const filteredExpenses = filterExpenses(rawExpenses, request, period.startDate, period.endDate);
  const recurring = recurringExpenses(owner, period.startDate, period.endDate);
  const total = totals(reportRows, filteredExpenses, recurring);
  const ownerStayRows = reportRows.filter((row) => row.isOwnerStay);
  const ownerStayTotal = ownerStayRows.reduce((sum, row) => sum + ownerStayCharge(row), 0);
  const name = owner.name || "Owner";

  if (request.reportKey === "income") {
    const body = request.property
      ? propertyReservationSummary(reportRows)
      : `
        <section class="property-section">
          <header class="property-header">
            <div>
              <span>Summary</span>
              <h2>All Properties Summary</h2>
            </div>
          </header>
          ${propertyReservationSummary(reportRows)}
        </section>
        ${propertySections(reportRows)}
      `;
    return {
      title: `${name} Income Report`,
      periodLabel: period.label,
      summary: {
        totalPayout: total.grossPayout,
        netAccommodation: total.netAccommodation,
        cleaning: total.cleaning,
        pmc: total.pmc,
        ownerPayout: total.ownerPayout
      },
      html: reportShell(`${name} Income Report`, period.label, body, {
        totalPayout: total.grossPayout,
        netAccommodation: total.netAccommodation,
        cleaning: total.cleaning,
        pmc: total.pmc,
        ownerPayout: total.ownerPayout
      })
    };
  }

  if (request.reportKey === "gri") {
    const property = request.property || rows[0]?.property || "Property";
    const officialAddress = propertyOfficialAddress(property, properties);
    const body = griReportDocument(property, officialAddress, reportRows, request.year || new Date().getUTCFullYear(), period.label);
    return {
      title: officialAddress ? `${officialAddress} GRI Report` : "Gross Rental Income Report",
      periodLabel: period.label,
      summary: { grossPayout: total.grossPayout, reservations: total.reservations },
      html: body
    };
  }

  if (request.reportKey === "1099") {
    const netToOwner = total.netAccommodation - total.pmc - total.expenses;
    return {
      title: `${name} 1099 Report`,
      periodLabel: period.label,
      summary: {
        netAccommodation: total.netAccommodation,
        pmc: total.pmc,
        expenses: total.expenses,
        netToOwner
      },
      html: reportShell(`${name} 1099 Report`, period.label, monthly1099Table(reportRows, filteredExpenses, request.year || new Date().getUTCFullYear()), {
        netAccommodation: total.netAccommodation,
        pmc: total.pmc,
        expenses: total.expenses,
        netToOwner
      })
    };
  }

  const ownerLevelExpenses = filteredExpenses.filter((expense) => ["", "owner", "recurring"].includes(lower(expense.property).trim()));
  const body = `${byProperty(reportRows, owner, filteredExpenses, properties, Boolean(request.readOnly))}${ownerLevelExpenses.length ? expensesTable(ownerLevelExpenses, "Owner Expenses", { readOnly: request.readOnly }) : ""}${recurring.length ? expensesTable(recurring, "Recurring Charges", { readOnly: request.readOnly }) : ""}`;
  const baseSummary: Record<string, string | number> = owner.type === "draft"
    ? {
        grossPayout: total.grossPayout,
        netAccommodation: total.netAccommodation,
        cleaning: total.cleaning,
        pmc: total.pmc,
        websiteVrboFee: total.websiteVrboFee,
        expenses: total.expenses,
        recurringCharges: total.recurringCharges,
        draftDue: total.draftDue
      }
    : {
        netAccommodation: total.netAccommodation,
        pmc: total.pmc,
        expenses: total.expenses,
        recurringCharges: total.recurringCharges,
        ownerPayout: total.ownerPayout,
        bookedNights: total.bookedNights
      };
  const summary = ownerStayRows.length ? { ...baseSummary, ownerStay: ownerStayTotal } : baseSummary;

  return {
    title: `${name} Statement`,
    periodLabel: period.label,
    summary,
    html: reportShell(`${name} Statement`, period.label, body, summary)
  };
}

function emptyAdminIncomeTotals(): AdminIncomeTotals {
  return {
    companyIncome: 0,
    grossPayout: 0,
    cleaning: 0,
    netAccommodation: 0,
    pmc: 0,
    websiteVrboFee: 0,
    expenses: 0,
    recurringCharges: 0,
    ownerPayout: 0,
    bookedNights: 0,
    stays: 0
  };
}

function adminIncomeTotals(rows: CalculatedReservation[], expenses: ExpenseLike[], recurring: ExpenseLike[] = []): AdminIncomeTotals {
  const total = totals(rows, expenses, recurring);
  const paidStays = rows.filter(
    (row) => !row.isOwnerStay && [row.grossPayout, row.netAccommodation, row.ownerPayoutBeforeExpenses].some((value) => Math.abs(value) >= 0.005)
  );
  return {
    companyIncome: total.pmc + total.cleaning + total.websiteVrboFee,
    grossPayout: total.grossPayout,
    cleaning: total.cleaning,
    netAccommodation: total.netAccommodation,
    pmc: total.pmc,
    websiteVrboFee: total.websiteVrboFee,
    expenses: total.expenses,
    recurringCharges: total.recurringCharges,
    ownerPayout: total.ownerPayout,
    bookedNights: paidStays.reduce((sum, row) => sum + row.nights, 0),
    stays: paidStays.length
  };
}

function addAdminIncomeTotals(target: AdminIncomeTotals, source: AdminIncomeTotals) {
  for (const key of Object.keys(target) as Array<keyof AdminIncomeTotals>) {
    target[key] += source[key];
  }
  return target;
}

function propertyArea(property: string) {
  const normalized = property.trim().toUpperCase();
  if (normalized.startsWith("NMB")) return "North Myrtle Beach";
  if (normalized.startsWith("MB")) return "Myrtle Beach";
  if (normalized.startsWith("GC") || normalized.startsWith("GCSSB")) return "South Strand";
  return "Other";
}

function adminRecurringForPeriod(owner: OwnerLike, request: Pick<ReportRequest, "month" | "year">) {
  if (request.month) {
    const period = periodFromRequest({ reportKey: "income", ...request });
    return recurringExpenses(owner, period.startDate, period.endDate);
  }

  return monthLabels.flatMap((_, index) => {
    const period = periodFromRequest({ reportKey: "income", month: index + 1, year: request.year });
    return recurringExpenses(owner, period.startDate, period.endDate);
  });
}

export function buildAdminIncomeData(
  owners: OwnerLike[],
  reservationsByOwner: Map<string, NormalizedReservation[]>,
  expensesByOwner: Map<string, ExpenseLike[]>,
  settings: AppSettings,
  request: Pick<ReportRequest, "month" | "year">,
  properties: PropertyLike[] = []
): AdminIncomeData {
  const reportRequest: ReportRequest = { reportKey: "income", month: request.month, year: request.year };
  const period = periodFromRequest(reportRequest);
  const ownerRows: AdminIncomeOwnerRow[] = [];
  const propertyRows: AdminIncomePropertyRow[] = [];

  for (const owner of owners) {
    const ownerId = String(owner._id || owner.id || "");
    const calculatedRows = cleanCanceledRows(
      calculateRows(
        filterRows(reservationsByOwner.get(ownerId) || [], reportRequest, period.startDate, period.endDate),
        owner,
        settings,
        reportRequest
      )
    );
    const ownerExpenses = filterExpenses(expensesByOwner.get(ownerId) || [], reportRequest, period.startDate, period.endDate);
    const recurring = adminRecurringForPeriod(owner, request);
    const ownerTotals = adminIncomeTotals(calculatedRows, ownerExpenses, recurring);
    const isOwnerLevel = (expense: ExpenseLike) => ["", "owner", "recurring"].includes(lower(expense.property).trim());
    const propertyNames = [
      ...new Set([
        ...(owner.properties || []).filter(Boolean),
        ...calculatedRows.map((row) => row.property).filter(Boolean),
        ...ownerExpenses.filter((expense) => !isOwnerLevel(expense)).map((expense) => expense.property)
      ])
    ].sort((a, b) => a.localeCompare(b));

    ownerRows.push({
      ownerId,
      owner: owner.name,
      ownerType: owner.type,
      properties: propertyNames.length,
      ...ownerTotals
    });

    for (const property of propertyNames) {
      const propertyCalculatedRows = calculatedRows.filter((row) => row.property === property);
      const propertyExpenses = ownerExpenses.filter((expense) => expense.property === property);
      propertyRows.push({
        ownerId,
        owner: owner.name,
        property,
        address: propertyOfficialAddress(property, properties),
        area: propertyArea(property),
        ...adminIncomeTotals(propertyCalculatedRows, propertyExpenses)
      });
    }
  }

  const summary = ownerRows.reduce((sum, row) => addAdminIncomeTotals(sum, row), emptyAdminIncomeTotals());
  const monthsToBuild = request.month ? [request.month] : monthLabels.map((_, index) => index + 1);
  const monthly = monthsToBuild.map((month) => {
    const monthRequest: ReportRequest = { reportKey: "income", month, year: request.year };
    const monthPeriod = periodFromRequest(monthRequest);
    const monthTotal = emptyAdminIncomeTotals();

    for (const owner of owners) {
      const ownerId = String(owner._id || owner.id || "");
      const monthRows = cleanCanceledRows(
        calculateRows(
          filterRows(reservationsByOwner.get(ownerId) || [], monthRequest, monthPeriod.startDate, monthPeriod.endDate),
          owner,
          settings,
          monthRequest
        )
      );
      const monthExpenses = filterExpenses(expensesByOwner.get(ownerId) || [], monthRequest, monthPeriod.startDate, monthPeriod.endDate);
      const monthRecurring = recurringExpenses(owner, monthPeriod.startDate, monthPeriod.endDate);
      addAdminIncomeTotals(monthTotal, adminIncomeTotals(monthRows, monthExpenses, monthRecurring));
    }

    return { month, label: monthLabels[month - 1], ...monthTotal };
  });

  return {
    periodLabel: period.label,
    summary,
    monthly,
    owners: ownerRows.sort((a, b) => a.owner.localeCompare(b.owner)),
    properties: propertyRows.sort((a, b) => a.area.localeCompare(b.area) || a.property.localeCompare(b.property))
  };
}

export function buildSummaryReport(
  owners: OwnerLike[],
  reservationsByOwner: Map<string, NormalizedReservation[]>,
  expensesByOwner: Map<string, ExpenseLike[]>,
  settings: AppSettings,
  request: ReportRequest,
  properties: PropertyLike[] = []
): ReportResult {
  const period = periodFromRequest(request);
  const rows = owners.map((owner) => {
    const ownerId = String(owner._id || owner.id || "");
    const reportRows = calculateRows(filterRows(reservationsByOwner.get(ownerId) || [], request, period.startDate, period.endDate), owner, settings, request);
    const expenses = filterExpenses(expensesByOwner.get(ownerId) || [], request, period.startDate, period.endDate);
    const recurring = recurringExpenses(owner, period.startDate, period.endDate);
    const total = totals(reportRows, expenses, recurring);
    const salesCommission = total.pmc * (Number(owner.salesFeePercent || 0) / 100);
    return {
      owner,
      reportRows,
      total,
      salesCommission,
      amountToReport: amountToReportTotal(owner, reportRows),
      taxCollected: taxReportingTotal(owner, reportRows)
    };
  });
  const summary = {
    totalNetAccommodation: rows.reduce((sum, row) => sum + row.total.netAccommodation, 0),
    payoutBreakdown: rows.reduce((sum, row) => sum + row.total.ownerPayout, 0),
    salesCommission: rows.reduce((sum, row) => sum + row.salesCommission, 0),
    amountToReport: rows.reduce((sum, row) => sum + row.amountToReport, 0),
    transferGuidance: rows.reduce((sum, row) => sum + Math.max(0, row.total.ownerPayout), 0)
  };
  const body = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Owner</th><th>Type</th><th>Payout</th><th>PMC</th><th>Sales Commission</th><th>Amount To Report</th><th>Transfer Guidance</th></tr></thead>
        <tbody>
          ${rows
            .map(
              ({ owner, total, salesCommission, amountToReport }) => `
              <tr>
                <td>${escapeHtml(owner.name)}</td>
                <td>${escapeHtml(owner.type)}</td>
                <td>${formatMoney(total.ownerPayout)}</td>
                <td>${formatMoney(total.pmc)}</td>
                <td>${formatMoney(salesCommission)}</td>
                <td>${formatMoney(amountToReport)}</td>
                <td>${formatMoney(Math.max(0, total.ownerPayout))}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
    <section class="owner-summary-detail-stack">
      ${rows
        .map(
          ({ owner, total, reportRows }) => `
          <section class="owner-summary-detail">
            <header class="property-header">
              <div>
                <span>Owner Summary</span>
                <h2>${escapeHtml(owner.name)}</h2>
              </div>
            </header>
            ${statementSummarySections(owner, total, reportRows, properties, { includePmcTransferSection: true })}
          </section>`
        )
        .join("")}
    </section>
  `;

  return {
    title: "Owner Summary Report",
    periodLabel: period.label,
    summary,
    html: reportShell("Owner Summary Report", period.label, body, summary)
  };
}

export function buildAllOwnersTaxReport(
  owners: OwnerLike[],
  reservationsByOwner: Map<string, NormalizedReservation[]>,
  expensesByOwner: Map<string, ExpenseLike[]>,
  settings: AppSettings,
  request: ReportRequest,
  properties: PropertyLike[] = []
): ReportResult {
  const period = periodFromRequest(request);
  const rows = owners.map((owner) => {
    const ownerId = String(owner._id || owner.id || "");
    const reportRows = calculateRows(filterRows(reservationsByOwner.get(ownerId) || [], request, period.startDate, period.endDate), owner, settings, request);
    const expenses = filterExpenses(expensesByOwner.get(ownerId) || [], request, period.startDate, period.endDate);
    const recurring = recurringExpenses(owner, period.startDate, period.endDate);
    const taxRows = reportTaxRows(owner, reportRows, properties);
    const municipality = Array.from(new Set(taxRows.map((row) => row.destination))).join(", ") || "Set in property settings";
    return {
      owner,
      amountToReport: amountToReportTotal(owner, reportRows),
      municipality
    };
  });
  const body = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Owner</th><th>Municipality</th><th>Amount To Report</th></tr></thead>
        <tbody>
          ${rows
            .map(
              ({ owner, municipality, amountToReport }) => `
              <tr>
                <td>${escapeHtml(owner.name)}</td>
                <td>${escapeHtml(municipality)}</td>
                <td>${formatMoney(amountToReport)}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
  return {
    title: "All Owners Tax Report",
    periodLabel: period.label,
    summary: {},
    html: reportShell("All Owners Tax Report", period.label, body, {})
  };
}

export function makeShareId() {
  return crypto.randomBytes(16).toString("hex");
}
