import { notFound } from "next/navigation";
import { connectDb } from "@/lib/db";
import { SavedReport } from "@/lib/models";
import { asPlain } from "@/lib/http";

export default async function SharedReportPage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = await params;
  await connectDb();
  const savedReport = asPlain(await SavedReport.findOne({ shareId }).lean());
  if (!savedReport) notFound();

  return (
    <main className="shared-report-screen">
      <div className="shared-report-top">
        <div>
          <span>Shared report</span>
          <h1>{savedReport.reportTitle}</h1>
        </div>
        <p>{savedReport.periodLabel}</p>
      </div>
      <section className="report-preview" dangerouslySetInnerHTML={{ __html: savedReport.htmlSnapshot }} />
    </main>
  );
}
