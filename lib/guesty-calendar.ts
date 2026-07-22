import crypto from "crypto";
import { connectDb } from "@/lib/db";
import { getGuestyReservations } from "@/lib/guesty";
import { asPlain } from "@/lib/http";
import { Owner, Property, Setting } from "@/lib/models";
import { ownerPortalPeriod } from "@/lib/owner-portal";
import type { NormalizedReservation, OwnerLike } from "@/lib/types";

type GuestyToken = {
  accessToken: string;
  tokenType: string;
  expiresAt: string;
};

type GuestyCalendarCache = {
  rates: GuestyCalendarRate[];
  fetchedAt: string;
  freshUntil: string;
  staleUntil: string;
};

type CalendarRateResult = {
  rates: GuestyCalendarRate[];
  cached: boolean;
  stale: boolean;
  throttled: boolean;
};

type GuestyListing = {
  id: string;
  nickname: string;
  title: string;
  address: string;
};

type GuestyListingCache = {
  listings: GuestyListing[];
  freshUntil: string;
  staleUntil: string;
};

export type GuestyCalendarRate = {
  date: string;
  rate: number;
  currency: string;
};

let pendingToken: Promise<GuestyToken> | null = null;
const pendingCalendars = new Map<string, Promise<CalendarRateResult>>();

const TOKEN_LOCK_SECONDS = 20;
const CALENDAR_LOCK_SECONDS = 20;
const CALENDAR_STALE_HOURS = 24;
const LISTING_CACHE_HOURS = 24;
const LISTING_STALE_DAYS = 7;
const DEFAULT_THROTTLE_SECONDS = 60;
const EMPTY_DATE = "1970-01-01T00:00:00.000Z";

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

function accountKey(prefix: string, clientId: string) {
  const idHash = crypto.createHash("sha256").update(clientId).digest("hex").slice(0, 12);
  return `${prefix}-${idHash}`;
}

function calendarSettingsKey(listingId: string, year: number, month: number) {
  const idHash = crypto.createHash("sha256").update(listingId).digest("hex").slice(0, 16);
  return `guesty-calendar-${idHash}-${year}-${String(month).padStart(2, "0")}`;
}

function normalizeLookup(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function listingAddress(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const address = value as Record<string, unknown>;
  const full = text(address.full);
  if (full) return full;
  return [address.street, address.city, address.state, address.zipcode]
    .map(text)
    .filter(Boolean)
    .join(", ");
}

function dateValue(value: unknown) {
  const timestamp = typeof value === "string" || value instanceof Date ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cacheMinutes() {
  return Math.max(5, Number(process.env.GUESTY_CALENDAR_CACHE_TTL_MINUTES) || 30);
}

async function ensureLock(key: string) {
  await Setting.updateOne(
    { key },
    { $setOnInsert: { key, value: { lockedUntil: EMPTY_DATE } } },
    { upsert: true }
  );
}

async function acquireLock(key: string, seconds: number) {
  await ensureLock(key);
  const now = new Date();
  const locked = await Setting.findOneAndUpdate(
    {
      key,
      $or: [
        { "value.lockedUntil": { $exists: false } },
        { "value.lockedUntil": { $lte: now.toISOString() } }
      ]
    },
    { $set: { "value.lockedUntil": new Date(now.getTime() + seconds * 1000).toISOString() } },
    { new: true }
  ).lean();
  return Boolean(locked);
}

async function releaseLock(key: string) {
  await Setting.updateOne({ key }, { $set: { "value.lockedUntil": EMPTY_DATE } });
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

  // Guesty limits token creation heavily, so coordinate refreshes across server instances.
  const lockKey = accountKey("guesty-open-api-token-lock", clientId);
  const acquired = await acquireLock(lockKey, TOKEN_LOCK_SECONDS);
  if (!acquired) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await sleep(250);
      const refreshed = await Setting.findOne({ key }).lean() as { value?: unknown } | null;
      if (validCachedToken(refreshed?.value)) return refreshed.value;
    }
    throw Object.assign(new Error("Guesty pricing authentication is already refreshing. Please try again shortly."), { status: 503 });
  }

  try {
    const refreshed = await Setting.findOne({ key }).lean() as { value?: unknown } | null;
    if (validCachedToken(refreshed?.value)) return refreshed.value;

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
  } finally {
    await releaseLock(lockKey);
  }
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
  if (!token) return [] as GuestyCalendarRate[];

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
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter && /^\d+$/.test(retryAfter)
      ? Number(retryAfter)
      : DEFAULT_THROTTLE_SECONDS;
    const error = Object.assign(new Error("Guesty pricing is temporarily rate limited."), {
      status: 429,
      retryAfterSeconds: Math.min(3600, Math.max(DEFAULT_THROTTLE_SECONDS, seconds))
    });
    throw error;
  }
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

  return rates;
}

