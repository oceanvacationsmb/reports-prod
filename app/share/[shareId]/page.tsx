import { notFound } from "next/navigation";
import { connectDb } from "@/lib/db";
import { SavedReport } from "@/lib/models";
import { asPlain } from "@/lib/http";
import { prepareSharedReportHtml } from "@/lib/reporting/sanitize";

export default async function SharedReportPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  await connectDb();
  const savedReport = asPlain(await SavedReport.findOne({ shareId }).lean());
  if (!savedReport) notFound();
  const updated = new Date(savedReport.updatedAt || savedReport.createdAt || Date.now());
  const updatedLabel = Number.isNaN(updated.getTime())
    ? ""
    : updated.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const finalStatement = savedReport.reportKey === "statement";

  return (
    <main className="shared-report-screen">
      <div className="shared-report-top">
        <div>
          <span>Shared report</span>
          {finalStatement ? (
            <p className="share-status">Final statement, last updated {updatedLabel}.</p>
          ) : (
            <h1>{savedReport.reportTitle}</h1>
          )}
        </div>
        {!finalStatement && <p>{savedReport.periodLabel}</p>}
      </div>
      <section
        className="report-preview"
        dangerouslySetInnerHTML={{ __html: prepareSharedReportHtml(savedReport.htmlSnapshot, shareId) }}
      />
    </main>
  );
}
