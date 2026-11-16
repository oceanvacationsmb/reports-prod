import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPropertyTaxReport } from "@/lib/reporting/report-taxes";
import type { AppSettings, NormalizedReservation, OwnerLike, PropertyLike } from "@/lib/types";

const settings: AppSettings = { guestyCacheTtlMinutes: 30, defaultCleaningCaps: [] };

function stay(values: Partial<NormalizedReservation> & Pick<NormalizedReservation, "id" | "property" | "source" | "platform" | "totalPayout" | "rowTaxTotal">): NormalizedReservation {
  return {
    guestName: "Guest",
    checkIn: "2026-10-09",
    checkOut: "2026-10-17",
    nights: 8,
    confirmationCode: values.id,
    status: "confirmed",
    accommodationFare: 0,
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

function owner(id: string, name: string, properties: string[]): OwnerLike {
  return { _id: id, name, type: "payout", percent: 0.12, properties };
}

function flags(values: Record<string, boolean>) {
  return { SC: false, MB: false, NMB: false, SSB: false, HC: false, GTC: false, ...values };
}

const properties: PropertyLike[] = [
  { name: "MB - 1552", taxFlags: flags({ SC: true, MB: true, HC: true }) },
  { name: "NMB - 3104-1", taxFlags: flags({ SC: true, NMB: true, HC: true }) },
  { name: "NMB - 3104-2", taxFlags: flags({ SC: true, NMB: true, HC: true }) },
  { name: "GCSSB - 113B-13N", taxFlags: flags({ SC: true, SSB: true, HC: true }) },
  { name: "GC - 827B", taxFlags: flags({ SC: true, HC: true }) },
  { name: "GC - 1463", taxFlags: flags({ SC: true, GTC: true }) }
];

describe("property tax report", () => {
  it("keeps October NMB - 3104-2 at gross minus tax, separate from GC - 1463", () => {
    const jacob = owner("jacob", "3104 - RIVER", ["NMB - 3104-2", "NMB - 3104-1"]);
    const nicole = owner("nicole", "1463 - CASEY", ["GC - 1463"]);
    const report = buildPropertyTaxReport(
      [nicole, jacob, { _id: "all", name: "ALL PROPERTIES", type: "payout", percent: 0 }],
      new Map([
        [
          "jacob",
          [
            stay({
              id: "harbor-stay",
              property: "NMB - 3104-2",
              guestName: "Casey Guest",
              source: "VRBO",
              platform: "HomeAway",
              totalPayout: 3343.56,
              accommodationFare: 2000,
              cleaningFare: 500,
              rowTaxTotal: 335.56,
              taxCity: 37.5,
              taxState: 210.56,
              taxCounty: 37.5,
              taxOccupancy: 50
            }),
            stay({
              id: "airbnb-zero-tax",
              property: "NMB - 3104-1",
              source: "airbnb2",
              platform: "Airbnb",
              totalPayout: 1200,
              rowTaxTotal: 0,
              checkIn: "2026-10-02"
            }),
            stay({
              id: "september",
              property: "NMB - 3104-2",
              source: "VRBO",
              platform: "HomeAway",
              totalPayout: 999,
              rowTaxTotal: 99,
              checkIn: "2026-09-20"
            }),
            stay({
              id: "canceled",
              property: "NMB - 3104-2",
              source: "VRBO",
              platform: "HomeAway",
              totalPayout: 0,
              rowTaxTotal: 0,
              status: "canceled",
              checkIn: "2026-10-01"
            })
          ]
        ],
        [
          "nicole",
          [
            stay({
              id: "nicole-vrbo",
              property: "GC - 1463",
              source: "VRBO",
              platform: "HomeAway",
              totalPayout: 3458.56,
              rowTaxTotal: 370.56,
              manualAccommodation: 2443.64
            })
          ]
        ],
        [
          "all",
          [
            stay({
              id: "harbor-stay",
              property: "NMB - 3104-2",
              source: "VRBO",
              platform: "HomeAway",
              totalPayout: 3343.56,
              rowTaxTotal: 335.56
            })
          ]
        ]
      ]),
      settings,
      10,
      2026,
      properties
    );

    const nmb = report.groups.find((group) => group.destination === "SC, NMB, HORRY");
    const gtc = report.groups.find((group) => group.destination === "SC, GTC");
    const unit = nmb?.rows.find((row) => row.property === "NMB - 3104-2");
    const garden = gtc?.rows.find((row) => row.property === "GC - 1463");

    assert.equal(unit?.amountToReport, 3008);
    assert.equal(unit?.totalTax, 335.56);
    assert.notEqual(unit?.amountToReport, 3088);
    assert.equal(garden?.amountToReport, 3088);
    assert.equal(garden?.totalTax, 370.56);
    assert.equal(nmb?.rows.find((row) => row.property === "NMB - 3104-1")?.amountToReport, 0);
    assert.equal(report.amountToReport, 6096);
    assert.equal(report.totalTax, 706.12);
    assert.equal(report.reservationsUsed, 3);
    assert.equal(report.properties, properties.length);
    assert.deepEqual(
      report.groups.map((group) => group.destination),
      ["SC, MB, HORRY", "SC, NMB, HORRY", "SC, SSB, HORRY", "SC, HORRY", "SC, GTC"]
    );
  });

  it("counts a shared reservation once and uses a saved municipality", () => {
    const first = owner("a", "Alpha Owner", ["NMB - 3104-2"]);
    const second = owner("b", "Beta Owner", ["NMB - 3104-2"]);
    const report = buildPropertyTaxReport(
      [second, first],
      new Map([
        ["b", [stay({ id: "same-stay", property: "NMB - 3104-2", source: "VRBO", platform: "HomeAway", totalPayout: 3343.56, rowTaxTotal: 335.56 })]],
        ["a", [stay({ id: "same-stay", property: "NMB - 3104-2", source: "VRBO", platform: "HomeAway", totalPayout: 3343.56, rowTaxTotal: 335.56 })]]
      ]),
      settings,
      10,
      2026,
      [{ name: "NMB - 3104-2", municipality: "SC, NMB, HORRY", taxFlags: flags({ SC: true, GTC: true }) }]
    );

    assert.equal(report.reservationsUsed, 1);
    assert.equal(report.amountToReport, 3008);
    assert.equal(report.groups[0]?.destination, "SC, NMB, HORRY");
    assert.equal(report.groups[0]?.rows[0]?.totalTax, 335.56);
  });
});
