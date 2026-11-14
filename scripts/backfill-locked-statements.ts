import { readFileSync } from "node:fs";
import path from "node:path";
import { planBackfill, type BackfillInput, type StatementExpenseLine, type StatementLine } from "@/lib/locked-statements";

type Fixture = {
  ownerName: string;
  property?: string;
  year: number;
  month: number;
  nights?: number;
  propertyPayoutBeforeRecurring?: number;
  sourceNote?: string;
  recurring: StatementLine[];
  expenses?: StatementExpenseLine[];
  totals?: BackfillInput["totals"];
};

const fixturePath = path.join(process.cwd(), "scripts/fixtures/jeff-827b-august-2026.json");
const apply = process.argv.includes("--apply");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

const input: BackfillInput = {
  ownerId: "",
  ownerName: fixture.ownerName,
  property: fixture.property,
  year: fixture.year,
  month: fixture.month,
  shareId: "dry-run",
  recurring: fixture.recurring,
  expenses: fixture.expenses,
  totals: fixture.totals,
  nights: fixture.nights,
  propertyPayoutBeforeRecurring: fixture.propertyPayoutBeforeRecurring,
  lockedAt: new Date().toISOString(),
  sourceNote: fixture.sourceNote
};

if (!apply) {
  const plan = planBackfill(null, input);
  console.log(JSON.stringify(plan, null, 2));
  console.log("Dry run only. Nothing was written. Re-run with --apply to save this final statement if that month is not already final.");
  process.exit(0);
}

async function applyBackfill() {
  const { connectDb } = await import("@/lib/db");
  const { Owner, LockedStatement, SavedReport } = await import("@/lib/models");
  const { makeShareId } = await import("@/lib/reporting/reports");
  await connectDb();
  const owner = await Owner.findOne({ name: fixture.ownerName }).lean();
  if (!owner) {
    throw new Error(`Owner not found: ${fixture.ownerName}`);
  }
  const ownerId = String(owner._id);
  const existing = await LockedStatement.findOne({ ownerId, year: fixture.year, month: fixture.month, locked: true }).lean();
  const plan = planBackfill(existing ? { shareId: String(existing.shareId) } : null, {
    ...input,
    ownerId,
    shareId: makeShareId()
  });
  if (plan.action === "skip") {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  await LockedStatement.create({
    ...plan.lock,
    lockedAt: new Date(plan.lock.lockedAt)
  });
  await SavedReport.create({
    ownerId,
    reportKey: "statement",
    reportTitle: `${fixture.ownerName} Statement`,
    periodLabel: plan.lock.periodLabel,
    htmlSnapshot: plan.lock.htmlSnapshot,
    shareId: plan.lock.shareId
  });
  console.log(JSON.stringify({ action: "create", shareId: plan.lock.shareId, month: plan.lock.month, year: plan.lock.year }, null, 2));
}

applyBackfill().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
