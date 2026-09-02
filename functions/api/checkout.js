/* POST /api/checkout — the only endpoint that touches money.
 *
 * THE HIGHEST-RISK FILE IN THE REPO. Every line gets read before merge.
 *
 * Browser -> here -> the gateway's hosted page -> back to /order-received.
 * No card field exists on our domain at any point in that sequence, which is
 * what keeps PCI scope at the lightest tier. Nothing in this file may ever
 * accept a card number, and no future change to it may add one.
 *
 * What arrives from the browser is a list of slugs and quantities, a name and a
 * phone number. That is the whole trusted surface, and none of it is trusted:
 *
 *   - PRICE IS NEVER READ FROM THE REQUEST. It is not in the accepted shape at
 *     all, so there is no field to trust or forget to ignore. A client that can
 *     set its own price sets it to zero. Every figure is looked up by slug in
 *     our own catalogue and the total is computed here
 *   - a slug not in the catalogue is rejected, not skipped
 *   - a product with stock 0 is rejected by name, not silently dropped
 *   - a quantity above stock is rejected by name. The cart caps at 99 and
 *     nothing there consults stock, so this is the only place an order for
 *     twenty of a six-stock item is stopped. Promising what cannot be sent is
 *     the failure this whole shop is built against
 *
 * Secrets are read from `env` inside this request and nowhere else. Nothing in
 * this directory is imported by the Astro build, so no key can reach the browser
 * bundle. If it ever could, the design would be wrong.
 *
 * The gateway's own response never reaches the browser. It is logged and
 * replaced with one of the messages below. Gateway errors quote request
 * payloads back at you, and that is how a key or a customer's phone number ends
 * up in a response someone can read.
 *
 * Everything gateway-shaped lives in _gateway.js. Step 9 replaces that file with
 * Daraja and does not touch this one.
 */

import catalogue from "../../src/data/products.json";
import { GATEWAY_NAME, GatewayError, createHostedCheckout } from "./_gateway.js";

/* Same ceiling the cart applies on read. A request is not the cart, so it is
   restated here rather than assumed. */
const MAX_QTY = 99;

/* A basket, not a wholesale order. Ten distinct lines is far past what this
   catalogue can produce; past that it is someone probing, and the bulk route is
   a conversation with a person. */
const MAX_LINES = 10;

/* Kenyan mobile numbers, the shapes people actually type: 07XXXXXXXX,
   01XXXXXXXX, +2547XXXXXXXX, 2541XXXXXXXX. Whitespace is stripped first because
   people type it and rejecting a valid number over a space is a checkout that
   loses an order for nothing. */
const PHONE = /^(?:\+?254|0)[17]\d{8}$/;

/* Deliberately loose. An address this rejects is a customer lost, and the only
   thing riding on it is a receipt the buyer asked for. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BY_SLUG = new Map(catalogue.map((p) => [p.slug, p]));

/* Every message the browser can ever see. What happened, and what to do.
 *
 * PHONE NUMBER: CLAUDE.md requires one on an error. There is no real number
 * anywhere in this repo and inventing one is the dishonesty the whole site
 * exists to remove — a number that does not ring is worse than no number. These
 * route to /contact, which BUILD-ORDER section 10 owns, and the number lands in
 * all of them at once when that page does. Recorded there as a dependency so it
 * is not rediscovered. */
const MESSAGES = {
  bad_request: "That order could not be read. Go back to your order and try again.",
  empty: "There is nothing in your order yet.",
  name: "Enter the name the order is for.",
  phone: "Enter a Kenyan phone number, like 0712 345 678. M-Pesa sends the prompt to it.",
  email: "That email address does not look right. Leave it blank if you would rather not give one.",
  unavailable:
    `Payments are not going through right now. Nothing has been charged. ` +
    `Message us on the contact page and the order can be taken another way.`,
  declined:
    `The payment did not go through. Nothing has been charged. ` +
    `Try again, or message us on the contact page and the order can be taken another way.`,
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      /* An order response is per-buyer and must never be held by a cache in
         front of this function or in the browser. */
      "Cache-Control": "no-store",
      /* Nothing here is meant to be framed or sniffed. */
      "X-Content-Type-Options": "nosniff",
    },
  });

const fail = (status, message, field) => json(status, field ? { message, field } : { message });

/* Order reference. Unambiguous read-aloud alphabet: no O/0, no I/1, no S/5,
   because this number gets read down a phone line and screenshotted into
   WhatsApp. crypto.getRandomValues, not Math.random — a guessable reference is
   a lookup key for someone else's order the moment /track exists in step 10. */
const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";

function reference() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `MA-${out.slice(0, 4)}-${out.slice(4)}`;
}

/* A single onRequest, not onRequestPost alongside it. Cloudflare Pages treats
   onRequest as the catch-all for every method, so exporting both leaves which
   one runs a POST up to the platform's resolution order. On the endpoint that
   moves money, the routing must not be something to look up. One entry point,
   and the method check is the first thing in it. */
