#!/usr/bin/env node
/* Exercises the M-Pesa endpoints — the four functions that settle money.
 *
 * Wrangler cannot be installed here: V1 asserts the dependency surface is Astro
 * and nothing else. So this runs the real handlers on Node's own primitives,
 * which are the same ones the Workers runtime provides — Request, Response, URL,
 * fetch, crypto.getRandomValues, btoa.
 *
 * WHAT IS REAL HERE: every line of stk.js, status.js, callback/[token].js,
 * _pending.js, _order.js and _daraja.js. The token cache, the EAT timestamp, the
 * base64 password, the response parsing, the error mapping, the idempotency and
 * the amount check are all the shipped code.
 *
 * WHAT IS SUBSTITUTED, and only this:
 *
 *   fetch()        stubbed at the HTTP boundary so Daraja's replies are
 *                  deterministic. _daraja.js itself is untouched and runs for
 *                  real against it — stubbing the module instead would have
 *                  tested the stub
 *   products.json  so a case can set real stock without editing the catalogue
 *                  this repo ships
 *   env.ORDERS     an in-memory KV standing in for the binding
 *
 * WHAT THIS CANNOT PROVE, and nothing here should be read as proving: that
 * Safaricom accepts these request bodies, that a real phone prompts, that a real
 * callback arrives from a real Safaricom IP, or that the production credentials
 * — which do not exist — work at all. There are no Daraja credentials in this
 * repo and no request has left the machine. See BUILD-ORDER section 9.
 *
 *   node scripts/mpesa-test.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = join(ROOT, "functions", "api");

/* ---------- copy the api tree, patching only the catalogue import ---------- */

const scratch = join(tmpdir(), `momentaura-mpesa-${Date.now()}`);
mkdirSync(scratch, { recursive: true });
cpSync(API, scratch, { recursive: true });

/* The scratch copy sits outside the repo, so nothing above it declares ESM and
   a .js file there loads as CommonJS — the shipped handlers are modules and
   their first import throws. Node looks for this file; the repo's own
   package.json is out of reach from tmp. */
writeFileSync(join(scratch, "package.json"), '{"type":"module"}\n', "utf8");

/* Every shipped file that prices from the catalogue: _order.js for the push, and
   promo/check.js for the preview. The same line is substituted in both, so the
   two price from one fixture and a case can compare what each of them says. */
for (const file of ["_order.js", "promo/check.js"]) {
  const path = join(scratch, file);
  const source = readFileSync(path, "utf8");
  const patched = source.replace(/^import catalogue from .*$/m, "const catalogue = globalThis.__catalogue;");
  if (patched === source) throw new Error(`could not find the catalogue import — has ${file} moved it?`);
  writeFileSync(path, patched, "utf8");
}

globalThis.__catalogue = [
  { slug: "crew-tee", name: "Crew tee", price: 650, stock: 6 },
  { slug: "faith-hoodie", name: "Faith hoodie", price: 3500, stock: 0 },
  /* Fixtures for the promo arithmetic, chosen for the figure rather than the
     product: 1,200 divides cleanly at 10 percent, 1,399 does not, 10 is the
     live-test price, and 1 is the floor the discount must never reach. */
  { slug: "tee-1200", name: "Tee 1200", price: 1200, stock: 50 },
  { slug: "tee-1399", name: "Tee 1399", price: 1399, stock: 50 },
  { slug: "ten-bob", name: "Ten bob", price: 10, stock: 50 },
  { slug: "one-bob", name: "One bob", price: 1, stock: 50 },
  /* A fixture, not shop data: no product in products.json has sizes yet. Two
     labels, one with measurements and one without, because the server reads
     only the label and must not care whether the chart could render. */
  {
    slug: "sized-tee",
    name: "Sized tee",
    price: 900,
    stock: 4,
    sizes: [
      { label: "M", chestCm: 52, lengthCm: 70 },
      { label: "L", chestCm: null, lengthCm: null },
    ],
  },
];

/* Stock fixtures for the sold: markers. Each carries the moment its figure was
   counted, which is what makes a sale before it irrelevant. tee-1 and tee-12 are
   named so that one is a prefix of the other as text: the trailing colon on the
   marker prefix is the only thing keeping their sales apart. */
const COUNTED = Date.parse("2026-11-17T19:42:00+03:00");
globalThis.__catalogue.push(
  { slug: "tee-1", name: "Tee 1", price: 1000, stock: 20, stockCountedAt: "2026-11-17T19:42:00+03:00" },
  { slug: "tee-12", name: "Tee 12", price: 1000, stock: 20, stockCountedAt: "2026-11-17T19:42:00+03:00" },
  { slug: "last-one", name: "Last one", price: 1000, stock: 1, stockCountedAt: "2026-11-17T19:42:00+03:00" }
);

/* The delivery fee table. Same move as the catalogue — the one import line in
   _site.js is substituted, because Node refuses a bare JSON import — but the
   value handed in is THE REAL site.json, read unedited, not a fixture. The fee
   cases below assert the figures a buyer is actually charged, so a fee changed
   in site.json without the test changing with it fails here, on purpose. */
const sitePath = join(scratch, "_site.js");
const siteSource = readFileSync(sitePath, "utf8");
const sitePatched = siteSource.replace(
  /^import site from .*$/m,
  "const site = globalThis.__site;"
);
if (sitePatched === siteSource) throw new Error("could not find the site.json import — has _site.js moved it?");
writeFileSync(sitePath, sitePatched, "utf8");

globalThis.__site = JSON.parse(readFileSync(join(ROOT, "src", "data", "site.json"), "utf8"));

const load = (rel) => import(pathToFileURL(join(scratch, rel)).href);

const { onRequest: stk } = await load("mpesa/stk.js");
const { onRequest: promoCheck } = await load("promo/check.js");
const { onRequest: status } = await load("mpesa/status.js");
const { onRequest: callback } = await load("mpesa/callback/[token].js");
const daraja = await load("_daraja.js");

/* ---------- the Daraja stub, at the HTTP boundary ---------- */

const SAFARICOM_IP = "196.201.214.200";
const TOKEN_PATH = "s3cr3t-callback-path";

/* The origin every request in this file is made to, and the one the callback URL
 * is asserted against. ONE CONSTANT, so the fixture and the assertion cannot
 * disagree — the CallBackURL check would otherwise pass by matching a literal
 * that nothing else in the file uses.
 *
 * It is momentaurastores.co.ke because that is the canonical domain
 * (src/data/site.json `url`, since phase-2-domain-crawl). The old domain was
 * replaced, and momentaura.co.ke before it was invented here and registered
 * nowhere — a test fixture naming a host that is not ours is a small untruth
 * in the one file that exists to catch untruths about the money path.
 *
 * IT IS NOT A CLAIM ABOUT WHAT MPESA_CALLBACK_ORIGIN HOLDS IN PRODUCTION. That
 * is a Cloudflare environment variable and may still be the .pages.dev URL.
 * The handler builds the URL from the env var and asserts nothing about the
 * host, so this value is the shape of the thing rather than a claim about
 * deployment. See BUILD-ORDER section 11. */
const ORIGIN = "https://momentaurastores.co.ke";

let darajaMode = "ok";
/* When an array, each push takes the next id from it, so two orders can be in
   flight at once. Null keeps the one id every other case in this file expects. */
let checkoutIds = null;
let tokenFetches = 0;
let pushes = [];
let queries = [];
let queryReply = { ResultCode: "0", ResultDesc: "The service request is processed successfully." };

const reply = (status, body) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

globalThis.fetch = async (url, init = {}) => {
  const href = String(url);

  if (href.includes("/oauth/v1/generate")) {
    tokenFetches++;
    if (darajaMode === "token_down") return reply(401, { errorMessage: "Invalid credentials CONSUMER_SECRET_LEAK" });
    if (darajaMode === "token_unreachable") throw new TypeError("network down CONSUMER_SECRET_LEAK");
    return reply(200, { access_token: "tok_" + tokenFetches, expires_in: "3599" });
  }

  if (href.includes("/mpesa/stkpush/v1/processrequest")) {
    pushes.push(JSON.parse(init.body));
    if (darajaMode === "push_http_error") return reply(500, "upstream exploded PASSKEY_LEAK");
    if (darajaMode === "push_unreachable") throw new TypeError("connect ETIMEDOUT PASSKEY_LEAK");
    if (darajaMode === "push_refused") {
      return reply(200, { ResponseCode: "1", ResponseDescription: "Invalid PhoneNumber PASSKEY_LEAK" });
    }
    if (darajaMode === "push_no_id") return reply(200, { ResponseCode: "0" });
    return reply(200, {
      MerchantRequestID: "mr-1",
      CheckoutRequestID: checkoutIds ? checkoutIds.shift() : "ws_CO_TEST_1",
      ResponseCode: "0",
      ResponseDescription: "Success. Request accepted for processing",
      CustomerMessage: "Success. Request accepted for processing",
    });
  }

  if (href.includes("/mpesa/stkpushquery/v1/query")) {
    queries.push(JSON.parse(init.body));
    if (darajaMode === "query_unreachable") throw new TypeError("connect ETIMEDOUT PASSKEY_LEAK");
    if (darajaMode === "query_processing") {
      return reply(500, { errorCode: "500.001.1001", errorMessage: "The transaction is being processed" });
    }
    return reply(200, queryReply);
  }

  throw new Error(`unexpected fetch to ${href}`);
};

/* ---------- an in-memory KV ---------- */

function makeKv() {
  const store = new Map();
  /* Workers KV keeps a small metadata object beside a value, set by put() and
     handed back by list() without a read per key. The sold: markers rely on it. */
  const meta = new Map();
  return {
    store,
    meta,
    /* Every prefix a list() was asked for, so a case can assert what was NOT
       listed as well as what failed. */
    listed: [],
    failWrites: false,
    failReads: false,
    /* A predicate on the key, so ONE of an order's two writes can be failed
       while the other succeeds. Whole-store failure cannot express the case the
       mirror ordering exists for: KV up, the record settling, and only the
       buyer's copy not landing. */
    failWritesTo: null,
    failLists: false,
    /* When true, every operation gives up the turn first, so two requests running
       together interleave their reads and writes the way two isolates would. A
       read-then-write that is not safe under that shows up here and not in a
       harness whose every await resolves in order. */
    yieldOps: false,
    pageSize: 1000,
    async turn() {
      if (this.yieldOps) await new Promise((resolve) => setTimeout(resolve, 0));
    },
    /* Workers KV list(): keys under a prefix, in order, a page at a time, with a
       cursor until list_complete. */
    async list({ prefix = "", cursor } = {}) {
      await this.turn();
      this.listed.push(prefix);
      if (this.failLists) throw new Error("KV list failed");
      const names = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = cursor ? Number(cursor) : 0;
      const page = names.slice(from, from + this.pageSize);
      const done = from + this.pageSize >= names.length;
      return { keys: page.map((name) => (meta.has(name) ? { name, metadata: meta.get(name) } : { name })), list_complete: done, ...(done ? {} : { cursor: String(from + this.pageSize) }) };
    },
    async get(key, type) {
      await this.turn();
      if (this.failReads) throw new Error("KV read failed");
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put(key, value, options = {}) {
      await this.turn();
      if (this.failWrites) throw new Error("KV write failed");
      if (this.failWritesTo && this.failWritesTo(key)) throw new Error("KV write failed");
      store.set(key, value);
      if (options.metadata !== undefined) meta.set(key, options.metadata);
      else meta.delete(key);
    },
  };
}

let kv;

const baseEnv = () => ({
  ORDERS: kv,
  MPESA_ENV: "sandbox",
  MPESA_CONSUMER_KEY: "ck",
  MPESA_CONSUMER_SECRET: "cs",
  MPESA_SHORTCODE: "174379",
  MPESA_PASSKEY: "pk",
  MPESA_CALLBACK_ORIGIN: ORIGIN,
  MPESA_CALLBACK_TOKEN: TOKEN_PATH,
});

function resetAll() {
  kv = makeKv();
  darajaMode = "ok";
  checkoutIds = null;
  pushes = [];
  queries = [];
  tokenFetches = 0;
  queryReply = { ResultCode: "0", ResultDesc: "ok" };
  daraja._resetTokenCache();
}

/* ---------- harness ---------- */

let passed = 0;
const failures = [];

async function check(label, fn) {
  resetAll();
  try {
    await fn();
    passed++;
    console.log(`  pass  ${label}`);
  } catch (error) {
    failures.push(`${label}\n          ${error.message}`);
    console.log(`  FAIL  ${label}`);
  }
}

const eq = (a, b, what) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
};
const has = (h, n, what) => {
  if (!String(h).includes(n)) throw new Error(`${what}: ${JSON.stringify(String(h).slice(0, 200))} lacks ${JSON.stringify(n)}`);
};
const lacks = (h, n, what) => {
  if (String(h).includes(n)) throw new Error(`${what}: LEAKS ${JSON.stringify(n)}`);
};

/* Nairobi CBD is the free zone, so every amount this file asserted before
   delivery fees existed (2 x 650 = 1300) is still the amount pushed. The fee
   cases below change the county on purpose and say so. */
const ORDER = {
  items: [{ slug: "crew-tee", qty: 2 }],
  name: "Amina Wanjiru",
  phone: "0712345678",
  county: "nairobi-cbd",
  area: "Kilimani",
  landmark: "Blue gate beside the chemist",
};

const rawPushBody = (body, env = baseEnv()) =>
  stk({ request: new Request(`${ORIGIN}/api/mpesa/stk`, { method: "POST", body }), env });

const push = (body = ORDER, env = baseEnv()) =>
  stk({ request: new Request(`${ORIGIN}/api/mpesa/stk`, { method: "POST", body: JSON.stringify(body) }), env });

const askStatus = (body, env = baseEnv()) =>
  status({ request: new Request(`${ORIGIN}/api/mpesa/status`, { method: "POST", body: JSON.stringify(body) }), env });

