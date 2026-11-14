import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { asPlain, fail, ok } from "@/lib/http";
import { emailFinalStatement, findFinalStatement, reportFromFinal, statementHistory } from "@/lib/locked-statement-store";
import { Owner } from "@/lib/models";
import type { OwnerLike } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  ownerId: z.string().min(1),
  year: z.coerce.number().int(),
  month: z.coerce.number().int().min(1).max(12)
});

export async function POST(req: NextRequest) {
  try {
    const user = assertAdmin(req);
    const body = schema.parse(await req.json());
    const result = await emailFinalStatement({ ...body, who: user.email });
    return ok({ ...result, locked: true }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    const url = new URL(req.url);
    const body = schema.parse({
      ownerId: url.searchParams.get("ownerId"),
      year: url.searchParams.get("year"),
      month: url.searchParams.get("month")
    });
    await connectDb();
    const owner = asPlain(await Owner.findById(body.ownerId).lean()) as OwnerLike | null;
    if (!owner) throw Object.assign(new Error("Owner not found."), { status: 404 });
    const statement = await findFinalStatement(body.ownerId, body.year, body.month);
    if (!statement) return ok({ locked: false, shareId: "", recurring: [], history: [] });
    const history = await statementHistory(body.ownerId, body.year, body.month);
    return ok({
      locked: true,
      created: false,
      shareId: statement.shareId,
      recurring: statement.recurring,
      history,
      report: reportFromFinal(statement, owner.name)
    });
  } catch (error) {
    return fail(error);
  }
}
