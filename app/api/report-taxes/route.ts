import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Owner, Property } from "@/lib/models";
import { getGuestyReservations } from "@/lib/guesty";
import { asPlain, fail, ok } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { buildPropertyTaxReport } from "@/lib/reporting/report-taxes";
import { periodFromRequest } from "@/lib/reporting/reports";
import { reservationQueryForPeriod } from "@/lib/reporting/reservation-query";
import type { NormalizedReservation, OwnerLike, PropertyLike } from "@/lib/types";

export const runtime = "nodejs";

const querySchema = z.object({
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100)
});

function isAggregateOwner(owner: OwnerLike) {
  return owner.name.trim().toLowerCase() === "all properties";
}

async function loadOwnerRows(owner: OwnerLike, startDate: string, endDate: string) {
  if (!owner.guestyReportUrl && !owner.guestyAllPropertiesUrl) return [];
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const firstYear = Number.isFinite(startYear) ? startYear : new Date().getUTCFullYear();
  const lastYear = Number.isFinite(endYear) ? endYear : firstYear;
  return getGuestyReservations(owner, reservationQueryForPeriod(`${firstYear}-01-01`, `${lastYear}-12-31`));
}

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const { month, year } = querySchema.parse({
      month: req.nextUrl.searchParams.get("month"),
      year: req.nextUrl.searchParams.get("year")
    });
    const period = periodFromRequest({ reportKey: "statement", month, year });
    const settings = await getSettings();
    const owners = (asPlain(await Owner.find().sort({ name: 1 }).lean()) as OwnerLike[]).filter((owner) => !isAggregateOwner(owner));
    const properties = asPlain(await Property.find().sort({ name: 1 }).lean()) as PropertyLike[];
    const reservationsByOwner = new Map<string, NormalizedReservation[]>();

    await Promise.all(
      owners.map(async (owner) => {
        const ownerId = String(owner._id || owner.id || "");
        reservationsByOwner.set(ownerId, await loadOwnerRows(owner, period.startDate, period.endDate));
      })
    );

    return ok({ report: buildPropertyTaxReport(owners, reservationsByOwner, settings, month, year, properties) });
  } catch (error) {
    return fail(error);
  }
}
