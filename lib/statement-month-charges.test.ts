import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { linesForMonth } from "@/lib/locked-statements";
import { buildOwnerReport } from "@/lib/reporting/reports";
import { applyMonthChargeChange, settingsChargesForMonth } from "@/lib/statement-month-charges";
import type { AppSettings, OwnerLike } from "@/lib/types";

const settings: AppSettings = { guestyCacheTtlMinutes: 30, defaultCleaningCaps: [] };

function sampleOwner(): OwnerLike {
  return {
    name: "Sample Owner",
    type: "payout",
    percent: 0.12,
    properties: ["Sample Cottage"],
    recurringCharges: [{ label: "Pool care", amount: 100 }],
    monthlyRecurringCharges: [],
    specificDateRecurringCharges: [{ label: "Leaf cleanup", amount: 15, month: 11, day: 15 }],
    dateRangeRecurringCharges: []
  };
}

function statement(owner: OwnerLike, month: number, recurringOverride?: { id?: string; label: string; amount: number }[]) {
  return buildOwnerReport(owner, [], [], settings, {
    reportKey: "statement",
    month,
    year: 2026,
    ...(recurringOverride ? { recurringOverride } : {})
  });
}

describe("statement month charges", () => {
  it("keeps a November edit off October, December, and the owner settings", () => {
    const owner = sampleOwner();
    const before = JSON.stringify(owner);
    const october = settingsChargesForMonth(owner, 2026, 10);
    const november = settingsChargesForMonth(owner, 2026, 11);
    const december = settingsChargesForMonth(owner, 2026, 12);

    assert.deepEqual(october.map((line) => line.label), ["Pool care"]);
    assert.deepEqual(december.map((line) => line.label), ["Pool care"]);
    assert.deepEqual(november.map((line) => line.label), ["Pool care", "Leaf cleanup"]);

    const edited = applyMonthChargeChange(november, { id: november[0].id, label: "Pool care", amount: 40 });
    const removed = applyMonthChargeChange(edited, { id: edited[1].id, remove: true });
    const added = applyMonthChargeChange(removed, { add: true, label: "Snow shovel", amount: 12 });

    assert.equal(JSON.stringify(owner), before);
    assert.equal(november[0].amount, 100);
    assert.equal(november.length, 2);
    assert.deepEqual(settingsChargesForMonth(owner, 2026, 10), october);
    assert.deepEqual(settingsChargesForMonth(owner, 2026, 12), december);
    assert.deepEqual(
      added.map((line) => [line.label, line.amount]),
      [
        ["Pool care", 40],
        ["Snow shovel", 12]
      ]
    );

    assert.equal(statement(owner, 11, added).summary.recurringCharges, 52);
    assert.equal(statement(owner, 10).summary.recurringCharges, 100);
    assert.equal(statement(owner, 12).summary.recurringCharges, 100);
    const year = buildOwnerReport(owner, [], [], settings, {
      reportKey: "statement",
      year: 2026,
      monthChargeOverrides: { 11: added }
    });
    assert.equal(year.summary.recurringCharges, 1152);
    assert.match(statement(owner, 11, added).html, /data-report-id="[^"]*monthCharge:/);
    assert.doesNotMatch(statement(owner, 10).html, /monthCharge:/);
  });

  it("leaves a locked month on the charges that were sent", () => {
    const owner = sampleOwner();
    const sentOctober = { locked: true as const, recurring: [{ label: "Pool care", amount: 100 }] };
    const november = settingsChargesForMonth(owner, 2026, 11);
    const edited = applyMonthChargeChange(november, { id: november[0].id, label: "Pool care", amount: 40 });
    owner.recurringCharges = [{ label: "Pool care", amount: 80 }];

    const lockedLines = linesForMonth(settingsChargesForMonth(owner, 2026, 10), sentOctober);
    assert.equal(lockedLines[0].amount, 100);
    assert.equal(JSON.stringify(sentOctober.recurring), JSON.stringify([{ label: "Pool care", amount: 100 }]));
    assert.equal(statement(owner, 12).summary.recurringCharges, 80);
    assert.equal(statement(owner, 10).summary.recurringCharges, 80);
    assert.equal(statement(owner, 11, edited).summary.recurringCharges, 55);
  });

  it("does not write statement edits back to the owner record", () => {
    const route = readFileSync(new URL("../app/api/statement-items/route.ts", import.meta.url), "utf8");
    const store = readFileSync(new URL("./locked-statement-store.ts", import.meta.url), "utf8");
    assert.equal(route.includes("owner.save"), false);
    assert.equal(route.includes("markModified"), false);
    assert.equal(route.includes("recurringCharges"), false);
    assert.equal(store.includes("owner.save"), false);
    assert.equal(store.includes("markModified"), false);
  });
});
