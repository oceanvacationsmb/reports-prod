import { NextRequest } from "next/server";
import { assertOwnerAccess, assertUser, isPrimaryAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { loadOwnerPortal } from "@/lib/owner-portal";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = assertUser(req);

    const requestedOwnerId = req.nextUrl.searchParams.get("ownerId");
    const ownerId = isPrimaryAdmin(user) ? requestedOwnerId || user.ownerId : user.ownerId;
    assertOwnerAccess(user, ownerId);
    if (!ownerId) throw Object.assign(new Error("Owner account is not connected yet."), { status: 400 });

    const year = Number(req.nextUrl.searchParams.get("year")) || new Date().getFullYear();
    const monthText = req.nextUrl.searchParams.get("month");
    const monthNumber = Number(monthText);
    const month = monthText === "full-year"
      ? null
      : monthNumber >= 1 && monthNumber <= 12
        ? monthNumber
        : new Date().getMonth() + 1;

    return ok({ portal: await loadOwnerPortal(ownerId, year, month) });
  } catch (error) {
    return fail(error);
  }
}
