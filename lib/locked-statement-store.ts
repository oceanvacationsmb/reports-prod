import { connectDb } from "@/lib/db";
import { asPlain } from "@/lib/http";
import { Expense, LockedStatement, Owner, Property, SavedReport, StatementAudit } from "@/lib/models";
import { getGuestyReservations } from "@/lib/guesty";
import { getSettings } from "@/lib/settings";
import { ownerReportReservationQuery } from "@/lib/reporting/reservation-query";
import { buildOwnerReport, makeShareId, recurringExpenses } from "@/lib/reporting/reports";
import {
  cents,
  lockOnEmail,
  modifyLock,
  type FinalMonthInput,
  type FinalStatement,
  type StatementExpenseLine,
  type StatementLine,
  type StatementTotals
} from "@/lib/locked-statements";
import type { ExpenseLike, OwnerLike, PropertyLike } from "@/lib/types";

export type StatementHistoryItem = {
  who: string;
  when: string;
  action: "modify";
  beforeRecurring: StatementLine[];
  afterRecurring: StatementLine[];
};

function httpError(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

function isDuplicate(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: number }).code === 11000;
}

function numberValue(value: unknown) {
  return cents(typeof value === "number" ? value : Number(value || 0));
}

function totalsFromSummary(summary: Record<string, number | string>): StatementTotals {
  const deposit = "ownerPayout" in summary ? numberValue(summary.ownerPayout) : numberValue(summary.draftDue);
  return {
    netAccommodation: numberValue(summary.netAccommodation),
    pmc: numberValue(summary.pmc),
    expenses: numberValue(summary.expenses),
    recurringCharges: numberValue(summary.recurringCharges),
    ownerPayout: deposit
  };
}

function linesFromDoc(value: unknown): StatementLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((line) => ({
    label: String(line?.label || ""),
    amount: numberValue(line?.amount),
    property: String(line?.property || "")
  }));
}

function expensesFromDoc(value: unknown): StatementExpenseLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((line) => ({
    property: String(line?.property || ""),
    type: String(line?.type || ""),
    amount: numberValue(line?.amount),
    notes: String(line?.notes || ""),
    vendor: String(line?.vendor || "")
  }));
}

export function toFinalStatement(doc: Record<string, unknown>): FinalStatement {
  const totals = (doc.totals || {}) as Record<string, unknown>;
  return {
    ownerId: String(doc.ownerId || ""),
    year: Number(doc.year),
    month: Number(doc.month),
    shareId: String(doc.shareId || ""),
    periodLabel: String(doc.periodLabel || ""),
    htmlSnapshot: String(doc.htmlSnapshot || ""),
    recurring: linesFromDoc(doc.recurring),
    expenses: expensesFromDoc(doc.expenses),
    totals: {
      netAccommodation: numberValue(totals.netAccommodation),
      pmc: numberValue(totals.pmc),
      expenses: numberValue(totals.expenses),
      recurringCharges: numberValue(totals.recurringCharges),
      ownerPayout: numberValue(totals.ownerPayout)
    },
    depositRecorded: doc.depositRecorded !== false,
    locked: true,
    lockedAt: doc.lockedAt ? new Date(String(doc.lockedAt)).toISOString() : new Date().toISOString(),
    lockedBy: String(doc.lockedBy || "")
  };
}

export function reportFromFinal(statement: FinalStatement, ownerName: string) {
  return {
    title: `${ownerName || "Owner"} Statement`,
    periodLabel: statement.periodLabel,
    html: statement.htmlSnapshot,
    summary: statement.totals
  };
}

function monthPeriod(year: number, month: number) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    startDate: `${year}-${pad(month)}-01`,
    endDate: `${year}-${pad(month)}-${pad(lastDay)}`
  };
}

function monthExpenseLines(expenses: ExpenseLike[], year: number, month: number): StatementExpenseLine[] {
  return expenses
    .filter((expense) => expense.year === year && expense.month === month)
    .map((expense) => ({
      property: expense.property || "",
      type: expense.type || "",
      amount: numberValue(expense.amount),
      notes: expense.notes || "",
      vendor: expense.vendor || ""
    }));
}

