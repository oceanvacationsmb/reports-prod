import { computeGeorgetown, computeSurfside, type OfficialComputation } from "@/lib/tax/official-forms";
import { formatDollars, formatLongDate, money, periodEnd, periodStart } from "@/lib/tax/money";
import type { TaxCompanyProfile } from "@/lib/tax/setup";
import { companyMailingBlock } from "@/lib/tax/setup";

export type PropertyIncome = {
  property: string;
  grossReceipts: number;
  taxesCollected: number;
};

export type PacketAdjustments = {
  foodGross?: number;
  admissionsGross?: number;
  nontaxableRetail?: number;
  longTermRentalDeduction?: number;
};

export function jurisdictionIncome(roster: string[], figures: { property: string; amountToReport: number; taxesCollected: number }[]) {
  const slots = new Map<string, PropertyIncome>();
  for (const name of roster) {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || slots.has(key)) continue;
    slots.set(key, { property: trimmed, grossReceipts: 0, taxesCollected: 0 });
  }
  for (const figure of figures) {
    const slot = slots.get(figure.property.trim().toLowerCase());
    if (!slot) continue;
    slot.grossReceipts = money(slot.grossReceipts + figure.amountToReport);
    slot.taxesCollected = money(slot.taxesCollected + figure.taxesCollected);
  }
  return [...slots.values()].sort((a, b) => a.property.localeCompare(b.property));
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function packetPreviewHtml(input: {
  computation: OfficialComputation;
  properties: PropertyIncome[];
  company: TaxCompanyProfile;
  stateReturnCount?: number;
}) {
  const { computation, properties, company } = input;
  const rental = properties.reduce((sum, property) => sum + property.grossReceipts, 0);
  const rows = properties
    .map(
      (property) => `<tr>
        <td>${escapeHtml(property.property)}</td>
        <td>${escapeHtml(formatDollars(property.grossReceipts))}</td>
        <td>${escapeHtml(formatDollars(property.taxesCollected))}</td>
      </tr>`
    )
    .join("");
  const lineRows = computation.lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.line)}</td>
        <td>${escapeHtml(line.label)}</td>
        <td>${escapeHtml(formatDollars(line.amount))}</td>
      </tr>`
    )
    .join("");
  const check = computation.remittance.noCheckNeeded
    ? `<p class="check-needed"><strong>No check needed</strong></p>`
    : `<p class="check-needed"><strong>Check amount ${escapeHtml(formatDollars(computation.remittance.checkAmount))}</strong></p>`;
  const stateNote =
    computation.jurisdiction === "georgetown"
      ? `<p>${input.stateReturnCount ? `${input.stateReturnCount} filed MyDORWAY return file(s) are stored with this packet.` : "No filed MyDORWAY return is stored for this month yet."}</p>`
      : "";
  return `<article class="report-document tax-packet">
    <header class="report-hero">
      <p>Ocean Vacations</p>
      <h1>${escapeHtml(computation.formName)}</h1>
      <span>${escapeHtml(computation.periodLabel)}</span>
    </header>
    <section>
      <h2>Where to mail the check</h2>
      ${check}
      <p><strong>Payee:</strong> ${escapeHtml(computation.remittance.payee)}</p>
      <p>${computation.remittance.mailingAddress.map((line) => escapeHtml(line)).join("<br>")}</p>
      <p><strong>Postmark deadline:</strong> ${escapeHtml(computation.remittance.deadlineLabel)}</p>
      <p class="source">${escapeHtml(computation.remittance.payeeSource)}</p>
      <p class="source">${escapeHtml(computation.remittance.addressSource)}</p>
      <p class="source">${escapeHtml(computation.remittance.deadlineSource)}</p>
      <p class="source">Form: <a href="${escapeHtml(computation.formUrl)}">${escapeHtml(computation.formUrl)}</a></p>
    </section>
    <section>
      <h2>Company</h2>
      <p>${companyMailingBlock(company).map((line) => escapeHtml(line)).join("<br>") || "Company setup is blank."}</p>
      <p>Federal ID ${escapeHtml(company.federalId || "—")} · SC sales tax no. ${escapeHtml(company.scSalesTaxNumber || "—")}</p>
    </section>
    <section>
      <h2>Property list</h2>
      <p>Gross rental proceeds ${escapeHtml(formatDollars(rental))}. Properties with no income are listed at $0. Taxes collected are the statement tax totals for the same properties and are not a second tax calculation.</p>
      <table>
        <thead><tr><th>Property</th><th>Gross receipts</th><th>Taxes collected</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="3">No properties are on this list yet.</td></tr>`}</tbody>
      </table>
    </section>
    <section>
      <h2>Form lines</h2>
      <table>
        <thead><tr><th>Line</th><th>Description</th><th>Amount</th></tr></thead>
        <tbody>${lineRows}</tbody>
      </table>
      ${computation.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}
      ${stateNote}
    </section>
  </article>`;
}

export function buildMonthlyPackets(input: {
  year: number;
  month: number;
  asOf: string;
  company: TaxCompanyProfile;
  rosters: { surfside: string[]; georgetown: string[] };
  figures: { property: string; amountToReport: number; taxesCollected: number }[];
  adjustments?: PacketAdjustments;
  stateReturnCount?: number;
}) {
  const surfsideProperties = jurisdictionIncome(input.rosters.surfside, input.figures);
  const georgetownProperties = jurisdictionIncome(input.rosters.georgetown, input.figures);
  const surfsideGross = money(surfsideProperties.reduce((sum, property) => sum + property.grossReceipts, 0));
  const georgetownGross = money(georgetownProperties.reduce((sum, property) => sum + property.grossReceipts, 0));
  const adjustments = input.adjustments || {};
  const surfside = computeSurfside({
    year: input.year,
    month: input.month,
    rentalGross: surfsideGross,
    foodGross: adjustments.foodGross,
    admissionsGross: adjustments.admissionsGross,
    asOf: input.asOf
  });
  const georgetown = computeGeorgetown({
    year: input.year,
    month: input.month,
    rentalGross: georgetownGross,
    foodGross: adjustments.foodGross,
    nontaxableRetail: adjustments.nontaxableRetail,
    longTermRentalDeduction: adjustments.longTermRentalDeduction,
    asOf: input.asOf
  });
  return {
    period: {
      year: input.year,
      month: input.month,
      start: periodStart(input.year, input.month),
      end: periodEnd(input.year, input.month),
      label: formatLongDate(periodEnd(input.year, input.month))
    },
    packets: [
      {
        jurisdiction: "surfside" as const,
        properties: surfsideProperties,
        computation: surfside,
        previewHtml: packetPreviewHtml({ computation: surfside, properties: surfsideProperties, company: input.company })
      },
      {
        jurisdiction: "georgetown" as const,
        properties: georgetownProperties,
        computation: georgetown,
        previewHtml: packetPreviewHtml({
          computation: georgetown,
          properties: georgetownProperties,
          company: input.company,
          stateReturnCount: input.stateReturnCount
        })
      }
    ]
  };
}
