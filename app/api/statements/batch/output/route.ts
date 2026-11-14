import { readFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { renderPdf } from "@/app/api/reports/pdf/[shareId]/route";
import { stripReportEditControls } from "@/lib/reporting/sanitize";
import { approvedStatementHtml, printableDocument, summaryReportHtml } from "@/lib/statements/service";
import { monthLabel } from "@/lib/statements/schedule";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  kind: z.enum(["statements", "summaries", "download"])
});

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    const params = schema.parse({
      year: req.nextUrl.searchParams.get("year"),
      month: req.nextUrl.searchParams.get("month"),
      kind: req.nextUrl.searchParams.get("kind")
    });
    const label = monthLabel(params.year, params.month);
    const css = await readFile(path.join(process.cwd(), "app/globals.css"), "utf8");
    if (params.kind === "summaries") {
      const report = await summaryReportHtml(params.year, params.month);
      return new Response(printableDocument(`${label} owner summaries`, [report.html], css), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
      });
    }
    const statements = await approvedStatementHtml(params.year, params.month);
    if (!statements.length) return new Response("No approved statements for this month.", { status: 404 });
    const sections = statements.map((statement) => stripReportEditControls(statement.htmlSnapshot));
    if (params.kind === "statements") {
      return new Response(printableDocument(`${label} statements`, sections, css), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
      });
    }
    const pdf = await renderPdf(sections.join('<div style="break-after:page"></div>'), `${label} statements`);
    return new Response(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="statements-${params.year}-${params.month}.pdf"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open statements.";
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    return new Response(message, { status });
  }
}
