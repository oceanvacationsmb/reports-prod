import { NextRequest } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { OwnerStatementVersion } from "@/lib/models";
import { stripReportEditControls } from "@/lib/reporting/sanitize";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAdmin(req);
    const { id } = await params;
    await connectDb();
    const version = await OwnerStatementVersion.findById(id).lean();
    if (!version) return new Response("Statement not found.", { status: 404 });
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${version.title || "Statement"}</title></head><body>${stripReportEditControls(version.htmlSnapshot || "")}</body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return new Response("Unable to open the statement.", { status: 500 });
  }
}
