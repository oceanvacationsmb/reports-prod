import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { loadSessionUserByEmail, sessionCookieOptions, signSession } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const user = await loadSessionUserByEmail(body.email, body.password);
    if (!user) throw Object.assign(new Error("Invalid email or password."), { status: 401 });
    const response = ok({ user });
    response.cookies.set({ ...sessionCookieOptions(), value: signSession(user) });
    return response;
  } catch (error) {
    return fail(error);
  }
}
