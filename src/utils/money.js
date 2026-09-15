import Decimal from "decimal.js";

// Money never goes through JS floats. NUMERIC columns arrive from pg as
// strings and client amounts as strings or numbers; both stay Decimal until
// they are written back with money()/qty()/rate().
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const dec = (value) => new D(value ?? 0);

export const round = (value, dp = 2) =>
  dec(value).toDecimalPlaces(dp, D.ROUND_HALF_UP);

/** Column-ready strings matching the schema's scales. */
export const money = (value) => round(value, 2).toFixed(2);
export const qty = (value) => round(value, 3).toFixed(3);
export const rate = (value) => round(value, 4).toFixed(4);

export const sum = (values) =>
  values.reduce((total, value) => total.plus(dec(value)), dec(0));

export const percentOf = (value, pct) =>
  dec(value).times(dec(pct)).dividedBy(100);

export { D as Decimal };