function validListingCache(value: unknown): value is GuestyListingCache {
  if (!value || typeof value !== "object") return false;
  const cache = value as Partial<GuestyListingCache>;
  return Array.isArray(cache.listings) && Boolean(cache.freshUntil && cache.staleUntil);
}

async function fetchGuestyListings() {
  const token = await getGuestyToken();
  if (!token) return [] as GuestyListing[];

  const listings: GuestyListing[] = [];
  let skip = 0;
  let total = 1;

  while (skip < total) {
    const url = new URL("https://open-api.guesty.com/v1/listings");
    url.searchParams.set("limit", "100");
    url.searchParams.set("skip", String(skip));
    url.searchParams.set("fields", "_id nickname title address");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `${token.tokenType} ${token.accessToken}`
      },
      cache: "no-store"
    });
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter && /^\d+$/.test(retryAfter)
        ? Number(retryAfter)
        : DEFAULT_THROTTLE_SECONDS;
      throw Object.assign(new Error("Guesty pricing is temporarily rate limited."), {
        status: 429,
        retryAfterSeconds: Math.min(3600, Math.max(DEFAULT_THROTTLE_SECONDS, seconds))
      });
    }
    if (!response.ok) {
      throw Object.assign(new Error(`Guesty listings request failed with ${response.status}.`), { status: 502 });
    }

    const payload = await response.json() as {
      results?: Array<Record<string, unknown>>;
      count?: number;
    };
    const page = Array.isArray(payload.results) ? payload.results : [];
    for (const item of page) {
      const id = text(item._id) || text(item.id);
      if (!id) continue;
      listings.push({
        id,
        nickname: text(item.nickname),
        title: text(item.title),
        address: listingAddress(item.address)
      });
    }

    total = Math.max(0, Number(payload.count) || page.length);
    skip += page.length;
    if (!page.length || page.length < 100) break;
  }

  return listings;
}

async function guestyListings(clientId: string) {
  // Listing IDs are stable; a shared daily directory avoids one lookup per property or visitor.
  const key = accountKey("guesty-listings", clientId);
  const record = await Setting.findOne({ key }).lean() as { value?: unknown } | null;
  const cached = validListingCache(record?.value) ? record.value : null;
  if (cached && dateValue(cached.freshUntil) > Date.now()) return cached.listings;
  if (await pricingCooldownActive(clientId)) {
    return cached && dateValue(cached.staleUntil) > Date.now() ? cached.listings : [];
  }

  const lockKey = `${key}-lock`;
  const acquired = await acquireLock(lockKey, CALENDAR_LOCK_SECONDS);
  if (!acquired) {
    if (cached && dateValue(cached.staleUntil) > Date.now()) return cached.listings;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await sleep(250);
      const refreshed = await Setting.findOne({ key }).lean() as { value?: unknown } | null;
      if (validListingCache(refreshed?.value)) return refreshed.value.listings;
    }
    return [];
  }

  try {
    const listings = await fetchGuestyListings();
    const fetchedAt = new Date();
    const value: GuestyListingCache = {
      listings,
      freshUntil: new Date(fetchedAt.getTime() + LISTING_CACHE_HOURS * 60 * 60_000).toISOString(),
      staleUntil: new Date(fetchedAt.getTime() + LISTING_STALE_DAYS * 24 * 60 * 60_000).toISOString()
    };
    await Setting.updateOne({ key }, { $set: { key, value } }, { upsert: true });
    return listings;
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
    if (status === 429) {
      const retryAfterSeconds = typeof error === "object" && error && "retryAfterSeconds" in error
        ? Number(error.retryAfterSeconds)
        : DEFAULT_THROTTLE_SECONDS;
      await setPricingCooldown(clientId, retryAfterSeconds);
    }
    if (cached && dateValue(cached.staleUntil) > Date.now()) return cached.listings;
    throw error;
  } finally {
    await releaseLock(lockKey);
  }
}

function matchListing(listings: GuestyListing[], propertyName: string, reportAddress: string) {
  const targets = [propertyName, reportAddress].map(normalizeLookup).filter(Boolean);
  if (!targets.length) return "";

  const exact = listings.find((listing) => {
    const candidates = [listing.nickname, listing.title, listing.address].map(normalizeLookup).filter(Boolean);
    return targets.some((target) => candidates.includes(target));
  });
  if (exact) return exact.id;

  const contained = listings.find((listing) => {
    const candidates = [listing.nickname, listing.title, listing.address].map(normalizeLookup).filter(Boolean);
    return targets.some((target) => target.length >= 6 && candidates.some((candidate) => candidate.includes(target) || target.includes(candidate)));
  });
  return contained?.id || "";
}

function validCalendarCache(value: unknown): value is GuestyCalendarCache {
  if (!value || typeof value !== "object") return false;
  const cache = value as Partial<GuestyCalendarCache>;
  return Array.isArray(cache.rates) && Boolean(cache.freshUntil && cache.staleUntil);
}

