import data from "../data/products.json";

export interface Product {
  slug: string;
  name: string;
  category: string;
  price: number;
  fabricWeight: string | null;
  fit: string | null;
  printMethod: string | null;
  leadTimeDays: number | null;
  dispatch: string | null;
  stock: number;
  photo: string | null;
  sizes: string[];
  runSize?: number;
  runRemaining?: number;
  /** Optional and absent from the data, like the run fields above. No product
   *  has description copy yet, and the product page omits the paragraph rather
   *  than stubbing it. Add the key to a product when the copy is written. */
  description?: string | null;
}

export const products = data as Product[];

/**
 * The two-system rule, derived and never stored. A stored flag drifts out of
 * sync with reality, which is the failure the rule exists to prevent.
 *
 * Deliberately not `photo !== null`. An empty string, an undefined key or a
 * whitespace path are all falsy-in-spirit but pass a null check, and each one
 * would render a product dark over a placeholder — the one combination
 * CLAUDE.md forbids outright. Anything that is not a real path renders light.
 */
export const systemFor = (product: Product): "dark" | "light" =>
  typeof product.photo === "string" && product.photo.trim() !== "" ? "dark" : "light";

/** Integer KSh in the data, formatted only at the edge. */
export const price = (value: number): string => `KSh ${value.toLocaleString("en-KE")}`;

/* ---------- categories ----------
 *
 * Which categories exist is derived from products.json. What they are called and
 * the one line under each heading are declared here, because neither is derivable
 * from a slug and neither should be invented at render time.
 *
 * The lines name what a category actually holds and nothing else. No process
 * claim, no material claim, no adjective: "printed in Nairobi" and "cut from
 * heavyweight cotton" are unverifiable from here, and an unverifiable line under
 * a heading is the vagueness the whole system exists to remove.
 *
 * They are not claims a reader can tick off against the grid, and the earlier
 * version of this comment said they were. "Pendants." sits above one pendant.
 * That is ordinary English — a category names a kind of thing, not a count, and
 * renaming it per item would be worse — but it is a category label, not a
 * checkable fact, and calling it checkable is the kind of overstatement the
 * accent rule exists to prevent elsewhere.
 *
 * Declared order, derived membership. The order is the order of the keys below —
 * apparel first because it is the fullest category, which alphabetising would
 * bury behind a category holding one pendant. Membership comes from the data, so
 * a category that empties out loses its page and its tile together.
 */

interface CategoryCopy {
  name: string;
  line: string;
}

const CATEGORY_COPY: Record<string, CategoryCopy> = {
  apparel: { name: "Apparel", line: "Hoodies, tees and hats." },
  personalised: { name: "Personalised", line: "Your own text or artwork, on a hoodie." },
  accessories: { name: "Accessories", line: "Pendants." },
};

export interface Category extends CategoryCopy {
  slug: string;
}

const present = new Set(products.map((p) => p.category));

/* A category in the data with no entry above fails the build rather than
 * rendering a page headed by its own slug with nothing under it. That page would
 * ship — no gate reads copy — and it would be the worst page on the site. */
/* Object.hasOwn, not `in`. `in` walks the prototype chain, so a category named
 * "toString" or "constructor" would satisfy the guard, reach the lookup below,
 * and hand a function to a page expecting a name — a confusing crash somewhere
 * downstream instead of the deliberate error this loop exists to raise. It also
 * matches Object.entries in the filter underneath, which enumerates own keys
 * only, so the guard and the thing it guards now agree about what a key is. */
for (const slug of present) {
  if (!Object.hasOwn(CATEGORY_COPY, slug)) {
    throw new Error(
      `products.json carries category "${slug}" with no entry in CATEGORY_COPY ` +
        `in src/lib/products.ts. Add a display name and a one-line description.`
    );
  }
}

export const categories: Category[] = Object.entries(CATEGORY_COPY)
  .filter(([slug]) => present.has(slug))
  .map(([slug, copy]) => ({ slug, ...copy }));

export const productsIn = (category: string): Product[] =>
  products.filter((p) => p.category === category);

/** Related items: same category, never the product itself, never padded from
 *  another category. Fewer than the ceiling is a true answer. */
export const relatedTo = (product: Product, limit = 3): Product[] =>
  productsIn(product.category)
    .filter((p) => p.slug !== product.slug)
    .slice(0, limit);
