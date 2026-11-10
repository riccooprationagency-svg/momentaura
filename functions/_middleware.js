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
 * cannot point somewhere the pages do not. With that value null or not a URL
 * the pages omit every absolute URL, and this file does the same: it builds
 * nothing at import time and passes every request through. A middleware that
 * threw on load would take the whole site down, /api/ included, over a
 * missing config value.
 *
 * COST. With this file present, Pages runs Functions in front of every request
 * rather than only /api/*. For every host but the one below, that is a hostname
 * comparison and next() — the static file is served exactly as before, with
 * public/_headers applied, X-Robots-Tag included.
 */

/* A bare JSON import, with no `with { type: "json" }` attribute, and the same
   form functions/api/_order.js and track.js use for products.json. Pages
   compiles Functions with an esbuild that predates import attributes (wrangler
   3's 0.17.19 fails with: Expected ";" but found "with"), so the attribute
   broke the deploy while every local gate passed. The tests substitute this
   line rather than importing the file raw, as they do for the catalogue. */
import site from "../src/data/site.json";

export const PRODUCTION_PAGES_HOST = "momentaura.pages.dev";

/* The canonical origin, or null. Never throws at load: a null or malformed
   site.url leaves this null rather than escaping as an exception. try/catch
   rather than URL.canParse, which not every Workers compatibility date has. */
const CANONICAL_ORIGIN = (() => {
  if (typeof site.url !== "string") return null;
  try {
    return new URL(site.url).origin;
  } catch {
    return null;
  }
})();

export async function onRequest(context) {
  if (CANONICAL_ORIGIN === null) return context.next();

  const { request } = context;
  const url = new URL(request.url);

  const redirect =
    url.hostname === PRODUCTION_PAGES_HOST &&
    (request.method === "GET" || request.method === "HEAD") &&
    url.pathname !== "/api" &&
    !url.pathname.startsWith("/api/");

  if (!redirect) return context.next();

  /* Path and query preserved; only scheme, host and port change.
     The host is FIXED FIRST and the path is assigned to it, never parsed
     against it. new URL(path, base) reads a path beginning "//" (or "///",
     or "/\" which the parser normalises to "//") as a scheme-relative URL and
     takes its host from the path, so https://momentaura.pages.dev//attacker.example
     would have 301'd to attacker.example: an open redirect that starts with
     the shop's own address. Assigning .pathname cannot change the host, so
     the worst a hostile path can do is land on a 404 here.
     scripts/redirect-test.mjs asserts the origin of every Location. */
  const target = new URL(CANONICAL_ORIGIN);
  target.pathname = url.pathname;
  target.search = url.search;

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
