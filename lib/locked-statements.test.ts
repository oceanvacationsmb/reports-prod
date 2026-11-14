import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  backfillLock,
  linesForMonth,
  lockOnEmail,
  modifyLock,
  planBackfill,
  type FinalStatement,
  type StatementExpenseLine,
  type StatementLine,
  type StatementTotals
} from "@/lib/locked-statements";
import { buildOwnerReport } from "@/lib/reporting/reports";
import type { AppSettings, ExpenseLike, OwnerLike } from "@/lib/types";

const settings: AppSettings = { guestyCacheTtlMinutes: 30, defaultCleaningCaps: [] };

const augustFixture = JSON.parse(
  readFileSync(path.join(process.cwd(), "scripts/fixtures/jeff-827b-august-2026.json"), "utf8")
) as {
  ownerName: string;
  property: string;
  year: number;
  month: number;
  nights: number;
  propertyPayoutBeforeRecurring: number;
  sourceNote: string;
  recurring: StatementLine[];
  expenses: StatementExpenseLine[];
  totals: StatementTotals;
};

const currentBase: StatementLine[] = [
  { label: "Pool Cleaning", amount: 250 },
  { label: "Pest Control", amount: 45 },
  { label: "Landscaping", amount: 45 }
];

const jeff: OwnerLike = {
  _id: "jeff",
  name: "827B - Jeff",
  type: "payout",
  percent: 0.12,
  properties: ["GC - 827B"],
  recurringCharges: currentBase
};

function augustFinal(): FinalStatement {
  return backfillLock({
    ownerId: "jeff",
    ownerName: augustFixture.ownerName,
    property: augustFixture.property,
    year: augustFixture.year,
    month: augustFixture.month,
    shareId: "august-share",
    recurring: augustFixture.recurring,
    expenses: augustFixture.expenses,
    totals: augustFixture.totals,
    nights: augustFixture.nights,
    propertyPayoutBeforeRecurring: augustFixture.propertyPayoutBeforeRecurring,
    lockedAt: "2026-09-02T15:00:00.000Z",
    sourceNote: augustFixture.sourceNote
  });
}

describe("emailed statement locks", () => {
  it("saves the emailed August lines and ignores a later base-fee change", () => {
    const emailed = augustFinal();
    assert.equal(emailed.totals.recurringCharges, 285);
    assert.equal(emailed.totals.expenses, 523.98);
    assert.equal(emailed.totals.netAccommodation, 14948);
    assert.equal(emailed.totals.pmc, 1793.76);
    assert.equal(emailed.totals.ownerPayout, 12345.26);
    assert.equal(emailed.depositRecorded, true);
    assert.equal(emailed.htmlSnapshot.includes("Nights: 21"), true);
    assert.match(emailed.htmlSnapshot, /\$12,630\.26/);
    assert.match(emailed.htmlSnapshot, /\$12,345\.26/);
    assert.match(emailed.htmlSnapshot, /\$523\.98/);
    assert.deepEqual(
      linesForMonth(currentBase, emailed).map((line) => line.amount),
      [150, 45, 90]
    );
    assert.equal(emailed.htmlSnapshot.includes("$250.00"), false);
    assert.match(emailed.htmlSnapshot, /\$150\.00/);
    assert.match(emailed.htmlSnapshot, /\$90\.00/);
    assert.match(emailed.htmlSnapshot, /\$285\.00/);
  });

  it("leaves an unsent month on the current base fees", () => {
    assert.deepEqual(
      linesForMonth(currentBase, null).map((line) => line.amount),
      [250, 45, 45]
    );
  });

  it("keeps the first emailed link when Email owner is clicked again", () => {
    const first = lockOnEmail(null, {
      ...augustFinal(),
      htmlSnapshot: "<p>August email</p>"
    });
    const second = lockOnEmail(first.record, {
      ...augustFinal(),
      shareId: "new-share",
      htmlSnapshot: "<p>Changed draft</p>",
      recurring: currentBase
    });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.record.shareId, "august-share");
    assert.equal(second.record.htmlSnapshot, "<p>August email</p>");
    assert.deepEqual(
      second.record.recurring.map((line) => line.amount),
      [150, 45, 90]
    );
  });

  it("audits Modify, keeps the same link, and stores the earlier lines", () => {
    const existing = augustFinal();
    const edited = modifyLock(
      existing,
      {
        recurring: currentBase,
        expenses: [],
        totals: { ...existing.totals, recurringCharges: 340, ownerPayout: 8627.2 },
        htmlSnapshot: "<p>Modified August</p>",
        depositRecorded: true
      },
      "dad@oceanvacationsmb.com",
      "2026-11-14T12:00:00.000Z"
    );
    assert.equal(edited.lock.shareId, existing.shareId);
    assert.equal(edited.lock.locked, true);
    assert.equal(edited.lock.lockedAt, existing.lockedAt);
    assert.equal(edited.audit.action, "modify");
    assert.equal(edited.audit.who, "dad@oceanvacationsmb.com");
    assert.equal(edited.audit.when, "2026-11-14T12:00:00.000Z");
    assert.deepEqual(
      edited.audit.before.recurring.map((line) => line.amount),
      [150, 45, 90]
    );
    assert.deepEqual(
      edited.audit.after.recurring.map((line) => line.amount),
      [250, 45, 45]
    );
    assert.equal(edited.audit.before.htmlSnapshot, existing.htmlSnapshot);
    assert.equal(edited.lock.htmlSnapshot, "<p>Modified August</p>");
  });

  it("does not replace a month that is already final", () => {
    const plan = planBackfill({ shareId: "already" }, {
      ownerId: "jeff",
      ownerName: augustFixture.ownerName,
      year: 2026,
      month: 8,
      shareId: "new",
      recurring: augustFixture.recurring,
      lockedAt: "2026-09-02T15:00:00.000Z"
    });
    assert.equal(plan.action, "skip");
    if (plan.action === "skip") assert.equal(plan.shareId, "already");
  });
});

