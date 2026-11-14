import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { listTaxPackets, prepareTaxPackets } from "@/lib/tax/service";

const schema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  foodGross: z.coerce.number().optional(),
  admissionsGross: z.coerce.number().optional(),
  nontaxableRetail: z.coerce.number().optional(),
  longTermRentalDeduction: z.coerce.number().optional()
});

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    const params = schema.pick({ year: true, month: true }).parse({
      year: req.nextUrl.searchParams.get("year"),
      month: req.nextUrl.searchParams.get("month")
    });
    return ok({ packets: await listTaxPackets(params.year, params.month) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    const body = schema.parse(await req.json());
    const packets = await prepareTaxPackets(body.year, body.month, {
      foodGross: body.foodGross,
      admissionsGross: body.admissionsGross,
      nontaxableRetail: body.nontaxableRetail,
      longTermRentalDeduction: body.longTermRentalDeduction
    });
    return ok({ packets });
  } catch (error) {
    return fail(error);
  }
}
