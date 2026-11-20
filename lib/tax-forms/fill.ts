import { PDFDict, PDFDocument, PDFName, PDFRef, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ScheduleRow } from "@/lib/tax-forms/prepare";
import { mailingBlock, type JurisdictionSettings } from "@/lib/tax-forms/prepare";
import { moneyText, type JurisdictionTaxResult } from "@/lib/tax-forms/calculate";
import { monthName, periodEndingDate, periodLabel } from "@/lib/tax-forms/period";
import { readablePdf } from "@/lib/tax-forms/decrypt-pdf";

export type FilledReturn = {
  settings: JurisdictionSettings;
  result: JurisdictionTaxResult;
  rows: ScheduleRow[];
  year: number;
  month: number;
  filedOn: string;
};

type Form = ReturnType<PDFDocument["getForm"]>;

function fittedSize(font: PDFFont, lines: string[], width: number, height: number, multiline: boolean) {
  const longest = lines.reduce((best, line) => (line.length > best.length ? line : best), "");
  let size = Math.min(11, Math.max(6, height - 3));
  const widest = () => font.widthOfTextAtSize(longest || "0", size);
  while (size > 6 && widest() > width) size -= 0.25;
  if (multiline) {
    while (size > 6 && lines.length * size * 1.2 > height) size -= 0.25;
  }
  return size;
}

function writeText(form: Form, font: PDFFont, name: string, value: string, required: boolean) {
  try {
    const field = form.getTextField(name);
    const widget = field.acroField.getWidgets()[0];
    const rect = widget?.getRectangle();
    const maxLength = field.getMaxLength();
    let text = value;
    if (typeof maxLength === "number" && maxLength > 0 && text.length > maxLength) text = text.slice(0, maxLength);
    const lines = text.split("\n");
    if (rect) {
      field.setFontSize(fittedSize(font, lines, Math.max(8, rect.width - 4), rect.height, field.isMultiline()));
    }
    field.setText(text);
    field.updateAppearances(font);
  } catch (error) {
    if (!required) return;
    const message = error instanceof Error ? error.message : "";
    if (/no form field/i.test(message) || /is not a text field/i.test(message)) {
      throw Object.assign(new Error(`The official form is missing the "${name}" field. Upload the original fillable PDF.`), { status: 400 });
    }
    throw error;
  }
}

function checkAppearance(pdf: PDFDocument, width: number, height: number) {
  const box = `0.45 0.45 ${(width - 0.9).toFixed(2)} ${(height - 0.9).toFixed(2)} re S`;
  const x1 = (width * 0.24).toFixed(2);
  const y1 = (height * 0.46).toFixed(2);
  const x2 = (width * 0.42).toFixed(2);
  const y2 = (height * 0.26).toFixed(2);
  const x3 = (width * 0.78).toFixed(2);
  const y3 = (height * 0.74).toFixed(2);
  const content = [
    "q",
    "1 1 1 rg",
    `0 0 ${width.toFixed(2)} ${height.toFixed(2)} re f`,
    "0 0 0 RG",
    "0.9 w",
    box,
    "1.25 w",
    `${x1} ${y1} m`,
    `${x2} ${y2} l`,
    `${x3} ${y3} l`,
    "S",
    "Q"
  ].join("\n");
  return pdf.context.register(
    pdf.context.stream(content, {
      Type: "XObject",
      Subtype: "Form",
      FormType: 1,
      BBox: [0, 0, width, height]
    })
  );
}

function markMonthly(pdf: PDFDocument, form: Form) {
  const box = form.getCheckBox("Monthly");
  box.check();
  const widget = box.acroField.getWidgets()[0];
  const rect = widget.getRectangle();
  const onValue = widget.getOnValue() ?? PDFName.of("Yes");
  const normal = widget.getNormalAppearance();
  const dict = normal instanceof PDFRef ? pdf.context.lookup(normal, PDFDict) : normal;
  if (!(dict instanceof PDFDict)) return;
  // The official Yes graphic is a font glyph. Replace that one stream with a path.
  // The other filing-status boxes are left as they were printed.
  dict.set(onValue, checkAppearance(pdf, rect.width, rect.height));
  widget.setAppearanceState(onValue);
}

