import { cents, type Final1099Row, type FinalMonthInput, type StatementTotals } from "@/lib/locked-statements";
import type { TenNinetyNineBasis } from "@/lib/types";

const monthNames = [
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

export const BASIS_LABEL: Record<TenNinetyNineBasis, string> = {
  grossRents: "Gross rents (net accommodation on the locked statement)",
  ownerPayout: "Owner payout on the locked statement"
};

export function normalizeBasis(value: unknown): TenNinetyNineBasis {
  return value === "grossRents" ? "grossRents" : "ownerPayout";
}

export function reportingAmount(totals: Pick<StatementTotals, "netAccommodation" | "ownerPayout">, basis: TenNinetyNineBasis) {
  return basis === "grossRents" ? cents(totals.netAccommodation) : cents(totals.ownerPayout);
}

export type SnapshotPropertySplit = {
  property: string;
  netAccommodation: number;
  pmc: number;
  expenses: number;
  ownerPayout: number;
};

function parseMoney(value: string) {
  const negative = value.includes("(") || value.trim().startsWith("-");
  const amount = Number(value.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount)) return null;
  return negative ? -amount : amount;
}

function metricAmount(section: string, label: string) {
  const match = section.match(new RegExp(`<span>\\s*${label}\\s*</span>\\s*<strong>\\s*([^<]+?)\\s*</strong>`, "i"));
  return match ? parseMoney(match[1]) : null;
}

/** Read the property blocks saved on a locked statement. Returns null when the snapshot has none. */
export function propertySplitsFromSnapshot(html: string): SnapshotPropertySplit[] | null {
  const sections = String(html || "").split(/<section class="property-section">/i).slice(1);
  const splits: SnapshotPropertySplit[] = [];
  for (const section of sections) {
    const header = section.match(/<span>\s*Property\s*<\/span>\s*<h2>([^<]+)<\/h2>/i);
    if (!header) continue;
    const property = header[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').trim();
    if (!property) continue;
    const netAccommodation = metricAmount(section, "Net Accommodation");
    const ownerPayout = metricAmount(section, "Owner Payout") ?? metricAmount(section, "Draft Due");
    if (netAccommodation == null && ownerPayout == null) continue;
    splits.push({
      property,
      netAccommodation: cents(netAccommodation ?? 0),
      pmc: cents(metricAmount(section, "Pmc") ?? 0),
      expenses: cents(metricAmount(section, "Expenses") ?? 0),
      ownerPayout: cents(ownerPayout ?? 0)
    });
  }
  return splits.length ? splits : null;
}

export type Annual1099Month = Final1099Row & {
  label: string;
  status: "final" | "missing" | "deposit-missing";
  reportingAmount: number | null;
};

export type Property1099Month = {
  month: number;
  label: string;
  status: "final" | "missing" | "deposit-missing" | "not-split";
  reportingAmount: number | null;
};

export type Property1099 = {
  property: string;
  months: Property1099Month[];
  annualTotal: number;
  notSplitMonths: string[];
};

export type Annual1099Owner = {
  ownerId: string;
  ownerName: string;
  properties: string[];
  months: Annual1099Month[];
  propertyReports: Property1099[];
  finalCount: number;
  annualTotal: number;
  missingMonths: string[];
};

export type Annual1099Report = {
  year: number;
  basis: TenNinetyNineBasis;
  basisLabel: string;
  owners: Annual1099Owner[];
  annualTotal: number;
  finalCount: number;
  monthCount: number;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents(value));
}

