const BUSINESS_TIMEZONE = "Asia/Kolkata";

/** Today's date as 'YYYY-MM-DD' in Indian time, not the server's timezone. */
export const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE }).format(
    new Date(),
  );

/**
 * Financial year label for a 'YYYY-MM-DD' date, e.g. '2026-27' for
 * 2026-09-15 with the Indian April start. A January start gives '2026-26'.
 */
export function financialYear(date, startMonth = 4) {
  const [year, month] = date.split("-").map(Number);
  const startYear = month >= startMonth ? year : year - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  return `${startYear}-${String(endYear % 100).padStart(2, "0")}`;
}

/** 'YYYY-MM-DD' plus a number of days. */
export const addDays = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** First day ('YYYY-MM-DD') of the financial year containing `date`. */
export function financialYearStart(date, startMonth = 4) {
  const startYear = Number(financialYear(date, startMonth).slice(0, 4));
  return `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
}
