import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { generateStatementMonth, statementBatchView } from "@/lib/statements/service";

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
    return ok(await statementBatchView(params.year, params.month));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    const body = schema.parse(await req.json());
    const result = await generateStatementMonth(body.year, body.month);
    const view = await statementBatchView(body.year, body.month);
    return ok({ ...result, ...view });
  } catch (error) {
    return fail(error);
  }
}
