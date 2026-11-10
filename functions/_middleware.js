/* The production .pages.dev host answers with a 301 to the canonical domain.
 *
 * The same build is served on momentaura.pages.dev and on the custom domain.
 * Two hosts carrying identical pages split every link, every share and every
 * WhatsApp preview between them, and a buyer who checks the address bar sees a
 * hosting company's name where the shop's should be. One address, everywhere.
 *
 * WHY HERE AND NOT IN _redirects. Pages' _redirects matches paths only; it
 * cannot see the hostname, so it cannot tell the production host from the
 * custom domain serving the same files. A Function can.
 *
 * WHAT IS NOT REDIRECTED, and each is deliberate:
 *
 *   - PREVIEW HOSTS. <hash>.momentaura.pages.dev and <branch>.momentaura.pages.dev
 *     are where a pull request is reviewed before it reaches anyone. The match
 *     below is the exact production hostname, so a subdomain never equals it.
 *
 *   - /api/*. MPESA_CALLBACK_ORIGIN may hold the .pages.dev URL (BUILD-ORDER
 *     section 11: Daraja go-live needed a live HTTPS host before the domain
 *     was connected). Safaricom POSTs the payment result there, and does not
 *     follow redirects. A 301 on that path is an order whose money arrived and
 *     whose callback never settled it. The money path is left exactly as it
 *     was: same host, same handler, no extra hop.
 *
 *   - ANYTHING BUT GET AND HEAD. A 301 on a POST is answered by most clients
 *     with a GET to the new address, which silently drops the body. Nothing
 *     outside /api/ takes a POST today, and if something ever does, it is not
 *     redirected into losing its body.
 *
 * The canonical origin is read from src/data/site.json, the same value that
 * drives the canonical link, og:url, the sitemap and robots.txt, so this file
 * cannot point somewhere the pages do not.
 *
 * COST. With this file present, Pages runs Functions in front of every request
 * rather than only /api/*. For every host but the one below, that is a hostname
 * comparison and next() — the static file is served exactly as before, with
 * public/_headers applied, X-Robots-Tag included.
 */

import site from "../src/data/site.json" with { type: "json" };

export const PRODUCTION_PAGES_HOST = "momentaura.pages.dev";

const canonical = new URL(site.url);

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const redirect =
    url.hostname === PRODUCTION_PAGES_HOST &&
    (request.method === "GET" || request.method === "HEAD") &&
    url.pathname !== "/api" &&
    !url.pathname.startsWith("/api/");

  if (!redirect) return context.next();

  /* Path and query preserved; only scheme, host and port change. */
  const target = new URL(url.pathname + url.search, canonical.origin);

  return new Response(null, {
    status: 301,
    headers: {
      Location: target.toString(),
      /* public/_headers applies to static files, not to a response a Function
         builds, so the redirect states the same noindex itself rather than
         being the one response on the site without it. Same value, verbatim. */
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
