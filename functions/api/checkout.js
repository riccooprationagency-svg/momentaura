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
 * Everything gateway-shaped lives in _gateway.js. The request validation and the
 * re-pricing live in _order.js, shared with step 9's STK endpoint so the stock
 * and price rules exist once rather than once per gateway.
 *
 * STEP 9 DID NOT REPLACE THIS FILE, and the note that used to sit here saying it
 * would was wrong about the shape of the problem. A hosted-page gateway hands
 * back a URL and the buyer is redirected; Daraja STK Push hands back nothing to
 * redirect to and settles asynchronously against a callback. That is a different
 * flow, not a different implementation of this one, so it lives beside this file
 * rather than inside it. See BUILD-ORDER section 9.
 */

import { GATEWAY_NAME, GatewayError, createHostedCheckout } from "./_gateway.js";
import { MESSAGES, readOrder, reference } from "./_order.js";

/* What happened to the money, as opposed to what was wrong with the request.
 * The request messages are in _order.js because both endpoints share them;
 * these two are this gateway's outcomes and stay here.
 *
 * PHONE NUMBER: CLAUDE.md requires one on an error. There is no real number
 * anywhere in this repo and inventing one is the dishonesty the whole site
 * exists to remove — a number that does not ring is worse than no number. These
 * route to /contact, which BUILD-ORDER section 10 owns, and the number lands in
 * all of them at once when that page does. Recorded there as a dependency so it
 * is not rediscovered. */
const OUTCOME = {
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

  /* Validation, stock rules and re-pricing, shared with the STK endpoint so
     they cannot drift apart. Nothing past this point reads the payload again. */
  const order = readOrder(payload);
  if (!order.ok) return fail(order.status, order.message, order.field);

  const { total } = order;

  /* ---------- hand off to the gateway ---------- */

  const ref = reference();
  const redirectUrl = new URL("/order-received/", request.url);
  redirectUrl.searchParams.set("ref", ref);

  try {
    const { url } = await createHostedCheckout({
      env,
      reference: ref,
      amount: total,
      customer: { name: order.name, phone: order.msisdn, email: order.email },
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
        message: declined ? OUTCOME.declined : OUTCOME.unavailable,
      });
    }

    console.log(JSON.stringify({ at: "checkout", reference: ref, code: "unhandled", detail: String(error) }));
    return json(503, { message: OUTCOME.unavailable });
  }
}
