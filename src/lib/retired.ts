import data from "../data/retired.json";
import { products } from "./products";

/* Products that were sold and have left the catalogue, kept so that an order
 * already placed for one still names it. A paid order is a money record and
 * stays in KV with the slug it was placed under; /track and /order-received
 * build their hidden order lines from products.json, so without this a retired
 * line has no row to fill and the buyer sees a total with nothing under it.
 *
 * DISPLAY ONLY. These rows exist on those two pages and nowhere else, carry no
 * stock and no lead time, are never listed, linked or sitemapped, and the
 * server still refuses them: _order.js prices from products.json alone.
 * Name and price are what the order was placed at. */
export interface Retired {
  slug: string;
  name: string;
  price: number;
}

export const retired: Retired[] = data;

const seen = new Set<string>();
for (const r of retired) {
  if (typeof r.slug !== "string" || !r.slug || typeof r.name !== "string" || !r.name || !Number.isInteger(r.price) || r.price < 1) {
    throw new Error(`retired.json: ${JSON.stringify(r)} needs a slug, a name and an integer price.`);
  }
  if (seen.has(r.slug)) throw new Error(`retired.json: "${r.slug}" is listed twice.`);
  seen.add(r.slug);
  if (products.some((p) => p.slug === r.slug)) {
    throw new Error(`retired.json: "${r.slug}" is in products.json, so it is not retired. Remove it from one of them.`);
  }
}
