import assert from "node:assert/strict";
import { readFile } from "fs/promises";
import path from "path";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { buildMonthlyPackets } from "@/lib/tax/packets";
import { buildGeorgetownPdf, fillSurfsidePdf } from "@/lib/tax/pdf";
import { emptyCompany } from "@/lib/tax/setup";

describe("tax packet PDFs", () => {
  it("fills the official Surfside form, including a zero-income property", async () => {
    const template = await readFile(path.join(process.cwd(), "assets/tax-forms/surfside-beach-hospitality-accommodations-2026.pdf"));
    const built = buildMonthlyPackets({
      year: 2026,
      month: 1,
      asOf: "2026-02-01",
      company: {
        ...emptyCompany(),
        legalName: "Ocean Vacations",
        address1: "210 Example St",
        city: "Surfside Beach",
        state: "SC",
        zip: "29575",
        phone: "843-555-0100",
        federalId: "12-3456789",
        surfsideAccountNumber: "SSB-9"
      },
      rosters: { surfside: ["Quiet House", "Busy House"], georgetown: [] },
      figures: [{ property: "Busy House", amountToReport: 1000, taxesCollected: 80 }]
    });
    const bytes = await fillSurfsidePdf({
      template,
      company: {
        ...emptyCompany(),
        legalName: "Ocean Vacations",
        address1: "210 Example St",
        city: "Surfside Beach",
        state: "SC",
        zip: "29575",
        phone: "843-555-0100",
        federalId: "12-3456789",
        surfsideAccountNumber: "SSB-9"
      },
      computation: built.packets[0].computation,
      properties: built.packets[0].properties,
      preparedOn: "2026-02-01"
    });
    const filled = await PDFDocument.load(bytes);
    const form = filled.getForm();
    assert.equal(form.getTextField("Gross Proceeds from Rental of Transient Accommodations").getText(), "1000.00");
    assert.equal(form.getTextField("TOTAL AMOUNT DUE").getText(), "14.70");
    assert.equal(form.getTextField("Account Number").getText(), "SSB-9");
    assert.equal(form.getTextField("Property location if different from above").getText(), "See attached list (2 properties)");
    assert.equal(form.getCheckBox("Monthly").isChecked(), true);
    assert.equal(filled.getPageCount(), 2);
    assert.match(built.packets[0].previewHtml, /Quiet House/);
    assert.match(built.packets[0].previewHtml, /\$0\.00/);
  });

  it("builds a Georgetown packet with the printed payee and merges a state return", async () => {
    const built = buildMonthlyPackets({
      year: 2026,
      month: 2,
      asOf: "2026-03-01",
      company: { ...emptyCompany(), legalName: "Ocean Vacations", georgetownCustomerNumber: "G-1" },
      rosters: { surfside: [], georgetown: ["Inlet House"] },
      figures: []
    });
    const state = await PDFDocument.create();
    state.addPage().drawText("ST-3 sample");
    const stateBytes = await state.save();
    const bytes = await buildGeorgetownPdf({
      company: { ...emptyCompany(), legalName: "Ocean Vacations", georgetownCustomerNumber: "G-1" },
      computation: built.packets[1].computation,
      properties: built.packets[1].properties,
      stateReturns: [{ filename: "st-3.pdf", bytes: stateBytes }]
    });
    const packet = await PDFDocument.load(bytes);
    assert.ok(packet.getPageCount() >= 3);
    assert.match(built.packets[1].previewHtml, /No check needed/);
    assert.match(built.packets[1].previewHtml, /Georgetown County/);
    assert.match(built.packets[1].previewHtml, /Inlet House/);
    assert.match(built.packets[1].previewHtml, /P\.O\. Box 421270/);
  });
});