const hit = (body, { token = TOKEN_PATH, ip = SAFARICOM_IP, env = baseEnv(), method = "POST" } = {}) =>
  callback({
    request: new Request(`${ORIGIN}/api/mpesa/callback/${token}`, {
      method,
      headers: { "CF-Connecting-IP": ip },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
    env,
    params: { token },
  });

const callbackBody = ({ id = "ws_CO_TEST_1", code = 0, amount = 1300, receipt = "RGX1A2B3C4" } = {}) => ({
  Body: {
    stkCallback: {
      MerchantRequestID: "mr-1",
      CheckoutRequestID: id,
      ResultCode: code,
      ResultDesc: code === 0 ? "The service request is processed successfully." : "Request cancelled by user",
      ...(code === 0
        ? {
            CallbackMetadata: {
              Item: [
                { Name: "Amount", Value: amount },
                { Name: "MpesaReceiptNumber", Value: receipt },
                { Name: "PhoneNumber", Value: 254712345678 },
              ],
            },
          }
        : {}),
    },
  },
});

const record = async (id = "ws_CO_TEST_1") => await kv.get(id, "json");

/* A pushed order aged backwards, so the status query is past the 90-second grace
   and will actually ask Daraja. Up here with the other helpers because the
   callback tests reach for it too, not only the status-query section below. */
const pushThenAge = async (ms) => {
  const res = await push();
  const body = await res.json();
  const stored = await record();
  stored.pushedAt = Date.now() - ms;
  stored.createdAt = stored.pushedAt;
  await kv.put("ws_CO_TEST_1", JSON.stringify(stored));
  return body;
};

console.log("\n  M-Pesa — STK push, callback, status query\n");

/* ================= the token ================= */

await check("the token is fetched once and reused across pushes", async () => {
  await push();
  await push();
  eq(tokenFetches, 1, "token fetches for two pushes");
});

await check("a token failure reads as unavailable, never as a declined payment", async () => {
  darajaMode = "token_down";
  const res = await push();
  eq(res.status, 503, "status");
  const text = await res.text();
  has(text, "not responding right now", "explains");
  has(text, "Nothing has been charged", "states what did not happen");
  lacks(text, "CONSUMER_SECRET_LEAK", "the upstream detail");
});

await check("the password is base64 of shortcode + passkey + timestamp, in EAT", async () => {
  const stamp = daraja.timestamp(new Date(Date.UTC(2026, 8, 2, 21, 4, 5)));
  eq(stamp, "20260903000405", "EAT is UTC+3, and rolls the date over");
  eq(daraja.password("174379", "pk", stamp), Buffer.from("174379pk20260903000405").toString("base64"), "password");
});

/* ================= STK push ================= */

await check("a good order pushes, stores pending, and returns no Daraja payload", async () => {
  const res = await push();
  eq(res.status, 200, "status");
  const body = await res.json();
  eq(Object.keys(body).sort(), ["checkoutRequestId", "reference", "total"], "response keys");
  eq(body.total, 1300, "total re-priced from the catalogue");
  const stored = await record();
  eq(stored.status, "pending", "stored status");
  eq(stored.amount, 1300, "stored amount");
  eq(stored.items, [{ slug: "crew-tee", qty: 2 }], "stored items");
});

await check("AN STK PROMPT IS NOT A PAYMENT — nothing is marked paid on a push", async () => {
  await push();
  const stored = await record();
  if (stored.status === "paid") throw new Error("the push marked the order paid");
  eq(stored.status, "pending", "status after a successful push");
  eq(stored.receipt, undefined, "no receipt exists yet");
});

await check("a client-supplied price is ignored", async () => {
  const res = await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 2, price: 1 }], total: 1 });
  eq((await res.json()).total, 1300, "total");
  eq(pushes[0].Amount, 1300, "amount sent to Daraja");
});

await check("the amount sent to Daraja is an integer, and the phone is normalised", async () => {
  await push({ ...ORDER, phone: "0712 345 678" });
  if (!Number.isInteger(pushes[0].Amount)) throw new Error(`amount not an integer: ${pushes[0].Amount}`);
  eq(pushes[0].PhoneNumber, "254712345678", "msisdn");
  eq(pushes[0].PartyA, "254712345678", "PartyA");
});

await check("the callback URL is the configured origin plus the secret path", async () => {
  await push();
  eq(pushes[0].CallBackURL, `${ORIGIN}/api/mpesa/callback/${TOKEN_PATH}`, "CallBackURL");
});

await check("a sold-out product is refused by name, and nothing is pushed", async () => {
  const res = await push({ ...ORDER, items: [{ slug: "faith-hoodie", qty: 1 }] });
  eq(res.status, 409, "status");
  has((await res.json()).message, "Faith hoodie is sold out", "names the product");
  eq(pushes.length, 0, "no push was attempted");
});

/* CLAUDE.md: errors carry a phone number. The number is read from site.json
   here as it is in _site.js, so a changed number changes both, and a message
   that stops carrying it fails whatever the number is. */
await check("EVERY ORDER-LEVEL ERROR CARRIES THE PHONE NUMBER FROM site.json", async () => {
  const phone = globalThis.__site.contact.phone;
  if (!phone) throw new Error("site.json contact.phone is empty — nothing to assert against");
  const messages = [];
  messages.push((await (await push({ ...ORDER, items: [{ slug: "faith-hoodie", qty: 1 }] })).json()).message);
  messages.push((await (await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 7 }] })).json()).message);
  messages.push((await (await push({ ...ORDER, items: [{ slug: "not-a-product", qty: 1 }] })).json()).message);
  messages.push((await (await rawPushBody("{{{")).json()).message);
  darajaMode = "token_down";
  messages.push((await (await push()).json()).message);
  darajaMode = "push_refused";
  messages.push((await (await push()).json()).message);
  for (const message of messages) has(message, phone, "the message");
  for (const message of messages) lacks(message, "Message us", "the old route to /contact in place of a number");
});

await check("a field-level correction names the field and not the phone", async () => {
  const message = (await (await push({ ...ORDER, area: "" })).json()).message;
  lacks(message, globalThis.__site.contact.phone, "the area message");
});

await check("a quantity above stock is refused with the real figure", async () => {
  const res = await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 7 }] });
  eq(res.status, 409, "status");
  has((await res.json()).message, "only 6 of the Crew tee", "names product and figure");
});

await check("Daraja refusing the push in a 200 body is still a refusal", async () => {
  darajaMode = "push_refused";
  const res = await push();
  eq(res.status, 422, "status");
  const text = await res.text();
  has(text, "could not be sent to that number", "explains");
  lacks(text, "PASSKEY_LEAK", "the upstream detail");
  const stored = await record();
  eq(stored, null, "no pending record was indexed for a refused push");
});

await check("a push that never left is recorded as failed, not left pending forever", async () => {
  darajaMode = "push_refused";
  const res = await push();
  eq(res.status, 422, "status");
  const refs = [...kv.store.keys()].filter((k) => k.startsWith("ref:"));
  eq(refs.length, 1, "one reference record");
  const stored = JSON.parse(kv.store.get(refs[0]));
  eq(stored.status, "failed", "the order that never pushed is closed");
});

await check("a Daraja HTTP error reads as unavailable and leaks nothing", async () => {
  darajaMode = "push_http_error";
  const res = await push();
  eq(res.status, 503, "status");
  lacks(await res.text(), "PASSKEY_LEAK", "the upstream detail");
});

await check("an unreachable Daraja reads as unavailable, not declined", async () => {
  darajaMode = "push_unreachable";
  const res = await push();
  eq(res.status, 503, "status");
  const text = await res.text();
  has(text, "Nothing has been charged", "states what did not happen");
  lacks(text, "did not go through", "never claims the payment was refused");
});

await check("a missing shortcode is our failure, and reads as unavailable", async () => {
  const env = baseEnv();
  delete env.MPESA_SHORTCODE;
  const res = await push(ORDER, env);
  eq(res.status, 503, "status");
  has(await res.text(), "not responding right now", "unavailable, not declined");
});

await check("a 200 with no CheckoutRequestID is not treated as a success", async () => {
  darajaMode = "push_no_id";
  const res = await push();
  eq(res.status, 503, "status");
});

await check("KV failing before the push means no push at all", async () => {
  kv.failWrites = true;
  const res = await push();
  eq(res.status, 503, "status");
  eq(pushes.length, 0, "nothing was pushed with nowhere to record it");
});

await check("the order is written under its reference before the push goes out", async () => {
  const res = await push();
  const { reference } = await res.json();
  const early = await kv.get(`ref:${reference}`, "json");
  if (!early) throw new Error("no ref: record was written");
  eq(early.amount, 1300, "the reference record carries the computed amount");
});

/* ================= the request itself — _order.js =================
 *
 * readOrder() is the shared money-path validation: it decides what an order is
 * before either gateway sees a shilling of it. These cases were exercised
 * through /api/checkout by scripts/checkout-test.mjs. That endpoint and that
 * suite are retired, and stk.js is now the only caller — so this is the only
 * suite left that can see any of it. They moved rather than went.
 *
 * Every refusal below also asserts that NOTHING WAS PUSHED. The old suite could
 * not check that: a validation bug that let a bad order through to Daraja rings
 * a real phone, and the request never leaving is the property that matters here.
 */

const rawPush = (body, env = baseEnv()) =>
  stk({ request: new Request(`${ORIGIN}/api/mpesa/stk`, { method: "POST", body }), env });

/* [label, body, the message fragment it must carry]. The fragment is given
   wherever _order.js has specific wording to say — a 4xx alone would pass on a
   message that named the wrong field, and the field is what the buyer fixes. */
const bad = [
  ["not JSON at all", "{{{", null],
  ["a JSON array rather than an object", [], null],
  ["null", null, null],
  ["no items", { name: "Amina Wanjiru", phone: "0712345678" }, "There is nothing in your order yet."],
  ["an empty basket", { ...ORDER, items: [] }, "There is nothing in your order yet."],
  ["more lines than a basket holds", { ...ORDER, items: Array.from({ length: 11 }, (_, i) => ({ slug: `x${i}`, qty: 1 })) }, null],
  ["a fractional quantity", { ...ORDER, items: [{ slug: "crew-tee", qty: 1.5 }] }, null],
  ["a negative quantity", { ...ORDER, items: [{ slug: "crew-tee", qty: -3 }] }, null],
  ["a zero quantity", { ...ORDER, items: [{ slug: "crew-tee", qty: 0 }] }, null],
  ["a quantity past the cap", { ...ORDER, items: [{ slug: "crew-tee", qty: 100 }] }, null],
  ["a quantity as a string", { ...ORDER, items: [{ slug: "crew-tee", qty: "2" }] }, null],
  ["a slug that is not a string", { ...ORDER, items: [{ slug: 12, qty: 1 }] }, null],
  ["an item that is not an object", { ...ORDER, items: ["crew-tee"] }, null],
  ["no name", { items: ORDER.items, phone: "0712345678" }, "Enter the name the order is for."],
  ["a one-character name", { ...ORDER, name: "A" }, "Enter the name the order is for."],
  ["no phone", { items: ORDER.items, name: "Amina Wanjiru" }, "Enter a Kenyan phone number"],
  ["a phone that is not Kenyan", { ...ORDER, phone: "+447700900000" }, "Enter a Kenyan phone number"],
  ["a phone with too few digits", { ...ORDER, phone: "071234567" }, "Enter a Kenyan phone number"],
  ["a malformed email", { ...ORDER, email: "not-an-address" }, "That email address does not look right."],
  ["no county", { ...ORDER, county: undefined }, "Choose the county the order is going to."],
  ["a county key not in the fee table", { ...ORDER, county: "atlantis" }, "Choose the county the order is going to."],
  ["the county LABEL instead of its key", { ...ORDER, county: "Kirinyaga" }, "Choose the county the order is going to."],
  ["a county key from Object.prototype", { ...ORDER, county: "__proto__" }, "Choose the county the order is going to."],
  ["a county that is not a string", { ...ORDER, county: { key: "nairobi-cbd" } }, "Choose the county the order is going to."],
  ["no area", { ...ORDER, area: undefined }, "Enter the area or estate the order is going to."],
  ["an area that is only spaces", { ...ORDER, area: "    " }, "Enter the area or estate the order is going to."],
  ["an area past 80 characters", { ...ORDER, area: "K".repeat(81) }, "Enter the area or estate the order is going to."],
  ["an area carrying a control character", { ...ORDER, area: "Kilimani\u0007" }, "Enter the area or estate the order is going to."],
  ["no landmark", { ...ORDER, landmark: undefined }, "Enter a landmark a rider can find"],
  ["an empty landmark", { ...ORDER, landmark: "" }, "Enter a landmark a rider can find"],
  ["a landmark past 120 characters", { ...ORDER, landmark: "L".repeat(121) }, "Enter a landmark a rider can find"],
];

for (const [label, body, fragment] of bad) {
  await check(`refused before any prompt is sent: ${label}`, async () => {
    const res = typeof body === "string" ? await rawPush(body) : await push(body);
    if (res.status < 400 || res.status > 499) throw new Error(`expected a 4xx, got ${res.status}`);
    const text = await res.text();
    has(text, "message", "carries a message");
    lacks(text, "something went wrong", "never a generic apology");
    if (fragment) has(text, fragment, "says which field is wrong");
    eq(pushes.length, 0, "nothing was pushed");
    eq(kv.store.size, 0, "no order record was written");
  });
}

/* ================= delivery — the fee is the server's =================
 *
 * The county key is the only thing the browser says about delivery. Each case
 * below checks the three places the figure has to agree — the response, the
 * Amount in the request Daraja actually received, and the KV record the
 * callback is settled against — because a fee that is right in one and wrong in
 * another is a buyer charged one figure and shown another.
 */

