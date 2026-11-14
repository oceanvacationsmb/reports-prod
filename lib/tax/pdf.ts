import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { OfficialComputation } from "@/lib/tax/official-forms";
import { lineAmount } from "@/lib/tax/official-forms";
import type { PropertyIncome } from "@/lib/tax/packets";
import { formatLongDate, money, periodStart, plainAmount } from "@/lib/tax/money";
import type { TaxCompanyProfile } from "@/lib/tax/setup";
import { companyMailingBlock } from "@/lib/tax/setup";

const templatePath = path.join(process.cwd(), "assets/tax-forms/surfside-beach-hospitality-accommodations-2026.pdf");

function setText(form: ReturnType<PDFDocument["getForm"]>, name: string, value: string) {
  const field = form.getTextField(name);
  field.setText(value);
  field.setFontSize(8);
}

export async function loadSurfsideTemplate() {
  return readFile(templatePath);
}

export async function fillSurfsidePdf(input: {
  template: Uint8Array | Buffer;
  company: TaxCompanyProfile;
  computation: OfficialComputation;
  properties: PropertyIncome[];
  preparedOn: string;
}) {
  const document = await PDFDocument.load(input.template);
  const form = document.getForm();
  const rental = lineAmount(input.computation, "2");
  const hospitalityDiscount = lineAmount(input.computation, "7");
  const accommodationsDiscount = lineAmount(input.computation, "11");
  const mailing = companyMailingBlock(input.company).join("\n");
  const propertyLocation =
    input.properties.length <= 1
      ? input.properties[0]?.property || ""
      : `See attached list (${input.properties.length} properties)`;

  setText(form, "Period Ending or Quarter Ending", formatLongDate(input.computation.periodEnding));
  setText(form, "Period Dates", `${periodStartFromEnding(input.computation.periodEnding)} - ${input.computation.periodEnding}`);
  setText(form, "Gross Proceeds From Sale of Food or Beverages", plainAmount(lineAmount(input.computation, "1")));
  setText(form, "Gross Proceeds from Rental of Transient Accommodations", plainAmount(rental));
  setText(form, "Gross Proceeds from Paid Admissions andor Amusements 1", plainAmount(lineAmount(input.computation, "3")));
  setText(form, "Total Gross Proceeds", plainAmount(lineAmount(input.computation, "4")));
  setText(form, "Line 4 x .01", plainAmount(lineAmount(input.computation, "5")));
  setText(form, "Line 5 x .05", plainAmount(lineAmount(input.computation, "6")));
  setText(form, "Discount For Returns Filed Timely", plainAmount(money(hospitalityDiscount + accommodationsDiscount)));
  setText(form, "Total Hospitatlity Fee", plainAmount(lineAmount(input.computation, "8")));
  setText(form, "Line 2 x .005", plainAmount(lineAmount(input.computation, "9")));
  setText(form, "Line 9 x .05", plainAmount(lineAmount(input.computation, "10")));
  setText(form, "Total Accomadations Tax", plainAmount(lineAmount(input.computation, "12")));
  setText(form, "TOTAL AMOUNT DUE", plainAmount(input.computation.remittance.checkAmount));
  setText(form, "DBA Name and Address", mailing);
  setText(form, "Account Number", input.company.surfsideAccountNumber);
  setText(form, "Telephone", input.company.phone);
  setText(form, "Date", input.preparedOn);
  setText(form, "Property location if different from above", propertyLocation);
  form.getCheckBox("Monthly").check();

  const font = await document.embedFont(StandardFonts.Helvetica);
  drawPropertyPages(document, font, "Surfside Beach properties", input.properties, input.computation);
  form.updateFieldAppearances(font);
  return document.save();
}

function periodStartFromEnding(ending: string) {
  return `${ending.slice(0, 8)}01`;
}

