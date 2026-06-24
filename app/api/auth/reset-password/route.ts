import { NextRequest } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { hashPassword } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { User } from "@/lib/models";

const schema = z.object({
  token: z.string().min(20),
  password: z.string().min(8)
});

export async function POST(req: NextRequest) {
  try {
    await connectDb();
    const body = schema.parse(await req.json());
    const tokenHash = crypto.createHash("sha256").update(body.token).digest("hex");
    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpiresAt: { $gt: new Date() }
    });
    if (!user) {
      throw Object.assign(new Error("This reset link is invalid or expired."), { status: 400 });
    }

    user.passwordHash = await hashPassword(body.password);
    user.resetPasswordTokenHash = "";
    user.resetPasswordExpiresAt = null;
    await user.save();

    return ok({ message: "Password reset. You can sign in now." });
  } catch (error) {
    return fail(error);
  }
}
