export class RateInputError extends Error {
  status = 400;
}

function numericText(value: unknown) {
  return String(value ?? "").trim().replace(/,/g, "");
}

/**
 * PMC is stored as a fraction: 0.12 means 12%.
 * A typed percent such as 12 or 12% is the same rate.
 * Numbers already in the stored range (0 through 1, including 0.12 and 1) keep their meaning.
 */
export function pmcFractionFromInput(value: unknown) {
  if (value == null || value === "") return 0;
  const original = numericText(value);
  const hasPercentSign = original.includes("%");
  const parsed = Number(original.replace(/%/g, "").trim());
  if (!Number.isFinite(parsed)) {
    throw new RateInputError("Enter a PMC percent like 12 or 0.12.");
  }
  if (parsed < 0 || (hasPercentSign && parsed > 100) || (!hasPercentSign && parsed > 100)) {
    throw new RateInputError("PMC percent must be between 0 and 100. Enter 12 or 0.12 for 12%.");
  }
  if (hasPercentSign || parsed > 1) return parsed / 100;
  return parsed;
}

/** Read a stored PMC fraction without changing correct values such as 0.12, 0.1, or 0.15. */
export function storedPmcFraction(value: number | undefined | null) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  if (parsed <= 1) return parsed;
  if (parsed <= 100) return parsed / 100;
  return 1;
}

/** Sales fee and split owner rates are already stored as percent points: 12 means 12%. */
export function percentPointsFromInput(value: unknown, label: string) {
  if (value == null || value === "") return 0;
  const parsed = Number(numericText(value).replace(/%/g, "").trim());
  if (!Number.isFinite(parsed)) {
    throw new RateInputError(`Enter a ${label.toLowerCase()} like 12 or 12%.`);
  }
  if (parsed < 0 || parsed > 100) {
    throw new RateInputError(`${label} must be between 0 and 100.`);
  }
  return parsed;
}

export function normalizeOwnerRateInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = { ...(input as Record<string, unknown>) };
  if ("percent" in record) record.percent = pmcFractionFromInput(record.percent);
  if ("salesFeePercent" in record) record.salesFeePercent = percentPointsFromInput(record.salesFeePercent, "Sales fee percent");
  if ("splitOwnerPercent" in record) record.splitOwnerPercent = percentPointsFromInput(record.splitOwnerPercent, "Split owner percent");
  return record;
}
