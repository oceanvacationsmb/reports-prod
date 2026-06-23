import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin, assertUser, hashPassword, isPrimaryAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Owner, User } from "@/lib/models";
import { asPlain, fail, ok } from "@/lib/http";

const charge = z.object({ label: z.string(), amount: z.coerce.number() });
const ownerSchema = z.object({
  name: z.string().min(1),
  email: z.string().optional().default(""),
  type: z.enum(["draft", "payout", "split"]).default("draft"),
  percent: z.coerce.number().default(0),
  salesFeePercent: z.coerce.number().default(0),
  splitOwnerPercent: z.coerce.number().default(0),
  cleaningFee: z.coerce.number().default(0),
  cleaningCaps: z.array(z.object({ property: z.string().optional(), maxAmount: z.coerce.number() })).default([]),
  guestyReportUrl: z.string().optional().default(""),
  guestyAllPropertiesUrl: z.string().optional().default(""),
  properties: z.array(z.string()).default([]),
  recurringCharges: z.array(charge).default([]),
  monthlyRecurringCharges: z.array(charge.extend({ month: z.coerce.number() })).default([]),
  specificDateRecurringCharges: z.array(charge.extend({ month: z.coerce.number(), day: z.coerce.number() })).default([]),
  dateRangeRecurringCharges: z.array(charge.extend({ startDate: z.string(), endDate: z.string() })).default([]),
  portalPassword: z.string().min(10).optional().or(z.literal(""))
});

export async function GET(req: NextRequest) {
  try {
    const user = assertUser(req);
    await connectDb();
    const owners = isPrimaryAdmin(user)
      ? await Owner.find().sort({ name: 1 }).lean()
      : user.ownerId
        ? await Owner.find({ _id: user.ownerId }).lean()
        : [];
    return ok({ owners: asPlain(owners) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    await connectDb();
    const body = ownerSchema.parse(await req.json());
    const { portalPassword, ...ownerData } = body;
    const owner = await Owner.create(ownerData);

    if (portalPassword && body.email) {
      await User.updateOne(
        { email: body.email.toLowerCase() },
        {
          $set: {
            email: body.email.toLowerCase(),
            passwordHash: await hashPassword(portalPassword),
            role: "owner",
            ownerId: owner._id,
            displayName: body.name
          }
        },
        { upsert: true }
      );
    }

    return ok({ owner: asPlain(owner) }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
