/* The pending order, held in Cloudflare KV between the push and the result.
 *
 * This is the step where the site stops being purely static. STK Push is
 * asynchronous: the request goes out, the phone prompts, and the answer arrives
 * later at a callback URL — in a different request, possibly a different
 * isolate, possibly minutes later, possibly never. Something has to hold the
 * order across that gap, and it has to hold the AMOUNT, because the amount in
 * the callback body is not trustworthy.
 *
 * Keyed on CheckoutRequestID, which is what both the callback and the status
 * query carry back.
 *
 * IT IS ALSO KEYED ON `ref:<reference>`, because /api/track has neither of
 * those — a buyer holds the reference and the phone, and nothing else. The two
 * keys are the same record under two names, so settling writes both. Writing
 * only the CheckoutRequestID copy leaves the reference copy saying `pending`
 * for the whole seven days, on the one screen a buyer opens to find out whether
 * their money arrived.
 *
 * WHAT IS STORED, AND WHY EACH FIELD IS HERE:
 *
 *   reference   ours, shown to the buyer, and the only field the browser sees
 *   items       slugs and quantities, so the order can be filled once paid
 *   amount      WHAT WE COMPUTED, server-side, from our own catalogue. The
 *               callback's amount is checked against this and never replaces it
 *   msisdn      who to reach about it
 *   status      pending | paid | failed | mismatch
 *
 * SETTLING LIVES HERE AND NOWHERE ELSE. The callback and the status query are
 * two roads to the same decision, and a second copy of "is it already settled,
 * and does the amount match" is how one of them grows a check the other lacks.
 */

import { phoneKey, promoPhoneKey, promoUseKey } from "./_promo.js";
import { soldKey } from "./_stock.js";

/** How long a pending order stays readable. */
const TTL_SECONDS = 60 * 60 * 24 * 7;

/** Nothing settles an order before this; below it, a missing callback is normal. */
export const CALLBACK_GRACE_MS = 90_000;

const binding = (env) => {
  const kv = env.ORDERS;
  if (!kv) throw new Error("KV binding ORDERS is not configured");
  return kv;
};

export async function putPending(env, checkoutRequestId, record) {
  await binding(env).put(checkoutRequestId, JSON.stringify(record), {
    expirationTtl: TTL_SECONDS,
  });
}

export async function getPending(env, checkoutRequestId) {
  return await binding(env).get(checkoutRequestId, "json");
}

/* The buyer's key for an order. ONE SPELLING, IN ONE PLACE.
 *
 * The prefix was written out literally in four places across three files — here,
 * both writes in stk.js, and the read in track.js — which is two sides of one
 * key with nothing holding them together. That is the exact shape of the bug
 * this file's ordering now exists to prevent: a record written under a name the
 * reader does not look under is indistinguishable from an order that never
 * settled, and the buyer is the one who reads the difference. A helper cannot be
 * misspelled on one side only. */
export const refKey = (reference) => `ref:${reference}`;

/**
 * Writes a settled record under both names it is known by.
 *
 * THE REFERENCE COPY GOES FIRST, and the order is load-bearing. If it fails,
 * this throws before the CheckoutRequestID copy leaves `pending`, so the next
 * callback retry settles again and both copies converge. Written the other way
 * round, a failed reference write would be permanent: the retry would find a
 * terminal status, return `already`, and never come back to it.
 *
 * Which is why `already` above repairs nothing: it cannot be reached with a
 * stale copy, so code to repair one there would be dead weight implying a state
 * that cannot happen. That is a real guarantee resting on two lines of ordering,
 * so it is asserted rather than described — mpesa-test.mjs drives both settling
 * roads with the reference write failing and the rest of KV healthy, and fails
 * if the canonical record is ever terminal over a pending copy.
 */
async function persist(env, checkoutRequestId, record) {
  if (typeof record.reference === "string" && record.reference) {
    await putPending(env, refKey(record.reference), record);
  }
  await putPending(env, checkoutRequestId, record);
}

/**
 * Records that a promo code was used by this order. Called on ONE branch only:
 * the one about to write `paid`, after the amount has matched. Never on a
 * mismatch, never on a failure, never on a replay of a terminal order.
 *
 * THE USE IS A KEY, NOT A COUNT. promo-use:<CODE>:<reference>, value the
 * reference. There is no counter to read, add one to and write back, which on a
 * store with no compare-and-swap loses an increment whenever two orders settle
 * together. Two different orders write two different keys and cannot lose each
 * other; the same order written twice writes the same key twice and is still one
 * use. The cap is the number of these keys, counted when a push is requested.
 *
 * WRITTEN BEFORE THE PAID WRITE, so every failure is a retry that converges:
 *   - this write fails: it throws, the order is still `pending`, the callback
 *     answers 500, Safaricom retries, and the retry writes it again
 *   - the paid write fails after this one landed: the order is still `pending`,
 *     the retry writes the same key and then the paid record. One marker
 * What it costs: an order whose paid write then never succeeds holds a use of a
 * code it did not complete. That is the safe direction for a cap.
 *
 * `promoOncePerPhone` was recorded on the order when the push was requested, so
 * no promo record is read, and none can be misparsed, on this path.
 *
 * No expirationTtl: putPending() would give these seven days, and a use must last
 * as long as the code. The reference is the only handle; nothing here is logged.
 */
async function markPromoUse(env, record) {
  if (typeof record.promoCode !== "string" || !record.promoCode) return;
  if (typeof record.reference !== "string" || !record.reference) return;

  const kv = binding(env);
  await kv.put(promoUseKey(record.promoCode, record.reference), record.reference);
  if (record.promoOncePerPhone === true) {
    await kv.put(promoPhoneKey(record.promoCode, await phoneKey(record.msisdn)), record.reference);
  }
}

