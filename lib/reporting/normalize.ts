import type { NormalizedReservation } from "@/lib/types";

type AnyRecord = Record<string, unknown>;

export function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "");
    if (!cleaned) return 0;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object" && value) {
    const record = value as AnyRecord;
    return num(record.amount ?? record.value ?? record.children ?? record.total ?? record.price);
  }
  return 0;
}

function get(obj: unknown, path: string): unknown {
  if (obj && typeof obj === "object" && !Array.isArray(obj) && path in (obj as AnyRecord)) {
    return (obj as AnyRecord)[path];
  }
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) return undefined;
    return (acc as AnyRecord)[part];
  }, obj);
}

function firstNonNull(row: AnyRecord, paths: string[]) {
  for (const path of paths) {
    const value = get(row, path);
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return undefined;
}

function maxOf(row: AnyRecord, paths: string[]) {
  return Math.max(0, ...paths.map((path) => num(get(row, path))));
}

function text(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as AnyRecord;
    return text(record.children ?? record.value ?? record.amount ?? record.total ?? record.price);
  }
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function collectInvoiceItems(value: unknown): AnyRecord[] {
  const items: AnyRecord[] = [];

  function walk(item: unknown, inheritedLabel = "") {
    if (!item) return;

    if (Array.isArray(item)) {
      item.forEach((child) => walk(child, inheritedLabel));
      return;
    }

    if (typeof item !== "object") return;

    const record = item as AnyRecord;
    const label = text(record.label ?? record.title ?? record.name ?? record.description ?? inheritedLabel);
    if ("amount" in record || "value" in record || "total" in record || "price" in record) {
      items.push({ ...record, label });
    }

    if (record.children) walk(record.children, label);
    if (record.items) walk(record.items, label);
  }

  walk(value);
  return items;
}

function getAllInvoiceItems(row: AnyRecord) {
  const invoiceItems = get(row, "money.invoiceItems");
  const children = get(row, "money.invoiceItems.children");
  const raw = [...collectInvoiceItems(invoiceItems), ...collectInvoiceItems(children)];

  for (const [key, value] of Object.entries(row)) {
    const prefix = "money.invoiceItems.";
    if (!key.startsWith(prefix) || key === `${prefix}children`) continue;
    raw.push(...collectInvoiceItems({ ...(value as AnyRecord), label: (value as AnyRecord)?.label || key.slice(prefix.length) }));
  }

  if (invoiceItems && typeof invoiceItems === "object" && !Array.isArray(invoiceItems)) {
    for (const [key, value] of Object.entries(invoiceItems as AnyRecord)) {
      if (key === "children") continue;
      if (typeof value === "object") {
        raw.push(...collectInvoiceItems({ ...(value as AnyRecord), label: (value as AnyRecord).label || key }));
      }
    }
  }

  return raw;
}

function invoiceAmount(items: AnyRecord[], matcher: (item: AnyRecord) => boolean) {
  return items.reduce((sum, item) => (matcher(item) ? sum + num(item.amount ?? item.value ?? item.children ?? item.total ?? item.price) : sum), 0);
}

function invoiceFirstNonZero(items: AnyRecord[], matcher: (item: AnyRecord) => boolean) {
  for (const item of items) {
    if (matcher(item)) {
      const value = num(item.amount ?? item.value ?? item.children ?? item.total ?? item.price);
      if (value !== 0) return value;
    }
  }
  return 0;
}

function taxFromLabels(items: AnyRecord[], labels: string[]) {
  return invoiceAmount(items, (item) => {
    const label = `${text(item.label)} ${text(item.type)} ${text(item.code)}`.toLowerCase();
    return labels.some((needle) => label.includes(needle));
  });
}

function propertyName(row: AnyRecord) {
  return text(
    firstNonNull(row, [
      "listing.nickname",
      "listing.title",
      "listing.name",
      "property.nickname",
      "property.name",
      "PROPERTY",
      "Property",
      "listingNickname"
    ])
  );
}

function guestName(row: AnyRecord) {
  const guest = firstNonNull(row, [
    "guest.fullName",
    "guest.name",
    "guestName",
    "GUEST NAME",
    "guest.firstName"
  ]);
  if (guest === get(row, "guest.firstName")) {
    return `${text(get(row, "guest.firstName"))} ${text(get(row, "guest.lastName"))}`.trim();
  }
  return text(guest);
}

function dateValue(row: AnyRecord, paths: string[]) {
  const value = firstNonNull(row, paths);
  if (!value) return "";
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? text(value) : date.toISOString().slice(0, 10);
}

function nights(row: AnyRecord, checkIn: string, checkOut: string) {
  const explicit = num(firstNonNull(row, ["nights", "NIGHTS", "numberOfNights"]));
  if (explicit > 0) return explicit;
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

export function normalizeReservation(row: AnyRecord, index = 0): NormalizedReservation {
  const items = getAllInvoiceItems(row);
  const source = text(firstNonNull(row, ["source", "SOURCE"]));
  const platform = text(firstNonNull(row, ["integration.platform", "platform", "PLATFORM"]));
  const checkIn = dateValue(row, ["checkIn", "checkInDate", "checkInDateLocalized", "arrivalDate", "CHECK IN"]);
  const checkOut = dateValue(row, ["checkOut", "checkOutDate", "checkOutDateLocalized", "departureDate", "CHECK OUT"]);
  const taxCity = Math.max(num(firstNonNull(row, ["taxCity", "CITY TAX", "City Tax"])), taxFromLabels(items, ["city", "myrtle beach", "surfside", "nmb"]));
  const taxState = Math.max(num(firstNonNull(row, ["taxState", "STATE TAX", "State Tax"])), taxFromLabels(items, ["state"]));
  const taxCounty = Math.max(num(firstNonNull(row, ["taxCounty", "COUNTY TAX", "County Tax"])), taxFromLabels(items, ["county", "horry"]));
  const taxGtc = Math.max(num(firstNonNull(row, ["taxGtc", "taxGTC", "GTC TAX", "GTC"])), taxFromLabels(items, ["gtc"]));
  const taxOccupancy = Math.max(
    num(firstNonNull(row, ["taxOccupancy", "OCCUPANCY TAX", "ACCOMMODATION TAX", "TOURISM TAX", "LODGING TAX"])),
    taxFromLabels(items, ["occupancy", "accommodation", "tourism", "lodging"])
  );
  const detailedTaxesCombined = taxCity + taxState + taxCounty + taxOccupancy + taxGtc;
  const invoiceItemsTaxCombined = invoiceAmount(items, (item) => {
    const label = `${text(item.type)} ${text(item.label)} ${text(item.code)}`.toLowerCase();
    return (
      label.includes("tax") ||
      label.includes("occupancy") ||
      label.includes("tourism") ||
      label.includes("lodging") ||
      label.includes("accommodation tax")
    );
  });
  const taxesCombined = num(firstNonNull(row, ["TAXES", "taxes", "money.taxes"]));
  const confirmationCode = text(firstNonNull(row, ["confirmationCode", "CONFIRMATION CODE", "code"])).toUpperCase();

  return {
    id: text(firstNonNull(row, ["_id", "id", "reservationId", "confirmationCode"])) || `${confirmationCode || "row"}-${index}`,
    property: propertyName(row),
    guestName: guestName(row),
    checkIn,
    checkOut,
    nights: nights(row, checkIn, checkOut),
    source,
    platform,
    confirmationCode,
    status: text(firstNonNull(row, ["status", "STATUS"])),
    totalPayout: num(
      firstNonNull(row, ["money.hostPayout", "money.payout", "money.totalPayout", "hostPayout", "totalPayout", "payout", "TOTAL PAYOUT"])
    ),
    accommodationFare: num(firstNonNull(row, ["money.fareAccommodation", "ACCOMMODATION FARE", "accommodationFare"])),
    cleaningFare: num(firstNonNull(row, ["money.fareCleaning", "CLEANING FARE", "cleaningFare"])),
    markup: num(firstNonNull(row, ["money.invoiceItems.MAR", "MARKUP", "markup"])),
    channelCommission: num(firstNonNull(row, ["money.hostServiceFee", "CHANNEL COMMISSION", "channelCommission"])),
    preCancellationHostPayout: maxOf(row, [
      "preCancelationMoney.hostPayout",
      "preCancellationMoney.hostPayout",
      "money.preCancelationMoney.hostPayout",
      "money.preCancellationMoney.hostPayout"
    ]),
    feeCreditCard: maxOf(row, ["feeCreditCard", "FEE CREDIT CARD"]),
    lengthOfStayDiscount: invoiceAmount(items, (item) => text(item.label).toLowerCase().includes("length discount")),
    airbnbResolutionCenter:
      invoiceFirstNonZero(items, (item) => `${text(item.code)} ${text(item.label)}`.toLowerCase().includes("arc")) ||
      num(firstNonNull(row, ["money.invoiceItems.Arc", "airbnbResolutionCenter", "AIRBNB RESOLUTION CENTER"])),
    manualTotalPayout: firstNonNull(row, ["MANUAL TOTAL PAYOUT", "manualTotalPayout"]) === undefined ? undefined : num(firstNonNull(row, ["MANUAL TOTAL PAYOUT", "manualTotalPayout"])),
    manualCleaningFare:
      firstNonNull(row, ["MANUAL CLEANING FARE", "manualCleaningFare"]) === undefined ? undefined : num(firstNonNull(row, ["MANUAL CLEANING FARE", "manualCleaningFare"])),
    manualWebsiteFee:
      firstNonNull(row, ["MANUAL WEBSITE FEE", "manualWebsiteFee"]) === undefined ? undefined : num(firstNonNull(row, ["MANUAL WEBSITE FEE", "manualWebsiteFee"])),
    manualAccommodation:
      firstNonNull(row, ["MANUAL ACCOMMODATION", "manualAccommodation"]) === undefined ? undefined : num(firstNonNull(row, ["MANUAL ACCOMMODATION", "manualAccommodation"])),
    manualPmc: firstNonNull(row, ["MANUAL PMC", "manualPmc"]) === undefined ? undefined : num(firstNonNull(row, ["MANUAL PMC", "manualPmc"])),
    manualOwnerPayout:
      firstNonNull(row, ["MANUAL OWNER PAYOUT", "manualOwnerPayout"]) === undefined ? undefined : num(firstNonNull(row, ["MANUAL OWNER PAYOUT", "manualOwnerPayout"])),
    manualAmountDue:
      firstNonNull(row, ["MANUAL AMOUNT DUE", "manualAmountDue"]) === undefined ? undefined : num(firstNonNull(row, ["MANUAL AMOUNT DUE", "manualAmountDue"])),
    manualExpectedPayoutDate:
      firstNonNull(row, ["MANUAL EXPECTED PAYOUT", "manualExpectedPayoutDate"]) === undefined
        ? undefined
        : text(firstNonNull(row, ["MANUAL EXPECTED PAYOUT", "manualExpectedPayoutDate"])),
    taxesCombined,
    taxCity,
    taxState,
    taxCounty,
    taxOccupancy,
    taxGtc,
    invoiceItemsTaxCombined,
    detailedTaxesCombined,
    rowTaxTotal: Math.max(0, taxesCombined, detailedTaxesCombined, invoiceItemsTaxCombined),
    invoiceItemsRaw: items,
    raw: row
  };
}

export function normalizeGuestyPayload(payload: unknown): NormalizedReservation[] {
  const source =
    Array.isArray(payload)
      ? payload
      : Array.isArray((payload as AnyRecord)?.results)
        ? ((payload as AnyRecord).results as unknown[])
        : Array.isArray((payload as AnyRecord)?.data)
          ? ((payload as AnyRecord).data as unknown[])
          : Array.isArray((payload as AnyRecord)?.reservations)
            ? ((payload as AnyRecord).reservations as unknown[])
            : [];

  return source.map((row, index) => normalizeReservation((row || {}) as AnyRecord, index));
}
