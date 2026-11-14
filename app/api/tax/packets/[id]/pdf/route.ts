import { NextRequest } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { packetPdf } from "@/lib/tax/service";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAdmin(req);
    const { id } = await params;
    const pdf = await packetPdf(id);
    return new Response(pdf.bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${pdf.filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to build the packet PDF.";
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    return new Response(message, { status });
  }
}
