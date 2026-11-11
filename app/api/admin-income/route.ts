import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { getGuestyReservations } from "@/lib/guesty";
import { asPlain, fail, ok } from "@/lib/http";
import { Expense, Owner, Property } from "@/lib/models";
import { ownerReportReservationQuery } from "@/lib/reporting/reservation-query";
import { buildAdminIncomeData } from "@/lib/reporting/reports";
import { getSettings } from "@/lib/settings";
import type { ExpenseLike, NormalizedReservation, OwnerLike, PropertyLike } from "@/lib/types";

export const runtime = "nodejs";

const querySchema = z.object({
  month: z.coerce.number().min(1).max(12).optional(),
  year: z.coerce.number().min(2000).max(2100)
});

function isAggregateOwner(owner: OwnerLike) {
  return owner.name.trim().toLowerCase() === "all properties";
}

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

async function loadIncomeReservations(owner: OwnerLike, year: number) {
  const query = ownerReportReservationQuery(year);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await getGuestyReservations(owner, query);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const query = querySchema.parse({
      month: req.nextUrl.searchParams.get("month") || undefined,
      year: req.nextUrl.searchParams.get("year")
    });
    const [ownerDocuments, expenseDocuments, propertyDocuments, settings] = await Promise.all([
      Owner.find().sort({ name: 1 }).lean(),
      Expense.find({ year: query.year, ...(query.month ? { month: query.month } : {}) }).lean(),
      Property.find().sort({ name: 1 }).lean(),
      getSettings()
    ]);
    const owners = (asPlain(ownerDocuments) as OwnerLike[]).filter((owner) => !isAggregateOwner(owner));
    const expenses = asPlain(expenseDocuments) as ExpenseLike[];
    const properties = asPlain(propertyDocuments) as PropertyLike[];
    const reservationsByOwner = new Map<string, NormalizedReservation[]>();
    const expensesByOwner = new Map<string, ExpenseLike[]>();
    const warnings: string[] = [];

    await mapWithConcurrency(owners, 4, async (owner) => {
      const ownerId = String(owner._id || owner.id || "");
      expensesByOwner.set(ownerId, expenses.filter((expense) => String(expense.ownerId) === ownerId));
      if (!owner.guestyReportUrl && !owner.guestyAllPropertiesUrl) {
        reservationsByOwner.set(ownerId, []);
        warnings.push(`${owner.name}: Guesty report URL is not configured.`);
        return;
      }

      try {
        reservationsByOwner.set(ownerId, await loadIncomeReservations(owner, query.year));
      } catch (error) {
        reservationsByOwner.set(ownerId, []);
        warnings.push(`${owner.name}: ${error instanceof Error ? error.message : "Reservation data could not be loaded."}`);
      }
    });

    const income = buildAdminIncomeData(owners, reservationsByOwner, expensesByOwner, settings, query, properties);
    return ok({ income, warnings });
  } catch (error) {
    return fail(error);
  }
}
