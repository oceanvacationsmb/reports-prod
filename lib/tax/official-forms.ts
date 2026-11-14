import { addDays, formatLongDate, money, monthsPast, periodEnd, periodStart, weekday } from "@/lib/tax/money";

export const SURFSIDE_FORM_URL =
  "https://www.surfsidebeach.org/DocumentCenter/View/4894/Hospitality-Accommodations-and-Admissions-Tax-Form-2026-Fillable";
export const SURFSIDE_OFFICE_URL = "https://www.surfsidebeach.org/181/Hospitality-Accommodations-Tax";
export const GEORGETOWN_FORM_URL =
  "https://www.gtcountysc.gov/DocumentCenter/View/573/Hospitality-and-Accommodation-Tax-Reporting-Form-PDF";
export const GEORGETOWN_FAQ_URL = "https://sc-georgetowncounty.civicplus.com/351/Hospitality-Accommodations-Tax";
export const GEORGETOWN_ORDINANCE_URL =
  "https://library.municode.com/sc/georgetown_county/codes/code_of_ordinances?nodeId=COOR_CH16TA_ARTIVLOACTA";

export type FormLine = {
  line: string;
  label: string;
  amount: number;
};

export type Remittance = {
  payee: string;
  payeeSource: string;
  mailingAddress: string[];
  addressSource: string;
  deadline: string;
  deadlineLabel: string;
  deadlineSource: string;
  checkAmount: number;
  noCheckNeeded: boolean;
  paymentLabel: string;
};

export type OfficialComputation = {
  jurisdiction: "surfside" | "georgetown";
  formName: string;
  formUrl: string;
  periodLabel: string;
  periodEnding: string;
  lines: FormLine[];
  remittance: Remittance;
  notes: string[];
};

function nthWeekday(year: number, month: number, weekdayIndex: number, n: number) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (weekdayIndex - first.getUTCDay() + 7) % 7;
  return 1 + shift + (n - 1) * 7;
}

function lastWeekday(year: number, month: number, weekdayIndex: number) {
  const last = new Date(Date.UTC(year, month, 0));
  const diff = (last.getUTCDay() - weekdayIndex + 7) % 7;
  return last.getUTCDate() - diff;
}

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function observe(year: number, month: number, day: number) {
  const date = iso(year, month, day);
  const dayOfWeek = weekday(date);
  if (dayOfWeek === 6) return addDays(date, -1);
  if (dayOfWeek === 0) return addDays(date, 1);
  return date;
}

/** USPS federal holidays, observed, for the Georgetown postmark rule. */
export function uspsHolidaySet(year: number) {
  const holidays = new Set<string>();
  const add = (date: string) => holidays.add(date);
  add(observe(year, 1, 1));
  add(iso(year, 1, nthWeekday(year, 1, 1, 3)));
  add(iso(year, 2, nthWeekday(year, 2, 1, 3)));
  add(iso(year, 5, lastWeekday(year, 5, 1)));
  add(observe(year, 6, 19));
  add(observe(year, 7, 4));
  add(iso(year, 9, nthWeekday(year, 9, 1, 1)));
  add(iso(year, 10, nthWeekday(year, 10, 1, 2)));
  add(observe(year, 11, 11));
  add(iso(year, 11, nthWeekday(year, 11, 4, 4)));
  add(observe(year, 12, 25));
  const newYear = observe(year + 1, 1, 1);
  if (newYear.startsWith(String(year))) add(newYear);
  return holidays;
}

export function isSundayOrUspsHoliday(isoDate: string) {
  const year = Number(isoDate.slice(0, 4));
  return weekday(isoDate) === 0 || uspsHolidaySet(year).has(isoDate) || uspsHolidaySet(year - 1).has(isoDate);
}

export function rollToOpenPostOfficeDay(isoDate: string) {
  let cursor = isoDate;
  while (isSundayOrUspsHoliday(cursor)) cursor = addDays(cursor, 1);
  return cursor;
}

export function surfsideDeadline(year: number, month: number) {
  return addDays(periodEnd(year, month), 20);
}

export function georgetownDeadline(year: number, month: number) {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const twentieth = iso(nextYear, nextMonth, 20);
  return rollToOpenPostOfficeDay(twentieth);
}

function penalty(tax: number, deadline: string, asOf: string) {
  const months = monthsPast(deadline, asOf);
  if (!months) return 0;
  const rate = Math.min(1, 0.05 * months);
  return money(tax * rate);
}

