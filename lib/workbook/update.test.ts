import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { updateWorkbookGrid, type CellValue } from "@/lib/workbook/update";
import { updateXlsxWorkbook } from "@/lib/workbook/xlsx";

const mapping = {
  sheetName: "Payouts",
  headerRow: 1,
  columns: { owner: "A", month: "B", property: "C", ownerPayout: "D", cleaningTransfer: "E" }
};

describe("workbook updates", () => {
  it("writes matching payout and cleaning cells once, and flags everything else", () => {
    const rows: CellValue[][] = [
      ["Owner", "Month", "Property", "Payout", "Cleaning", "Note"],
      ["Ada Owner", "February 2026", "Beach House", 1, 1, "keep"],
      ["Ada Owner", "February 2026", "Beach House", 1, 1, "duplicate"],
      ["Bea Owner", "2026-02", "Quiet House", { formula: "D2" }, 0, "formula"],
      ["Cara Owner", "March 2026", "Other", 9, 9, "other month"]
    ];
    const first = updateWorkbookGrid({
      rows,
      mapping,
      entries: [
        { owner: "ada owner", year: 2026, month: 2, property: "Beach House", ownerPayout: 80, cleaning: 15 },
        { owner: "Bea Owner", year: 2026, month: 2, property: "Quiet House", ownerPayout: 0, cleaning: 5 },
        { owner: "Missing", year: 2026, month: 2, property: "Gone", ownerPayout: 10, cleaning: 1 }
      ]
    });
    assert.equal(first.rows.length, rows.length);
    assert.equal(first.rows[4][3], 9);
    assert.equal(first.rows[0][5], "Note");
    assert.equal(first.ambiguous.length, 1);
    assert.equal(first.unmatched[0].property, "Gone");
    assert.equal(first.rows[3][4], 5);
    assert.equal((first.rows[3][3] as { formula: string }).formula, "D2");
    assert.equal(first.skippedFormulas.length, 1);
    const second = updateWorkbookGrid({ rows: first.rows, mapping, entries: first.updated.map((row) => ({
      owner: row.owner,
      year: 2026,
      month: 2,
      property: row.property,
      ownerPayout: row.ownerPayout,
      cleaning: row.cleaning
    })) });
    assert.equal(second.rows.length, first.rows.length);
    assert.equal(second.rows[3][4], 5);
  });

  it("updates an xlsx file without adding rows or clearing an unrelated formula", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Payouts");
    sheet.addRow(["Owner", "Month", "Property", "Payout", "Cleaning"]);
    sheet.addRow(["Ada Owner", "February 2026", "Beach House", 1, 1]);
    sheet.getCell("F2").value = { formula: "1+1", result: 2 };
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const updated = await updateXlsxWorkbook({
      bytes,
      mapping,
      entries: [{ owner: "Ada Owner", year: 2026, month: 2, property: "Beach House", ownerPayout: 42.5, cleaning: 7 }]
    });
    const again = new ExcelJS.Workbook();
    await again.xlsx.load(updated.bytes as unknown as ExcelJS.Buffer);
    const next = again.getWorksheet("Payouts");
    assert.ok(next);
    assert.equal(next.rowCount, 2);
    assert.equal(next.getCell("D2").value, 42.5);
    assert.equal(next.getCell("E2").value, 7);
    assert.equal(next.getCell("F2").formula, "1+1");
    const rerun = await updateXlsxWorkbook({
      bytes: updated.bytes,
      mapping,
      entries: [{ owner: "Ada Owner", year: 2026, month: 2, property: "Beach House", ownerPayout: 42.5, cleaning: 7 }]
    });
    const rerunBook = new ExcelJS.Workbook();
    await rerunBook.xlsx.load(rerun.bytes as unknown as ExcelJS.Buffer);
    assert.equal(rerunBook.getWorksheet("Payouts")?.rowCount, 2);
    assert.equal(rerun.unmatched.length, 0);
  });
});
