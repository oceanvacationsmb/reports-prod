import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Expense } from "@/lib/models";
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

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertAdmin(req);
    await connectDb();
    const body = patchSchema.parse(await req.json());
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
