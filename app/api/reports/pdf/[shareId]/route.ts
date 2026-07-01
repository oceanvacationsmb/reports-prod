import chromium from "@sparticuz/chromium";
import { readFile } from "fs/promises";
import path from "path";
import puppeteer from "puppeteer-core";
import { connectDb } from "@/lib/db";
import { SavedReport } from "@/lib/models";
import { stripReportEditControls } from "@/lib/reporting/sanitize";

export const runtime = "nodejs";
export const maxDuration = 60;

const chromePaths = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
];

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function findLocalChrome() {
  for (const chromePath of chromePaths) {
    try {
      await readFile(chromePath);
      return chromePath;
    } catch {
      // Try the next browser path.
    }
  }
  return "";
}

async function renderPdf(html: string, title: string) {
  const localChrome = await findLocalChrome();
  const css = await readFile(path.join(process.cwd(), "app/globals.css"), "utf8");

  const document = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>${css}</style>
    <style>
      body { background: #fff; }
      .pdf-shell { background: #fff; }
      .row-actions { display: none !important; }
      .table-wrap { overflow: visible !important; }
      .report-document { min-width: 0 !important; box-shadow: none; }
      @page { size: letter portrait; margin: 0.45in; }
      @media print {
        .report-document { width: 100%; }
        .report-hero h1 { font-size: 20pt; }
        th, td { font-size: 6.6pt; padding: 3px 4px; }
        th { font-size: 5.9pt; }
        .metric { padding: 5px; }
        .gri-document .report-hero {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          column-gap: 18px;
          row-gap: 4px;
          align-items: start;
          padding-bottom: 14px;
        }
        .gri-document .report-hero p {
          grid-column: 1;
          margin-bottom: 2px;
          font-size: 0;
        }
        .gri-document .report-hero p::before {
          content: "OCEAN VACATIONS INC.";
          display: block;
          color: var(--jade);
          font-size: 10pt;
          font-weight: 800;
        }
        .gri-document .report-hero p::after {
          content: "www.oceanvacationsmb.com";
          display: block;
          margin-top: 8px;
          color: #18221f;
          font-size: 8.5pt;
          font-weight: 400;
          text-transform: none;
        }
        .gri-document .report-hero h1 {
          grid-column: 1 / -1;
          grid-row: 4;
          margin-top: 14px;
          text-align: center;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 12pt;
          font-weight: 800;
          line-height: 1.25;
        }
        .gri-document .gri-title-label {
          display: none;
        }
        .gri-document .report-hero > span {
          grid-column: 2;
          grid-row: 1;
          margin-top: 0;
          color: #18221f;
          font-size: 9pt;
          font-weight: 800;
          text-align: right;
        }
        .gri-document .report-hero > span::before {
          content: "PERIOD ";
          color: #6f817c;
          font-weight: 800;
        }
        .gri-document .report-hero-details {
          grid-column: 1;
          margin-top: 0;
          gap: 2px;
          display: grid;
          font-size: 8.5pt;
        }
        .gri-document .metric-grid {
          display: block;
          margin: 12px 0 14px;
        }
        .gri-document .metric:first-child {
          display: none;
        }
        .gri-document .metric {
          min-height: 0;
          padding: 12px;
          text-align: center;
        }
        .gri-document .metric span,
        .gri-document .metric strong {
          display: block;
        }
        .gri-document .metric span {
          font-size: 7pt;
          font-weight: 800;
        }
        .gri-document .metric strong {
          margin-top: 5px;
          font-size: 13pt;
        }
        .gri-document .property-section {
          margin-top: 0;
          padding-top: 0;
          border-top: 0;
        }
        .gri-document .property-header {
          display: none;
        }
        .gri-document th,
        .gri-document td {
          font-size: 7pt;
          padding: 4px 5px;
        }
      }
    </style>
  </head>
  <body>
    <main class="pdf-shell">
      ${html}
    </main>
  </body>
</html>`;

  const browser = await puppeteer.launch({
    args: localChrome
      ? ["--disable-gpu", "--no-sandbox", "--disable-setuid-sandbox"]
      : await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: localChrome || await chromium.executablePath(),
    headless: localChrome ? true : "shell"
  });

  try {
    const page = await browser.newPage();
    await page.setContent(document, { waitUntil: "load" });
    const pdf = await page.pdf({
      displayHeaderFooter: false,
      format: "letter",
      preferCSSPageSize: true,
      printBackground: true
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ shareId: string }> }) {
  try {
    const { shareId } = await params;
    await connectDb();
    const savedReport = await SavedReport.findOne({ shareId }).lean();
    if (!savedReport) return new Response("Saved report not found.", { status: 404 });

    const pdf = await renderPdf(stripReportEditControls(savedReport.htmlSnapshot), savedReport.reportTitle);
    const filename = `${String(savedReport.reportTitle || "ocean-vacations-report").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}.pdf`;

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate PDF.";
    return new Response(message, { status: 500 });
  }
}
