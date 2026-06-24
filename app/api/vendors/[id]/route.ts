import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Vendor } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertAdmin(req);
    await connectDb();
    const body = patchSchema.parse(await req.json());
    const vendor = await Vendor.findByIdAndUpdate(id, { $set: body }, { new: true }).lean();
    if (!vendor) throw Object.assign(new Error("Vendor not found."), { status: 404 });
    return ok({ vendor: asPlain(vendor) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertAdmin(req);
    await connectDb();
    await Vendor.deleteOne({ _id: id });
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
