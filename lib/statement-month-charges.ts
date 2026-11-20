import { LockedStatement, Owner, StatementMonthOverride } from "@/lib/models";
import { recurringExpenses } from "@/lib/reporting/reports";
import type { StatementLine } from "@/lib/locked-statements";
import type { OwnerLike } from "@/lib/types";

export type MonthCharge = {
  id: string;
  label: string;
  amount: number;
  property: string;
};

function monthBounds(year: number, month: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    startDate: `${year}-${pad(month)}-01`,
    endDate: `${year}-${pad(month)}-${pad(lastDay)}`
  };
}

function chargeError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

export function settingsChargesForMonth(owner: OwnerLike, year: number, month: number): MonthCharge[] {
  const period = monthBounds(year, month);
  return recurringExpenses(owner, period.startDate, period.endDate).map((expense) => ({
    id: String(expense._id || ""),
    label: expense.type || "Recurring",
    amount: Number(expense.amount) || 0,
    property: expense.property || ""
  }));
}

export function applyMonthChargeChange(
  lines: MonthCharge[],
  action: { id?: string; label?: string; amount?: number; add?: boolean; remove?: boolean }
): MonthCharge[] {
  const next = lines.map((line) => ({ ...line }));
  if (action.add) {
    const label = String(action.label || "").trim();
    if (!label) throw chargeError("Enter a description for this month's charge.", 400);
    next.push({
      id: `monthCharge:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      amount: Number(action.amount) || 0,
      property: ""
    });
    return next;
  }

  const index = next.findIndex((line) => line.id === action.id);
  if (index < 0) throw chargeError("That charge is not on this month.", 404);
  if (action.remove || !String(action.label || "").trim()) {
    next.splice(index, 1);
    return next;
  }
  next[index] = {
    ...next[index],
    label: String(action.label).trim(),
    amount: Number(action.amount) || 0
  };
  return next;
}

function asMonthCharges(lines: StatementLine[], year: number, month: number): MonthCharge[] {
  return lines.map((line, index) => ({
    id: line.id || `monthCharge:${year}-${month}-${index}`,
    label: line.label,
    amount: Number(line.amount) || 0,
    property: line.property || ""
  }));
}

export function chargesAsLines(lines: MonthCharge[]): StatementLine[] {
  return lines.map((line) => ({
    id: line.id,
    label: line.label,
    amount: line.amount,
    property: line.property
  }));
}

function assertMonth(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw chargeError("Choose the statement month before changing a recurring charge.", 400);
  }
}

export async function loadStatementChargesByMonth(ownerId: string, year: number): Promise<Record<number, StatementLine[]>> {
  const [saved, openLocks] = await Promise.all([
    StatementMonthOverride.find({ ownerId, year }).lean(),
    LockedStatement.find({ ownerId, year, locked: false }).lean()
  ]);
  const byMonth: Record<number, StatementLine[]> = {};
  for (const doc of saved) {
    const month = Number(doc.month);
    const lines = Array.isArray(doc.recurring) ? doc.recurring : [];
    byMonth[month] = chargesAsLines(asMonthCharges(lines, year, month));
  }
  for (const doc of openLocks) {
    const month = Number(doc.month);
    if (byMonth[month] || !Array.isArray(doc.recurring)) continue;
    const lines = asMonthCharges(doc.recurring as StatementLine[], year, month);
    await saveMonthCharges(ownerId, year, month, lines);
    byMonth[month] = chargesAsLines(lines);
  }
  return byMonth;
}

export async function loadMonthChargeOverride(ownerId: string, year: number, month: number): Promise<StatementLine[] | null> {
  const doc = await StatementMonthOverride.findOne({ ownerId, year, month }).lean();
  if (!doc) return null;
  const lines = Array.isArray(doc.recurring) ? doc.recurring : [];
  return chargesAsLines(asMonthCharges(lines, year, month));
}

export async function saveMonthCharges(ownerId: string, year: number, month: number, lines: MonthCharge[]) {
  await StatementMonthOverride.findOneAndUpdate(
    { ownerId, year, month },
    {
      $set: {
        ownerId,
        year,
        month,
        recurring: lines.map((line) => ({
          id: line.id,
          label: line.label,
          amount: line.amount,
          property: line.property || ""
        }))
      }
    },
    { upsert: true }
  );
}

export async function keepMonthChargesFromStatement(ownerId: string, year: number, month: number, lines: StatementLine[]) {
  const existing = await StatementMonthOverride.findOne({ ownerId, year, month }).select("_id").lean();
  if (existing) return;
  await saveMonthCharges(ownerId, year, month, asMonthCharges(lines, year, month));
}

// A sent month keeps the charges stored on that statement. Months that were
// never sent, and have no edit, keep using the owner settings.
export async function monthChargesForStatement(ownerId: string, year: number, month: number): Promise<StatementLine[] | null> {
  const existing = await loadMonthChargeOverride(ownerId, year, month);
  if (existing) return existing;
  const open = await LockedStatement.findOne({ ownerId, year, month, locked: false }).lean();
  if (!open || !Array.isArray(open.recurring)) return null;
  const lines = asMonthCharges(open.recurring as StatementLine[], year, month);
  await saveMonthCharges(ownerId, year, month, lines);
  return chargesAsLines(lines);
}

export async function editMonthCharge(input: {
  ownerId: string;
  year: number;
  month: number;
  id?: string;
  label?: string;
  amount?: number;
  add?: boolean;
  remove?: boolean;
}) {
  assertMonth(input.year, input.month);
  const locked = await LockedStatement.findOne({
    ownerId: input.ownerId,
    year: input.year,
    month: input.month,
    locked: true
  })
    .select("_id")
    .lean();
  if (locked) throw chargeError("This month is locked. Unlock it before changing its charges.", 409);

  const owner = await Owner.findById(input.ownerId).lean();
  if (!owner) throw chargeError("Owner not found.", 404);

  const stored = await monthChargesForStatement(input.ownerId, input.year, input.month);
  const current = stored
    ? asMonthCharges(stored, input.year, input.month)
    : settingsChargesForMonth(owner as OwnerLike, input.year, input.month);
  const next = applyMonthChargeChange(current, input);
  await saveMonthCharges(input.ownerId, input.year, input.month, next);
  return next;
}
