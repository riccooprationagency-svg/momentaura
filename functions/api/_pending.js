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

import { phoneKey, promoKey, promoPhoneKey } from "./_promo.js";

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
 * Which is why `already` below never repairs a stale reference copy: it cannot
 * be reached with one, so code to repair one there would be dead weight implying
 * a state that cannot happen. (It does finish an uncounted promo, through
 * countPromo() — that repairs a different thing, the code's use count, and it
 * writes through this same function so the ordering below still holds.)
 * That is a real guarantee resting on two lines of ordering,
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
 * Counts a PAID order against its promo code, once.
 *
 * A code is used when the order is paid and not before: an STK prompt that is
 * never completed costs the code nothing. Called from the two places a paid
 * order passes through in settle(), and a no-op for an order with no code or one
 * already counted, so non-promo orders see no extra read or write.
 *
 * WHAT ONCE MEANS HERE. `promoCounted` on the order is the guard, and it is
 * written LAST. The two effects before it are ordered so that a retry after a
 * failure is safe where it can be: the promo-phone key is idempotent, so it goes
 * first; the usedCount increment is not, so it goes last. A KV failure anywhere
 * throws, the callback answers 500, Safaricom retries, and settle() reaches this
 * again through its `already` branch. The one window that cannot be closed is a
 * failure of the final write AFTER the increment, where the retry increments a
 * second time. KV has no atomic increment and no transaction, so the count can
 * be off by one for the orders that hit it; it is recorded rather than hidden.
 *
 * THE CAP IS NOT CHECKED HERE. Expiry and cap were judged when the push was
 * requested. An order paid after the cap was reached is still honoured and still
 * counted, so usedCount can pass maxUses by the orders in flight.
 *
 * promo records are written with NO expirationTtl — putPending() would give them
 * seven days, and a code must outlive an order.
 *
 * Nothing logged here carries the code or a number; the order reference is the
 * only handle.
 */
async function countPromo(env, checkoutRequestId, record) {
  if (typeof record.promoCode !== "string" || !record.promoCode || record.promoCounted === true) {
    return record;
  }

  const kv = binding(env);
  const key = promoKey(record.promoCode);
  const promo = await kv.get(key, "json");

  /* A record deleted since the push has nothing to count against. The order is
     still paid and still honoured; it is marked counted so a replay does not
     keep looking. */
  if (promo && Number.isInteger(promo.usedCount) && promo.usedCount >= 0) {
    if (promo.oncePerPhone === true) {
      await kv.put(promoPhoneKey(record.promoCode, await phoneKey(record.msisdn)), record.reference ?? "1");
    }
    await kv.put(key, JSON.stringify({ ...promo, usedCount: promo.usedCount + 1 }));
  }

  const counted = { ...record, promoCounted: true };
  await persist(env, checkoutRequestId, counted);
  return counted;
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
 * the right answer if this ever drives stock decrement or a payout. Recorded in
 * BUILD-ORDER section 9.
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
     acknowledge it and change nothing — with ONE exception, below: a paid promo
     order whose count never landed. */
  if (record.status !== "pending") {
    /* A paid order whose count did not land (KV failed after the paid write) is
       finished here, on the retry. Every other terminal order, and every paid
       one already counted, comes back untouched. */
    if (record.status === "paid") {
      return { outcome: "already", record: await countPromo(env, checkoutRequestId, record) };
    }
    return { outcome: "already", record };
  }

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

    const paid = {
      ...record,
      status: "paid",
      settledAt: Date.now(),
      receipt: typeof result.receipt === "string" ? result.receipt : null,
      via: result.via,
    };
    await persist(env, checkoutRequestId, paid);
    /* The money fact is written first and counted second, never the other way:
       a count that landed before a failed paid-write would use up a code for an
       order that then retries as pending. */
    return { outcome: "settled", record: await countPromo(env, checkoutRequestId, paid) };
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
