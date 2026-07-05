import { NextRequest } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { InvoiceFile } from "@/lib/models";

export const runtime = "nodejs";

const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const maxInvoiceBytes = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    const formData = await req.formData();
    const file = formData.get("file");
    const ownerId = String(formData.get("ownerId") || "");
    if (!(file instanceof File)) {
      throw Object.assign(new Error("Invoice file is required."), { status: 400 });
    }
    if (!ownerId) {
      throw Object.assign(new Error("Select an owner before uploading an invoice."), { status: 400 });
    }
    if (!allowedTypes.has(file.type)) {
      throw Object.assign(new Error("Invoice must be a PDF, JPG, PNG, or WebP file."), { status: 400 });
    }
    if (file.size > maxInvoiceBytes) {
      throw Object.assign(new Error("Invoice files must be 4 MB or smaller."), { status: 400 });
    }

    await connectDb();
    const bytes = Buffer.from(await file.arrayBuffer());
    const invoice = await InvoiceFile.create({
      ownerId,
      filename: file.name,
      contentType: file.type,
      data: bytes
    });

    return ok({ url: `/api/invoices/${invoice._id}` });
  } catch (error) {
    return fail(error);
  }
}
