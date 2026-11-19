/* POST /api/mpesa/stk — sends the M-Pesa prompt to the customer's phone.
 *
 * ONE OF THE TWO ENDPOINTS THAT TOUCH MONEY. Every line gets read before merge.
 *
 * Browser -> here -> Daraja -> the customer's phone rings -> ... later ...
 * -> the callback settles it, or the status query does.
 *
 * WHAT THIS ENDPOINT RETURNS IS NOT A PAYMENT, AND NOTHING HERE MARKS ONE PAID.
 * A 200 from Daraja means the prompt was accepted for delivery. It says nothing
 * about whether anyone entered a PIN. CLAUDE.md: "An STK prompt is not a
 * payment. Only a callback or a successful status query marks an order paid."
 * The record this writes is `pending` and only _pending.js settle() may move it.
 *
 * Validation and re-pricing come from _order.js — the same module IntaSend's
 * checkout.js used to share it with, before it was retired. Kept as its own
 * module rather than folded back in here so a future second gateway can share
 * it again without price and stock rules drifting between the two.
 */

import { DarajaError, stkPush } from "../_daraja.js";
import { MESSAGES, checkStock, readOrder, reference } from "../_order.js";
import { putPending, refKey } from "../_pending.js";
import { discountFor, phoneKey, resolvePromo } from "../_promo.js";
import { REACH, Reach } from "../_site.js";

/* What happened to the money, as opposed to what was wrong with the request.
 *
 * PHONE NUMBER: CLAUDE.md requires one on an error, and every message here
 * carries it — site.json contact.phone, through _site.js. These used to route
 * to /contact because no real number existed; one does now. */
const OUTCOME = {
  unavailable:
    `M-Pesa is not responding right now. Nothing has been charged. ` +
    `${Reach} and the order can be taken another way.`,
  push_failed:
    `The M-Pesa prompt could not be sent to that number. Nothing has been charged. ` +
    `Check the number and try again, or ${REACH}.`,
};

/* ONE BODY FOR EVERY REFUSED CODE. A code that does not exist, one that has
 * ended, one not yet started, one switched off, one used up and one this phone
 * has used all read the same, so a code cannot be probed for. It does not fall
 * back to full price: the buyer expected a discount and must not be charged
 * without one, so nothing is pushed and nothing is recorded. */
const PROMO_REFUSED =
  `That promo code is not valid or has ended. Nothing has been charged. ` +
  `Remove the code to order at the listed price, or ${REACH}.`;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

const fail = (status, message, field) => json(status, field ? { message, field } : { message });

/* The callback has to be a publicly reachable HTTPS URL — Safaricom's servers
 * call it, so it cannot be localhost and cannot be a preview URL that requires
 * auth. The origin is configured rather than taken from the request, because the
 * request's own origin is whatever host it arrived on and a callback pointed at
 * a preview deployment is a payment that settles somewhere nobody is reading. */
