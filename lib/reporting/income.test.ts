import assert from "node:assert/strict";
import { describe, it } from "node:test";

function close(actual: unknown, expected: number) {
  assert.equal(typeof actual, "number");
  assert.ok(Math.abs(Number(actual) - expected) < 0.001, `${actual} is not within 0.001 of ${expected}`);
}
import { buildAdminIncomeData, buildOwnerReport } from "@/lib/reporting/reports";
import { ownerReportReservationQuery, reservationQueryForPeriod } from "@/lib/reporting/reservation-query";
import type { AppSettings, NormalizedReservation, OwnerLike, PropertyLike } from "@/lib/types";

const settings: AppSettings = { guestyCacheTtlMinutes: 30, defaultCleaningCaps: [] };

const novemberStays: Array<[string, number, string]> = [
  ["NMB - 1501", 4450, "2026-11-17"],
  ["NMB - 1704 PERRIN", 1358, "2026-11-11"],
  ["NMB - 1704 PERRIN", 1687, "2026-11-17"],
  ["NMB - 1705 HOLLY", 1008, "2026-11-11"],
  ["NMB - 1705 HOLLY", 1687, "2026-11-17"],
  ["NMB - 1670", 2000, "2026-06-02"]
];

function reservation(property: string, net: number, checkIn: string, index: number): NormalizedReservation {
  return {
    id: `ssk-${index}`,
    property,
    guestName: "Test",
    checkIn,
    checkOut: checkIn,
    nights: 5,
    source: "airbnb",
    platform: "airbnb",
    confirmationCode: `T${index}`,
    status: "confirmed",
    totalPayout: net,
    accommodationFare: net,
    cleaningFare: 0,
    markup: 0,
    channelCommission: 0,
    preCancellationHostPayout: 0,
    feeCreditCard: 0,
    lengthOfStayDiscount: 0,
    airbnbResolutionCenter: 0,
    manualAccommodation: net,
    taxesCombined: 0,
    taxCity: 0,
    taxState: 0,
    taxCounty: 0,
    taxOccupancy: 0,
    taxGtc: 0,
    invoiceItemsTaxCombined: 0,
    detailedTaxesCombined: 0,
    rowTaxTotal: 0,
    invoiceItemsRaw: [],
    raw: {}
  };
}

function sskOwner(percent = 0.12): OwnerLike {
  return {
    _id: "ssk",
    name: "SSK G REALTY LLC",
    type: "payout",
    percent,
    properties: [],
    recurringCharges: [
      { label: "Pool Service", amount: 250 },
      { label: "Pest Control", amount: 90 }
    ]
  };
}

describe("income inclusion", () => {
  const rows = novemberStays.map(([property, net, checkIn], index) => reservation(property, net, checkIn, index));
  const withoutNewProperties = buildAdminIncomeData(
    [sskOwner()],
    new Map([["ssk", []]]),
    new Map([["ssk", []]]),
    settings,
    { year: 2026 }
  );
  const withNewProperties = buildAdminIncomeData(
    [sskOwner()],
    new Map([["ssk", rows]]),
    new Map([["ssk", []]]),
    settings,
    { year: 2026 }
  );

  it("includes 1670, 1704, 1705, and 1501 and raises the portfolio totals", () => {
    const names = withNewProperties.properties.map((row) => row.property);
    for (const needle of ["1501", "1670", "1704", "1705"]) {
      assert.ok(names.some((name) => name.includes(needle)), `${needle} missing from ${names.join(", ")}`);
    }
    assert.equal(withoutNewProperties.summary.netAccommodation, 0);
    close(withNewProperties.summary.netAccommodation, 12190);
    close(withNewProperties.summary.pmc, 1462.8);
    assert.equal(withNewProperties.summary.stays, 6);
    assert.ok(withNewProperties.summary.companyIncome > withoutNewProperties.summary.companyIncome);
    assert.equal(withNewProperties.summary.netAccommodation - withoutNewProperties.summary.netAccommodation, 12190);
  });

  it("shows a catalog property that has no stays without changing totals", () => {
    const catalog: PropertyLike[] = [{ name: "NMB - 1670", reportAddress: "1670 Ocean Blvd" }];
    const income = buildAdminIncomeData(
      [sskOwner()],
      new Map([["ssk", rows.filter((row) => row.property !== "NMB - 1670")]]),
      new Map([["ssk", []]]),
      settings,
      { year: 2026 },
      catalog
    );
    const property = income.properties.find((row) => row.property === "NMB - 1670");
    assert.ok(property);
    assert.equal(property?.owner, "Unassigned");
    assert.equal(property?.netAccommodation, 0);
    assert.equal(income.summary.netAccommodation, 10190);
  });

  it("uses the same full-year Guesty query for a November statement and the income page", () => {
    const statementQuery = reservationQueryForPeriod("2026-11-01", "2026-11-30");
    assert.deepEqual(statementQuery, ownerReportReservationQuery(2026));
    assert.equal(statementQuery.allProperties, true);
    assert.equal(statementQuery.startDate, "2026-01-01");
    assert.equal(statementQuery.endDate, "2026-12-31");
  });
});

describe("SSK November statement", () => {
  const rows = novemberStays
    .filter(([, , checkIn]) => checkIn.startsWith("2026-11"))
    .map(([property, net, checkIn], index) => reservation(property, net, checkIn, index));

  it("includes the test stays and charges 12% when the stored rate is 0.12 or 12", () => {
    const correct = buildOwnerReport(sskOwner(0.12), rows, [], settings, { reportKey: "statement", month: 11, year: 2026 });
    const mistyped = buildOwnerReport(sskOwner(12), rows, [], settings, { reportKey: "statement", month: 11, year: 2026 });
    close(correct.summary.netAccommodation, 10190);
    close(correct.summary.pmc, 1222.8);
    assert.equal(correct.summary.bookedNights, 25);
    close(mistyped.summary.pmc, 1222.8);
    close(correct.summary.ownerPayout, 10190 - 1222.8 - 340);
    for (const name of ["NMB - 1501", "NMB - 1704 PERRIN", "NMB - 1705 HOLLY"]) {
      assert.ok(correct.html.includes(name));
    }
    assert.equal(mistyped.summary.pmc === 122280, false);
  });

  it("shows recurring charges when the reservation feed is empty", () => {
    const report = buildOwnerReport(sskOwner(), [], [], settings, { reportKey: "statement", month: 11, year: 2026 });
    assert.equal(report.summary.netAccommodation, 0);
    assert.equal(report.summary.pmc, 0);
    assert.equal(report.summary.recurringCharges, 340);
    assert.ok(report.html.includes("Pool Service"));
    assert.ok(report.html.includes("Pest Control"));
  });
});
