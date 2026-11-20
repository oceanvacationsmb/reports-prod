import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { unlockFinalStatement } from "@/lib/locked-statement-store";

export const runtime = "nodejs";

const schema = z.object({
  ownerId: z.string().min(1),
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12),
  confirmSent: z.literal(true)
});

export async function POST(req: NextRequest) {
  try {
    const user = assertAdmin(req);
    const body = schema.parse(await req.json());
    const result = await unlockFinalStatement({ ...body, who: user.email });
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