function callbackUrl(env) {
  const origin = env.MPESA_CALLBACK_ORIGIN;
  const token = env.MPESA_CALLBACK_TOKEN;
  if (!origin || !token) throw new DarajaError("misconfigured", "MPESA_CALLBACK_ORIGIN/TOKEN absent");
  return `${origin.replace(/\/$/, "")}/api/mpesa/callback/${token}`;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return fail(400, MESSAGES.bad_request);
  }

  const order = readOrder(payload);
  if (!order.ok) return fail(order.status, order.message, order.field);

  /* Is there enough left to sell? Stock is the catalogue's figure less the paid
     sales recorded since it was counted, so this reads KV. A count that cannot be
     taken is not "in stock": it is the same 503 as any other unreadable KV, and
     nothing is pushed. */
  let refusal;
  try {
    refusal = await checkStock(env.ORDERS, order.lines);
  } catch (error) {
    console.log(JSON.stringify({ at: "stk", code: "stock_read_failed", detail: String(error) }));
    return json(503, { message: OUTCOME.unavailable });
  }
  if (refusal) return fail(refusal.status, refusal.message, refusal.field);

  /* ---------- the promo code, if there is one ----------
   *
   * Judged ONCE, here, at the moment the push is requested; settle() never
   * re-checks it. A buyer quoted a discount at 23:58 who pays at 00:01 is
   * honoured.
   *
   * Absent, null and a blank string mean no code. Anything else is a code, and a
   * value that is not a usable string (a number, an object) is an invalid one,
   * never "no code" — otherwise a malformed field would silently charge full
   * price to a buyer who thought they had a discount.
   *
   * Only `promo` is read from the request. A `discount`, `percent` or `amount`
   * beside it is not destructured and not looked at. */
  const typed = payload.promo;
  let promo = null;
  if (typed !== undefined && typed !== null && !(typeof typed === "string" && typed.trim() === "")) {
    try {
      promo = await resolvePromo(env.ORDERS, typed, Date.now(), await phoneKey(order.msisdn));
    } catch (error) {
      /* KV could not be read. That is not "the code is invalid" and must not be
         worded as if it were. The code and the number are not logged. */
      console.log(JSON.stringify({ at: "stk", code: "promo_read_failed", detail: String(error) }));
      return json(503, { message: OUTCOME.unavailable });
    }
    if (!promo.ok) return fail(400, PROMO_REFUSED, "promo");
  }

  /* The figures. Delivery is added AFTER the discount and is never discounted.
     Whole KSh throughout; stkPush() refuses anything that is not an integer. */
  const discount = promo ? discountFor(order.subtotal, promo.record) : 0;
  /* null is a code that would take nothing off this basket: refused with the one
     answer, and nothing has been written, so no use can have been counted. */
  if (discount === null) return fail(400, PROMO_REFUSED, "promo");
  const total = order.subtotal - discount + order.delivery.fee;

  const ref = reference();

  /* ---------- the record goes down before the push goes out ----------
   *
   * The rule is that the pending order is written before the request leaves,
   * never after, so a push that succeeds while our function dies does not leave
   * a payment with nothing to reconcile it against.
   *
   * IT CANNOT BE FULLY OBEYED AS STATED, and pretending otherwise would hide the
   * gap rather than close it. The key the callback arrives on is the
   * CheckoutRequestID, and Daraja only issues that in its response — so the key
   * a callback needs cannot exist before the call that creates it.
   *
   * What is possible, and what this does: write the order first under our own
   * reference, then push, then index it under the CheckoutRequestID. If the
   * isolate dies between the push and the index write, the money may move and
   * the callback will find no record — but the order still exists in KV under
   * its reference, so it is a reconciliation rather than a payment with no
   * trace. The callback logs `unknown` loudly for exactly this reason.
   *
   * Closing the remaining gap needs an idempotency key we choose ourselves,
   * which Daraja's STK API does not offer. Recorded in BUILD-ORDER section 9. */
  const record = {
    reference: ref,
    /* A size only on a line whose product is made in sizes, so a record for a
       pendant does not carry `size: null` that reads as a missing answer. */
    items: order.lines.map((line) =>
      line.size === null ? { slug: line.slug, qty: line.qty } : { slug: line.slug, qty: line.qty, size: line.size }
    ),
    /* The two halves of the amount, as computed by readOrder(): the items at
       catalogue prices, and the delivery fee for the county key. Kept so the
       record says how the figure below was reached, and so /api/track can show
       the breakdown the buyer saw at checkout rather than recomputing it from a
       fee table that may have changed since. */
    subtotal: order.subtotal,
    /* The promo, as THIS handler resolved it and never as the request claimed
       it. Kept for accounting and NEVER returned to a browser: _amounts.js does
       not copy promoPercent, promoAmountOff or discountKsh onto any response. The
       same fields on every order, null and 0 when there was no code, so an old
       order and a new one have one shape. `itemsSubtotal` repeats
       `subtotal` on purpose: it is the figure the discount was taken from, named
       for that. `promoOncePerPhone` is what settle() needs to know about the code
       and is recorded here so it never has to read the promo record again. */
    promoCode: promo ? promo.code : null,
    promoPercent: promo ? (promo.record.percent ?? null) : null,
    promoAmountOff: promo ? (promo.record.amountOff ?? null) : null,
    promoOncePerPhone: promo ? promo.record.oncePerPhone === true : null,
    discountKsh: discount,
    itemsSubtotal: order.subtotal,
    /* Where it is going. `label` is the county as it read when the order was
       placed; `county` is the key it was priced by. The landmark is for the
       rider and is never returned to the browser. */
    delivery: order.delivery,
    /* WHAT WE COMPUTED: subtotal - discount + delivery fee, whole KSh. This is
       the total, the figure the push asks for, and the one the callback's amount
       is checked against. Named `amount` rather than `total` because settle()
       and every record already in KV carry it under that name. */
    amount: total,
    msisdn: order.msisdn,
    name: order.name,
    email: order.email,
    status: "pending",
    createdAt: Date.now(),
  };

  try {
    await putPending(env, refKey(ref), record);
  } catch (error) {
    /* KV unavailable or unbound. Refuse rather than push: a prompt whose result
       has nowhere to land is a charge we could not honour. */
    console.log(JSON.stringify({ at: "stk", reference: ref, code: "kv_write_failed", detail: String(error) }));
    return json(503, { message: OUTCOME.unavailable });
  }

  /* ---------- push ---------- */

  let pushed;
  try {
    pushed = await stkPush({
      env,
      amount: total,
      msisdn: order.msisdn,
      reference: ref,
      description: `MomentAura ${ref}`,
      callbackUrl: callbackUrl(env),
    });
  } catch (error) {
    const code = error instanceof DarajaError ? error.code : "unhandled";
    const detail = error instanceof DarajaError ? error.detail : String(error);
    /* Daraja's own words go to the log and never to the browser — its errors
       quote the request back at you, passkey and phone number included. */
    console.log(JSON.stringify({ at: "stk", reference: ref, code, detail }));

    /* The push never left, so no money moved and this order is closed. Marking
       it says so to whoever reads KV later; leaving it `pending` would put an
       order that never existed on a reconciliation list forever. Best-effort —
       if this write fails too, the log above is still the record. */
    try {
      await putPending(env, refKey(ref), { ...record, status: "failed", failure: code, settledAt: Date.now() });
    } catch {
      /* Intentionally empty. See above. */
    }

    /* "rejected" is Daraja refusing the push — a number it will not prompt, a
       malformed request. It is not the buyer declining anything, and it must not
       be worded as though their payment failed. Everything else is our side. */
    const refused = code === "rejected" || code === "bad_amount";
    return json(refused ? 422 : 503, {
      message: refused ? OUTCOME.push_failed : OUTCOME.unavailable,
    });
  }

  /* Index under the key the callback and the status query arrive on. */
  try {
    await putPending(env, pushed.checkoutRequestId, {
      ...record,
      checkoutRequestId: pushed.checkoutRequestId,
      merchantRequestId: pushed.merchantRequestId,
      pushedAt: Date.now(),
    });
  } catch (error) {
    /* The prompt is already on its way and cannot be recalled. Say so honestly:
       the buyer may still be charged, so this must not read as "nothing
       happened". The reference is on screen and the ref: record exists. */
    console.log(
      JSON.stringify({
        at: "stk",
        reference: ref,
        checkoutRequestId: pushed.checkoutRequestId,
        code: "kv_index_failed",
        detail: String(error),
      })
    );
    return json(503, {
      message:
        `The prompt may have been sent, but this order could not be recorded. ` +
        `Do not enter your PIN. ${Reach} with reference ${ref}.`,
      reference: ref,
    });
  }

  /* Our reference, the id the status query needs, and the total we computed.
     No Daraja payload, no internal codes. */
  return json(200, {
    reference: ref,
    checkoutRequestId: pushed.checkoutRequestId,
    total,
  });
}
