/* POST /api/mpesa/callback/<token> — where Safaricom reports the result.
 *
 * THE MOST DANGEROUS ENDPOINT IN THE REPO. It is public, it is unauthenticated,
 * and it is the thing that marks money as received.
 *
 * SAFARICOM DOES NOT SIGN CALLBACKS. There is no shared secret in the body, no
 * HMAC, no certificate to check. Anyone who learns this URL can POST a
 * well-formed success for any CheckoutRequestID they can guess. Three
 * independent things keep that from being a way to conjure a paid order, and
 * none of them is sufficient alone:
 *
 *   1. THE PATH IS UNGUESSABLE. The last segment is a secret from an env var,
 *      not a filename — filenames are committed to git, and a secret in the repo
 *      is not a secret. Compared in constant time
 *   2. THE SOURCE IP IS ALLOWLISTED to Safaricom's published callback ranges,
 *      and the check FAILS CLOSED if the list is missing
 *   3. THE AMOUNT IS RE-VERIFIED against the figure we computed and stored
 *      before the push went out. The body's amount is never believed and never
 *      written. This is the one that still holds if the first two are defeated
 *
 * IDEMPOTENT ON CheckoutRequestID. Safaricom retries anything it does not see
 * acknowledged, so a repeat is normal traffic rather than an attack. settle()
 * checks the stored status first and a retry changes nothing.
 *
 * IT ALWAYS ANSWERS 200. A non-200 makes Safaricom retry, and there is nothing
 * it can retry its way out of — a body we cannot read will not parse next time
 * either, and a rejected caller should be told nothing about why. The only
 * signal that leaves this endpoint is the acknowledgement Daraja expects; every
 * real outcome goes to the log.
 */

import { settle } from "../../_pending.js";

/* Safaricom's published callback ranges. Configured, not hardcoded, because
 * this list is theirs to change and a change must not need a code release.
 * The default is a starting point and MUST be confirmed against current Daraja
 * documentation before production — an outdated allowlist silently rejects real
 * payments, and the only thing that would save those is the status-query
 * fallback. Recorded in BUILD-ORDER section 9. */
const DEFAULT_IPS =
  "196.201.214.200,196.201.214.206,196.201.213.114,196.201.214.207," +
  "196.201.214.208,196.201.213.44,196.201.212.127,196.201.212.138," +
  "196.201.212.129,196.201.212.136,196.201.212.74,196.201.212.69";

/* Constant-time string compare. A timing oracle on the path token is a slow but
 * real way to learn it, and the comparison costs nothing to do properly. */
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Daraja's CallbackMetadata is a list of {Name, Value}. Pull one out by name. */
function metadata(items, name) {
  if (!Array.isArray(items)) return undefined;
  const found = items.find((item) => item && item.Name === name);
  return found ? found.Value : undefined;
}

/* The only thing Safaricom is told, whatever happened. */
const ack = () =>
  new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function onRequest({ request, env, params }) {
  /* A GET is a probe or a crawler. It learns nothing, not even that the path is
     right — the 404 is what any wrong path returns. */
  if (request.method !== "POST") return new Response("Not found", { status: 404 });

  /* ---------- 1. the unguessable path ---------- */

  const expected = env.MPESA_CALLBACK_TOKEN;
  if (!expected || !sameSecret(params.token, expected)) {
    console.log(JSON.stringify({ at: "callback", code: "bad_token" }));
    /* 404, not 403. A 403 confirms the route exists and that the token was the
       only thing wrong, which turns a blind guess into a warm one. */
    return new Response("Not found", { status: 404 });
  }

  /* ---------- 2. the source ---------- */

  const allowed = (env.MPESA_CALLBACK_IPS ?? DEFAULT_IPS)
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);

  const source = request.headers.get("CF-Connecting-IP");

  /* FAILS CLOSED. An empty allowlist accepts nothing rather than everything.
     Failing open here would quietly remove the second of three defences on the
     endpoint that marks money received, and nobody would notice because
     everything would keep working. The cost of failing closed is a missed
     callback, and a missed callback is precisely what the status-query fallback
     exists to recover — so the safe direction is also the recoverable one. */
  if (!allowed.includes(source)) {
    console.log(JSON.stringify({ at: "callback", code: "bad_source", source }));
    return new Response("Not found", { status: 404 });
  }

  /* ---------- the body ---------- */

  let payload;
  try {
    payload = await request.json();
  } catch {
    console.log(JSON.stringify({ at: "callback", code: "unreadable_body" }));
    return ack();
  }

  const stk = payload && payload.Body && payload.Body.stkCallback;
  const checkoutRequestId = stk && stk.CheckoutRequestID;

  if (typeof checkoutRequestId !== "string" || !checkoutRequestId) {
    console.log(JSON.stringify({ at: "callback", code: "no_checkout_id" }));
    return ack();
  }

  /* ResultCode 0 is the only success. Everything else is a real outcome with a
     reason: 1032 cancelled by the customer, 1037 no response from the phone,
     2001 wrong PIN, 1 insufficient balance. All of them are `failed` here and
     the reason is kept for whoever answers the phone about it. */
  const resultCode = String(stk.ResultCode);
  const paid = resultCode === "0";

  const items = stk.CallbackMetadata && stk.CallbackMetadata.Item;

  /* ---------- 3. settle, with the amount re-verified ---------- */

  let outcome;
  try {
    outcome = await settle(env, checkoutRequestId, {
      state: paid ? "paid" : "failed",
      /* Read, reported, and CHECKED AGAINST THE STORED FIGURE inside settle().
         It is never written as the order's amount. */
      amount: paid ? metadata(items, "Amount") : undefined,
      receipt: paid ? metadata(items, "MpesaReceiptNumber") : undefined,
      desc: stk.ResultDesc,
      code: resultCode,
      via: "callback",
    });
  } catch (error) {
    /* KV failed. Do NOT acknowledge — this is the one case a retry can fix, and
       Safaricom retrying is exactly what we want. */
    console.log(
      JSON.stringify({ at: "callback", checkoutRequestId, code: "settle_failed", detail: String(error) })
    );
    return new Response("Retry", { status: 500 });
  }

  console.log(
    JSON.stringify({
      at: "callback",
      checkoutRequestId,
      reference: outcome.record ? outcome.record.reference : null,
      resultCode,
      outcome: outcome.outcome,
      /* A mismatch is either a bug in our own pricing or someone posting a
         forged success. Both want a human looking at them, so it is logged
         with the figure that was claimed. */
      claimed: outcome.outcome === "mismatch" ? outcome.record.claimedAmount : undefined,
    })
  );

  return ack();
}