async function loadHistory(ownerId: string, year: number, month: number): Promise<StatementHistoryItem[]> {
  const audits = asPlain(
    await StatementAudit.find({ ownerId, year, month }).sort({ when: -1 }).limit(20).lean()
  ) as Array<Record<string, unknown>>;
  return audits.map((audit) => {
    const before = (audit.before || {}) as { recurring?: unknown };
    const after = (audit.after || {}) as { recurring?: unknown };
    return {
      who: String(audit.who || ""),
      when: audit.when ? new Date(String(audit.when)).toISOString() : "",
      action: "modify" as const,
      beforeRecurring: linesFromDoc(before.recurring),
      afterRecurring: linesFromDoc(after.recurring)
    };
  });
}

async function ensureShare(statement: FinalStatement, ownerName: string) {
  const saved = await SavedReport.findOne({ shareId: statement.shareId }).lean();
  if (saved) return;
  await SavedReport.create({
    ownerId: statement.ownerId,
    reportKey: "statement",
    reportTitle: `${ownerName || "Owner"} Statement`,
    periodLabel: statement.periodLabel,
    htmlSnapshot: statement.htmlSnapshot,
    shareId: statement.shareId
  });
}

async function computeStatement(ownerId: string, year: number, month: number, recurringOverride?: StatementLine[]) {
  const owner = asPlain(await Owner.findById(ownerId).lean()) as OwnerLike | null;
  if (!owner) throw httpError("Owner not found.", 404);
  const period = monthPeriod(year, month);
  const [settings, properties, expenses, rows] = await Promise.all([
    getSettings(),
    Property.find().lean(),
    Expense.find({ ownerId }).lean(),
    owner.guestyReportUrl || owner.guestyAllPropertiesUrl
      ? getGuestyReservations(owner, ownerReportReservationQuery(year))
      : Promise.resolve([])
  ]);
  const expenseList = asPlain(expenses) as ExpenseLike[];
  const report = buildOwnerReport(
    owner,
    rows,
    expenseList,
    settings,
    {
      reportKey: "statement",
      ownerId,
      year,
      month,
      calculationSource: "reports",
      readOnly: true,
      hideZeroReservations: true,
      ...(recurringOverride ? { recurringOverride } : {})
    },
    asPlain(properties) as PropertyLike[]
  );
  const recurring = recurringOverride
    ? recurringOverride.map((line) => ({ label: line.label, amount: cents(line.amount), property: line.property || "Recurring" }))
    : recurringExpenses(owner, period.startDate, period.endDate).map((expense) => ({
        label: expense.type,
        amount: numberValue(expense.amount),
        property: expense.property || "Recurring"
      }));
  return {
    owner,
    report,
    recurring,
    expenses: monthExpenseLines(expenseList, year, month),
    totals: totalsFromSummary(report.summary)
  };
}

export async function findFinalStatement(ownerId: string, year: number, month: number) {
  await connectDb();
  const doc = asPlain(await LockedStatement.findOne({ ownerId, year, month, locked: true }).lean()) as Record<string, unknown> | null;
  return doc ? toFinalStatement(doc) : null;
}

export async function listFinalMonths(ownerId: string, year: number): Promise<FinalMonthInput[]> {
  await connectDb();
  const docs = asPlain(await LockedStatement.find({ ownerId, year, locked: true }).lean()) as Record<string, unknown>[];
  return docs.map((doc) => {
    const statement = toFinalStatement(doc);
    return {
      year: statement.year,
      month: statement.month,
      shareId: statement.shareId,
      depositRecorded: statement.depositRecorded,
      totals: statement.totals
    };
  });
}

