export type OwnerReservationQuery = {
  limit: number;
  skip: number;
  startDate: string;
  endDate: string;
  allProperties: true;
};

/** Full-year Guesty snapshot used by statements and the income page, so both read the same cache. */
export function ownerReportReservationQuery(year: number): OwnerReservationQuery {
  return {
    limit: 1000,
    skip: 0,
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    allProperties: true
  };
}

export function reservationQueryForPeriod(startDate: string, endDate: string): OwnerReservationQuery {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const firstYear = Number.isFinite(startYear) ? startYear : new Date().getUTCFullYear();
  const lastYear = Number.isFinite(endYear) ? endYear : firstYear;
  if (firstYear === lastYear) return ownerReportReservationQuery(firstYear);
  const start = Math.min(firstYear, lastYear);
  const end = Math.max(firstYear, lastYear);
  return {
    limit: 1000,
    skip: 0,
    startDate: `${start}-01-01`,
    endDate: `${end}-12-31`,
    allProperties: true
  };
}