export async function buildGeorgetownPdf(input: {
  company: TaxCompanyProfile;
  computation: OfficialComputation;
  properties: PropertyIncome[];
  stateReturns?: { filename: string; bytes: Uint8Array | Buffer }[];
}) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const page = document.addPage([612, 792]);
  let y = 750;
  const write = (text: string, size = 10, used = font) => {
    page.drawText(text, { x: 48, y, size, font: used, color: rgb(0.06, 0.15, 0.13) });
    y -= size + 6;
  };
  write("Georgetown County, South Carolina", 14, bold);
  write("Local Hospitality / Local Accommodation Tax Reporting Form", 11, bold);
  write(input.computation.periodLabel, 10);
  write("Completed from the official line items. The county PDF is encrypted and has no fillable fields.", 8);
  y -= 6;
  write(`Business: ${input.company.legalName || input.company.dba || ""}`);
  write(companyMailingBlock(input.company).slice(1).join(", "));
  write(`Federal ID: ${input.company.federalId}    SC sales tax no.: ${input.company.scSalesTaxNumber}`);
  write(`Customer no.: ${input.company.georgetownCustomerNumber}    Phone: ${input.company.phone}`);
  y -= 8;
  for (const line of input.computation.lines) {
    write(`${line.line}. ${line.label}: ${plainAmount(line.amount)}`);
  }
  y -= 8;
  write(input.computation.remittance.noCheckNeeded ? "No check needed" : `Check amount: ${plainAmount(input.computation.remittance.checkAmount)}`, 12, bold);
  write(`Payee: ${input.computation.remittance.payee}`, 11, bold);
  for (const line of input.computation.remittance.mailingAddress) write(line);
  write(`Postmark deadline: ${input.computation.remittance.deadlineLabel}`, 11, bold);
  drawPropertyPages(document, font, "Georgetown County properties", input.properties, input.computation);
  const notes: string[] = [];
  for (const stateReturn of input.stateReturns || []) {
    try {
      const attached = await PDFDocument.load(stateReturn.bytes);
      const pages = await document.copyPages(attached, attached.getPageIndices());
      pages.forEach((copied) => document.addPage(copied));
    } catch {
      notes.push(`${stateReturn.filename} is stored with this month but could not be merged into the packet. Print it from the state-return button.`);
    }
  }
  if (notes.length) {
    const notePage = document.addPage([612, 792]);
    notes.forEach((note, index) => {
      notePage.drawText(note, { x: 48, y: 740 - index * 24, size: 11, font, color: rgb(0.06, 0.15, 0.13) });
    });
  }
  return document.save();
}

function drawPropertyPages(
  document: PDFDocument,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  title: string,
  properties: PropertyIncome[],
  computation: OfficialComputation
) {
  const rows = properties.length ? properties : [];
  const chunks: PropertyIncome[][] = [];
  for (let index = 0; index < Math.max(rows.length, 1); index += 32) chunks.push(rows.slice(index, index + 32));
  if (!chunks.length) chunks.push([]);
  chunks.forEach((chunk, chunkIndex) => {
    const page = document.addPage([612, 792]);
    page.drawText(`${title} (${chunkIndex + 1} of ${chunks.length})`, { x: 48, y: 750, size: 14, font, color: rgb(0.06, 0.15, 0.13) });
    page.drawText(`Period ending ${computation.periodEnding}. Includes properties with $0 income.`, {
      x: 48,
      y: 730,
      size: 9,
      font,
      color: rgb(0.06, 0.15, 0.13)
    });
    let y = 704;
    const body = chunk.length ? chunk : [];
    if (!body.length) {
      page.drawText("No properties are on this list yet.", { x: 48, y, size: 11, font, color: rgb(0.06, 0.15, 0.13) });
      return;
    }
    for (const property of body) {
      page.drawText(`${property.property}    ${plainAmount(property.grossReceipts)}`, {
        x: 48,
        y,
        size: 10,
        font,
        color: rgb(0.06, 0.15, 0.13)
      });
      y -= 18;
    }
  });
}

export { periodStart };