export async function emailFinalStatement(input: { ownerId: string; year: number; month: number; who: string }) {
  await connectDb();
  const owner = asPlain(await Owner.findById(input.ownerId).lean()) as OwnerLike | null;
  if (!owner) throw httpError("Owner not found.", 404);

  const existingDoc = asPlain(
    await LockedStatement.findOne({ ownerId: input.ownerId, year: input.year, month: input.month, locked: true }).lean()
  ) as Record<string, unknown> | null;
  if (existingDoc) {
    const existing = toFinalStatement(existingDoc);
    const decision = lockOnEmail(existing, existing);
    await ensureShare(decision.record, owner.name);
    const history = await loadHistory(input.ownerId, input.year, input.month);
    return {
      created: false,
      shareId: decision.record.shareId,
      recurring: decision.record.recurring,
      history,
      report: reportFromFinal(decision.record, owner.name)
    };
  }

  const computed = await computeStatement(input.ownerId, input.year, input.month);
  const draft = {
    ownerId: input.ownerId,
    year: input.year,
    month: input.month,
    shareId: makeShareId(),
    periodLabel: computed.report.periodLabel,
    htmlSnapshot: computed.report.html,
    recurring: computed.recurring,
    expenses: computed.expenses,
    totals: computed.totals,
    depositRecorded: true,
    lockedAt: new Date().toISOString(),
    lockedBy: input.who
  };
  const decision = lockOnEmail(null, draft);
  try {
    await LockedStatement.create({
      ...decision.record,
      lockedAt: new Date(decision.record.lockedAt)
    });
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    const winner = await findFinalStatement(input.ownerId, input.year, input.month);
    if (!winner) throw error;
    await ensureShare(winner, owner.name);
    return {
      created: false,
      shareId: winner.shareId,
      recurring: winner.recurring,
      history: await loadHistory(input.ownerId, input.year, input.month),
      report: reportFromFinal(winner, owner.name)
    };
  }
  await ensureShare(decision.record, owner.name);
  return {
    created: true,
    shareId: decision.record.shareId,
    recurring: decision.record.recurring,
    history: [],
    report: computed.report
  };
}

export async function modifyFinalStatement(input: {
  ownerId: string;
  year: number;
  month: number;
  who: string;
  recurring: StatementLine[];
}) {
  await connectDb();
  const owner = asPlain(await Owner.findById(input.ownerId).lean()) as OwnerLike | null;
  if (!owner) throw httpError("Owner not found.", 404);
  const existingDoc = asPlain(
    await LockedStatement.findOne({ ownerId: input.ownerId, year: input.year, month: input.month, locked: true }).lean()
  ) as Record<string, unknown> | null;
  if (!existingDoc) throw httpError("Email the owner before modifying this month.", 404);

  const existing = toFinalStatement(existingDoc);
  const computed = await computeStatement(input.ownerId, input.year, input.month, input.recurring);
  const result = modifyLock(
    existing,
    {
      recurring: computed.recurring,
      expenses: computed.expenses,
      totals: computed.totals,
      htmlSnapshot: computed.report.html,
      depositRecorded: true
    },
    input.who,
    new Date().toISOString()
  );
  await LockedStatement.updateOne(
    { _id: existingDoc._id },
    {
      $set: {
        recurring: result.lock.recurring,
        expenses: result.lock.expenses,
        totals: result.lock.totals,
        htmlSnapshot: result.lock.htmlSnapshot,
        periodLabel: computed.report.periodLabel,
        depositRecorded: true,
        locked: true
      }
    }
  );
  await SavedReport.updateOne(
    { shareId: existing.shareId },
    {
      $set: {
        htmlSnapshot: result.lock.htmlSnapshot,
        periodLabel: computed.report.periodLabel,
        reportTitle: computed.report.title
      }
    }
  );
  const saved = await SavedReport.findOne({ shareId: existing.shareId }).lean();
  if (!saved) await ensureShare({ ...result.lock, periodLabel: computed.report.periodLabel }, owner.name);
  await StatementAudit.create({
    ...result.audit,
    when: new Date(result.audit.when)
  });
  const history = await loadHistory(input.ownerId, input.year, input.month);
  return {
    created: false,
    shareId: result.lock.shareId,
    recurring: result.lock.recurring,
    history,
    report: computed.report
  };
}

export async function statementHistory(ownerId: string, year: number, month: number) {
  await connectDb();
  return loadHistory(ownerId, year, month);
}
