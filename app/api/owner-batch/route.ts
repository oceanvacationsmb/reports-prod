import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { emailFinalStatement } from "@/lib/locked-statement-store";
import { batchRecipientPreview } from "@/lib/owner-batch-server";
import { gmailComposeUrl, nextTransferDate, statementEmailDraft } from "@/lib/owner-batch";

export const runtime = "nodejs";

const schema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  action: z.enum(["email"]).optional()
});

function appOrigin(req: NextRequest) {
  const configured = process.env.APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    const recipients = await batchRecipientPreview();
    return ok({ recipients });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = assertAdmin(req);
    const body = schema.parse(await req.json());
    const recipients = await batchRecipientPreview();
    const included = recipients.filter((recipient) => recipient.included);
    const skipped = recipients.filter((recipient) => !recipient.included);
    const origin = appOrigin(req);
    const transferDate = nextTransferDate(body.year, body.month);
    const locked: Array<{
      ownerId: string;
      name: string;
      email: string;
      shareId?: string;
      shareUrl?: string;
      created?: boolean;
      gmailUrl?: string;
      error?: string;
    }> = [];

    for (const recipient of included) {
      try {
        const result = await emailFinalStatement({
          ownerId: recipient.ownerId,
          year: body.year,
          month: body.month,
          who: user.email
        });
        const shareUrl = `${origin}/share/${result.shareId}`;
        const draft = statementEmailDraft({
          email: recipient.email,
          periodLabel: result.report.periodLabel,
          shareUrl,
          transferDate
        });
        locked.push({
          ownerId: recipient.ownerId,
          name: recipient.name,
          email: recipient.email,
          shareId: result.shareId,
          shareUrl,
          created: result.created,
          gmailUrl: gmailComposeUrl(draft)
        });
      } catch (error) {
        locked.push({
          ownerId: recipient.ownerId,
          name: recipient.name,
          email: recipient.email,
          error: error instanceof Error ? error.message : "This statement could not be locked."
        });
      }
    }

    return ok({ locked, skipped });
  } catch (error) {
    return fail(error);
  }
}
