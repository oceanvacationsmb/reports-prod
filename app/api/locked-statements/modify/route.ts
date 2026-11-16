import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { modifyFinalStatement } from "@/lib/locked-statement-store";

export const runtime = "nodejs";

const schema = z.object({
  ownerId: z.string().min(1),
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  recurring: z.array(
    z.object({
      label: z.string().trim().min(1),
      amount: z.coerce.number().finite(),
      property: z.string().optional()
    })
  )
});

export async function POST(req: NextRequest) {
  try {
    const user = assertAdmin(req);
    const body = schema.parse(await req.json());
    const result = await modifyFinalStatement({ ...body, who: user.email });
    return ok({ ...result, locked: true });
  } catch (error) {
    return fail(error);
  }
}