const FEES = [
  ["nairobi-cbd", "Nairobi CBD", 0],
  ["nairobi-outside-cbd", "Nairobi (outside the CBD)", 200],
  ["kirinyaga", "Kirinyaga", 250],
  ["embu", "Embu", 150],
  ["turkana", "Turkana", 800],
];

for (const [key, label, fee] of FEES) {
  await check(`${label} is ${fee === 0 ? "free" : `KSh ${fee}`}, and the response, the push and the record agree`, async () => {
    const res = await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 1 }], county: key });
    eq(res.status, 200, "status");
    const body = await res.json();
    eq(body.total, 650 + fee, "total in the response");
    eq(pushes[0].Amount, 650 + fee, "Amount sent to Daraja");
    for (const copy of [await record(), await kv.get(`ref:${body.reference}`, "json")]) {
      eq(copy.subtotal, 650, "stored subtotal");
      eq(copy.delivery, { county: key, label, area: "Kilimani", landmark: "Blue gate beside the chemist", fee }, "stored delivery");
      eq(copy.amount, 650 + fee, "stored amount is subtotal + fee");
    }
  });
}

await check("the fee is one per order, not one per item", async () => {
  const res = await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 3 }], county: "turkana" });
  eq((await res.json()).total, 3 * 650 + 800, "total");
  eq(pushes[0].Amount, 2750, "Amount sent to Daraja");
});

await check("A CLIENT-SUPPLIED FEE, SUBTOTAL OR TOTAL IS IGNORED", async () => {
  const res = await push({
    ...ORDER,
    items: [{ slug: "crew-tee", qty: 1 }],
    county: "kirinyaga",
    fee: 0,
    deliveryFee: 0,
    delivery: { fee: 0, county: "nairobi-cbd" },
    subtotal: 1,
    total: 1,
    amount: 1,
  });
  eq(res.status, 200, "status");
  eq((await res.json()).total, 900, "total is 650 + 250, whatever the body said");
  eq(pushes[0].Amount, 900, "Amount sent to Daraja");
  const stored = await record();
  eq([stored.subtotal, stored.delivery.fee, stored.delivery.county, stored.amount], [650, 250, "kirinyaga", 900], "record");
});

await check("a free-delivery county still pushes a positive amount", async () => {
  await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 1 }], county: "nairobi-cbd" });
  if (!(pushes[0].Amount > 0)) throw new Error(`pushed ${pushes[0].Amount}`);
});

await check("area and landmark are stored as one trimmed line", async () => {
  await push({ ...ORDER, area: "  Kahawa   Sukari\n", landmark: "\tStage\r\nby the  mosque " });
  const stored = await record();
  eq([stored.delivery.area, stored.delivery.landmark], ["Kahawa Sukari", "Stage by the mosque"], "cleaned");
});

await check("markup in the area is stored as text, not stripped or run", async () => {
  /* Escaping happens where it is rendered — textContent in the cart, Astro on
     the server side — so storing it verbatim is correct. What must hold is that
     it is accepted as the string it is and reaches nothing as markup here. */
  const res = await push({ ...ORDER, area: "<img src=x onerror=alert(1)>" });
  eq(res.status, 200, "status");
  eq((await record()).delivery.area, "<img src=x onerror=alert(1)>", "stored verbatim");
  lacks(JSON.stringify(await res.json()), "<img", "the response does not echo it");
});

await check("every county in site.json is orderable, with its own fee", async () => {
  const zones = globalThis.__site.delivery.zones;
  eq(zones.length, 48, "47 counties, Nairobi split in two");
  for (const zone of zones) {
    pushes = [];
    const res = await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 1 }], county: zone.key });
    if (res.status !== 200) throw new Error(`${zone.key} refused with ${res.status}`);
    eq(pushes[0].Amount, 650 + zone.cost, `${zone.key} amount`);
  }
});

await check("a slug not in the catalogue is refused, never silently skipped", async () => {
  const res = await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 1 }, { slug: "not-a-product", qty: 1 }] });
  eq(res.status, 422, "status");
  has((await res.json()).message, "no longer available", "message");
  eq(pushes.length, 0, "nothing was pushed for a partly unknown order");
});

/* The 01 range is the half of Kenyan mobile numbering that 07 testing misses
   entirely: it normalises to 2541, not 2547, and a regex that only ever saw an
   07 number would pass while refusing every Airtel and Telkom line on the site. */
await check("every phone shape a buyer types normalises to the right msisdn", async () => {
  for (const [typed, expected] of [
    ["0712345678", "254712345678"],
    ["0112345678", "254112345678"],
    ["+254712345678", "254712345678"],
    ["254112345678", "254112345678"],
    ["0712 345 678", "254712345678"],
    ["0712-345-678", "254712345678"],
  ]) {
    const res = await push({ ...ORDER, phone: typed });
    if (res.status !== 200) throw new Error(`${typed} was refused with ${res.status}`);
    eq(pushes[pushes.length - 1].PhoneNumber, expected, `${typed} normalised`);
  }
});

await check("a blank email is accepted, and a real one is stored with the order", async () => {
  eq((await push({ ...ORDER, email: "   " })).status, 200, "blank accepted");
  eq((await record()).email, null, "blank stored as absent, not as whitespace");
  await push({ ...ORDER, email: "a@b.co" });
  eq((await record()).email, "a@b.co", "email stored");
});

await check("a quantity exactly at stock is accepted", async () => {
  const res = await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 6 }] });
  eq(res.status, 200, "status");
  eq((await res.json()).total, 3900, "total");
});

/* Both quantities sit inside stock, so the stock rule cannot fire and the
   duplicate rule is the only thing that can refuse this. Two lines of 6 would
   have been caught by the stock check instead, proving nothing about duplicates. */
await check("the same slug twice is refused rather than summed past the cap", async () => {
  const res = await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 2 }, { slug: "crew-tee", qty: 2 }] });
  eq(res.status, 400, "status");
  eq(pushes.length, 0, "nothing was pushed");
});

await check("a repeated slug cannot be used to exceed stock in total", async () => {
  const res = await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 4 }, { slug: "crew-tee", qty: 4 }] });
  if (res.status === 200) throw new Error("8 of a 6-stock product were accepted across two lines");
  eq(res.status, 400, "status");
});

await check("two references in a row differ", async () => {
  const a = (await (await push()).json()).reference;
  const b = (await (await push()).json()).reference;
  if (a === b) throw new Error(`reference repeated: ${a}`);
  if (!/^MA-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(a)) throw new Error(`reference shape: ${a}`);
});

await check("a GET on the push endpoint is refused", async () => {
  const res = await stk({
    request: new Request(`${ORIGIN}/api/mpesa/stk`, { method: "GET" }),
    env: baseEnv(),
  });
  eq(res.status, 405, "status");
  eq(res.headers.get("Allow"), "POST", "Allow header");
});

await check("push responses are never cached", async () => {
  const res = await push();
  eq(res.headers.get("Cache-Control"), "no-store", "Cache-Control");
  eq(res.headers.get("X-Content-Type-Options"), "nosniff", "nosniff");
});

/* ================= sizes — checked against the product's own list =================
   The checkout form posts a size as its own field, size-<slug>, from a native
   <select> on that line. The cart script never sees it. */

const SIZED = { ...ORDER, items: [{ slug: "sized-tee", qty: 1 }] };

for (const [label, extra] of [
  ["no size at all", {}],
  ["an empty size", { "size-sized-tee": "" }],
  ["a size the product is not made in", { "size-sized-tee": "XXL" }],
  ["a size in the wrong case", { "size-sized-tee": "m" }],
  ["a size that is not a string", { "size-sized-tee": 1 }],
  ["a size given as an object", { "size-sized-tee": { label: "M" } }],
  ["a size sent inside the item instead of the form field", { items: [{ slug: "sized-tee", qty: 1, size: "M" }] }],
]) {
  await check(`A SIZED PRODUCT WITHOUT A VALID SIZE IS REFUSED: ${label}`, async () => {
    const res = await push({ ...SIZED, ...extra });
    eq(res.status, 400, "status");
    const body = await res.json();
    eq(body.field, "size-sized-tee", "names the line's own size field");
    has(body.message, "Choose a size for the Sized tee", "says what to do");
    eq(pushes.length, 0, "nothing was pushed");
    eq(kv.store.size, 0, "no order record was written");
  });
}

await check("a valid size is pushed at the catalogue price and stored on the record", async () => {
  const res = await push({ ...SIZED, items: [{ slug: "sized-tee", qty: 2 }], "size-sized-tee": "L" });
  eq(res.status, 200, "status");
  eq(pushes[0].Amount, 1800, "2 x 900, Nairobi CBD is free");
  eq((await record()).items, [{ slug: "sized-tee", qty: 2, size: "L" }], "record items");
});

await check("a size posted for a product made in no sizes is ignored, and not stored", async () => {
  const res = await push({ ...ORDER, "size-crew-tee": "M" });
  eq(res.status, 200, "status");
  eq((await record()).items, [{ slug: "crew-tee", qty: 2 }], "record items carry no size key");
});

await check("a size field for a sized product not in the order is ignored", async () => {
  const res = await push({ ...ORDER, "size-sized-tee": "nonsense" });
  eq(res.status, 200, "the form posts every sized line's field, in the order or not");
});

await check("a sized line and an unsized line in one order: only the sized one carries a size", async () => {
  const res = await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 1 }, { slug: "sized-tee", qty: 1 }], "size-sized-tee": "M" });
  eq(res.status, 200, "status");
  eq((await record()).items, [{ slug: "crew-tee", qty: 1 }, { slug: "sized-tee", qty: 1, size: "M" }], "record items");
});

/* ================= sold out — the client cannot get one through =================
   The cart never offers a sold-out product, but storage and the request are the
   buyer's to edit. These are the hand-edited cart and the direct call. */

await check("A SOLD-OUT PRODUCT FROM A HAND-EDITED CART IS REFUSED, WHATEVER ELSE IS IN IT", async () => {
  const res = await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 1 }, { slug: "faith-hoodie", qty: 1 }] });
  eq(res.status, 409, "status");
  has((await res.json()).message, "Faith hoodie is sold out", "names the product");
  eq(pushes.length, 0, "nothing was pushed");
  eq(kv.store.size, 0, "no order record was written");
});

await check("a sold-out product with a client-supplied price or stock is still refused", async () => {
  const res = await push({ ...ORDER, items: [{ slug: "faith-hoodie", qty: 1, price: 1, stock: 99 }] });
  eq(res.status, 409, "status");
  eq(pushes.length, 0, "nothing was pushed");
});

/* ================= the callback ================= */

await check("a wrong path token is a 404 that admits nothing", async () => {
  await push();
  const res = await hit(callbackBody(), { token: "wrong-token" });
  eq(res.status, 404, "status");
  eq((await record()).status, "pending", "order untouched");
});

await check("a right token from a wrong IP is refused", async () => {
  await push();
  const res = await hit(callbackBody(), { ip: "203.0.113.9" });
  eq(res.status, 404, "status");
  eq((await record()).status, "pending", "order untouched");
});

await check("an empty allowlist FAILS CLOSED rather than accepting everyone", async () => {
  await push();
  const env = baseEnv();
  env.MPESA_CALLBACK_IPS = "";
  const res = await hit(callbackBody(), { env, ip: SAFARICOM_IP });
  eq(res.status, 404, "status");
  eq((await record()).status, "pending", "order untouched");
});

await check("a GET on the callback is a 404, not a hint", async () => {
  const res = await hit(undefined, { method: "GET" });
  eq(res.status, 404, "status");
});

await check("a successful callback settles the order paid, with the receipt", async () => {
  await push();
  const res = await hit(callbackBody());
  eq(res.status, 200, "status");
  eq((await res.json()).ResultCode, 0, "acknowledged");
  const stored = await record();
  eq(stored.status, "paid", "status");
  eq(stored.receipt, "RGX1A2B3C4", "receipt");
  eq(stored.via, "callback", "settled by the callback");
});

/* The record lives under two keys and /api/track only ever sees one of them.
   Settling the CheckoutRequestID copy alone leaves a buyer who has paid reading
   "payment not confirmed" on the tracking page until the record expires. */
await check("SETTLING WRITES THE ref: COPY TOO — the one /api/track reads", async () => {
  const { reference } = await (await push()).json();
  await hit(callbackBody());
  const byReference = await kv.get(`ref:${reference}`, "json");
  eq(byReference.status, "paid", "the reference copy is settled");
  eq(byReference.receipt, "RGX1A2B3C4", "and carries the same receipt");
  eq(byReference.reference, reference, "under its own reference");
});

await check("a failed callback settles the ref: copy as well", async () => {
  const { reference } = await (await push()).json();
  await hit(callbackBody({ code: 1032 }));
  eq((await kv.get(`ref:${reference}`, "json")).status, "failed", "the reference copy is failed");
});

await check("a mismatch flags the ref: copy as well", async () => {
  const { reference } = await (await push()).json();
  await hit(callbackBody({ amount: 1 }));
  const byReference = await kv.get(`ref:${reference}`, "json");
  eq(byReference.status, "mismatch", "the reference copy is flagged");
  eq(byReference.amount, 1300, "the stored amount is not overwritten");
});

/* ============ the ordering that makes the two copies safe ============
 *
 * WHAT FOLLOWS IS THE GATE BEHIND persist()'s ORDER OF WRITES, and until these
 * checks existed that ordering was a comment.
 *
 * settle() writes ref:<reference> FIRST and the CheckoutRequestID copy second,
 * and both failures propagate. The consequence is an invariant rather than a
 * repair: THE CANONICAL RECORD CANNOT BE TERMINAL UNLESS THE BUYER'S COPY WAS
 * WRITTEN TERMINAL FIRST. That is the whole reason the `already` path is allowed
 * to change nothing — it is unreachable with a stale mirror, so there is no
 * mirror to re-write there.
 *
 * Written the other way round the same failure would be permanent: the canonical
 * copy would go terminal, the retry would find it, return `already`, and never
 * come back for the reference copy. A buyer who had paid would read `pending`
 * for the full seven-day TTL. Nothing would have thrown, nothing would be
 * logged, and both records would be well-formed.
 *
 * So the failure injected here is not KV falling over — that case is covered
 * above and is loud. It is the quiet one: KV up, the order settling correctly,
 * and only the write the buyer reads not landing.
 *
 * A predicate that fails writes to `ref:` only would also break the push, which
 * writes that key before Daraja is called. So every case below pushes first and
 * arms the failure afterwards, which is also the real sequence: the record is
 * already on disk when the result arrives.
 */

