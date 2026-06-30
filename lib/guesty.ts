import crypto from "crypto";
import { connectDb } from "@/lib/db";
import { GuestyCache, ReservationOverride } from "@/lib/models";
import { normalizeGuestyPayload } from "@/lib/reporting/normalize";
import { getSettings } from "@/lib/settings";
import type { NormalizedReservation, OwnerLike } from "@/lib/types";

export type GuestyQuery = {
  limit?: number;
  skip?: number;
  startDate?: string;
  endDate?: string;
  property?: string;
  allProperties?: boolean;
};

function ownerId(owner: OwnerLike) {
  return String(owner._id || owner.id || "");
}

export function apiKeyFromGuestyUrl(url?: string) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("apiKey") || parsed.searchParams.get("apikey") || parsed.searchParams.get("key") || "";
  } catch {
    const match = url.match(/[?&](?:apiKey|apikey|key)=([^&]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }
}

function buildGuestyUrl(owner: OwnerLike, query: GuestyQuery) {
  const reportUrl = query.allProperties ? owner.guestyAllPropertiesUrl || owner.guestyReportUrl : owner.guestyReportUrl;
  const apiKey = apiKeyFromGuestyUrl(reportUrl);
  if (!apiKey) throw Object.assign(new Error(`Guesty API key is missing for ${owner.name}.`), { status: 400 });

  const url = new URL("https://report.guesty.com/api/shared-reservations-reports");
  url.searchParams.set("timezone", "America/New_York");
  url.searchParams.set("limit", String(query.limit || 1000));
  url.searchParams.set("skip", String(query.skip || 0));
  if (query.startDate) url.searchParams.set("startDate", query.startDate);
  if (query.endDate) url.searchParams.set("endDate", query.endDate);
  return { url, apiKey };
}

function cacheKey(query: GuestyQuery) {
  return crypto.createHash("sha256").update(JSON.stringify({
    limit: query.limit || 1000,
    skip: query.skip || 0,
    startDate: query.startDate || "",
    endDate: query.endDate || "",
    property: query.property || "",
    allProperties: Boolean(query.allProperties)
  })).digest("hex");
}

function filterProperty(rows: NormalizedReservation[], property?: string) {
  if (!property) return rows;
  return rows.filter((row) => row.property === property);
}

async function applyReservationOverrides(id: string, rows: NormalizedReservation[]) {
  const overrides = await ReservationOverride.find({ ownerId: id }).lean() as Array<{
    reservationId: string;
    values?: Partial<NormalizedReservation>;
    manual?: boolean;
    deleted?: boolean;
  }>;
  if (!overrides.length) return rows;

  const byReservation = new Map(overrides.map((override) => [override.reservationId, override]));
  const overriddenRows = rows
    .filter((row) => !byReservation.get(row.id)?.deleted)
    .map((row) => {
      const override = byReservation.get(row.id);
      return override?.values ? { ...row, ...override.values } : row;
    });
  const existingIds = new Set(overriddenRows.map((row) => row.id));
  const manualRows = overrides
    .filter((override) => override.manual && !override.deleted && !existingIds.has(override.reservationId))
    .map((override) => ({
      id: override.reservationId,
      property: "",
      guestName: "",
      checkIn: "",
      checkOut: "",
      nights: 0,
      source: "Manual",
      platform: "Manual",
      confirmationCode: override.reservationId,
      status: "confirmed",
      totalPayout: 0,
      accommodationFare: 0,
      cleaningFare: 0,
      markup: 0,
      channelCommission: 0,
      preCancellationHostPayout: 0,
      feeCreditCard: 0,
      lengthOfStayDiscount: 0,
      airbnbResolutionCenter: 0,
      taxesCombined: 0,
      taxCity: 0,
      taxState: 0,
      taxCounty: 0,
      taxOccupancy: 0,
      taxGtc: 0,
      invoiceItemsTaxCombined: 0,
      detailedTaxesCombined: 0,
      rowTaxTotal: 0,
      invoiceItemsRaw: [],
      raw: { manual: true },
      ...(override.values || {})
    } as NormalizedReservation));

  return [...overriddenRows, ...manualRows];
}

export async function getGuestyReservations(owner: OwnerLike, query: GuestyQuery = {}) {
  await connectDb();
  const settings = await getSettings();
  const key = cacheKey(query);
  const id = ownerId(owner);
  const now = new Date();
  const cached = await GuestyCache.findOne({ ownerId: id, cacheKey: key, expiresAt: { $gt: now } }).lean();

  if (cached?.payload) {
    const rows = await applyReservationOverrides(id, cached.payload as NormalizedReservation[]);
    return filterProperty(rows, query.property);
  }

  const { url, apiKey } = buildGuestyUrl(owner, query);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      authorization: apiKey,
      "content-type": "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Guesty request failed with ${response.status}.`), { status: 502 });
  }

  const payload = await response.json();
  const normalized = normalizeGuestyPayload(payload);
  const ttlMinutes = Math.max(1, settings.guestyCacheTtlMinutes || 30);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  await GuestyCache.updateOne(
    { ownerId: id, cacheKey: key },
    {
      $set: {
        ownerId: id,
        cacheKey: key,
        payload: normalized,
        createdAt: now,
        expiresAt
      }
    },
    { upsert: true }
  );

  const rows = await applyReservationOverrides(id, normalized);
  return filterProperty(rows, query.property);
}
