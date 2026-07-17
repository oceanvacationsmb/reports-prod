import { NextRequest } from "next/server";
import { assertOwnerAccess, assertUser, isPrimaryAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { getGuestyReservations } from "@/lib/guesty";
import { asPlain, fail, ok } from "@/lib/http";
import { Expense, Owner, Property } from "@/lib/models";
import { buildOwnerReport } from "@/lib/reporting/reports";
import { getSettings } from "@/lib/settings";
import type { ExpenseLike, OwnerLike, PropertyLike } from "@/lib/types";

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

export async function GET(req: NextRequest) {
  try {
    const user = assertUser(req);
    await connectDb();

    const requestedOwnerId = req.nextUrl.searchParams.get("ownerId");
    const ownerId = isPrimaryAdmin(user) ? requestedOwnerId || user.ownerId : user.ownerId;
    assertOwnerAccess(user, ownerId);
    if (!ownerId) throw Object.assign(new Error("Owner account is not connected yet."), { status: 400 });

    const year = Number(req.nextUrl.searchParams.get("year")) || new Date().getFullYear();
    const monthParam = Number(req.nextUrl.searchParams.get("month"));
    const month = monthParam >= 1 && monthParam <= 12 ? monthParam : new Date().getMonth() + 1;
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
    const report = buildOwnerReport(
      owner,
      rawRows,
      expenseList,
      settings,
      {
        reportKey: "statement",
        year,
        month,
        calculationSource: "reports",
        readOnly: true,
        hideZeroReservations: true
      },
      propertyList
    );

    return ok({ portal: {
      owner: {
        id: String(owner._id || owner.id || ""),
        name: owner.name,
        email: owner.email || ""
      },
      report
    } });
  } catch (error) {
    return fail(error);
  }
}
