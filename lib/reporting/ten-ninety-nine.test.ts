import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StatementTotals } from "@/lib/locked-statements";
import { buildOwnerReport } from "@/lib/reporting/reports";
import { annual1099Rows, buildAnnual1099, buildOwner1099, reportingAmount } from "@/lib/reporting/ten-ninety-nine";
import { workbookXlsx } from "@/lib/reporting/xlsx-workbook";
import type { AppSettings, OwnerLike } from "@/lib/types";

const settings: AppSettings = { guestyCacheTtlMinutes: 30, defaultCleaningCaps: [], tenNinetyNineBasis: "ownerPayout" };

function totals(ownerPayout: number, netAccommodation = ownerPayout + 20): StatementTotals {
  return { netAccommodation, pmc: 10, expenses: 5, recurringCharges: 5, ownerPayout };
}

const owner: OwnerLike = {
  _id: "owner-1",
  name: "Sample Owner",
  type: "payout",
  percent: 0.1,
  properties: ["Cottage", "Cottage"]
};

describe("1099 reconciliation", () => {
  it("uses locked statement amounts, flags a missing month, and ignores a duplicate", () => {
    const report = buildOwner1099({
      ownerId: "owner-1",
      ownerName: "Sample Owner",
      properties: owner.properties,
      year: 2026,
      basis: "ownerPayout",
      finals: [
        { year: 2026, month: 1, shareId: "jan", depositRecorded: true, totals: totals(100, 180) },
        { year: 2026, month: 1, shareId: "jan-duplicate", depositRecorded: true, totals: totals(999, 999) },
        { year: 2026, month: 3, shareId: "mar", depositRecorded: true, totals: totals(40, 70) }
      ]
    });
    assert.deepEqual(report.properties, ["Cottage"]);
    assert.equal(report.months[0]?.reportingAmount, 100);
    assert.equal(report.months[1]?.status, "missing");
    assert.equal(report.months[1]?.reportingAmount, null);
    assert.equal(report.months[2]?.reportingAmount, 40);
    assert.equal(report.finalCount, 2);
    assert.equal(report.annualTotal, 140);
    assert.deepEqual(report.missingMonths, ["February", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);

    const htmlReport = buildOwnerReport(owner, [], [], settings, {
      reportKey: "1099",
      year: 2026,
      tenNinetyNineBasis: "ownerPayout",
      lockedMonths: [
        { year: 2026, month: 1, shareId: "jan", depositRecorded: true, totals: totals(100, 180) },
        { year: 2026, month: 1, shareId: "jan-duplicate", depositRecorded: true, totals: totals(999, 999) }
      ]
    });
    assert.match(htmlReport.html, /Owner payout on the locked statement/);
    assert.match(htmlReport.html, /Not final, needs the sent statement/);
    assert.match(htmlReport.html, /Properties: Cottage/);
    assert.equal(htmlReport.html.includes("$999.00"), false);
    assert.equal(htmlReport.html.includes("$0.00"), false);
    assert.match(htmlReport.html, /\$100\.00/);
    assert.equal(htmlReport.summary.netToOwner, 100);
  });

  it("can report gross rents from the same locked statements", () => {
    const payout = buildOwner1099({
      ownerId: "owner-1",
      ownerName: "Sample Owner",
      properties: ["Cottage"],
      year: 2026,
      basis: "ownerPayout",
      finals: [{ year: 2026, month: 8, shareId: "aug", depositRecorded: true, totals: totals(80, 150) }]
    });
    const gross = buildOwner1099({ ...payout, basis: "grossRents", properties: ["Cottage"], ownerId: "owner-1", ownerName: "Sample Owner", year: 2026, finals: [{ year: 2026, month: 8, shareId: "aug", depositRecorded: true, totals: totals(80, 150) }] });
    assert.equal(reportingAmount(totals(80, 150), "ownerPayout"), 80);
    assert.equal(reportingAmount(totals(80, 150), "grossRents"), 150);
    assert.equal(payout.annualTotal, 80);
    assert.equal(gross.annualTotal, 150);
    const annual = buildAnnual1099(2026, [gross], "grossRents");
    const file = workbookXlsx(annual1099Rows(annual));
    const text = file.toString("utf8");
    assert.match(text, /150\.00/);
    assert.match(text, /Not final - no locked statement/);
    assert.match(text, /Gross rents/);
    assert.equal(text.includes("999"), false);
  });
});