export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    /* A GET on a payment endpoint is a probe or a pasted URL. Both get a flat
       answer and no hint of the shape it expects. */
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  /* ---------- read the request ---------- */

  let payload;
  try {
    payload = await request.json();
  } catch {
    return fail(400, MESSAGES.bad_request);
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return fail(400, MESSAGES.bad_request);
  }

  const { items, name, phone, email } = payload;

  if (!Array.isArray(items) || items.length === 0) return fail(400, MESSAGES.empty, "items");
  if (items.length > MAX_LINES) return fail(400, MESSAGES.bad_request, "items");

  /* ---------- the customer ---------- */

  const cleanName = typeof name === "string" ? name.trim() : "";
  if (cleanName.length < 2 || cleanName.length > 80) return fail(400, MESSAGES.name, "name");

  const cleanPhone = typeof phone === "string" ? phone.replace(/[\s-]/g, "") : "";
  if (!PHONE.test(cleanPhone)) return fail(400, MESSAGES.phone, "phone");

  /* Optional, and blank is a valid answer rather than an error. */
  let cleanEmail = null;
  if (typeof email === "string" && email.trim() !== "") {
    cleanEmail = email.trim();
    if (cleanEmail.length > 254 || !EMAIL.test(cleanEmail)) {
      return fail(400, MESSAGES.email, "email");
    }
  }

  /* Normalised to 2547XXXXXXXX / 2541XXXXXXXX. One shape reaches the gateway
     however the buyer typed it. */
  const msisdn = cleanPhone.replace(/^\+/, "").replace(/^0/, "254");

  /* ---------- re-price from our own catalogue ----------
   *
   * The request carries slugs and quantities. It does not carry prices, and if
   * it did they would be ignored: every figure below is read from the catalogue
   * this function imported at build time. */

  const lines = [];
  const seen = new Set();
  let total = 0;

  for (const item of items) {
    if (item === null || typeof item !== "object") return fail(400, MESSAGES.bad_request, "items");

    const slug = item.slug;
    if (typeof slug !== "string") return fail(400, MESSAGES.bad_request, "items");

    /* One line per product. Two lines for the same slug would otherwise let a
       quantity cap be stepped around by repeating the slug. */
    if (seen.has(slug)) return fail(400, MESSAGES.bad_request, "items");
    seen.add(slug);

    const product = BY_SLUG.get(slug);
    /* Not in the catalogue: rejected, never skipped. Silently dropping a line
       sends the buyer to a payment page for less than they asked for. */
    if (!product) {
      return fail(422, "One of the items in your order is no longer available. Go back to your order and remove it.", "items");
    }

    const qty = item.qty;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return fail(400, MESSAGES.bad_request, "items");
    }

    /* Named, and blocking. Never silently dropped. */
    if (product.stock === 0) {
      return fail(409, `${product.name} is sold out, so this order cannot be sent. Go back to your order and remove it.`, "items");
    }

    if (qty > product.stock) {
      return fail(409, `There are only ${product.stock} of the ${product.name} left. Lower the quantity in your order and try again.`, "items");
    }

    const amount = product.price * qty;
    total += amount;
    lines.push({ slug, name: product.name, qty, price: product.price, amount });
  }

  if (total <= 0) return fail(400, MESSAGES.empty, "items");

  /* ---------- hand off to the gateway ---------- */

  const ref = reference();
  const redirectUrl = new URL("/order-received/", request.url);
  redirectUrl.searchParams.set("ref", ref);

  try {
    const { url } = await createHostedCheckout({
      env,
      reference: ref,
      amount: total,
      customer: { name: cleanName, phone: msisdn, email: cleanEmail },
      redirectUrl: redirectUrl.toString(),
    });

    /* A hosted checkout URL, our reference, and the total we computed. Nothing
       else — no gateway payload, no echo of what was sent, no internal ids.
       The total goes back so the confirmation screen shows a figure this
       function calculated rather than one the browser added up for itself. */
    return json(200, { url, reference: ref, total, gateway: GATEWAY_NAME });
  } catch (error) {
    /* The detail goes to the log. The buyer gets one of two sentences.
     *
     * Misconfiguration and unreachability are OUR failure and read as
     * "unavailable", which offers the other route. Only an actual rejection by
     * the gateway reads as "declined" — telling a buyer their payment was
     * declined when our own key was missing is a false statement about them. */
    if (error instanceof GatewayError) {
      console.log(
        JSON.stringify({
          at: "checkout",
          reference: ref,
          code: error.code,
          detail: error.detail,
        })
      );
      const declined = error.code === "gateway_rejected";
      return json(declined ? 402 : 503, {
        message: declined ? MESSAGES.declined : MESSAGES.unavailable,
      });
    }

    console.log(JSON.stringify({ at: "checkout", reference: ref, code: "unhandled", detail: String(error) }));
    return json(503, { message: MESSAGES.unavailable });
  }
}
