import { NextRequest } from "next/server";
import { assertUser, isPrimaryAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { SavedReport } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  try {
    const { shareId } = await params;
    await connectDb();
    const savedReport = await SavedReport.findOne({ shareId }).lean();
    if (!savedReport) throw Object.assign(new Error("Saved report not found."), { status: 404 });
    return ok({ savedReport: asPlain(savedReport) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ shareId: string }> }) {
  try {
    const user = assertUser(req);
    const { shareId } = await params;
    await connectDb();
    const query = isPrimaryAdmin(user) ? { shareId } : { shareId, ownerId: user.ownerId };
    const savedReport = await SavedReport.findOneAndDelete(query).lean();
    if (!savedReport) throw Object.assign(new Error("Saved report not found."), { status: 404 });
    return ok({ deleted: true, savedReport: asPlain(savedReport) });
  } catch (error) {
    return fail(error);
  }
}
