import { defineConfig } from "astro/config";

// Static output. No integrations, and none are expected — cart is the only
// client-side JS in the whole project and it ships as a plain module.
// `site` is set at step 11, once the domain exists, for sitemap and Open Graph.

export default defineConfig({
  output: "static",
  integrations: [],

  build: {
    // Inline the stylesheet rather than shipping it as a separate request.
    // Most traffic arrives cold on a single page from a WhatsApp link, so
    // there is no second page to amortise a cached stylesheet over, and a
    // render-blocking round trip lands on the highest-attrition moment on
    // the site.
    //
    // REVERSAL CONDITION: switch back to "auto" once the stylesheet passes
    // roughly 20KB. Past that, the per-page cost of inlining on every page
    // outweighs the one round trip it saves. Measure, do not estimate.
    inlineStylesheets: "always",
  },
});
