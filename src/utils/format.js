import { dec } from "./money.js";

/** Indian digit grouping: 1234567.5 -> "12,34,567.50". */
export function formatINR(value, decimals = 2) {
  const fixed = dec(value).toFixed(decimals);
  const negative = fixed.startsWith("-");
  const [integer, fraction] = fixed.replace("-", "").split(".");
  const lastThree = integer.slice(-3);
  const rest = integer.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}` : lastThree;
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** Rates keep their significant decimals (0.55, 12.125) but show at least two. */
export const formatRate = (value) => formatINR(value, Math.max(2, dec(value).decimalPlaces()));

/** Quantities without trailing zeros: "250.500" -> "250.5". */
export const formatQuantity = (value) => dec(value).toFixed();

export const formatPercent = (value) => `${dec(value).toFixed()}%`;

/** 'YYYY-MM-DD' -> 'DD-MM-YYYY'; empty for no date. */
export const formatDate = (date) => (date ? date.split("-").reverse().join("-") : "");

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const belowHundred = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);

const belowThousand = (n) =>
  [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", n % 100 ? belowHundred(n % 100) : ""]
    .filter(Boolean)
    .join(" ");

/** Indian system: crore, lakh, thousand. */
function integerInWords(n) {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  return [
    crore ? `${integerInWords(crore)} Crore` : "",
    lakh ? `${belowHundred(lakh)} Lakh` : "",
    thousand ? `${belowHundred(thousand)} Thousand` : "",
    rest ? belowThousand(rest) : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** "4720.50" -> "Rupees Four Thousand Seven Hundred Twenty and Fifty Paise Only". */
export function amountInWords(value) {
  const [rupees, paise] = dec(value).abs().toFixed(2).split(".");
  const paiseWords = Number(paise) ? ` and ${belowHundred(Number(paise))} Paise` : "";
  return `Rupees ${integerInWords(Number(rupees))}${paiseWords} Only`;
}

const STATES = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  10: "Bihar",
  11: "Sikkim",
  12: "Arunachal Pradesh",
  13: "Nagaland",
  14: "Manipur",
  15: "Mizoram",
  16: "Tripura",
  17: "Meghalaya",
  18: "Assam",
  19: "West Bengal",
  20: "Jharkhand",
  21: "Odisha",
  22: "Chhattisgarh",
  23: "Madhya Pradesh",
  24: "Gujarat",
  25: "Daman and Diu",
  26: "Dadra and Nagar Haveli and Daman and Diu",
  27: "Maharashtra",
  29: "Karnataka",
  30: "Goa",
  31: "Lakshadweep",
  32: "Kerala",
  33: "Tamil Nadu",
  34: "Puducherry",
  35: "Andaman and Nicobar Islands",
  36: "Telangana",
  37: "Andhra Pradesh",
  38: "Ladakh",
  96: "Other Country",
  97: "Other Territory",
};

/** GST state name for a 2-digit state code. */
export const stateName = (code) => STATES[code] ?? `State ${code}`;
