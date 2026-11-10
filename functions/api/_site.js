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
