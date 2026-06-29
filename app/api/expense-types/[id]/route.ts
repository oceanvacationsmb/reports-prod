import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { ExpenseType } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";

const patchSchema = z.object({ name: z.string().trim().min(1) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertAdmin(req);
    await connectDb();
    const body = patchSchema.parse(await req.json());
    const expenseType = await ExpenseType.findByIdAndUpdate(id, { $set: body }, { new: true }).lean();
    if (!expenseType) throw Object.assign(new Error("Expense type not found."), { status: 404 });
    return ok({ expenseType: asPlain(expenseType) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertAdmin(req);
    await connectDb();
    await ExpenseType.deleteOne({ _id: id });
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