const dropMirror = () => {
  kv.failWritesTo = (key) => key.startsWith("ref:");
};
const restoreMirror = () => {
  kv.failWritesTo = null;
};

/* The invariant itself, asserted as one thing rather than inferred from two.
   A terminal canonical record over a pending buyer's copy is the state this
   ordering exists to make unreachable, and it is worth naming in the failure. */
async function neitherAhead(reference, what) {
  const canonical = await record();
  const buyer = await kv.get(`ref:${reference}`, "json");
  if (canonical.status !== "pending" && buyer.status === "pending") {
    throw new Error(
      `${what}: the canonical record is ${canonical.status} while the copy /api/track ` +
        `reads is still pending — a buyer who has paid would be told nothing happened`
    );
  }
  return { canonical, buyer };
}

await check("A DROPPED ref: WRITE LEAVES THE CANONICAL RECORD PENDING — it does not settle alone", async () => {
  const { reference } = await (await push()).json();
  dropMirror();
  await hit(callbackBody());

  const { canonical, buyer } = await neitherAhead(reference, "after a dropped mirror write");
  eq(canonical.status, "pending", "the canonical record must not advance past the copy");
  eq(buyer.status, "pending", "the buyer's copy genuinely did not land");
});

await check("THE CALLBACK ANSWERS 500 ON THAT PATH, so Safaricom retries it", async () => {
  await push();
  dropMirror();
  const res = await hit(callbackBody());

  eq(res.status, 500, "a settle that did not complete must not be acknowledged");
  /* A 200 here is the dangerous answer, not merely the wrong one: Safaricom
     stops retrying what it sees acknowledged, and the retry is the only thing
     that finishes this order. */
  lacks(await res.text(), "ResultCode", "an acknowledgement Daraja would read as done");
});

await check("THE RETRY CONVERGES BOTH COPIES — the canonical was still pending, so settling runs again", async () => {
  const { reference } = await (await push()).json();
  dropMirror();
  await hit(callbackBody());
  restoreMirror();

  /* Safaricom resends what it did not see acknowledged. Because the canonical
     copy never left `pending`, this is a full settlement rather than the
     `already` path — which is exactly why `already` needs no repair of its own. */
  const res = await hit(callbackBody());
  eq(res.status, 200, "the retry is acknowledged");
  eq((await res.json()).ResultCode, 0, "and acknowledged as handled");

  const { canonical, buyer } = await neitherAhead(reference, "after the retry");
  eq(canonical.status, "paid", "the canonical record settled");
  eq(buyer.status, "paid", "THE RECORD /api/track READS settled with it");
  eq(buyer.receipt, "RGX1A2B3C4", "carrying the same receipt");
  eq(buyer.settledAt, canonical.settledAt, "as one write of one record, not two guesses at it");
});

/* The same failure down the other road. Only the callback path was covered
   before, and the status query is the second caller of the same settle() — the
   one that recovers an order whose callback never arrived at all. */

await check("THE STATUS QUERY NEVER REPORTS paid WHEN THE BUYER'S COPY DID NOT LAND", async () => {
  const body = await pushThenAge(120_000);
  dropMirror();
  const res = await askStatus(body);

  eq(res.status, 200, "the buyer's own poll is answered, not errored");
  /* Truthful rather than cautious: the canonical record IS still pending,
     because settle() refused to advance it. Reporting `paid` here would be the
     status query telling a buyer something its own record does not say. */
  eq((await res.json()).status, "pending", "reported status");
  const { canonical } = await neitherAhead(body.reference, "after a dropped mirror write via the query");
  eq(canonical.status, "pending", "and the record agrees with what was reported");
});

await check("the next poll converges both copies, with no callback involved", async () => {
  const body = await pushThenAge(120_000);
  dropMirror();
  await askStatus(body);
  restoreMirror();

  const res = await askStatus(body);
  eq((await res.json()).status, "paid", "reported status");
  const { canonical, buyer } = await neitherAhead(body.reference, "after the second poll");
  eq(canonical.status, "paid", "the canonical record settled");
  eq(buyer.status, "paid", "THE RECORD /api/track READS settled with it");
  eq(buyer.via, "query", "settled by the query, the callback never arrived");
});

await check("A DUPLICATE CALLBACK CHANGES NOTHING — idempotent on CheckoutRequestID", async () => {
  await push();
  await hit(callbackBody());
  const first = await record();
  const res = await hit(callbackBody({ receipt: "DIFFERENT" }));
  eq(res.status, 200, "the retry is still acknowledged");
  const second = await record();
  eq(second.settledAt, first.settledAt, "settled time unchanged");
  eq(second.receipt, "RGX1A2B3C4", "the first receipt stands");
});

await check("A FORGED AMOUNT IS NEVER PAID — it is recorded as a mismatch", async () => {
  await push();
  const res = await hit(callbackBody({ amount: 1 }));
  eq(res.status, 200, "still acknowledged");
  const stored = await record();
  eq(stored.status, "mismatch", "status");
  eq(stored.amount, 1300, "the stored amount is not overwritten");
  eq(stored.claimedAmount, 1, "what was claimed is kept for a human");
});

await check("an amount above the real one is also a mismatch, not a windfall", async () => {
  await push();
  await hit(callbackBody({ amount: 99999 }));
  eq((await record()).status, "mismatch", "status");
});

await check("the customer cancelling (1032) is a clean failure with the reason", async () => {
  await push();
  const res = await hit(callbackBody({ code: 1032 }));
  eq(res.status, 200, "acknowledged");
  const stored = await record();
  eq(stored.status, "failed", "status");
  eq(stored.resultCode, "1032", "result code kept");
  has(stored.failure, "cancelled", "reason kept");
});

for (const [code, what] of [
  [2001, "a wrong PIN"],
  [1, "insufficient balance"],
  [1037, "no response from the phone"],
]) {
  await check(`${what} (${code}) settles as failed, never as paid`, async () => {
    await push();
    await hit(callbackBody({ code }));
    const stored = await record();
    eq(stored.status, "failed", "status");
    eq(stored.resultCode, String(code), "result code");
  });
}

await check("a callback for an unknown id creates nothing", async () => {
  const res = await hit(callbackBody({ id: "ws_CO_NEVER_PUSHED" }));
  eq(res.status, 200, "acknowledged so Safaricom stops retrying");
  eq(await kv.get("ws_CO_NEVER_PUSHED", "json"), null, "no record was invented");
});

await check("an unreadable body is acknowledged rather than retried forever", async () => {
  const res = await callback({
    request: new Request(`${ORIGIN}/api/mpesa/callback/${TOKEN_PATH}`, {
      method: "POST",
      headers: { "CF-Connecting-IP": SAFARICOM_IP },
      body: "{{{not json",
    }),
    env: baseEnv(),
    params: { token: TOKEN_PATH },
  });
  eq(res.status, 200, "status");
});

await check("a body with no CheckoutRequestID is acknowledged and ignored", async () => {
  const res = await hit({ Body: { stkCallback: { ResultCode: 0 } } });
  eq(res.status, 200, "status");
});

await check("KV failing during settle returns 500 SO SAFARICOM RETRIES", async () => {
  await push();
  kv.failReads = true;
  const res = await hit(callbackBody());
  eq(res.status, 500, "the one case a retry can fix");
});

/* ================= the status query ================= */

await check("the status query needs the reference as well as the id", async () => {
  const body = await pushThenAge(0);
  const res = await askStatus({ checkoutRequestId: body.checkoutRequestId, reference: "MA-WRON-GREF" });
  eq(res.status, 404, "status");
  has((await res.json()).message, "No order was found", "same answer as no such order");
});

await check("inside the 90-second grace it reports pending without asking Daraja", async () => {
  const body = await pushThenAge(10_000);
  const res = await askStatus(body);
  eq((await res.json()).status, "pending", "status");
  eq(queries.length, 0, "Daraja was not queried while the customer is still holding the phone");
});

await check("A CALLBACK THAT NEVER ARRIVES IS RECOVERED BY THE QUERY", async () => {
  const body = await pushThenAge(120_000);
  queryReply = { ResultCode: "0", ResultDesc: "The service request is processed successfully." };
  const res = await askStatus(body);
  eq((await res.json()).status, "paid", "the payment is found");
  eq(queries.length, 1, "Daraja was queried once");
  const stored = await record();
  eq(stored.status, "paid", "settled");
  eq(stored.via, "query", "settled by the fallback");
});

await check("the query settles a failure as failed, with its reason", async () => {
  const body = await pushThenAge(120_000);
  queryReply = { ResultCode: "1032", ResultDesc: "Request cancelled by user" };
  const res = await askStatus(body);
  eq((await res.json()).status, "failed", "status");
  eq((await record()).resultCode, "1032", "result code");
});

await check("Daraja saying 'still processing' keeps the order pending", async () => {
  const body = await pushThenAge(120_000);
  darajaMode = "query_processing";
  const res = await askStatus(body);
  eq((await res.json()).status, "pending", "status");
  eq((await record()).status, "pending", "not settled either way");
});

await check("AN UNREACHABLE DARAJA DOES NOT TURN A LIVE PAYMENT INTO A FAILURE", async () => {
  const body = await pushThenAge(120_000);
  darajaMode = "query_unreachable";
  const res = await askStatus(body);
  eq((await res.json()).status, "pending", "stays pending");
  eq((await record()).status, "pending", "nothing was written");
});

await check("an order already settled is answered from KV without a query", async () => {
  const body = await pushThenAge(120_000);
  await hit(callbackBody());
  const res = await askStatus(body);
  eq((await res.json()).status, "paid", "status");
  eq(queries.length, 0, "Daraja was not asked about a settled order");
});

await check("a callback arriving after the query settled it changes nothing", async () => {
  const body = await pushThenAge(120_000);
  await askStatus(body);
  const first = await record();
  eq(first.status, "paid", "settled by query");
  await hit(callbackBody());
  const second = await record();
  eq(second.settledAt, first.settledAt, "the later callback did not re-settle it");
  eq(second.via, "query", "and did not rewrite how it settled");
});

/* The status response grew the amounts in a follow-up to phase 3, so
   /order-received can show what the order was charged rather than looking the
   fee up in today's table. What it must still never carry is everything else:
   the phone number, the receipt, where the order is going, or a claimed amount. */
await check("the status response carries the recorded amounts and nothing else", async () => {
  const body = await pushThenAge(120_000);
  await hit(callbackBody());
  const text = await (await askStatus(body)).text();
  const parsed = JSON.parse(text);
  eq(Object.keys(parsed).sort(), ["breakdown", "reference", "status"], "keys");
  eq(Object.keys(parsed.breakdown).sort(), ["fee", "subtotal", "total"], "breakdown keys");
  eq(parsed.breakdown.subtotal, "KSh 1,300", "subtotal");
  eq(parsed.breakdown.fee, "Free", "a zero fee is written as Free");
  eq(parsed.breakdown.total, "KSh 1,300", "total");
  lacks(text, "254712345678", "the phone number");
  lacks(text, "0712345678", "the phone number as typed");
  lacks(text, "RGX1A2B3C4", "the receipt");
  lacks(text, "Kilimani", "the area");
  lacks(text, "Blue gate", "the landmark");
  lacks(text, "Nairobi CBD", "the county");
});

await check("a county with a fee reports that fee and the total it was charged", async () => {
  await push({ ...ORDER, county: "kirinyaga" });
  const stored = await record();
  stored.pushedAt = Date.now() - 10_000;
  await kv.put("ws_CO_TEST_1", JSON.stringify(stored));
  const res = await askStatus({ checkoutRequestId: "ws_CO_TEST_1", reference: stored.reference });
  const { breakdown } = await res.json();
  eq(breakdown.fee, "KSh 250", "fee");
  eq(breakdown.total, "KSh 1,550", "total");
});

/* The Greptile P1 on #16. A fee changed in site.json after an order was placed
   must not reach the screen describing that order. The stored record is edited
   to a fee the current table does not have for its county; the response has to
   follow the record, because the record is what the buyer was charged. */
await check("THE AMOUNTS ARE THE ONES RECORDED, NOT TODAY'S FEE TABLE", async () => {
  const body = await pushThenAge(10_000);
  const stored = await record();
  stored.delivery = { ...stored.delivery, fee: 450 };
  stored.amount = 1750;
  await kv.put("ws_CO_TEST_1", JSON.stringify(stored));
  const { breakdown } = await (await askStatus(body)).json();
  eq(breakdown.fee, "KSh 450", "the fee on the record, though nairobi-cbd is free today");
  eq(breakdown.total, "KSh 1,750", "the total on the record");
});

await check("an order from before delivery fees reports its total and nothing it lacks", async () => {
  const body = await pushThenAge(10_000);
  const stored = await record();
  delete stored.delivery;
  delete stored.subtotal;
  await kv.put("ws_CO_TEST_1", JSON.stringify(stored));
  const { breakdown } = await (await askStatus(body)).json();
  eq(breakdown, { total: "KSh 1,300" }, "breakdown");
});

/* Greptile P1 on #17. The id is a KV key from the request, and the buyer's
   copy lives in the same namespace under ref:<reference>. Asking for that key
   with its own reference must not reach the order at all — not its status,
   not its amounts, and not a Daraja query or a settle at that key. */
