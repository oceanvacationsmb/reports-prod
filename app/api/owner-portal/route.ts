import { NextRequest } from "next/server";
import { assertOwnerAccess, assertUser, isPrimaryAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { getGuestyReservations } from "@/lib/guesty";
import { asPlain, fail, ok } from "@/lib/http";
import { Expense, Owner, Property } from "@/lib/models";
import { calculateReservation, pmcPercent } from "@/lib/reporting/formulas";
import { getSettings } from "@/lib/settings";
import type { CalculatedReservation, ExpenseLike, OwnerLike, PropertyLike } from "@/lib/types";

export const runtime = "nodejs";

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function monthRange(year: number, month?: number | null) {
  if (!month) {
    return {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      periodLabel: `${year}`
    };
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startDate: `${year}-${pad(month)}-01`,
    endDate: `${year}-${pad(month)}-${pad(lastDay)}`,
    periodLabel: `${monthNames[month - 1]} 1 - ${monthNames[month - 1]} ${lastDay}, ${year}`
  };
}

function overlapsExpense(expense: ExpenseLike, year: number, month?: number | null) {
  if (expense.year !== year) return false;
  return month ? expense.month === month : true;
}

function platformLabel(row: CalculatedReservation) {
  const text = `${row.platform || ""} ${row.source || ""}`.toLowerCase();
  if (text.includes("homeaway") || text.includes("vrbo")) return "VRBO";
  if (text.includes("airbnb")) return "Airbnb";
  if (text.includes("website")) return "Website";
  if (text.includes("direct")) return "Direct";
  return row.platform || row.source || "Channel";
}

function isChannelPaid(row: CalculatedReservation) {
  const text = `${row.platform || ""} ${row.source || ""}`.toLowerCase();
  return ["homeaway", "vrbo", "airbnb", "website", "direct"].some((source) => text.includes(source));
}

function propertyAddress(propertyName: string, properties: PropertyLike[]) {
  const property = properties.find((item) => item.name === propertyName);
  return property?.reportAddress || propertyName;
}

function publicRow(row: CalculatedReservation, properties: PropertyLike[]) {
  return {
    id: row.id,
    guestName: row.guestName,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    nights: row.nights,
    property: row.property,
    propertyAddress: propertyAddress(row.property, properties),
    platform: platformLabel(row),
    source: row.source,
    netAccommodation: row.netAccommodation,
    pmc: row.pmc,
    ownerPayout: row.ownerPayout,
    isOwnerStay: row.isOwnerStay
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = assertUser(req);
    await connectDb();

    const requestedOwnerId = req.nextUrl.searchParams.get("ownerId");
    const ownerId = isPrimaryAdmin(user) ? requestedOwnerId || user.ownerId : user.ownerId;
    assertOwnerAccess(user, ownerId);
    if (!ownerId) throw Object.assign(new Error("Owner account is not connected yet."), { status: 400 });

    const year = Number(req.nextUrl.searchParams.get("year")) || new Date().getFullYear();
    const monthParam = req.nextUrl.searchParams.get("month");
    const month = monthParam && monthParam !== "all" ? Number(monthParam) : null;
    const period = monthRange(year, month);

    const owner = asPlain(await Owner.findById(ownerId).lean()) as OwnerLike | null;
    if (!owner) throw Object.assign(new Error("Owner not found."), { status: 404 });

    const [settings, properties, expenses, rawRows] = await Promise.all([
      getSettings(),
      Property.find().lean(),
      Expense.find({ ownerId }).lean(),
      owner.guestyReportUrl || owner.guestyAllPropertiesUrl
        ? getGuestyReservations(owner, {
            limit: 1000,
            skip: 0,
            startDate: period.startDate,
            endDate: period.endDate,
            allProperties: true
          })
        : []
    ]);

    const propertyList = asPlain(properties) as PropertyLike[];
    const expenseList = asPlain(expenses) as ExpenseLike[];
    const periodExpenses = expenseList.filter((expense) => overlapsExpense(expense, year, month));
    const expenseTotal = periodExpenses.reduce((total, expense) => total + (expense.amount || 0), 0);
    const rows = rawRows
      .map((row) => calculateReservation(row, owner, settings, { calculationSource: "portal" }))
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    const reservationRows = rows.filter((row) => !row.isOwnerStay);
    const ownerStayRows = rows.filter((row) => row.isOwnerStay);
    const netAccommodation = reservationRows.reduce((total, row) => total + row.netAccommodation, 0);
    const totalPmc = reservationRows.reduce((total, row) => total + row.pmc, 0);
    const totalOwnerPayout = reservationRows.reduce((total, row) => total + row.ownerPayout, 0) - expenseTotal;
    const bookedNights = reservationRows.reduce((total, row) => total + (row.nights || 0), 0);
    const ownerStayNights = ownerStayRows.reduce((total, row) => total + (row.nights || 0), 0);

    return ok({ portal: {
      owner: {
        id: String(owner._id || owner.id || ""),
        name: owner.name,
        email: owner.email || "",
        pmcPercent: pmcPercent(owner),
        properties: (owner.properties || []).map((name) => ({
          name,
          address: propertyAddress(name, propertyList)
        }))
      },
      period,
      summary: {
        totalAccommodation: netAccommodation,
        totalPmc,
        totalOwnerPayout,
        bookedNights,
        ownerStayNights,
        expenses: expenseTotal
      },
      reservations: reservationRows.map((row) => publicRow(row, propertyList)),
      ownerStays: ownerStayRows.map((row) => publicRow(row, propertyList)),
      channelPaid: reservationRows.filter(isChannelPaid).map((row) => publicRow(row, propertyList))
    } });
  } catch (error) {
    return fail(error);
  }
}
