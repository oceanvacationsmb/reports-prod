import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeReservation } from "@/lib/reporting/normalize";
import { reportPropertyChoices, reportYearChoices } from "@/lib/reporting/report-options";
import { buildOwnerReport, griPropertyAddress } from "@/lib/reporting/reports";
import type { AppSettings, NormalizedReservation, OwnerLike, PropertyLike } from "@/lib/types";

const settings: AppSettings = { guestyCacheTtlMinutes: 30, defaultCleaningCaps: [] };
const guestyAddress = "3104 North Ocean Boulevard, North Myrtle Beach, South Carolina 29582, United States of America";

function stay(property: string, listingAddress = ""): NormalizedReservation {
  return {
    id: property,
    property,
    listingAddress,
    guestName: "Test",
    checkIn: "2026-11-14",
    checkOut: "2026-11-18",
    nights: 4,
    source: "airbnb",
    platform: "airbnb",
    confirmationCode: "ABC",
    status: "confirmed",
    totalPayout: 2962.64,
    accommodationFare: 2962.64,
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
    detailedTaxesCombined: 0,
    rowTaxTotal: 0,
    invoiceItemsRaw: [],
    raw: {}
  };
}

const owner: OwnerLike = { _id: "maron", name: "MARON INVESTMENTS LLC", type: "payout", percent: 0.12, properties: [] };

describe("report property list and year", () => {
  it("shows Guesty properties when the owner record has an empty property list", () => {
    const names = reportPropertyChoices(
      [],
      ["MB - Tuscan A", "MB - Tuscan B", "NMB - 304B", "Recurring", "OWNER"],
      ["NMB - 400A"]
    );
    assert.deepEqual(names, ["MB - Tuscan A", "MB - Tuscan B", "NMB - 304B", "NMB - 400A"]);
  });

  it("defaults the report year to the current year and keeps next year available", () => {
    const choices = reportYearChoices(new Date("2026-11-11T12:00:00"));
    assert.equal(choices.defaultYear, "2026");
    assert.deepEqual(choices.years, [2025, 2026, 2027]);
  });
});

describe("GRI property address", () => {
  it("uses the address saved in property settings", () => {
    const properties: PropertyLike[] = [{ name: "NMB - 3104-2", reportAddress: "3104 North Ocean Blvd, North Myrtle Beach, SC 29582" }];
    const report = buildOwnerReport(owner, [stay("NMB - 3104-2", guestyAddress)], [], settings, {
      reportKey: "gri",
      property: "NMB - 3104-2",
      month: 11,
      year: 2026
    }, properties);
    assert.equal(griPropertyAddress("NMB - 3104-2", properties, [stay("NMB - 3104-2", guestyAddress)]), properties[0].reportAddress);
    assert.ok(report.html.includes("3104 North Ocean Blvd, North Myrtle Beach, SC 29582"));
    assert.equal(report.html.includes("gri-address-hint"), false);
    assert.equal(report.summary.grossPayout, 2962.64);
  });

  it("falls back to the Guesty listing address when settings has none", () => {
    const report = buildOwnerReport(owner, [stay("NMB - 3104-2", guestyAddress)], [], settings, {
      reportKey: "gri",
      property: "NMB - 3104-2",
      month: 11,
      year: 2026
    }, [{ name: "NMB - 3104-2", reportAddress: "" }]);
    assert.ok(report.html.includes(guestyAddress));
    assert.equal(report.html.includes("Property address needed"), false);
    assert.equal(report.html.includes("gri-address-hint"), false);
  });

  it("keeps the settings instruction off the customer-facing address line when no address exists", () => {
    const report = buildOwnerReport(owner, [stay("NMB - 3104-2")], [], settings, {
      reportKey: "gri",
      property: "NMB - 3104-2",
      month: 11,
      year: 2026
    }, []);
    assert.ok(report.html.includes("gri-address-hint"));
    assert.ok(report.html.includes("Settings &gt; Properties"));
    assert.equal(report.html.includes("Property address needed"), false);
    assert.match(report.html, /<strong>NMB - 3104-2<\/strong>/);
  });

  it("uses the report address saved on the exact name MB - Tuscan A", () => {
    const address = "1000 Example Drive, Myrtle Beach, SC 29577";
    const report = buildOwnerReport(owner, [stay("MB - Tuscan A")], [], settings, {
      reportKey: "gri",
      property: "MB - Tuscan A",
      year: 2026
    }, [{ name: "MB - Tuscan A", reportAddress: address }]);
    assert.equal(griPropertyAddress("MB - Tuscan A", [{ name: "MB - Tuscan A", reportAddress: address }], []), address);
    assert.ok(report.html.includes(address));
    assert.equal(report.html.includes("gri-address-hint"), false);
    assert.equal(report.title, `${address} GRI Report`);
  });

  it("uses the address on MB-Tuscan-A when the exact MB - Tuscan A row is blank", () => {
    const address = "1000 Example Drive, Myrtle Beach, SC 29577";
    const properties: PropertyLike[] = [
      { name: "MB - Tuscan A", reportAddress: "" },
      { name: "MB-Tuscan-A", reportAddress: address }
    ];
    const report = buildOwnerReport(owner, [stay("MB - Tuscan A")], [], settings, {
      reportKey: "gri",
      property: "MB - Tuscan A",
      year: 2026
    }, properties);
    assert.equal(griPropertyAddress("MB - Tuscan A", properties, [stay("MB - Tuscan A")]), address);
    assert.ok(report.html.includes(address));
    assert.equal(report.html.includes("gri-address-hint"), false);
  });

  it("does not borrow the address saved for Tuscan A", () => {
    const address = "1000 Example Drive, Myrtle Beach, SC 29577";
    const properties: PropertyLike[] = [{ name: "Tuscan A", reportAddress: address }];
    const report = buildOwnerReport(owner, [stay("MB - Tuscan A")], [], settings, {
      reportKey: "gri",
      property: "MB - Tuscan A",
      year: 2026
    }, properties);
    assert.equal(griPropertyAddress("MB - Tuscan A", properties, []), "");
    assert.equal(report.html.includes(address), false);
    assert.ok(report.html.includes("gri-address-hint"));
    assert.ok(report.html.includes("MB - Tuscan A"));
  });

  it("opens the selected property when the saved name differs only by punctuation", () => {
    const address = "1463 Basin Trail, Murrells Inlet, South Carolina 29576, United States of America";
    const selected = stay("GC - 1463");
    const other = { ...stay("MB - 1552"), id: "other", totalPayout: 9000, accommodationFare: 9000 };
    const report = buildOwnerReport(owner, [selected, other], [], settings, {
      reportKey: "gri",
      property: "GC-1463",
      month: 11,
      year: 2026
    }, [{ name: "GC - 1463", reportAddress: address }]);
    assert.ok(report.html.includes(address));
    assert.ok(report.html.includes("$2,962.64"));
    assert.equal(report.html.includes("$9,000.00"), false);
    assert.equal(report.summary.grossPayout, 2962.64);
  });

  it("reads a Guesty address object from the reservation payload", () => {
    const row = normalizeReservation({
      "listing.nickname": { children: "NMB - 3104-2" },
      "listing.address.full": { children: guestyAddress },
      checkInDate: { value: "2026-11-14" },
      checkOutDate: { value: "2026-11-18" },
      status: { children: "confirmed" }
    });
    assert.equal(row.property, "NMB - 3104-2");
    assert.equal(row.listingAddress, guestyAddress);
  });
});
