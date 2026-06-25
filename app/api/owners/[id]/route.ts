import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin, assertOwnerAccess, assertUser, hashPassword } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Owner, User } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";

const taxFlags = z.object({
  SC: z.boolean().optional(),
  MB: z.boolean().optional(),
  NMB: z.boolean().optional(),
  SSB: z.boolean().optional(),
  HC: z.boolean().optional(),
  GTC: z.boolean().optional()
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().optional(),
  type: z.enum(["draft", "payout", "split"]).optional(),
  percent: z.coerce.number().optional(),
  salesFeePercent: z.coerce.number().optional(),
  splitOwnerPercent: z.coerce.number().optional(),
  cleaningFee: z.coerce.number().optional(),
  cleaningCaps: z.array(z.object({ property: z.string().optional(), maxAmount: z.coerce.number() })).optional(),
  taxFlags: taxFlags.optional(),
  guestyReportUrl: z.string().optional(),
  guestyAllPropertiesUrl: z.string().optional(),
  properties: z.array(z.string()).optional(),
  recurringCharges: z.array(z.object({ label: z.string(), amount: z.coerce.number() })).optional(),
  monthlyRecurringCharges: z.array(z.object({ month: z.coerce.number(), label: z.string(), amount: z.coerce.number() })).optional(),
  specificDateRecurringCharges: z.array(z.object({ month: z.coerce.number(), day: z.coerce.number(), label: z.string(), amount: z.coerce.number() })).optional(),
  dateRangeRecurringCharges: z.array(z.object({ startDate: z.string(), endDate: z.string(), label: z.string(), amount: z.coerce.number() })).optional(),
  portalPassword: z.string().min(10).optional().or(z.literal(""))
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = assertUser(req);
    assertOwnerAccess(user, id);
    await connectDb();
    const owner = await Owner.findById(id).lean();
    if (!owner) throw Object.assign(new Error("Owner not found."), { status: 404 });
    return ok({ owner: asPlain(owner) });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertAdmin(req);
    await connectDb();
    const body = patchSchema.parse(await req.json());
    const { portalPassword, ...updates } = body;
    const owner = await Owner.findByIdAndUpdate(id, { $set: updates }, { new: true }).lean();
    if (!owner) throw Object.assign(new Error("Owner not found."), { status: 404 });

    if (portalPassword && owner.email) {
      await User.updateOne(
        { email: owner.email.toLowerCase() },
        {
          $set: {
            email: owner.email.toLowerCase(),
            passwordHash: await hashPassword(portalPassword),
            role: "owner",
            ownerId: owner._id,
            displayName: owner.name
          }
        },
        { upsert: true }
      );
    }

    return ok({ owner: asPlain(owner) });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    assertAdmin(req);
    await connectDb();
    await Owner.deleteOne({ _id: id });
    await User.deleteMany({ ownerId: id });
    return ok({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
