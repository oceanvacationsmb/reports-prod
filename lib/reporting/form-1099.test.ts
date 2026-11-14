import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOwnerReport, recurringExpenses } from "@/lib/reporting/reports";
import type { AppSettings, OwnerLike } from "@/lib/types";

const settings: AppSettings = { guestyCacheTtlMinutes: 30, defaultCleaningCaps: [] };

const jeff: OwnerLike = {
  _id: "jeff",
  name: "827B - Jeff",
  type: "payout",
  percent: 0.12,
  properties: ["GC - 827B"],
  recurringCharges: [
    { label: "Pool Cleaning", amount: 250 },
    { label: "Pest Control", amount: 45 },
    { label: "Landscaping", amount: 45 }
  ]
};

describe("1099 recurring charges for 827B - Jeff", () => {
  it("counts each base recurring fee once per statement month", () => {
    const october = recurringExpenses(jeff, "2026-10-01", "2026-10-31");
    assert.deepEqual(
      october.map((charge) => ({ type: charge.type, amount: charge.amount, property: charge.property, month: charge.month })),
      [
        { type: "Pool Cleaning", amount: 250, property: "Recurring", month: 10 },
        { type: "Pest Control", amount: 45, property: "Recurring", month: 10 },
        { type: "Landscaping", amount: 45, property: "Recurring", month: 10 }
      ]
    );
    assert.equal(october.reduce((sum, charge) => sum + charge.amount, 0), 340);

    const year = buildOwnerReport(jeff, [], [], settings, { reportKey: "1099", year: 2026 });
    const again = buildOwnerReport(jeff, [], [], settings, { reportKey: "1099", year: 2026 });
    assert.equal(year.summary.expenses, 340 * 12);
    assert.equal(year.summary.netToOwner, -(340 * 12));
    assert.equal(again.summary.expenses, year.summary.expenses);
    assert.equal((year.html.match(/>\$340\.00</g) || []).length, 12);

    const statement = buildOwnerReport(jeff, [], [], settings, { reportKey: "statement", month: 10, year: 2026 });
    assert.equal(statement.summary.recurringCharges, 340);
  });
});
