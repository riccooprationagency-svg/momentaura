/* What is left to sell: the catalogue's figure minus the sales recorded since it
 * was counted.
 *
 * MONEY-PATH CODE. The catalogue is a JSON file baked into the build, so nothing
 * in functions/ can change it at runtime. Stock therefore never counts down by
 * writing a field. Each PAID sale is one key in KV, and an order is checked
 * against `stock - (sales since the count)`.
 *
 * ONE KEY PER LINE OF A PAID ORDER: sold:<slug>:<reference>, value the quantity
 * as a string, and { qty, at } in KV metadata. list() hands metadata back without
 * a read per key, so counting a product's sales is one list and no gets.
 *
 * THE SAME SHAPE AS THE PROMO USE MARKERS, for the same reason: there is no
 * counter to read, add one to and write back, which on a store with no
 * compare-and-swap loses an increment whenever two orders settle together. Two
 * orders write two different keys and cannot lose each other; one order written
 * twice (a retried callback, a callback and a status query) writes the same key
 * twice and is still one sale.
 *
 * `stockCountedAt` IS WHAT MAKES A SALES COUNT MEAN ANYTHING. A sale is only
 * subtracted if it happened at or after the moment the catalogue's figure was
 * counted. After a physical recount, Ric edits `stock` and `stockCountedAt`
 * together and every earlier sale stops counting; without that, a recount taken
 * after five sales would have the five subtracted a second time.
 *
 * Nothing here is logged except the reference of a marker that could not be
 * read: never a quantity, a product name or a phone number.
 *
 * This module imports nothing, so the test harness loads it unpatched.
 */

/* The trailing colon is what stops tee-1 matching tee-12: a slug can contain a
   digit and a dash, never a colon. */
export const soldPrefix = (slug) => `sold:${slug}:`;
export const soldKey = (slug, reference) => `${soldPrefix(slug)}${reference}`;

/**
 * The units of one product sold at or after `since`.
 *
 * Follows the cursor until the list says it is complete. A list that throws
 * throws out of here, and the caller answers 503 rather than guessing a count.
 * A list that is incomplete and gives no cursor throws too: returning the sum so
 * far would undercount, and an undercount sells what is not there.
 *
 * A marker whose metadata is missing, or whose qty is not a positive integer, or
 * whose time is not a finite number, counts as 0 and is logged by reference
 * only. It cannot count as anything else: a marker this code did not write is not
 * evidence of a sale of any size, and one bad key must not take the shop down.
 *
 * @param kv     the ORDERS binding
 * @param slug   a catalogue slug
 * @param since  ms since epoch; sales before it are inside the counted figure
 * @returns {Promise<number>}
 */
export async function soldSince(kv, slug, since) {
  const prefix = soldPrefix(slug);
  let total = 0;
  let cursor;
  for (;;) {
    const page = await kv.list(cursor ? { prefix, cursor } : { prefix });
    for (const key of page.keys) {
      const meta = key.metadata;
      const usable =
        meta !== null &&
        typeof meta === "object" &&
        Number.isInteger(meta.qty) &&
        meta.qty >= 1 &&
        Number.isFinite(meta.at);
      if (!usable) {
        console.log(
          JSON.stringify({ at: "stock", code: "sold_marker_malformed", reference: String(key.name).slice(prefix.length) })
        );
        continue;
      }
      if (meta.at >= since) total += meta.qty;
    }
    if (page.list_complete) return total;
    if (!page.cursor) throw new Error("KV list is incomplete and gave no cursor");
    cursor = page.cursor;
  }
}

/**
 * What a buyer can still be sold of a product, never below 0.
 *
 * Nothing is listed for a product whose figure is already 0: it is sold out
 * whatever the markers say, and a sold-out page must not depend on KV being up.
 *
 * `stockCountedAt` that is absent or not a timestamp counts every sale there is.
 * That is the cautious direction: it sells less, never more. The build refuses
 * such a product (src/lib/products.ts), so this is the second line, not the first.
 *
 * @param kv       the ORDERS binding
 * @param product  a catalogue entry: { slug, stock, stockCountedAt }
 */
export async function remaining(kv, product) {
  if (!(product.stock > 0)) return 0;
  const counted = typeof product.stockCountedAt === "string" ? Date.parse(product.stockCountedAt) : NaN;
  const since = Number.isNaN(counted) ? 0 : counted;
  return Math.max(0, product.stock - (await soldSince(kv, product.slug, since)));
}
