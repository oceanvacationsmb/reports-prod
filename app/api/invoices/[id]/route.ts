import { NextRequest } from "next/server";
import { assertOwnerAccess, assertUser } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { fail } from "@/lib/http";
import { InvoiceFile } from "@/lib/models";

export const runtime = "nodejs";

function safeFilename(value: string) {
  return value.replace(/["\r\n]/g, "").trim() || "invoice";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = assertUser(req);
    const { id } = await params;
    await connectDb();
    const invoice = await InvoiceFile.findById(id).lean();
    if (!invoice) throw Object.assign(new Error("Invoice not found."), { status: 404 });
    assertOwnerAccess(user, String(invoice.ownerId));
    const bytes = Buffer.from(invoice.data.buffer || invoice.data);

    return new Response(bytes, {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": `inline; filename="${safeFilename(invoice.filename)}"`,
        "Content-Length": String(bytes.length),
        "Content-Type": invoice.contentType,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return fail(error);
  }
}
