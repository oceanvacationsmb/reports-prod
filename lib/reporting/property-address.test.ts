import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOwnerReport } from "@/lib/reporting/reports";
import { localityLine, postalAddressFromProperty, singleLineAddress } from "@/lib/reporting/property-address";
import type { AppSettings, NormalizedReservation, OwnerLike } from "@/lib/types";

describe("stored property address", () => {
  it("reads street, city, state, and ZIP from separate fields", () => {
    const address = postalAddressFromProperty({
      street: "10 Sample Street",
      city: "Sample City",
      state: "sc",
      postalCode: "29500",
      reportAddress: "Other Place"
    });
    assert.equal(address.street, "10 Sample Street");
    assert.equal(localityLine(address), "Sample City, sc 29500");
    assert.equal(singleLineAddress(address), "10 Sample Street, Sample City, sc 29500");
  });

  it("splits a single stored report address", () => {
    const address = postalAddressFromProperty({ reportAddress: "10 Sample Street, Sample City, SC 29500" });
    assert.deepEqual(address, { street: "10 Sample Street", city: "Sample City", state: "SC", postalCode: "29500" });
  });

  it("shows the stored parts on the GRI report", () => {
    const settings: AppSettings = { guestyCacheTtlMinutes: 30, defaultCleaningCaps: [] };
    const owner: OwnerLike = { _id: "owner", name: "Sample Owner", type: "payout", percent: 0.1, properties: ["Cottage"] };
    const stay: NormalizedReservation = {
      id: "stay",
      property: "Cottage",
      guestName: "Guest",
      checkIn: "2026-06-01",
      checkOut: "2026-06-04",
      nights: 3,
      source: "airbnb",
      platform: "airbnb",
      confirmationCode: "ABC",
      status: "confirmed",
      totalPayout: 100,
      accommodationFare: 100,
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
    const report = buildOwnerReport(owner, [stay], [], settings, { reportKey: "gri", property: "Cottage", year: 2026 }, [{
      name: "Cottage",
      street: "10 Sample Street",
      city: "Sample City",
      state: "SC",
      postalCode: "29500"
    }]);
    assert.match(report.html, /gri-street">10 Sample Street/);
    assert.match(report.html, /gri-locality">Sample City, SC 29500/);
    assert.equal(report.html.includes("gri-address-hint"), false);
  });
});
