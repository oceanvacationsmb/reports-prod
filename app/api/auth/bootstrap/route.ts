import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { User } from "@/lib/models";
import { fail, ok } from "@/lib/http";
import { hashPassword, sessionCookieOptions, signSession } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  displayName: z.string().optional()
});

export async function POST(req: NextRequest) {
  try {
    await connectDb();
    const existingUsers = await User.countDocuments();
    if (existingUsers > 0) {
      throw Object.assign(new Error("Bootstrap is disabled after the first user exists."), { status: 409 });
    }

    const body = schema.parse(await req.json());
    const user = await User.create({
      email: body.email.toLowerCase(),
      passwordHash: await hashPassword(body.password),
      role: "admin",
      displayName: body.displayName || "Admin"
    });
    const session = {
      id: String(user._id),
      email: user.email,
      role: "admin" as const,
      ownerId: null,
      displayName: user.displayName
    };
    const response = ok({ user: session });
    response.cookies.set({ ...sessionCookieOptions(), value: signSession(session) });
    return response;
  } catch (error) {
    return fail(error);
  }
}
