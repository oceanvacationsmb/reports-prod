import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { getGuestyReservations } from "@/lib/guesty";
import { asPlain, fail, ok } from "@/lib/http";
import { Expense, Owner, Property } from "@/lib/models";
import { buildAdminIncomeData, periodFromRequest } from "@/lib/reporting/reports";
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

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const query = querySchema.parse({
      month: req.nextUrl.searchParams.get("month") || undefined,
      year: req.nextUrl.searchParams.get("year")
    });
    const period = periodFromRequest({ reportKey: "income", ...query });
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

    await Promise.all(
      owners.map(async (owner) => {
        const ownerId = String(owner._id || owner.id || "");
        expensesByOwner.set(ownerId, expenses.filter((expense) => String(expense.ownerId) === ownerId));
        if (!owner.guestyReportUrl && !owner.guestyAllPropertiesUrl) {
          reservationsByOwner.set(ownerId, []);
          warnings.push(`${owner.name}: Guesty report URL is not configured.`);
          return;
        }

        try {
          const rows = await getGuestyReservations(owner, {
            limit: 1000,
            skip: 0,
            startDate: period.startDate,
            endDate: period.endDate,
            allProperties: Boolean(owner.guestyAllPropertiesUrl)
          });
          reservationsByOwner.set(ownerId, rows);
        } catch (error) {
          reservationsByOwner.set(ownerId, []);
          warnings.push(`${owner.name}: ${error instanceof Error ? error.message : "Reservation data could not be loaded."}`);
        }
      })
    );

    const income = buildAdminIncomeData(owners, reservationsByOwner, expensesByOwner, settings, query, properties);
    return ok({ income, warnings });
  } catch (error) {
    return fail(error);
  }
}
