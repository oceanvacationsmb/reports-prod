import { NextRequest } from "next/server";
import { assertOwnerAccess, assertUser } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Owner } from "@/lib/models";
import { getGuestyReservations } from "@/lib/guesty";
import { asPlain, fail, ok } from "@/lib/http";

export async function GET(req: NextRequest) {
  try {
    const user = assertUser(req);
    await connectDb();
    const ownerId = req.nextUrl.searchParams.get("ownerId") || user.ownerId;
    assertOwnerAccess(user, ownerId);
    const owner = await Owner.findById(ownerId).lean();
    if (!owner) throw Object.assign(new Error("Owner not found."), { status: 404 });
    const rows = await getGuestyReservations(owner, {
      limit: Number(req.nextUrl.searchParams.get("limit") || 1000),
      skip: Number(req.nextUrl.searchParams.get("skip") || 0),
      startDate: req.nextUrl.searchParams.get("startDate") || undefined,
      endDate: req.nextUrl.searchParams.get("endDate") || undefined,
      property: req.nextUrl.searchParams.get("property") || undefined,
      allProperties: req.nextUrl.searchParams.get("allProperties") === "true"
    });
    return ok({ rows: asPlain(rows) });
  } catch (error) {
    return fail(error);
  }
}
