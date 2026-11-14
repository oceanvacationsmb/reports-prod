import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMonthlyPackets } from "@/lib/tax/packets";
import {
  computeGeorgetown,
  computeSurfside,
  isSundayOrUspsHoliday,
  lineAmount,
  rollToOpenPostOfficeDay,
  surfsideDeadline
} from "@/lib/tax/official-forms";
import { addDays, weekday } from "@/lib/tax/money";
import { emptyCompany } from "@/lib/tax/setup";
import { importFlaggedProperties, mergePropertyNames, parsePropertyList } from "@/lib/tax/rosters";

describe("official tax form amounts", () => {
  it("computes Surfside check from the 2026 form rates and timely discount", () => {
    const result = computeSurfside({ year: 2026, month: 1, rentalGross: 1000, asOf: "2026-02-01" });
    assert.equal(surfsideDeadline(2026, 1), "2026-02-20");
    assert.equal(lineAmount(result, "5"), 10);
    assert.equal(lineAmount(result, "7"), 0.2);
    assert.equal(lineAmount(result, "8"), 9.8);
    assert.equal(lineAmount(result, "9"), 5);
    assert.equal(lineAmount(result, "11"), 0.1);
    assert.equal(lineAmount(result, "12"), 4.9);
    assert.equal(result.remittance.checkAmount, 14.7);
    assert.equal(result.remittance.noCheckNeeded, false);
    assert.equal(result.remittance.payee, "Town of Surfside Beach");
    assert.deepEqual(result.remittance.mailingAddress, ["Town of Surfside Beach", "210 US Hwy 17 S", "Surfside Beach, SC 29575"]);
    assert.match(result.remittance.deadlineSource, /20th day following the close of the period/);
    assert.match(result.remittance.addressSource, /DocumentCenter\/View\/4894/);
  });

  it("says no check is needed when Surfside amount due is zero", () => {
    const result = computeSurfside({ year: 2026, month: 1, rentalGross: 0, asOf: "2026-02-01" });
    assert.equal(result.remittance.checkAmount, 0);
    assert.equal(result.remittance.paymentLabel, "No check needed");
  });

  it("drops the Surfside discount and adds the printed penalty after the postmark date", () => {
    const result = computeSurfside({ year: 2026, month: 1, rentalGross: 1000, asOf: "2026-02-21" });
    assert.equal(lineAmount(result, "7"), 0);
    assert.equal(lineAmount(result, "6"), 0.5);
    assert.equal(lineAmount(result, "10"), 0.25);
  });

  it("computes Georgetown accommodation tax at 3% and names the printed payee", () => {
    const result = computeGeorgetown({ year: 2026, month: 1, rentalGross: 2000, asOf: "2026-02-01" });
    assert.equal(lineAmount(result, "8"), 60);
    assert.equal(result.remittance.checkAmount, 60);
    assert.equal(result.remittance.payee, "Georgetown County");
    assert.deepEqual(result.remittance.mailingAddress, [
      "Georgetown County Finance Dept.",
      "P.O. Box 421270",
      "Georgetown, SC 29442"
    ]);
    assert.match(result.remittance.payeeSource, /Make Check Payable To: Georgetown County/);
    assert.match(result.remittance.addressSource, /DocumentCenter\/View\/573/);
    assert.match(result.notes.join(" "), /ST-388/);
  });

  it("moves a Georgetown postmark off Sunday or a postal holiday and leaves Surfside on the form date", () => {
    let sunday = "";
    for (let day = 0; day < 370; day += 1) {
      const iso = addDays("2026-01-01", day);
      if (weekday(iso) === 0) {
        sunday = iso;
        break;
      }
    }
    const rolled = rollToOpenPostOfficeDay(sunday);
    assert.equal(weekday(sunday), 0);
    assert.notEqual(rolled, sunday);
    assert.notEqual(weekday(rolled), 0);
    assert.equal(isSundayOrUspsHoliday("2026-07-03"), true);
    assert.equal(surfsideDeadline(2026, 1), "2026-02-20");
  });

  it("lists zero-income properties and ignores properties that are not on the roster", () => {
    const built = buildMonthlyPackets({
      year: 2026,
      month: 3,
      asOf: "2026-04-01",
      company: { ...emptyCompany(), legalName: "Ocean Vacations" },
      rosters: { surfside: ["Quiet House", "Busy House"], georgetown: ["Inlet House"] },
      figures: [
        { property: "busy house", amountToReport: 500, taxesCollected: 40 },
        { property: "Other Town", amountToReport: 900, taxesCollected: 70 }
      ]
    });
    const surfside = built.packets[0];
    assert.deepEqual(
      surfside.properties.map((property) => [property.property, property.grossReceipts]),
      [
        ["Busy House", 500],
        ["Quiet House", 0]
      ]
    );
    assert.equal(lineAmount(surfside.computation, "2"), 500);
    assert.match(surfside.previewHtml, /Quiet House/);
    assert.match(surfside.previewHtml, /No check needed|Check amount/);
    assert.doesNotMatch(surfside.previewHtml, /Other Town/);
    assert.match(built.packets[1].previewHtml, /No check needed/);
  });
});

describe("portal property lists", () => {
  it("imports saved flag lists and pastes without duplicates", () => {
    const imported = importFlaggedProperties(
      [
        { name: "MB House", taxFlags: { MB: true, SC: true } },
        { name: "GTC House", taxFlags: { GTC: true } },
        { name: "mb house", taxFlags: { MB: true } }
      ],
      "MB"
    );
    assert.deepEqual(imported, ["MB House"]);
    const pasted = parsePropertyList("MB House\nPier House\nMB House");
    assert.deepEqual(mergePropertyNames(imported, pasted), ["MB House", "Pier House"]);
  });
});
