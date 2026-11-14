import ExcelJS from "exceljs";
import { columnIndex, updateWorkbookGrid, type CellValue, type WorkbookEntry, type WorkbookMapping } from "@/lib/workbook/update";

function cellToValue(cell: ExcelJS.Cell): CellValue {
  if (cell.formula) return { formula: cell.formula };
  const value = cell.value;
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "object" && "formula" in value && value.formula) return { formula: String(value.formula) };
  if (typeof value === "object" && "result" in value && (typeof value.result === "number" || typeof value.result === "string")) {
    return value.result;
  }
  if (typeof value === "object" && "text" in value) return String(value.text || "");
  return String(value);
}

export async function updateXlsxWorkbook(input: {
  bytes: Uint8Array | Buffer;
  mapping: WorkbookMapping;
  entries: WorkbookEntry[];
}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(input.bytes) as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet(input.mapping.sheetName);
  if (!sheet) throw new Error(`Sheet ${input.mapping.sheetName} was not found. Save the workbook as .xlsx and map the sheet name exactly.`);
  const rowCount = Math.max(sheet.rowCount, input.mapping.headerRow);
  const width = Math.max(
    columnIndex(input.mapping.columns.owner),
    columnIndex(input.mapping.columns.month),
    columnIndex(input.mapping.columns.property),
    columnIndex(input.mapping.columns.ownerPayout),
    columnIndex(input.mapping.columns.cleaningTransfer)
  ) + 1;
  const rows: CellValue[][] = [];
  for (let rowIndex = 1; rowIndex <= rowCount; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    rows.push(Array.from({ length: width }, (_, column) => cellToValue(row.getCell(column + 1))));
  }
  const result = updateWorkbookGrid({ rows, mapping: input.mapping, entries: input.entries });
  for (const change of result.updated) {
    const row = sheet.getRow(change.row);
    const payoutCell = row.getCell(columnIndex(input.mapping.columns.ownerPayout) + 1);
    const cleaningCell = row.getCell(columnIndex(input.mapping.columns.cleaningTransfer) + 1);
    if (!payoutCell.formula) payoutCell.value = change.ownerPayout;
    if (!cleaningCell.formula) cleaningCell.value = change.cleaning;
  }
  const output = await workbook.xlsx.writeBuffer();
  return {
    bytes: Buffer.from(output),
    updated: result.updated,
    unmatched: result.unmatched,
    ambiguous: result.ambiguous,
    skippedFormulas: result.skippedFormulas
  };
}
