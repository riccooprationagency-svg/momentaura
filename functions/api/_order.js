/* Reading an order request, and re-pricing it from our own catalogue.
 *
 * THIS IS THE MONEY-PATH VALIDATION, AND IT EXISTS ONCE ON PURPOSE. Step 8's
 * /api/checkout and step 9's /api/mpesa/stk both take the same request shape and
 * both have to apply the same rules to it. Two copies of "never trust a client
 * price" is how one of them gets a stock rule fixed and the other does not, and
 * the one that does not is still an endpoint that moves money. So the rules live
 * here and the endpoints differ only in what they hand the order to.
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

/* What is wrong with the request. Every message says what happened and what to
 * do about it, and none of them says "something went wrong".
 *
 * What HAPPENED TO THE MONEY is not here — that is different per gateway and
 * each endpoint owns its own wording for it.
 *
 * PHONE NUMBER: CLAUDE.md requires one on an error. There is no real number
 * anywhere in this repo and inventing one is the dishonesty the whole site
 * exists to remove — a number that does not ring is worse than no number. These
 * route to /contact, which BUILD-ORDER section 10 owns, and the number lands in
 * all of them at once when that page does. */
export const MESSAGES = {
  bad_request: "That order could not be read. Go back to your order and try again.",
  empty: "There is nothing in your order yet.",
  name: "Enter the name the order is for.",
  phone: "Enter a Kenyan phone number, like 0712 345 678. M-Pesa sends the prompt to it.",
  email: "That email address does not look right. Leave it blank if you would rather not give one.",
  gone: "One of the items in your order is no longer available. Go back to your order and remove it.",
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

const no = (status, message, field) => ({ ok: false, status, message, field });

/**
 * Reads and re-prices an order request.
 *
 * @param {unknown} payload  whatever came off the wire, already JSON-parsed
 * @returns {{ok: true, name: string, email: string|null, msisdn: string,
 *            lines: {slug: string, name: string, qty: number, price: number, amount: number}[],
 *            total: number}
 *          | {ok: false, status: number, message: string, field?: string}}
 */
export function readOrder(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return no(400, MESSAGES.bad_request);
  }

  const { items, name, phone, email } = payload;

  if (!Array.isArray(items) || items.length === 0) return no(400, MESSAGES.empty, "items");
  if (items.length > MAX_LINES) return no(400, MESSAGES.bad_request, "items");

  /* ---------- the customer ---------- */

  const cleanName = typeof name === "string" ? name.trim() : "";
  if (cleanName.length < 2 || cleanName.length > 80) return no(400, MESSAGES.name, "name");

  const cleanPhone = typeof phone === "string" ? phone.replace(/[\s-]/g, "") : "";
  if (!PHONE.test(cleanPhone)) return no(400, MESSAGES.phone, "phone");

  /* Optional, and blank is a valid answer rather than an error. */
  let cleanEmail = null;
  if (typeof email === "string" && email.trim() !== "") {
    cleanEmail = email.trim();
    if (cleanEmail.length > 254 || !EMAIL.test(cleanEmail)) {
      return no(400, MESSAGES.email, "email");
    }
  }

  /* Normalised to 2547XXXXXXXX / 2541XXXXXXXX. One shape reaches the gateway
     however the buyer typed it. */
  const msisdn = cleanPhone.replace(/^\+/, "").replace(/^0/, "254");

  /* ---------- re-price from our own catalogue ---------- */

  const lines = [];
  const seen = new Set();
  let total = 0;

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
      return no(409, `${product.name} is sold out, so this order cannot be sent. Go back to your order and remove it.`, "items");
    }

    if (qty > product.stock) {
      return no(409, `There are only ${product.stock} of the ${product.name} left. Lower the quantity in your order and try again.`, "items");
    }

    const amount = product.price * qty;
    total += amount;
    lines.push({ slug, name: product.name, qty, price: product.price, amount });
  }

  if (total <= 0) return no(400, MESSAGES.empty, "items");

  return { ok: true, name: cleanName, email: cleanEmail, msisdn, lines, total };
}
