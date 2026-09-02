/* The gateway adapter. THIS IS THE FILE STEP 9 REPLACES.
 *
 * Everything gateway-specific lives here and nowhere else. checkout.js does
 * validation, server-side re-pricing and error mapping, and none of that changes
 * when the gateway does. Step 9 rewrites the body of this file to talk to
 * Daraja; the import in checkout.js, the client, the pages and the error states
 * all stay exactly as they are.
 *
 * The underscore prefix keeps Cloudflare Pages from routing this as an endpoint.
 * It is a module, not a URL.
 *
 * The contract, which step 9 must keep:
 *
 *   GATEWAY_NAME          string, shown to the buyer before the redirect. The
 *                         name of the domain they are about to land on, because
 *                         an unannounced jump to a stranger's domain at the
 *                         moment money moves is the worst thing this flow can do
 *   createHostedCheckout  resolves to { url }, or throws GatewayError
 *
 * It returns a URL and never a card form. No card field exists on our domain at
 * any point, which is what keeps PCI scope at the lightest tier. That is not a
 * property of this file that step 9 may trade away.
 */

/** The name the buyer is told before they are sent anywhere. */
export const GATEWAY_NAME = "IntaSend";

/* Thrown for anything the gateway did wrong, unreachable, or answered in a shape
 * we do not recognise. checkout.js catches it, logs the detail, and returns a
 * generic message — the gateway's own response never reaches the browser,
 * because gateway errors quote request payloads back at you and that is how a
 * key or a customer's phone number ends up in a fetch response someone can read.
 *
 * `detail` is for the log. `code` is for us. Neither is ever serialised to the
 * client. */
export class GatewayError extends Error {
  constructor(code, detail) {
    super(code);
    this.name = "GatewayError";
    this.code = code;
    this.detail = detail;
  }
}

/* IntaSend's hosted checkout. Live and sandbox differ only by host. */
const HOST = {
  live: "https://payment.intasend.com",
  sandbox: "https://sandbox.intasend.com",
};

/* A gateway that has not answered in fifteen seconds is not going to. Without a
 * ceiling the buyer sits on a spinner until the platform kills the request, and
 * a checkout that hangs reads as a shop that took the money and went quiet —
 * the exact suspicion this whole site is built to remove. Failing fast lets us
 * say so and offer the other route. */
const TIMEOUT_MS = 15_000;

/**
 * @param {object}  args
 * @param {object}  args.env          Cloudflare environment. Secrets only exist here.
 * @param {string}  args.reference    Our order reference. Round-trips back to us.
 * @param {number}  args.amount       Integer KSh, computed server-side from our catalogue.
 * @param {object}  args.customer     { name, phone, email|null }
 * @param {string}  args.redirectUrl  Where the gateway returns the buyer.
 * @returns {Promise<{ url: string }>}
 */
export async function createHostedCheckout({ env, reference, amount, customer, redirectUrl }) {
  const secret = env.INTASEND_SECRET_KEY;
  const publishable = env.INTASEND_PUBLISHABLE_KEY;

  /* Missing configuration is our fault, not the buyer's, and it must not read
     as a declined payment. checkout.js maps this to "unavailable", which offers
     the other route, rather than to "declined", which would tell the buyer
     something untrue about their own card or phone. */
  if (!secret || !publishable) {
    throw new GatewayError("gateway_misconfigured", "INTASEND_* env vars absent");
  }

  const base = env.INTASEND_ENV === "live" ? HOST.live : HOST.sandbox;

  /* One name split into two fields. A person with one name gets an empty
     last_name rather than a rejected order — a checkout that refuses a mononym
     is a checkout that refuses a customer. */
  const cut = customer.name.trim().indexOf(" ");
  const first = cut === -1 ? customer.name.trim() : customer.name.trim().slice(0, cut);
  const last = cut === -1 ? "" : customer.name.trim().slice(cut + 1);

  const body = {
    public_key: publishable,
    /* Integer KSh throughout. The catalogue stores integers, this sends an
       integer, and nothing in the path ever holds a price as a float. */
    amount,
    currency: "KES",
    email: customer.email ?? undefined,
    phone_number: customer.phone,
    first_name: first,
    last_name: last,
    api_ref: reference,
    redirect_url: redirectUrl,
    /* Card is not enabled. M-Pesa is what this shop takes, and a card option
       here would be a card form on someone's domain for no reason. */
    method: "M-PESA",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${base}/api/v1/checkout/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    throw new GatewayError("gateway_unreachable", String(cause));
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();

  if (!response.ok) {
    /* The status and the body go to the log, never to the browser. */
    throw new GatewayError("gateway_rejected", `${response.status} ${raw.slice(0, 500)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GatewayError("gateway_unreadable", raw.slice(0, 500));
  }

  const url = parsed && typeof parsed.url === "string" ? parsed.url : null;

  /* A 200 with no URL is not a success. Treating it as one would redirect the
     buyer to "undefined" at the moment they expect to pay. */
  if (!url) {
    throw new GatewayError("gateway_no_url", raw.slice(0, 500));
  }

  /* Only ever send someone to the gateway's own host over TLS. If the response
     has been tampered with, or the gateway one day returns a partner domain, an
     open redirect out of a payment flow is the most valuable one there is. */
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new GatewayError("gateway_bad_url", url.slice(0, 200));
  }

  const expected = new URL(base).hostname;
  const okHost = parsedUrl.hostname === expected || parsedUrl.hostname.endsWith(".intasend.com");
  if (parsedUrl.protocol !== "https:" || !okHost) {
    throw new GatewayError("gateway_bad_url", url.slice(0, 200));
  }

  return { url: parsedUrl.toString() };
}
