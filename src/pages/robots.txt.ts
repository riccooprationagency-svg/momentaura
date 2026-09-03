/* robots.txt — an endpoint rather than a file in public/, because the one line
 * that matters in it is an absolute URL and public/ cannot know the domain.
 *
 * The three transactional paths are disallowed as well as absent from the
 * sitemap. The sitemap is an invitation and this is a refusal: leaving
 * /order-received out of the sitemap does not stop a crawler that finds the URL
 * some other way, and that page is reached with an order reference in hand.
 *
 * Nothing else is blocked. A shop that hides most of itself from search is a
 * shop nobody arrives at.
 */

import type { APIRoute } from "astro";
import { absolute } from "../lib/site";

const CLOSED = ["/checkout", "/order", "/order-received"];

export const GET: APIRoute = () => {
  const sitemap = absolute("/sitemap.xml");

  const body =
    "User-agent: *\n" +
    CLOSED.map((path) => `Disallow: ${path}\n`).join("") +
    "Allow: /\n" +
    /* Omitted rather than guessed while the domain is null — a Sitemap line
       pointing at a host that is not ours is worse than no line at all. */
    (sitemap ? `\nSitemap: ${sitemap}\n` : "");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
