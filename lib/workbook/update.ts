export type CellValue = string | number | Date | null | { formula: string };

export type WorkbookMapping = {
  sheetName: string;
  headerRow: number;
  columns: {
    owner: string;
    month: string;
    property: string;
    ownerPayout: string;
    cleaningTransfer: string;
  };
};

export type WorkbookEntry = {
  owner: string;
  year: number;
  month: number;
  property: string;
  ownerPayout: number;
  cleaning: number;
};

export type WorkbookUpdateResult = {
  rows: CellValue[][];
  updated: { row: number; owner: string; property: string; ownerPayout: number; cleaning: number }[];
  unmatched: WorkbookEntry[];
  ambiguous: WorkbookEntry[];
  skippedFormulas: { row: number; column: string; owner: string; property: string }[];
};

const monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december"
];

export function emptyMapping(): WorkbookMapping {
  return {
    sheetName: "",
    headerRow: 1,
    columns: {
      owner: "A",
      month: "B",
      property: "C",
      ownerPayout: "D",
      cleaningTransfer: "E"
    }
  };
}

export function normalizeMapping(input: Partial<WorkbookMapping> | null | undefined): WorkbookMapping {
  const mapping = emptyMapping();
  mapping.sheetName = String(input?.sheetName || "").trim();
  const headerRow = Number(input?.headerRow || 1);
  mapping.headerRow = Number.isFinite(headerRow) && headerRow >= 1 ? Math.floor(headerRow) : 1;
  const columns = input?.columns || mapping.columns;
  mapping.columns = {
    owner: columnLetter(columns.owner || "A"),
    month: columnLetter(columns.month || "B"),
    property: columnLetter(columns.property || "C"),
    ownerPayout: columnLetter(columns.ownerPayout || "D"),
    cleaningTransfer: columnLetter(columns.cleaningTransfer || "E")
  };
  return mapping;
}

export function columnLetter(value: string) {
  const letter = value.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(letter)) throw new Error(`Column ${value} is not a spreadsheet column.`);
  return letter;
}

export function columnIndex(letter: string) {
  let index = 0;
  for (const char of columnLetter(letter)) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function keyPart(value: string) {
  return value.trim().toLowerCase();
}

export function cellMonthKey(value: CellValue, year: number) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (typeof value === "number" && value >= 1 && value <= 12) {
    return `${year}-${String(value).padStart(2, "0")}`;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}$/.test(text)) return text;
  const nameOnly = monthNames.indexOf(text.toLowerCase());
  if (nameOnly >= 0) return `${year}-${String(nameOnly + 1).padStart(2, "0")}`;
  const named = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (named) {
    const month = monthNames.indexOf(named[1].toLowerCase());
    if (month >= 0) return `${named[2]}-${String(month + 1).padStart(2, "0")}`;
  }
  const numeric = text.match(/^(\d{1,2})[/-](\d{4})$/);
  if (numeric) {
    const month = Number(numeric[1]);
    if (month >= 1 && month <= 12) return `${numeric[2]}-${String(month).padStart(2, "0")}`;
  }
  return null;
}

function isFormula(value: CellValue): value is { formula: string } {
  return Boolean(value && typeof value === "object" && !(value instanceof Date) && "formula" in value);
}

export function updateWorkbookGrid(input: {
  rows: CellValue[][];
  mapping: WorkbookMapping;
  entries: WorkbookEntry[];
}): WorkbookUpdateResult {
  const rows = input.rows.map((row) => row.slice());
  const ownerCol = columnIndex(input.mapping.columns.owner);
  const monthCol = columnIndex(input.mapping.columns.month);
  const propertyCol = columnIndex(input.mapping.columns.property);
  const payoutCol = columnIndex(input.mapping.columns.ownerPayout);
  const cleaningCol = columnIndex(input.mapping.columns.cleaningTransfer);
  const target = `${input.entries[0]?.year || 0}-${String(input.entries[0]?.month || 0).padStart(2, "0")}`;
  const year = input.entries[0]?.year || new Date().getUTCFullYear();
  const groups = new Map<string, number[]>();
  rows.forEach((row, index) => {
    if (index < input.mapping.headerRow) return;
    const owner = typeof row[ownerCol] === "string" || typeof row[ownerCol] === "number" ? String(row[ownerCol]) : "";
    const property = typeof row[propertyCol] === "string" || typeof row[propertyCol] === "number" ? String(row[propertyCol]) : "";
    const monthKey = cellMonthKey(row[monthCol] ?? null, year);
    if (!owner.trim() || !property.trim() || monthKey !== target) return;
    const key = `${keyPart(owner)}|${monthKey}|${keyPart(property)}`;
    groups.set(key, [...(groups.get(key) || []), index]);
  });

  const entryGroups = new Map<string, WorkbookEntry[]>();
  for (const entry of input.entries) {
    const key = `${keyPart(entry.owner)}|${entry.year}-${String(entry.month).padStart(2, "0")}|${keyPart(entry.property)}`;
    entryGroups.set(key, [...(entryGroups.get(key) || []), entry]);
  }

  const updated: WorkbookUpdateResult["updated"] = [];
  const unmatched: WorkbookEntry[] = [];
  const ambiguous: WorkbookEntry[] = [];
  const skippedFormulas: WorkbookUpdateResult["skippedFormulas"] = [];

  for (const [key, entries] of entryGroups) {
    const entry = entries[0];
    if (entries.length > 1) {
      ambiguous.push(entry);
      continue;
    }
    const matches = groups.get(key) || [];
    if (matches.length !== 1) {
      if (!matches.length) unmatched.push(entry);
      else ambiguous.push(entry);
      continue;
    }
    const rowIndex = matches[0];
    const row = rows[rowIndex];
    const writes: [number, string, number][] = [
      [payoutCol, input.mapping.columns.ownerPayout, entry.ownerPayout],
      [cleaningCol, input.mapping.columns.cleaningTransfer, entry.cleaning]
    ];
    let wrote = false;
    for (const [column, letter, amount] of writes) {
      if (isFormula(row[column] ?? null)) {
        skippedFormulas.push({ row: rowIndex + 1, column: letter, owner: entry.owner, property: entry.property });
        continue;
      }
      row[column] = amount;
      wrote = true;
    }
    if (wrote) {
      updated.push({
        row: rowIndex + 1,
        owner: entry.owner,
        property: entry.property,
        ownerPayout: entry.ownerPayout,
        cleaning: entry.cleaning
      });
    }
  }

  return { rows, updated, unmatched, ambiguous, skippedFormulas };
}
