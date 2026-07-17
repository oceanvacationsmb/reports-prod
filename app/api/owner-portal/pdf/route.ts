import chromium from "@sparticuz/chromium";
import { readFile } from "fs/promises";
import path from "path";
import puppeteer from "puppeteer-core";
import { NextRequest } from "next/server";
import { assertOwnerAccess, assertUser, isPrimaryAdmin } from "@/lib/auth";
import { loadOwnerPortal } from "@/lib/owner-portal";
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
      // Try the next installed browser.
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
          .property-section, .table-wrap, table {
            break-inside: auto !important;
            page-break-inside: auto !important;
          }
          .table-wrap { overflow: visible !important; }
          .report-document h2, .report-document h3, .statement-subhead {
            break-after: avoid-page;
            page-break-after: avoid;
          }
          thead { display: table-header-group; }
          .report-document { min-width: 0 !important; width: 100%; box-shadow: none; }
          @page { size: letter portrait; margin: 0.45in; }
          @media print {
            .report-hero h1 { font-size: 20pt; }
            th, td { font-size: 6.6pt; padding: 3px 4px; }
            th { font-size: 5.9pt; }
            .metric { padding: 5px; }
          }
        </style>
      </head>
      <body><main class="pdf-shell">${stripReportEditControls(html)}</main></body>
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

export async function GET(req: NextRequest) {
  try {
    const user = assertUser(req);
    const requestedOwnerId = req.nextUrl.searchParams.get("ownerId");
    const ownerId = isPrimaryAdmin(user) ? requestedOwnerId || user.ownerId : user.ownerId;
    assertOwnerAccess(user, ownerId);
    if (!ownerId) throw Object.assign(new Error("Owner account is not connected yet."), { status: 400 });

    const year = Number(req.nextUrl.searchParams.get("year")) || new Date().getFullYear();
    const monthText = req.nextUrl.searchParams.get("month");
    const monthNumber = Number(monthText);
    const month = monthText === "full-year"
      ? null
      : monthNumber >= 1 && monthNumber <= 12
        ? monthNumber
        : new Date().getMonth() + 1;
    const portal = await loadOwnerPortal(ownerId, year, month);
    const pdf = await renderPdf(portal.report.html, portal.report.title);
    const period = month ? `${year}-${String(month).padStart(2, "0")}` : String(year);
    const ownerName = portal.owner.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "owner";
    const filename = `${ownerName}-Statement-${period}.pdf`;

    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 500;
    const message = error instanceof Error ? error.message : "Unable to generate PDF.";
    return new Response(message, { status });
  }
}
