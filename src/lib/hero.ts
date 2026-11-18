import site from "../data/site.json";
import { products, type Product } from "./products";

/* The product whose lead photograph sits in the homepage hero, or null for none.
 *
 * The slug lives in site.json and never in a template, for the reason every
 * product reference does: a name typed into a page is a name nobody rechecks.
 * It is checked here, once, at build, in the style of campaign.ts. It throws
 * rather than falling back, so a slug that lost a letter or a product that has
 * no photograph stops the build instead of quietly shipping a hero with nothing
 * in it, or the wrong thing.
 *
 * Null is the supported way to have no hero image, and it changes nothing about
 * the hero. The image is the lead photograph (-1) and nothing else; its alt text
 * and its render disclosure come from the product, never from here.
 */
const raw = (site as unknown as { heroProduct?: unknown }).heroProduct;

const resolve = (): Product | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`site.json: "heroProduct" must be a product slug or null, not ${JSON.stringify(raw)}.`);
  }
  const product = products.find((p) => p.slug === raw);
  if (!product) throw new Error(`site.json: "heroProduct" is "${raw}", which is not in products.json.`);
  if (product.photos.length === 0) {
    throw new Error(
      `site.json: "heroProduct" is "${raw}", which has no photographs. A hero image needs at least one; use null for none.`
    );
  }
  return product;
};

export const heroProduct: Product | null = resolve();
