import type { AppSettings, CalculatedReservation, NormalizedReservation, OwnerLike, PropertyLike } from "@/lib/types";
import { calculateReservation } from "@/lib/reporting/formulas";
import { periodFromRequest } from "@/lib/reporting/reports";
import { sameProperty } from "@/lib/reporting/report-options";

export type TaxPropertyRow = {
  property: string;
  amountToReport: number;
  totalTax: number;
};

export type TaxJurisdictionGroup = {
  destination: string;
  rows: TaxPropertyRow[];
  amountToReport: number;
  totalTax: number;
};

export type PropertyTaxReport = {
  periodLabel: string;
  properties: number;
  reservationsUsed: number;
  amountToReport: number;
  totalTax: number;
  groups: TaxJurisdictionGroup[];
};

const FLAG_ORDER = ["SC", "MB", "NMB", "SSB", "HC", "GTC"] as const;

const FLAG_LABELS: Record<(typeof FLAG_ORDER)[number], string> = {
  SC: "SC",
  MB: "MB",
  NMB: "NMB",
  SSB: "SSB",
  HC: "HORRY",
  GTC: "GTC"
};

const GROUP_ORDER = ["SC, MB, HORRY", "SC, NMB, HORRY", "SC, SSB, HORRY", "SC, HORRY", "SC, GTC"];

function cents(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseDate(value?: string) {
  if (!value) return null;
  const text = value.trim();
  const usDate = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  const normalized = usDate ? `${usDate[3]}-${usDate[1].padStart(2, "0")}-${usDate[2].padStart(2, "0")}` : text;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inPeriod(row: NormalizedReservation, startDate: string, endDate: string) {
  const date = parseDate(row.checkIn);
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return true;
  if (!date) return false;
  return date >= start && date <= end;
}

function isAggregateOwner(owner: OwnerLike) {
  return owner.name.trim().toLowerCase() === "all properties";
}

function includeStay(row: CalculatedReservation) {
  const canceled = row.status.toLowerCase().includes("cancel");
  if (!canceled) return true;
  return row.netAccommodation > 0 || row.grossPayout > 0 || row.ownerPayoutBeforeExpenses > 0;
}

// Host gross payout minus collected taxes. A stay with no tax contributes nothing.
// NMB - 3104-2 for October 2026 is 3343.56 - 335.56 = 3008.00.
// GC - 1463 for the same month is 3458.56 - 370.56 = 3088.00.
function amountToReport(row: CalculatedReservation) {
  if (row.taxes <= 0) return 0;
  return Math.max(0, cents(row.grossPayout - row.taxes));
}

export function taxGroupLabel(property?: PropertyLike) {
  const municipality = property?.municipality?.trim();
  if (municipality) return municipality;
  const flags = property?.taxFlags || {};
  const labels = FLAG_ORDER.filter((flag) => flags[flag]).map((flag) => FLAG_LABELS[flag]);
  return labels.length ? labels.join(", ") : "Unassigned";
}

function catalogProperty(properties: PropertyLike[], name: string) {
  return properties.find((property) => sameProperty(property.name, name));
}

function stayKey(row: CalculatedReservation) {
  if (row.id) return row.id;
  return [row.property, row.checkIn, row.checkOut, row.guestName, row.grossPayout].join("|");
}

function compareProperties(left: string, right: string) {
  return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}

function compareGroups(left: string, right: string) {
  const leftIndex = GROUP_ORDER.indexOf(left);
  const rightIndex = GROUP_ORDER.indexOf(right);
  if (leftIndex >= 0 || rightIndex >= 0) {
    if (left === "Unassigned") return 1;
    if (right === "Unassigned") return -1;
    if (leftIndex < 0) return 1;
    if (rightIndex < 0) return -1;
    return leftIndex - rightIndex;
  }
  if (left === "Unassigned") return 1;
  if (right === "Unassigned") return -1;
  return left.localeCompare(right);
}

export function buildPropertyTaxReport(
  owners: OwnerLike[],
  reservationsByOwner: Map<string, NormalizedReservation[]>,
  settings: AppSettings,
  month: number,
  year: number,
  properties: PropertyLike[] = []
): PropertyTaxReport {
  const period = periodFromRequest({ reportKey: "statement", month, year });
  const orderedOwners = owners
    .filter((owner) => !isAggregateOwner(owner))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name) || String(left._id || left.id || "").localeCompare(String(right._id || right.id || "")));

  const seen = new Set<string>();
  const totalsByProperty = new Map<string, { property: string; amountToReport: number; totalTax: number }>();
  let reservationsUsed = 0;

  for (const owner of orderedOwners) {
    const ownerId = String(owner._id || owner.id || "");
    const rows = (reservationsByOwner.get(ownerId) || [])
      .filter((row) => inPeriod(row, period.startDate, period.endDate))
      .map((row) => calculateReservation(row, owner, settings, { calculationSource: "reports" }))
      .filter(includeStay);

    for (const row of rows) {
      const key = stayKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      reservationsUsed += 1;
      const propertyName = catalogProperty(properties, row.property)?.name || row.property || "Unassigned";
      const current = totalsByProperty.get(propertyName.toLowerCase()) || {
        property: propertyName,
        amountToReport: 0,
        totalTax: 0
      };
      current.amountToReport += amountToReport(row);
      current.totalTax += row.taxes;
      totalsByProperty.set(propertyName.toLowerCase(), current);
    }
  }

  const names = new Map<string, string>();
  for (const property of properties) {
    const name = property.name.trim();
    if (!name) continue;
    names.set(name.toLowerCase(), name);
  }
  for (const total of totalsByProperty.values()) {
    if (!names.has(total.property.toLowerCase())) names.set(total.property.toLowerCase(), total.property);
  }

  const grouped = new Map<string, TaxPropertyRow[]>();
  for (const name of names.values()) {
    const property = catalogProperty(properties, name);
    const destination = taxGroupLabel(property);
    const total = totalsByProperty.get(name.toLowerCase());
    const row = {
      property: name,
      amountToReport: cents(total?.amountToReport || 0),
      totalTax: cents(total?.totalTax || 0)
    };
    grouped.set(destination, [...(grouped.get(destination) || []), row]);
  }

  const groups = [...grouped.entries()]
    .sort(([left], [right]) => compareGroups(left, right))
    .map(([destination, rows]) => {
      const sorted = rows.slice().sort((left, right) => compareProperties(left.property, right.property));
      return {
        destination,
        rows: sorted,
        amountToReport: cents(sorted.reduce((sum, row) => sum + row.amountToReport, 0)),
        totalTax: cents(sorted.reduce((sum, row) => sum + row.totalTax, 0))
      };
    });

  return {
    periodLabel: period.label,
    properties: groups.reduce((sum, group) => sum + group.rows.length, 0),
    reservationsUsed,
    amountToReport: cents(groups.reduce((sum, group) => sum + group.amountToReport, 0)),
    totalTax: cents(groups.reduce((sum, group) => sum + group.totalTax, 0)),
    groups
  };
}
