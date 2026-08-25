import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Expense, Owner } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";

const patchSchema = z.object({
  property: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  vendor: z.string().optional(),
  amount: z.coerce.number().optional(),
  notes: z.string().optional(),
  invoiceUrl: z.string().optional(),
  month: z.coerce.number().min(1).max(12).optional(),
  year: z.coerce.number().optional()
});

function normalized(value: string) {
  return value.trim().toLowerCase();
}

async function assertPropertyBelongsToOwner(ownerId: unknown, property: string) {
  if (normalized(property) === "owner") return;
  const owner = await Owner.findById(ownerId).select({ properties: 1 }).lean();
  if (!owner) throw Object.assign(new Error("Owner not found."), { status: 404 });
  const belongsToOwner = (owner.properties || []).some((item: string) => normalized(item) === normalized(property));
  if (!belongsToOwner) {
    throw Object.assign(new Error("That property is not assigned to this owner."), { status: 400 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertAdmin(req);
    await connectDb();
    const body = patchSchema.parse(await req.json());
    if (body.property) {
      const existing = await Expense.findById(id).select({ ownerId: 1 }).lean();
      if (!existing) throw Object.assign(new Error("Expense not found."), { status: 404 });
      await assertPropertyBelongsToOwner(existing.ownerId, body.property);
    }
    const expense = await Expense.findByIdAndUpdate(id, { $set: body }, { new: true }).lean();
    if (!expense) throw Object.assign(new Error("Expense not found."), { status: 404 });
    return ok({ expense: asPlain(expense) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertAdmin(req);
    await connectDb();
    await Expense.deleteOne({ _id: id });
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
