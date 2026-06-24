import { NextRequest } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { ok } from "@/lib/http";

export async function GET(req: NextRequest) {
  return ok({ user: userFromRequest(req) });
}
