import { connectDb } from "@/lib/db";
import { Setting, TaxFiling, TaxPacket } from "@/lib/models";
import { asPlain } from "@/lib/http";
import { FILING_PORTALS, filingAfterExecutor, getFilingExecutor, preparePortalFiling, type FilingPortalId } from "@/lib/tax/filing";
import { buildGeorgetownPdf, fillSurfsidePdf, loadSurfsideTemplate } from "@/lib/tax/pdf";
import { buildMonthlyPackets, jurisdictionIncome, type PacketAdjustments } from "@/lib/tax/packets";
import { normalizeCompany, type TaxCompanyProfile } from "@/lib/tax/setup";
import { normalizeRosters, type TaxRosters } from "@/lib/tax/rosters";
import { loadPeriodInputs } from "@/lib/reporting/load-period";
import { statementTransferFigures } from "@/lib/reporting/reports";

const setupKey = "tax-setup";

export async function readTaxSetup() {
  await connectDb();
  const setting = await Setting.findOne({ key: setupKey }).lean();
  const value = setting?.value || {};
  return {
    company: normalizeCompany(value.company),
    rosters: normalizeRosters(value.rosters)
  };
}

export async function writeTaxSetup(company: TaxCompanyProfile, rosters: TaxRosters) {
  await connectDb();
  const value = { company: normalizeCompany(company), rosters: normalizeRosters(rosters) };
  await Setting.updateOne({ key: setupKey }, { $set: { value } }, { upsert: true });
  return value;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function periodFigures(year: number, month: number) {
  const loaded = await loadPeriodInputs(year, month);
  return loaded.owners.flatMap((owner) => {
    const ownerId = String(owner._id || owner.id);
    return statementTransferFigures(
      owner,
      loaded.reservationsByOwner.get(ownerId) || [],
      loaded.expensesByOwner.get(ownerId) || [],
      loaded.settings,
      { month, year, calculationSource: "reports" }
    ).properties;
  });
}

export async function prepareTaxPackets(year: number, month: number, adjustments: PacketAdjustments = {}) {
  const setup = await readTaxSetup();
  const figures = await periodFigures(year, month);
  const existing = asPlain(await TaxPacket.find({ year, month }).lean()) as { jurisdiction: string; stateReturns?: unknown[] }[];
  const stateCount = existing.find((packet) => packet.jurisdiction === "georgetown")?.stateReturns?.length || 0;
  const built = buildMonthlyPackets({
    year,
    month,
    asOf: todayIso(),
    company: setup.company,
    rosters: setup.rosters,
    figures,
    adjustments,
    stateReturnCount: stateCount
  });
  const saved = [];
  for (const packet of built.packets) {
    const doc = await TaxPacket.findOneAndUpdate(
      { jurisdiction: packet.jurisdiction, year, month },
      {
        $set: {
          company: setup.company,
          properties: packet.properties,
          computation: packet.computation,
          previewHtml: packet.previewHtml,
          adjustments
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    saved.push(packetDto(doc));
  }
  return saved;
}

export function packetDto(doc: {
  _id: unknown;
  jurisdiction: string;
  year: number;
  month: number;
  previewHtml?: string;
  computation?: unknown;
  properties?: unknown;
  stateReturns?: { kind?: string; filename?: string }[];
}) {
  return {
    id: String(doc._id),
    jurisdiction: doc.jurisdiction,
    year: doc.year,
    month: doc.month,
    previewHtml: doc.previewHtml || "",
    computation: doc.computation || null,
    properties: doc.properties || [],
    stateReturns: (doc.stateReturns || []).map((file, index) => ({
      index,
      kind: file.kind || "",
      filename: file.filename || "return.pdf"
    }))
  };
}

export async function listTaxPackets(year: number, month: number) {
  await connectDb();
  const docs = await TaxPacket.find({ year, month }).sort({ jurisdiction: 1 });
  return docs.map(packetDto);
}

export async function packetPdf(id: string) {
  await connectDb();
  const packet = await TaxPacket.findById(id);
  if (!packet) throw Object.assign(new Error("Tax packet not found."), { status: 404 });
  if (packet.jurisdiction === "surfside") {
    const bytes = await fillSurfsidePdf({
      template: await loadSurfsideTemplate(),
      company: normalizeCompany(packet.company),
      computation: packet.computation,
      properties: packet.properties,
      preparedOn: todayIso()
    });
    return { filename: `surfside-beach-${packet.year}-${packet.month}.pdf`, bytes: Buffer.from(bytes) };
  }
  const bytes = await buildGeorgetownPdf({
    company: normalizeCompany(packet.company),
    computation: packet.computation,
    properties: packet.properties,
    stateReturns: (packet.stateReturns || []).map((file: { filename: string; data: Buffer }) => ({
      filename: file.filename,
      bytes: file.data
    }))
  });
  return { filename: `georgetown-county-${packet.year}-${packet.month}.pdf`, bytes: Buffer.from(bytes) };
}

export async function prepareFilings(year: number, month: number) {
  const setup = await readTaxSetup();
  const figures = await periodFigures(year, month);
  const saved = [];
  for (const portal of FILING_PORTALS) {
    const existing = await TaxFiling.findOne({ portalId: portal.id, year, month });
    if (existing && (existing.status === "filed" || existing.status === "submitting")) {
      saved.push(filingDto(existing));
      continue;
    }
    const lines = jurisdictionIncome(setup.rosters[portal.rosterKey], figures);
    const draft = preparePortalFiling({ portalId: portal.id as FilingPortalId, year, month, lines });
    const doc = await TaxFiling.findOneAndUpdate(
      { portalId: portal.id, year, month },
      {
        $set: {
          lines: draft.lines,
          totalGross: draft.totalGross,
          totalTaxesCollected: draft.totalTaxesCollected,
          paymentRequired: draft.paymentRequired,
          paymentNote: draft.paymentNote,
          entryNote: draft.entryNote,
          status: "prepared",
          executorMessage: "",
          confirmationId: "",
          approvedAt: null,
          approvedBy: ""
        }
      },
      { upsert: true, new: true }
    );
    saved.push(filingDto(doc));
  }
  return saved;
}

export function filingDto(doc: {
  _id: unknown;
  portalId: string;
  year: number;
  month: number;
  status: string;
  lines?: unknown;
  totalGross?: number;
  totalTaxesCollected?: number;
  paymentRequired?: boolean;
  paymentNote?: string;
  entryNote?: string;
  approvedAt?: Date | null;
  executorMessage?: string;
  confirmationId?: string;
  receipt?: { filename?: string } | null;
}) {
  const portal = FILING_PORTALS.find((item) => item.id === doc.portalId);
  return {
    id: String(doc._id),
    portalId: doc.portalId,
    label: portal?.label || doc.portalId,
    url: portal?.url || "",
    year: doc.year,
    month: doc.month,
    status: doc.status,
    lines: doc.lines || [],
    totalGross: doc.totalGross || 0,
    totalTaxesCollected: doc.totalTaxesCollected || 0,
    paymentRequired: Boolean(doc.paymentRequired),
    paymentNote: doc.paymentNote || "",
    entryNote: doc.entryNote || "",
    approvedAt: doc.approvedAt || null,
    executorMessage: doc.executorMessage || "",
    confirmationId: doc.confirmationId || "",
    receiptFilename: doc.receipt?.filename || ""
  };
}

export async function listFilings(year: number, month: number) {
  await connectDb();
  const docs = await TaxFiling.find({ year, month }).sort({ portalId: 1 });
  return docs.map(filingDto);
}

export async function approveFiling(id: string, approvedBy: string) {
  await connectDb();
  const claimed = await TaxFiling.findOneAndUpdate(
    { _id: id, status: "prepared" },
    { $set: { status: "submitting", approvedAt: new Date(), approvedBy } },
    { new: true }
  );
  if (!claimed) throw Object.assign(new Error("This return is not waiting for approval."), { status: 409 });
  const draft = preparePortalFiling({
    portalId: claimed.portalId,
    year: claimed.year,
    month: claimed.month,
    lines: claimed.lines
  });
  try {
    const executor = getFilingExecutor();
    const result = await executor.submit(draft);
    const applied = filingAfterExecutor(result);
    claimed.status = applied.status;
    claimed.executorId = executor.id;
    claimed.executorMessage = applied.message;
    claimed.confirmationId = applied.confirmationId;
    await claimed.save();
    return filingDto(claimed);
  } catch (error) {
    claimed.status = "failed";
    claimed.executorMessage = error instanceof Error ? error.message : "Filing executor failed.";
    await claimed.save();
    throw error;
  }
}
