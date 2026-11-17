/* Promo codes: reading one, judging one, and pricing with one.
 *
 * MONEY-PATH CODE. A code takes a percentage off the ITEMS SUBTOTAL of an order,
 * once, and nothing else. Delivery is never discounted. The browser sends a code
 * string and nothing else about money; the percentage, the discount and the
 * amount sent to Daraja are all decided here and in stk.js, and stored on the
 * order as recorded.
 *
 * A record lives in the same KV namespace as the orders, under promo:<CODE>:
 *
 *   { percent, endsAt, startsAt?, maxUses, oncePerPhone, active, channel }
 *
 * It is written by hand with `wrangler kv key put`. Nothing in this repo writes
 * one, and NOTHING EVER WRITES TO IT AFTER THAT: a record has no counter. Use is
 * counted as one marker key per paid order, promo-use:<CODE>:<reference>, written
 * by settle(); the cap is the number of those keys. A shared counter would be a
 * read-modify-write on a store with no compare-and-swap, and two orders settling
 * together would lose an increment. Two distinct keys cannot lose each other.
 *
 * Nothing here trusts a record further than isValid() below: a mistyped record
 * must not be able to price an order.
 *
 * ONE ANSWER FOR EVERY FAILURE. resolvePromo() returns { ok: false } whether the
 * code does not exist, has ended, has not started, is switched off, is used up,
 * was used by this phone already, or is a malformed record. A caller that could
 * tell them apart could probe for codes, and a guessable code is a public price.
 *
 * NO FLOATS IN THE MONEY PATH. discountFor() is integer arithmetic on whole KSh.
 *
 * This module imports nothing, so the test harness loads it unpatched.
 */

/* The hard ceiling. In shipped code, not data: a record saying 150 is invalid,
   not honoured and not clamped. */
export const MAX_PERCENT = 15;

/* The largest cap a record may carry. The cap is counted by listing marker keys
   at push time, following the cursor to the end, and a cap this size keeps that
   count to one page in ordinary use and a few at worst. */
export const MAX_USES_LIMIT = 1000;

/* Checked on the trimmed input BEFORE it is upper-cased, so a character whose
   upper-case form is ASCII (ß becomes SS) cannot be typed into a different code
   than the one that is looked up. */
const TYPED = /^[A-Za-z0-9-]{3,24}$/;

/* An ISO 8601 timestamp WITH an explicit offset. No offset means the instant
   depends on whichever zone parses it, and a cut-off that moves is not a
   cut-off. Date.parse() alone accepts both, so the shape is checked first. */
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The code as it is looked up, or null. Null means "not a usable code": the
 *  caller decides from the raw input whether that was an empty field (no code)
 *  or a code that failed the pattern (an invalid one). */
export function normaliseCode(input) {
  if (typeof input !== "string") return null;
  const typed = input.trim();
  return TYPED.test(typed) ? typed.toUpperCase() : null;
}

const instant = (value) => (typeof value === "string" && STAMP.test(value) ? Date.parse(value) : NaN);

/* The record as it stands, judged field by field. Anything unexpected is
   invalid rather than defaulted: `active: "true"` is not true, and an
   `oncePerPhone` that is not a boolean would otherwise quietly switch the limit
   off. */
function isValid(r) {
  if (r === null || typeof r !== "object" || Array.isArray(r)) return false;
  if (!Number.isInteger(r.percent) || r.percent < 1 || r.percent > MAX_PERCENT) return false;
  if (Number.isNaN(instant(r.endsAt))) return false;
  if (r.startsAt !== undefined && r.startsAt !== null && Number.isNaN(instant(r.startsAt))) return false;
  if (r.maxUses !== undefined && r.maxUses !== null) {
    if (!Number.isInteger(r.maxUses) || r.maxUses < 1 || r.maxUses > MAX_USES_LIMIT) return false;
  }
  if (r.oncePerPhone !== undefined && typeof r.oncePerPhone !== "boolean") return false;
  return r.active === true;
}

/* Lower-case hex of SHA-256. crypto.subtle is in the Workers runtime and in Node. */
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let out = "";
  for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** The part of a promo-phone key that stands for a phone: SHA-256 of the
 *  ALREADY-NORMALISED number (msisdnFrom()), in hex. The raw number never
 *  appears in a KV key.
 *
 *  A stated limit: Kenyan mobile numbers are a small space, so an unsalted hash
 *  can be enumerated by someone who can read the namespace. It keeps the number
 *  out of key listings and logs; it is not secrecy against that reader. */
