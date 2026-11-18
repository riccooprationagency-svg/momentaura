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

export const AUDIENCES = ["men", "women"] as const;
export type Audience = (typeof AUDIENCES)[number];

export interface Product {
  slug: string;
  name: string;
  category: string;
  /** Who a listing page may say a product is for. Explicit, never inferred from
   *  a name; [] means it appears on neither audience page. */
  audience: Audience[];
  price: number;
  material: string | null;
  fabricWeight: string | null;
  fit: string | null;
  printMethod: string | null;
  leadTimeDays: number | null;
  dispatch: string | null;
  stock: number;
  /** The moment `stock` was counted, ISO 8601 with an explicit offset. Paid sales
   *  recorded at or after it are subtracted from `stock` when an order is checked
   *  (functions/api/_stock.js); earlier sales are already inside the figure.
   *  Required while stock > 0, null when stock is 0. After a recount or a restock,
   *  edit `stock` and this together. */
  stockCountedAt: string | null;
  photos: Photo[];
  /** What the entries in `photos` are. Required whenever `photos` is not empty:
   *  a "render" is shown with a disclosure line by Gallery.astro (CLAUDE.md,
   *  Rendered imagery). Sits beside `photos`, never inside it, and
   *  scripts/images.mjs never writes it. */
  photoKind?: "photograph" | "render";
  sizes: Size[];
  runSize?: number;
  runRemaining?: number;
  /** Optional and absent from the data, like the run fields above. No product
   *  has description copy yet, and the product page omits the paragraph rather
   *  than stubbing it. Add the key to a product when the copy is written. */
  description?: string | null;
  /** On order and never held. Display only: it changes what a stock 0 product
   *  says, never whether it can be ordered (the server refuses stock 0 either
   *  way). Allowed only when stock is 0. `by` is the expected arrival, an ISO
   *  date, or null when nobody can say. */
  incoming?: { by: string | null };
}

export const products = data as Product[];

/** Today in Nairobi (EAT, UTC+3, no daylight saving), read at build. The same
 *  reading as buildDay() in campaign.ts, which imports this module and so cannot
 *  be imported here. */
const today = (): string => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** On order and never held: a third stock state, neither in stock nor sold out. */
export const isIncoming = (product: Product): boolean => product.incoming !== undefined;

/** The expected-by date, or null when there is none or it has passed. A passed
 *  date is never shown and never throws: a deploy must not break on a day nobody
 *  edited anything. The day itself still counts as not passed. */
export const incomingBy = (product: Product): string | null => {
  const by = product.incoming?.by ?? null;
  return by !== null && by >= today() ? by : null;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Monday 23 November". Parsed from the string, so no timezone moves the day. */
export const longDate = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS_LONG[m - 1]}`;
};

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

  const kinds = ["photograph", "render"];
  if (product.photos.length > 0 && !kinds.includes(product.photoKind as string)) {
    throw new Error(
      `products.json: "${product.slug}" has photos but photoKind is ${JSON.stringify(product.photoKind)}. ` +
        `Set it to "photograph" or "render" — a render is disclosed as one, and the build will not guess.`
    );
  }
  if (product.photoKind !== undefined && !kinds.includes(product.photoKind)) {
    throw new Error(`products.json: "${product.slug}" photoKind ${JSON.stringify(product.photoKind)} is not "photograph" or "render".`);
  }

  /* photoKind. A render shown without its disclosure is a banned dishonest
     photograph, so a product with photos must say which kind they are, and the
     build will not guess. */
  const KINDS = ["photograph", "render"];
  if (product.photos.length > 0 && !KINDS.includes(product.photoKind as string)) {
    throw new Error(
      `products.json: "${product.slug}" has photos but photoKind is ${JSON.stringify(product.photoKind)}. ` +
        `Set it to "photograph" or "render".`
    );
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

  /* stockCountedAt. A sales count only means something relative to a stock count,
     so a product that can be sold says when its figure was true. The offset is
     required: a timestamp without one means a different instant in every zone
     that parses it, and a count whose moment moves is not a count. It cannot be
     in the future, because a sale recorded "after" a count that has not happened
     yet would never be subtracted. A product at 0 has no count to date. */
  if (!Number.isInteger(product.stock) || product.stock < 0) {
    throw new Error(`products.json: "${product.slug}" stock is ${JSON.stringify(product.stock)} — a whole number, 0 or more.`);
  }
  if (product.stock === 0) {
    if (product.stockCountedAt !== null) {
      throw new Error(`products.json: "${product.slug}" has stock 0, so "stockCountedAt" must be null, not ${JSON.stringify(product.stockCountedAt)}.`);
    }
  } else {
    const at = product.stockCountedAt;
    if (typeof at !== "string") {
      throw new Error(`products.json: "${product.slug}" has stock ${product.stock} and needs "stockCountedAt": an ISO 8601 timestamp with an offset, like 2026-11-17T19:42:00+03:00.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(at)) {
      throw new Error(`products.json: "${product.slug}" stockCountedAt is ${JSON.stringify(at)} — it needs a date, a time and an explicit offset (offset missing or malformed), like 2026-11-17T19:42:00+03:00.`);
    }
    const instant = Date.parse(at);
    if (Number.isNaN(instant)) {
      throw new Error(`products.json: "${product.slug}" stockCountedAt is ${JSON.stringify(at)}, which is not a real moment.`);
    }
    if (instant > Date.now()) {
      throw new Error(`products.json: "${product.slug}" stockCountedAt is ${JSON.stringify(at)}, which is in the future.`);
    }
  }

  /* incoming. Only a product we hold none of can be "not in stock yet", and the
     date is a real calendar day or null. A date that has passed is not an error
     here: incomingBy() just stops showing it. */
  if (product.incoming !== undefined) {
    const inc = product.incoming as { by?: unknown } | null;
    if (inc === null || typeof inc !== "object" || Array.isArray(inc) || !("by" in inc)) {
      throw new Error(`products.json: "${product.slug}" incoming must be { "by": null } or { "by": "YYYY-MM-DD" }.`);
    }
    if (product.stock !== 0) {
      throw new Error(`products.json: "${product.slug}" has "incoming" but stock ${product.stock}. "incoming" is allowed only when stock is 0.`);
    }
    const by = inc.by;
    if (by !== null) {
      const m = typeof by === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(by) : null;
      const real = m !== null && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === by;
      if (!real) {
        throw new Error(`products.json: "${product.slug}" incoming.by is ${JSON.stringify(by)} — null or a real ISO date like 2026-11-23.`);
      }
    }
  }

  /* Audience is explicit like sizes: an absent key is an error, [] is a valid
     answer, and anything but a de-duplicated list of the two known strings
     fails by slug. */
  if (!Array.isArray(product.audience)) {
    throw new Error(`products.json: "${product.slug}" has no audience array. Use [] for none.`);
  }
  const seen = new Set<string>();
  for (const a of product.audience) {
    if (!(AUDIENCES as readonly unknown[]).includes(a)) {
      throw new Error(`products.json: "${product.slug}" audience holds ${JSON.stringify(a)} — only "men" and "women" are allowed.`);
    }
    if (seen.has(a)) throw new Error(`products.json: "${product.slug}" audience repeats "${a}".`);
    seen.add(a);
  }

  /* Material is explicit like fabricWeight: null, or a non-empty string. An absent
     key is an error, so a product added by hand cannot silently skip the row. */
  if (!("material" in product) || !(product.material === null || (typeof product.material === "string" && product.material.trim() !== ""))) {
    throw new Error(`products.json: "${product.slug}" needs "material": null or a non-empty string.`);
  }

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

