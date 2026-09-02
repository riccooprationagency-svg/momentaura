/* Daraja — Safaricom's M-Pesa API. Token, STK Push, and the status query.
 *
 * Everything Daraja-shaped lives here. The endpoints around it do validation,
 * KV bookkeeping and error mapping, and none of that changes if a field in a
 * Daraja request body changes.
 *
 * The underscore prefix keeps Cloudflare Pages from routing this as an endpoint.
 * It is a module, not a URL.
 *
 * SANDBOX AND PRODUCTION CREDENTIALS ARE ENTIRELY SEPARATE AND NOTHING CARRIES
 * OVER. The consumer key, the consumer secret, the shortcode and the passkey are
 * all different values on the two, and the sandbox shortcode is a shared test
 * paybill that is not ours. Moving to production is a full re-issue, not a host
 * swap — see BUILD-ORDER section 9.
 *
 * Every credential is read from `env` inside a request. Nothing in this
 * directory is imported by the Astro build, so no key can reach the browser
 * bundle. A shortcode or passkey hardcoded here would also mean a paybill change
 * needs a code release, which is the wrong shape for a number the business owns.
 */

/** Shown to a buyer. The name of the thing their phone is about to prompt for. */
export const GATEWAY_NAME = "M-Pesa";

/* Thrown for anything Daraja did wrong, was unreachable for, or answered in a
 * shape we do not recognise. The caller logs the detail and returns a generic
 * message — Daraja's own errors quote request payloads back at you, and that is
 * how a passkey or a customer's phone number ends up in a response someone can
 * read.
 *
 * `detail` is for the log. `code` is for us. Neither is ever serialised to a
 * browser. */
export class DarajaError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = "DarajaError";
    this.code = code;
    this.detail = detail;
  }
}

const HOST = {
  live: "https://api.safaricom.co.ke",
  sandbox: "https://sandbox.safaricom.co.ke",
};

/* A gateway that has not answered in fifteen seconds is not going to. Without a
 * ceiling the buyer sits on a spinner until the platform kills the request. */
const TIMEOUT_MS = 15_000;

const base = (env) => (env.MPESA_ENV === "live" ? HOST.live : HOST.sandbox);

/* ---------- timestamp and password ---------- */

/* YYYYMMDDHHmmss in EAT, which is UTC+3 all year — Kenya has no daylight
 * saving, so the offset is a constant rather than a lookup.
 *
 * IT MUST BE EAT, NOT UTC. The same timestamp goes into the password and into
 * the request body, and Daraja rejects a password whose timestamp is outside its
 * tolerance. Building it from UTC is the classic three-hour-skew bug: it works
 * for nobody and the error says only "invalid password". */
export function timestamp(now = new Date()) {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    String(eat.getUTCFullYear()) +
    p(eat.getUTCMonth() + 1) +
    p(eat.getUTCDate()) +
    p(eat.getUTCHours()) +
    p(eat.getUTCMinutes()) +
    p(eat.getUTCSeconds())
  );
}

/** base64(shortcode + passkey + timestamp). Daraja calls this the Password. */
export function password(shortcode, passkey, stamp) {
  return btoa(`${shortcode}${passkey}${stamp}`);
}

/* ---------- the token ----------
 *
 * Valid one hour. CACHED IN THE ISOLATE, NOT FETCHED PER REQUEST: an OAuth round
 * trip in front of every STK push adds latency to the one moment the buyer is
 * waiting, and Daraja rate-limits token requests.
 *
 * Deliberately not cached in KV, though KV is right there. A token is a bearer
 * credential: anything holding it can push against our shortcode until it
 * expires. Keeping it in isolate memory means it dies with the isolate and never
 * exists at rest. The cost of that choice is one token fetch per cold isolate
 * per hour, which is a rounding error against the risk of storing a live
 * credential to buy it back.
 *
 * The 60-second margin is for the request that is in flight when the hour turns
 * over — a token that expires between our check and Daraja reading it fails with
 * an authentication error the buyer would see as a dead checkout. */
let cached = null;
const MARGIN_MS = 60_000;

export function _resetTokenCache() {
  cached = null;
}

