import { connectDb } from "@/lib/db";
import { Setting } from "@/lib/models";
import type { AppSettings, TenNinetyNineBasis } from "@/lib/types";

export const defaultSettings: AppSettings = {
  guestyCacheTtlMinutes: Number(process.env.DEFAULT_GUESTY_CACHE_TTL_MINUTES || 30),
  defaultCleaningCaps: [],
  tenNinetyNineBasis: "ownerPayout"
};

function basis(value: unknown): TenNinetyNineBasis {
  return value === "grossRents" ? "grossRents" : "ownerPayout";
}

export async function getSettings(): Promise<AppSettings> {
  await connectDb();
  const setting = await Setting.findOne({ key: "app" }).lean();
  const stored = (setting?.value || {}) as AppSettings;
  return {
    ...defaultSettings,
    ...stored,
    tenNinetyNineBasis: basis(stored.tenNinetyNineBasis)
  };
}

export async function saveSettings(value: Partial<AppSettings>) {
  await connectDb();
  const merged = {
    ...(await getSettings()),
    ...value
  };
  await Setting.updateOne({ key: "app" }, { $set: { value: merged } }, { upsert: true });
  return merged;
}
