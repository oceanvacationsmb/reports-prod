import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Expense, Vendor } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";

const schema = z.object({
  name: z.string().min(1),
  phone: z.string().optional().default("")
});

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const vendorCount = await Vendor.countDocuments();
    if (vendorCount === 0) {
      const existingNames = (await Expense.distinct("vendor")).map((name: unknown) => String(name || "").trim()).filter(Boolean);
      if (existingNames.length) {
        await Vendor.bulkWrite(
          existingNames.map((name: string) => ({
            updateOne: { filter: { name }, update: { $setOnInsert: { name, phone: "" } }, upsert: true }
          }))
        );
      }
    }
    const vendors = await Vendor.find().sort({ name: 1 }).lean();
    return ok({ vendors: asPlain(vendors) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const body = schema.parse(await req.json());
    const vendor = await Vendor.findOneAndUpdate({ name: body.name }, { $set: body }, { upsert: true, new: true }).lean();
    return ok({ vendor: asPlain(vendor) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
