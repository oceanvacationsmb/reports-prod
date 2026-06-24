import { NextRequest } from "next/server";
import { z } from "zod";
import { hashPassword } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { User } from "@/lib/models";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(10)
});

export async function POST(req: NextRequest) {
  try {
    await connectDb();
    const body = schema.parse(await req.json());
    const user = await User.findOne({ email: body.email.toLowerCase().trim(), role: "admin" });
    if (!user) {
      throw Object.assign(new Error("No admin account found for that email."), { status: 404 });
    }

    user.passwordHash = await hashPassword(body.password);
    await user.save();

    return ok({ message: "Password reset. You can sign in now." });
  } catch (error) {
    return fail(error);
  }
}
