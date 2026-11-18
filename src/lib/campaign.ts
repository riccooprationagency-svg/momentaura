import data from "../data/campaign.json";
import { categories, isListed, products, type Product } from "./products";

/* The Black November campaign, read once at build and checked before anything
 * renders from it.
 *
 * Everything the page says is a field here. The slug list is explicit on
 * purpose: "black" is a claim made product by product, never inferred from a
 * colour word in a name, because the cropped hoodie is beige and a wrong claim
 * on a page about colour is the kind a suspicious buyer finds first.
 *
 * It throws rather than correcting. A date typed as 2026-11-31, a slug that
 * lost a letter, or a promo percent of 90 is a build that stops, not a page
 * that quietly shows something else.
 */

export interface Campaign {
  name: string;
  /** First day, ISO date. */
  startsOn: string;
  /** Last day, ISO date. Orders paid through 23:59 EAT count. */
  endsOn: string;
  slugs: string[];
  /** Exactly four, a subset of slugs, in the order they take their turn. */
  showcase: string[];
  /** Whether the page may state the code. Off until the discount really exists. */
  promoPublic: boolean;
  promoCode: string;
  promoPercent: number;
  /** Real production figure, or null. Null means no capacity notice renders. */
  runSize: number | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/* A real calendar day, not just a string of the right shape: 2026-11-31 matches
   the pattern and is not a day. Round-tripping through UTC is the check. */
const isRealDate = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
};

const catalogue = new Set(products.map((p) => p.slug));
const raw = data as unknown as Campaign;
const fail = (message: string): never => {
  throw new Error(`campaign.json: ${message}`);
};

if (typeof raw.name !== "string" || raw.name.trim() === "") fail(`"name" must be a non-empty string.`);
if (!isRealDate(raw.startsOn)) fail(`"startsOn" is ${JSON.stringify(raw.startsOn)} — it needs a real ISO date like 2026-11-17.`);
if (!isRealDate(raw.endsOn)) fail(`"endsOn" is ${JSON.stringify(raw.endsOn)} — it needs a real ISO date like 2026-11-30.`);
if (raw.startsOn > raw.endsOn) fail(`"startsOn" ${raw.startsOn} is after "endsOn" ${raw.endsOn}.`);

if (!Array.isArray(raw.slugs) || raw.slugs.length === 0) fail(`"slugs" must be a non-empty array.`);
const seen = new Set<string>();
for (const slug of raw.slugs) {
  if (!catalogue.has(slug)) fail(`slug "${slug}" is not in products.json.`);
  if (seen.has(slug)) fail(`slug "${slug}" appears twice in "slugs".`);
  seen.add(slug);
}

if (!Array.isArray(raw.showcase) || raw.showcase.length !== 4) {
  fail(`"showcase" must be exactly four slugs, not ${Array.isArray(raw.showcase) ? raw.showcase.length : JSON.stringify(raw.showcase)}.`);
}
const shown = new Set<string>();
for (const slug of raw.showcase) {
  if (!catalogue.has(slug)) fail(`showcase slug "${slug}" is not in products.json.`);
  if (!seen.has(slug)) fail(`showcase slug "${slug}" is not in "slugs".`);
  if (shown.has(slug)) fail(`showcase slug "${slug}" appears twice.`);
  shown.add(slug);
}

if (typeof raw.promoPublic !== "boolean") fail(`"promoPublic" must be true or false.`);
if (!Number.isInteger(raw.promoPercent) || raw.promoPercent < 1 || raw.promoPercent > 15) {
  fail(`"promoPercent" is ${JSON.stringify(raw.promoPercent)} — a whole number from 1 to 15.`);
}
if (typeof raw.promoCode !== "string") fail(`"promoCode" must be a string.`);
if (raw.promoPublic && raw.promoCode.trim() === "") fail(`"promoPublic" is true but "promoCode" is empty.`);
if (raw.runSize !== null && !(Number.isInteger(raw.runSize) && raw.runSize > 0)) {
  fail(`"runSize" is ${JSON.stringify(raw.runSize)} — a positive whole number, or null.`);
}

export const campaign: Campaign = raw;

/** Today's date in Nairobi (EAT, UTC+3, no daylight saving), read once at build. */
export const buildDay = (): string =>
  new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** True from startsOn to endsOn inclusive. ISO dates compare as strings. */
export const campaignLive = (today: string = buildDay()): boolean =>
  campaign.startsOn <= today && today <= campaign.endsOn;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* Parsed from the string, never through Date, so no timezone can move the day. */
const parts = (iso: string) => {
  const [, y, m, d] = ISO_DATE.exec(iso)!;
  return { year: Number(y), month: Number(m) - 1, day: Number(d) };
};

/** "30 Nov" */
export const shortDate = (iso: string): string => {
  const { month, day } = parts(iso);
  return `${day} ${MONTHS[month]}`;
};

/** "30 November" */
export const longDate = (iso: string): string => {
  const { month, day } = parts(iso);
  return `${day} ${MONTHS_LONG[month]}`;
};

/** The campaign's LISTED products in "slugs" order, grouped by category in the
 *  catalogue's declared category order. Nothing outside "slugs" appears, and a
 *  product without a photograph (isListed, src/lib/products.ts) does not: a slug
 *  stays valid in campaign.json, it just is not offered until it is listed. */
export const campaignGroups = (): { slug: string; name: string; items: Product[] }[] => {
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const items = campaign.slugs.map((s) => bySlug.get(s)!).filter(isListed);
  return categories
    .map((c) => ({ slug: c.slug, name: c.name, items: items.filter((p) => p.category === c.slug) }))
    .filter((g) => g.items.length > 0);
};
