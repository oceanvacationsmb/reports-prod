import { NextRequest } from "next/server";
import { assertOwnerAccess, userFromRequest } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { fail } from "@/lib/http";
import { InvoiceFile, SavedReport } from "@/lib/models";

export const runtime = "nodejs";

function safeFilename(value: string) {
  return value.replace(/["\r\n]/g, "").trim() || "invoice";
}

function reportReferencesInvoice(html: string, invoiceId: string) {
  return new RegExp(`/api/invoices/${invoiceId}(?:[?"'#]|$)`, "i").test(html);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await connectDb();
    const invoice = await InvoiceFile.findById(id).lean();
    if (!invoice) throw Object.assign(new Error("Invoice not found."), { status: 404 });

    const user = userFromRequest(req);
    if (user) {
      assertOwnerAccess(user, String(invoice.ownerId));
    } else {
      const shareId = req.nextUrl.searchParams.get("shareId")?.trim();
      const savedReport = shareId
        ? await SavedReport.findOne({ shareId, ownerId: invoice.ownerId }).select("htmlSnapshot").lean()
        : null;

      if (!savedReport || !reportReferencesInvoice(savedReport.htmlSnapshot, id)) {
        throw Object.assign(new Error("Unauthorized"), { status: 401 });
      }
    }

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
