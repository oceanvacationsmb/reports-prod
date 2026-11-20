export type TaxFormKind = "georgetown" | "surfside";

export type TaxRates = {
  accommodationRate: number;
  hospitalityRate: number;
  discountRate: number;
  penaltyRatePerMonth: number;
};

export type TaxLine = {
  line: string;
  label: string;
  amount: number;
  formula: string;
};

export type JurisdictionTaxResult = {
  kind: TaxFormKind;
  timely: boolean;
  monthsLate: number;
  grossProceeds: number;
  lines: TaxLine[];
  totalDue: number;
  accommodationTax: number;
  hospitalityTax: number;
  penalty: number;
  discount: number;
};

export const SURFSIDE_HOSPITALITY_CONCLUSION =
  "Stays of 90 or more nights aren't transient, but the form has no line for them, so line 2 matches the tax report.";

export function cents(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function moneyText(value: number) {
  return cents(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function line(id: string, label: string, amount: number, formula: string): TaxLine {
  return { line: id, label, amount: cents(amount), formula };
}

function penaltyAmount(base: number, rates: TaxRates, monthsLate: number) {
  if (monthsLate <= 0) return 0;
  return cents(base * rates.penaltyRatePerMonth * monthsLate);
}

function discountAmount(base: number, rates: TaxRates, monthsLate: number, penalty: number) {
  if (monthsLate > 0 || penalty > 0) return 0;
  return cents(base * rates.discountRate);
}

export function calculateGeorgetown(input: {
  grossProceeds: number;
  longStay30: number;
  rates: TaxRates;
  monthsLate: number;
}): JurisdictionTaxResult {
  const gross = cents(input.grossProceeds);
  const longStay = cents(Math.min(gross, Math.max(0, input.longStay30)));
  const subject = cents(gross - longStay);
  const hospitalityBase = 0;
  const hospitalityTax = cents(hospitalityBase * input.rates.hospitalityRate);
  const accommodationTax = cents(subject * input.rates.accommodationRate);
  const taxesDue = cents(hospitalityTax + accommodationTax);
  const monthsLate = Math.max(0, Math.trunc(input.monthsLate || 0));
  const penalty = penaltyAmount(taxesDue, input.rates, monthsLate);
  const totalDue = cents(taxesDue + penalty);
  const rateLabel = `${(input.rates.accommodationRate * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  return {
    kind: "georgetown",
    timely: monthsLate === 0,
    monthsLate,
    grossProceeds: gross,
    accommodationTax,
    hospitalityTax,
    penalty,
    discount: 0,
    totalDue,
    lines: [
      line("1", "Gross proceeds from food and beverage sales", 0, "No food sales"),
      line("2", "Retail sales not subject to hospitality tax", 0, "No food sales"),
      line("3", "Food and beverage sales subject to hospitality tax", 0, "Line 1 minus line 2"),
      line("4", "Local hospitality tax", hospitalityTax, `Line 3 x ${(input.rates.hospitalityRate * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`),
      line("5", "Gross accommodation proceeds", gross, "Tax report amount to report"),
      line("6", "Rentals of 30 or more days", longStay, "Same amount-to-report figure, stays of 30 nights or more"),
      line("7", "Rentals subject to accommodation tax", subject, "Line 5 minus line 6"),
      line("8", "Local accommodation tax", accommodationTax, `Line 7 x ${rateLabel}`),
      line("9", "Taxes due", taxesDue, "Line 4 plus line 8"),
      line("10", "Penalty", penalty, monthsLate ? `Line 9 x ${(input.rates.penaltyRatePerMonth * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}% x ${monthsLate} month${monthsLate === 1 ? "" : "s"}` : "Filed on time, no penalty"),
      line("11", "Total amount due", totalDue, "Line 9 plus line 10")
    ]
  };
}

export function calculateSurfside(input: {
  grossProceeds: number;
  rates: TaxRates;
  monthsLate: number;
}): JurisdictionTaxResult {
  const gross = cents(input.grossProceeds);
  const food = 0;
  const admissions = 0;
  const totalGross = cents(food + gross + admissions);
  const monthsLate = Math.max(0, Math.trunc(input.monthsLate || 0));
  const hospitalityFee = cents(totalGross * input.rates.hospitalityRate);
  const hospitalityPenalty = penaltyAmount(hospitalityFee, input.rates, monthsLate);
  const hospitalityDiscount = discountAmount(hospitalityFee, input.rates, monthsLate, hospitalityPenalty);
  const hospitalityTotal = cents(hospitalityFee + hospitalityPenalty - hospitalityDiscount);
  const accommodationTax = cents(gross * input.rates.accommodationRate);
  const accommodationPenalty = penaltyAmount(accommodationTax, input.rates, monthsLate);
  const accommodationDiscount = discountAmount(accommodationTax, input.rates, monthsLate, accommodationPenalty);
  const accommodationTotal = cents(accommodationTax + accommodationPenalty - accommodationDiscount);
  const totalDue = cents(hospitalityTotal + accommodationTotal);
  const hospitalityPercent = `${(input.rates.hospitalityRate * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  const accommodationPercent = `${(input.rates.accommodationRate * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  const discountPercent = `${(input.rates.discountRate * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  const penaltyPercent = `${(input.rates.penaltyRatePerMonth * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  const timely = monthsLate === 0;
  return {
    kind: "surfside",
    timely,
    monthsLate,
    grossProceeds: gross,
    accommodationTax,
    hospitalityTax: hospitalityFee,
    penalty: cents(hospitalityPenalty + accommodationPenalty),
    discount: cents(hospitalityDiscount + accommodationDiscount),
    totalDue,
    lines: [
      line("1", "Gross proceeds from food and beverages", food, "No food sales"),
      line("2", "Gross proceeds from transient accommodations", gross, "Tax report amount to report"),
      line("3", "Gross proceeds from admissions", admissions, "No admissions"),
      line("4", "Total gross proceeds", totalGross, "Line 1 plus line 2 plus line 3"),
      line("5", "Hospitality fee", hospitalityFee, `Line 4 x ${hospitalityPercent}`),
      line("6", "Hospitality penalty", hospitalityPenalty, timely ? "Filed on time, no penalty" : `Line 5 x ${penaltyPercent} x ${monthsLate} month${monthsLate === 1 ? "" : "s"}`),
      line("7", "Hospitality timely-filing discount", hospitalityDiscount, timely ? `Line 5 x ${discountPercent}` : "No discount when late or when a penalty is due"),
      line("8", "Total hospitality fee", hospitalityTotal, "Line 5 plus line 6 minus line 7"),
      line("9", "Accommodations tax", accommodationTax, `Line 2 x ${accommodationPercent}`),
      line("10", "Accommodations penalty", accommodationPenalty, timely ? "Filed on time, no penalty" : `Line 9 x ${penaltyPercent} x ${monthsLate} month${monthsLate === 1 ? "" : "s"}`),
      line("11", "Accommodations timely-filing discount", accommodationDiscount, timely ? `Line 9 x ${discountPercent}` : "No discount when late or when a penalty is due"),
      line("12", "Total accommodations tax", accommodationTotal, "Line 9 plus line 10 minus line 11"),
      line("total", "Total amount due", totalDue, "Line 8 plus line 12")
    ]
  };
}

export function allocateCents(raw: number[], total: number) {
  if (!raw.length) return [];
  const rounded = raw.map((value) => cents(value));
  const drift = cents(total - rounded.reduce((sum, value) => sum + value, 0));
  const next = rounded.slice();
  const index = next.reduce((best, value, itemIndex, items) => (Math.abs(value) > Math.abs(items[best]) ? itemIndex : best), 0);
  next[index] = cents(next[index] + drift);
  return next;
}
