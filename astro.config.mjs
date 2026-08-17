import { defineConfig } from "astro/config";

// Static output. No integrations, and none are expected — cart is the only
// client-side JS in the whole project and it ships as a plain module.
// `site` is set at step 11, once the domain exists, for sitemap and Open Graph.

export default defineConfig({
  output: "static",
  integrations: [],
});