/**
 * Records that this order's items were sold: one marker per line, sold:<slug>:<reference>
 * (_stock.js). Called on the same ONE branch as markPromoUse(): about to write
 * `paid`, the amount having matched. Never on a mismatch, never on a failure or a
 * cancellation, never on a replay of a terminal order.
 *
 * THE SAME ORDERING ARGUMENT AS THE PROMO MARKER, and it is why a paid order can
 * never be uncounted. This runs BEFORE the paid write:
 *   - a marker write fails: it throws, the order is still `pending`, the callback
 *     answers 500, Safaricom retries, and the retry writes the same keys
 *   - the paid write fails after these landed: still `pending`, the retry writes
 *     the same keys again and then the paid record. One marker per line
 * What it costs: an order whose paid write then never succeeds holds units it did
 * not complete. That is the safe direction for stock: it sells less, never more.
 *
 * IDEMPOTENT BY KEY. Rewriting a key rewrites its time, which moves it later and
 * never earlier, so a retry cannot move a sale to before the count.
 *
 * Every line is written, or this throws: an unusable reference or quantity is a
 * record this code did not write, and it throws rather than skipping, because a
 * skipped line is a paid order that stock never hears about. No expirationTtl:
 * a sale must last as long as the count it is subtracted from.
 */
async function markSold(env, record) {
  if (typeof record.reference !== "string" || !record.reference) {
    throw new Error("a paid order with no reference cannot be counted");
  }
  if (!Array.isArray(record.items)) throw new Error("a paid order with no items cannot be counted");

  const kv = binding(env);
  const at = Date.now();
  for (const { slug, qty } of record.items) {
    if (typeof slug !== "string" || !slug || !Number.isInteger(qty) || qty < 1) {
      throw new Error("a paid order line with no slug or quantity cannot be counted");
    }
    await kv.put(soldKey(slug, record.reference), String(qty), { metadata: { qty, at } });
  }
}

/**
 * Settles a pending order, once.
 *
 * IDEMPOTENT ON CheckoutRequestID. Safaricom retries callbacks — a delivery it
 * does not see acknowledged is sent again — so this is reached more than once
 * for a single payment as a matter of course, not as an edge case. Anything that
 * acts before checking the stored status double-credits the order.
 *
 * THE AMOUNT IS RE-VERIFIED AND NEVER TRUSTED. The callback endpoint is
 * unauthenticated: anyone who finds the URL can POST a well-formed success for a
 * CheckoutRequestID they guessed. The only thing that makes that harmless is
 * that the figure in the body is compared against the one we computed and stored
 * before the push went out. A mismatch is recorded as `mismatch`, never as paid,
 * and never silently discarded either — it is the signature of either a bug or
 * someone probing, and both want looking at.
 *
 * A NOTE ON THE RACE, STATED RATHER THAN PAPERED OVER: KV has no
 * compare-and-swap, so this is read-then-write and two callbacks arriving in the
 * same instant can both observe `pending`. The consequence here is bounded —
 * both would write the same terminal state from the same stored amount, so the
 * record converges rather than double-crediting — but it is not true mutual
 * exclusion. A Durable Object is the primitive that would give that, and it is
 * the right answer if this ever drives a payout. Stock does not need it: a sale
 * is one key per paid order (markSold), which two settlements cannot lose each
 * other on. What stock still lacks is a reservation at push time, which is a
 * separate decision. Recorded in BUILD-ORDER section 9.
 *
 * @returns {Promise<{outcome: "settled"|"already"|"unknown"|"mismatch", record?: object}>}
 */
export async function settle(env, checkoutRequestId, result) {
  const record = await getPending(env, checkoutRequestId);

  /* No record: a callback for a push we never made, or one whose record has
     expired. Never create one from a callback body — that would let anyone who
     can reach the URL invent a paid order out of nothing. */
  if (!record) return { outcome: "unknown" };

  /* Already terminal. A retry, and the correct response to a retry is to
     acknowledge it and change nothing. */
  if (record.status !== "pending") return { outcome: "already", record };

  if (result.state === "paid") {
    /* The one comparison the whole unauthenticated endpoint rests on. */
    if (Number(result.amount) !== Number(record.amount)) {
      const flagged = {
        ...record,
        status: "mismatch",
        settledAt: Date.now(),
        claimedAmount: result.amount ?? null,
        via: result.via,
      };
      await persist(env, checkoutRequestId, flagged);
      return { outcome: "mismatch", record: flagged };
    }

    /* The sale, then the use of a promo code, both BEFORE the paid write. See
       markSold() and markPromoUse(). */
    await markSold(env, record);
    await markPromoUse(env, record);

    const paid = {
      ...record,
      status: "paid",
      settledAt: Date.now(),
      receipt: typeof result.receipt === "string" ? result.receipt : null,
      via: result.via,
    };
    await persist(env, checkoutRequestId, paid);
    return { outcome: "settled", record: paid };
  }

  const failed = {
    ...record,
    status: "failed",
    settledAt: Date.now(),
    /* Safaricom's own words for why, kept for the log and for a human answering
       the phone. Never shown to the buyer verbatim. */
    failure: typeof result.desc === "string" ? result.desc.slice(0, 200) : null,
    resultCode: result.code ?? null,
    via: result.via,
  };
  await persist(env, checkoutRequestId, failed);
  return { outcome: "settled", record: failed };
}
