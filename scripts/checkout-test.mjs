#!/usr/bin/env node
/* Exercises functions/api/checkout.js — the only endpoint that touches money.
 *
 * Wrangler cannot be installed here: V1 asserts the dependency surface is Astro
 * and nothing else, and a test runner would be a devDependency. So this runs the
 * real handler on Node's own fetch primitives, which are the same primitives the
 * Workers runtime gives it — Request, Response, URL, crypto.getRandomValues.
 *
 * Two imports are rewritten before the module is loaded, and only two:
 *
 *   products.json      so a case can set real stock without touching the
 *                      catalogue. The file this repo ships must never be edited
 *                      to make a test pass, and rewriting the import means it is
 *                      never even read
 *   createHostedCheckout   so a gateway failure is deterministic. GatewayError
 *                      and GATEWAY_NAME come from the real _gateway.js, because
 *                      checkout.js branches on `instanceof GatewayError` and a
 *                      stubbed class would make that branch pass for the wrong
 *                      reason
 *
 * Everything else — validation, re-pricing, stock rules, status codes, the
 * shape of the response — is the shipped code, unmodified.
 *
 * What this CANNOT prove, and nothing here should be read as proving: that
 * Cloudflare's bundler accepts the JSON import, that the IntaSend request body
 * is shaped the way IntaSend wants, or that any of it works against a live
 * gateway. There are no sandbox credentials in this repo. See the PR.
 *
 *   node scripts/checkout-test.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "functions", "api", "checkout.js");
const ORDER = join(ROOT, "functions", "api", "_order.js");
const GATEWAY = pathToFileURL(join(ROOT, "functions", "api", "_gateway.js")).href;

/* ---------- load the real handler with two imports redirected ----------
 *
 * The catalogue import lives in _order.js, which checkout.js imports relatively.
 * So both files are written to the scratch directory: the copy of _order.js has
 * its catalogue swapped, and checkout.js's `./_order.js` then resolves to that
 * copy without the import itself being touched. The shared validation is
 * therefore the shipped code, running against a fixed catalogue. */

const orderSource = readFileSync(ORDER, "utf8");
const orderPatched = orderSource.replace(
  /^import catalogue from .*$/m,
  "const catalogue = globalThis.__catalogue;"
);
if (orderPatched === orderSource) throw new Error("could not find the catalogue import — has _order.js moved it?");

const original = readFileSync(SOURCE, "utf8");

const patched = original.replace(
  /^import \{ GATEWAY_NAME, GatewayError, createHostedCheckout \} from .*$/m,
  `import { GATEWAY_NAME, GatewayError } from ${JSON.stringify(GATEWAY)};\n` +
    "const createHostedCheckout = (...args) => globalThis.__gateway(...args);"
);
if (patched === original) throw new Error("could not find the gateway import — has checkout.js moved it?");

/* A fixed catalogue. Prices and stock chosen so a wrong total is obvious:
   650 x 2 = 1300, and nothing else in the set sums to it by accident. */
globalThis.__catalogue = [
  { slug: "crew-tee", name: "Crew tee", price: 650, stock: 6 },
  { slug: "faith-hoodie", name: "Faith hoodie", price: 3500, stock: 0 },
  { slug: "bullet-pendant", name: "Bullet pendant", price: 1400, stock: 2 },
];

const scratch = join(tmpdir(), `momentaura-checkout-test-${Date.now()}`);
mkdirSync(scratch, { recursive: true });

/* The scratch copy sits outside the repo, so nothing above it declares ESM and
   _order.js loads as CommonJS — its first import throws. Node looks for this
   file; the repo's own package.json is out of reach from tmp. */
writeFileSync(join(scratch, "package.json"), '{"type":"module"}\n', "utf8");
writeFileSync(join(scratch, "_order.js"), orderPatched, "utf8");
const modulePath = join(scratch, "checkout.mjs");
writeFileSync(modulePath, patched, "utf8");