for (const settledFirst of [false, true]) {
  await check(`THE REFERENCE ALONE CANNOT READ AN ORDER THROUGH ITS ref: KEY (${settledFirst ? "settled" : "pending, past grace"})`, async () => {
    const body = await pushThenAge(120_000);
    if (settledFirst) await hit(callbackBody());
    const before = (await record()).status;
    const res = await askStatus({ checkoutRequestId: `ref:${body.reference}`, reference: body.reference });
    const text = await res.text();
    eq(res.status, 404, "status");
    has(text, "No order was found", "the same answer as no such order");
    lacks(text, "breakdown", "the breakdown key");
    lacks(text, "1,300", "the total");
    eq(queries.length, 0, "Daraja was not queried");
    eq((await record()).status, before, "the order was not touched");
    eq((await kv.get(`ref:${body.reference}`, "json")).status, before, "nor its ref: copy");
  });
}

await check("a wrong reference gets no amounts", async () => {
  const body = await pushThenAge(10_000);
  const res = await askStatus({ checkoutRequestId: body.checkoutRequestId, reference: "MA-WRON-GREF" });
  const text = await res.text();
  eq(res.status, 404, "status");
  lacks(text, "breakdown", "the breakdown key");
  lacks(text, "1,300", "the total");
});

/* ================= promo codes =================
 *
 * The code decides the discount; the browser decides nothing. Every figure is
 * written into the case name, so a failure reads as arithmetic rather than as an
 * unexplained "expected 1080". `_promo.js` is loaded INSIDE each case, not at the
 * top of the file, so that when it is missing every case fails on its own
 * instead of the whole file dying before the first one runs.
 *
 * USE IS COUNTED AS MARKER KEYS, promo-use:<CODE>:<reference>, one per paid
 * order. There is no counter on the record to assert against; the cases count
 * keys. The concurrency cases turn kv.yieldOps on, so two requests interleave
 * their reads and writes the way two isolates do. */

const FAR = "2099-12-31T23:59:59+03:00";
const PAST = "2020-01-01T00:00:00+03:00";
const loadPromo = () => load("_promo.js");

const promoRecord = (over = {}) => ({
  percent: 10,
  endsAt: FAR,
  maxUses: null,
  oncePerPhone: false,
  active: true,
  channel: "test",
  ...over,
});
const seedPromo = (code, over) => kv.put(`promo:${code}`, JSON.stringify(promoRecord(over)));
const markers = (code) => [...kv.store.keys()].filter((k) => k.startsWith(`promo-use:${code}:`));
const seedMarkers = async (code, n) => {
  for (let i = 0; i < n; i++) await kv.put(`promo-use:${code}:MA-SEED-${i}`, `MA-SEED-${i}`);
};
const tee = (extra = {}, slug = "tee-1200", qty = 1) => ({ ...ORDER, items: [{ slug, qty }], ...extra });

/* A pushed promo order aged past the callback grace, so the status query will
   ask Daraja. */
const pushPromoThenAge = async (body) => {
  const res = await push(body);
  const out = await res.json();
  const stored = await record();
  stored.pushedAt = Date.now() - 120_000;
  stored.createdAt = stored.pushedAt;
  await kv.put("ws_CO_TEST_1", JSON.stringify(stored));
  return out;
};

await check("1. no code: items 1,200 + Nairobi CBD delivery 0 = 1,200 to Daraja as before, and the record keeps one shape", async () => {
  const res = await push(tee({ county: "nairobi-cbd" }));
  eq(pushes[0].Amount, 1200, "amount to Daraja, nothing taken off");
  eq((await res.json()).total, 1200, "total returned");
  const stored = await record();
  eq(
    [stored.promoCode, stored.promoPercent, stored.discountKsh, stored.itemsSubtotal],
    [null, null, 0, 1200],
    "promoCode, promoPercent, discountKsh, itemsSubtotal"
  );
  /* The same order with the field present but empty. */
  resetAll();
  await push(tee({ promo: "" }));
  eq(pushes[0].Amount, 1200, "an empty code is no code");
  await push(tee({ promo: "   " }));
  eq(pushes[1].Amount, 1200, "a blank code is no code");
  await push(tee({ promo: null }));
  eq(pushes[2].Amount, 1200, "a null code is no code");
});

await check("2. valid 10% on KSh 1,200: discount 120, items 1,080", async () => {
  await seedPromo("ALEX10");
  const res = await push(tee({ promo: "ALEX10" }));
  eq(res.status, 200, "status");
  eq(pushes[0].Amount, 1080, "amount to Daraja");
  eq((await res.json()).total, 1080, "total returned");
  const stored = await record();
  eq(
    [stored.promoCode, stored.promoPercent, stored.discountKsh, stored.itemsSubtotal, stored.subtotal, stored.amount],
    ["ALEX10", 10, 120, 1200, 1200, 1080],
    "recorded"
  );
});

await check("3. rounding: KSh 1,399 at 10% is 139.9, so discount 139 (floor), items 1,260", async () => {
  await seedPromo("ALEX10");
  await push(tee({ promo: "ALEX10" }, "tee-1399"));
  eq(pushes[0].Amount, 1260, "amount to Daraja");
  eq((await record()).discountKsh, 139, "discount");
});

await check("4. delivery is not discounted: items 1,200 + Kirinyaga 250, 10% off the items = 1,080 + 250 = 1,330", async () => {
  await seedPromo("ALEX10");
  await push(tee({ promo: "ALEX10", county: "kirinyaga" }));
  eq(pushes[0].Amount, 1330, "amount to Daraja");
  const stored = await record();
  eq([stored.delivery.fee, stored.discountKsh, stored.amount], [250, 120, 1330], "fee, discount, amount");
});

await check("5. a client-sent amount, discount or percent beside a valid code is ignored: still 1,080", async () => {
  await seedPromo("ALEX10");
  const res = await push(tee({ promo: "ALEX10", amount: 1, discount: 999, percent: 99, discountKsh: 999, total: 1 }));
  eq(res.status, 200, "status");
  eq(pushes[0].Amount, 1080, "amount to Daraja");
  const stored = await record();
  eq([stored.promoPercent, stored.discountKsh], [10, 120], "recorded percent and discount");
});

await check('6. " alex10 " resolves to ALEX10: trimmed and upper-cased, recorded as ALEX10', async () => {
  await seedPromo("ALEX10");
  await push(tee({ promo: " alex10 " }));
  eq(pushes[0].Amount, 1080, "amount to Daraja");
  eq((await record()).promoCode, "ALEX10", "recorded code");
});

await check('7. "AL EX!", 40 characters, a number and an object are rejected with the one body; none is "no code"', async () => {
  await seedPromo("ALEX10");
  const reference = await (await push(tee({ promo: "NOSUCH" }))).text();
  for (const bad of ["AL EX!", "A".repeat(40), "AB", "ALEX10;", 12345, { code: "ALEX10" }, ["ALEX10"], "ß".repeat(3)]) {
    const res = await push(tee({ promo: bad }));
    eq(res.status, 400, `status for ${JSON.stringify(bad)}`);
    eq(await res.text(), reference, `body for ${JSON.stringify(bad)}`);
  }
  eq(pushes.length, 0, "nothing was pushed");
});

await check("8. unknown, expired, not-yet-started, inactive, over-cap (2 markers, maxUses 2) and used-by-this-phone: one 400 body, no STK request, nothing recorded", async () => {
  const { phoneKey } = await loadPromo();
  await seedPromo("EXPIRED", { endsAt: PAST });
  await seedPromo("SOON", { startsAt: FAR });
  await seedPromo("OFF", { active: false });
  await seedPromo("FULL", { maxUses: 2 });
  await seedMarkers("FULL", 2);
  await seedPromo("ONCE", { oncePerPhone: true });
  await kv.put(`promo-phone:ONCE:${await phoneKey("254712345678")}`, "MA-OLD");

  const unknown = await push(tee({ promo: "NOSUCH" }));
  eq(unknown.status, 400, "unknown status");
  const body = await unknown.text();
  const message = JSON.parse(body).message;
  has(message, globalThis.__site.contact.phone, "the message carries the phone number");
  has(message, "Nothing has been charged", "says what happened to the money");

  for (const code of ["EXPIRED", "SOON", "OFF", "FULL", "ONCE"]) {
    const res = await push(tee({ promo: code }));
    eq(res.status, 400, `${code} status`);
    eq(await res.text(), body, `${code} body is the unknown-code body`);
  }
  eq(pushes.length, 0, "no STK request was sent");
  const orders = [...kv.store.keys()].filter((k) => k.startsWith("ref:") || k.startsWith("ws_"));
  eq(orders, [], "no order was recorded");
});

await check("9. a record with percent 0, 16, 150, 5.5 or '10', a bad date, a bad cap or active as a string behaves as unknown", async () => {
  const reference = await (await push(tee({ promo: "NOSUCH" }))).text();
  const broken = [
    { percent: 0 },
    { percent: 16 },
    { percent: 150 },
    { percent: 5.5 },
    { percent: "10" },
    { percent: -10 },
    { endsAt: "2099-12-31T23:59:59" },
    { endsAt: "2099-12-31" },
    { endsAt: "tomorrow" },
    { endsAt: undefined },
    { startsAt: "2020-01-01T00:00:00" },
    { maxUses: 0 },
    { maxUses: 1.5 },
    { maxUses: -1 },
    { active: "true" },
    { oncePerPhone: "true" },
  ];
  for (const [i, over] of broken.entries()) {
    await seedPromo("BROKEN", over);
    const res = await push(tee({ promo: "BROKEN" }));
    eq(res.status, 400, `status for ${JSON.stringify(over)} (#${i})`);
    eq(await res.text(), reference, `body for ${JSON.stringify(over)} (#${i})`);
  }
  eq(pushes.length, 0, "nothing was pushed");
  /* And 15 is the edge that IS allowed. */
  await seedPromo("EDGE15", { percent: 15 });
  await push(tee({ promo: "EDGE15" }));
  eq(pushes[0].Amount, 1020, "15% of 1,200 is 180, items 1,020");
});

await check("9b. maxUses of 0, 1001 and '5' make the record invalid; 1 and 1000 are the allowed edges", async () => {
  const reference = await (await push(tee({ promo: "NOSUCH" }))).text();
  for (const bad of [0, 1001, "5", 100000]) {
    await seedPromo("CAPPED", { maxUses: bad });
    const res = await push(tee({ promo: "CAPPED" }));
    eq(res.status, 400, `status for maxUses ${JSON.stringify(bad)}`);
    eq(await res.text(), reference, `body for maxUses ${JSON.stringify(bad)}`);
  }
  eq(pushes.length, 0, "nothing was pushed");
  for (const good of [1, 1000]) {
    await seedPromo("CAPPED", { maxUses: good });
    eq((await push(tee({ promo: "CAPPED" }))).status, 200, `maxUses ${good}`);
  }
});

await check("10. the discount is clamped so a KSh 1 items total cannot reach zero", async () => {
  const { discountFor } = await loadPromo();
  eq(discountFor(1, 100), 0, "1 at 100%");
  eq(discountFor(2, 100), 1, "2 at 100%");
  eq(discountFor(1, 15), 0, "1 at 15%");
  eq(discountFor(0, 10), 0, "nothing to discount");
  eq(discountFor(1200, 10), 120, "1,200 at 10%");
  await seedPromo("ALEX10");
  await push(tee({ promo: "ALEX10" }, "one-bob"));
  eq(pushes[0].Amount, 1, "the amount sent to Daraja");
  eq((await record()).discountKsh, 0, "discount");
});

await check("11. a KSh 10 item with a 10% code: discount 1, items 9", async () => {
  await seedPromo("ALEX10");
  await push(tee({ promo: "ALEX10" }, "ten-bob"));
  eq(pushes[0].Amount, 9, "the live-test amount");
  eq((await record()).discountKsh, 1, "discount");
});

await check("12. an STK push that is never completed leaves no marker; a cancelled prompt and a forged undiscounted success leave none either", async () => {
  await seedPromo("ALEX10");
  await push(tee({ promo: "ALEX10" }));
  eq((await record()).promoCode, "ALEX10", "the code is on the order");
  eq(markers("ALEX10").length, 0, "markers after the push");
  await hit(callbackBody({ code: 1032 }));
  eq(markers("ALEX10").length, 0, "markers after a cancelled prompt");
  resetAll();
  await seedPromo("ALEX10");
  await push(tee({ promo: "ALEX10" }));
  await hit(callbackBody({ amount: 1200 }));
  eq((await record()).status, "mismatch", "a callback for the undiscounted amount is a mismatch");
  eq(markers("ALEX10").length, 0, "markers after a mismatch");
});

await check("13a. a paid callback leaves one marker named for the order, and the same callback replayed leaves it at one", async () => {
  await seedPromo("ALEX10");
  await push(tee({ promo: "ALEX10" }));
  await hit(callbackBody({ amount: 1080 }));
  const stored = await record();
  eq(stored.status, "paid", "status");
  eq(markers("ALEX10"), [`promo-use:ALEX10:${stored.reference}`], "the marker");
  eq(await kv.get(`promo-use:ALEX10:${stored.reference}`), stored.reference, "its value is the reference");
  await hit(callbackBody({ amount: 1080 }));
  await hit(callbackBody({ amount: 1080 }));
  eq(markers("ALEX10").length, 1, "markers after two replays");
});

await check("13b. a callback and then a status query for one order leave one marker", async () => {
  await seedPromo("ALEX10");
  const body = await pushPromoThenAge(tee({ promo: "ALEX10" }));
  await hit(callbackBody({ amount: 1080 }));
  await askStatus(body);
  eq(markers("ALEX10").length, 1, "markers");
});

await check("13c. a status query and then a callback for one order leave one marker", async () => {
  await seedPromo("ALEX10");
  const body = await pushPromoThenAge(tee({ promo: "ALEX10" }));
  await askStatus(body);
  eq((await record()).status, "paid", "settled by the query");
  eq(markers("ALEX10").length, 1, "markers after the query");
  await hit(callbackBody({ amount: 1080 }));
  eq(markers("ALEX10").length, 1, "markers after the callback");
});

