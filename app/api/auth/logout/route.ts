import { clearSessionCookieOptions } from "@/lib/auth";
import { ok } from "@/lib/http";

export async function POST() {
  const response = ok({ ok: true });
  response.cookies.set({ ...clearSessionCookieOptions(), value: "" });
  return response;
}