export function buildOwner1099(input: {
  ownerId: string;
  ownerName: string;
  properties?: string[];
  year: number;
  finals: FinalMonthInput[];
  basis: TenNinetyNineBasis;
}): Annual1099Owner {
  const byMonth = new Map<number, FinalMonthInput>();
  for (const item of input.finals) {
    if (item.year !== input.year || item.month < 1 || item.month > 12) continue;
    if (!byMonth.has(item.month)) byMonth.set(item.month, item);
  }
  const months: Annual1099Month[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const finalMonth = byMonth.get(month);
    const label = monthNames[month - 1];
    if (!finalMonth) {
      months.push({
        month,
        label,
        final: false,
        depositRecorded: false,
        status: "missing",
        netAccommodation: 0,
        pmc: 0,
        expenses: 0,
        netToOwner: 0,
        reportingAmount: null
      });
      continue;
    }
    const expenses = cents(finalMonth.totals.expenses + finalMonth.totals.recurringCharges);
    const deposited = finalMonth.depositRecorded;
    months.push({
      month,
      label,
      final: true,
      depositRecorded: deposited,
      status: deposited ? "final" : "deposit-missing",
      shareId: finalMonth.shareId,
      netAccommodation: cents(finalMonth.totals.netAccommodation),
      pmc: cents(finalMonth.totals.pmc),
      expenses,
      netToOwner: deposited ? cents(finalMonth.totals.ownerPayout) : 0,
      reportingAmount: deposited ? reportingAmount(finalMonth.totals, input.basis) : null
    });
  }
  const included = months.filter((row) => row.status === "final");
  const splitsByMonth = new Map<number, SnapshotPropertySplit[] | null>();
  for (const [month, finalMonth] of byMonth) {
    splitsByMonth.set(month, finalMonth.htmlSnapshot ? propertySplitsFromSnapshot(finalMonth.htmlSnapshot) : null);
  }
  const discovered = [...splitsByMonth.values()].flatMap((splits) => splits?.map((split) => split.property) || []);
  const properties = [...new Set([...(input.properties || []), ...discovered].map((name) => name.trim()).filter(Boolean))];
  const propertyReports = properties.map((property) => propertyReport(property, months, byMonth, splitsByMonth, input.basis));
  return {
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    properties,
    months,
    propertyReports,
    finalCount: included.length,
    annualTotal: cents(included.reduce((sum, row) => sum + (row.reportingAmount || 0), 0)),
    missingMonths: months.filter((row) => row.status === "missing").map((row) => row.label)
  };
}

function propertyReport(
  property: string,
  ownerMonths: Annual1099Month[],
  byMonth: Map<number, FinalMonthInput>,
  splitsByMonth: Map<number, SnapshotPropertySplit[] | null>,
  basis: TenNinetyNineBasis
): Property1099 {
  const months = ownerMonths.map((ownerMonth) => {
    if (ownerMonth.status === "missing") {
      return { month: ownerMonth.month, label: ownerMonth.label, status: "missing" as const, reportingAmount: null };
    }
    if (ownerMonth.status === "deposit-missing") {
      return { month: ownerMonth.month, label: ownerMonth.label, status: "deposit-missing" as const, reportingAmount: null };
    }
    const splits = splitsByMonth.get(ownerMonth.month);
    if (!splits) {
      return { month: ownerMonth.month, label: ownerMonth.label, status: "not-split" as const, reportingAmount: null };
    }
    const found = splits.find((split) => split.property === property);
    const finalMonth = byMonth.get(ownerMonth.month);
    if (!finalMonth) {
      return { month: ownerMonth.month, label: ownerMonth.label, status: "missing" as const, reportingAmount: null };
    }
    return {
      month: ownerMonth.month,
      label: ownerMonth.label,
      status: "final" as const,
      reportingAmount: found ? reportingAmount(found, basis) : 0
    };
  });
  const counted = months.filter((month) => month.status === "final");
  return {
    property,
    months,
    annualTotal: cents(counted.reduce((sum, month) => sum + (month.reportingAmount || 0), 0)),
    notSplitMonths: months.filter((month) => month.status === "not-split").map((month) => month.label)
  };
}

export function buildAnnual1099(year: number, owners: Annual1099Owner[], basis: TenNinetyNineBasis): Annual1099Report {
  return {
    year,
    basis,
    basisLabel: BASIS_LABEL[basis],
    owners,
    annualTotal: cents(owners.reduce((sum, owner) => sum + owner.annualTotal, 0)),
    finalCount: owners.reduce((sum, owner) => sum + owner.finalCount, 0),
    monthCount: owners.length * 12
  };
}

