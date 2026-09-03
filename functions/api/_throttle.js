/* A guessing budget for /api/track, counted per connection in KV.
 *
 * WHAT THIS IS NOT: the thing that keeps an order private. That is the
 * reference — eight characters from a 30-character alphabet, minted from
 * crypto.getRandomValues, with the phone number that placed the order required
 * alongside it. A search of that space is not something a limit makes safe and
 * not something removing one makes reachable.
 *
 * WHAT IT IS: the difference between guessing costing nothing and guessing
 * costing something. An endpoint that answers an unlimited number of misses is
 * an endpoint somebody can point a script at and leave running, and the fact
 * that the script will not finish is a poor reason to serve it.
 *
 * ONLY MISSES ARE COUNTED. A buyer refreshing their own order all morning is
 * exactly the use this page exists for and must never be the thing that locks
 * them out; a caller that keeps naming orders which are not theirs is the only
 * traffic being described here. It also keeps the successful path at one KV
 * read, unchanged.
 *
 * FIXED WINDOW, NOT A SLIDING ONE. KV has no counter primitive and no
 * compare-and-swap, so this is read-then-write and two requests in the same
 * instant can both write the same figure. A limit that undercounts slightly
 * under concurrency still ends the unlimited case, and a Durable Object is the
 * primitive for anything stricter — the same trade recorded for settle().
 *
 * IT FAILS OPEN, DELIBERATELY, and this is the one place in the repo that does.
 * A KV wobble or a missing CF-Connecting-IP must not take order lookup down:
 * the cost of failing closed here is a buyer who paid being told they cannot
 * see their order, and the cost of failing open is that a guesser gets their
 * unlimited attempts back for as long as the wobble lasts. The reference is
 * still the secret either way.
 */

const WINDOW_SECONDS = 600;

/** Misses allowed per address per window. A mistyped reference costs one. */
const LIMIT = 20;

/* What is left of the current window. The window is fixed, so a caller who
   spends the budget in its last few seconds waits those seconds and not ten
   minutes — a Retry-After longer than the lock is a compliant client sitting
   out a lookup it could have been served. */
export const secondsUntilReset = (now = Date.now()) =>
  WINDOW_SECONDS - Math.floor((now / 1000) % WINDOW_SECONDS);

const keyFor = (address, now) => `try:${address}:${Math.floor(now / (WINDOW_SECONDS * 1000))}`;

/** The connecting address, as Cloudflare reports it. Null anywhere else. */
export const addressOf = (request) => request.headers.get("CF-Connecting-IP") || null;

/** Whether this address has spent its budget. Never throws. */
export async function overBudget(env, address, now = Date.now()) {
  if (!address || !env.ORDERS) return false;
  try {
    const spent = Number(await env.ORDERS.get(keyFor(address, now)));
    return Number.isFinite(spent) && spent >= LIMIT;
  } catch (error) {
    console.log(JSON.stringify({ at: "throttle", code: "kv_read_failed", detail: String(error) }));
    return false;
  }
}

/** Records one miss against this address. Best-effort; never throws. */
export async function recordMiss(env, address, now = Date.now()) {
  if (!address || !env.ORDERS) return;
  const key = keyFor(address, now);
  try {
    const spent = Number(await env.ORDERS.get(key)) || 0;
    await env.ORDERS.put(key, String(spent + 1), { expirationTtl: WINDOW_SECONDS * 2 });
  } catch (error) {
    console.log(JSON.stringify({ at: "throttle", code: "kv_write_failed", detail: String(error) }));
  }
}
