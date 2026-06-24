import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { getSettings, saveSettings } from "@/lib/settings";

const schema = z.object({
  guestyCacheTtlMinutes: z.coerce.number().min(1).max(1440).optional(),
  defaultCleaningCaps: z.array(z.object({ property: z.string().optional(), maxAmount: z.coerce.number() })).optional()
});

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    return ok({ settings: await getSettings() });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    assertAdmin(req);
    const body = schema.parse(await req.json());
    return ok({ settings: await saveSettings(body) });
  } catch (error) {
    return fail(error);
  }
}
