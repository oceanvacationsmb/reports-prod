import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { asPlain, fail, ok } from "@/lib/http";
import { TaxJurisdiction } from "@/lib/models";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(1).optional(),
  slug: z.string().trim().min(1).regex(/^[a-z0-9-]+$/).optional(),
  formKind: z.enum(["georgetown", "surfside"]).optional(),
  accountNumber: z.string().optional(),
  federalId: z.string().optional(),
  businessName: z.string().optional(),
  ownerName: z.string().optional(),
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  email: z.string().optional(),
  accommodationRate: z.coerce.number().min(0).max(1).optional(),
  hospitalityRate: z.coerce.number().min(0).max(1).optional(),
  discountRate: z.coerce.number().min(0).max(1).optional(),
  penaltyRatePerMonth: z.coerce.number().min(0).max(1).optional(),
  signatureName: z.string().optional(),
  position: z.string().optional(),
  phone: z.string().optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAdmin(req);
    await connectDb();
    const { id } = await params;
    const body = schema.parse(await req.json());
    const doc = await TaxJurisdiction.findByIdAndUpdate(id, { $set: body }, { new: true }).select("-template").lean();
    if (!doc) throw Object.assign(new Error("Jurisdiction not found."), { status: 404 });
    return ok({ jurisdiction: asPlain(doc) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertAdmin(req);
    await connectDb();
    const { id } = await params;
    await TaxJurisdiction.deleteOne({ _id: id });
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
