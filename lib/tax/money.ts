export function money(value: number) {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-8)) / 100;
}

export function formatDollars(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(money(value));
}

export function plainAmount(value: number) {
  return money(value).toFixed(2);
}

export function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function periodEnd(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function periodStart(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function formatLongDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

export function weekday(isoDate: string) {
  return new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
}

export function monthsPast(deadline: string, asOf: string) {
  if (asOf <= deadline) return 0;
  const [dy, dm, dd] = deadline.split("-").map(Number);
  const [ay, am, ad] = asOf.split("-").map(Number);
  let months = (ay - dy) * 12 + (am - dm);
  if (ad < dd) months -= 1;
  return Math.max(1, months);
}