export function computeSurfside(input: {
  year: number;
  month: number;
  rentalGross: number;
  foodGross?: number;
  admissionsGross?: number;
  asOf: string;
}): OfficialComputation {
  const food = money(input.foodGross || 0);
  const rental = money(input.rentalGross || 0);
  const admissions = money(input.admissionsGross || 0);
  const totalGross = money(food + rental + admissions);
  const deadline = surfsideDeadline(input.year, input.month);
  const late = input.asOf > deadline;
  const hospitality = money(totalGross * 0.01);
  const hospitalityPenalty = penalty(hospitality, deadline, input.asOf);
  const hospitalityDiscount = late || hospitalityPenalty > 0 ? 0 : money(hospitality * 0.02);
  const hospitalityDue = money(hospitality + hospitalityPenalty - hospitalityDiscount);
  const accommodations = money(rental * 0.005);
  const accommodationsPenalty = penalty(accommodations, deadline, input.asOf);
  const accommodationsDiscount = late || accommodationsPenalty > 0 ? 0 : money(accommodations * 0.02);
  const accommodationsDue = money(accommodations + accommodationsPenalty - accommodationsDiscount);
  const due = money(hospitalityDue + accommodationsDue);
  const lines: FormLine[] = [
    { line: "1", label: "Gross proceeds from sale of food / beverages", amount: food },
    { line: "2", label: "Gross proceeds from rental of transient accommodations", amount: rental },
    { line: "3", label: "Gross proceeds from paid admissions and/or amusements", amount: admissions },
    { line: "4", label: "Total gross proceeds", amount: totalGross },
    { line: "5", label: "Hospitality fee (line 4 × 1%)", amount: hospitality },
    { line: "6", label: "Hospitality penalty (5% of line 5 per month late)", amount: hospitalityPenalty },
    { line: "7", label: "Timely-filing discount (line 5 × 2%)", amount: hospitalityDiscount },
    { line: "8", label: "Total hospitality fee", amount: hospitalityDue },
    { line: "9", label: "Accommodations tax (line 2 × 0.5%)", amount: accommodations },
    { line: "10", label: "Accommodations penalty (5% of line 9 per month late)", amount: accommodationsPenalty },
    { line: "11", label: "Timely-filing discount (line 9 × 2%)", amount: accommodationsDiscount },
    { line: "12", label: "Total accommodations tax", amount: accommodationsDue },
    { line: "Total", label: "Total amount due (lines 8 + 12)", amount: due }
  ];
  return {
    jurisdiction: "surfside",
    formName: "Town of Surfside Beach Hospitality Fee & Accommodations Tax Form (2026)",
    formUrl: SURFSIDE_FORM_URL,
    periodLabel: `${formatLongDate(periodStart(input.year, input.month))} – ${formatLongDate(periodEnd(input.year, input.month))}`,
    periodEnding: periodEnd(input.year, input.month),
    lines,
    remittance: {
      payee: "Town of Surfside Beach",
      payeeSource:
        "The 2026 form header reads “TOWN OF SURFSIDE BEACH.” The form does not print a separate “make check payable to” line, so the packet names the office printed on the form.",
      mailingAddress: ["Town of Surfside Beach", "210 US Hwy 17 S", "Surfside Beach, SC 29575"],
      addressSource: `Printed on the 2026 form (${SURFSIDE_FORM_URL}). The Hospitality Office lists the same street address (${SURFSIDE_OFFICE_URL}).`,
      deadline,
      deadlineLabel: formatLongDate(deadline),
      deadlineSource:
        "The 2026 form says: “This return becomes delinquent if it is postmarked after the 20th day following the close of the period.” The packet uses that date and does not add a weekend extension, because the form does not print one.",
      checkAmount: due,
      noCheckNeeded: due === 0,
      paymentLabel: due === 0 ? "No check needed" : `Check amount ${due.toFixed(2)}`
    },
    notes: [
      "Food and admissions stay at the amounts entered for this month. They default to $0 for a rental filing.",
      "Gross rental proceeds are the Amount to Report already calculated for the properties on the Surfside list.",
      late
        ? "This packet is after the postmark date, so the timely 2% discount is not taken and the form’s 5% monthly penalty is added."
        : "The timely 2% discount printed on lines 7 and 11 is applied because the preparation date is on or before the postmark date. Do not take it if the return is mailed late.",
      "The official PDF has one discount field. Both timely discounts are included in lines 8 and 12, and their sum is written in that single field."
    ]
  };
}

