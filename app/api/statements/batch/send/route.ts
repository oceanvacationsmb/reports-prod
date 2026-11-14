import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { dispatchStatementMonth } from "@/lib/statements/service";

const schema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12)
});

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    const body = schema.parse(await req.json());
    return ok(await dispatchStatementMonth(body.year, body.month, { manualAuthorization: true }));
  } catch (error) {
    return fail(error);
  }
}
