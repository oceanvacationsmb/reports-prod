import type { FilingPropertyActivity } from "@/lib/reporting/report-taxes";
import { addressIsComplete, localityLine, postalAddressFromProperty, singleLineAddress, type PostalAddress } from "@/lib/reporting/property-address";
import type { PropertyLike } from "@/lib/types";
import { allocateCents, calculateGeorgetown, calculateSurfside, cents, type JurisdictionTaxResult, type TaxFormKind, type TaxRates } from "@/lib/tax-forms/calculate";
import { propertyActiveInMonth } from "@/lib/tax-forms/period";

export type JurisdictionSettings = {
  id: string;
  name: string;
  formKind: TaxFormKind;
  accountNumber: string;
  federalId: string;
  businessName: string;
  ownerName: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  email: string;
  accommodationRate: number;
  hospitalityRate: number;
  discountRate: number;
  penaltyRatePerMonth: number;
  signatureName: string;
  position: string;
  phone: string;
  hasTemplate: boolean;
};

export type ScheduleRow = {
  property: string;
  address: PostalAddress;
  addressLine: string;
  taxableRevenue: number;
  tax: number;
  accommodationTax: number;
  hospitalityTax: number;
};

export type PreparedJurisdiction = {
  settings: JurisdictionSettings;
  active: boolean;
  rows: ScheduleRow[];
  result: JurisdictionTaxResult;
  longStay90: number;
  note: string;
};

export type PreparedFiling = {
  periodLabel: string;
  jurisdictions: PreparedJurisdiction[];
  unassigned: Array<{ property: string; amountToReport: number }>;
  inactive: Array<{ property: string; amountToReport: number }>;
};

function ratesOf(settings: JurisdictionSettings): TaxRates {
  return {
    accommodationRate: settings.accommodationRate,
    hospitalityRate: settings.hospitalityRate,
    discountRate: settings.discountRate,
    penaltyRatePerMonth: settings.penaltyRatePerMonth
  };
}

function propertyAddress(property: PropertyLike) {
  const address = postalAddressFromProperty(property);
  return { address, addressLine: singleLineAddress(address) || property.reportAddress?.trim() || "" };
}

export function prepareFiling(input: {
  periodLabel: string;
  year: number;
  month: number;
  monthsLate: number;
  properties: PropertyLike[];
  activity: FilingPropertyActivity[];
  jurisdictions: JurisdictionSettings[];
}): PreparedFiling {
  const activityByName = new Map(input.activity.map((row) => [row.property.trim().toLowerCase(), row]));
  const seen = new Set<string>();
  const unassigned: PreparedFiling["unassigned"] = [];
  const inactive: PreparedFiling["inactive"] = [];
  const buckets = new Map<string, Array<{ property: PropertyLike; activity: FilingPropertyActivity }>>();

  for (const property of input.properties) {
    const key = property.name.trim().toLowerCase();
    if (!key || seen.has(key) || property.excludeFromTaxReport) continue;
    seen.add(key);
    const activity = activityByName.get(key) || { property: property.name, amountToReport: 0, longStay30: 0, longStay90: 0 };
    const active = propertyActiveInMonth(property, input.year, input.month);
    if (!active) {
      if (activity.amountToReport > 0) inactive.push({ property: property.name, amountToReport: activity.amountToReport });
      continue;
    }
    const jurisdictionId = property.jurisdictionId?.trim() || "";
    if (!jurisdictionId || !input.jurisdictions.some((item) => item.id === jurisdictionId)) {
      if (activity.amountToReport > 0 || jurisdictionId) unassigned.push({ property: property.name, amountToReport: activity.amountToReport });
      continue;
    }
    buckets.set(jurisdictionId, [...(buckets.get(jurisdictionId) || []), { property, activity }]);
  }

  for (const row of input.activity) {
    const key = row.property.trim().toLowerCase();
    if (!key || seen.has(key) || row.amountToReport <= 0) continue;
    unassigned.push({ property: row.property, amountToReport: row.amountToReport });
  }

  const jurisdictions = input.jurisdictions.map((settings) => {
    const entries = (buckets.get(settings.id) || []).slice().sort((left, right) => left.property.name.localeCompare(right.property.name));
    const gross = cents(entries.reduce((sum, entry) => sum + entry.activity.amountToReport, 0));
    const longStay30 = cents(entries.reduce((sum, entry) => sum + entry.activity.longStay30, 0));
    const longStay90 = cents(entries.reduce((sum, entry) => sum + entry.activity.longStay90, 0));
    const result =
      settings.formKind === "surfside"
        ? calculateSurfside({ grossProceeds: gross, rates: ratesOf(settings), monthsLate: input.monthsLate })
        : calculateGeorgetown({ grossProceeds: gross, longStay30, rates: ratesOf(settings), monthsLate: input.monthsLate });
    const accommodationParts = allocateCents(
      entries.map((entry) => {
        const base = settings.formKind === "georgetown" ? entry.activity.amountToReport - entry.activity.longStay30 : entry.activity.amountToReport;
        return cents(base * settings.accommodationRate);
      }),
      result.accommodationTax
    );
    const hospitalityParts = allocateCents(
      entries.map((entry) => (settings.formKind === "surfside" ? cents(entry.activity.amountToReport * settings.hospitalityRate) : 0)),
      settings.formKind === "surfside" ? result.hospitalityTax : 0
    );
    const rows: ScheduleRow[] = entries.map((entry, index) => {
      const formatted = propertyAddress(entry.property);
      const accommodationTax = accommodationParts[index] || 0;
      const hospitalityTax = hospitalityParts[index] || 0;
      return {
        property: entry.property.name,
        address: formatted.address,
        addressLine: formatted.addressLine,
        taxableRevenue: entry.activity.amountToReport,
        accommodationTax,
        hospitalityTax,
        tax: cents(accommodationTax + hospitalityTax)
      };
    });
    const incomplete = rows.filter((row) => !addressIsComplete(row.address)).map((row) => row.property);
    const note = [
      longStay90 > 0 ? `Stays of 90 or more nights total ${longStay90.toFixed(2)} and remain inside the tax-report amount.` : "",
      incomplete.length ? `Add city, state, and ZIP for ${incomplete.join(", ")} on the property record.` : ""
    ]
      .filter(Boolean)
      .join(" ");
    return { settings, active: rows.length > 0, rows, result, longStay90, note };
  });

  return { periodLabel: input.periodLabel, jurisdictions, unassigned, inactive };
}

export function mailingBlock(settings: JurisdictionSettings) {
  const cityLine = localityLine({
    street: settings.street,
    city: settings.city,
    state: settings.state,
    postalCode: settings.postalCode
  });
  return [settings.businessName, settings.street, cityLine].filter(Boolean).join("\n");
}