async function readCalendarCache(key: string) {
  const record = await Setting.findOne({ key }).lean() as { value?: unknown } | null;
  return validCalendarCache(record?.value) ? record.value : null;
}

async function setPricingCooldown(clientId: string, seconds: number) {
  const key = accountKey("guesty-pricing-cooldown", clientId);
  const until = new Date(Date.now() + seconds * 1000).toISOString();
  await Setting.updateOne({ key }, { $set: { key, value: { until } } }, { upsert: true });
}

async function pricingCooldownActive(clientId: string) {
  const key = accountKey("guesty-pricing-cooldown", clientId);
  const record = await Setting.findOne({ key }).lean() as { value?: { until?: unknown } } | null;
  return dateValue(record?.value?.until) > Date.now();
}

function calendarResult(cache: GuestyCalendarCache, stale: boolean, throttled = false): CalendarRateResult {
  return { rates: cache.rates, cached: true, stale, throttled };
}

async function waitForCalendarRefresh(key: string, fallback: GuestyCalendarCache | null) {
  if (fallback && dateValue(fallback.staleUntil) > Date.now()) return calendarResult(fallback, true);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(250);
    const cache = await readCalendarCache(key);
    if (cache && dateValue(cache.freshUntil) > Date.now()) return calendarResult(cache, false);
  }
  return { rates: [] as GuestyCalendarRate[], cached: false, stale: false, throttled: false };
}

async function cachedCalendarRates(listingId: string, year: number, month: number): Promise<CalendarRateResult> {
  const clientId = text(process.env.GUESTY_CLIENT_ID);
  const key = calendarSettingsKey(listingId, year, month);
  const cached = await readCalendarCache(key);
  if (cached && dateValue(cached.freshUntil) > Date.now()) return calendarResult(cached, false);

  if (await pricingCooldownActive(clientId)) {
    if (cached && dateValue(cached.staleUntil) > Date.now()) return calendarResult(cached, true, true);
    return { rates: [], cached: false, stale: false, throttled: true };
  }

  const pending = pendingCalendars.get(key);
  if (pending) return pending;

  const refresh = (async () => {
    const lockKey = `${key}-lock`;
    const acquired = await acquireLock(lockKey, CALENDAR_LOCK_SECONDS);
    if (!acquired) return waitForCalendarRefresh(key, cached);

    try {
      const refreshed = await readCalendarCache(key);
      if (refreshed && dateValue(refreshed.freshUntil) > Date.now()) return calendarResult(refreshed, false);

      const rates = await fetchCalendarRates(listingId, year, month);
      const fetchedAt = new Date();
      const value: GuestyCalendarCache = {
        rates,
        fetchedAt: fetchedAt.toISOString(),
        freshUntil: new Date(fetchedAt.getTime() + cacheMinutes() * 60_000).toISOString(),
        staleUntil: new Date(fetchedAt.getTime() + CALENDAR_STALE_HOURS * 60 * 60_000).toISOString()
      };
      await Setting.updateOne({ key }, { $set: { key, value } }, { upsert: true });
      return { rates, cached: false, stale: false, throttled: false };
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
      if (status === 429) {
        const retryAfterSeconds = typeof error === "object" && error && "retryAfterSeconds" in error
          ? Number(error.retryAfterSeconds)
          : DEFAULT_THROTTLE_SECONDS;
        await setPricingCooldown(clientId, retryAfterSeconds);
        if (cached && dateValue(cached.staleUntil) > Date.now()) return calendarResult(cached, true, true);
        return { rates: [], cached: false, stale: false, throttled: true };
      }
      if (cached && dateValue(cached.staleUntil) > Date.now()) return calendarResult(cached, true);
      throw error;
    } finally {
      await releaseLock(lockKey);
    }
  })().finally(() => pendingCalendars.delete(key));

  pendingCalendars.set(key, refresh);
  return refresh;
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
  let listingId = rows
    .filter((row) => row.property.trim().toLowerCase() === normalizedProperty)
    .map(listingIdFromReservation)
    .find(Boolean) || "";

  const clientId = text(process.env.GUESTY_CLIENT_ID);
  const clientSecret = text(process.env.GUESTY_CLIENT_SECRET);
  if (!listingId && clientId && clientSecret) {
    const propertyRecord = await Property.findOne({ name: property }).lean() as { reportAddress?: string } | null;
    listingId = matchListing(await guestyListings(clientId), property, text(propertyRecord?.reportAddress));
  }

  if (!listingId) {
    return {
      configured: Boolean(clientId && clientSecret),
      connected: false,
      rates: [] as GuestyCalendarRate[]
    };
  }

  const calendar = await cachedCalendarRates(listingId, year, month);
  return {
    configured: true,
    connected: true,
    rates: calendar.rates,
    cached: calendar.cached,
    stale: calendar.stale,
    throttled: calendar.throttled
  };
}
