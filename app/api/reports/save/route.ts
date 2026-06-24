import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { SavedReport } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";
import { makeShareId } from "@/lib/reporting/reports";

const schema = z.object({
  ownerId: z.string().nullable().optional(),
  reportKey: z.string().min(1),
  reportTitle: z.string().min(1),
  periodLabel: z.string().optional().default(""),
  htmlSnapshot: z.string().min(1)
});

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const body = schema.parse(await req.json());
    const ownerId = body.ownerId || null;

    const saved = await SavedReport.create({
      ownerId,
      reportKey: body.reportKey,
      reportTitle: body.reportTitle,
      periodLabel: body.periodLabel,
      htmlSnapshot: body.htmlSnapshot,
      shareId: makeShareId()
    });
    return ok({ savedReport: asPlain(saved) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