export function phoneKey(phone) {
  return sha256Hex(String(phone));
}

/** The KV keys, one spelling each, here. The trailing colon on the prefix is what
 *  stops ALEX10 matching ALEX100: a code cannot contain one. */
export const promoKey = (code) => `promo:${code}`;
export const promoPhoneKey = (code, hash) => `promo-phone:${code}:${hash}`;
export const promoUsePrefix = (code) => `promo-use:${code}:`;
export const promoUseKey = (code, reference) => `${promoUsePrefix(code)}${reference}`;

/* How many paid orders a code has: the markers under its prefix, following the
   cursor until the list says it is complete. A list that throws throws out of
   here, and the caller answers 503 rather than guessing a count. */
async function usesOf(kv, code) {
  const prefix = promoUsePrefix(code);
  let count = 0;
  let cursor;
  for (;;) {
    const page = await kv.list(cursor ? { prefix, cursor } : { prefix });
    count += page.keys.length;
    if (page.list_complete) return count;
    /* Not complete and nothing to continue from. Returning the count so far would
       undercount, which fails OPEN: a full code would read as having room. Throw,
       and the push answers 503 like any other failed list. */
    if (!page.cursor) throw new Error("KV list is incomplete and gave no cursor");
    cursor = page.cursor;
  }
}

/**
 * Judges a code at one instant.
 *
 * Order: pattern, record exists, record valid, active, startsAt, endsAt, uses,
 * then once-per-phone. A KV failure — a read or a list that THROWS — is NOT
 * swallowed into { ok: false }: it throws, so the caller can say "unavailable"
 * instead of telling a buyer with a good code that it is not valid. A record that
 * reads fine but is not JSON is a different thing, a bad record, and is
 * { ok: false } like any other.
 *
 * LISTS AND READS CAN LAG. Workers KV is eventually consistent, by up to about a
 * minute, so a marker written a moment ago may not be counted yet and a cap can
 * be overshot by the orders paid in that window. That is the one remaining limit
 * on the cap, and it is a property of the store.
 *
 * @param kv        the ORDERS binding
 * @param input     whatever the browser sent as `promo`
 * @param now       ms since epoch; the instant the push is requested
 * @param phoneHash phoneKey() of the buyer's number
 * @returns {Promise<{ok: true, code: string, percent: number, record: object} | {ok: false}>}
 */
export async function resolvePromo(kv, input, now, phoneHash) {
  const code = normaliseCode(input);
  if (code === null) return { ok: false };

  /* Read as TEXT and parsed here. kv.get(key, "json") throws on a value that is
     not JSON, which is indistinguishable from KV being down and would answer 503
     for a mistyped record. The read can still throw; the parse cannot escape. */
  const text = await kv.get(promoKey(code));
  if (text === null || text === undefined) return { ok: false };
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (!isValid(record)) return { ok: false };

  if (record.startsAt !== undefined && record.startsAt !== null && now < instant(record.startsAt)) {
    return { ok: false };
  }
  if (now > instant(record.endsAt)) return { ok: false };

  if (record.maxUses !== undefined && record.maxUses !== null) {
    if ((await usesOf(kv, code)) >= record.maxUses) return { ok: false };
  }

  if (record.oncePerPhone === true) {
    if ((await kv.get(promoPhoneKey(code, phoneHash))) !== null) return { ok: false };
  }

  return { ok: true, code, percent: record.percent, record };
}

/**
 * The discount in whole KSh: floor(items * percent / 100).
 *
 * Both operands are integers, so the product is exact and the division is
 * correctly rounded; a quotient that is a whole number is exact, and one that is
 * not is at least 0.01 from the next whole number, so floor cannot land wrong.
 * Clamped so the items never reach zero — unreachable at the 15 percent cap,
 * kept because it is the guarantee that no amount sent to Daraja is below 1
 * whatever the cap becomes.
 */
export function discountFor(itemsSubtotal, percent) {
  if (!Number.isInteger(itemsSubtotal) || itemsSubtotal < 1) return 0;
  if (!Number.isInteger(percent) || percent < 1) return 0;
  return Math.max(0, Math.min(Math.floor((itemsSubtotal * percent) / 100), itemsSubtotal - 1));
}
