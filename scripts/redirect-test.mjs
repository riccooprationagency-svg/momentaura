#!/usr/bin/env node
/* Exercises functions/_middleware.js — the 301 from the production .pages.dev
 * host to the canonical domain.
 *
 * functions/ sits outside the Astro build, so no other gate loads this file.
 * The properties worth a gate are the ones that are invisible when they work
 * and expensive when they break:
 *
 *   - a preview host that starts redirecting makes every pull request
 *     unreviewable
 *   - an /api/ path that starts redirecting is an M-Pesa callback that never
 *     settles a payment that really arrived
 *   - a path that can choose the redirect's host is an open redirect on the
 *     shop's own domain: a phishing link that starts with a URL the buyer
 *     trusts. So EVERY redirect below is parsed and its origin compared, not
 *     its string eyeballed — "//attacker.example" reads like a path and is a
 *     host
 *   - with site.json `url` null the middleware must load and pass everything
 *     through, the same fail-quiet the pages follow
 *
 * The middleware is the shipped file. The null-url case runs a copy of it next
 * to a site.json with `url: null` in a scratch directory — the same move
 * track-test.mjs makes for the catalogue — so the real config is never edited
 * to make a test pass. Only next() is substituted, so a pass-through is
 * visible as the sentinel it returns.
 *
 *   node scripts/redirect-test.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIDDLEWARE = join(ROOT, "functions", "_middleware.js");
const { onRequest, PRODUCTION_PAGES_HOST } = await import(pathToFileURL(MIDDLEWARE).href);
const site = JSON.parse(readFileSync(join(ROOT, "src", "data", "site.json"), "utf8"));
const CANONICAL = new URL(site.url).origin;

const PASSED = new Response("next", { status: 299 });

const runWith = (handler, url, method = "GET") =>
  handler({
    request: new Request(url, { method, body: method === "POST" ? "{}" : undefined }),
    next: async () => PASSED,
  });
const run = (url, method) => runWith(onRequest, url, method);

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

/* Every redirect, whatever else it asserts, is parsed and its origin compared
   with the canonical one. A Location string can look right and still name
   another host. */
const parseOrigin = (location) => {
  try {
    return new URL(location).origin;
  } catch {
    return `unparseable: ${location}`;
  }
};

const redirects = async (label, from, to, method = "GET") => {
  const res = await run(from, method);
  const location = res.headers.get("Location");
  check(
    res.status === 301 &&
      location === to &&
      parseOrigin(location) === CANONICAL &&
      res.headers.get("X-Robots-Tag") === "noindex, nofollow",
    label,
    `got ${res.status} ${location ?? ""} origin=${location ? parseOrigin(location) : "-"} robots=${res.headers.get("X-Robots-Tag")}`
  );
};

/* An attack path: the exact Location matters less than where it goes. It must
   still be a 301 (the production host never serves pages), it must land on the
   canonical origin, and it must not have lost the path the buyer asked for. */
const staysHome = async (label, path) => {
  const res = await run(`https://${PRODUCTION_PAGES_HOST}${path}`);
  const location = res.headers.get("Location");
  const origin = location ? parseOrigin(location) : "-";
  check(
    res.status === 301 && origin === CANONICAL && res.headers.get("X-Robots-Tag") === "noindex, nofollow",
    label,
    `got ${res.status} Location: ${location ?? ""} (origin ${origin})`
  );
  return location;
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

/* Open redirect. Each of these is a path on the production host that a URL
   parser can be talked into reading as a host. */
const ATTACKS = [
  "//attacker.example/phish",
  "///attacker.example",
  "/\\attacker.example",
  "//attacker.example@momentaurastores.co.ke",
  "/%2f%2fattacker.example",
];
const attackLocations = [];
for (const path of ATTACKS) {
  attackLocations.push([path, await staysHome(`A PATH CANNOT CHOOSE THE HOST: ${path}`, path)]);
}

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

/* Null-domain mode. A copy of the shipped middleware beside a site.json whose
   url is null, and one whose url is not a URL. Both must import without
   throwing and pass every request through. */
for (const [label, url] of [["null", null], ["not a URL", "momentaurastores dot co dot ke"]]) {
  const scratch = join(tmpdir(), `momentaura-redirect-${label.replace(/\W/g, "")}-${Date.now()}`);
  mkdirSync(join(scratch, "functions"), { recursive: true });
  mkdirSync(join(scratch, "src", "data"), { recursive: true });
  writeFileSync(join(scratch, "package.json"), '{"type":"module"}\n', "utf8");
  copyFileSync(MIDDLEWARE, join(scratch, "functions", "_middleware.js"));
  writeFileSync(join(scratch, "src", "data", "site.json"), JSON.stringify({ ...site, url }), "utf8");

  let handler = null;
  try {
    ({ onRequest: handler } = await import(pathToFileURL(join(scratch, "functions", "_middleware.js")).href));
    check(true, `with site.json url ${label}, the middleware loads without throwing`);
  } catch (error) {
    check(false, `with site.json url ${label}, the middleware loads without throwing`, String(error));
  }
  if (handler) {
    let res;
    try {
      res = await runWith(handler, `${prod}/products/crew-tee?ref=wa`);
    } catch (error) {
      res = { status: `threw ${error}` };
    }
    check(res === PASSED, `with site.json url ${label}, the production host passes through`, `got ${res.status}`);
  }
}

console.log("\n  Location for each attack path:");
for (const [path, location] of attackLocations) console.log(`    ${path.padEnd(44)} -> ${location}`);

console.log(`\n  ${failed ? `${failed} FAILED, ` : ""}${passed} checks pass.\n`);
process.exit(failed ? 1 : 0);
