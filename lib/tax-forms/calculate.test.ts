import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { buildFilingActivity, buildPropertyTaxReport } from "@/lib/reporting/report-taxes";
import type { AppSettings, NormalizedReservation, OwnerLike, PropertyLike } from "@/lib/types";
import { allocateCents, calculateGeorgetown, calculateSurfside, cents } from "@/lib/tax-forms/calculate";
import { fillTaxForm } from "@/lib/tax-forms/fill";
import { lastDayOfMonth, periodEndingDate, propertyActiveInMonth } from "@/lib/tax-forms/period";
import { prepareFiling, type JurisdictionSettings } from "@/lib/tax-forms/prepare";

const statutory = {
  accommodationRate: 0.03,
  hospitalityRate: 0.02,
  discountRate: 0.02,
  penaltyRatePerMonth: 0.05
};

const surfsideRates = {
  accommodationRate: 0.005,
  hospitalityRate: 0.01,
  discountRate: 0.02,
  penaltyRatePerMonth: 0.05
};

function line(result: ReturnType<typeof calculateGeorgetown>, id: string) {
  const found = result.lines.find((item) => item.line === id);
  if (!found) throw new Error(`Missing line ${id}`);
  return found.amount;
}

describe("jurisdiction tax math", () => {
  it("computes Georgetown on time from gross proceeds minus 30-day rentals", () => {
    const result = calculateGeorgetown({ grossProceeds: 1000, longStay30: 100, rates: statutory, monthsLate: 0 });
    assert.equal(line(result, "1"), 0);
    assert.equal(line(result, "4"), 0);
    assert.equal(line(result, "5"), 1000);
    assert.equal(line(result, "6"), 100);
    assert.equal(line(result, "7"), 900);
    assert.equal(line(result, "8"), 27);
    assert.equal(line(result, "9"), 27);
    assert.equal(line(result, "10"), 0);
    assert.equal(line(result, "11"), 27);
    assert.equal(result.timely, true);
  });

  it("adds Georgetown's 5 percent penalty for each late month and does not discount", () => {
    const result = calculateGeorgetown({ grossProceeds: 1000, longStay30: 100, rates: statutory, monthsLate: 2 });
    assert.equal(line(result, "8"), 27);
    assert.equal(line(result, "9"), 27);
    assert.equal(line(result, "10"), 2.7);
    assert.equal(line(result, "11"), 29.7);
    assert.equal(result.discount, 0);
  });

  it("rounds Georgetown tax to cents", () => {
    const result = calculateGeorgetown({ grossProceeds: 33.33, longStay30: 0, rates: statutory, monthsLate: 0 });
    assert.equal(line(result, "8"), 1);
    assert.equal(cents(33.33 * 0.03), 1);
  });

  it("fills Surfside hospitality and accommodations on time, with the 2 percent discount", () => {
    const result = calculateSurfside({ grossProceeds: 1000, rates: surfsideRates, monthsLate: 0 });
    assert.equal(line(result, "1"), 0);
    assert.equal(line(result, "2"), 1000);
    assert.equal(line(result, "3"), 0);
    assert.equal(line(result, "4"), 1000);
    assert.equal(line(result, "5"), 10);
    assert.equal(line(result, "6"), 0);
    assert.equal(line(result, "7"), 0.2);
    assert.equal(line(result, "8"), 9.8);
    assert.equal(line(result, "9"), 5);
    assert.equal(line(result, "10"), 0);
    assert.equal(line(result, "11"), 0.1);
    assert.equal(line(result, "12"), 4.9);
    assert.equal(line(result, "total"), 14.7);
  });

  it("removes the Surfside discount and adds both penalties when the return is late", () => {
    const result = calculateSurfside({ grossProceeds: 1000, rates: surfsideRates, monthsLate: 1 });
    assert.equal(line(result, "6"), 0.5);
    assert.equal(line(result, "7"), 0);
    assert.equal(line(result, "8"), 10.5);
    assert.equal(line(result, "10"), 0.25);
    assert.equal(line(result, "11"), 0);
    assert.equal(line(result, "12"), 5.25);
    assert.equal(line(result, "total"), 15.75);
  });
});

describe("period ending and managed properties", () => {
  it("uses the last calendar day of the selected month", () => {
    assert.equal(periodEndingDate(2026, 11), "11/30/2026");
    assert.equal(periodEndingDate(2026, 2), "02/28/2026");
    assert.equal(lastDayOfMonth(2024, 2), 29);
    assert.equal(periodEndingDate(2024, 2), "02/29/2024");
  });

  it("includes a property only while it is managed", () => {
    assert.equal(propertyActiveInMonth({}, 2026, 6), true);
    assert.equal(propertyActiveInMonth({ managedFrom: "2026-07-01" }, 2026, 6), false);
    assert.equal(propertyActiveInMonth({ managedTo: "2026-05-31" }, 2026, 6), false);
    assert.equal(propertyActiveInMonth({ managedFrom: "2026-06-15", managedTo: "2026-06-20" }, 2026, 6), true);
  });
});

