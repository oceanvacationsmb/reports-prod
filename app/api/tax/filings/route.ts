import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { listFilings, prepareFilings } from "@/lib/tax/service";

const schema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12)
});

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    const params = schema.parse({
      year: req.nextUrl.searchParams.get("year"),
      month: req.nextUrl.searchParams.get("month")
    });
    return ok({ filings: await listFilings(params.year, params.month) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    const body = schema.parse(await req.json());
    return ok({ filings: await prepareFilings(body.year, body.month) });
  } catch (error) {
    return fail(error);
  }
}
