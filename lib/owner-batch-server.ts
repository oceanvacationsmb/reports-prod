import { connectDb } from "@/lib/db";
import { asPlain } from "@/lib/http";
import { Expense, Owner, Property } from "@/lib/models";
import { getGuestyReservations } from "@/lib/guesty";
import { findFinalStatement, reportFromFinal } from "@/lib/locked-statement-store";
import { getSettings } from "@/lib/settings";
import { ownerReportReservationQuery } from "@/lib/reporting/reservation-query";
import { buildOwnerReport, buildSummaryReport } from "@/lib/reporting/reports";
import { monthChargesForStatement } from "@/lib/statement-month-charges";
import type { ExpenseLike, NormalizedReservation, OwnerLike, PropertyLike } from "@/lib/types";
import { batchRecipients, isBatchOwner, ownerBatchPrintDocument } from "@/lib/owner-batch";

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function loadBatchOwners() {
  await connectDb();
  const owners = (asPlain(await Owner.find().sort({ name: 1 }).lean()) as OwnerLike[]).filter((owner) => isBatchOwner(owner.name));
  return owners;
}

export async function buildOwnerBatchPrint(month: number, year: number) {
  await connectDb();
  const owners = await loadBatchOwners();
  const settings = await getSettings();
  const properties = asPlain(await Property.find().lean()) as PropertyLike[];
  const expenses = asPlain(await Expense.find({ year, month }).lean()) as ExpenseLike[];
  const reservationsByOwner = new Map<string, NormalizedReservation[]>();
  const expensesByOwner = new Map<string, ExpenseLike[]>();

  await mapWithConcurrency(owners, 4, async (owner) => {
    const ownerId = String(owner._id || owner.id || "");
    expensesByOwner.set(ownerId, expenses.filter((expense) => String(expense.ownerId) === ownerId));
    const rows = owner.guestyReportUrl || owner.guestyAllPropertiesUrl
      ? await getGuestyReservations(owner, ownerReportReservationQuery(year))
      : [];
    reservationsByOwner.set(ownerId, rows);
  });

  const sections: Array<{ title: string; html: string }> = [];
  for (const owner of owners) {
    const ownerId = String(owner._id || owner.id || "");
    const finalStatement = await findFinalStatement(ownerId, year, month);
    const monthCharges = finalStatement ? null : await monthChargesForStatement(ownerId, year, month);
    const report = finalStatement
      ? reportFromFinal(finalStatement, owner.name)
      : buildOwnerReport(
          owner,
          reservationsByOwner.get(ownerId) || [],
          expensesByOwner.get(ownerId) || [],
          settings,
          {
            reportKey: "statement",
            ownerId,
            month,
            year,
            readOnly: true,
            hideZeroReservations: true,
            ...(monthCharges ? { recurringOverride: monthCharges } : {})
          },
          properties
        );
    sections.push({ title: owner.name, html: report.html });
  }

  const summary = buildSummaryReport(owners, reservationsByOwner, expensesByOwner, settings, { reportKey: "summary", month, year }, properties);
  sections.push({ title: "Owner summary", html: summary.html });
  return ownerBatchPrintDocument(sections);
}

export async function batchRecipientPreview() {
  const owners = await loadBatchOwners();
  return batchRecipients(owners);
}
