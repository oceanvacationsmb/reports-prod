import { NextRequest } from "next/server";
import { assertOwnerAccess, assertUser, isPrimaryAdmin } from "@/lib/auth";
import { loadOwnerCalendarRates } from "@/lib/guesty-calendar";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = assertUser(req);
    const requestedOwnerId = req.nextUrl.searchParams.get("ownerId");
    const ownerId = isPrimaryAdmin(user) ? requestedOwnerId || user.ownerId : user.ownerId;
    assertOwnerAccess(user, ownerId);
    if (!ownerId) throw Object.assign(new Error("Owner account is not connected yet."), { status: 400 });

    const year = Number(req.nextUrl.searchParams.get("year"));
    const month = Number(req.nextUrl.searchParams.get("month"));
    const property = req.nextUrl.searchParams.get("property")?.trim() || "";
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      throw Object.assign(new Error("A valid calendar year is required."), { status: 400 });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw Object.assign(new Error("A valid calendar month is required."), { status: 400 });
    }
    if (!property) throw Object.assign(new Error("A property is required."), { status: 400 });

    return ok(await loadOwnerCalendarRates(ownerId, property, year, month));
  } catch (error) {
    return fail(error);
  }
}
