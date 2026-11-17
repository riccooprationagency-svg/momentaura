/* POST /api/promo/check — what a code would take off THIS basket, before anyone pays.
 *
 * ADVISORY, AND IT IS NOT THE PRICE. /api/mpesa/stk judges the code again, at the
 * moment the push is requested, and recomputes every figure; nothing here is
 * remembered or trusted by it. This exists so the checkout page can show the
 * discount before the buyer is asked for money, and for nothing else.
 *
 * WHAT IT NEVER DOES
 *
 *   - write to KV, in any form. It reads the code's record and counts its use
 *     markers through resolvePromo(), and that is all. No throttle either:
 *     _throttle.js writes a counter, and "never writes" wins over "rate limited".
 *     That makes this a cheaper way to probe for a code than the push, which needs
 *     a whole order to try one. The limit belongs at the edge (a Cloudflare rate
 *     limiting rule on /api/promo/*), not in this file.
 *   - count a use. A use is a marker written by settle() when an order is paid.
 *   - read a price, a percentage or a total from the request. The body is
 *     { promo, lines: [{ slug, qty }] } and a `price`, `discount` or `percent`
 *     beside them is not destructured and not looked at.
 *
 * ONE ANSWER FOR EVERY REFUSED CODE, same rule and same reason as the push: a
 * code that does not exist, has ended, has not started, is switched off or is used
 * up all answer identically, so the field cannot be used to tell them apart.
 *
 * A STATED LIMIT: ONCE-PER-PHONE CANNOT BE JUDGED HERE. The body carries no phone
 * number, deliberately — adding one would turn this endpoint into a way of asking
 * whether a given number has used a given code. So a code limited to one use per
 * phone previews as valid for a number that has already used it, and the push then
 * refuses it. That is the push's answer being final, as intended, and the page
 * says so by showing its error.
 *
 * A KV FAILURE IS NOT A REFUSED CODE. A read or a list that throws answers 503
 * with its own message, never the refusal: telling a buyer with a good code that
 * it is not valid, because KV wobbled, is a false statement about their code.
 *
 * The basket is re-priced from the catalogue the way _order.js does it, with the
 * same two limits imported from there so they cannot drift. It is a second copy
 * of one short loop because readOrder() cannot be asked for a price alone: it
 * wants the customer, a county and a size for every sized line first. Stock is
 * not judged — a sold-out line is the push's refusal to make, not a preview's.
 */

import catalogue from "../../../src/data/products.json";
import { MAX_LINES, MAX_QTY } from "../_order.js";
import { discountFor, resolvePromo } from "../_promo.js";
import { REACH, Reach } from "../_site.js";

const BY_SLUG = new Map(catalogue.map((p) => [p.slug, p]));

/* The same sentence as the push's refusal minus "Nothing has been charged", which
   is true here but is not what this answers. One body for every refused code. */
const REFUSED = `That promo code is not valid or has ended. Remove it to order at the listed price, or ${REACH}.`;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

/* The items subtotal in whole KSh, or null for a basket that is not one. */
function itemsSubtotal(lines) {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES) return null;
  const seen = new Set();
  let subtotal = 0;
  for (const line of lines) {
    if (line === null || typeof line !== "object") return null;
    const { slug, qty } = line;
    const product = typeof slug === "string" ? BY_SLUG.get(slug) : undefined;
    if (!product || seen.has(slug) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return null;
    seen.add(slug);
    subtotal += product.price * qty;
  }
  return subtotal;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  const subtotal = payload === null || typeof payload !== "object" ? null : itemsSubtotal(payload.lines);
  if (subtotal === null) {
    return json(400, { ok: false, message: `That request could not be read. Try again, or ${REACH}.` });
  }

  let promo;
  try {
    /* The last argument is the buyer's phone hash, which this endpoint does not
       have. The empty string matches no promo-phone key, so the once-per-phone
       test passes — see the stated limit above. */
    promo = await resolvePromo(env.ORDERS, payload.promo, Date.now(), "");
  } catch (error) {
    console.log(JSON.stringify({ at: "promo-check", code: "promo_read_failed", detail: String(error) }));
    return json(503, {
      ok: false,
      message: `The code cannot be checked right now. You can still pay, and it is checked again then. ${Reach}.`,
    });
  }
  if (!promo.ok) return json(200, { ok: false, message: REFUSED });

  return json(200, {
    ok: true,
    percent: promo.percent,
    itemsSubtotal: subtotal,
    discountKsh: discountFor(subtotal, promo.percent),
  });
}
