import { NextRequest } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { TaxFiling } from "@/lib/models";
import { fail, ok } from "@/lib/http";
import { readPdfUpload } from "@/lib/uploads";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAdmin(req);
    const { id } = await params;
    const form = await req.formData();
    const file = form.get("file");
    const bytes = await readPdfUpload(file instanceof File ? file : null);
    await connectDb();
    const filing = await TaxFiling.findById(id);
    if (!filing) throw Object.assign(new Error("Filing not found."), { status: 404 });
    filing.receipt = {
      kind: "receipt",
      filename: file instanceof File ? file.name : "receipt.pdf",
      contentType: "application/pdf",
      data: bytes
    };
    await filing.save();
    return ok({ receiptFilename: filing.receipt.filename });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAdmin(req);
    const { id } = await params;
    await connectDb();
    const filing = await TaxFiling.findById(id);
    if (!filing?.receipt?.data) return new Response("Receipt not found.", { status: 404 });
    return new Response(filing.receipt.data, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filing.receipt.filename || "receipt.pdf"}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open the receipt.";
    return new Response(message, { status: 500 });
  }
}
