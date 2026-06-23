const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mongoose = require("mongoose");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.local");
const legacyDataPath = process.env.LEGACY_DATA_PATH || "/Users/leeoniisrael/Desktop/Aba/reports/data.json";
const legacyBackupPath = process.env.LEGACY_BACKUP_PATH || "/Users/leeoniisrael/Desktop/Aba/reports/BACKUP DATA.JSON";

function loadEnv() {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    const value = trimmed.slice(index + 1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function apiKeyFromUrl(url) {
  if (!url) return "";
  try {
    return new URL(url).searchParams.get("apiKey") || "";
  } catch {
    const match = String(url).match(/[?&]apiKey=([^&]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }
}

function unwrap(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return unwrap(value.children ?? value.value ?? value.amount ?? value.total ?? value.price);
  }
  return value == null ? "" : String(value);
}

function propertyFromRow(row) {
  const fields = [
    "listing.nickname",
    "listing.title",
    "listing.name",
    "property.nickname",
    "property.name",
    "PROPERTY",
    "Property",
    "listingNickname"
  ];
  for (const field of fields) {
    if (row[field] != null) {
      const value = unwrap(row[field]).trim();
      if (value) return value;
    }
  }
  for (const field of fields) {
    const value = field.split(".").reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), row);
    const text = unwrap(value).trim();
    if (text) return text;
  }
  return "";
}

function guestNameFromRow(row) {
  return unwrap(row["guest.fullName"] ?? row.guestName ?? row.guest?.fullName ?? row["GUEST NAME"]).trim();
}

function cleaningFromRow(row) {
  return Number(
    unwrap(row["MANUAL CLEANING FARE"] ?? row.manualCleaningFare ?? row["money.fareCleaning"] ?? row.cleaningFare)
      .replace(/[$,\s]/g, "")
  ) || 0;
}

function cleanChargeArray(value) {
  return Array.isArray(value)
    ? value
        .filter((item) => item && String(item.label || "").trim())
        .map((item) => ({ ...item, label: String(item.label).trim(), amount: Number(item.amount || 0) }))
    : [];
}

function cleanOwner(name, owner, properties, guesty) {
  return {
    name,
    email: owner.email || "",
    type: name === "ERAN MARON" ? "draft" : "payout",
    percent: Number(owner.percent || 0),
    salesFeePercent: Number(owner.salesFeePercent || 0),
    splitOwnerPercent: Number(owner.splitOwnerPercent || 0),
    cleaningFee: Number(guesty.ownerStayCleaningFee || owner.cleaningFee || 0),
    guestyReportUrl: owner.guestyReportUrl || "",
    guestyAllPropertiesUrl: owner.guestyAllPropertiesUrl || "",
    properties,
    legacyImport: {
      source: "Desktop/Aba/reports/data.json",
      reservationCount: guesty.reservationCount,
      warning: guesty.error || "",
      importedAt: new Date()
    },
    recurringCharges: cleanChargeArray(owner.recurringCharges),
    monthlyRecurringCharges: cleanChargeArray(owner.monthlyRecurringCharges).map((item) => ({ ...item, month: Number(item.month || 1) })),
    specificDateRecurringCharges: cleanChargeArray(owner.specificDateRecurringCharges).map((item) => ({
      ...item,
      month: Number(item.month || 1),
      day: Number(item.day || 1)
    })),
    dateRangeRecurringCharges: cleanChargeArray(owner.dateRangeRecurringCharges).map((item) => ({
      ...item,
      startDate: item.startDate || "",
      endDate: item.endDate || ""
    }))
  };
}

async function fetchGuestyProperties(owner) {
  const sourceUrl = owner.guestyReportUrl || owner.guestyAllPropertiesUrl || "";
  const apiKey = apiKeyFromUrl(sourceUrl);
  if (!apiKey) return { properties: [], reservationCount: 0, error: "missing apiKey" };

  const properties = new Set();
  const ownerStayCleaningValues = [];
  let skip = 0;
  const limit = 500;
  let total = 0;

  for (let page = 0; page < 20; page += 1) {
    const url = new URL("https://report.guesty.com/api/shared-reservations-reports");
    url.searchParams.set("timezone", "America/New_York");
    url.searchParams.set("skip", String(skip));
    url.searchParams.set("limit", String(limit));

    const response = await fetch(url, {
      headers: {
        accept: "*/*",
        authorization: apiKey,
        "content-type": "application/json"
      }
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        properties: [...properties].sort(),
        reservationCount: total,
        error: `HTTP ${response.status}: ${text.slice(0, 160)}`
      };
    }

    const payload = JSON.parse(text);
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.results)
        ? payload.results
        : Array.isArray(payload.data)
          ? payload.data
          : Array.isArray(payload.reservations)
            ? payload.reservations
            : [];

    for (const row of rows) {
      const property = propertyFromRow(row);
      if (property) properties.add(property);
      if (guestNameFromRow(row).toUpperCase().includes("OWNER STAY")) {
        const cleaning = cleaningFromRow(row);
        if (cleaning > 0) ownerStayCleaningValues.push(cleaning);
      }
    }

    total += rows.length;
    if (rows.length < limit) break;
    skip += limit;
  }

  const cleaningCounts = new Map();
  for (const value of ownerStayCleaningValues) {
    cleaningCounts.set(value, (cleaningCounts.get(value) || 0) + 1);
  }
  const ownerStayCleaningFee = cleaningCounts.size
    ? [...cleaningCounts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
    : 0;

  return { properties: [...properties].sort(), reservationCount: total, ownerStayCleaningFee, error: "" };
}

function legacyTaxFlags(flags) {
  return {
    SC: Boolean(flags && flags.SC),
    MB: Boolean(flags && flags.MB),
    NMB: Boolean(flags && flags.NMB),
    SSB: Boolean(flags && flags.SSB),
    HC: Boolean(flags && flags.HC),
    GTC: Boolean(flags && flags.GTC)
  };
}

function looksLikeKobiAlias(name, owner, currentOwners) {
  return (
    name.replace(/\s+/g, " ").trim() === "508/1-2 - KOBI" &&
    currentOwners["KOBI - 508-1-2"] &&
    owner.email &&
    owner.email === currentOwners["KOBI - 508-1-2"].email
  );
}

function shouldSkipOwner(name) {
  return name === "TAX REPORT ONLY";
}

async function main() {
  loadEnv();
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is missing.");

  const legacy = JSON.parse(fs.readFileSync(legacyDataPath, "utf8"));
  const backup = fs.existsSync(legacyBackupPath) ? JSON.parse(fs.readFileSync(legacyBackupPath, "utf8")) : { owners: {} };
  const sourceOwners = Object.fromEntries(Object.entries(legacy.owners || {}).filter(([name]) => !shouldSkipOwner(name)));
  const backupOnlyOwners = Object.entries(backup.owners || {}).filter(([name, owner]) => !sourceOwners[name] && !looksLikeKobiAlias(name, owner, sourceOwners));
  const aliasOwners = Object.entries(backup.owners || {}).filter(([name, owner]) => !sourceOwners[name] && looksLikeKobiAlias(name, owner, sourceOwners));
  const skippedOwners = Object.keys(legacy.owners || {}).filter(shouldSkipOwner);
  const allOwners = { ...sourceOwners, ...Object.fromEntries(backupOnlyOwners) };

  const ownerSchema = new mongoose.Schema({}, { strict: false, collection: "owners" });
  const vendorSchema = new mongoose.Schema({}, { strict: false, collection: "vendors" });
  const expenseSchema = new mongoose.Schema({}, { strict: false, collection: "expenses" });
  const propertySchema = new mongoose.Schema({}, { strict: false, collection: "properties" });
  const Owner = mongoose.models.Owner || mongoose.model("Owner", ownerSchema);
  const Vendor = mongoose.models.Vendor || mongoose.model("Vendor", vendorSchema);
  const Expense = mongoose.models.Expense || mongoose.model("Expense", expenseSchema);
  const Property = mongoose.models.Property || mongoose.model("Property", propertySchema);

  await mongoose.connect(process.env.MONGODB_URI);

  const report = {
    source: {
      dataJson: legacyDataPath,
      backupJson: legacyBackupPath,
      dataOwnerCount: Object.keys(sourceOwners).length,
      backupOwnerCount: Object.keys(backup.owners || {}).length,
      skippedOwners,
      backupOnlyImported: backupOnlyOwners.map(([name]) => name),
      backupOnlyAliasesSkipped: aliasOwners.map(([name]) => ({ backupName: name, importedAs: "KOBI - 508-1-2" }))
    },
    owners: [],
    propertiesUpserted: [],
    vendorsUpserted: 0,
    expensesUpserted: 0,
    warnings: []
  };

  const ownerNameToId = new Map();

  for (const [name, owner] of Object.entries(allOwners)) {
    const guesty = await fetchGuestyProperties(owner);
    if (guesty.error) report.warnings.push(`${name}: ${guesty.error}`);
    const cleaned = cleanOwner(name, owner, guesty.properties, guesty);
    const saved = await Owner.findOneAndUpdate({ name }, { $set: cleaned }, { upsert: true, new: true, setDefaultsOnInsert: true });
    ownerNameToId.set(name, saved._id);
    report.owners.push({
      name,
      email: cleaned.email,
      type: cleaned.type,
      guestyReportUrlPresent: Boolean(cleaned.guestyReportUrl),
      guestyAllPropertiesUrlPresent: Boolean(cleaned.guestyAllPropertiesUrl),
      reservationCount: guesty.reservationCount,
      propertyCount: guesty.properties.length,
      properties: guesty.properties,
      warning: guesty.error || ""
    });
  }

  for (const [name, flags] of Object.entries(legacy.properties || {})) {
    await Property.findOneAndUpdate({ name }, { $set: { name, taxFlags: legacyTaxFlags(flags) } }, { upsert: true, new: true });
    report.propertiesUpserted.push(name);
  }

  for (const vendor of legacy.vendors || []) {
    const name = typeof vendor === "string" ? vendor : vendor.name;
    if (!name) continue;
    await Vendor.findOneAndUpdate({ name }, { $set: { name, phone: vendor.phone || "" } }, { upsert: true, new: true });
    report.vendorsUpserted += 1;
  }

  for (const expense of legacy.expenses || []) {
    const ownerName = expense.owner || expense.ownerName || "";
    const ownerId = ownerNameToId.get(ownerName);
    if (!ownerId) {
      report.warnings.push(`expense skipped, owner not found: ${ownerName || "(blank)"}`);
      continue;
    }

    const fingerprint = crypto
      .createHash("sha1")
      .update(JSON.stringify({
        ownerName,
        property: expense.property || "",
        type: expense.type || expense.expenseType || "",
        vendor: expense.vendor || "",
        amount: Number(expense.amount || 0),
        month: Number(expense.month || 1),
        year: Number(expense.year || new Date().getFullYear()),
        notes: expense.notes || ""
      }))
      .digest("hex");

    await Expense.findOneAndUpdate(
      { legacyFingerprint: fingerprint },
      {
        $set: {
          legacyFingerprint: fingerprint,
          ownerId,
          property: expense.property || "Unassigned",
          type: expense.type || expense.expenseType || "Expense",
          vendor: expense.vendor || "",
          amount: Number(expense.amount || 0),
          notes: expense.notes || "",
          invoiceUrl: expense.invoiceUrl || expense.invoice || "",
          month: Number(expense.month || 1),
          year: Number(expense.year || new Date().getFullYear()),
          createdAt: expense.createdAt ? new Date(expense.createdAt) : new Date()
        }
      },
      { upsert: true, new: true }
    );
    report.expensesUpserted += 1;
  }

  fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  const reportPath = path.join(root, "tmp", "legacy-import-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(`Imported ${report.owners.length} owners.`);
  console.log(`Upserted ${report.propertiesUpserted.length} properties, ${report.vendorsUpserted} vendors, ${report.expensesUpserted} expenses.`);
  console.log(`Warnings: ${report.warnings.length}`);
  console.log(`Report: ${reportPath}`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