const { onRequest } = await import(pathToFileURL(modulePath).href);

/* ---------- harness ---------- */

let passed = 0;
const failures = [];

/** The last thing the gateway was asked to do, so a case can inspect it. */
let lastCall = null;

const succeed = (url = "https://sandbox.intasend.com/checkout/abc123") => {
  globalThis.__gateway = async (args) => {
    lastCall = args;
    return { url };
  };
};

const explode = (code) => {
  globalThis.__gateway = async (args) => {
    lastCall = args;
    const { GatewayError } = await import(GATEWAY);
    throw new GatewayError(code, "detail that must never reach the browser: sk_live_SECRET");
  };
};

const post = (body, { method = "POST" } = {}) =>
  onRequest({
    request: new Request("https://momentaura.co.ke/api/checkout", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    }),
    env: { INTASEND_SECRET_KEY: "sk_test", INTASEND_PUBLISHABLE_KEY: "pk_test" },
  });

async function check(label, fn) {
  try {
    await fn();
    passed++;
    console.log(`  pass  ${label}`);
  } catch (error) {
    failures.push(`${label}\n          ${error.message}`);
    console.log(`  FAIL  ${label}`);
  }
}

const eq = (actual, expected, what) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
};

const has = (haystack, needle, what) => {
  if (!String(haystack).includes(needle)) throw new Error(`${what}: ${JSON.stringify(String(haystack))} does not contain ${JSON.stringify(needle)}`);
};

const lacks = (haystack, needle, what) => {
  if (String(haystack).includes(needle)) throw new Error(`${what}: ${JSON.stringify(String(haystack))} LEAKS ${JSON.stringify(needle)}`);
};

const GOOD = { items: [{ slug: "crew-tee", qty: 2 }], name: "Amina W", phone: "0712345678" };

console.log("\n  checkout.js — the endpoint that touches money\n");

/* ---------- the happy path ---------- */

await check("a valid order returns a hosted URL, our reference and our total", async () => {
  succeed();
  const res = await post(GOOD);
  eq(res.status, 200, "status");
  const body = await res.json();
  eq(body.url, "https://sandbox.intasend.com/checkout/abc123", "url");
  eq(body.total, 1300, "total");
  eq(body.gateway, "IntaSend", "gateway name");
  if (!/^MA-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(body.reference)) {
    throw new Error(`reference shape: ${body.reference}`);
  }
});

await check("the response carries nothing beyond url, reference, total and gateway", async () => {
  succeed();
  const body = await (await post(GOOD)).json();
  eq(Object.keys(body).sort(), ["gateway", "reference", "total", "url"], "keys");
});

await check("the amount handed to the gateway is computed here, and the phone is normalised", async () => {
  succeed();
  await post({ ...GOOD, phone: "0712 345 678" });
  eq(lastCall.amount, 1300, "gateway amount");
  eq(lastCall.customer.phone, "254712345678", "normalised msisdn");
  eq(lastCall.customer.email, null, "email absent");
  has(lastCall.redirectUrl, "/order-received/?ref=MA-", "redirect carries the reference");
});

await check("two references in a row differ", async () => {
  succeed();
  const a = (await (await post(GOOD)).json()).reference;
  const b = (await (await post(GOOD)).json()).reference;
  if (a === b) throw new Error(`reference repeated: ${a}`);
});

/* ---------- never trust a client price ---------- */

await check("a client-supplied price is ignored, not honoured", async () => {
  succeed();
  const body = await (
    await post({ ...GOOD, items: [{ slug: "crew-tee", qty: 2, price: 1, amount: 1 }] })
  ).json();
  eq(body.total, 1300, "total re-priced from the catalogue");
  eq(lastCall.amount, 1300, "gateway amount");
});

await check("a client-supplied total is ignored", async () => {
  succeed();
  const body = await (await post({ ...GOOD, total: 1, amount: 0 })).json();
  eq(body.total, 1300, "total");
});

