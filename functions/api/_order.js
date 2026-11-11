/* Reading an order request, and re-pricing it from our own catalogue.
 *
 * THIS IS THE MONEY-PATH VALIDATION, AND IT EXISTS ONCE ON PURPOSE. It was
 * written to be shared by step 8's IntaSend checkout and step 9's Daraja STK
 * push, and stayed its own module after IntaSend was retired: a second gateway
 * arriving later gets the same rules for free, rather than a chance to drift
 * from /api/mpesa/stk's copy of "never trust a client price."
 *
 * The contract: readOrder() is handed whatever came off the wire and returns
 * either a priced order or a refusal. It never throws, never partially accepts,
 * and never returns a total it did not compute itself.
 *
 * PRICE IS NOT IN THE ACCEPTED SHAPE. There is no field to trust or to forget to
 * ignore — a client that can set its own price sets it to zero. Every figure
 * below is looked up by slug in the catalogue this module imported at build
 * time. Anything the request says about money is read past.
 */

import catalogue from "../../src/data/products.json";
import { REACH, ZONES } from "./_site.js";

/* Same ceiling the cart applies on read. A request is not the cart, so it is
   restated here rather than assumed. */
export const MAX_QTY = 99;

/* A basket, not a wholesale order. Ten distinct lines is far past what this
   catalogue can produce; past that it is someone probing, and the bulk route is
   a conversation with a person. */
export const MAX_LINES = 10;

/* Kenyan mobile numbers, the shapes people actually type: 07XXXXXXXX,
   01XXXXXXXX, +2547XXXXXXXX, 2541XXXXXXXX. Whitespace is stripped first because
   people type it and rejecting a valid number over a space is a checkout that
   loses an order for nothing. */
const PHONE = /^(?:\+?254|0)[17]\d{8}$/;

/* Deliberately loose. An address this rejects is a customer lost, and the only
   thing riding on it is a receipt the buyer asked for. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BY_SLUG = new Map(catalogue.map((p) => [p.slug, p]));

/* Where it is going. Long enough for "Kahawa Sukari, off Thika Road" and for a
 * landmark a rider can find, short enough that nothing absurd is stored against
 * an order or read out over the phone. */
export const MAX_AREA = 80;
export const MAX_LANDMARK = 120;

/* Typed text, made one line. Runs of whitespace (a pasted newline, a tab) become
 * one space; anything else below 0x20, and DEL, refuses the field rather than
 * being stored, because there is no honest reading of a control character in an
 * estate name. Rendering is escaped wherever it happens — Astro escapes, and the
 * cart writes through textContent — so this is about storing clean data, not
 * about being the only defence against markup. Returns null when the value is
 * not a string, is shorter than two characters, or is longer than `max`. */
function line(value, max) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length < 2 || clean.length > max) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(clean)) return null;
  return clean;
}

/* What is wrong with the request. Every message says what happened and what to
 * do about it, and none of them says "something went wrong".
 *
 * What HAPPENED TO THE MONEY is not here — that is different per gateway and
 * each endpoint owns its own wording for it.
 *
 * PHONE NUMBER: CLAUDE.md requires one on an error. The messages about the
 * order as a whole carry it, from site.json through _site.js. The ones naming a
 * single field the buyer typed do not: the fix is in their own hands, the
 * message sits under that field, and the page carries the number beside the
 * form in markup (OrderHelp.astro). A phone number under every mistyped email
 * address is noise, not help. */
export const MESSAGES = {
  bad_request: `That order could not be read. Go back to your order and try again, or ${REACH}.`,
  empty: "There is nothing in your order yet.",
  name: "Enter the name the order is for.",
  phone: "Enter a Kenyan phone number, like 0712 345 678. M-Pesa sends the prompt to it.",
  email: "That email address does not look right. Leave it blank if you would rather not give one.",
  gone: `One of the items in your order is no longer available. Go back to your order and remove it, or ${REACH}.`,
  county: "Choose the county the order is going to.",
  area: "Enter the area or estate the order is going to.",
  landmark: "Enter a landmark a rider can find, like a shop or a stage.",
};

/* Order reference. Unambiguous read-aloud alphabet: no O/0, no I/1, no S/5,
 * because this number gets read down a phone line and screenshotted into
 * WhatsApp. crypto.getRandomValues, not Math.random — a guessable reference is
 * a lookup key for someone else's order the moment /track exists in step 10. */
const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";

export function reference() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `MA-${out.slice(0, 4)}-${out.slice(4)}`;
}

/* One shape reaches every gateway however the buyer typed it: 2547XXXXXXXX or
 * 2541XXXXXXXX. Exported because /api/track matches a caller against the number
 * an order was placed with, and two copies of this normalisation would mean a
 * buyer who typed +254 at checkout and 07 at tracking failed to find their own
 * order. Returns null if it is not a Kenyan mobile number at all. */
export function msisdnFrom(value) {
  const clean = typeof value === "string" ? value.replace(/[\s-]/g, "") : "";
  if (!PHONE.test(clean)) return null;
  return clean.replace(/^\+/, "").replace(/^0/, "254");
}

const no = (status, message, field) => ({ ok: false, status, message, field });

