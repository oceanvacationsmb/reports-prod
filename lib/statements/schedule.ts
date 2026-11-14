const timeZone = "America/New_York";

export type EtParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function etParts(date: Date): EtParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour") % 24,
    minute: value("minute"),
    second: value("second")
  };
}

export function etInstant(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = etParts(new Date(utcGuess));
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(utcGuess + (desired - actual));
}

export function isLastCalendarDay(date: Date) {
  const parts = etParts(date);
  const last = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  return parts.day === last;
}

export function previousMonth(year: number, month: number) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

export function sendWindow(year: number, month: number) {
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    start: etInstant(next.year, next.month, 1, 0, 0, 0),
    end: etInstant(next.year, next.month, 3, 23, 59, 59)
  };
}

export function monthLabel(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}
