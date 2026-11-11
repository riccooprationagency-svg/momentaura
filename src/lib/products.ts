import data from "../data/products.json";

/**
 * One photograph, at one 3:4 crop, in the sizes scripts/images.mjs emits.
 *
 * `src` names the 800px WebP — the rendition an <img> falls back to when no
 * <source> matches. Gallery.astro derives every other URL from it by pattern,
 * so the data records one path rather than six and cannot record five that
 * agree and one that does not.
 *
 * `width` and `height` are the real pixel dimensions of that 800px rendition,
 * read back off the encoded file rather than assumed from the requested width.
 * They are what stops the page reflowing when the image lands, which is why
 * they live in the data and not in a component: a component can only guess.
 *
 * `alt` is written by a person. The script refuses to mint one, because the
 * only alt text it could invent is the product name, which the heading beside
 * the image already says.
 */
export interface Photo {
  src: string;
  alt: string;
  width: number;
  height: number;
}

/**
 * One size a product is made in, as Ric supplies it. Nothing here is a default.
 *
 * `sizes: []` means the product is ordered without one — a pendant, a one-size
 * hat, or a garment whose sizes have not been supplied yet. Every product is
 * [] today, because no size data has been given, and an invented S/M/L would
 * be a claim about stock that does not exist.
 *
 * The label is what the buyer picks and what the order records. The two
 * measurements are flat garment measurements in centimetres, null until
 * measured. The size chart renders only when EVERY size has both: a chart with
 * gaps asks the buyer to guess the missing row, which is the guess a chart is
 * there to remove.
 *
 * functions/api/_order.js reads the same labels from products.json and refuses
 * an order line whose size is not one of them.
 */
export interface Size {
  label: string;
  chestCm: number | null;
  lengthCm: number | null;
}

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
  photos: Photo[];
  sizes: Size[];
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
 * A count, and nothing cleverer. It can be a count because the loop below has
 * already thrown on anything that is not a real photograph: the old single-photo
 * version had to write `typeof photo === "string" && photo.trim() !== ""` here,
 * because an empty string or a whitespace path passed a null check and rendered
 * a product dark over a placeholder — the one combination CLAUDE.md forbids
 * outright. Validating once at module load is the same guarantee in a place
 * where it can say what is wrong, instead of at every call site where it can
 * only fail quietly toward light.
 */
export const systemFor = (product: Product): "dark" | "light" =>
  product.photos.length > 0 ? "dark" : "light";

/* ---------- the photos array is checked once, at module load ----------
 *
 * systemFor() reads photos.length. That is only safe if length is honest, so
 * every entry is checked here rather than defended against everywhere it is
 * read. An array holding one malformed entry has length 1, renders the product
 * dark, and puts a broken image where a photograph should be — on a page whose
 * entire job is to look like a shop that works.
 *
 * It throws rather than filtering. A silently dropped photograph is a product
 * that quietly renders light with a kraft block while products.json says it has
 * photography, and nobody finds out until a buyer does. The build stopping is
 * the cheap version of that discovery.
 *
 * Same shape as the CATEGORY_COPY guard below: read the data once, fail loudly
 * at build time, and let every caller downstream assume the invariant.
 */
for (const product of products) {
  if (!Array.isArray(product.photos)) {
    throw new Error(`products.json: "${product.slug}" has no photos array. Use [] for none.`);
  }

  product.photos.forEach((photo, i) => {
    const where = `products.json: "${product.slug}" photos[${i}]`;

    if (typeof photo?.src !== "string" || photo.src.trim() === "") {
      throw new Error(`${where} has no src. Run scripts/images.mjs; never hand-edit this array.`);
    }
    if (!photo.src.startsWith("/img/")) {
      throw new Error(`${where} src is "${photo.src}" — every photograph is served from /img/.`);
    }
    if (typeof photo.alt !== "string" || photo.alt.trim() === "") {
      throw new Error(
        `${where} has no alt text. It says what the photograph shows; the heading ` +
          `beside it already says the product name.`
      );
    }
    if (!Number.isInteger(photo.width) || !Number.isInteger(photo.height) || photo.width < 1 || photo.height < 1) {
      throw new Error(
        `${where} has no real dimensions (${photo.width}x${photo.height}). Explicit width ` +
          `and height are what stop the page reflowing when the image lands.`
      );
    }
  });

  /* Sizes. The label is posted by the checkout form and matched exactly by the
     server, so it is held to a short, printable string; a duplicate would make
     two options that the order cannot tell apart. */
  if (!Array.isArray(product.sizes)) {
    throw new Error(`products.json: "${product.slug}" has no sizes array. Use [] for none.`);
  }
  const labels = new Set<string>();
  product.sizes.forEach((size, i) => {
    const where = `products.json: "${product.slug}" sizes[${i}]`;
    const label = size?.label;
    if (typeof label !== "string" || !/^[\w .\/-]{1,20}$/.test(label) || label.trim() !== label) {
      throw new Error(`${where} needs a label of 1 to 20 letters, digits, spaces, dots, slashes or dashes.`);
    }
    if (labels.has(label)) throw new Error(`${where} repeats the label "${label}".`);
    labels.add(label);
    for (const key of ["chestCm", "lengthCm"] as const) {
      const cm = size[key];
      if (cm !== null && !(typeof cm === "number" && Number.isFinite(cm) && cm > 0)) {
        throw new Error(`${where} ${key} is ${JSON.stringify(cm)} — a measurement in cm, or null until measured.`);
      }
    }
  });
}

/** The size chart's rows, or null unless every size has both measurements. */
export const sizeChart = (product: Product): Size[] | null =>
  product.sizes.length > 0 && product.sizes.every((s) => s.chestCm !== null && s.lengthCm !== null)
    ? product.sizes
    : null;

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
 * Declared order, derived membership. The order is the order of the keys below,
 * which is the order Ric gave the six categories in — not alphabetical. Membership
 * comes from the data, so a category with no products has no page and no tile,
 * and gets both the moment a product names it. Nothing is scaffolded for an
 * empty category: a page holding nothing is a dead end with a link to it.
 *
 * `accessories` is not one of the six. It is kept, last, because the bullet
 * pendant needs a home and Ric's list does not name one for it. It is an open
 * question, not a decision: when the pendant's category is settled, move the
 * product and delete this entry.
 */

interface CategoryCopy {
  name: string;
  line: string;
}

const CATEGORY_COPY: Record<string, CategoryCopy> = {
  hoodies: { name: "Hoodies", line: "Hoodies." },
  "t-shirts": { name: "T-shirts", line: "T-shirts." },
  sweatshirts: { name: "Sweatshirts", line: "Sweatshirts." },
  tracksuits: { name: "Tracksuits", line: "Tracksuits." },
  "bucket-hats": { name: "Bucket hats", line: "Bucket hats." },
  /* No watch may carry or allude to another company's name, logo or model —
   * not on the dial, the strap, the box, in the product name or in the copy.
   * The earlier catalogue was deleted partly for brand-name and brand-alluding
   * watches. This entry declares the category; it does not put a watch on sale,
   * and it renders nothing until a product names it. */
  watches: { name: "Watches", line: "Watches." },
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
export const relatedTo = (product: Product, limit = 4): Product[] =>
  productsIn(product.category)
    .filter((p) => p.slug !== product.slug)
    .slice(0, limit);
