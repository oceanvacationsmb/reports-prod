import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { approveStatementVersion } from "@/lib/statements/service";

const schema = z.object({ versionId: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    const body = schema.parse(await req.json());
    return ok(await approveStatementVersion(body.versionId));
  } catch (error) {
    return fail(error);
  }
}