function propertyAmount(month: Property1099Month) {
  if (month.status === "missing") return "Not final";
  if (month.status === "deposit-missing") return "Deposit not recorded";
  if (month.status === "not-split") return "Not split on statement";
  return money(month.reportingAmount || 0);
}

function propertySections(owner: Annual1099Owner) {
  if (!owner.propertyReports.length) return "";
  const unsplit = owner.propertyReports.some((property) => property.notSplitMonths.length);
  const note = unsplit
    ? `<p class="ten-ninety-nine-note">A locked month marked Not split on statement did not store an amount for that property. It stays in the owner total and is not guessed.</p>`
    : "";
  const blocks = owner.propertyReports
    .map((property) => {
      const rows = property.months
        .map((month) => `<tr class="${month.status === "final" ? "" : "missing-final"}"><td>${escapeHtml(month.label)}</td><td>${escapeHtml(propertyAmount(month))}</td></tr>`)
        .join("");
      const annual = property.months.some((month) => month.status === "final")
        ? `<p class="ten-ninety-nine-property-total">Annual total ${escapeHtml(money(property.annualTotal))}</p>`
        : `<p class="ten-ninety-nine-property-total">No property amount on the locked statements.</p>`;
      return `
        <section class="ten-ninety-nine-property">
          <h3>${escapeHtml(property.property)}</h3>
          ${annual}
          <table class="ten-ninety-nine-property-table">
            <thead><tr><th>Month</th><th>1099 amount</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`;
    })
    .join("");
  return `${note}${blocks}`;
}

function missingFinalCopy(count: number) {
  if (count === 1) return "1 month isn't final yet. It needs a sent statement.";
  return `${count} months aren't final yet. Each needs a sent statement.`;
}

function dashCell(label: string) {
  return `<td class="missing-final" data-label="${label}">-</td>`;
}

function monthCells(row: Annual1099Month) {
  if (row.status === "missing") {
    return `<td class="missing-final" data-label="1099 amount">Not final</td>${dashCell("Net accommodation")}${dashCell("PMC")}${dashCell("Expenses")}${dashCell("Net to owner")}${dashCell("Statement")}`;
  }
  if (row.status === "deposit-missing") {
    return `<td class="missing-final" colspan="6"><span class="missing-final-copy">Deposit not recorded. Saved fees ${escapeHtml(money(row.expenses))} stay on file and this month is not in the 1099 total.</span></td>`;
  }
  const link = row.shareId ? `<a href="/share/${escapeHtml(row.shareId)}">Statement</a>` : "";
  return `
    <td data-label="1099 amount">${money(row.reportingAmount || 0)}</td>
    <td data-label="Net accommodation">${money(row.netAccommodation)}</td>
    <td data-label="PMC">${money(row.pmc)}</td>
    <td data-label="Expenses">${money(row.expenses)}</td>
    <td data-label="Net to owner">${money(row.netToOwner)}</td>
    <td data-label="Statement">${link}</td>`;
}