/**
 * Reads and re-prices an order request.
 *
 * DELIVERY IS PRICED HERE TOO, by county key, from the fee table in site.json
 * (via _site.js). The request names a county; it never names a fee. A `fee`,
 * `delivery`, `subtotal` or `total` in the payload is not destructured and
 * not read — the same rule as price, for the same reason.
 *
 * One flat fee per order, not per item.
 *
 * @param {unknown} payload  whatever came off the wire, already JSON-parsed
 * @returns {{ok: true, name: string, email: string|null, msisdn: string,
 *            lines: {slug: string, name: string, qty: number, price: number, amount: number}[],
 *            subtotal: number,
 *            delivery: {county: string, label: string, area: string, landmark: string, fee: number},
 *            total: number}
 *          | {ok: false, status: number, message: string, field?: string}}
 */
export function readOrder(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return no(400, MESSAGES.bad_request);
  }

  const { items, name, phone, email, county, area, landmark } = payload;

  if (!Array.isArray(items) || items.length === 0) return no(400, MESSAGES.empty, "items");
  if (items.length > MAX_LINES) return no(400, MESSAGES.bad_request, "items");

  /* ---------- the customer ---------- */

  const cleanName = typeof name === "string" ? name.trim() : "";
  if (cleanName.length < 2 || cleanName.length > 80) return no(400, MESSAGES.name, "name");

  const msisdn = msisdnFrom(phone);
  if (msisdn === null) return no(400, MESSAGES.phone, "phone");

  /* Optional, and blank is a valid answer rather than an error. */
  let cleanEmail = null;
  if (typeof email === "string" && email.trim() !== "") {
    cleanEmail = email.trim();
    if (cleanEmail.length > 254 || !EMAIL.test(cleanEmail)) {
      return no(400, MESSAGES.email, "email");
    }
  }

  /* ---------- where it is going ---------- */

  /* A key from the table, or refused. An unknown key is never priced at zero or
     at a default: a county this shop has no fee for is one it has not agreed to
     deliver to. Own-property lookup on a Map, so "__proto__" and friends are
     simply unknown keys. */
  const zone = typeof county === "string" ? ZONES.get(county) : undefined;
  if (!zone) return no(400, MESSAGES.county, "county");

  const cleanArea = line(area, MAX_AREA);
  if (cleanArea === null) return no(400, MESSAGES.area, "area");

  const cleanLandmark = line(landmark, MAX_LANDMARK);
  if (cleanLandmark === null) return no(400, MESSAGES.landmark, "landmark");

  /* ---------- re-price from our own catalogue ---------- */

  const lines = [];
  const seen = new Set();
  let subtotal = 0;

  for (const item of items) {
    if (item === null || typeof item !== "object") return no(400, MESSAGES.bad_request, "items");

    const slug = item.slug;
    if (typeof slug !== "string") return no(400, MESSAGES.bad_request, "items");

    /* One line per product. Two lines for the same slug would otherwise let a
       quantity cap be stepped around by repeating the slug. */
    if (seen.has(slug)) return no(400, MESSAGES.bad_request, "items");
    seen.add(slug);

    const product = BY_SLUG.get(slug);
    /* Not in the catalogue: rejected, never skipped. Silently dropping a line
       sends the buyer to a payment page for less than they asked for. */
    if (!product) return no(422, MESSAGES.gone, "items");

    const qty = item.qty;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return no(400, MESSAGES.bad_request, "items");
    }

    /* Named, and blocking. Never silently dropped. */
    if (product.stock === 0) {
      return no(409, `${product.name} is sold out, so this order cannot be sent. Go back to your order and remove it, or ${REACH}.`, "items");
    }

    if (qty > product.stock) {
      return no(409, `There are only ${product.stock} of the ${product.name} left. Lower the quantity in your order and try again, or ${REACH}.`, "items");
    }

    /* THE SIZE, for a product that is made in sizes, and only for one. The
       checkout form posts it as its own field, size-<slug>, from a native
       <select> on that line, so it reaches here beside the items rather than
       inside them. Matched exactly against the labels in products.json: a
       label that is not one of them is refused rather than stored, because an
       order for a size nobody makes is an order that cannot be packed.
       A product with no sizes ignores the field entirely — the form posts one
       per sized product whether or not it is in the order. */
    const sizes = Array.isArray(product.sizes) ? product.sizes : [];
    let size = null;
    if (sizes.length > 0) {
      const field = `size-${slug}`;
      const chosen = Object.hasOwn(payload, field) ? payload[field] : undefined;
      size = sizes.find((s) => s.label === chosen)?.label ?? null;
      if (size === null) return no(400, `Choose a size for the ${product.name}.`, field);
    }

    const amount = product.price * qty;
    subtotal += amount;
    lines.push({ slug, name: product.name, qty, price: product.price, amount, size });
  }

  if (subtotal <= 0) return no(400, MESSAGES.empty, "items");

  /* Whole KSh, both halves computed here. A free-delivery county adds 0, and the
     guard below is what stops a zero-amount push ever reaching Daraja however
     the two halves change later. */
  const total = subtotal + zone.cost;
  if (!Number.isInteger(total) || total <= 0) return no(400, MESSAGES.empty, "items");

  return {
    ok: true,
    name: cleanName,
    email: cleanEmail,
    msisdn,
    lines,
    subtotal,
    delivery: { county: zone.key, label: zone.name, area: cleanArea, landmark: cleanLandmark, fee: zone.cost },
    total,
  };
}