export function computeGeorgetown(input: {
  year: number;
  month: number;
  rentalGross: number;
  foodGross?: number;
  nontaxableRetail?: number;
  longTermRentalDeduction?: number;
  asOf: string;
}): OfficialComputation {
  const food = money(input.foodGross || 0);
  const nontaxable = money(input.nontaxableRetail || 0);
  const foodSubject = money(Math.max(0, food - nontaxable));
  const hospitality = money(foodSubject * 0.02);
  const rental = money(input.rentalGross || 0);
  const longTerm = money(Math.min(rental, Math.max(0, input.longTermRentalDeduction || 0)));
  const rentalSubject = money(rental - longTerm);
  const accommodations = money(rentalSubject * 0.03);
  const taxes = money(hospitality + accommodations);
  const deadline = georgetownDeadline(input.year, input.month);
  const latePenalty = penalty(taxes, deadline, input.asOf);
  const due = money(taxes + latePenalty);
  const lines: FormLine[] = [
    { line: "1", label: "Gross proceeds from sales, excluding taxes", amount: food },
    { line: "2", label: "Less retail sales not subject to hospitality tax", amount: nontaxable },
    { line: "3", label: "Food and beverage sales subject to hospitality tax", amount: foodSubject },
    { line: "4", label: "Local hospitality tax (line 3 × 2%)", amount: hospitality },
    { line: "5", label: "Gross proceeds subject to accommodation tax, excluding taxes", amount: rental },
    { line: "6", label: "Less rentals of 30 or more days", amount: longTerm },
    { line: "7", label: "Rentals subject to local accommodation tax", amount: rentalSubject },
    { line: "8", label: "Local accommodation tax (line 7 × 3%)", amount: accommodations },
    { line: "9", label: "Taxes due (lines 4 + 8)", amount: taxes },
    { line: "10", label: "Penalty on delinquent taxes (line 9 × 5% each month late)", amount: latePenalty },
    { line: "11", label: "Total amount due", amount: due }
  ];
  return {
    jurisdiction: "georgetown",
    formName: "Georgetown County Local Hospitality/Local Accommodation Tax Reporting Form",
    formUrl: GEORGETOWN_FORM_URL,
    periodLabel: `${formatLongDate(periodStart(input.year, input.month))} – ${formatLongDate(periodEnd(input.year, input.month))}`,
    periodEnding: periodEnd(input.year, input.month),
    lines,
    remittance: {
      payee: "Georgetown County",
      payeeSource: `The county form says “Make Check Payable To: Georgetown County” (${GEORGETOWN_FORM_URL}).`,
      mailingAddress: ["Georgetown County Finance Dept.", "P.O. Box 421270", "Georgetown, SC 29442"],
      addressSource: `The form’s mailing block is Georgetown County Finance Dept., P.O. Box 421270, Georgetown, SC 29442 (${GEORGETOWN_FORM_URL}). County Code §16- also directs the return to the County Finance Director, Post Office Drawer 421270, Georgetown, South Carolina 29442 (${GEORGETOWN_ORDINANCE_URL}).`,
      deadline,
      deadlineLabel: formatLongDate(deadline),
      deadlineSource:
        "The form says the return becomes delinquent if postmarked after the 20th day of the following month. The county’s hospitality page says a due date that falls on Sunday or a U.S. Post Office holiday is timely on the next day that is not a Sunday or postal holiday.",
      checkAmount: due,
      noCheckNeeded: due === 0,
      paymentLabel: due === 0 ? "No check needed" : `Check amount ${due.toFixed(2)}`
    },
    notes: [
      "Line 5 uses the Amount to Report already calculated for the properties on the Georgetown list.",
      "Line 6 stays $0 unless a 30-day-or-longer rental deduction is entered. The current reports do not split those stays out.",
      "Food and beverage lines stay $0 unless amounts are entered for this month.",
      "The county requires a copy of SC ST-3, or ST-388 with ST-3T and ST-389, with this return. Upload that filed return so it can be printed with this packet.",
      "The county’s published PDF is encrypted and could not be filled in place. This packet prints the official line numbers, rates, payee, address, and deadline, then lists every property."
    ]
  };
}

export function lineAmount(computation: OfficialComputation, line: string) {
  const match = computation.lines.find((item) => item.line === line);
  if (!match) throw new Error(`Missing form line ${line}.`);
  return match.amount;
}