export function renderAnnual1099(report: Annual1099Report) {
  const owners = report.owners
    .map((owner) => {
      const rows = owner.months
        .map((row) => `<tr class="${row.status === "final" ? "" : "missing-final"}"><td data-label="Month">${escapeHtml(row.label)}</td>${monthCells(row)}</tr>`)
        .join("");
      const total =
        owner.finalCount === 0
          ? `<section class="ten-ninety-nine-total"><p>No final statements yet</p><p>Lock a month by emailing the statement or backfilling the sent statement.</p></section>`
          : owner.finalCount < 12
            ? `<section class="ten-ninety-nine-total"><p>Total from ${owner.finalCount} of 12 final months</p><p class="ten-ninety-nine-amount">${escapeHtml(money(owner.annualTotal))}</p></section>`
            : `<section class="ten-ninety-nine-total"><p>Year total</p><p class="ten-ninety-nine-amount">${escapeHtml(money(owner.annualTotal))}</p></section>`;
      const notes = [
        owner.missingMonths.length && owner.finalCount ? missingFinalCopy(owner.missingMonths.length) : "",
        owner.finalCount === 12 ? "Every month has an emailed final statement." : ""
      ]
        .filter(Boolean)
        .map((note) => `<p class="ten-ninety-nine-note">${escapeHtml(note)}</p>`)
        .join("");
      return `
        <section class="property-section">
          <header class="property-header"><div><span>Owner</span><h2>${escapeHtml(owner.ownerName)}</h2></div></header>
          <p>Properties: ${escapeHtml(owner.properties.length ? owner.properties.join(", ") : "none on file")}</p>
          <p class="ten-ninety-nine-note">The owner total comes from the locked statement. Each property below is that statement's own property amount, using the same 1099 setting.</p>
          ${total}
          <div class="table-wrap ten-ninety-nine-table">
            <table>
              <thead><tr><th>Month</th><th>1099 amount</th><th>Net accommodation</th><th>PMC</th><th>Expenses</th><th>Net to owner</th><th>Statement</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          ${propertySections(owner)}
          ${notes}
        </section>`;
    })
    .join("");
  const grand =
    report.owners.length > 1
      ? `<section class="ten-ninety-nine-total"><p>All owners, ${escapeHtml(report.basisLabel)}</p><p>${escapeHtml(money(report.annualTotal))} from ${report.finalCount} final month${report.finalCount === 1 ? "" : "s"}.</p></section>`
      : "";
  return `
    <p class="ten-ninety-nine-note">1099 amount: ${escapeHtml(report.basisLabel)}. Change this in Settings.</p>
    ${grand}
    ${owners || `<p>No owners are set up yet.</p>`}`;
}

export function annual1099Rows(report: Annual1099Report) {
  const header = [
    "Owner",
    "Property",
    "Month",
    "Status",
    "1099 amount",
    "1099 definition",
    "Net accommodation",
    "PMC",
    "Expenses",
    "Owner payout",
    "Statement link"
  ];
  const rows = [header];
  for (const owner of report.owners) {
    for (const month of owner.months) {
      rows.push([
        owner.ownerName,
        "Owner total",
        month.label,
        month.status === "final" ? "Final" : month.status === "deposit-missing" ? "Deposit not recorded" : "Not final",
        month.reportingAmount == null ? "" : month.reportingAmount.toFixed(2),
        report.basisLabel,
        month.status === "missing" ? "" : month.netAccommodation.toFixed(2),
        month.status === "missing" ? "" : month.pmc.toFixed(2),
        month.status === "missing" ? "" : month.expenses.toFixed(2),
        month.status === "final" ? month.netToOwner.toFixed(2) : "",
        month.shareId ? `/share/${month.shareId}` : ""
      ]);
    }
    rows.push([
      owner.ownerName,
      "Owner total",
      "Annual total",
      `${owner.finalCount} of 12 final months`,
      owner.finalCount ? owner.annualTotal.toFixed(2) : "",
      report.basisLabel,
      "",
      "",
      "",
      "",
      ""
    ]);
    for (const property of owner.propertyReports) {
      for (const month of property.months) {
        rows.push([
          owner.ownerName,
          property.property,
          month.label,
          month.status === "final" ? "Final" : month.status === "deposit-missing" ? "Deposit not recorded" : month.status === "not-split" ? "Not split on statement" : "Not final",
          month.status === "final" ? (month.reportingAmount || 0).toFixed(2) : "",
          report.basisLabel,
          "",
          "",
          "",
          "",
          ""
        ]);
      }
      rows.push([
        owner.ownerName,
        property.property,
        "Annual total",
        property.months.some((month) => month.status === "final") ? "Property total" : "Not split on statement",
        property.months.some((month) => month.status === "final") ? property.annualTotal.toFixed(2) : "",
        report.basisLabel,
        "",
        "",
        "",
        "",
        ""
      ]);
    }
  }
  return rows;
}
