import { redirect } from "next/navigation";
import { isPrimaryAdmin, userFromCookies } from "@/lib/auth";
import { buildOwnerBatchPrint } from "@/lib/owner-batch-server";

export default async function PrintBatchPage({
  searchParams
}: {
  searchParams: Promise<{ month?: string; year?: string; print?: string }>;
}) {
  const user = await userFromCookies();
  if (!user || !isPrimaryAdmin(user)) redirect("/login");
  const params = await searchParams;
  const month = Number(params.month);
  const year = Number(params.year);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) redirect("/dashboard");
  const html = await buildOwnerBatchPrint(month, year);

  return (
    <main className="print-report-screen">
      <div className="print-toolbar">
        <button type="button" id="print-batch-button" className="primary-action">
          Print
        </button>
      </div>
      <section className="print-report-document" dangerouslySetInnerHTML={{ __html: html }} />
      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.getElementById('print-batch-button')?.addEventListener('click', () => window.print());
            ${params.print === "1" ? "window.addEventListener('load', () => setTimeout(() => window.print(), 250));" : ""}
          `
        }}
      />
    </main>
  );
}
