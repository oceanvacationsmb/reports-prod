import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { SURFSIDE_HOSPITALITY_CONCLUSION } from "@/lib/tax-forms/calculate";
import { loadPreparedFiling } from "@/lib/tax-forms/load-filing";
import { periodEndingDate } from "@/lib/tax-forms/period";

export const runtime = "nodejs";

const querySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  monthsLate: z.coerce.number().int().min(0).max(24).optional().default(0)
});

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const query = querySchema.parse({
      month: req.nextUrl.searchParams.get("month"),
      year: req.nextUrl.searchParams.get("year"),
      monthsLate: req.nextUrl.searchParams.get("monthsLate") || "0"
    });
    const filing = await loadPreparedFiling(query.month, query.year, query.monthsLate);
    return ok({
      filing,
      periodEnding: periodEndingDate(query.year, query.month),
      surfsideHospitality: SURFSIDE_HOSPITALITY_CONCLUSION
    });
  } catch (error) {
    return fail(error);
  }
}
