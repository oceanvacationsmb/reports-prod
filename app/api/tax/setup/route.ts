import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { ROSTER_SOURCES } from "@/lib/tax/rosters";
import { normalizeCompany } from "@/lib/tax/setup";
import { normalizeRosters } from "@/lib/tax/rosters";
import { readTaxSetup, writeTaxSetup } from "@/lib/tax/service";

const schema = z.object({
  company: z.record(z.unknown()).optional(),
  rosters: z.record(z.array(z.string())).optional()
});

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    const setup = await readTaxSetup();
    return ok({ ...setup, sources: ROSTER_SOURCES });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    assertAdmin(req);
    const body = schema.parse(await req.json());
    const saved = await writeTaxSetup(normalizeCompany(body.company), normalizeRosters(body.rosters));
    return ok(saved);
  } catch (error) {
    return fail(error);
  }
}
