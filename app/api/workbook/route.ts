import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { OwnerStatementVersion, Setting } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";
import { normalizeMapping, type WorkbookEntry } from "@/lib/workbook/update";
import { updateXlsxWorkbook } from "@/lib/workbook/xlsx";

const mappingKey = "workbook-mapping";

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const setting = await Setting.findOne({ key: mappingKey }).lean();
    return ok({ mapping: normalizeMapping(setting?.value) });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    assertAdmin(req);
    const mapping = normalizeMapping(await req.json());
    if (!mapping.sheetName) throw Object.assign(new Error("Enter the sheet name."), { status: 400 });
    await connectDb();
    await Setting.updateOne({ key: mappingKey }, { $set: { value: mapping } }, { upsert: true });
    return ok({ mapping });
  } catch (error) {
    return fail(error);
  }
}

const updateSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12)
});

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    const form = await req.formData();
    const period = updateSchema.parse({ year: form.get("year"), month: form.get("month") });
    const file = form.get("file");
    if (!(file instanceof File)) throw Object.assign(new Error("Choose the workbook."), { status: 400 });
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx")) {
      throw Object.assign(new Error("Save the workbook as .xlsx. Excel and OpenOffice Calc both open that file, and that is what keeps the other cells intact."), { status: 400 });
    }
    if (file.size > 15_000_000) throw Object.assign(new Error("Workbook is larger than 15 MB."), { status: 400 });
    await connectDb();
    const setting = await Setting.findOne({ key: mappingKey }).lean();
    const mapping = normalizeMapping(setting?.value);
    if (!mapping.sheetName) throw Object.assign(new Error("Map the workbook once before updating it."), { status: 400 });
    const versions = asPlain(
      await OwnerStatementVersion.find({
        year: period.year,
        month: period.month,
        status: { $in: ["approved_locked", "sent"] }
      }).lean()
    ) as { ownerId: unknown; ownerName: string; version: number; figures?: { properties?: WorkbookEntry[] } }[];
    const latest = new Map<string, (typeof versions)[number]>();
    for (const version of versions) {
      const key = String(version.ownerId);
      const current = latest.get(key);
      if (!current || version.version > current.version) latest.set(key, version);
    }
    const entries: WorkbookEntry[] = [];
    for (const version of latest.values()) {
      for (const property of version.figures?.properties || []) {
        entries.push({
          owner: version.ownerName,
          year: period.year,
          month: period.month,
          property: property.property,
          ownerPayout: Number(property.ownerPayout || 0),
          cleaning: Number(property.cleaning || 0)
        });
      }
    }
    if (!entries.length) throw Object.assign(new Error("No finalized statements for that month."), { status: 400 });
    const updated = await updateXlsxWorkbook({ bytes: Buffer.from(await file.arrayBuffer()), mapping, entries });
    return ok({
      filename: file.name.replace(/\.xlsx$/i, "") + `-updated-${period.year}-${period.month}.xlsx`,
      fileBase64: updated.bytes.toString("base64"),
      updated: updated.updated,
      unmatched: updated.unmatched,
      ambiguous: updated.ambiguous,
      skippedFormulas: updated.skippedFormulas
    });
  } catch (error) {
    return fail(error);
  }
}
