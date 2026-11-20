const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

export function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function periodEndingDate(year: number, month: number) {
  const day = lastDayOfMonth(year, month);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${mm}/${dd}/${year}`;
}

export function periodLabel(year: number, month: number) {
  return `${monthNames[month - 1] || "Month"} ${year}`;
}

export function monthName(month: number) {
  return monthNames[month - 1] || "";
}

export function monthAbbrev(month: number) {
  return (monthNames[month - 1] || "").slice(0, 3);
}

export function propertyActiveInMonth(
  property: { managedFrom?: string; managedTo?: string },
  year: number,
  month: number
) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDayOfMonth(year, month)).padStart(2, "0")}`;
  const from = (property.managedFrom || "").trim();
  const to = (property.managedTo || "").trim();
  if (from && from > end) return false;
  if (to && to < start) return false;
  return true;
}
