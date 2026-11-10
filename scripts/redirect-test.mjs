#!/usr/bin/env node
/* Exercises functions/_middleware.js — the 301 from the production .pages.dev
 * host to the canonical domain.
 *
 * functions/ sits outside the Astro build, so no other gate loads this file.
 * The properties worth a gate are the two exemptions, because both are
 * invisible when they work and expensive when they break: a preview host that
 * starts redirecting makes every pull request unreviewable, and an /api/ path
 * that starts redirecting is an M-Pesa callback that never settles a payment
 * that really arrived.
 *
 * The middleware is the shipped file, imported as it is. Only next() is
 * substituted, so a pass-through is visible as the sentinel it returns.
 *
 *   node scripts/redirect-test.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { onRequest, PRODUCTION_PAGES_HOST } = await import(
  pathToFileURL(join(ROOT, "functions", "_middleware.js")).href
);
const site = JSON.parse(readFileSync(join(ROOT, "src", "data", "site.json"), "utf8"));
const CANONICAL = site.url.replace(/\/+$/, "");

const PASSED = new Response("next", { status: 299 });

const run = (url, method = "GET") =>
  onRequest({ request: new Request(url, { method, body: method === "POST" ? "{}" : undefined }), next: async () => PASSED });

let failed = 0;
let passed = 0;
const check = (ok, label, detail = "") => {
  if (ok) {
    passed++;
    console.log(`  pass  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
};

const redirects = async (label, from, to, method = "GET") => {
  const res = await run(from, method);
  const location = res.headers.get("Location");
  check(
    res.status === 301 && location === to && res.headers.get("X-Robots-Tag") === "noindex, nofollow",
    label,
    `got ${res.status} ${location ?? ""} robots=${res.headers.get("X-Robots-Tag")}`
  );
};

const passes = async (label, url, method = "GET") => {
  const res = await run(url, method);
  check(res === PASSED, label, `got ${res.status} ${res.headers.get("Location") ?? ""}`);
};

console.log("\n  _middleware.js — production .pages.dev to the canonical domain\n");

const prod = `https://${PRODUCTION_PAGES_HOST}`;

check(CANONICAL === "https://momentaurastores.co.ke", "the canonical origin is read from site.json", CANONICAL);

await redirects("the production host 301s, path and query preserved",
  `${prod}/products/crew-tee?ref=wa&x=1`, `${CANONICAL}/products/crew-tee?ref=wa&x=1`);
await redirects("the root redirects to the canonical root", `${prod}/`, `${CANONICAL}/`);
await redirects("a HEAD redirects the same way", `${prod}/contact`, `${CANONICAL}/contact`, "HEAD");
await redirects("an unknown path still redirects, and 404s on the canonical host",
  `${prod}/anything`, `${CANONICAL}/anything`);
await redirects("a path that merely starts with 'api' is not exempt", `${prod}/apiary`, `${CANONICAL}/apiary`);

await passes("A HASH PREVIEW HOST IS NEVER REDIRECTED", `https://3f9c2a1b.${PRODUCTION_PAGES_HOST}/contact`);
await passes("A BRANCH PREVIEW HOST IS NEVER REDIRECTED", `https://phase-2-domain-crawl.${PRODUCTION_PAGES_HOST}/`);
await passes("the canonical host is served, not redirected to itself", `${CANONICAL}/contact`);
await passes("a lookalike host ending in the production name is not matched",
  `https://${PRODUCTION_PAGES_HOST}.example.com/`);

await passes("THE M-PESA CALLBACK ON THE pages.dev HOST IS NEVER REDIRECTED",
  `${prod}/api/mpesa/callback/token`, "POST");
await passes("the STK push endpoint is never redirected", `${prod}/api/mpesa/stk`, "POST");
await passes("a GET under /api/ is never redirected either", `${prod}/api/track`);
await passes("a POST outside /api/ is not redirected into losing its body", `${prod}/contact`, "POST");

console.log(`\n  ${failed ? `${failed} FAILED, ` : ""}${passed} checks pass.\n`);
process.exit(failed ? 1 : 0);
