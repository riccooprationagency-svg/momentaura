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
 * The middleware is the shipped file, with ONE line substituted: its bare
 * `import site from "../src/data/site.json"`, which the Pages bundler accepts
 * and Node refuses without an import attribute. A copy is written to a scratch
 * directory with that line replaced by the config this test hands it — the
 * same move track-test.mjs and mpesa-test.mjs make for the catalogue — and
 * if the line is ever not found, the test throws rather than testing nothing.
 * The real config is read and passed through unchanged for every case except
 * the null-url ones, so it is never edited to make a test pass. Only next()
 * is substituted otherwise, so a pass-through is visible as the sentinel it
 * returns.
 *
 *   node scripts/redirect-test.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS = join(ROOT, "functions");
const MIDDLEWARE = join(FUNCTIONS, "_middleware.js");

/* ---------- every file in functions/ compiles under the Pages bundler ----------
 *
 * A static check over ALL of functions/, not only this middleware, because the
 * failure it guards is not this file's: PR #14 shipped
 * `import site from "../src/data/site.json" with { type: "json" }`, every gate
 * here passed, and the Cloudflare Pages build failed on both commits. Pages
 * compiles Functions with wrangler 3, whose esbuild 0.17 rejects import
 * attributes ("Expected ';' but found 'with'"). The older `assert { ... }` form
 * is no escape: that esbuild accepts it, Node 22+ rejects it as a syntax error,
 * and the tests here import the shipped files under Node. So neither form may
 * appear in an import or re-export, and JSON is imported bare, as _order.js and
 * track.js already do — the tests substitute that line.
 *
 * It lives here rather than in verify.mjs because verify.mjs walks src/ and
 * dist/, and the functions/ rules live in the *-test.mjs scripts. It runs
 * before anything is loaded, so it fails with a reason rather than with a
 * stack trace from a later import. */
const ATTRIBUTE_IMPORT =
  /^\s*(?:import|export)\b[^;]*?["'][^"']+["']\s*(with|assert)\s*\{/m;

const walkJs = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkJs(path);
    return entry.name.endsWith(".js") ? [path] : [];
  });

{
  /* The pattern proves itself first, on the shapes it must and must not match,
     so a regex that silently matches nothing cannot report a clean tree. */
  const MUST = [
    'import site from "../src/data/site.json" with { type: "json" };',
    "import data from './x.json' assert { type: 'json' };",
    'import {\n  a,\n  b,\n} from "./y.json" with { type: "json" };',
    'export { default } from "./z.json" with { type: "json" };',
    'import "./side-effect.json" with { type: "json" };',
  ];
  const MUST_NOT = [
    'import site from "../src/data/site.json";',
    'import { settle } from "../../_pending.js";',
    '/* JSON is imported bare, with no `with { type: "json" }` attribute */',
  ];
  const broken = [
    ...MUST.filter((src) => !ATTRIBUTE_IMPORT.test(src)).map((src) => `misses: ${src}`),
    ...MUST_NOT.filter((src) => ATTRIBUTE_IMPORT.test(src)).map((src) => `wrongly flags: ${src}`),
  ];
  if (broken.length) {
    console.log("\n  FAIL  the import-attribute check does not behave:\n" + broken.map((b) => `        ${b}`).join("\n") + "\n");
    process.exit(1);
  }

  const offenders = [];
  for (const file of walkJs(FUNCTIONS)) {
    const match = ATTRIBUTE_IMPORT.exec(readFileSync(file, "utf8"));
    if (match) offenders.push(`${file.slice(ROOT.length + 1).replace(/\\/g, "/")}  (\`${match[1]} {\`)`);
  }
  if (offenders.length) {
    console.log(
      "\n  FAIL  import attributes in functions/ — Cloudflare's Pages Functions compiler\n" +
        "        (wrangler 3 / esbuild 0.17) rejects `with { ... }`, and Node 22+ rejects\n" +
        "        `assert { ... }`. Import JSON bare, as functions/api/_order.js does:\n" +
        offenders.map((o) => `          ${o}`).join("\n") +
        "\n"
    );
    process.exit(1);
  }
  console.log(`\n  pass  no import attributes in ${walkJs(FUNCTIONS).length} file(s) under functions/ (Pages bundler would reject them)`);
}
const SOURCE = readFileSync(MIDDLEWARE, "utf8");
const SITE_IMPORT = /^import site from "\.\.\/src\/data\/site\.json";$/m;
if (!SITE_IMPORT.test(SOURCE)) {
  throw new Error("could not find the site.json import — has _middleware.js moved it?");
}

/* The shipped middleware, loaded against the given site config. */
let loads = 0;
const loadMiddleware = async (config) => {
  const key = `__momentauraSite${++loads}`;
  globalThis[key] = config;
  const dir = join(tmpdir(), `momentaura-redirect-${process.pid}-${loads}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), '{"type":"module"}\n', "utf8");
  writeFileSync(join(dir, "_middleware.js"), SOURCE.replace(SITE_IMPORT, `const site = globalThis.${key};`), "utf8");
  return import(pathToFileURL(join(dir, "_middleware.js")).href);
};

const site = JSON.parse(readFileSync(join(ROOT, "src", "data", "site.json"), "utf8"));
const { onRequest, PRODUCTION_PAGES_HOST } = await loadMiddleware(site);
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

/* Null-domain mode. The shipped middleware against a config whose url is
   null, and one whose url is not a URL. Both must load without throwing and
   pass every request through. */
for (const [label, url] of [["null", null], ["not a URL", "momentaurastores dot co dot ke"]]) {
  let handler = null;
  try {
    ({ onRequest: handler } = await loadMiddleware({ ...site, url }));
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
