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
 * Validation and re-pricing come from _order.js, shared with /api/checkout, so
 * the price and stock rules cannot drift between the two gateways. Price is not
 * in the accepted request shape at all.
 */

import { DarajaError, stkPush } from "../_daraja.js";
import { MESSAGES, readOrder, reference } from "../_order.js";
import { putPending, refKey } from "../_pending.js";

/* What happened to the money, as opposed to what was wrong with the request.
 *
 * PHONE NUMBER: CLAUDE.md requires one on an error. There is no real number in
 * this repo and inventing one is the dishonesty the whole site exists to remove.
 * These route to /contact, which BUILD-ORDER section 10 owns. */
const OUTCOME = {
  unavailable:
    `M-Pesa is not responding right now. Nothing has been charged. ` +
    `Message us on the contact page and the order can be taken another way.`,
  push_failed:
    `The M-Pesa prompt could not be sent to that number. Nothing has been charged. ` +
    `Check the number and try again, or message us on the contact page.`,
};

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
    items: order.lines.map((line) => ({ slug: line.slug, qty: line.qty })),
    /* WHAT WE COMPUTED. The callback's figure is checked against this one. */
    amount: order.total,
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
      amount: order.total,
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
        `Do not enter your PIN. Message us on the contact page with reference ${ref}.`,
      reference: ref,
    });
  }

  /* Our reference, the id the status query needs, and the total we computed.
     No Daraja payload, no internal codes. */
  return json(200, {
    reference: ref,
    checkoutRequestId: pushed.checkoutRequestId,
    total: order.total,
  });
}