describe("filing uses the tax report amount", () => {
  const settings: AppSettings = { guestyCacheTtlMinutes: 30, defaultCleaningCaps: [] };

  function stay(values: Partial<NormalizedReservation> & Pick<NormalizedReservation, "id" | "property" | "nights" | "totalPayout" | "rowTaxTotal">): NormalizedReservation {
    return {
      guestName: "Guest",
      checkIn: "2026-06-02",
      checkOut: "2026-06-06",
      source: "airbnb",
      platform: "airbnb",
      confirmationCode: values.id,
      status: "confirmed",
      accommodationFare: values.totalPayout,
      cleaningFare: 0,
      markup: 0,
      channelCommission: 0,
      preCancellationHostPayout: 0,
      feeCreditCard: 0,
      lengthOfStayDiscount: 0,
      airbnbResolutionCenter: 0,
      taxesCombined: 0,
      taxCity: 0,
      taxState: 0,
      taxCounty: 0,
      taxOccupancy: 0,
      taxGtc: 0,
      invoiceItemsTaxCombined: 0,
      detailedTaxesCombined: values.rowTaxTotal,
      invoiceItemsRaw: [],
      raw: {},
      ...values
    };
  }

  it("keeps the tax-report total and splits 30-night stays onto Georgetown line 6", () => {
    const owner: OwnerLike = { _id: "owner-a", name: "Sample Owner", type: "payout", percent: 0.1, properties: ["Cottage", "Lodge"] };
    const properties: PropertyLike[] = [
      { name: "Cottage", jurisdictionId: "county" },
      { name: "Lodge", jurisdictionId: "county", managedTo: "2026-05-01" },
      { name: "Closed", jurisdictionId: "county", managedTo: "2025-12-31" }
    ];
    const reservations = [
      stay({ id: "short", property: "Cottage", nights: 4, totalPayout: 500, rowTaxTotal: 40, checkIn: "2026-06-02", checkOut: "2026-06-06" }),
      stay({ id: "long", property: "Cottage", nights: 31, totalPayout: 900, rowTaxTotal: 70, checkIn: "2026-06-01", checkOut: "2026-07-02" }),
      stay({ id: "stopped", property: "Lodge", nights: 3, totalPayout: 200, rowTaxTotal: 10, checkIn: "2026-06-03", checkOut: "2026-06-06" })
    ];
    const map = new Map([["owner-a", reservations]]);
    const report = buildPropertyTaxReport([owner], map, settings, 6, 2026, properties);
    const activity = buildFilingActivity([owner], map, settings, 6, 2026, properties);
    const cottage = activity.rows.find((row) => row.property === "Cottage");
    const cottageReport = report.groups.flatMap((group) => group.rows).find((row) => row.property === "Cottage");
    assert.equal(cottage?.amountToReport, cottageReport?.amountToReport);
    assert.equal(cottage?.amountToReport, 1290);
    assert.equal(cottage?.longStay30, 830);
    const county: JurisdictionSettings = {
      id: "county",
      name: "Sample County",
      formKind: "georgetown",
      accountNumber: "SAMPLE-1",
      federalId: "00-0000000",
      businessName: "Sample Rentals",
      ownerName: "Sample Rentals",
      street: "1 Example Road",
      city: "Sample City",
      state: "SC",
      postalCode: "29500",
      email: "filing@example.com",
      ...statutory,
      signatureName: "Sample Signer",
      position: "Clerk",
      phone: "555-0100",
      hasTemplate: true
    };
    const filing = prepareFiling({
      periodLabel: activity.periodLabel,
      year: 2026,
      month: 6,
      monthsLate: 0,
      properties,
      activity: activity.rows,
      jurisdictions: [county]
    });
    assert.deepEqual(filing.inactive.map((row) => row.property), ["Lodge"]);
    assert.equal(filing.jurisdictions[0]?.rows.length, 1);
    assert.equal(filing.jurisdictions[0]?.result.lines.find((item) => item.line === "5")?.amount, 1290);
    assert.equal(filing.jurisdictions[0]?.result.lines.find((item) => item.line === "6")?.amount, 830);
    const taxes = filing.jurisdictions[0]?.rows.map((row) => row.tax) || [];
    assert.equal(cents(taxes.reduce((sum, value) => sum + value, 0)), filing.jurisdictions[0]?.result.accommodationTax);
  });

  it("puts a one-cent rounding difference on one property so the schedule matches the form", () => {
    const parts = allocateCents([0.003, 0.003], 0.01);
    assert.equal(cents(parts.reduce((sum, value) => sum + value, 0)), 0.01);
  });
});

