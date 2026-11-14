import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOwnerReport, statementTransferFigures } from "@/lib/reporting/reports";
import type { AppSettings, ExpenseLike, NormalizedReservation, OwnerLike } from "@/lib/types";

const settings: AppSettings = { guestyCacheTtlMinutes: 30, defaultCleaningCaps: [] };

function reservation(property: string, net: number, source: string): NormalizedReservation {
  return {
    id: `${property}-${source}`,
    property,
    guestName: "Guest",
    checkIn: "2026-03-04",
    checkOut: "2026-03-08",
    nights: 4,
    source,
    platform: source,
    confirmationCode: property,
    status: "confirmed",
    totalPayout: net,
    accommodationFare: net,
    cleaningFare: 80,
    markup: 0,
    channelCommission: 0,
    preCancellationHostPayout: 0,
    feeCreditCard: 0,
    lengthOfStayDiscount: 0,
    airbnbResolutionCenter: 0,
    taxesCombined: 10,
    taxCity: 0,
    taxState: 10,
    taxCounty: 0,
    taxOccupancy: 0,
    taxGtc: 0,
    invoiceItemsTaxCombined: 0,
    detailedTaxesCombined: 0,
    rowTaxTotal: 10,
    invoiceItemsRaw: [],
    raw: {}
  };
}

describe("statement figures match the existing statement", () => {
  it("uses the statement owner payout and does not invent a new amount to report", () => {
    const owner: OwnerLike = { name: "Ada", type: "payout", percent: 0.2, properties: ["Beach", "Quiet"] };
    const rows = [reservation("Beach", 1000, "direct"), reservation("Quiet", 0, "airbnb")];
    const expenses: ExpenseLike[] = [];
    const request = { month: 3, year: 2026, calculationSource: "reports" as const };
    const report = buildOwnerReport(owner, rows, expenses, settings, { reportKey: "statement", ...request, readOnly: true });
    const figures = statementTransferFigures(owner, rows, expenses, settings, request);
    assert.equal(figures.ownerPayout, report.summary.ownerPayout);
    assert.equal(figures.properties.find((property) => property.property === "Beach")?.ownerPayout, report.summary.ownerPayout);
    assert.equal(figures.properties.find((property) => property.property === "Quiet")?.ownerPayout, 0);
    assert.equal(
      figures.properties.reduce((sum, property) => sum + property.cleaning, 0),
      figures.cleaning
    );
    assert.equal(
      figures.properties.reduce((sum, property) => sum + property.amountToReport, 0),
      figures.amountToReport
    );
    assert.equal(figures.properties.find((property) => property.property === "Quiet")?.amountToReport, 0);
  });
});