await check("13d. a failed marker write leaves the order pending; the retry pays it and leaves one marker", async () => {
  await seedPromo("ALEX10");
  await push(tee({ promo: "ALEX10" }));
  kv.failWritesTo = (key) => key.startsWith("promo-use:");
  const first = await hit(callbackBody({ amount: 1080 }));
  eq(first.status, 500, "the callback is not acknowledged, so Safaricom retries");
  eq((await record()).status, "pending", "the order is not marked paid without its marker");
  eq(markers("ALEX10").length, 0, "no marker");
  kv.failWritesTo = null;
  eq((await hit(callbackBody({ amount: 1080 }))).status, 200, "the retry");
  eq((await record()).status, "paid", "paid on the retry");
  eq(markers("ALEX10").length, 1, "markers after the retry");
});

await check("13e. a failed paid write after the marker is written is recovered by the retry, still one marker", async () => {
  await seedPromo("ALEX10");
  await push(tee({ promo: "ALEX10" }));
  /* persist() writes the buyer's ref: copy first; failing it fails the paid
     write, after the marker has landed. */
  kv.failWritesTo = (key) => key.startsWith("ref:");
  const first = await hit(callbackBody({ amount: 1080 }));
  eq(first.status, 500, "not acknowledged");
  eq(markers("ALEX10").length, 1, "the marker landed before the paid write");
  eq((await record()).status, "pending", "and the order is still pending");
  kv.failWritesTo = null;
  eq((await hit(callbackBody({ amount: 1080 }))).status, 200, "the retry");
  eq((await record()).status, "paid", "paid on the retry");
  eq(markers("ALEX10").length, 1, "still one marker");
});

await check("13g. two DIFFERENT orders on one code settled together, KV yielding between operations, leave exactly 2 markers", async () => {
  await seedPromo("ALEX10");
  checkoutIds = ["ws_CO_A", "ws_CO_B"];
  const a = await (await push(tee({ promo: "ALEX10" }))).json();
  const b = await (await push(tee({ promo: "ALEX10", phone: "0722345678" }))).json();
  kv.yieldOps = true;
  await Promise.all([hit(callbackBody({ id: "ws_CO_A", amount: 1080 })), hit(callbackBody({ id: "ws_CO_B", amount: 1080 }))]);
  kv.yieldOps = false;
  eq((await kv.get("ws_CO_A", "json")).status, "paid", "order A");
  eq((await kv.get("ws_CO_B", "json")).status, "paid", "order B");
  eq(markers("ALEX10").sort(), [`promo-use:ALEX10:${a.reference}`, `promo-use:ALEX10:${b.reference}`].sort(), "one marker each");
});

await check("13h. a callback and a status query overlapping for ONE order leave 1 marker", async () => {
  await seedPromo("ALEX10");
  const body = await pushPromoThenAge(tee({ promo: "ALEX10" }));
  kv.yieldOps = true;
  await Promise.all([hit(callbackBody({ amount: 1080 })), askStatus(body)]);
  kv.yieldOps = false;
  eq((await record()).status, "paid", "paid");
  eq(markers("ALEX10").length, 1, "markers");
});

await check("13i. an order paid after the cap was reached is still honoured: the cap is judged at push time only", async () => {
  await seedPromo("LAST1", { maxUses: 1 });
  await push(tee({ promo: "LAST1" }));
  await seedMarkers("LAST1", 1);
  await hit(callbackBody({ amount: 1080 }));
  eq((await record()).status, "paid", "still paid");
  eq(markers("LAST1").length, 2, "overshoots by the order in flight");
});

await check("14. oncePerPhone: a second order from the same phone is refused, a different phone is accepted", async () => {
  await seedPromo("TEAM15-TEST", { oncePerPhone: true, percent: 15, maxUses: 20 });
  const first = await push(tee({ promo: "TEAM15-TEST" }));
  eq(first.status, 200, "first order");
  eq(pushes[0].Amount, 1020, "15% off 1,200");
  eq((await record()).promoOncePerPhone, true, "recorded on the order, so settle() never reads the promo record");
  await hit(callbackBody({ amount: 1020 }));
  eq(markers("TEAM15-TEST").length, 1, "counted at payment");

  const same = await push(tee({ promo: "TEAM15-TEST", phone: "0712 345 678" }));
  eq(same.status, 400, "the same phone, typed differently");
  eq(pushes.length, 1, "no second STK request");

  const other = await push(tee({ promo: "TEAM15-TEST", phone: "0722345678" }));
  eq(other.status, 200, "a different phone");
  eq(pushes.length, 2, "its STK request was sent");
});

await check("14b. oncePerPhone is not spent by a push that was never paid", async () => {
  await seedPromo("TEAM15-TEST", { oncePerPhone: true, percent: 15 });
  eq((await push(tee({ promo: "TEAM15-TEST" }))).status, 200, "first push");
  eq((await push(tee({ promo: "TEAM15-TEST" }))).status, 200, "the same phone again, unpaid");
  eq(pushes.map((p) => p.Amount), [1020, 1020], "both at the discounted figure: 15% off 1,200");
});

await check("15. the status endpoint returns the RECORDED percent and discount after the record is edited to 15% and after it is deleted", async () => {
  await seedPromo("ALEX10");
  const body = await pushPromoThenAge(tee({ promo: "ALEX10" }));
  const ask = async () => (await (await askStatus(body)).json()).breakdown;
  const recorded = { promoCode: "ALEX10", promoPercent: 10, discountKsh: 120, itemsSubtotal: 1200 };
  const pick = (b) => ({ promoCode: b.promoCode, promoPercent: b.promoPercent, discountKsh: b.discountKsh, itemsSubtotal: b.itemsSubtotal });

  eq(pick(await ask()), recorded, "as placed");
  await seedPromo("ALEX10", { percent: 15 });
  eq(pick(await ask()), recorded, "after the record was edited to 15%");
  kv.store.delete("promo:ALEX10");
  eq(pick(await ask()), recorded, "after the record was deleted");

  /* Wrong reference: no promo fields, and nothing else either. */
  const wrong = await askStatus({ checkoutRequestId: body.checkoutRequestId, reference: "MA-WRON-GREF" });
  lacks(await wrong.text(), "ALEX10", "the code, to a caller without the reference");
});

await check("15b. (a guard: passes before the change too) an order with no code answers with exactly the breakdown keys it always had", async () => {
  const body = await pushPromoThenAge(tee());
  const { breakdown } = await (await askStatus(body)).json();
  eq(Object.keys(breakdown).sort(), ["fee", "subtotal", "total"], "keys");
});

await check("15c. a recorded discount of 0 is SENT, as the number 0 beside the code and percent, so the confirmation can say KSh 0 instead of hiding the row", async () => {
  await seedPromo("ALEX10");
  const body = await pushPromoThenAge(tee({ promo: "ALEX10" }));
  const stored = await record();
  stored.discountKsh = 0;
  await kv.put("ws_CO_TEST_1", JSON.stringify(stored));
  const { breakdown } = await (await askStatus(body)).json();
  eq(Object.hasOwn(breakdown, "discountKsh"), true, "the key is present");
  eq(breakdown.discountKsh, 0, "and it is the number 0, not absent and not a string");
  eq([breakdown.promoCode, breakdown.promoPercent], ["ALEX10", 10], "beside the code and percent");
  /* The page's half: fill() in cart.ts hides a row on null or undefined and on
     nothing else, so this 0 is written as "KSh 0" (data-pre) and an order with no
     code, which has no such key at all, shows none of the promo rows. Checked in
     a browser for this PR; nothing in this repo can run the cart. */
});

await check("16. no raw phone number appears in any KV key written during a full promo order", async () => {
  await seedPromo("TEAM15-TEST", { oncePerPhone: true, percent: 15 });
  const written = [];
  const put = kv.put.bind(kv);
  kv.put = async (key, value, opts) => {
    written.push(key);
    return put(key, value, opts);
  };
  const body = await pushPromoThenAge(tee({ promo: "TEAM15-TEST" }));
  await askStatus(body);
  await hit(callbackBody({ amount: 1020 }));
  const keys = [...written, ...kv.store.keys()];
  for (const key of keys) {
    for (const raw of ["0712345678", "712345678", "254712345678"]) lacks(key, raw, `KV key ${key}`);
  }
  const phoneKeys = keys.filter((k) => k.startsWith("promo-phone:"));
  if (phoneKeys.length === 0) throw new Error("no promo-phone key was written, so this case proved nothing");
  if (!/^promo-phone:TEAM15-TEST:[0-9a-f]{64}$/.test(phoneKeys[0])) throw new Error(`unexpected key shape: ${phoneKeys[0]}`);
});

await check("17. the cap counts markers: maxUses 2 with 2 markers is refused, with 1 marker accepted; ALEX100's markers are not ALEX10's", async () => {
  await seedPromo("ALEX10", { maxUses: 2 });
  await seedMarkers("ALEX10", 2);
  eq((await push(tee({ promo: "ALEX10" }))).status, 400, "2 of 2");
  kv.store.delete("promo-use:ALEX10:MA-SEED-1");
  eq((await push(tee({ promo: "ALEX10" }))).status, 200, "1 of 2");
  await seedMarkers("ALEX100", 5);
  eq((await push(tee({ promo: "ALEX10" }))).status, 200, "1 of 2 beside five markers on ALEX100");
});

await check("17b. the cap follows the list cursor to the end: 5 markers over pages of 2 refuse maxUses 5, 4 accept", async () => {
  kv.pageSize = 2;
  await seedPromo("ALEX10", { maxUses: 5 });
  await seedMarkers("ALEX10", 5);
  eq((await push(tee({ promo: "ALEX10" }))).status, 400, "5 of 5 across three pages");
  kv.store.delete("promo-use:ALEX10:MA-SEED-4");
  eq((await push(tee({ promo: "ALEX10" }))).status, 200, "4 of 5 across two pages");
});

await check("17c. a failed list is unavailable, not 'invalid'; a code with no cap never lists", async () => {
  await seedPromo("CAPPED", { maxUses: 5 });
  await seedPromo("ALEX10");
  kv.failLists = true;
  const res = await push(tee({ promo: "CAPPED" }));
  eq(res.status, 503, "status");
  has((await res.json()).message, "not responding right now", "says it is us");
  eq(pushes.length, 0, "nothing was pushed");
  /* An uncapped code never lists ITS OWN prefix. It no longer follows that the
     push survives a failed list: the stock count lists too, and a push that
     cannot count stock is a 503 whatever the code (S10). What is asserted here is
     the narrower, still-true thing: no promo-use list was asked for. */
  kv.failLists = false;
  kv.listed.length = 0;
  await push(tee({ promo: "ALEX10" }));
  eq(kv.listed.filter((p) => p.startsWith("promo-use:")), [], "an uncapped code does not list its uses");
});

await check("17d. a promo record that is not JSON is a bad record: the common 400, never a 503", async () => {
  const reference = await (await push(tee({ promo: "NOSUCH" }))).text();
  /* Straight into KV, not through seedPromo(), which would write valid JSON. */
  for (const raw of ["{not json", "null", "[]", "42", '"ALEX10"', "{"]) {
    await kv.put("promo:BADJSON", raw);
    const res = await push(tee({ promo: "BADJSON" }));
    eq(res.status, 400, `status for ${JSON.stringify(raw)}`);
    eq(await res.text(), reference, `body for ${JSON.stringify(raw)}`);
  }
  eq(pushes.length, 0, "nothing was pushed");
});

await check("a promo that cannot be read (KV down) is unavailable, not 'invalid', and nothing is pushed", async () => {
  kv.failReads = true;
  const res = await push(tee({ promo: "ALEX10" }));
  eq(res.status, 503, "status");
  has((await res.json()).message, "not responding right now", "says it is us");
  eq(pushes.length, 0, "nothing was pushed");
});

await check("markers and phone keys are written with no expirationTtl, the promo record is never written, and the code is never logged beside a phone number", async () => {
  await seedPromo("ALEX10", { oncePerPhone: true });
  const puts = [];
  const put = kv.put.bind(kv);
  kv.put = async (key, value, opts) => {
    puts.push([key, opts]);
    return put(key, value, opts);
  };
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    const body = await pushPromoThenAge(tee({ promo: "ALEX10", phone: "0712345678" }));
    await askStatus(body);
    await hit(callbackBody({ amount: 1080 }));
    kv.failReads = true;
    await push(tee({ promo: "ALEX10" }));
  } finally {
    console.log = log;
  }
  eq(puts.filter(([k]) => k === "promo:ALEX10"), [], "the handlers never write the promo record");
  const useWrites = puts.filter(([k]) => k.startsWith("promo-use:") || k.startsWith("promo-phone:"));
  eq(useWrites.length, 2, "one marker and one phone key");
  eq(useWrites.map(([, opts]) => opts), [undefined, undefined], "no options, so no seven-day expiry (putPending would add one)");
  for (const line of lines) {
    if (line.includes("ALEX10") && (line.includes("254712345678") || line.includes("0712345678") || line.includes("Amina"))) {
      throw new Error(`a log line carries the code and a buyer: ${line}`);
    }
  }
});


/* ================= the promo preview, /api/promo/check =================
 *
 * ADVISORY, and these cases hold it to that: it never writes, never counts a use,
 * never reads a figure from the request, and its figures are the ones the push then
 * sends to Daraja. Case P1 is the one that matters most — the previewed total and
 * the amount asked of the buyer's phone are asserted equal, in the same case, from
 * the same basket. */

const checkPromo = (body, env = baseEnv(), method = "POST") =>
  promoCheck({
    request: new Request(`${ORIGIN}/api/promo/check`, {
      method,
      body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    }),
    env,
  });
