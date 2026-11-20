import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { fail } from "@/lib/http";
import { filedOnDate, fillTaxForm } from "@/lib/tax-forms/fill";
import { jurisdictionTemplate } from "@/lib/tax-forms/jurisdictions";
import { loadPreparedFiling } from "@/lib/tax-forms/load-filing";

export const runtime = "nodejs";

const schema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  monthsLate: z.coerce.number().int().min(0).max(24).optional().default(0),
  jurisdictionId: z.string().min(1)
});

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const body = schema.parse(await req.json());
    const stored = await jurisdictionTemplate(body.jurisdictionId);
    if (!stored) throw Object.assign(new Error("Jurisdiction not found."), { status: 404 });
    if (!stored.bytes?.length) {
      throw Object.assign(new Error("Upload the official fillable PDF for this jurisdiction in Settings."), { status: 400 });
    }
    const filing = await loadPreparedFiling(body.month, body.year, body.monthsLate);
    const prepared = filing.jurisdictions.find((item) => item.settings.id === body.jurisdictionId);
    if (!prepared) throw Object.assign(new Error("That jurisdiction is not on this return."), { status: 404 });
    const pdf = await fillTaxForm(stored.bytes, {
      settings: prepared.settings,
      result: prepared.result,
      rows: prepared.rows,
      year: body.year,
      month: body.month,
      filedOn: filedOnDate()
    });
    const filename = `${prepared.settings.formKind}-${body.year}-${String(body.month).padStart(2, "0")}.pdf`;
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename.replace(/[^a-z0-9.-]+/gi, "-")}"`
      }
    });
  } catch (error) {
    return fail(error);
  }
}
