import { connectDb } from "@/lib/db";
import { getGuestyReservations } from "@/lib/guesty";
import { asPlain } from "@/lib/http";
import { Expense, Owner, Property, ReservationSeen } from "@/lib/models";
import { calculateReservation } from "@/lib/reporting/formulas";
import { buildOwnerReport } from "@/lib/reporting/reports";
import { getSettings } from "@/lib/settings";
import type { CalculatedReservation, ExpenseLike, NormalizedReservation, OwnerLike, PropertyLike } from "@/lib/types";

const NEW_RESERVATION_DAYS = 14;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function ownerPortalPeriod(year: number, month?: number | null) {
  if (!month) {
    return {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`
    };
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startDate: `${year}-${pad(month)}-01`,
    endDate: `${year}-${pad(month)}-${pad(lastDay)}`
  };
}

function reservationYear(row: NormalizedReservation, fallbackYear: number) {
  const parsed = Number(row.checkIn.slice(0, 4));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackYear;
}

async function addFirstSeenStatus(ownerId: string, year: number, rows: NormalizedReservation[]) {
  const reservationIds = [...new Set(rows.map((row) => row.id).filter(Boolean))];
  if (!reservationIds.length) return rows;

  const existingForYear = await ReservationSeen.find({ ownerId, year }).lean() as Array<{
    reservationId: string;
    firstSeenAt: Date;
    baseline?: boolean;
  }>;
  const baselineYear = existingForYear.length === 0;
  const existingIds = new Set(existingForYear.map((entry) => entry.reservationId));
  const missing = rows.filter((row) => !existingIds.has(row.id));

  if (missing.length) {
    const now = new Date();
    await ReservationSeen.bulkWrite(
      missing.map((row) => ({
        updateOne: {
          filter: { ownerId, reservationId: row.id },
          update: {
            $setOnInsert: {
              ownerId,
              reservationId: row.id,
              year: reservationYear(row, year),
              firstSeenAt: now,
              baseline: baselineYear
            }
          },
          upsert: true
        }
      })),
      { ordered: false }
    );
  }

  const seenRows = await ReservationSeen.find({ ownerId, reservationId: { $in: reservationIds } }).lean() as Array<{
    reservationId: string;
    firstSeenAt: Date;
    baseline?: boolean;
  }>;
  const seenById = new Map(seenRows.map((entry) => [entry.reservationId, entry]));
  const recentCutoff = Date.now() - NEW_RESERVATION_DAYS * 86_400_000;

  return rows.map((row) => {
    const seen = seenById.get(row.id);
    const firstSeenAt = seen?.firstSeenAt ? new Date(seen.firstSeenAt) : null;
    return {
      ...row,
      firstSeenAt: firstSeenAt?.toISOString(),
      isNew: Boolean(firstSeenAt && !seen?.baseline && firstSeenAt.getTime() >= recentCutoff)
    };
  });
}

function propertyAddress(property: string, properties: PropertyLike[]) {
  const normalized = property.trim().toLowerCase();
  const match = properties.find((candidate) => candidate.name.trim().toLowerCase() === normalized);
  return match?.reportAddress?.trim() || property;
}

function hasStatementValue(row: CalculatedReservation) {
  return row.isOwnerStay || [row.grossPayout, row.netAccommodation, row.ownerPayoutBeforeExpenses].some((value) => Math.abs(value) >= 0.005);
}

export type OwnerCalendarRow = {
  id: string;
  property: string;
  propertyAddress: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  nightlyRate: number;
  platform: string;
  isOwnerStay: boolean;
  isNew: boolean;
};

export async function loadOwnerPortal(ownerId: string, year: number, month?: number | null) {
  await connectDb();
  const owner = asPlain(await Owner.findById(ownerId).lean()) as OwnerLike | null;
  if (!owner) throw Object.assign(new Error("Owner not found."), { status: 404 });

  const fullYear = ownerPortalPeriod(year);
  const [settings, properties, expenses, fetchedRows] = await Promise.all([
    getSettings(),
    Property.find().lean(),
    Expense.find({ ownerId }).lean(),
    owner.guestyReportUrl || owner.guestyAllPropertiesUrl
      ? getGuestyReservations(owner, {
          limit: 1000,
          skip: 0,
          startDate: fullYear.startDate,
          endDate: fullYear.endDate,
          allProperties: true
        })
      : []
  ]);

  const propertyList = asPlain(properties) as PropertyLike[];
  const expenseList = asPlain(expenses) as ExpenseLike[];
  const rows = await addFirstSeenStatus(ownerId, year, fetchedRows);
  const report = buildOwnerReport(
    owner,
    rows,
    expenseList,
    settings,
    {
      reportKey: "statement",
      year,
      month: month || undefined,
      calculationSource: "reports",
      readOnly: true,
      hideZeroReservations: true
    },
    propertyList
  );

  const calendarRows = rows
    .map((row) => calculateReservation(row, owner, settings, { calculationSource: "reports" }))
    .filter(hasStatementValue)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.id.localeCompare(b.id))
    .map<OwnerCalendarRow>((row) => ({
      id: row.id,
      property: row.property || "Unassigned",
      propertyAddress: propertyAddress(row.property || "Unassigned", propertyList),
      guestName: row.guestName,
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      nightlyRate: row.isOwnerStay || row.nights <= 0 ? 0 : row.netAccommodation / row.nights,
      platform: row.platform || row.source,
      isOwnerStay: row.isOwnerStay,
      isNew: Boolean(row.isNew)
    }));

  const calendarProperties = [...new Set([
    ...(owner.properties || []).filter(Boolean),
    ...calendarRows.map((row) => row.property)
  ])]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, address: propertyAddress(name, propertyList) }));

  return {
    owner: {
      id: String(owner._id || owner.id || ""),
      name: owner.name,
      email: owner.email || ""
    },
    report,
    calendarRows,
    calendarProperties
  };
}
