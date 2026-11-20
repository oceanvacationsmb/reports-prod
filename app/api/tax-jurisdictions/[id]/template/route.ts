import { NextRequest } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { TaxJurisdiction } from "@/lib/models";
import { readablePdf } from "@/lib/tax-forms/decrypt-pdf";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAdmin(req);
    await connectDb();
    const { id } = await params;
    const form = await req.formData();
    const file = form.get("template");
    if (!(file instanceof File)) throw Object.assign(new Error("Choose the official fillable PDF."), { status: 400 });
    if (file.size > 8_000_000) throw Object.assign(new Error("That PDF is too large."), { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const readable = await readablePdf(bytes);
    const doc = await TaxJurisdiction.findByIdAndUpdate(
      id,
      { $set: { template: Buffer.from(readable), templateFilename: file.name || "form.pdf" } },
      { new: true }
    ).select("templateFilename").lean();
    if (!doc) throw Object.assign(new Error("Jurisdiction not found."), { status: 404 });
    return ok({ templateFilename: doc.templateFilename || "" });
  } catch (error) {
    return fail(error);
  }
}
