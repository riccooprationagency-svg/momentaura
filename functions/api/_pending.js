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
