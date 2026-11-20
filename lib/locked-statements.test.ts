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
  planSavedStatementBackfill,
  planUploadedPdfBackfill,
  relockStatement,
  unlockStatement,
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

describe("unlock and relock", () => {
  it("keeps the sent snapshot and records who unlocked it", () => {
    const sent = augustFinal();
    const unlocked = unlockStatement(sent, "admin@example.com", "2026-11-20T15:00:00.000Z");
    assert.equal(unlocked.audit.action, "unlock");
    assert.equal(unlocked.audit.who, "admin@example.com");
    assert.equal(unlocked.preserved.shareId, sent.shareId);
    assert.equal(unlocked.preserved.htmlSnapshot, sent.htmlSnapshot);
    assert.equal(unlocked.audit.before.totals.ownerPayout, sent.totals.ownerPayout);
    assert.equal(unlocked.audit.after.totals.ownerPayout, sent.totals.ownerPayout);
    assert.equal(unlocked.preserved.htmlSnapshot.includes(sent.htmlSnapshot.slice(0, 20)), true);
  });

  it("locks a new snapshot without replacing the sent link", () => {
    const sent = augustFinal();
    const unlocked = unlockStatement(sent, "admin@example.com", "2026-11-20T15:00:00.000Z");
    const nextTotals = { ...sent.totals, ownerPayout: sent.totals.ownerPayout + 25, netAccommodation: sent.totals.netAccommodation + 40 };
    const relocked = relockStatement(
      unlocked.preserved,
      {
        ...sent,
        shareId: "new-snapshot",
        htmlSnapshot: "<p>Recalculated</p>",
        totals: nextTotals,
        lockedAt: "2026-11-21T15:00:00.000Z",
        lockedBy: "admin@example.com"
      },
      "admin@example.com",
      "2026-11-21T15:00:00.000Z"
    );
    assert.equal(relocked.audit.action, "relock");
    assert.equal(relocked.preservedShareId, sent.shareId);
    assert.equal(relocked.lock.shareId, "new-snapshot");
    assert.equal(relocked.lock.htmlSnapshot, "<p>Recalculated</p>");
    assert.equal(unlocked.preserved.htmlSnapshot, sent.htmlSnapshot);
    assert.equal(relocked.audit.before.totals.ownerPayout, sent.totals.ownerPayout);
    assert.equal(relocked.audit.after.totals.ownerPayout, nextTotals.ownerPayout);
    assert.equal(relocked.audit.before.totals.netAccommodation, sent.totals.netAccommodation);
    assert.equal(relocked.audit.after.totals.netAccommodation, nextTotals.netAccommodation);
    assert.throws(() => relockStatement(unlocked.preserved, { ...sent, shareId: sent.shareId }, "admin@example.com", "2026-11-21T15:00:00.000Z"));
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
    assert.match(report.html, /Total from 1 of 12 final months/);
    assert.match(report.html, /11 months are not final, needs the sent statement/);
    assert.match(report.html, /Not final, needs the sent statement/);
    assert.equal(report.html.includes("Open January"), false);
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

  it("keeps a locked month and marks every other month as needing the sent statement", () => {
    const august = augustFinal();
    const liveJanuary: ExpenseLike = {
      ownerId: "jeff",
      property: "GC - 827B",
      type: "Pool Cleaning",
      amount: 999,
      month: 1,
      year: 2026
    };
    const report = buildOwnerReport(jeff, [], [liveJanuary], settings, {
      reportKey: "1099",
      year: 2026,
      lockedMonths: [
        {
          year: august.year,
          month: august.month,
          shareId: august.shareId,
          depositRecorded: august.depositRecorded,
          totals: august.totals
        }
      ]
    });
    assert.match(report.html, /Not final, needs the sent statement/);
    assert.equal(report.html.includes("Open January"), false);
    assert.match(report.html, /\$12,345\.26/);
    assert.equal(report.html.includes("$999.00"), false);
    assert.equal(report.summary.netToOwner, 12345.26);
    assert.equal(report.summary.missingMonths, 11);
  });

  it("does not recompute a year that has no locked statement", () => {
    const report = buildOwnerReport(
      jeff,
      [
        {
          id: "live-stay",
          property: "GC - 827B",
          guestName: "Guest",
          checkIn: "2026-03-04",
          checkOut: "2026-03-08",
          nights: 4,
          source: "airbnb",
          platform: "airbnb",
          confirmationCode: "LIVE",
          status: "confirmed",
          totalPayout: 8888.77,
          accommodationFare: 8888.77,
          cleaningFare: 0,
          markup: 0,
          channelCommission: 0,
          preCancellationHostPayout: 0,
          feeCreditCard: 0,
          lengthOfStayDiscount: 0,
          airbnbResolutionCenter: 0,
          manualTotalPayout: 8888.77,
          manualAccommodation: 8888.77,
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
        }
      ],
      [],
      settings,
      { reportKey: "1099", year: 2026, lockedMonths: [] }
    );
    assert.match(report.html, /No final statements yet/);
    assert.match(report.html, /Lock a month by emailing the statement or backfilling the sent statement/);
    assert.match(report.html, /Not final, needs the sent statement/);
    assert.equal(report.html.includes("Total from"), false);
    assert.equal(report.html.includes("$8,888.77"), false);
    assert.equal(report.html.includes("$0.00"), false);
    assert.equal(report.html.includes("—"), false);
    assert.equal(report.summary.netToOwner, 0);
    assert.equal(report.summary.missingMonths, 12);
  });

  it("shows the year total only when all 12 months are final", () => {
    const august = augustFinal();
    const lockedMonths = Array.from({ length: 12 }, (_, index) => ({
      year: 2026,
      month: index + 1,
      shareId: `month-${index + 1}`,
      depositRecorded: true,
      totals: index + 1 === august.month ? august.totals : { netAccommodation: 10, pmc: 1, expenses: 1, recurringCharges: 0, ownerPayout: 8 }
    }));
    const report = buildOwnerReport(jeff, [], [], settings, { reportKey: "1099", year: 2026, lockedMonths });
    assert.match(report.html, /Every month has an emailed final statement/);
    assert.equal(report.html.includes("Total from"), false);
    assert.equal(report.html.includes("No final statements yet"), false);
    assert.equal(report.html.includes("Not final"), false);
    assert.match(report.html, /\$12,345\.26/);
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

function sentStatementHtml(payout: string) {
  const line = (label: string, value: string) =>
    `<div class="statement-summary-line"><span>${label}</span><strong>${value}</strong></div>`;
  return [
    line("Total net accommodation", "$1,000.00"),
    line("Minus PMC", "$120.00"),
    line("Minus expenses", "$30.00"),
    line("Minus recurring charges", "$45.00"),
    line("Owner payout", payout)
  ].join("");
}

describe("backfill from sent statements", () => {
  const june = {
    ownerId: "jeff",
    ownerName: "827B - Jeff",
    periodLabel: "June 1 - June 30, 2026",
    htmlSnapshot: sentStatementHtml("$805.00")
  };

  it("locks the latest saved snapshot when every copy has the same totals", () => {
    const plans = planSavedStatementBackfill([
      { ...june, shareId: "early", createdAt: "2026-07-01T12:00:00.000Z" },
      { ...june, shareId: "late", createdAt: "2026-07-01T18:00:00.000Z" }
    ]);
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.action, "create");
    if (plans[0]?.action !== "create") return;
    assert.equal(plans[0].lock.shareId, "late");
    assert.equal(plans[0].lock.backfilled, true);
    assert.equal(plans[0].lock.sourceKind, "saved-report");
    assert.equal(plans[0].lock.sourceRef, "late");
    assert.equal(plans[0].lock.htmlSnapshot, june.htmlSnapshot);
    assert.equal(plans[0].lock.totals.ownerPayout, 805);
    assert.equal(plans[0].lock.totals.recurringCharges, 45);
    assert.equal(plans[0].lock.depositRecorded, true);
  });

  it("asks for a choice when saved snapshots for one month disagree", () => {
    const plans = planSavedStatementBackfill([
      { ...june, shareId: "early", createdAt: "2026-06-30T12:00:00.000Z" },
      { ...june, shareId: "later", createdAt: "2026-07-01T12:00:00.000Z", htmlSnapshot: sentStatementHtml("$700.00") }
    ]);
    assert.equal(plans[0]?.action, "choose");
    if (plans[0]?.action !== "choose") return;
    assert.deepEqual(
      plans[0].choices.map((choice) => choice.shareId),
      ["early", "later"]
    );
  });

  it("builds a locked snapshot from an uploaded PDF and refuses a PDF without the sent totals", () => {
    const ready = planUploadedPdfBackfill({
      ownerId: "jeff",
      ownerName: "827B - Jeff",
      year: 2026,
      month: 5,
      filename: "jeff-may-2026.pdf",
      text: "Total net accommodation $2,000.00\nMinus PMC $240.00\nMinus expenses $10.00\nMinus recurring charges $50.00\nOwner payout $1,700.00",
      lockedAt: "2026-06-02T00:00:00.000Z"
    });
    assert.equal(ready.action, "create");
    if (ready.action !== "create") return;
    assert.equal(ready.lock.backfilled, true);
    assert.equal(ready.lock.sourceKind, "uploaded-pdf");
    assert.equal(ready.lock.sourceRef, "jeff-may-2026.pdf");
    assert.equal(ready.lock.totals.ownerPayout, 1700);
    assert.match(ready.lock.htmlSnapshot, /Backfilled from uploaded-pdf: jeff-may-2026\.pdf/);
    const missing = planUploadedPdfBackfill({
      ownerId: "jeff",
      ownerName: "827B - Jeff",
      year: 2026,
      month: 4,
      filename: "notes.pdf",
      text: "This file has no statement totals."
    });
    assert.equal(missing.action, "unreadable");
  });
});
