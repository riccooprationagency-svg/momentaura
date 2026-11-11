/* POST /api/mpesa/status — what became of a prompt we sent.
 *
 * THE FALLBACK FOR A CALLBACK THAT NEVER ARRIVES, and it is not an optional
 * refinement. Callbacks go missing: a network drop, a cold start, an allowlist
 * that went stale, an outage at either end. Without this, a customer who paid
 * has an order that sits `pending` forever and eventually reads as failed —
 * real money taken against an order nobody fills. That is the worst outcome
 * this whole system can produce, and it is caused by absence rather than by
 * anything going visibly wrong.
 *
 * The browser polls this while it waits. Two things it deliberately does not do:
 *
 *   - it never asks Daraja before CALLBACK_GRACE_MS has passed. The customer is
 *     still looking at the prompt; querying then just returns "processing" and
 *     spends rate limit on an answer we already know
 *   - it never settles an order itself. It reads the same settle() the callback
 *     uses, so idempotency and the amount check exist once and cannot diverge
 *
 * WHAT IT RETURNS TO THE BROWSER IS THE STATUS, OUR REFERENCE AND THE AMOUNTS
 * AS RECORDED — subtotal, delivery fee and total, formatted by _amounts.js —
 * and nothing else. No phone number, no county, area or landmark, no Daraja
 * payload, no receipt, no amount a callback claimed.
 *
 * The amounts were added so /order-received shows the fee the order was
 * actually charged rather than looking it up in today's fee table, which would
 * put a changed fee on an old order. They are sent only once both the
 * CheckoutRequestID and our reference match, and they are the figures the
 * buyer already saw on the M-Pesa prompt.
 */

import { DarajaError, queryStatus } from "../_daraja.js";
import { CALLBACK_GRACE_MS, getPending, settle } from "../_pending.js";
import { amounts } from "../_amounts.js";
import { REACH } from "../_site.js";

/* The browser does not show these — /order-received polls this endpoint and
   reveals its own prose — but anything reading the response directly gets a
   message that says what to do and who to call, like every other error here. */
const UNREADABLE = `That request could not be read. Try again, or ${REACH}.`;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, { message: UNREADABLE });
  }

  const checkoutRequestId = payload && payload.checkoutRequestId;
  const claimed = payload && payload.reference;

  if (typeof checkoutRequestId !== "string" || !checkoutRequestId) {
    return json(400, { message: UNREADABLE });
  }

  let record;
  try {
    record = await getPending(env, checkoutRequestId);
  } catch (error) {
    console.log(JSON.stringify({ at: "status", code: "kv_read_failed", detail: String(error) }));
    return json(503, { message: `That order cannot be checked right now. Try again shortly, or ${REACH}.` });
  }

  /* BOTH HALVES MUST MATCH. The CheckoutRequestID alone is a bearer key to
     someone's order status, and this endpoint is public. Requiring our own
     reference alongside it means guessing an id gets you nothing, because the
     reference is minted separately and never appears in Daraja's traffic.
     The same answer for "no such order" and "wrong reference", so neither
     confirms the other.

     AND THE RECORD MUST BE THE ONE STORED UNDER THAT ID. The id is a KV key
     taken from the request, and the same namespace holds the buyer's copy
     under ref:<reference>. Sent "ref:MA-…" with its reference, the lookup
     found that copy and the reference check passed — so the reference alone,
     which is screenshotted and read aloud, returned the order's status and
     amounts, and could steer a Daraja query and settle() at a key that is not
     a CheckoutRequestID. Only the canonical record carries its own id equal
     to the key it lives under; the ref: copy never does. A positive match
     rather than a refused prefix, so a key shape added later is refused too. */
  if (
    !record ||
    record.checkoutRequestId !== checkoutRequestId ||
    typeof claimed !== "string" ||
    claimed !== record.reference
  ) {
    return json(404, { message: `No order was found for that reference. If you have paid, ${REACH} with the reference.` });
  }

  /* Every answer from here on: the status, our reference, and what the order
     cost as it was recorded. Through one helper, so no branch below can answer
     without the amounts or with anything more. */
  const answer = (status) =>
    json(200, { status, reference: record.reference, breakdown: amounts(record) });

  /* Already terminal. No query, no write. */
  if (record.status !== "pending") {
    return answer(record.status);
  }

  /* Still inside the window where a callback is expected. The customer is
     probably still holding the phone. */
  const age = Date.now() - (record.pushedAt ?? record.createdAt ?? 0);
  if (age < CALLBACK_GRACE_MS) {
    return answer("pending");
  }

  /* ---------- past the grace period: ask Daraja ---------- */

  let result;
  try {
    result = await queryStatus({ env, checkoutRequestId });
  } catch (error) {
    const code = error instanceof DarajaError ? error.code : "unhandled";
    const detail = error instanceof DarajaError ? error.detail : String(error);
    console.log(JSON.stringify({ at: "status", checkoutRequestId, code, detail }));
    /* Unknown is not failed. Saying an order failed because we could not reach
       Daraja is the same false statement as calling a misconfiguration a
       declined payment — the buyer may well have paid. It stays pending and the
       browser tries again. */
    return answer("pending");
  }

  if (result.state === "pending") {
    return answer("pending");
  }

  /* Settle through the shared path, which re-checks the amount and is idempotent
     against a callback that arrives while this is in flight.
     Daraja's query response carries no amount, so a `paid` result is settled
     against the stored figure by passing it back — the check still runs, and it
     is the callback's claimed amount that it exists to catch. */
  let outcome;
  try {
    outcome = await settle(env, checkoutRequestId, {
      state: result.state,
      amount: result.state === "paid" ? record.amount : undefined,
      desc: result.desc,
      code: result.code,
      via: "query",
    });
  } catch (error) {
    console.log(JSON.stringify({ at: "status", checkoutRequestId, code: "settle_failed", detail: String(error) }));
    return answer("pending");
  }

  console.log(
    JSON.stringify({
      at: "status",
      checkoutRequestId,
      reference: record.reference,
      state: result.state,
      outcome: outcome.outcome,
    })
  );

  const settled = outcome.record ? outcome.record.status : result.state;
  return answer(settled);
}