export async function getToken(env) {
  const key = env.MPESA_CONSUMER_KEY;
  const secret = env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) throw new DarajaError("misconfigured", "MPESA_CONSUMER_* absent");

  if (cached && cached.env === env.MPESA_ENV && cached.expiresAt - MARGIN_MS > Date.now()) {
    return cached.token;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${base(env)}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${btoa(`${key}:${secret}`)}` },
      signal: controller.signal,
    });
  } catch (cause) {
    throw new DarajaError("unreachable", `token: ${cause}`);
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  if (!response.ok) throw new DarajaError("token_rejected", `${response.status} ${raw.slice(0, 300)}`);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DarajaError("unreadable", `token: ${raw.slice(0, 300)}`);
  }

  const token = parsed && typeof parsed.access_token === "string" ? parsed.access_token : null;
  if (!token) throw new DarajaError("token_missing", raw.slice(0, 300));

  /* expires_in comes back as a string of seconds. Number() rather than trusting
     it, and a floor of one minute so a malformed value cannot produce a cache
     entry that is already expired or one that never refreshes. */
  const seconds = Number(parsed.expires_in);
  const ttl = Number.isFinite(seconds) && seconds > 60 ? seconds : 3599;

  cached = { token, expiresAt: Date.now() + ttl * 1000, env: env.MPESA_ENV };
  return token;
}

/* ---------- the shared POST ---------- */

async function post(env, path, body, what) {
  const token = await getToken(env);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${base(env)}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    throw new DarajaError("unreachable", `${what}: ${cause}`);
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DarajaError("unreadable", `${what}: ${response.status} ${raw.slice(0, 300)}`);
  }

  return { ok: response.ok, status: response.status, parsed, raw };
}

/* ---------- STK Push ---------- */

/**
 * Sends the prompt to the customer's phone.
 *
 * WHAT THIS RETURNS IS NOT A PAYMENT. A 200 here means Safaricom accepted the
 * request and the phone will ring. It says nothing about whether anyone entered
 * a PIN. Only a callback or a successful status query settles an order, and the
 * caller must never mark one paid on the strength of this response.
 *
 * @returns {Promise<{checkoutRequestId: string, merchantRequestId: string}>}
 */
export async function stkPush({ env, amount, msisdn, reference, description, callbackUrl }) {
  const shortcode = env.MPESA_SHORTCODE;
  const passkey = env.MPESA_PASSKEY;
  if (!shortcode || !passkey) throw new DarajaError("misconfigured", "MPESA_SHORTCODE/PASSKEY absent");

  /* Integer KSh. Daraja rejects a decimal amount, and the catalogue holds
     integers, so nothing in this path ever carries a price as a float. */
  if (!Number.isInteger(amount) || amount < 1) {
    throw new DarajaError("bad_amount", `amount was ${amount}`);
  }

  const stamp = timestamp();

  const { ok, status, parsed, raw } = await post(
    env,
    "/mpesa/stkpush/v1/processrequest",
    {
      BusinessShortCode: shortcode,
      Password: password(shortcode, passkey, stamp),
      Timestamp: stamp,
      /* Paybill by default, till via env. A business that moves from one to the
         other should not need a code release. */
      TransactionType: env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline",
      Amount: amount,
      PartyA: msisdn,
      PartyB: shortcode,
      PhoneNumber: msisdn,
      CallBackURL: callbackUrl,
      /* What the customer sees on the prompt and on their statement. */
      AccountReference: reference,
      TransactionDesc: description,
    },
    "stkpush"
  );

  if (!ok) throw new DarajaError("rejected", `${status} ${raw.slice(0, 300)}`);

  /* Daraja answers 200 with a ResponseCode of "0" on success. A non-zero code in
     a 200 body is still a refusal, and reading only the HTTP status is how a
     failed push is recorded as a pending order that never settles. */
  if (String(parsed.ResponseCode) !== "0") {
    throw new DarajaError("rejected", `ResponseCode ${parsed.ResponseCode}: ${raw.slice(0, 300)}`);
  }

  const checkoutRequestId = parsed.CheckoutRequestID;
  const merchantRequestId = parsed.MerchantRequestID;
  if (typeof checkoutRequestId !== "string" || !checkoutRequestId) {
    throw new DarajaError("no_checkout_id", raw.slice(0, 300));
  }

  return { checkoutRequestId, merchantRequestId: merchantRequestId ?? null };
}

/* ---------- the status query ----------
 *
 * The fallback for when a callback never arrives. Asks Daraja what became of a
 * push we already sent.
 *
 * Returns one of three states rather than a boolean, because "not settled yet"
 * and "failed" are different facts and collapsing them marks live payments as
 * failures:
 *
 *   paid     ResultCode 0
 *   failed   any other ResultCode — cancelled, wrong PIN, no balance, timeout
 *   pending  Daraja says it is still processing
 */
export async function queryStatus({ env, checkoutRequestId }) {
  const shortcode = env.MPESA_SHORTCODE;
  const passkey = env.MPESA_PASSKEY;
  if (!shortcode || !passkey) throw new DarajaError("misconfigured", "MPESA_SHORTCODE/PASSKEY absent");

  const stamp = timestamp();

  const { ok, parsed, raw } = await post(
    env,
    "/mpesa/stkpushquery/v1/query",
    {
      BusinessShortCode: shortcode,
      Password: password(shortcode, passkey, stamp),
      Timestamp: stamp,
      CheckoutRequestID: checkoutRequestId,
    },
    "query"
  );

  /* "The transaction is being processed" comes back as an error body with
     errorCode 500.001.1001, not as a result. It means pending, and treating a
     non-ok response as a failure here would settle a live payment as failed. */
  if (!ok) {
    const code = parsed && parsed.errorCode;
    if (code === "500.001.1001") return { state: "pending", desc: "still processing" };
    throw new DarajaError("query_rejected", raw.slice(0, 300));
  }

  const result = String(parsed.ResultCode);
  if (result === "0") return { state: "paid", desc: parsed.ResultDesc ?? "" };
  if (result === "undefined") throw new DarajaError("unreadable", `query: ${raw.slice(0, 300)}`);
  return { state: "failed", desc: parsed.ResultDesc ?? "", code: result };
}
