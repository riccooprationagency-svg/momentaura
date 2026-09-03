/* The sitemap, generated from the same data the routes are.
 *
 * NOT AN INTEGRATION. @astrojs/sitemap would be a dependency and, more to the
 * point, a second thing to trust: it would walk its own idea of the route table
 * and this file would have nothing to say about what it found. Here the routes
 * come from the two lists that generate them — products.json by way of lib/
 * products, and the static pages named below — and verify.mjs V13 asserts the
 * built sitemap against the HTML actually in dist/. The gate is what makes it
 * correct; this only has to be reasonable.
 *
 * WHAT IS DELIBERATELY NOT IN IT. A sitemap is a statement that a URL is worth
 * indexing, so the three pages that are steps in a transaction are absent:
 *
 *   /checkout        a form with nothing to read, meaningless without a basket
 *   /order           the same, and it renders every product hidden
 *   /order-received  one buyer's confirmation. It carries an order reference,
 *                    and a reference is the secret that opens an order on
 *                    /track — inviting a crawler to it is the one entry here
 *                    that would be a security mistake rather than a tidiness one
 *
 * /track stays in. It is a real page a buyer looks for by name, it holds no
 * order until someone types one, and a shop whose tracking page cannot be found
 * by searching for it is a shop that looks like it has no tracking page.
 *
 * IT EMITS NOTHING UNTIL THE DOMAIN IS REAL. Sitemap URLs are absolute by
 * specification — there is no relative form — so with site.url null there is no
 * honest sitemap to write. An empty <urlset> is the correct empty answer: it
 * says "nothing to index yet" rather than naming a host nobody has registered.
 */

import type { APIRoute } from "astro";
import { categories, products } from "../lib/products";
import { origin } from "../lib/site";

/* Named, not globbed. A glob over src/pages would sweep in the transactional
   pages above and this endpoint itself, so the exclusions would have to be
   written out anyway — and an exclusion list that is wrong fails open, into
   publishing a page, while an inclusion list that is wrong fails closed, into
   omitting one. V13 catches either. */
const STATIC = ["/", "/about", "/contact", "/delivery", "/privacy", "/track"];

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const GET: APIRoute = () => {
  const base = origin();

  const paths = base === null
    ? []
    : [
        ...STATIC,
        ...categories.map((category) => `/${category.slug}`),
        ...products.map((product) => `/products/${product.slug}`),
      ];

  /* No <lastmod>, <changefreq> or <priority>. Every one of them would be a
     figure invented to fill a field — the same thing the capacity notice is
     forbidden from doing — and Google ignores the last two outright. */
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((path) => `  <url><loc>${escape(base + path)}</loc></url>\n`).join("") +
    `</urlset>\n`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
