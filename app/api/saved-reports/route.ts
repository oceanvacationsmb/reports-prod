import { NextRequest } from "next/server";
import { assertUser, isPrimaryAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { SavedReport } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";

export async function GET(req: NextRequest) {
  try {
    const user = assertUser(req);
    await connectDb();
    const query = isPrimaryAdmin(user) ? {} : { ownerId: user.ownerId };
    const savedReports = await SavedReport.find(query)
      .select("-htmlSnapshot")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return ok({ savedReports: asPlain(savedReports) });
  } catch (error) {
    return fail(error);
  }
}