const basket = (slug = "tee-1200", qty = 1) => [{ slug, qty }];
/* What the checkout page shows as the total: the server's items, less the server's
   discount, plus the delivery fee the page already holds for the county. */
const previewedTotal = (answer, fee) => answer.itemsSubtotal - answer.discountKsh + fee;

await check("P1. preview of ALEX10 on KSh 1,200: 10%, KSh 120 off, items 1,200 — and the push then sends exactly the previewed total", async () => {
  await seedPromo("ALEX10");
  const res = await checkPromo({ promo: "ALEX10", lines: basket() });
  eq(res.status, 200, "status");
  const answer = await res.json();
  eq(answer, { ok: true, percent: 10, itemsSubtotal: 1200, discountKsh: 120 }, "the preview, exactly these four keys");
  /* Kirinyaga is 250: delivery is added after the discount and never discounted. */
  const previewed = previewedTotal(answer, 250);
  eq(previewed, 1330, "previewed total: 1,200 - 120 + 250");
  const pushed = await push(tee({ promo: "ALEX10", county: "kirinyaga" }));
  eq(pushed.status, 200, "the push");
  eq(pushes[0].Amount, previewed, "amount sent to Daraja equals the previewed total");
  eq((await pushed.json()).total, previewed, "total the push reports equals the previewed total");
  const stored = await record();
  eq([stored.discountKsh, stored.itemsSubtotal], [answer.discountKsh, answer.itemsSubtotal], "the push recorded the figures the preview showed");
});

await check("P2. preview and push agree on rounding too: KSh 1,399 at 10% is 139.9, discount 139 on both", async () => {
  await seedPromo("ALEX10");
  const answer = await (await checkPromo({ promo: "ALEX10", lines: basket("tee-1399") })).json();
  eq([answer.itemsSubtotal, answer.discountKsh], [1399, 139], "preview");
  await push(tee({ promo: "ALEX10" }, "tee-1399"));
  eq(pushes[0].Amount, previewedTotal(answer, 0), "Daraja amount, Nairobi CBD delivery free");
});

await check("P3. a code typed in lower case with spaces previews like the code (the server normalises)", async () => {
  await seedPromo("ALEX10");
  const answer = await (await checkPromo({ promo: "  alex10 ", lines: basket() })).json();
  eq(answer.ok, true, "ok");
  eq(answer.discountKsh, 120, "discount");
});

await check("P4. a client price, percent or discount in the request is read past: the catalogue and the record decide", async () => {
  await seedPromo("ALEX10");
  const answer = await (
    await checkPromo({
      promo: "ALEX10",
      lines: [{ slug: "tee-1200", qty: 1, price: 1, amount: 1, discount: 999 }],
      price: 1,
      percent: 99,
      discountKsh: 999,
      itemsSubtotal: 1,
      total: 1,
    })
  ).json();
  eq(answer, { ok: true, percent: 10, itemsSubtotal: 1200, discountKsh: 120 }, "catalogue price 1,200 and the record's 10 percent");
});

await check("P5. a quantity multiplies the catalogue price: 3 x 1,200 = 3,600, 10% = 360", async () => {
  await seedPromo("ALEX10");
  const answer = await (await checkPromo({ promo: "ALEX10", lines: basket("tee-1200", 3) })).json();
  eq([answer.itemsSubtotal, answer.discountKsh], [3600, 360], "figures");
});

await check("P6. an unknown, ended, unstarted, switched-off and used-up code, and a malformed one, all answer with ONE body", async () => {
  await seedPromo("ENDED", { endsAt: PAST });
  await seedPromo("LATER", { startsAt: FAR });
  await seedPromo("OFF", { active: false });
  await seedPromo("FULL", { maxUses: 1 });
  await seedMarkers("FULL", 1);
  const bodies = [];
  for (const code of ["NOSUCH", "ENDED", "LATER", "OFF", "FULL", "x", "has space", "", "   "]) {
    const res = await checkPromo({ promo: code, lines: basket() });
    eq(res.status, 200, `status for ${JSON.stringify(code)}`);
    bodies.push(await res.text());
  }
  eq(new Set(bodies).size, 1, "every refusal is the same body, byte for byte");
  const refused = JSON.parse(bodies[0]);
  eq(refused.ok, false, "ok false");
  has(refused.message, "not valid or has ended", "the message says what happened");
  has(refused.message, "0753 181 901", "and carries the shop number");
  eq(Object.keys(refused).sort(), ["message", "ok"], "no field that tells the reasons apart");
});

await check("P7. a code that is not a string is refused the same way, never read as no code", async () => {
  await seedPromo("ALEX10");
  const refused = await (await checkPromo({ promo: "NOSUCH", lines: basket() })).text();
  for (const promo of [10, ["ALEX10"], { code: "ALEX10" }, true, null, undefined]) {
    const res = await checkPromo({ promo, lines: basket() });
    eq(await res.text(), refused, `promo ${JSON.stringify(promo)}`);
  }
});

await check("P8. it NEVER writes to KV: no marker, no counter, no promo record change, no throttle key", async () => {
  await seedPromo("ALEX10", { maxUses: 5, oncePerPhone: true });
  const writes = [];
  const put = kv.put.bind(kv);
  kv.put = async (...args) => (writes.push(args[0]), put(...args));
  const before = [...kv.store.entries()];
  for (const promo of ["ALEX10", "NOSUCH", "alex10"]) {
    await checkPromo({ promo, lines: basket() });
  }
  eq(writes, [], "no put at all");
  eq([...kv.store.entries()], before, "the store is exactly as it was");
  eq(markers("ALEX10"), [], "no use counted");
});

await check("P9. asking does not use the code up: a code with one use left previews twice, and the push still takes it", async () => {
  await seedPromo("LAST1", { maxUses: 1 });
  eq((await (await checkPromo({ promo: "LAST1", lines: basket() })).json()).ok, true, "first preview");
  eq((await (await checkPromo({ promo: "LAST1", lines: basket() })).json()).ok, true, "second preview");
  eq((await push(tee({ promo: "LAST1" }))).status, 200, "the push is not refused");
});

await check("P10. a used-up code previews as refused, from the markers, exactly as the push counts it", async () => {
  await seedPromo("CAPPED", { maxUses: 2 });
  await seedMarkers("CAPPED", 2);
  eq((await (await checkPromo({ promo: "CAPPED", lines: basket() })).json()).ok, false, "preview");
  eq((await push(tee({ promo: "CAPPED" }))).status, 400, "and the push agrees");
});

await check("P11. STATED LIMIT: once-per-phone cannot be judged without a phone, so the preview says ok and the push is the one that refuses", async () => {
  const { phoneKey } = await loadPromo();
  await seedPromo("TEAM15-TEST", { percent: 15, oncePerPhone: true });
  await kv.put(`promo-phone:TEAM15-TEST:${await phoneKey("254712345678")}`, "MA-OLD");
  eq((await (await checkPromo({ promo: "TEAM15-TEST", lines: basket() })).json()).ok, true, "the preview cannot know");
  const refused = await push(tee({ promo: "TEAM15-TEST" }));
  eq(refused.status, 400, "the push refuses it");
  eq(pushes.length, 0, "and sends nothing to Daraja");
});

await check("P12. an unreadable request is a 400, never a priced one: bad JSON, no lines, too many, a duplicate, a bad quantity, an unknown slug", async () => {
  await seedPromo("ALEX10");
  const withLines = (lines) => JSON.stringify({ promo: "ALEX10", lines });
  const bad = [
    "not json",
    "null",
    "[]",
    JSON.stringify({ promo: "ALEX10" }),
    withLines([]),
    withLines("tee-1200"),
    withLines(Array.from({ length: 11 }, (_, i) => ({ slug: i ? "tee-1399" : "tee-1200", qty: 1 }))),
    withLines([{ slug: "tee-1200", qty: 1 }, { slug: "tee-1200", qty: 1 }]),
    withLines([{ slug: "tee-1200", qty: 0 }]),
    withLines([{ slug: "tee-1200", qty: 1.5 }]),
    withLines([{ slug: "tee-1200", qty: "2" }]),
    withLines([{ slug: "tee-1200", qty: 100 }]),
    withLines([{ slug: "nope", qty: 1 }]),
    withLines([{ slug: 7, qty: 1 }]),
    withLines([null]),
    withLines([{ slug: "__proto__", qty: 1 }]),
  ];
  for (const body of bad) {
    const res = await checkPromo(body);
    eq(res.status, 400, `status for ${body.slice(0, 60)}`);
    eq((await res.json()).ok, false, `ok for ${body.slice(0, 60)}`);
  }
});

await check("P13. a KV that cannot be read is a 503 with its own message, NOT the refusal, and the code is not logged", async () => {
  await seedPromo("ALEX10");
  kv.failReads = true;
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(String(line));
  let res;
  try {
    res = await checkPromo({ promo: "ALEX10", lines: basket() });
  } finally {
    console.log = log;
  }
  eq(res.status, 503, "status");
  const body = await res.json();
  eq(body.ok, false, "ok false");
  lacks(body.message, "not valid", "an outage is not worded as an invalid code");
  has(body.message, "0753 181 901", "and carries the shop number");
  eq(lines.length, 1, "one log line");
  lacks(lines.join(" "), "ALEX10", "the code is not logged");
});

await check("P14. a list that fails while counting uses is a 503 too, not a refusal", async () => {
  await seedPromo("CAPPED", { maxUses: 3 });
  kv.failLists = true;
  eq((await checkPromo({ promo: "CAPPED", lines: basket() })).status, 503, "status");
});

await check("P15. only POST: GET is 405, and a response is never cached or sniffed", async () => {
  const get = await checkPromo(null, baseEnv(), "GET");
  eq(get.status, 405, "GET");
  eq(get.headers.get("Allow"), "POST", "Allow");
  await seedPromo("ALEX10");
  const ok = await checkPromo({ promo: "ALEX10", lines: basket() });
  eq(ok.headers.get("Cache-Control"), "no-store", "no-store");
  eq(ok.headers.get("X-Content-Type-Options"), "nosniff", "nosniff");
});

await check("P16. a sold-out line is priced by the preview (stock is the push's to refuse, and it does, by name)", async () => {
  await seedPromo("ALEX10");
  eq((await (await checkPromo({ promo: "ALEX10", lines: basket("faith-hoodie") })).json()).ok, true, "priced from the catalogue regardless of stock");
  eq((await push(tee({ promo: "ALEX10" }, "faith-hoodie"))).status, 409, "the push says sold out");
});

await check("P17. the refusal in the preview and the refusal from the push say the same thing, apart from what each can claim", async () => {
  const previewed = (await (await checkPromo({ promo: "NOSUCH", lines: basket() })).json()).message;
  const pushed = await (await push(tee({ promo: "NOSUCH" }))).json();
  eq(pushed.field, "promo", "the push names the field");
  eq(
    previewed,
    pushed.message.replace(" Nothing has been charged.", "").replace("Remove the code", "Remove it"),
    "same words"
  );
});

/* ================= stock that counts down: sold: markers =================
 *
 * A paid order writes one sold:<slug>:<reference> marker per line, and an order
 * is checked against stock MINUS the markers written since the figure was
 * counted. Nothing writes the catalogue; the catalogue is a file in the build.
 * Every figure is in the case name. */

const sold = (slug, reference, qty, at) =>
  kv.put(`sold:${slug}:${reference}`, String(qty), { metadata: { qty, at } });
const soldKeys = (slug = "") => [...kv.store.keys()].filter((k) => k.startsWith(`sold:${slug}`)).sort();
const seedSold = async (slug, n, at = COUNTED + 60_000) => {
  for (let i = 0; i < n; i++) await sold(slug, `MA-SEED-${i}`, 1, at);
};
const stockOrder = (lines, extra = {}) => ({ ...ORDER, items: lines, ...extra });
const catalogueEntry = (slug) => globalThis.__catalogue.find((p) => p.slug === slug);

await check("S1. stock 20, 0 sold: an order for 1 is accepted; with 20 sold after the count, an order for 1 is refused (409) and nothing is pushed", async () => {
  eq((await push(stockOrder([{ slug: "tee-1", qty: 1 }]))).status, 200, "accepted with none sold");
  eq(pushes.length, 1, "one push");
  resetAll();
  await seedSold("tee-1", 20);
  const res = await push(stockOrder([{ slug: "tee-1", qty: 1 }]));
  eq(res.status, 409, "status");
  has((await res.json()).message, "Tee 1 is sold out, so this order cannot be sent", "the existing sold-out message");
  eq(pushes.length, 0, "nothing was pushed");
});

await check("S2. stock 20, 18 sold: an order for 2 is accepted, an order for 3 is refused naming 2", async () => {
  await seedSold("tee-1", 18);
  eq((await push(stockOrder([{ slug: "tee-1", qty: 2 }]))).status, 200, "2 of 2 remaining");
  const res = await push(stockOrder([{ slug: "tee-1", qty: 3 }]));
  eq(res.status, 409, "3 of 2 remaining");
  has((await res.json()).message, "only 2 of the Tee 1 left", "prints what remains, not the catalogue's 20");
});

await check("S3. stock 20: 5 sold before the count are not subtracted, 1 sold at the count is", async () => {
  for (let i = 0; i < 5; i++) await sold("tee-1", `MA-OLD-${i}`, 1, COUNTED - 1);
  await sold("tee-1", "MA-AT", 1, COUNTED);
  eq((await push(stockOrder([{ slug: "tee-1", qty: 19 }]))).status, 200, "19 of 19 remaining");
  const res = await push(stockOrder([{ slug: "tee-1", qty: 20 }]));
  eq(res.status, 409, "20 of 19 remaining");
  has((await res.json()).message, "only 19 of the Tee 1 left", "the figure");
});

const stockPair = [
  { slug: "tee-1", qty: 2 },
  { slug: "tee-12", qty: 1 },
];

