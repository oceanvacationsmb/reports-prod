import { connectDb } from "@/lib/db";
import { StatementMonthOverride, StatementSnapshot, TaxJurisdiction } from "@/lib/models";

// Additive only. Creates indexes for the new collections and does not drop,
// rename, or rewrite existing statement, property, or owner documents.
async function main() {
  await connectDb();
  await StatementSnapshot.collection.createIndex({ shareId: 1 }, { unique: true });
  await StatementSnapshot.collection.createIndex({ ownerId: 1, year: 1, month: 1 });
  await TaxJurisdiction.collection.createIndex({ slug: 1 }, { unique: true });
  await StatementMonthOverride.collection.createIndex({ ownerId: 1, year: 1, month: 1 }, { unique: true });
  console.log("Indexes are in place for statement snapshots, tax jurisdictions, and month charge overrides.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