/* ---------- catalogue and stock ---------- */

await check("a slug not in the catalogue is rejected, never skipped", async () => {
  succeed();
  const res = await post({ ...GOOD, items: [{ slug: "crew-tee", qty: 1 }, { slug: "not-a-product", qty: 1 }] });
  eq(res.status, 422, "status");
  has((await res.json()).message, "no longer available", "message");
});

await check("a sold-out product is rejected BY NAME", async () => {
  succeed();
  const res = await post({ ...GOOD, items: [{ slug: "faith-hoodie", qty: 1 }] });
  eq(res.status, 409, "status");
  has((await res.json()).message, "Faith hoodie is sold out", "names the product");
});

await check("a quantity above stock is rejected by name, with the real figure", async () => {
  succeed();
  const res = await post({ ...GOOD, items: [{ slug: "bullet-pendant", qty: 3 }] });
  eq(res.status, 409, "status");
  has((await res.json()).message, "only 2 of the Bullet pendant", "names product and stock");
});

await check("a quantity exactly at stock is accepted", async () => {
  succeed();
  const res = await post({ ...GOOD, items: [{ slug: "bullet-pendant", qty: 2 }] });
  eq(res.status, 200, "status");
  eq((await res.json()).total, 2800, "total");
});

/* Both quantities sit inside stock, so the stock rule cannot fire and the
   duplicate rule is the only thing that can reject this. An earlier version used
   99 twice and passed on the stock check instead, proving nothing about
   duplicates. */
await check("the same slug twice is rejected rather than summed past the cap", async () => {
  succeed();
  const res = await post({ ...GOOD, items: [{ slug: "crew-tee", qty: 2 }, { slug: "crew-tee", qty: 2 }] });
  eq(res.status, 400, "status");
});

await check("a repeated slug cannot be used to exceed stock in total", async () => {
  succeed();
  const res = await post({ ...GOOD, items: [{ slug: "bullet-pendant", qty: 2 }, { slug: "bullet-pendant", qty: 2 }] });
  if (res.status === 200) throw new Error("4 of a 2-stock product were accepted across two lines");
  eq(res.status, 400, "status");
});

/* ---------- malformed input ---------- */

const bad = [
  ["not JSON at all", "{{{"],
  ["a JSON array rather than an object", []],
  ["null", null],
  ["no items", { name: "Amina W", phone: "0712345678" }],
  ["an empty basket", { ...GOOD, items: [] }],
  ["more lines than a basket holds", { ...GOOD, items: Array.from({ length: 11 }, (_, i) => ({ slug: `x${i}`, qty: 1 })) }],
  ["a fractional quantity", { ...GOOD, items: [{ slug: "crew-tee", qty: 1.5 }] }],
  ["a negative quantity", { ...GOOD, items: [{ slug: "crew-tee", qty: -3 }] }],
  ["a zero quantity", { ...GOOD, items: [{ slug: "crew-tee", qty: 0 }] }],
  ["a quantity past the cap", { ...GOOD, items: [{ slug: "crew-tee", qty: 100 }] }],
  ["a quantity as a string", { ...GOOD, items: [{ slug: "crew-tee", qty: "2" }] }],
  ["a slug that is not a string", { ...GOOD, items: [{ slug: 12, qty: 1 }] }],
  ["an item that is not an object", { ...GOOD, items: ["crew-tee"] }],
  ["no name", { items: GOOD.items, phone: "0712345678" }],
  ["a one-character name", { ...GOOD, name: "A" }],
  ["no phone", { items: GOOD.items, name: "Amina W" }],
  ["a phone that is not Kenyan", { ...GOOD, phone: "+447700900000" }],
  ["a phone with too few digits", { ...GOOD, phone: "071234567" }],
  ["a malformed email", { ...GOOD, email: "not-an-address" }],
];

