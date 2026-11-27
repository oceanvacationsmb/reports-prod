import assert from "node:assert/strict";
import test from "node:test";
import { recurringExpenses } from "@/lib/reporting/reports";
import type { OwnerLike } from "@/lib/types";

const owner: OwnerLike = {
  name: "827",
  type: "draft",
  recurringCharges: [{ label: "Pest control", amount: 45 }],
  dateRangeRecurringCharges: [
    { label: "Pool cleaning", amount: 250, startDate: "2026-03-01", endDate: "2026-10-31", schedule: "annual" },
    { label: "Pool cleaning", amount: 150, startDate: "2026-11-01", endDate: "2027-02-28", schedule: "annual" },
    { label: "Landscaping", amount: 90, startDate: "2026-04-01", endDate: "2026-10-31", schedule: "annual" },
    { label: "Landscaping", amount: 45, startDate: "2026-11-01", endDate: "2027-03-31", schedule: "annual" }
  ]
};

test("827 has exactly three charges per month, including across New Year", () => {
  const rows = recurringExpenses(owner, "2028-01-01", "2028-12-31", true);
  assert.equal(rows.length, 36);
  for (let month = 1; month <= 12; month++) {
    const amounts = Object.fromEntries(rows.filter((row) => row.month === month).map((row) => [row.type, row.amount]));
    assert.deepEqual(amounts, {
      "Pest control": 45,
      "Pool cleaning": month >= 3 && month <= 10 ? 250 : 150,
      Landscaping: month >= 4 && month <= 10 ? 90 : 45
    });
  }
});

test("adjusting or removing a recurring charge only changes its statement month", () => {
  const start = "2026-01-01";
  const end = "2026-12-31";
  const rows = recurringExpenses(owner, start, end, true);
  const key = (month: number, label: string) =>
    rows.find((row) => row.month === month && row.type === label)!._id!.split(":")[1];
  const adjusted = {
    ...owner,
    recurringStatementOverrides: {
      [key(11, "Pool cleaning")]: { amount: 50 },
      [key(11, "Pest control")]: { deleted: true }
    }
  };
  const statement = recurringExpenses(adjusted, start, end, true);
  assert.equal(statement.find((row) => row.month === 10 && row.type === "Pool cleaning")?.amount, 250);
  assert.equal(statement.find((row) => row.month === 11 && row.type === "Pool cleaning")?.amount, 50);
  assert.equal(statement.find((row) => row.month === 12 && row.type === "Pool cleaning")?.amount, 150);
  assert.equal(statement.filter((row) => row.type === "Pest control").length, 11);
  assert.equal(recurringExpenses(adjusted, start, end).find((row) => row.month === 11 && row.type === "Pool cleaning")?.amount, 150);
});
