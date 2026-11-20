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

export function reportingAmount(totals: StatementTotals, basis: TenNinetyNineBasis) {
  return basis === "grossRents" ? cents(totals.netAccommodation) : cents(totals.ownerPayout);
}

export type Annual1099Month = Final1099Row & {
  label: string;
  status: "final" | "missing" | "deposit-missing";
  reportingAmount: number | null;
};

export type Annual1099Owner = {
  ownerId: string;
  ownerName: string;
  properties: string[];
  months: Annual1099Month[];
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
  const properties = [...new Set((input.properties || []).map((name) => name.trim()).filter(Boolean))];
  return {
    ownerId: input.ownerId,
    ownerName: input.ownerName,
    properties,
    months,
    finalCount: included.length,
    annualTotal: cents(included.reduce((sum, row) => sum + (row.reportingAmount || 0), 0)),
    missingMonths: months.filter((row) => row.status === "missing").map((row) => row.label)
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

function monthCells(row: Annual1099Month) {
  if (row.status === "missing") {
    return `<td class="missing-final" colspan="6"><span class="missing-final-copy">Not final, needs the sent statement</span></td>`;
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
            ? `<section class="ten-ninety-nine-total"><p>Total from ${owner.finalCount} of 12 final months</p><p>${escapeHtml(money(owner.annualTotal))}</p></section>`
            : `<section class="ten-ninety-nine-total"><p>${escapeHtml(money(owner.annualTotal))}</p></section>`;
      const notes = [
        owner.missingMonths.length && owner.finalCount ? `${owner.missingMonths.length} months are not final, needs the sent statement.` : "",
        owner.finalCount === 12 ? "Every month has an emailed final statement." : ""
      ]
        .filter(Boolean)
        .map((note) => `<p class="ten-ninety-nine-note">${escapeHtml(note)}</p>`)
        .join("");
      return `
        <section class="property-section">
          <header class="property-header"><div><span>Owner</span><h2>${escapeHtml(owner.ownerName)}</h2></div></header>
          <p>Properties: ${escapeHtml(owner.properties.length ? owner.properties.join(", ") : "none on file")}</p>
          <p class="ten-ninety-nine-note">Monthly amounts are the locked statement total for this owner. Properties are listed once and are not added again.</p>
          ${total}
          <div class="table-wrap ten-ninety-nine-table">
            <table>
              <thead><tr><th>Month</th><th>1099 amount</th><th>Net accommodation</th><th>PMC</th><th>Expenses</th><th>Net to owner</th><th>Statement</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
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
    "Properties",
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
        owner.properties.join("; "),
        month.label,
        month.status === "final" ? "Final" : month.status === "deposit-missing" ? "Deposit not recorded" : "Not final - no locked statement",
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
      owner.properties.join("; "),
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
  }
  return rows;
}
