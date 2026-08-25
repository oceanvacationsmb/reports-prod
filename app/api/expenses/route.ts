import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin, assertOwnerAccess, assertUser } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Expense, Owner } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";

const schema = z.object({
  ownerId: z.string(),
  property: z.string().min(1),
  type: z.string().min(1),
  vendor: z.string().optional().default(""),
  amount: z.coerce.number(),
  notes: z.string().optional().default(""),
  invoiceUrl: z.string().optional().default(""),
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number()
});

function normalized(value: string) {
  return value.trim().toLowerCase();
}

async function assertPropertyBelongsToOwner(ownerId: string, property: string) {
  if (normalized(property) === "owner") return;
  const owner = await Owner.findById(ownerId).select({ properties: 1 }).lean();
  if (!owner) throw Object.assign(new Error("Owner not found."), { status: 404 });
  const belongsToOwner = (owner.properties || []).some((item: string) => normalized(item) === normalized(property));
  if (!belongsToOwner) {
    throw Object.assign(new Error("That property is not assigned to the selected owner."), { status: 400 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = assertUser(req);
    await connectDb();
    const ownerId = req.nextUrl.searchParams.get("ownerId") || user.ownerId;
    assertOwnerAccess(user, ownerId);
    const query: Record<string, unknown> = {};
    if (ownerId) query.ownerId = ownerId;
    const expenses = await Expense.find(query).sort({ year: -1, month: -1, createdAt: -1 }).lean();
    return ok({ expenses: asPlain(expenses) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const body = schema.parse(await req.json());
    await assertPropertyBelongsToOwner(body.ownerId, body.property);
    const expense = await Expense.create(body);
    return ok({ expense: asPlain(expense) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
