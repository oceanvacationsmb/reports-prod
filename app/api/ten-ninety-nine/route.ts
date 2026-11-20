import { NextRequest } from "next/server";
import { z } from "zod";
import { assertAdmin, assertOwnerAccess, assertUser, isPrimaryAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { asPlain, fail, ok } from "@/lib/http";
import { listFinalStatementsForYear } from "@/lib/locked-statement-store";
import { Owner } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { annual1099Pdf } from "@/lib/reporting/ten-ninety-nine-pdf";
import { annual1099Rows, buildAnnual1099, buildOwner1099, normalizeBasis, renderAnnual1099 } from "@/lib/reporting/ten-ninety-nine";
import { workbookXlsx } from "@/lib/reporting/xlsx-workbook";
import type { OwnerLike } from "@/lib/types";

export const runtime = "nodejs";

const schema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  ownerId: z.string().optional(),
  format: z.enum(["json", "pdf", "xlsx"]).optional().default("json")
});

function isAggregateOwner(owner: OwnerLike) {
  return owner.name.trim().toLowerCase() === "all properties";
}

export async function GET(req: NextRequest) {
  try {
    const user = assertUser(req);
    await connectDb();
    const query = schema.parse({
      year: req.nextUrl.searchParams.get("year"),
      ownerId: req.nextUrl.searchParams.get("ownerId") || undefined,
      format: req.nextUrl.searchParams.get("format") || "json"
    });
    if (!query.ownerId && !isPrimaryAdmin(user)) assertAdmin(req);
    if (query.ownerId) assertOwnerAccess(user, query.ownerId);
    const settings = await getSettings();
    const basis = normalizeBasis(settings.tenNinetyNineBasis);
    const ownerFilter = query.ownerId ? { _id: query.ownerId } : {};
    const owners = (asPlain(await Owner.find(ownerFilter).sort({ name: 1 }).lean()) as OwnerLike[]).filter((owner) => !isAggregateOwner(owner));
    const finals = await listFinalStatementsForYear(query.year);
    const report = buildAnnual1099(
      query.year,
      owners.map((owner) => {
        const ownerId = String(owner._id || owner.id || "");
        return buildOwner1099({
          ownerId,
          ownerName: owner.name,
          properties: owner.properties || [],
          year: query.year,
          finals: finals
            .filter((item) => item.ownerId === ownerId)
            .map((item) => ({
              year: item.year,
              month: item.month,
              shareId: item.shareId,
              depositRecorded: item.depositRecorded,
              totals: item.totals
            })),
          basis
        });
      }),
      basis
    );
    if (query.format === "pdf") {
      const pdf = await annual1099Pdf(report);
      return new Response(Buffer.from(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="1099-${query.year}.pdf"`
        }
      });
    }
    if (query.format === "xlsx") {
      const file = workbookXlsx(annual1099Rows(report));
      return new Response(file, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="1099-${query.year}.xlsx"`
        }
      });
    }
    return ok({ report, html: renderAnnual1099(report) });
  } catch (error) {
    return fail(error);
  }
}
