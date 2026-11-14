import { NextRequest } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { approveFiling } from "@/lib/tax/service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = assertAdmin(req);
    const { id } = await params;
    return ok({ filing: await approveFiling(id, user.email) });
  } catch (error) {
    return fail(error);
  }
}
