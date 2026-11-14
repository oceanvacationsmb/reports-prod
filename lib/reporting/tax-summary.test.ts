import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateReservation } from "@/lib/reporting/formulas";
import { buildAllOwnersTaxReport, buildOwnerReport } from "@/lib/reporting/reports";
import type { AppSettings, NormalizedReservation, OwnerLike } from "@/lib/types";

const settings: AppSettings = { guestyCacheTtlMinutes: 30, defaultCleaningCaps: [] };

function stay(values: Partial<NormalizedReservation> & Pick<NormalizedReservation, "id" | "property" | "source" | "platform" | "totalPayout" | "rowTaxTotal">): NormalizedReservation {
  return {
    guestName: "Guest",
    checkIn: "2026-10-10",
    checkOut: "2026-10-15",
    nights: 5,
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
    taxesCombined: values.rowTaxTotal,
    taxCity: 0,
    taxState: 0,
    taxCounty: 0,
    taxOccupancy: 0,
    taxGtc: 0,
    invoiceItemsTaxCombined: 0,
    detailedTaxesCombined: 0,
    invoiceItemsRaw: [],
    raw: {},
    ...values
  };
}

const october1463 = [
  stay({
    id: "vrbo",
    property: "GC - 1463",
    source: "VRBO",
    platform: "HomeAway",
    totalPayout: 3458.56,
    rowTaxTotal: 370.56,
    manualAccommodation: 2443.64
  }),
  stay({
    id: "airbnb",
    property: "GC - 1463",
    source: "airbnb2",
    platform: "Airbnb",
    totalPayout: 1536.42,
    rowTaxTotal: 0,
    manualAccommodation: 1050
  })
];

describe("owner payout tax summary", () => {
  const payout: OwnerLike = { _id: "nicole", name: "1463 - NICOLE", type: "payout", percent: 0.12, taxFlags: { SC: true, GTC: true } };

  it("reports gross payout minus taxes for taxed reservations only", () => {
    const report = buildAllOwnersTaxReport(
      [payout],
      new Map([["nicole", october1463]]),
      new Map([["nicole", []]]),
      settings,
      { reportKey: "allOwnersTax", month: 10, year: 2026 },
      [{ name: "GC - 1463", municipality: "SC, GTC" }]
    );
    assert.ok(report.html.includes("$3,088.00"));
    assert.equal(report.html.includes("$2,443.64"), false);
    assert.ok(report.html.includes("1463 - NICOLE"));
  });

  it("leaves draft reports and statement payout math unchanged", () => {
    const draft: OwnerLike = { ...payout, _id: "draft", type: "draft" };
    const draftReport = buildAllOwnersTaxReport(
      [draft],
      new Map([["draft", october1463]]),
      new Map([["draft", []]]),
      settings,
      { reportKey: "allOwnersTax", month: 10, year: 2026 }
    );
    assert.ok(draftReport.html.includes("$0.00"));
    assert.equal(draftReport.html.includes("$3,088.00"), false);

    const statement = buildOwnerReport(payout, october1463, [], settings, { reportKey: "statement", month: 10, year: 2026 });
    assert.equal(statement.summary.netAccommodation, 3493.64);
    const calculated = calculateReservation(october1463[0], payout, settings);
    assert.ok(Math.abs(calculated.pmc - 2443.64 * 0.12) < 0.001);
    assert.ok(Math.abs(Number(statement.summary.pmc) - (3493.64 * 0.12)) < 0.001);
  });
});
