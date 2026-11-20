import { connectDb } from "@/lib/db";
import { TaxJurisdiction } from "@/lib/models";
import type { TaxFormKind } from "@/lib/tax-forms/calculate";
import type { JurisdictionSettings } from "@/lib/tax-forms/prepare";

export type JurisdictionInput = {
  name: string;
  slug: string;
  formKind: TaxFormKind;
  accountNumber?: string;
  federalId?: string;
  businessName?: string;
  ownerName?: string;
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  email?: string;
  accommodationRate?: number;
  hospitalityRate?: number;
  discountRate?: number;
  penaltyRatePerMonth?: number;
  signatureName?: string;
  position?: string;
  phone?: string;
};

function text(value: unknown) {
  return String(value || "").trim();
}

export function jurisdictionSettings(doc: Record<string, unknown>): JurisdictionSettings {
  return {
    id: String(doc._id || ""),
    name: text(doc.name),
    formKind: doc.formKind === "surfside" ? "surfside" : "georgetown",
    accountNumber: text(doc.accountNumber),
    federalId: text(doc.federalId),
    businessName: text(doc.businessName),
    ownerName: text(doc.ownerName),
    street: text(doc.street),
    city: text(doc.city),
    state: text(doc.state),
    postalCode: text(doc.postalCode),
    email: text(doc.email),
    accommodationRate: Number(doc.accommodationRate || 0),
    hospitalityRate: Number(doc.hospitalityRate || 0),
    discountRate: Number(doc.discountRate || 0),
    penaltyRatePerMonth: Number(doc.penaltyRatePerMonth ?? 0.05),
    signatureName: text(doc.signatureName),
    position: text(doc.position),
    phone: text(doc.phone),
    hasTemplate: Boolean(doc.templateFilename)
  };
}

export async function listJurisdictionSettings() {
  await connectDb();
  const docs = await TaxJurisdiction.find().sort({ name: 1 }).select("-template").lean();
  return (docs as Record<string, unknown>[]).map(jurisdictionSettings);
}

function pdfBytes(value: unknown) {
  if (!value) return null;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === "object") {
    const binary = value as { value?: (asBuffer: boolean) => Uint8Array; buffer?: ArrayBuffer };
    if (typeof binary.value === "function") {
      const bytes = binary.value(true);
      if (bytes?.byteLength) return new Uint8Array(bytes);
    }
    if (binary.buffer && binary.buffer.byteLength) return new Uint8Array(binary.buffer);
  }
  return null;
}

export async function jurisdictionTemplate(id: string) {
  await connectDb();
  const doc = await TaxJurisdiction.findById(id).lean() as Record<string, unknown> | null;
  if (!doc) return null;
  const bytes = pdfBytes(doc.template);
  return {
    settings: { ...jurisdictionSettings(doc), hasTemplate: Boolean(bytes?.length) },
    bytes
  };
}
