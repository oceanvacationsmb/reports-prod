import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/http";
import { etParts, isLastCalendarDay, previousMonth } from "@/lib/statements/schedule";
import { dispatchStatementMonth, generateStatementMonth } from "@/lib/statements/service";

export const runtime = "nodejs";
export const maxDuration = 60;

function assertCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw Object.assign(new Error("CRON_SECRET is not set."), { status: 500 });
  const header = req.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (bearer !== secret && req.headers.get("x-cron-secret") !== secret) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
}

async function run(req: NextRequest) {
  try {
    assertCron(req);
    const now = new Date();
    const parts = etParts(now);
    const actions: unknown[] = [];
    if (isLastCalendarDay(now)) {
      actions.push({ generate: await generateStatementMonth(parts.year, parts.month) });
    }
    if (parts.day >= 1 && parts.day <= 4) {
      const previous = previousMonth(parts.year, parts.month);
      actions.push({
        dispatch: await dispatchStatementMonth(previous.year, previous.month, { manualAuthorization: false, now })
      });
    }
    return ok({ ranAt: now.toISOString(), eastern: parts, actions });
  } catch (error) {
    return fail(error);
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
