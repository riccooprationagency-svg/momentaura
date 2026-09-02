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
 * WHAT IT RETURNS TO THE BROWSER IS THE STATUS AND OUR REFERENCE, and nothing
 * else. No amount, no phone number, no Daraja payload, no receipt.
 */

import { DarajaError, queryStatus } from "../_daraja.js";
import { CALLBACK_GRACE_MS, getPending, settle } from "../_pending.js";

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
    return json(400, { message: "That request could not be read." });
  }

  const checkoutRequestId = payload && payload.checkoutRequestId;
  const claimed = payload && payload.reference;

  if (typeof checkoutRequestId !== "string" || !checkoutRequestId) {
    return json(400, { message: "That request could not be read." });
  }

  let record;
  try {
    record = await getPending(env, checkoutRequestId);
  } catch (error) {
    console.log(JSON.stringify({ at: "status", code: "kv_read_failed", detail: String(error) }));
    return json(503, { message: "That order cannot be checked right now." });
  }

  /* BOTH HALVES MUST MATCH. The CheckoutRequestID alone is a bearer key to
     someone's order status, and this endpoint is public. Requiring our own
     reference alongside it means guessing an id gets you nothing, because the
     reference is minted separately and never appears in Daraja's traffic.
     The same answer for "no such order" and "wrong reference", so neither
     confirms the other. */
  if (!record || typeof claimed !== "string" || claimed !== record.reference) {
    return json(404, { message: "No order was found for that reference." });
  }

  /* Already terminal. No query, no write. */
  if (record.status !== "pending") {
    return json(200, { status: record.status, reference: record.reference });
  }

  /* Still inside the window where a callback is expected. The customer is
     probably still holding the phone. */
  const age = Date.now() - (record.pushedAt ?? record.createdAt ?? 0);
  if (age < CALLBACK_GRACE_MS) {
    return json(200, { status: "pending", reference: record.reference });
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
    return json(200, { status: "pending", reference: record.reference });
  }

  if (result.state === "pending") {
    return json(200, { status: "pending", reference: record.reference });
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
    return json(200, { status: "pending", reference: record.reference });
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
  return json(200, { status: settled, reference: record.reference });
}
