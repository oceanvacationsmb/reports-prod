import { notFound } from "next/navigation";
import { asPlain } from "@/lib/http";
import { connectDb } from "@/lib/db";
import { SavedReport } from "@/lib/models";
import { stripReportEditControls } from "@/lib/reporting/sanitize";

export default async function PrintReportPage({
  params,
  searchParams
}: {
  params: Promise<{ shareId: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const { shareId } = await params;
  const { print } = await searchParams;
  await connectDb();
  const savedReport = asPlain(await SavedReport.findOne({ shareId }).lean());
  if (!savedReport) notFound();

  return (
    <main className="print-report-screen">
      <div className="print-toolbar">
        <button type="button" id="print-report-button" className="primary-action">
          Download PDF
        </button>
      </div>
      <section className="print-report-document" dangerouslySetInnerHTML={{ __html: stripReportEditControls(savedReport.htmlSnapshot) }} />
      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.getElementById('print-report-button')?.addEventListener('click', () => window.print());
            ${print === "1" ? "window.addEventListener('load', () => setTimeout(() => window.print(), 250));" : ""}
          `
        }}
      />
    </main>
  );
}
