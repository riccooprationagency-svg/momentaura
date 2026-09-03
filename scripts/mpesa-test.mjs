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

const orderPath = join(scratch, "_order.js");
const orderSource = readFileSync(orderPath, "utf8");
const orderPatched = orderSource.replace(
  /^import catalogue from .*$/m,
  "const catalogue = globalThis.__catalogue;"
);
if (orderPatched === orderSource) throw new Error("could not find the catalogue import — has _order.js moved it?");
writeFileSync(orderPath, orderPatched, "utf8");

globalThis.__catalogue = [
  { slug: "crew-tee", name: "Crew tee", price: 650, stock: 6 },
  { slug: "faith-hoodie", name: "Faith hoodie", price: 3500, stock: 0 },
];

const load = (rel) => import(pathToFileURL(join(scratch, rel)).href);

const { onRequest: stk } = await load("mpesa/stk.js");
const { onRequest: status } = await load("mpesa/status.js");
const { onRequest: callback } = await load("mpesa/callback/[token].js");
const daraja = await load("_daraja.js");

/* ---------- the Daraja stub, at the HTTP boundary ---------- */

const SAFARICOM_IP = "196.201.214.200";
const TOKEN_PATH = "s3cr3t-callback-path";

let darajaMode = "ok";
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
      CheckoutRequestID: "ws_CO_TEST_1",
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
  return {
    store,
    failWrites: false,
    failReads: false,
    async get(key, type) {
      if (this.failReads) throw new Error("KV read failed");
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      if (this.failWrites) throw new Error("KV write failed");
      store.set(key, value);
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
  MPESA_CALLBACK_ORIGIN: "https://momentaura.co.ke",
  MPESA_CALLBACK_TOKEN: TOKEN_PATH,
});

function resetAll() {
  kv = makeKv();
  darajaMode = "ok";
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

const ORDER = { items: [{ slug: "crew-tee", qty: 2 }], name: "Amina Wanjiru", phone: "0712345678" };

const push = (body = ORDER, env = baseEnv()) =>
  stk({ request: new Request("https://momentaura.co.ke/api/mpesa/stk", { method: "POST", body: JSON.stringify(body) }), env });

const askStatus = (body, env = baseEnv()) =>
  status({ request: new Request("https://momentaura.co.ke/api/mpesa/status", { method: "POST", body: JSON.stringify(body) }), env });

const hit = (body, { token = TOKEN_PATH, ip = SAFARICOM_IP, env = baseEnv(), method = "POST" } = {}) =>
  callback({
    request: new Request(`https://momentaura.co.ke/api/mpesa/callback/${token}`, {
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
  eq(pushes[0].CallBackURL, `https://momentaura.co.ke/api/mpesa/callback/${TOKEN_PATH}`, "CallBackURL");
});

await check("a sold-out product is refused by name, and nothing is pushed", async () => {
  const res = await push({ ...ORDER, items: [{ slug: "faith-hoodie", qty: 1 }] });
  eq(res.status, 409, "status");
  has((await res.json()).message, "Faith hoodie is sold out", "names the product");
  eq(pushes.length, 0, "no push was attempted");
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
    request: new Request(`https://momentaura.co.ke/api/mpesa/callback/${TOKEN_PATH}`, {
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

const pushThenAge = async (ms) => {
  const res = await push();
  const body = await res.json();
  const stored = await record();
  stored.pushedAt = Date.now() - ms;
  stored.createdAt = stored.pushedAt;
  await kv.put("ws_CO_TEST_1", JSON.stringify(stored));
  return body;
};

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

await check("the status response carries no amount, phone number or receipt", async () => {
  const body = await pushThenAge(120_000);
  await hit(callbackBody());
  const text = await (await askStatus(body)).text();
  eq(Object.keys(JSON.parse(text)).sort(), ["reference", "status"], "keys");
  lacks(text, "1300", "the amount");
  lacks(text, "254712345678", "the phone number");
  lacks(text, "RGX1A2B3C4", "the receipt");
});

/* ================= no secret in the source ================= */

await check("no key, passkey or shortcode is written into the source", async () => {
  for (const file of ["_daraja.js", "_pending.js", "mpesa/stk.js", "mpesa/status.js", "mpesa/callback/[token].js"]) {
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
