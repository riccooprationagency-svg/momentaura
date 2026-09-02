/* POST /api/track — what became of an order, for the person who placed it.
 *
 * ORDER REFERENCE PLUS PHONE. NO ACCOUNTS, NO PASSWORDS, NO EMAIL LINK.
 * An account is a password to forget, a database of credentials to protect and a
 * reason to abandon a purchase, in exchange for nothing this needs. The two
 * things a buyer already has in their hand — the reference on their confirmation
 * screen and the phone the prompt went to — are enough to identify one order and
 * nothing else.
 *
 * The reference is the secret. It is minted from crypto.getRandomValues over a
 * 30-character alphabet, eight characters long: guessing one is not a route in.
 * The phone number is the second factor and is deliberately the weaker of the
 * two, because a buyer must be able to remember it. It is there so that a
 * reference read aloud in a shop, screenshotted into a group chat, or left on a
 * printed slip does not by itself open the order.
 *
 * A WRONG REFERENCE AND A WRONG PHONE GIVE THE SAME ANSWER. Distinguishing them
 * would turn the phone check into an oracle for which references exist, and
 * confirming a reference exists is most of the way to confirming who bought
 * what.
 *
 * WHAT IT CANNOT DO YET, and this is stated on the page rather than hidden: it
 * reports what the system actually knows, and the system only knows the outcome
 * of orders that went through the M-Pesa path, because that is the only path
 * with a callback that settles anything. The IntaSend path of step 8 has no
 * webhook, so it writes nothing here. Until step 9's credentials exist there are
 * no settled orders to find. Recorded in BUILD-ORDER section 10.
 */

import { msisdnFrom } from "./_order.js";
import { getPending } from "./_pending.js";

/* The shape _order.js mints. Checked before it is used as a KV key so a
   malformed value is refused rather than becoming a lookup. */
const REFERENCE = /^MA-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/* One answer for every miss. */
const NOT_FOUND =
  "No order matches that reference and phone number. Check both — the reference " +
  "is on your confirmation screen, and the phone number is the one the payment " +
  "prompt was sent to.";

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

  const reference = payload && typeof payload.reference === "string" ? payload.reference.trim().toUpperCase() : "";
  const msisdn = msisdnFrom(payload && payload.phone);

  /* Field-level, because these two are the buyer's own typing and a specific
     correction is what lets them fix it themselves. Only the LOOKUP result is
     deliberately vague. */
  if (!REFERENCE.test(reference)) {
    return json(400, {
      message: "That is not an order reference. It looks like MA-4KLM-2XQP and is on your confirmation screen.",
      field: "reference",
    });
  }
  if (msisdn === null) {
    return json(400, {
      message: "Enter the Kenyan phone number the payment prompt was sent to, like 0712 345 678.",
      field: "phone",
    });
  }

  let record;
  try {
    record = await getPending(env, `ref:${reference}`);
  } catch (error) {
    console.log(JSON.stringify({ at: "track", code: "kv_read_failed", detail: String(error) }));
    return json(503, {
      message: "Orders cannot be looked up right now. Try again shortly.",
    });
  }

  /* Both misses, one answer. Not a 404 either — a 404 for a real reference with
     the wrong phone and a 404 for a reference that does not exist are the same
     response, so neither confirms anything about the other. */
  if (!record || record.msisdn !== msisdn) {
    return json(404, { message: NOT_FOUND });
  }

  /* What the buyer already knows about their own order, and nothing more. No
     name, no email, no receipt number, no CheckoutRequestID — the id is the key
     the status endpoint accepts, and there is no reason to hand it back here. */
  return json(200, {
    reference: record.reference,
    status: record.status,
    placedAt: record.createdAt ?? null,
    amount: record.amount,
    items: Array.isArray(record.items) ? record.items : [],
  });
}