describe("1099 from emailed finals", () => {
  it("uses the August deposit and flags months with no final", () => {
    const august = augustFinal();
    const liveExpense: ExpenseLike = {
      ownerId: "jeff",
      property: "GC - 827B",
      type: "Pool Cleaning",
      amount: 340,
      month: 8,
      year: 2026
    };
    const report = buildOwnerReport(jeff, [], [liveExpense], settings, {
      reportKey: "1099",
      year: 2026,
      lockedMonths: [
        {
          year: august.year,
          month: august.month,
          shareId: august.shareId,
          depositRecorded: august.depositRecorded,
          totals: august.totals
        },
        {
          year: august.year,
          month: august.month,
          shareId: "duplicate",
          depositRecorded: true,
          totals: { ...august.totals, recurringCharges: 340, ownerPayout: 1 }
        }
      ]
    });
    assert.match(report.html, /No final statement: January, February, March, April, May, June, July, September, October, November, December/);
    assert.match(report.html, /\$12,345\.26/);
    assert.equal(report.html.includes("$340.00"), false);
    assert.equal(report.html.includes("Deposit not recorded"), false);
    assert.equal(report.summary.netToOwner, 12345.26);
    assert.equal(report.summary.netAccommodation, 14948);
    assert.equal(report.summary.pmc, 1793.76);
    assert.equal(report.summary.expenses, 808.98);
    assert.equal(report.summary.missingMonths, 11);
  });

  it("leaves a saved fee list out of the 1099 total when the deposit was not recorded", () => {
    const feesOnly = backfillLock({
      ownerId: "jeff",
      ownerName: "827B - Jeff",
      year: 2026,
      month: 4,
      shareId: "fees-only",
      recurring: [{ label: "Pool Cleaning", amount: 125 }],
      lockedAt: "2026-05-02T15:00:00.000Z"
    });
    const report = buildOwnerReport(jeff, [], [], settings, {
      reportKey: "1099",
      year: 2026,
      lockedMonths: [
        {
          year: feesOnly.year,
          month: feesOnly.month,
          shareId: feesOnly.shareId,
          depositRecorded: feesOnly.depositRecorded,
          totals: feesOnly.totals
        }
      ]
    });
    assert.equal(feesOnly.depositRecorded, false);
    assert.match(report.html, /Deposit not recorded/);
    assert.equal(report.summary.netToOwner, 0);
  });

  it("still builds a draft statement from the current base fees", () => {
    const report = buildOwnerReport(jeff, [], [], settings, {
      reportKey: "statement",
      year: 2026,
      month: 11
    });
    assert.equal(report.summary.recurringCharges, 340);
    const corrected = buildOwnerReport(jeff, [], [], settings, {
      reportKey: "statement",
      year: 2026,
      month: 8,
      readOnly: true,
      recurringOverride: augustFixture.recurring
    });
    assert.equal(corrected.summary.recurringCharges, 285);
    assert.equal(String(corrected.html).includes("$250.00"), false);
  });
});
