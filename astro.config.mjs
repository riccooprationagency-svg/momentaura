import { defineConfig } from "astro/config";
import site from "./src/data/site.json" with { type: "json" };

// Static output. No integrations, and none are expected — cart is the only
// client-side JS in the whole project and it ships as a plain module.
//
// `site` comes from src/data/site.json, which is where every fact about the shop
// itself lives and where each one stays null until a real one exists. It is null
// today, so Astro.site is undefined, and the canonical link, Open Graph tags,
// sitemap and robots.txt all omit themselves rather than emit a hostname nobody
// has registered. Set src/data/site.json's `url` and the four appear together.
//
// A sitemap integration is not used, and not because of the dependency rule
// alone: the sitemap is eleven lines of an endpoint that reads the same route
// data the pages are generated from, and verify.mjs V13 asserts it against what
// is actually in dist/. An integration would be a dependency plus a second thing
// to trust, in place of a gate.

// Astro names a hoisted script after the .astro file that carried the tag, so
// the cart shipped as Base.astro_astro_type_script_index_0_lang.<hash>.js — a
// name that records which template held the tag and says nothing about what the
// file is. verify.mjs V4 asserts the name, and asserting that string would
// really be asserting "the one file Astro happened to emit", which is a weaker
// claim and breaks the day Astro changes its convention.
//
// Astro passes its own entryFileNames in the config it hands Vite, after user
// config is merged, so setting it under vite.build.rollupOptions does nothing.
// This wraps the resolved value instead, at the last hook before rollup reads
// it, and delegates every chunk it does not claim.
//
// The discriminator is the module id, not the build: client scripts are bundled
// during Astro's SSR pass alongside the prerender entry, so build.ssr cannot
// tell them apart. A facadeModuleId carrying `astro&type=script` is a <script>
// from a template and nothing else.
//
// Every such chunk gets the same name, deliberately. There is exactly one
// script on this site and that is the rule, not the current state — a second
// one would collide on the name and fail the build loudly, which is the right
// outcome for the constraint CLAUDE.md states as "if a feature needs a second
// script, it does not ship".
const CART_NAME = "_astro/cart.[hash].js";

const nameTheCart = {
  name: "momentaura:name-the-cart",
  enforce: "post",
  configResolved(config) {
    const output = config.build.rollupOptions.output;
    for (const o of Array.isArray(output) ? output : output ? [output] : []) {
      const fallback = o.entryFileNames;
      o.entryFileNames = (chunk) => {
        if (chunk.facadeModuleId && chunk.facadeModuleId.includes("astro&type=script")) {
          return CART_NAME;
        }
        return typeof fallback === "function" ? fallback(chunk) : fallback;
      };
    }
  },
};

export default defineConfig({
  output: "static",
  integrations: [],

  // Undefined rather than null: Astro validates this as a URL when it is set,
  // and null is not one.
  site: site.url ?? undefined,

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

  vite: {
    build: {
      // The cart is the only script the site emits, and verify.mjs V4 asserts
      // its name. Astro's default is hoisted.<hash>.js, which says nothing
      // about what it is — a gate matching that name would be matching "the
      // one file Astro happened to produce" rather than "the cart". Naming it
      // makes the assertion mean something, and makes a second entry chunk
      // appearing in dist/ obvious rather than something to be counted.
      //
      // The hash stays: it is the cache key, and this file is loaded from
      // every page on a site whose traffic arrives cold on metered data.
      // Astro inlines a hoisted script whose bundled size falls under this
      // limit, which put a copy of the cart into all ten pages and left dist/
      // with no .js file at all. Zero forces it out to a file it can be named
      // by, cached across the several product pages a buyer opens in one
      // session, and weighed once instead of ten times.
      //
      // The stylesheet is a different trade and stays inline: it is
      // render-blocking, so its round trip lands on first paint. This script is
      // type="module" and then deferred again behind requestIdleCallback, so
      // its round trip lands on nothing.
      assetsInlineLimit: 0,

    },
    plugins: [nameTheCart],
  },
});