async function textForm(names: string[], checkbox?: string) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const form = pdf.getForm();
  names.forEach((name, index) => {
    const field = form.createTextField(name);
    field.addToPage(page, { x: 40, y: 740 - index * 14, width: 220, height: 12 });
  });
  if (checkbox) form.createCheckBox(checkbox).addToPage(page, { x: 20, y: 20, width: 12, height: 12 });
  return pdf.save();
}

describe("official form fields", () => {
  const settings = (formKind: "georgetown" | "surfside"): JurisdictionSettings => ({
    id: "sample",
    name: formKind === "surfside" ? "Sample Beach" : "Sample County",
    formKind,
    accountNumber: "SAMPLE-9",
    federalId: "00-0000000",
    businessName: "Sample Rentals",
    ownerName: "Sample Rentals",
    street: "1 Example Road",
    city: "Sample City",
    state: "SC",
    postalCode: "29500",
    email: "filing@example.com",
    accommodationRate: formKind === "surfside" ? 0.005 : 0.03,
    hospitalityRate: formKind === "surfside" ? 0.01 : 0.02,
    discountRate: 0.02,
    penaltyRatePerMonth: 0.05,
    signatureName: "Sample Signer",
    position: "Clerk",
    phone: "555-0100",
    hasTemplate: true
  });

  it("writes Georgetown lines and reads them back", async () => {
    const names = [
      "Business Name",
      "Customer Number",
      "Feceral ID No",
      "Month",
      "Year",
      "Gross Proceeds from Sales",
      "Less: Retail Sales NOT Subject to Hospitality Tax",
      "Food and Beverage Sales Subject to Hospitality Tax",
      "Local Hospitality Tax Due",
      "Gross Proceeds from Sales Subject to Accommodation Tax",
      "Less:  Rentals Thirty (30) or More Days NOT Subject to Local Accommodation Tax",
      "Rentals Subject to Local Accommodation Tax",
      "Local Accommodation Tax Due",
      "Taxes Due",
      "Penalty on Delinquent Taxes: Line 9 X 5% for EACH month late",
      "Total Amount Due (Line 9 + Line 10)",
      "Position",
      "Phone Number2",
      "Date4"
    ];
    const template = await textForm(names);
    const result = calculateGeorgetown({ grossProceeds: 1000, longStay30: 100, rates: statutory, monthsLate: 0 });
    const filled = await fillTaxForm(template, {
      settings: settings("georgetown"),
      result,
      rows: [{
        property: "Cottage",
        address: { street: "1 Example Road", city: "Sample City", state: "SC", postalCode: "29500" },
        addressLine: "1 Example Road, Sample City, SC 29500",
        taxableRevenue: 1000,
        tax: 27,
        accommodationTax: 27,
        hospitalityTax: 0
      }],
      year: 2026,
      month: 11,
      filedOn: "12/05/2026"
    });
    const pdf = await PDFDocument.load(filled);
    const form = pdf.getForm();
    assert.equal(pdf.getPageCount(), 2);
    assert.equal(form.getTextField("Business Name").getText(), "Sample Rentals");
    assert.equal(form.getTextField("Customer Number").getText(), "SAMPLE-9");
    assert.equal(form.getTextField("Feceral ID No").getText(), "00-0000000");
    assert.equal(form.getTextField("Month").getText(), "November");
    assert.equal(form.getTextField("Year").getText(), "2026");
    assert.equal(form.getTextField("Gross Proceeds from Sales Subject to Accommodation Tax").getText(), "1,000.00");
    assert.equal(form.getTextField("Less:  Rentals Thirty (30) or More Days NOT Subject to Local Accommodation Tax").getText(), "100.00");
    assert.equal(form.getTextField("Local Accommodation Tax Due").getText(), "27.00");
    assert.equal(form.getTextField("Gross Proceeds from Sales").getText(), "0.00");
    assert.equal(form.getTextField("Position").getText(), "Clerk");
    assert.equal(form.getTextField("Phone Number2").getText(), "555-0100");
    assert.equal(form.getTextField("Date4").getText(), "12/05/2026");
  });

  it("writes Surfside lines, the monthly box, and the period ending date", async () => {
    const names = [
      "DBA Name and Address",
      "Account Number",
      "Property location if different from above",
      "Period Ending or Quarter Ending",
      "Gross Proceeds From Sale of Food or Beverages",
      "Gross Proceeds from Rental of Transient Accommodations",
      "Gross Proceeds from Paid Admissions andor Amusements 1",
      "Total Gross Proceeds",
      "Line 4 x .01",
      "Line 5 x .05",
      "Hospitality Discount If Filed Timely",
      "Total Hospitatlity Fee",
      "Line 2 x .005",
      "Line 9 x .05",
      "Accomadations Discount If Filed Timely",
      "Total Accomadations Tax",
      "TOTAL AMOUNT DUE",
      "Telephone",
      "Date"
    ];
    const template = await textForm(names, "Monthly");
    const result = calculateSurfside({ grossProceeds: 1000, rates: surfsideRates, monthsLate: 0 });
    const filled = await fillTaxForm(template, {
      settings: settings("surfside"),
      result,
      rows: [{
        property: "Unit A",
        address: { street: "10 Sample Street", city: "Sample City", state: "SC", postalCode: "29500" },
        addressLine: "10 Sample Street, Sample City, SC 29500",
        taxableRevenue: 1000,
        tax: 15,
        accommodationTax: 5,
        hospitalityTax: 10
      }],
      year: 2026,
      month: 2,
      filedOn: "03/10/2026"
    });
    const pdf = await PDFDocument.load(filled);
    const form = pdf.getForm();
    assert.equal(pdf.getPageCount(), 2);
    assert.equal(form.getTextField("Account Number").getText(), "SAMPLE-9");
    assert.equal(form.getTextField("Period Ending or Quarter Ending").getText(), "02/28/2026");
    assert.equal(form.getCheckBox("Monthly").isChecked(), true);
    assert.equal(form.getTextField("Gross Proceeds from Rental of Transient Accommodations").getText(), "1,000.00");
    assert.equal(form.getTextField("Gross Proceeds From Sale of Food or Beverages").getText(), "0.00");
    assert.equal(form.getTextField("Line 4 x .01").getText(), "10.00");
    assert.equal(form.getTextField("Line 2 x .005").getText(), "5.00");
    assert.equal(form.getTextField("Hospitality Discount If Filed Timely").getText(), "0.20");
    assert.equal(form.getTextField("Accomadations Discount If Filed Timely").getText(), "0.10");
    assert.equal(form.getTextField("TOTAL AMOUNT DUE").getText(), "14.70");
    assert.equal(form.getTextField("Telephone").getText(), "555-0100");
    assert.match(form.getTextField("DBA Name and Address").getText() || "", /Sample Rentals/);
    assert.match(form.getTextField("Property location if different from above").getText() || "", /10 Sample Street/);
  });

  it("points a multi-property Surfside return at the attached schedule", async () => {
    const names = [
      "DBA Name and Address",
      "Account Number",
      "Property location if different from above",
      "Period Ending or Quarter Ending",
      "Gross Proceeds From Sale of Food or Beverages",
      "Gross Proceeds from Rental of Transient Accommodations",
      "Gross Proceeds from Paid Admissions andor Amusements 1",
      "Total Gross Proceeds",
      "Line 4 x .01",
      "Line 5 x .05",
      "Hospitality Discount If Filed Timely",
      "Total Hospitatlity Fee",
      "Line 2 x .005",
      "Line 9 x .05",
      "Accomadations Discount If Filed Timely",
      "Total Accomadations Tax",
      "TOTAL AMOUNT DUE",
      "Telephone",
      "Date"
    ];
    const template = await textForm(names, "Monthly");
    const pdfDoc = await PDFDocument.load(template);
    pdfDoc.getForm().createCheckBox("Quarterly").addToPage(pdfDoc.getPages()[0], { x: 40, y: 20, width: 12, height: 12 });
    const withQuarter = await pdfDoc.save();
    const result = calculateSurfside({ grossProceeds: 1000, rates: surfsideRates, monthsLate: 0 });
    const row = {
      address: { street: "10 Sample Street", city: "Sample City", state: "SC", postalCode: "29500" },
      taxableRevenue: 500,
      tax: 7.5,
      accommodationTax: 2.5,
      hospitalityTax: 5
    };
    const filled = await fillTaxForm(withQuarter, {
      settings: settings("surfside"),
      result,
      rows: [
        { ...row, property: "Cottage", addressLine: "10 Sample Street, Sample City, SC 29500" },
        { ...row, property: "Cabin", addressLine: "20 Sample Street, Sample City, SC 29500" }
      ],
      year: 2026,
      month: 6,
      filedOn: "07/08/2026"
    });
    const pdf = await PDFDocument.load(filled);
    const form = pdf.getForm();
    assert.equal(form.getTextField("Property location if different from above").getText(), "See attached schedule");
    assert.equal(form.getCheckBox("Monthly").isChecked(), true);
    assert.equal(form.getCheckBox("Quarterly").isChecked(), false);
    assert.deepEqual(
      result.lines.map((line) => line.line),
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "total"]
    );
  });
});
