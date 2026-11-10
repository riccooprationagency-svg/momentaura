/* The shop's own facts, as the Functions see them: the delivery fee table.
 *
 * ONE SOURCE. The fees live in src/data/site.json `delivery.zones` and nowhere
 * else. The /delivery table and the county <select> on /checkout are built from
 * the same rows at build time (src/lib/site.ts), and this is the server's read
 * of them. The server prices delivery from THIS map and nothing the browser
 * sends: the form posts a county key, and any fee, subtotal or total in the
 * request is never read.
 *
 * src/lib/site.ts is not imported here. It reads the filesystem at build time
 * (node:fs, for publicFile()), which does not exist in the Workers runtime, so
 * the Functions read the JSON directly — the same way _middleware.js does.
 *
 * A bare JSON import, with no `with { type: "json" }` attribute: Pages compiles
 * Functions with an esbuild that predates import attributes. See the comment in
 * _middleware.js. The tests substitute this one line, as they do for the
 * catalogue in _order.js.
 */

import site from "../../src/data/site.json";

/* ---------- a person to reach, for every error message ----------
 *
 * CLAUDE.md: errors "say what happened, how to fix it, and carry a phone
 * number". The pages carry it beside their errors in markup (OrderHelp.astro);
 * these are the messages the Functions write themselves, which used to route to
 * /contact because no real number existed. One exists now, in site.json
 * `contact.phone`, and this is the only place a Function reads it — the same
 * value lib/site.ts builds every tel: and wa.me link from.
 *
 * It fails toward the contact page, not toward a hole in a sentence: with no
 * number, REACH says "get in touch on the contact page" and ELSEWHERE is empty,
 * which is exactly what these messages said before. */
const said = (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** The phone number as a buyer reads it, "0753 181 901", or null. */
export const PHONE = said(site?.contact?.phone);
const WHATSAPP = said(site?.contact?.whatsapp);

/** Lower-case, to finish a sentence: "…try again, or call or WhatsApp 0753 181 901." */
export const REACH = PHONE
  ? WHATSAPP === null || WHATSAPP === PHONE
    ? `call or WhatsApp ${PHONE}`
    : `call ${PHONE} or WhatsApp ${WHATSAPP}`
  : "get in touch on the contact page";

/** The same, opening a sentence. */
export const Reach = REACH.charAt(0).toUpperCase() + REACH.slice(1);

/** A trailing sentence naming the contact page, only when REACH did not already. */
export const ELSEWHERE = PHONE ? " Every other way to reach a person is on the contact page." : "";

/* key -> { key, name, cost }. A row that is not a well-formed fee is left out,
 * which makes its county unorderable rather than priced at a guess. The build
 * refuses a malformed row before it can be deployed (src/lib/site.ts), so this
 * is the second lock on the same door, not the only one. */
export const ZONES = new Map(
  (Array.isArray(site?.delivery?.zones) ? site.delivery.zones : [])
    .filter(
      (z) =>
        z &&
        typeof z.key === "string" &&
        z.key !== "" &&
        typeof z.name === "string" &&
        Number.isInteger(z.cost) &&
        z.cost >= 0
    )
    .map((z) => [z.key, { key: z.key, name: z.name, cost: z.cost }])
);
