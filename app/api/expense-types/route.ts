import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { ExpenseType } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";

const defaults = ["Purchase", "Service", "Cleaning", "Damage Claim"];
const schema = z.object({ name: z.string().trim().min(1) });

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const expenseTypeCount = await ExpenseType.countDocuments();
    if (expenseTypeCount === 0) {
      await ExpenseType.bulkWrite(
        defaults.map((name) => ({
          updateOne: { filter: { name }, update: { $setOnInsert: { name } }, upsert: true }
        }))
      );
    }
    const expenseTypes = await ExpenseType.find().sort({ name: 1 }).lean();
    return ok({ expenseTypes: asPlain(expenseTypes) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const body = schema.parse(await req.json());
    const expenseType = await ExpenseType.findOneAndUpdate(
      { name: body.name },
      { $set: body },
      { upsert: true, new: true }
    ).lean();
    return ok({ expenseType: asPlain(expenseType) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
