import { NextRequest } from "next/server";
import { z } from "zod";
import { assertOwnerAccess, assertUser, isPrimaryAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Expense, Owner, Property } from "@/lib/models";
import { getGuestyReservations } from "@/lib/guesty";
import { asPlain, fail, ok } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { buildAllOwnersTaxReport, buildOwnerReport, buildSummaryReport, periodFromRequest } from "@/lib/reporting/reports";
import type { ExpenseLike, NormalizedReservation, OwnerLike, PropertyLike } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  reportKey: z.enum(["statement", "income", "gri", "1099", "summary", "allOwnersTax"]),
  ownerId: z.string().optional(),
  property: z.string().optional(),
  month: z.coerce.number().min(1).max(12).optional(),
  year: z.coerce.number().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  calculationSource: z.enum(["reports", "portal"]).optional().default("reports")
});

function isAggregateOwner(owner: OwnerLike) {
  return owner.name.trim().toLowerCase() === "all properties";
}

async function loadOwnerRows(owner: OwnerLike, query: { startDate: string; endDate: string; property?: string }) {
  if (!owner.guestyReportUrl && !owner.guestyAllPropertiesUrl) return [];
  return getGuestyReservations(owner, {
    limit: 1000,
    skip: 0,
    startDate: query.startDate,
    endDate: query.endDate,
    property: query.property
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = assertUser(req);
    await connectDb();
    const body = schema.parse(await req.json());
    if (body.reportKey === "gri" && !body.property) {
      throw Object.assign(new Error("Property is required for GRI reports."), { status: 400 });
    }
    const period = periodFromRequest(body);
    const settings = await getSettings();

    if (body.reportKey === "summary" || body.reportKey === "allOwnersTax") {
      if (!isPrimaryAdmin(user)) {
        throw Object.assign(new Error("Admin access required."), { status: 403 });
      }
      const ownerFilter = body.ownerId ? { _id: body.ownerId } : {};
      const owners = (asPlain(await Owner.find(ownerFilter).sort({ name: 1 }).lean()) as OwnerLike[]).filter((owner) => !isAggregateOwner(owner));
      const ids = owners.map((owner) => String(owner._id || owner.id));
      const allExpenses = asPlain(await Expense.find({ ownerId: { $in: ids } }).lean()) as ExpenseLike[];
      const properties = asPlain(await Property.find().lean()) as PropertyLike[];
      const expensesByOwner = new Map<string, ExpenseLike[]>();
      const reservationsByOwner = new Map<string, NormalizedReservation[]>();

      await Promise.all(
        owners.map(async (owner) => {
          const ownerId = String(owner._id || owner.id);
          expensesByOwner.set(ownerId, allExpenses.filter((expense) => String(expense.ownerId) === ownerId));
          reservationsByOwner.set(ownerId, await loadOwnerRows(owner, { startDate: period.startDate, endDate: period.endDate, property: body.property }));
        })
      );

      const report = body.reportKey === "summary"
        ? buildSummaryReport(owners, reservationsByOwner, expensesByOwner, settings, body, properties)
        : buildAllOwnersTaxReport(owners, reservationsByOwner, expensesByOwner, settings, body, properties);

      return ok({ report });
    }

    const ownerId = user.role === "owner" ? user.ownerId : body.ownerId;
    assertOwnerAccess(user, ownerId);
    if (!ownerId) throw Object.assign(new Error("Owner is required."), { status: 400 });

    const owner = asPlain(await Owner.findById(ownerId).lean()) as OwnerLike | null;
    if (!owner) throw Object.assign(new Error("Owner not found."), { status: 404 });
    const rows = await loadOwnerRows(owner, { startDate: period.startDate, endDate: period.endDate, property: body.property });
    const expenses = asPlain(await Expense.find({ ownerId }).lean()) as ExpenseLike[];
    const properties = asPlain(await Property.find().lean()) as PropertyLike[];
    const report = buildOwnerReport(owner, rows, expenses, settings, body, properties);
    return ok({ report });
  } catch (error) {
    return fail(error);
  }
}
