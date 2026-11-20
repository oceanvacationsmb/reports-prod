import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { asPlain, fail, ok } from "@/lib/http";
import { TaxJurisdiction } from "@/lib/models";
import { listJurisdictionSettings } from "@/lib/tax-forms/jurisdictions";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(1),
  slug: z.string().trim().min(1).regex(/^[a-z0-9-]+$/),
  formKind: z.enum(["georgetown", "surfside"]),
  accountNumber: z.string().optional().default(""),
  federalId: z.string().optional().default(""),
  businessName: z.string().optional().default(""),
  ownerName: z.string().optional().default(""),
  street: z.string().optional().default(""),
  city: z.string().optional().default(""),
  state: z.string().optional().default(""),
  postalCode: z.string().optional().default(""),
  email: z.string().optional().default(""),
  accommodationRate: z.coerce.number().min(0).max(1).optional().default(0),
  hospitalityRate: z.coerce.number().min(0).max(1).optional().default(0),
  discountRate: z.coerce.number().min(0).max(1).optional().default(0),
  penaltyRatePerMonth: z.coerce.number().min(0).max(1).optional().default(0.05),
  signatureName: z.string().optional().default(""),
  position: z.string().optional().default(""),
  phone: z.string().optional().default("")
});

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    return ok({ jurisdictions: await listJurisdictionSettings() });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const body = schema.parse(await req.json());
    const existing = body.slug
      ? await TaxJurisdiction.findOne({ slug: body.slug })
      : null;
    const id = existing?._id;
    const doc = id
      ? await TaxJurisdiction.findByIdAndUpdate(id, { $set: body }, { new: true }).select("-template").lean()
      : await TaxJurisdiction.create(body).then((created: { toObject: () => unknown }) => created.toObject());
    const plain = asPlain(doc) as Record<string, unknown>;
    delete plain.template;
    return ok({ jurisdiction: plain }, { status: id ? 200 : 201 });
  } catch (error) {
    return fail(error);
  }
}
