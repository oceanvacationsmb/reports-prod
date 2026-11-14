import { connectDb } from "@/lib/db";
import { Expense, Owner, Property } from "@/lib/models";
import { getGuestyReservations } from "@/lib/guesty";
import { asPlain } from "@/lib/http";
import { reservationQueryForPeriod } from "@/lib/reporting/reservation-query";
import { getSettings } from "@/lib/settings";
import type { ExpenseLike, NormalizedReservation, OwnerLike, PropertyLike } from "@/lib/types";
import type { AppSettings } from "@/lib/types";

export function isAggregateOwner(owner: { name?: string }) {
  return (owner.name || "").trim().toLowerCase() === "all properties";
}

export async function loadOwners() {
  await connectDb();
  return (asPlain(await Owner.find().sort({ name: 1 }).lean()) as OwnerLike[]).filter((owner) => !isAggregateOwner(owner));
}

export async function loadPeriodInputs(year: number, month: number) {
  await connectDb();
  const settings = await getSettings();
  const owners = (asPlain(await Owner.find().sort({ name: 1 }).lean()) as OwnerLike[]).filter((owner) => !isAggregateOwner(owner));
  const properties = asPlain(await Property.find().lean()) as PropertyLike[];
  const ids = owners.map((owner) => String(owner._id || owner.id));
  const allExpenses = asPlain(await Expense.find({ ownerId: { $in: ids } }).lean()) as ExpenseLike[];
  const expensesByOwner = new Map<string, ExpenseLike[]>();
  const reservationsByOwner = new Map<string, NormalizedReservation[]>();
  const periodStart = `${year}-01-01`;
  const periodEnd = `${year}-12-31`;

  await Promise.all(
    owners.map(async (owner) => {
      const ownerId = String(owner._id || owner.id);
      expensesByOwner.set(ownerId, allExpenses.filter((expense) => String(expense.ownerId) === ownerId));
      if (!owner.guestyReportUrl && !owner.guestyAllPropertiesUrl) {
        reservationsByOwner.set(ownerId, []);
        return;
      }
      reservationsByOwner.set(ownerId, await getGuestyReservations(owner, reservationQueryForPeriod(periodStart, periodEnd)));
    })
  );

  return { settings: settings as AppSettings, owners, properties, expensesByOwner, reservationsByOwner };
}
