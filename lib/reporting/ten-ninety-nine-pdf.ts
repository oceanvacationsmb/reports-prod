import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Annual1099Report } from "@/lib/reporting/ten-ninety-nine";

function money(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export async function annual1099Pdf(report: Annual1099Report) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 750;
  const write = (text: string, size: number, face: typeof font) => {
    const lines = text.length > 90 ? [text.slice(0, 90), text.slice(90)] : [text];
    for (const line of lines) {
      if (y < 48) {
        page = pdf.addPage([612, 792]);
        y = 750;
      }
      page.drawText(line, { x: 40, y, size, font: face, color: rgb(0.06, 0.15, 0.13) });
      y -= size + 5;
    }
  };
  write(`1099 report ${report.year}`, 16, bold);
  write(`1099 amount: ${report.basisLabel}`, 10, font);
  y -= 6;
  for (const owner of report.owners) {
    write(owner.ownerName, 13, bold);
    write(`Properties: ${owner.properties.length ? owner.properties.join(", ") : "none on file"}`, 9, font);
    write(
      owner.finalCount
        ? `Total from ${owner.finalCount} of 12 final months: ${money(owner.annualTotal)}`
        : "No final statements yet",
      12,
      bold
    );
    for (const month of owner.months) {
      if (month.status === "missing") {
        write(`${month.label}: Not final`, 9, font);
      } else if (month.status === "deposit-missing") {
        write(`${month.label}: Deposit not recorded`, 9, font);
      } else {
        write(`${month.label}: ${money(month.reportingAmount || 0)}`, 9, font);
      }
    }
    const missing = owner.months.filter((month) => month.status === "missing").length;
    if (owner.finalCount && missing) {
      const sentence = missing === 1
        ? "1 month isn't final yet. It needs a sent statement."
        : `${missing} months aren't final yet. Each needs a sent statement.`;
      write(sentence, 9, font);
    }
    if (owner.propertyReports.some((property) => property.notSplitMonths.length)) {
      write("A locked month marked Not split on statement did not store that property's amount. It stays in the owner total.", 9, font);
    }
    for (const property of owner.propertyReports) {
      y -= 4;
      write(property.property, 11, bold);
      write(
        property.months.some((month) => month.status === "final")
          ? `Annual total ${money(property.annualTotal)}`
          : "No property amount on the locked statements.",
        10,
        font
      );
      for (const month of property.months) {
        const amount = month.status === "missing"
          ? "Not final"
          : month.status === "deposit-missing"
            ? "Deposit not recorded"
            : month.status === "not-split"
              ? "Not split on statement"
              : money(month.reportingAmount || 0);
        write(`${month.label}: ${amount}`, 9, font);
      }
    }
    y -= 8;
  }
  if (report.owners.length > 1) write(`All owners ${money(report.annualTotal)}`, 12, bold);
  return pdf.save();
}
