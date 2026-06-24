import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Property } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  reportAddress: z.string().optional(),
  municipality: z.string().optional(),
  taxFlags: z.object({
    SC: z.boolean().optional(),
    MB: z.boolean().optional(),
    NMB: z.boolean().optional(),
    SSB: z.boolean().optional(),
    HC: z.boolean().optional(),
    GTC: z.boolean().optional()
  }).optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertAdmin(req);
    await connectDb();
    const body = patchSchema.parse(await req.json());
    const property = await Property.findByIdAndUpdate(id, { $set: body }, { new: true }).lean();
    if (!property) throw Object.assign(new Error("Property not found."), { status: 404 });
    return ok({ property: asPlain(property) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertAdmin(req);
    await connectDb();
    await Property.deleteOne({ _id: id });
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
