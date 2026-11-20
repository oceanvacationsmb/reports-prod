import { PDFBool, PDFDocument, PDFName, StandardFonts, rgb } from "pdf-lib";
import type { ScheduleRow } from "@/lib/tax-forms/prepare";
import { mailingBlock, type JurisdictionSettings } from "@/lib/tax-forms/prepare";
import { moneyText, type JurisdictionTaxResult } from "@/lib/tax-forms/calculate";
import { monthAbbrev, periodEndingDate, periodLabel } from "@/lib/tax-forms/period";
import { readablePdf } from "@/lib/tax-forms/decrypt-pdf";

export type FilledReturn = {
  settings: JurisdictionSettings;
  result: JurisdictionTaxResult;
  rows: ScheduleRow[];
  year: number;
  month: number;
  filedOn: string;
};

function setText(form: ReturnType<PDFDocument["getForm"]>, name: string, value: string) {
  try {
    const field = form.getTextField(name);
    field.setFontSize(8);
    field.setText(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/no form field/i.test(message) || /is not a text field/i.test(message)) {
      throw Object.assign(new Error(`The official form is missing the "${name}" field. Upload the original fillable PDF.`), { status: 400 });
    }
    throw error;
  }
}

function setOptionalText(form: ReturnType<PDFDocument["getForm"]>, name: string, value: string) {
  try {
    const field = form.getTextField(name);
    field.setFontSize(8);
    field.setText(value);
  } catch {
    // Some official copies omit unused identity lines.
  }
}

async function checkMonthly(pdf: PDFDocument, form: ReturnType<PDFDocument["getForm"]>) {
  try {
    const box = form.getCheckBox("Monthly");
    box.check();
    const widget = box.acroField.getWidgets()[0];
    const rect = widget.getRectangle();
    const page = pdf.getPages()[0];
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    page.drawText("X", {
      x: rect.x + 4,
      y: rect.y + 4,
      size: 11,
      font,
      color: rgb(0.06, 0.15, 0.13)
    });
  } catch {
    throw Object.assign(new Error('The official form is missing the "Monthly" filing box. Upload the original fillable PDF.'), { status: 400 });
  }
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

function drawSignature(pdf: PDFDocument, text: string, x: number, y: number) {
  const page = pdf.getPages()[0];
  const font = pdf.embedFont(StandardFonts.Helvetica);
  return font.then((face) => {
    page.drawText(text, { x, y, size: 10, font: face, color: rgb(0.06, 0.15, 0.13) });
  });
}

function fillGeorgetown(form: ReturnType<PDFDocument["getForm"]>, filled: FilledReturn) {
  const settings = filled.settings;
  const result = filled.result;
  setText(form, "Business Name", settings.businessName);
  setOptionalText(form, "Customer Number", settings.accountNumber);
  setOptionalText(form, "Owners Name", settings.ownerName || settings.businessName);
  setOptionalText(form, "Phone Number1", settings.phone);
  setOptionalText(form, "Mailing Address", settings.street);
  setOptionalText(form, "City", settings.city);
  setOptionalText(form, "State", settings.state);
  setOptionalText(form, "Zip Code", settings.postalCode);
  setOptionalText(form, "Feceral ID No", settings.federalId);
  setOptionalText(form, "Email Address", settings.email);
  setText(form, "Month", monthAbbrev(filled.month));
  setText(form, "Year", String(filled.year));
  setText(form, "Gross Proceeds from Sales", amount(result, "1"));
  setText(form, "Less: Retail Sales NOT Subject to Hospitality Tax", amount(result, "2"));
  setText(form, "Food and Beverage Sales Subject to Hospitality Tax", amount(result, "3"));
  setText(form, "Local Hospitality Tax Due", amount(result, "4"));
  setText(form, "Gross Proceeds from Sales Subject to Accommodation Tax", amount(result, "5"));
  setText(form, "Less:  Rentals Thirty (30) or More Days NOT Subject to Local Accommodation Tax", amount(result, "6"));
  setText(form, "Rentals Subject to Local Accommodation Tax", amount(result, "7"));
  setText(form, "Local Accommodation Tax Due", amount(result, "8"));
  setText(form, "Taxes Due", amount(result, "9"));
  setText(form, "Penalty on Delinquent Taxes: Line 9 X 5% for EACH month late", amount(result, "10"));
  setText(form, "Total Amount Due (Line 9 + Line 10)", amount(result, "11"));
  setOptionalText(form, "Position", settings.position);
  setOptionalText(form, "Phone Number2", settings.phone);
  setOptionalText(form, "Date4", filled.filedOn);
}

function propertyLocation(rows: ScheduleRow[]) {
  const lines = rows.map((row) => row.addressLine || row.property).filter(Boolean);
  const joined = lines.join("; ");
  if (!joined) return "";
  if (joined.length <= 180) return joined;
  return "See attached property schedule";
}

async function fillSurfside(pdf: PDFDocument, form: ReturnType<PDFDocument["getForm"]>, filled: FilledReturn) {
  const settings = filled.settings;
  const result = filled.result;
  setText(form, "DBA Name and Address", mailingBlock(settings));
  setText(form, "Account Number", settings.accountNumber);
  setOptionalText(form, "Property location if different from above", propertyLocation(filled.rows));
  setText(form, "Period Ending or Quarter Ending", periodEndingDate(filled.year, filled.month));
  await checkMonthly(pdf, form);
  setText(form, "Gross Proceeds From Sale of Food or Beverages", amount(result, "1"));
  setText(form, "Gross Proceeds from Rental of Transient Accommodations", amount(result, "2"));
  setText(form, "Gross Proceeds from Paid Admissions andor Amusements 1", amount(result, "3"));
  setText(form, "Total Gross Proceeds", amount(result, "4"));
  setText(form, "Line 4 x .01", amount(result, "5"));
  setText(form, "Line 5 x .05", amount(result, "6"));
  setText(form, "Hospitality Discount If Filed Timely", amount(result, "7"));
  setText(form, "Total Hospitatlity Fee", amount(result, "8"));
  setText(form, "Line 2 x .005", amount(result, "9"));
  setText(form, "Line 9 x .05", amount(result, "10"));
  setText(form, "Accomadations Discount If Filed Timely", amount(result, "11"));
  setText(form, "Total Accomadations Tax", amount(result, "12"));
  setText(form, "TOTAL AMOUNT DUE", amount(result, "total"));
  setOptionalText(form, "Telephone", settings.phone);
  setOptionalText(form, "Date", filled.filedOn);
}

export async function fillTaxForm(template: Uint8Array, filled: FilledReturn) {
  const bytes = await readablePdf(template);
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  if (filled.settings.formKind === "surfside") await fillSurfside(pdf, form, filled);
  else fillGeorgetown(form, filled);
  form.updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
  try {
    form.acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
  } catch {
    // The values are already written into the fields.
  }
  await appendSchedule(pdf, filled);
  if (filled.settings.signatureName) {
    await drawSignature(pdf, filled.settings.signatureName, filled.settings.formKind === "surfside" ? 110 : 48, filled.settings.formKind === "surfside" ? 96 : 64);
  }
  return pdf.save();
}

export function filedOnDate(today = new Date()) {
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${today.getFullYear()}`;
}