for (const [label, body] of bad) {
  await check(`rejected: ${label}`, async () => {
    succeed();
    const res = await post(body);
    if (res.status < 400 || res.status > 499) throw new Error(`expected a 4xx, got ${res.status}`);
    const text = await res.text();
    has(text, "message", "carries a message");
    lacks(text, "something went wrong", "never a generic apology");
  });
}

await check("valid phone shapes are all accepted", async () => {
  for (const phone of ["0712345678", "0112345678", "+254712345678", "254112345678", "0712 345 678", "0712-345-678"]) {
    succeed();
    const res = await post({ ...GOOD, phone });
    if (res.status !== 200) throw new Error(`${phone} was rejected with ${res.status}`);
  }
});

await check("a blank email is accepted, a good one is passed on", async () => {
  succeed();
  eq((await post({ ...GOOD, email: "   " })).status, 200, "blank accepted");
  succeed();
  await post({ ...GOOD, email: "a@b.co" });
  eq(lastCall.customer.email, "a@b.co", "email passed to the gateway");
});

/* ---------- the gateway's response never reaches the browser ---------- */

await check("a gateway rejection reads as declined, and leaks nothing", async () => {
  explode("gateway_rejected");
  const res = await post(GOOD);
  eq(res.status, 402, "status");
  const text = await res.text();
  has(text, "did not go through", "explains");
  has(text, "Nothing has been charged", "states what did not happen");
  lacks(text, "sk_live_SECRET", "the gateway detail");
  lacks(text, "gateway_rejected", "the internal code");
});

for (const code of ["gateway_unreachable", "gateway_misconfigured", "gateway_no_url", "gateway_bad_url", "gateway_unreadable"]) {
  await check(`${code} reads as unavailable, not declined, and leaks nothing`, async () => {
    explode(code);
    const res = await post(GOOD);
    eq(res.status, 503, "status");
    const text = await res.text();
    has(text, "not going through right now", "explains");
    lacks(text, "sk_live_SECRET", "the gateway detail");
    lacks(text, code, "the internal code");
  });
}

await check("an unexpected throw is still a clean 503", async () => {
  globalThis.__gateway = async () => {
    throw new TypeError("undefined is not a function; token=sk_live_SECRET");
  };
  const res = await post(GOOD);
  eq(res.status, 503, "status");
  lacks(await res.text(), "sk_live_SECRET", "the thrown detail");
});

/* ---------- method and headers ---------- */

await check("a GET is refused", async () => {
  succeed();
  const res = await post(null, { method: "GET" });
  eq(res.status, 405, "status");
  eq(res.headers.get("Allow"), "POST", "Allow header");
});

await check("responses are never cached", async () => {
  succeed();
  const res = await post(GOOD);
  eq(res.headers.get("Cache-Control"), "no-store", "Cache-Control");
  eq(res.headers.get("X-Content-Type-Options"), "nosniff", "nosniff");
});

/* ---------- no secret is reachable from the module ---------- */

await check("no key, token or secret is written into the source", async () => {
  for (const file of ["functions/api/checkout.js", "functions/api/_gateway.js"]) {
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const pattern of [/sk_live[_a-z0-9]/i, /pk_live[_a-z0-9]/i, /ISSecretKey_/i, /["'][A-Za-z0-9]{32,}["']/]) {
      const hit = src.match(pattern);
      /* The read-aloud alphabet is a constant, not a credential. */
      if (hit && !hit[0].includes("ABCDEFGH")) {
        throw new Error(`${file} contains something credential-shaped: ${hit[0].slice(0, 40)}`);
      }
    }
  }
});

/* ---------- report ---------- */

console.log("");
if (failures.length) {
  console.error(`  ${failures.length} failure(s), ${passed} passed:\n`);
  for (const f of failures) console.error(`    ${f}`);
  console.error("");
  process.exit(1);
}
console.log(`  ${passed} checks pass.\n`);
