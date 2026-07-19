import crypto from "crypto";
import { connectDb } from "@/lib/db";
import { getGuestyReservations } from "@/lib/guesty";
import { asPlain } from "@/lib/http";
import { Owner, Setting } from "@/lib/models";
import { ownerPortalPeriod } from "@/lib/owner-portal";
import type { NormalizedReservation, OwnerLike } from "@/lib/types";

type GuestyToken = {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
};

export type GuestyCalendarRate = {
  date: string;
  rate: number;
  currency: string;
};

let pendingToken: Promise<GuestyToken> | null = null;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function listingIdValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const id = listingIdValue(item);
      if (id) return id;
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";

  const record = value as Record<string, unknown>;
  for (const key of ["children", "_id", "id", "listingId"]) {
    const id = listingIdValue(record[key]);
    if (id) return id;
  }
  return "";
}

function listingIdFromReservation(row: NormalizedReservation) {
  const raw = row.raw || {};
  for (const value of [
    raw.listingId,
    raw["listingId.children"],
    raw.listing,
    raw.propertyId,
    (row as NormalizedReservation & { listingId?: unknown }).listingId
  ]) {
    const id = listingIdValue(value);
    if (id) return id;
  }
  return "";
}

function tokenSettingsKey(clientId: string) {
  const idHash = crypto.createHash("sha256").update(clientId).digest("hex").slice(0, 12);
  return `guesty-open-api-token-${idHash}`;
}

function validCachedToken(value: unknown): value is GuestyToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<GuestyToken>;
  const expiresAt = token.expiresAt ? new Date(token.expiresAt).getTime() : 0;
  return Boolean(token.accessToken && expiresAt > Date.now() + 5 * 60_000);
}

async function requestGuestyToken(clientId: string, clientSecret: string) {
  const key = tokenSettingsKey(clientId);
  const cached = await Setting.findOne({ key }).lean() as { value?: unknown } | null;
  if (validCachedToken(cached?.value)) return cached.value;

  const response = await fetch("https://open-api.guesty.com/oauth2/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "open-api",
      client_id: clientId,
      client_secret: clientSecret
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw Object.assign(new Error("Guesty pricing connection could not be authenticated."), { status: 502 });
  }

  const payload = await response.json() as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
  };
  if (!payload.access_token) {
    throw Object.assign(new Error("Guesty pricing connection returned no access token."), { status: 502 });
  }

  const value: GuestyToken = {
    accessToken: payload.access_token,
    tokenType: payload.token_type || "Bearer",
    expiresAt: new Date(Date.now() + Math.max(300, Number(payload.expires_in) || 86_400) * 1000).toISOString()
  };
  await Setting.updateOne({ key }, { $set: { key, value } }, { upsert: true });
  return value;
}

async function getGuestyToken() {
  const clientId = text(process.env.GUESTY_CLIENT_ID);
  const clientSecret = text(process.env.GUESTY_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;

  if (!pendingToken) {
    pendingToken = requestGuestyToken(clientId, clientSecret).finally(() => {
      pendingToken = null;
    });
  }
  return pendingToken;
}

function calendarDays(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["days", "results", "calendar", "data"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      const nestedDays: unknown[] = calendarDays(value);
      if (nestedDays.length) return nestedDays;
    }
  }
  return record.date ? [record] : [];
}

async function fetchCalendarRates(listingId: string, year: number, month: number) {
  const token = await getGuestyToken();
  if (!token) return { configured: false as const, rates: [] as GuestyCalendarRate[] };

  const period = ownerPortalPeriod(year, month);
  const url = new URL(`https://open-api.guesty.com/v1/availability-pricing/api/calendar/listings/${encodeURIComponent(listingId)}`);
  url.searchParams.set("startDate", period.startDate);
  url.searchParams.set("endDate", period.endDate);
  url.searchParams.set("includeAllotment", "true");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `${token.tokenType} ${token.accessToken}`
    },
    cache: "no-store"
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Guesty pricing request failed with ${response.status}.`), { status: 502 });
  }

  const payload = await response.json();
  const rates = calendarDays(payload).flatMap<GuestyCalendarRate>((value) => {
    if (!value || typeof value !== "object") return [];
    const day = value as Record<string, unknown>;
    const allotment = typeof day.allotment === "number" ? day.allotment : null;
    const available = allotment === null ? text(day.status).toLowerCase() === "available" : allotment > 0;
    const date = text(day.date).slice(0, 10);
    const rate = typeof day.price === "number" ? day.price : Number(day.price);
    if (!available || !date || !Number.isFinite(rate)) return [];
    return [{ date, rate, currency: text(day.currency) || "USD" }];
  });

  return { configured: true as const, rates };
}

export async function loadOwnerCalendarRates(ownerId: string, property: string, year: number, month: number) {
  await connectDb();
  const owner = asPlain(await Owner.findById(ownerId).lean()) as OwnerLike | null;
  if (!owner) throw Object.assign(new Error("Owner not found."), { status: 404 });

  const fullYear = ownerPortalPeriod(year);
  const rows = owner.guestyReportUrl || owner.guestyAllPropertiesUrl
    ? await getGuestyReservations(owner, {
        limit: 1000,
        skip: 0,
        startDate: fullYear.startDate,
        endDate: fullYear.endDate,
        allProperties: true
      })
    : [];
  const normalizedProperty = property.trim().toLowerCase();
  const listingId = rows
    .filter((row) => row.property.trim().toLowerCase() === normalizedProperty)
    .map(listingIdFromReservation)
    .find(Boolean) || "";

  if (!listingId) {
    return {
      configured: Boolean(process.env.GUESTY_CLIENT_ID && process.env.GUESTY_CLIENT_SECRET),
      connected: false,
      rates: [] as GuestyCalendarRate[]
    };
  }

  const calendar = await fetchCalendarRates(listingId, year, month);
  return {
    configured: calendar.configured,
    connected: calendar.configured,
    rates: calendar.rates
  };
}
