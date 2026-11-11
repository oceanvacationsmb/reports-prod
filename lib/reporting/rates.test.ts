import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateReservation, pmcPercent } from "@/lib/reporting/formulas";
import {
  RateInputError,
  normalizeOwnerRateInput,
  percentPointsFromInput,
  pmcFractionFromInput,
  storedPmcFraction
} from "@/lib/reporting/rates";
import type { AppSettings, NormalizedReservation, OwnerLike } from "@/lib/types";

const settings: AppSettings = { guestyCacheTtlMinutes: 30, defaultCleaningCaps: [] };

function stay(net: number): NormalizedReservation {
  return {
    id: `stay-${net}`,
    property: "NMB - 1501",
    guestName: "Test",
    checkIn: "2026-11-17",
    checkOut: "2026-11-22",
    nights: 5,
    source: "airbnb",
    platform: "airbnb",
    confirmationCode: "TEST",
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

function owner(percent: number): OwnerLike {
  return { name: "SSK G REALTY LLC", type: "payout", percent };
}

describe("PMC rate input", () => {
  it("keeps stored fractions and converts percent-style entries to the same fraction", () => {
    assert.equal(pmcFractionFromInput(0.12), 0.12);
    assert.equal(pmcFractionFromInput("0.12"), 0.12);
    assert.equal(pmcFractionFromInput(0.1), 0.1);
    assert.equal(pmcFractionFromInput(0.15), 0.15);
    assert.equal(pmcFractionFromInput(1), 1);
    assert.equal(pmcFractionFromInput(12), 0.12);
    assert.equal(pmcFractionFromInput("12"), 0.12);
    assert.equal(pmcFractionFromInput("12%"), 0.12);
    assert.equal(pmcFractionFromInput("1%"), 0.01);
    assert.equal(pmcFractionFromInput("100%"), 1);
    assert.equal(storedPmcFraction(0.12), 0.12);
    assert.equal(storedPmcFraction(0.15), 0.15);
    assert.equal(storedPmcFraction(12), 0.12);
    assert.equal(storedPmcFraction(15), 0.15);
  });

  it("rejects a rate above 100%", () => {
    assert.throws(() => pmcFractionFromInput(101), RateInputError);
    assert.throws(() => pmcFractionFromInput("120%"), RateInputError);
    assert.throws(() => pmcFractionFromInput(-1), RateInputError);
  });

  it("leaves sales fee and split percents on the percent-point scale", () => {
    assert.equal(percentPointsFromInput(5, "Sales fee percent"), 5);
    assert.equal(percentPointsFromInput("12%", "Sales fee percent"), 12);
    assert.equal(percentPointsFromInput(50, "Split owner percent"), 50);
    assert.throws(() => percentPointsFromInput(120, "Sales fee percent"), RateInputError);
    const normalized = normalizeOwnerRateInput({ percent: "12%", salesFeePercent: "5%", splitOwnerPercent: 50 });
    assert.deepEqual(normalized, { percent: 0.12, salesFeePercent: 5, splitOwnerPercent: 50 });
  });

  it("charges 12% whether the stored PMC rate is 0.12 or 12", () => {
    const row = stay(10190);
    const fromFraction = calculateReservation(row, owner(0.12), settings);
    const fromWholeNumber = calculateReservation(row, owner(12), settings);
    const fromExistingFifteen = calculateReservation(stay(1000), owner(0.15), settings);
    assert.equal(fromFraction.pmc, 1222.8);
    assert.equal(fromWholeNumber.pmc, 1222.8);
    assert.equal(fromFraction.ownerPayout, 10190 - 1222.8);
    assert.equal(pmcPercent(owner(0.12)), 0.12);
    assert.equal(pmcPercent(owner(12)), 0.12);
    assert.equal(fromExistingFifteen.pmc, 150);
    assert.ok(Math.abs(pmcPercent({ name: "Split", type: "split", splitOwnerPercent: 80, percent: 12 }) - 0.2) < 0.000001);
  });
});
