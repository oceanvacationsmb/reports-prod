import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Property } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";

const schema = z.object({
  name: z.string().min(1),
  reportAddress: z.string().optional().default(""),
  municipality: z.string().optional().default(""),
  taxFlags: z.object({
    SC: z.boolean().optional(),
    MB: z.boolean().optional(),
    NMB: z.boolean().optional(),
    SSB: z.boolean().optional(),
    HC: z.boolean().optional(),
    GTC: z.boolean().optional()
  }).default({})
});

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const properties = await Property.find().sort({ name: 1 }).lean();
    return ok({ properties: asPlain(properties) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const body = schema.parse(await req.json());
    const property = await Property.findOneAndUpdate({ name: body.name }, { $set: body }, { upsert: true, new: true }).lean();
    return ok({ property: asPlain(property) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
