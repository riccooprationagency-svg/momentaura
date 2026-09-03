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
 * MISSES ARE COUNTED PER ADDRESS AND RUN OUT. The reference is what keeps an
 * order private; the budget in _throttle.js is what stops an unlimited number
 * of attempts at it being free. A buyer checking their own order is never the
 * traffic it describes, because only misses are counted.
 *
 * WHAT IT CANNOT DO YET, and this is stated on the page rather than hidden: it
 * reports what the system actually knows, and the system only knows the outcome
 * of orders that went through the M-Pesa path, because that is the only path
 * with a callback that settles anything. The IntaSend path of step 8 has no
 * webhook, so it writes nothing here. Until step 9's credentials exist there are
 * no settled orders to find. Recorded in BUILD-ORDER section 10.
 */

import catalogue from "../../src/data/products.json";
import { msisdnFrom } from "./_order.js";
import { getPending } from "./_pending.js";
import { addressOf, overBudget, recordMiss, secondsUntilReset } from "./_throttle.js";

const BY_SLUG = new Map(catalogue.map((p) => [p.slug, p]));

/* The shape _order.js mints. Checked before it is used as a KV key so a
   malformed value is refused rather than becoming a lookup. */
const REFERENCE = /^MA-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/* One answer for every miss, and it does not read as an error, because for the
 * buyer it usually is not one — a mistyped character is far likelier than a
 * missing order. It says what to check and where to go if both are right.
 *
 * NOT "we". CLAUDE.md forbids "we" where one person is meant, and there is no
 * evidence here of more than one, so the sentence is written without it. */
const NOT_FOUND =
  "That order cannot be found. Check the reference and the phone number — the " +
  "reference is on your confirmation screen, and the phone number is the one the " +
  "payment went through. If both are right, get in touch on the contact page.";

/* Nairobi is UTC+3 all year — Kenya keeps no daylight saving — so the offset is
 * a constant rather than a lookup. */
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

/* Working days from a date, COUNTED IN NAIROBI TIME. Saturday and Sunday are
 * not dispatch days.
 *
 * The shift is the whole point. A payment settling at 01:00 Nairobi on a Monday
 * is Sunday 22:00 UTC, so counting the weekend in UTC starts a day early and
 * lands the promise a day short — or on a Saturday, on a page whose only claim
 * is that the date is one you can hold us to. The date is formatted in Nairobi,
 * so it is counted there too.
 *
 * Public holidays are not modelled, and that is a stated limit rather than an
 * oversight: it needs a real Kenyan calendar, and a date quietly wrong twice a
 * year is worse than one honest about counting working days only.
 *
 * The confirmation screen computes the same thing in the browser, from lead
 * times rendered into the page. The two cannot share code across the client and
 * server boundary; they follow the same rule, and this comment is the link
 * between them. */
function workingDaysFrom(start, days) {
  const date = new Date(start + NAIROBI_OFFSET_MS);
  let left = days;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return new Date(date.getTime() - NAIROBI_OFFSET_MS);
}

const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Africa/Nairobi",
});

/* A DATE, never a duration, and only for an order that is actually settled.
 *
 * Returns null — and the caller then omits the field entirely — unless every
 * line in the order has a real lead time. One null and the order's arrival is
 * unknown; the longest of the known ones would be a guess wearing a date's
 * clothes, on the screen a buyer opens specifically to find out where their
 * money went. leadTimeDays is null on every product today, so nothing renders. */
function dispatchDate(record) {
  if (record.status !== "paid") return null;

  let longest = 0;
  for (const item of record.items ?? []) {
    const product = BY_SLUG.get(item.slug);
    const lead = product ? product.leadTimeDays : null;
    if (typeof lead !== "number" || !Number.isFinite(lead) || lead < 1) return null;
    longest = Math.max(longest, lead);
  }
  if (longest < 1) return null;

  const from = record.settledAt ?? record.createdAt;
  if (typeof from !== "number") return null;

  return LONG_DATE.format(workingDaysFrom(from, longest));
}

const json = (status, body, extra) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  /* Spent budget, before anything is read or looked up. It says what happened
     and what to do, and it routes to a person, because a buyer who has
     mistyped twenty times is the one who most needs one. */
  const address = addressOf(request);
  if (await overBudget(env, address)) {
    const wait = secondsUntilReset();
    const minutes = Math.ceil(wait / 60);
    return json(
      429,
      {
        message:
          `Too many lookups from this connection have come back empty. Try again in ` +
          `${minutes} ${minutes === 1 ? "minute" : "minutes"}, or get in touch on the ` +
          `contact page and the order will be looked up by hand.`,
      },
      { "Retry-After": String(wait) }
    );
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
    await recordMiss(env, address);
    return json(404, { message: NOT_FOUND });
  }

  /* What the buyer already knows about their own order, and nothing more. No
     name, no email, no receipt number, no CheckoutRequestID — the id is the key
     the status endpoint accepts, and there is no reason to hand it back here. */
  /* The field is absent rather than null when there is no date, so the page has
     nothing to render and omits the element — the same rule the page follows for
     every other fact that does not exist. */
  const dispatch = dispatchDate(record);

  return json(200, {
    reference: record.reference,
    status: record.status,
    placedAt: record.createdAt ?? null,
    amount: record.amount,
    items: Array.isArray(record.items) ? record.items : [],
    ...(dispatch ? { dispatchDate: dispatch } : {}),
  });
}