/* ---------- what is listed ----------
 *
 * A product is LISTED when it has at least one photograph, and nothing else
 * decides it. Every surface that offers products to browse reads `listed`, never
 * `products`: category tiles and pages, audience pages, the campaign page, the
 * homepage reveals, related items and the sitemap. A kraft block in a grid is an
 * empty slot, and an empty slot on a shop whose buyer arrives suspicious reads
 * as a shop with nothing to sell.
 *
 * Listing is not existence. Every product still builds /products/<slug>, so a
 * direct link works and stays buyable; the catalogue the server re-prices from,
 * /order, the cart and everything under functions/ read `products` in full. When
 * a real photograph goes through scripts/images.mjs the product lists itself.
 * There is no flag to set, so there is none to forget to clear.
 *
 * Derived from photos.length for the reason systemFor() is: the loop above has
 * already thrown on any entry that is not a real photograph, so a count is safe.
 */
export const isListed = (product: Product): boolean => product.photos.length > 0;

export const listed: Product[] = products.filter(isListed);

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

/* Every category in the data must be declared, listed or not, so a typo in an
 * unlisted product's category fails the build now rather than the day it lists. */
const declared = new Set(products.map((p) => p.category));
/* A category exists only while it holds a listed product. */
const present = new Set(listed.map((p) => p.category));

/* A category in the data with no entry above fails the build rather than
 * rendering a page headed by its own slug with nothing under it. That page would
 * ship — no gate reads copy — and it would be the worst page on the site. */
/* Object.hasOwn, not `in`. `in` walks the prototype chain, so a category named
 * "toString" or "constructor" would satisfy the guard, reach the lookup below,
 * and hand a function to a page expecting a name — a confusing crash somewhere
 * downstream instead of the deliberate error this loop exists to raise. It also
 * matches Object.entries in the filter underneath, which enumerates own keys
 * only, so the guard and the thing it guards now agree about what a key is. */
for (const slug of declared) {
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

/* The two vocabularies share a URL space only if they never collide: /men is a
 * category page, /for/men an audience page, and a category called "men" would
 * make the name mean two things. */
for (const slug of Object.keys(CATEGORY_COPY)) {
  if ((AUDIENCES as readonly string[]).includes(slug)) {
    throw new Error(`CATEGORY_COPY key "${slug}" is also an audience. The two vocabularies must never collide.`);
  }
}

/* /black-november is a page of its own at the root, beside [category].astro. A
 * category with that slug would be two routes for one address. Astro prefers the
 * static one, so the category's page would vanish without an error. */
if (Object.hasOwn(CATEGORY_COPY, "black-november")) {
  throw new Error(`CATEGORY_COPY key "black-november" is the campaign page's address. A category cannot take it.`);
}

/** Listed products for an audience, in catalogue order. */
export const productsFor = (audience: Audience): Product[] =>
  listed.filter((p) => p.audience.includes(audience));

/** Audiences that have a page: only those with at least one product. */
export const audiencesWithPages = (): Audience[] =>
  AUDIENCES.filter((a) => productsFor(a).length > 0);

/** Listed products in a category, in catalogue order. */
export const productsIn = (category: string): Product[] =>
  listed.filter((p) => p.category === category);

/** The first listed product in a category, or undefined when there is none. */
export const firstIn = (category: string): Product | undefined => productsIn(category)[0];

/** Related items (listed only): same category, never the product itself, never padded from
 *  another category. Fewer than the ceiling is a true answer. */
export const relatedTo = (product: Product, limit = 4): Product[] =>
  productsIn(product.category)
    .filter((p) => p.slug !== product.slug)
    .slice(0, limit);