await check("S4. a paid callback writes one marker per line, qty 2 and qty 1, each with a time", async () => {
  const before = Date.now();
  const { reference } = await (await push(stockOrder(stockPair))).json();
  eq(soldKeys().length, 0, "nothing is written by the push");
  await hit(callbackBody({ amount: 3000 }));
  eq(soldKeys(), [`sold:tee-1:${reference}`, `sold:tee-12:${reference}`].sort(), "one key per line");
  eq(kv.store.get(`sold:tee-1:${reference}`), "2", "value is the quantity as a string");
  eq(kv.store.get(`sold:tee-12:${reference}`), "1", "value is the quantity as a string");
  const m = kv.meta.get(`sold:tee-1:${reference}`);
  eq(m.qty, 2, "metadata qty");
  if (!(Number.isInteger(m.at) && m.at >= before && m.at <= Date.now())) throw new Error(`metadata at is ${m.at}`);
});

await check("S4b. a replayed callback, and a callback overlapping a status query, leave exactly one marker per line", async () => {
  await push(stockOrder(stockPair));
  await hit(callbackBody({ amount: 3000 }));
  await hit(callbackBody({ amount: 3000 }));
  eq(soldKeys().length, 2, "after a replay");
  resetAll();
  const body = await (await push(stockOrder(stockPair))).json();
  const stored = await record();
  stored.pushedAt = Date.now() - 120_000;
  stored.createdAt = stored.pushedAt;
  await kv.put("ws_CO_TEST_1", JSON.stringify(stored));
  kv.yieldOps = true;
  await Promise.all([hit(callbackBody({ amount: 3000 })), askStatus(body)]);
  kv.yieldOps = false;
  eq((await record()).status, "paid", "paid");
  eq(soldKeys(), [`sold:tee-1:${body.reference}`, `sold:tee-12:${body.reference}`].sort(), "one per line");
});

await check("S5. a cancelled prompt, a mismatched amount and a failed payment write no marker", async () => {
  await push(stockOrder(stockPair));
  await hit(callbackBody({ code: 1032 }));
  eq((await record()).status, "failed", "cancelled");
  eq(soldKeys().length, 0, "no marker after a cancellation");
  resetAll();
  await push(stockOrder(stockPair));
  await hit(callbackBody({ amount: 1 }));
  eq((await record()).status, "mismatch", "mismatch");
  eq(soldKeys().length, 0, "no marker after a mismatched amount");
  resetAll();
  await push(stockOrder(stockPair));
  await hit(callbackBody({ code: 2001 }));
  eq((await record()).status, "failed", "failed");
  eq(soldKeys().length, 0, "no marker after a failed payment");
  /* The control: the same order, paid, DOES write them. Without it every line
     above passes on a build that writes nothing at all. */
  resetAll();
  await push(stockOrder(stockPair));
  await hit(callbackBody({ amount: 3000 }));
  eq(soldKeys().length, 2, "the same order, paid, writes its markers");
});

await check("S6. two different orders for the last unit, both accepted, settled together with KV yielding, leave both markers (the in-flight overshoot, documented)", async () => {
  checkoutIds = ["ws_CO_A", "ws_CO_B"];
  const one = { slug: "last-one", qty: 1 };
  const a = await (await push(stockOrder([one]))).json();
  const b = await (await push(stockOrder([one], { phone: "0722345678" }))).json();
  eq(pushes.length, 2, "nothing reserves stock at push time: both were accepted");
  kv.yieldOps = true;
  await Promise.all([hit(callbackBody({ id: "ws_CO_A", amount: 1000 })), hit(callbackBody({ id: "ws_CO_B", amount: 1000 }))]);
  kv.yieldOps = false;
  eq(soldKeys("last-one"), [`sold:last-one:${a.reference}`, `sold:last-one:${b.reference}`].sort(), "both counted");
  eq((await push(stockOrder([one], { phone: "0733345678" }))).status, 409, "a third buyer is now refused");
});

await check("S7. a failed marker write leaves the order pending and the retry pays it with one marker; a failed paid write after the markers is recovered with still one", async () => {
  const { reference } = await (await push(stockOrder(stockPair))).json();
  kv.failWritesTo = (key) => key.startsWith("sold:");
  eq((await hit(callbackBody({ amount: 3000 }))).status, 500, "the callback answers 500 so Safaricom retries");
  kv.failWritesTo = null;
  eq((await record()).status, "pending", "still pending");
  eq((await hit(callbackBody({ amount: 3000 }))).status, 200, "the retry");
  eq((await record()).status, "paid", "paid by the retry");
  eq(soldKeys(), [`sold:tee-1:${reference}`, `sold:tee-12:${reference}`].sort(), "one marker per line");
  resetAll();
  const second = await (await push(stockOrder(stockPair))).json();
  kv.failWritesTo = (key) => key === "ws_CO_TEST_1";
  eq((await hit(callbackBody({ amount: 3000 }))).status, 500, "the paid write failed after the markers landed");
  eq(soldKeys().length, 2, "the markers are already down");
  kv.failWritesTo = null;
  await hit(callbackBody({ amount: 3000 }));
  eq((await record()).status, "paid", "paid by the retry");
  eq(soldKeys(), [`sold:tee-1:${second.reference}`, `sold:tee-12:${second.reference}`].sort(), "still one marker per line");
});

await check("S8. 12 sold of tee-12 do not reduce tee-1: the trailing colon on the prefix", async () => {
  await seedSold("tee-12", 12);
  eq((await push(stockOrder([{ slug: "tee-1", qty: 20 }]))).status, 200, "tee-1 still has all 20");
  const res = await push(stockOrder([{ slug: "tee-12", qty: 9 }]));
  eq(res.status, 409, "tee-12 has 8");
  has((await res.json()).message, "only 8 of the Tee 12 left", "its own figure");
});

await check("S9. raising stock and stockCountedAt in the catalogue restores availability", async () => {
  await seedSold("tee-1", 20);
  eq((await push(stockOrder([{ slug: "tee-1", qty: 1 }]))).status, 409, "sold out");
  const entry = catalogueEntry("tee-1");
  const was = { ...entry };
  try {
    await new Promise((resolve) => setTimeout(resolve, 5));
    entry.stock = 15;
    entry.stockCountedAt = new Date().toISOString().replace("Z", "+00:00");
    eq((await push(stockOrder([{ slug: "tee-1", qty: 15 }]))).status, 200, "the 20 earlier sales are before the new count");
  } finally {
    Object.assign(entry, was);
  }
});

await check("S10. a failed list is a 503 with the existing message, and pushes nothing", async () => {
  kv.failLists = true;
  const res = await push(stockOrder([{ slug: "tee-1", qty: 1 }]));
  eq(res.status, 503, "status");
  has((await res.json()).message, "not responding right now", "says it is us");
  eq(pushes.length, 0, "nothing was pushed");
});

await check("S10b. a sold-out product is refused without a list: stock 0 needs no count", async () => {
  kv.failLists = true;
  eq((await push(stockOrder([{ slug: "faith-hoodie", qty: 1 }]))).status, 409, "sold out, not 503");
});

await check("S11. markers with no usable metadata count as 0, are logged by reference only, and do not throw", async () => {
  await kv.put("sold:tee-1:MA-BAD-ONE", "5");
  await kv.put("sold:tee-1:MA-BAD-TWO", "5", { metadata: { qty: 5.5, at: COUNTED + 1 } });
  await kv.put("sold:tee-1:MA-BAD-3", "5", { metadata: { qty: "5", at: COUNTED + 1 } });
  const lines = [];
  const realLog = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  let res;
  try {
    res = await push(stockOrder([{ slug: "tee-1", qty: 20 }]));
  } finally {
    console.log = realLog;
  }
  eq(res.status, 200, "all 20 still available: the malformed markers count as 0");
  const logged = lines.filter((l) => l.includes("sold_marker_malformed"));
  eq(logged.length, 3, "one log line per malformed marker");
  for (const l of logged) {
    const entry = JSON.parse(l);
    eq(Object.keys(entry).sort(), ["at", "code", "reference"], "only a place, a code and a reference");
    if (!/^MA-BAD-/.test(entry.reference)) throw new Error(`reference ${entry.reference}`);
    lacks(l, "Tee 1", "a product name in the log");
    lacks(l, ":5", "a quantity in the log");
  }
});

await check("S12. a marker is keyed by the reference alone, never a name, phone or number", async () => {
  const { reference } = await (await push(stockOrder(stockPair))).json();
  await hit(callbackBody({ amount: 3000 }));
  eq(soldKeys().length, 2, "there are markers to inspect");
  for (const key of soldKeys()) {
    lacks(key, "Amina", "the buyer's name in a key");
    lacks(key, "0712345678", "the buyer's number in a key");
    lacks(key, "254712345678", "the buyer's number in a key");
    has(key, reference, "the reference");
  }
  for (const m of kv.meta.values()) eq(Object.keys(m).sort(), ["at", "qty"], "metadata keys");
});

await check("S13. an order with a promo code writes both its promo and its sold markers, and Daraja is asked for the same amount", async () => {
  await seedPromo("ALEX10");
  const { reference } = await (await push(stockOrder([{ slug: "tee-1", qty: 2 }], { promo: "ALEX10" }))).json();
  eq(pushes[0].Amount, 1800, "2 x 1,000 less 10 percent, delivery 0");
  await hit(callbackBody({ amount: 1800 }));
  eq((await record()).status, "paid", "paid");
  eq(markers("ALEX10"), [`promo-use:ALEX10:${reference}`], "the promo marker");
  eq(soldKeys(), [`sold:tee-1:${reference}`], "the sold marker");
});

await check("S14. a product with no stockCountedAt in the catalogue subtracts every sale it has", async () => {
  await sold("crew-tee", "MA-ANY", 5, 1);
  const res = await push({ ...ORDER, items: [{ slug: "crew-tee", qty: 2 }] });
  eq(res.status, 409, "6 less 5 leaves 1");
  has((await res.json()).message, "only 1 of the Crew tee left", "figure");
});

await check("S15. an uncapped promo code never lists its own prefix; the only list a push makes is the stock count", async () => {
  await seedPromo("ALEX10");
  await push(stockOrder([{ slug: "tee-1", qty: 1 }], { promo: "ALEX10" }));
  eq(kv.listed.filter((p) => p.startsWith("promo-use:")), [], "no promo-use list");
  eq(kv.listed.filter((p) => p.startsWith("sold:")), ["sold:tee-1:"], "the stock list");
});

/* ================= the build-time guard on stockCountedAt =================
 *
 * products.ts is checked at module load by the build. It is TypeScript and the
 * rest of this file is JavaScript, so a copy is run with its one data import
 * substituted, exactly as the catalogue is substituted above, and Node strips the
 * types. Each case loads it fresh. */

const tsDir = join(scratch, "lib");
mkdirSync(tsDir, { recursive: true });
{
  const src = readFileSync(join(ROOT, "src", "lib", "products.ts"), "utf8");
  const patched = src.replace(/^import data from .*$/m, "const data = globalThis.__products;");
  if (patched === src) throw new Error("could not find the data import — has products.ts moved it?");
  writeFileSync(join(tsDir, "products.ts"), patched, "utf8");
}
let tsLoads = 0;
const loadProducts = async (overrides) => {
  globalThis.__products = [
    {
      slug: "guard-tee", name: "Guard tee", category: "t-shirts", audience: [], price: 1000, material: null,
      fabricWeight: null, fit: null, printMethod: null, leadTimeDays: null, dispatch: null,
      stock: 20, stockCountedAt: "2026-11-17T19:42:00+03:00", photos: [], sizes: [], ...overrides,
    },
  ];
  return import(`${pathToFileURL(join(tsDir, "products.ts")).href}?n=${tsLoads++}`);
};
const throwsFor = async (overrides, wanted) => {
  try {
    await loadProducts(overrides);
  } catch (error) {
    has(error.message, "guard-tee", "names the slug");
    has(error.message, wanted, "says what is wrong");
    return;
  }
  throw new Error(`products.ts accepted ${JSON.stringify(overrides)}`);
};

await check("S16. products.ts accepts stock 20 with an offset timestamp, and stock 0 with null", async () => {
  await loadProducts({});
  await loadProducts({ stock: 0, stockCountedAt: null });
});

await check("S17. products.ts refuses stock 20 with stockCountedAt null or absent", async () => {
  await throwsFor({ stockCountedAt: null }, "stockCountedAt");
  await throwsFor({ stockCountedAt: undefined }, "stockCountedAt");
});

await check("S18. products.ts refuses a bad timestamp, one with no offset, and one in the future", async () => {
  await throwsFor({ stockCountedAt: "last Tuesday" }, "stockCountedAt");
  await throwsFor({ stockCountedAt: "2026-11-17T19:42:00" }, "offset");
  await throwsFor({ stockCountedAt: "2026-13-45T25:61:00+03:00" }, "stockCountedAt");
  await throwsFor({ stockCountedAt: "2099-01-01T00:00:00+03:00" }, "future");
});

await check("S19. products.ts refuses stock 0 with a timestamp", async () => {
  await throwsFor({ stock: 0, stockCountedAt: "2026-11-17T19:42:00+03:00" }, "stockCountedAt");
});

/* ================= no secret in the source ================= */

await check("no key, passkey or shortcode is written into the source", async () => {
  for (const file of ["_daraja.js", "_order.js", "_site.js", "_amounts.js", "_pending.js", "_promo.js", "_stock.js", "promo/check.js", "mpesa/stk.js", "mpesa/status.js", "mpesa/callback/[token].js"]) {
    const src = readFileSync(join(API, file), "utf8");
    for (const pattern of [/passkey\s*=\s*["'][A-Za-z0-9]{8,}/i, /["'][A-Za-z0-9]{40,}["']/]) {
      const hitMatch = src.match(pattern);
      if (hitMatch && !hitMatch[0].includes("ABCDEFGH")) {
        throw new Error(`${file} contains something credential-shaped: ${hitMatch[0].slice(0, 40)}`);
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
