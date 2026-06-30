import type { AppSettings, CalculatedReservation, CleaningCap, NormalizedReservation, OwnerLike } from "@/lib/types";

function lower(value: string | undefined) {
  return (value || "").toLowerCase();
}

function hasManualSource(row: NormalizedReservation) {
  const source = lower(row.source);
  const platform = lower(row.platform);
  return source.includes("manual") || platform.includes("manual");
}

function isManualFeeExcludedSource(row: NormalizedReservation) {
  const source = lower(row.source).replace(/\s+/g, "_");
  return ["manual_vrbo", "manual_airbnb", "manual_direct"].some((value) => source.includes(value));
}

export function grossPayout(row: NormalizedReservation) {
  return row.manualTotalPayout != null ? row.manualTotalPayout : row.totalPayout;
}

function findCleaningCap(row: NormalizedReservation, owner: OwnerLike, settings: AppSettings): CleaningCap | undefined {
  const caps = [...(owner.cleaningCaps || []), ...(settings.defaultCleaningCaps || [])].filter((cap) => cap.maxAmount > 0);
  return caps.find((cap) => !cap.property || cap.property.toLowerCase() === row.property.toLowerCase());
}

export function cleaningFee(row: NormalizedReservation, owner: OwnerLike, settings: AppSettings) {
  if (row.manualCleaningFare != null) return row.manualCleaningFare;
  if (lower(row.status).includes("cancel")) return 0;
  let cleaning = row.cleaningFare;
  const cap = findCleaningCap(row, owner, settings);
  if (cap) cleaning = Math.min(cleaning, cap.maxAmount);
  return Math.max(0, cleaning);
}

export function websiteVrboFee(
  row: NormalizedReservation,
  owner: OwnerLike,
  calculationSource: "reports" | "portal" = "reports"
) {
  const gross = grossPayout(row);
  const source = lower(row.source);
  const platform = lower(row.platform);

  if (calculationSource === "portal") {
    if (isManualFeeExcludedSource(row)) return 0;
    if (hasManualSource(row)) {
      const base = row.preCancellationHostPayout > 0 ? row.preCancellationHostPayout : gross;
      return base * 0.01 + 0.3;
    }
    if (source.includes("website")) return gross * 0.01 + 0.3;
    if (platform.includes("homeaway")) return row.channelCommission;
    return 0;
  }

  if (hasManualSource(row)) {
    if (isManualFeeExcludedSource(row)) return 0;
    if (source.includes("manual") && !row.channelCommission && gross > 0) return gross * 0.01 + 0.3;
  }

  if (row.manualWebsiteFee != null) return row.manualWebsiteFee;
  if (source.includes("website")) return gross * 0.01 + 0.3;
  if (owner.type === "draft" && platform.includes("homeaway")) return row.channelCommission;
  return 0;
}

export function taxes(row: NormalizedReservation) {
  return row.rowTaxTotal;
}

export function pmcPercent(owner: OwnerLike) {
  if (owner.type === "split") return 1 - (owner.splitOwnerPercent || 0) / 100;
  return owner.percent || 0;
}

export function netAccommodationDraft(
  row: NormalizedReservation,
  owner: OwnerLike,
  settings: AppSettings,
  calculationSource: "reports" | "portal" = "reports"
) {
  const websiteFee = websiteVrboFee(row, owner, calculationSource);
  if (row.manualAccommodation != null) {
    return Math.max(0, row.manualAccommodation);
  }

  const net =
    grossPayout(row) -
    cleaningFee(row, owner, settings) -
    taxes(row) +
    row.lengthOfStayDiscount -
    websiteFee -
    row.feeCreditCard -
    row.airbnbResolutionCenter;
  return Math.max(0, net);
}

export function netAccommodationPayout(
  row: NormalizedReservation,
  owner: OwnerLike,
  settings: AppSettings,
  calculationSource: "reports" | "portal" = "reports"
) {
  const cleaning = cleaningFee(row, owner, settings);
  const taxTotal = taxes(row);
  const websiteFee = websiteVrboFee(row, owner, calculationSource);
  if (row.manualAccommodation != null) {
    return Math.max(0, row.manualAccommodation);
  }
  const payoutRegular = row.accommodationFare - row.markup + row.lengthOfStayDiscount;
  const payoutFeeLoad = cleaning + taxTotal + websiteFee + row.feeCreditCard;

  if (row.totalPayout - payoutRegular < payoutFeeLoad) {
    return Math.max(0, row.totalPayout - cleaning - taxTotal - websiteFee - row.feeCreditCard);
  }

  return Math.max(0, payoutRegular);
}

export function expectedPayoutDate(checkOut: string) {
  const date = new Date(checkOut);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 5)).toISOString().slice(0, 10);
}

export function calculateReservation(
  row: NormalizedReservation,
  owner: OwnerLike,
  settings: AppSettings,
  options: { expenses?: number; calculationSource?: "reports" | "portal" } = {}
): CalculatedReservation {
  const calculationSource = options.calculationSource || "reports";
  const isOwnerStay = row.guestName.toUpperCase().includes("OWNER STAY");
  const cleaning = isOwnerStay ? Math.max(0, owner.cleaningFee || 0) : cleaningFee(row, owner, settings);
  const websiteFee = websiteVrboFee(row, owner, calculationSource);
  const netAccommodation = isOwnerStay
    ? 0
    : owner.type === "payout" || owner.type === "split"
      ? netAccommodationPayout(row, owner, settings, calculationSource)
      : netAccommodationDraft(row, owner, settings, calculationSource);
  const percent = pmcPercent(owner);
  const calculatedPmc = netAccommodation * percent;
  const pmc = row.manualPmc != null ? row.manualPmc : calculatedPmc;
  const calculatedOwnerPayoutBeforeExpenses = isOwnerStay
    ? -cleaning
    : owner.type === "split"
      ? netAccommodation * ((owner.splitOwnerPercent || 0) / 100)
      : netAccommodation - pmc;
  const ownerPayoutBeforeExpenses = row.manualOwnerPayout != null ? row.manualOwnerPayout : calculatedOwnerPayoutBeforeExpenses;
  const ownerPayout = isOwnerStay
    ? ownerPayoutBeforeExpenses - (options.expenses || 0)
    : owner.type === "split"
      ? ownerPayoutBeforeExpenses - (options.expenses || 0)
      : netAccommodation - pmc - (options.expenses || 0);

  return {
    ...row,
    grossPayout: grossPayout(row),
    cleaning,
    websiteVrboFee: websiteFee,
    taxes: taxes(row),
    netAccommodation,
    pmcPercent: percent,
    pmc,
    ownerPayoutBeforeExpenses,
    ownerPayout,
    expectedPayoutDate: row.manualExpectedPayoutDate || expectedPayoutDate(row.checkOut),
    isOwnerStay
  };
}