function amount(result: JurisdictionTaxResult, line: string) {
  return moneyText(result.lines.find((item) => item.line === line)?.amount || 0);
}

async function appendSchedule(pdf: PDFDocument, filled: FilledReturn) {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 40;
  let page = pdf.addPage([612, 792]);
  let y = 750;
  const write = (text: string, size: number, face: typeof font, x = margin) => {
    if (y < 56) {
      page = pdf.addPage([612, 792]);
      y = 750;
    }
    page.drawText(text, { x, y, size, font: face, color: rgb(0.06, 0.15, 0.13) });
    y -= size + 6;
  };
  write(`Property schedule - ${filled.settings.name}`, 14, bold);
  write(periodLabel(filled.year, filled.month), 11, font);
  write("Taxable revenue is the tax report amount to report. Tax is this form's own tax before penalty or discount.", 9, font);
  y -= 6;
  const header = "Property";
  write(header, 10, bold);
  for (const row of filled.rows) {
    const locality = [row.address.street, [row.address.city, row.address.state, row.address.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    write(row.property, 10, bold);
    write(locality || row.addressLine || "Address is not on the property record", 9, font);
    write(`Taxable revenue ${moneyText(row.taxableRevenue)}    Tax ${moneyText(row.tax)}`, 9, font);
    y -= 4;
  }
  const revenue = filled.rows.reduce((sum, row) => sum + row.taxableRevenue, 0);
  const tax = filled.rows.reduce((sum, row) => sum + row.tax, 0);
  y -= 4;
  write(`Total taxable revenue ${moneyText(revenue)}`, 11, bold);
  write(`Total tax ${moneyText(tax)}`, 11, bold);
  write(`Amount due on the return ${moneyText(filled.result.totalDue)}`, 11, bold);
}

function drawFittedLine(page: PDFPage, font: PDFFont, text: string, box: { x: number; y: number; width: number; height: number }) {
  const padding = 3;
  const innerWidth = Math.max(8, box.width - padding * 2);
  let size = Math.min(10, Math.max(6, box.height - 4));
  while (size > 6 && font.widthOfTextAtSize(text, size) > innerWidth) size -= 0.25;
  const baseline = box.y + Math.max(2, (box.height - size) / 2);
  page.drawText(text, { x: box.x + padding, y: baseline, size, font, color: rgb(0.06, 0.15, 0.13) });
}

function fillGeorgetown(form: Form, font: PDFFont, filled: FilledReturn) {
  const settings = filled.settings;
  const result = filled.result;
  const put = (name: string, value: string, required = false) => writeText(form, font, name, value, required);
  put("Business Name", settings.businessName, true);
  put("Customer Number", settings.accountNumber);
  put("Owners Name", settings.ownerName || settings.businessName);
  put("Phone Number1", settings.phone);
  put("Mailing Address", settings.street);
  put("City", settings.city);
  put("State", settings.state);
  put("Zip Code", settings.postalCode);
  put("Feceral ID No", settings.federalId);
  put("Email Address", settings.email);
  put("Month", monthName(filled.month), true);
  put("Year", String(filled.year), true);
  put("Gross Proceeds from Sales", amount(result, "1"), true);
  put("Less: Retail Sales NOT Subject to Hospitality Tax", amount(result, "2"), true);
  put("Food and Beverage Sales Subject to Hospitality Tax", amount(result, "3"), true);
  put("Local Hospitality Tax Due", amount(result, "4"), true);
  put("Gross Proceeds from Sales Subject to Accommodation Tax", amount(result, "5"), true);
  put("Less:  Rentals Thirty (30) or More Days NOT Subject to Local Accommodation Tax", amount(result, "6"), true);
  put("Rentals Subject to Local Accommodation Tax", amount(result, "7"), true);
  put("Local Accommodation Tax Due", amount(result, "8"), true);
  put("Taxes Due", amount(result, "9"), true);
  put("Penalty on Delinquent Taxes: Line 9 X 5% for EACH month late", amount(result, "10"), true);
  put("Total Amount Due (Line 9 + Line 10)", amount(result, "11"), true);
  put("Position", settings.position);
  put("Phone Number2", settings.phone);
  put("Date4", filled.filedOn);
}

export function propertyLocation(rows: ScheduleRow[]) {
  const lines = rows.map((row) => row.addressLine || row.property).filter(Boolean);
  if (!lines.length) return "";
  if (lines.length > 1) return "See attached schedule";
  return lines[0];
}

function fillSurfside(form: Form, font: PDFFont, filled: FilledReturn) {
  const settings = filled.settings;
  const result = filled.result;
  const put = (name: string, value: string, required = false) => writeText(form, font, name, value, required);
  put("DBA Name and Address", mailingBlock(settings), true);
  put("Account Number", settings.accountNumber, true);
  put("Property location if different from above", propertyLocation(filled.rows));
  put("Period Ending or Quarter Ending", periodEndingDate(filled.year, filled.month), true);
  // Period Dates is labeled for 28-day filers only. A monthly return uses Period Ending.
  put("Gross Proceeds From Sale of Food or Beverages", amount(result, "1"), true);
  put("Gross Proceeds from Rental of Transient Accommodations", amount(result, "2"), true);
  put("Gross Proceeds from Paid Admissions andor Amusements 1", amount(result, "3"), true);
  put("Total Gross Proceeds", amount(result, "4"), true);
  put("Line 4 x .01", amount(result, "5"), true);
  put("Line 5 x .05", amount(result, "6"), true);
  put("Hospitality Discount If Filed Timely", amount(result, "7"), true);
  put("Total Hospitatlity Fee", amount(result, "8"), true);
  put("Line 2 x .005", amount(result, "9"), true);
  put("Line 9 x .05", amount(result, "10"), true);
  put("Accomadations Discount If Filed Timely", amount(result, "11"), true);
  put("Total Accomadations Tax", amount(result, "12"), true);
  put("TOTAL AMOUNT DUE", amount(result, "total"), true);
  put("Telephone", settings.phone);
  put("Date", filled.filedOn);
}

export async function fillTaxForm(template: Uint8Array, filled: FilledReturn) {
  const bytes = await readablePdf(template);
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  if (filled.settings.formKind === "surfside") {
    fillSurfside(form, font, filled);
    markMonthly(pdf, form);
  } else {
    fillGeorgetown(form, font, filled);
  }
  await appendSchedule(pdf, filled);
  if (filled.settings.signatureName) {
    const page = pdf.getPages()[0];
    if (filled.settings.formKind === "surfside") {
      try {
        const widget = form.getField("Taxpayers Signature").acroField.getWidgets()[0];
        const rect = widget.getRectangle();
        drawFittedLine(page, font, filled.settings.signatureName, { x: rect.x + 2, y: rect.y + 1, width: rect.width - 4, height: rect.height - 2 });
      } catch {
        drawFittedLine(page, font, filled.settings.signatureName, { x: 108, y: 94, width: 220, height: 14 });
      }
    } else {
      let box = { x: 84, y: 61, width: 206, height: 16 };
      try {
        const position = form.getTextField("Position").acroField.getWidgets()[0].getRectangle();
        box = { x: position.x - 214, y: position.y + 2, width: 204, height: Math.max(12, position.height - 4) };
      } catch {
        // The measured signature cell sits just left of Position.
      }
      drawFittedLine(page, font, filled.settings.signatureName, box);
    }
  }
  return pdf.save({ updateFieldAppearances: false });
}

export function filedOnDate(today = new Date()) {
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${today.getFullYear()}`;
}
