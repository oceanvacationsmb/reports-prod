import { Owner, Property } from "@/lib/models";
import { getGuestyReservations } from "@/lib/guesty";
import { asPlain } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { buildFilingActivity } from "@/lib/reporting/report-taxes";
import { periodFromRequest } from "@/lib/reporting/reports";
import { reservationQueryForPeriod } from "@/lib/reporting/reservation-query";
import type { NormalizedReservation, OwnerLike, PropertyLike } from "@/lib/types";
import { prepareFiling } from "@/lib/tax-forms/prepare";
import { listJurisdictionSettings } from "@/lib/tax-forms/jurisdictions";

function isAggregateOwner(owner: OwnerLike) {
  return owner.name.trim().toLowerCase() === "all properties";
}

async function loadOwnerRows(owner: OwnerLike, startDate: string, endDate: string) {
  if (!owner.guestyReportUrl && !owner.guestyAllPropertiesUrl) return [] as NormalizedReservation[];
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const firstYear = Number.isFinite(startYear) ? startYear : new Date().getUTCFullYear();
  const lastYear = Number.isFinite(endYear) ? endYear : firstYear;
  return getGuestyReservations(owner, reservationQueryForPeriod(`${firstYear}-01-01`, `${lastYear}-12-31`));
}

export async function loadPreparedFiling(month: number, year: number, monthsLate: number) {
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
  const activity = buildFilingActivity(owners, reservationsByOwner, settings, month, year, properties);
  const jurisdictions = await listJurisdictionSettings();
  return prepareFiling({
    periodLabel: activity.periodLabel,
    year,
    month,
    monthsLate,
    properties,
    activity: activity.rows,
    jurisdictions
  });
}
