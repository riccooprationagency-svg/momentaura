#!/usr/bin/env node
/* Exercises functions/admin/orders.js and functions/api/_alert.js.
 *
 * Sits outside the Astro build. Guards:
 *   - Cloudflare Access JWT verification (RS256, exp, nbf, iss, aud, JWKS cache)
 *   - Fail-closed security on every non-200 response (no buyer data leaked)
 *   - Server-rendered order listing (paid only, newest first, escaping, pagination)
 *   - Money-path alert dispatch (Telegram + email on pending->paid, idempotent, isolated failures)
 *
 *   node scripts/admin-test.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FUNCTIONS = join(ROOT, "functions");

const scratch = join(tmpdir(), `momentaura-admin-${Date.now()}`);
mkdirSync(scratch, { recursive: true });
cpSync(FUNCTIONS, scratch, { recursive: true });

writeFileSync(join(scratch, "package.json"), '{"type":"module"}\n', "utf8");

/* Substitute catalogue import in api/_order.js */
const orderPath = join(scratch, "api", "_order.js");
const orderSource = readFileSync(orderPath, "utf8");
const orderPatched = orderSource.replace(
  /^import catalogue from .*$/m,
  "const catalogue = globalThis.__catalogue;"
);
if (orderPatched === orderSource) throw new Error("could not find catalogue import in _order.js");
writeFileSync(orderPath, orderPatched, "utf8");

/* Substitute site.json in api/_site.js */
const sitePath = join(scratch, "api", "_site.js");
const siteSource = readFileSync(sitePath, "utf8");
const sitePatched = siteSource.replace(
  /^import site from .*$/m,
  "const site = globalThis.__site;"
);
if (sitePatched === siteSource) throw new Error("could not find site.json import in _site.js");
writeFileSync(sitePath, sitePatched, "utf8");

globalThis.__site = JSON.parse(readFileSync(join(ROOT, "src", "data", "site.json"), "utf8"));
globalThis.__catalogue = [
  { slug: "crew-tee", name: "Crew tee", price: 650, stock: 6 },
  { slug: "faith-hoodie", name: "Faith hoodie", price: 3500, stock: 10 },
  { slug: "sized-tee", name: "Sized tee", price: 900, stock: 4, sizes: [{ label: "M" }, { label: "L" }] },
];

const { onRequest: adminOrders, _resetJwksCache, _resetBackfillCache, ensurePaidIndex } = await import(
  pathToFileURL(join(scratch, "admin", "orders.js")).href
);
const { settle, putPending, refKey, paidIndexKey } = await import(
  pathToFileURL(join(scratch, "api", "_pending.js")).href
);
const { formatAlertMessage, sendAlerts } = await import(
  pathToFileURL(join(scratch, "api", "_alert.js")).href
);

/* ---------- test harness ---------- */

let passed = 0;
let failed = 0;

function check(ok, label, detail = "") {
  if (ok) {
    passed++;
    console.log(`  pass  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

function eq(actual, expected, label) {
  check(actual === expected, label, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function lacks(text, forbidden, label) {
  check(!text.includes(forbidden), label, `contains forbidden string: ${forbidden}`);
}

function contains(text, expected, label) {
  check(text.includes(expected), label, `missing: ${expected}`);
}

/* ---------- WebCrypto RSA Key Generation & JWT signing ---------- */

const TEAM_DOMAIN = "test-team.cloudflareaccess.com";
const AUD = "test-aud-tag-98765";
const KID = "test-access-kid-1";

const rsaKeyPair = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"]
);

const publicJwk = await crypto.subtle.exportKey("jwk", rsaKeyPair.publicKey);
publicJwk.kid = KID;
publicJwk.alg = "RS256";
publicJwk.use = "sig";

function toBase64Url(uint8) {
  let bin = "";
  for (let i = 0; i < uint8.length; i++) bin += String.fromCharCode(uint8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jsonToBase64Url(obj) {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function makeToken({
  header = { alg: "RS256", kid: KID, typ: "JWT" },
  payload = {},
  sign = true,
  rawSignature = null,
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    aud: [AUD],
    iss: `https://${TEAM_DOMAIN}`,
    exp: now + 3600,
    nbf: now - 60,
    sub: "owner@momentaurastores.co.ke",
    ...payload,
  };

  const encHeader = jsonToBase64Url(header);
  const encPayload = jsonToBase64Url(fullPayload);
  const data = new TextEncoder().encode(`${encHeader}.${encPayload}`);

  if (rawSignature !== null) {
    return `${encHeader}.${encPayload}.${rawSignature}`;
  }

  if (!sign) {
    return `${encHeader}.${encPayload}.`;
  }

  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", rsaKeyPair.privateKey, data);
  return `${encHeader}.${encPayload}.${toBase64Url(new Uint8Array(sig))}`;
}

/* ---------- In-memory KV Store ---------- */

function createMockKv() {
  const map = new Map();
  const expirations = new Map();
  return {
    map,
    expirations,
    async get(key, type) {
      const exp = expirations.get(key);
      if (exp !== undefined && exp <= Math.floor(Date.now() / 1000)) return null;
      const val = map.get(key);
      if (val === undefined) return null;
      return type === "json" ? JSON.parse(val) : val;
    },
    async getWithMetadata(key) {
      const exp = expirations.get(key);
      if (exp !== undefined && exp <= Math.floor(Date.now() / 1000)) return { value: null, metadata: null };
      const val = map.get(key);
      if (val === undefined) return { value: null, metadata: null };
      return { value: val, metadata: null };
    },
    async put(key, value, opts) {
      map.set(key, typeof value === "string" ? value : JSON.stringify(value));
      const exp = opts?.expiration
        ? opts.expiration
        : (opts?.expirationTtl ? Math.floor(Date.now() / 1000) + opts.expirationTtl : undefined);
      if (exp !== undefined) {
        expirations.set(key, exp);
      }
    },
    async list({ prefix = "", cursor, limit = 1000 } = {}) {
      const nowSec = Math.floor(Date.now() / 1000);
      const allKeys = Array.from(map.keys())
        .filter((k) => k.startsWith(prefix))
        .filter((k) => {
          const exp = expirations.get(k);
          return exp === undefined || exp > nowSec;
        })
        .sort();
      let startIndex = 0;
      if (cursor) {
        const idx = allKeys.indexOf(cursor);
        if (idx !== -1) startIndex = idx + 1;
      }
      const pageKeys = allKeys.slice(startIndex, startIndex + limit);
      const nextCursor =
        pageKeys.length > 0 && startIndex + limit < allKeys.length
          ? pageKeys[pageKeys.length - 1]
          : undefined;
      return {
        keys: pageKeys.map((name) => ({ name, expiration: expirations.get(name) })),
        list_complete: !nextCursor,
        cursor: nextCursor,
      };
    },
  };
}

/* ---------- Mock fetch boundaries ---------- */

const originalFetch = globalThis.fetch;
let telegramCalls = [];
let emailCalls = [];
let jwksFetchCount = 0;
let telegramShouldFail = false;

globalThis.fetch = async (url, options = {}) => {
  const urlStr = String(url);

  if (urlStr.includes("/cdn-cgi/access/certs")) {
    jwksFetchCount++;
    return new Response(JSON.stringify({ keys: [publicJwk] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (urlStr.startsWith("https://api.telegram.org/")) {
    if (telegramShouldFail) {
      return new Response("Telegram error", { status: 500 });
    }
    const body = options.body ? JSON.parse(options.body) : {};
    telegramCalls.push({ url: urlStr, options, body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 101 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (urlStr.includes("api.resend.com/emails")) {
    const body = options.body ? JSON.parse(options.body) : {};
    emailCalls.push({ url: urlStr, options, body });
    return new Response(JSON.stringify({ id: "resend-msg-12345" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return originalFetch(url, options);
};

/* Fixture buyer details for failure assertions */
const FIXTURE_BUYER_NAME = "Wanjiku Muthoni";
const FIXTURE_BUYER_PHONE = "254712999888";
const FIXTURE_BUYER_AREA = "Runda Estate";
const FIXTURE_BUYER_LANDMARK = "Near Total Station";

const FIXTURE_ORDER = {
  reference: "MA-TEST-9999",
  status: "paid",
  amount: 2500,
  createdAt: 1700000000000,
  items: [{ slug: "crew-tee", qty: 1 }],
  name: FIXTURE_BUYER_NAME,
  msisdn: FIXTURE_BUYER_PHONE,
  email: "wanjiku@example.com",
  delivery: {
    county: "nairobi",
    label: "Nairobi",
    area: FIXTURE_BUYER_AREA,
    landmark: FIXTURE_BUYER_LANDMARK,
    fee: 200,
  },
};

const defaultEnv = (kv) => ({
  ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
  ACCESS_AUD: AUD,
  ORDERS: kv,
});

async function runAdmin(token, env, path = "/admin/orders") {
  const headers = new Headers();
  if (token !== null && token !== undefined) {
    headers.set("Cf-Access-Jwt-Assertion", token);
  }
  const req = new Request(`https://momentaurastores.co.ke${path}`, {
    method: "GET",
    headers,
  });
  return adminOrders({ request: req, env });
}

async function assertRefusal(res, expectedStatus, label) {
  const text = await res.text();
  eq(res.status, expectedStatus, `${label} gives ${expectedStatus}`);
  eq(res.headers.get("Cache-Control"), "no-store", `${label} carries Cache-Control: no-store`);
  eq(res.headers.get("X-Robots-Tag"), "noindex, nofollow", `${label} carries X-Robots-Tag: noindex, nofollow`);
  eq(res.headers.get("Referrer-Policy"), "no-referrer", `${label} carries Referrer-Policy: no-referrer`);
  lacks(text, FIXTURE_BUYER_NAME, `${label} body contains no buyer name`);
  lacks(text, FIXTURE_BUYER_PHONE, `${label} body contains no buyer phone`);
  lacks(text, FIXTURE_BUYER_AREA, `${label} body contains no buyer address area`);
  lacks(text, FIXTURE_BUYER_LANDMARK, `${label} body contains no buyer landmark`);
}

console.log("\n  Admin /orders — Cloudflare Access & fail-closed gates\n");

/* Seed KV with the fixture order */
const kv = createMockKv();
await kv.put(refKey(FIXTURE_ORDER.reference), FIXTURE_ORDER);
await kv.put(paidIndexKey(FIXTURE_ORDER.createdAt, FIXTURE_ORDER.reference), FIXTURE_ORDER.reference);

/* 1. Missing ACCESS_TEAM_DOMAIN -> 503 */
{
  const res = await runAdmin("any-token", { ACCESS_AUD: AUD, ORDERS: kv });
  await assertRefusal(res, 503, "missing ACCESS_TEAM_DOMAIN");
}

/* 2. Missing ACCESS_AUD -> 503 */
{
  const res = await runAdmin("any-token", { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ORDERS: kv });
  await assertRefusal(res, 503, "missing ACCESS_AUD");
}

/* 3. No header -> 401 */
{
  const res = await runAdmin(null, defaultEnv(kv));
  await assertRefusal(res, 401, "no Cf-Access-Jwt-Assertion header");
}

/* 4. Valid token -> 200 */
{
  _resetJwksCache();
  const token = await makeToken();
  const res = await runAdmin(token, defaultEnv(kv));
  eq(res.status, 200, "valid token gives 200");
  eq(res.headers.get("Cache-Control"), "no-store", "200 response carries Cache-Control: no-store");
  eq(res.headers.get("X-Robots-Tag"), "noindex, nofollow", "200 response carries X-Robots-Tag");
  eq(res.headers.get("Referrer-Policy"), "no-referrer", "200 response carries Referrer-Policy");
  const body = await res.text();
  contains(body, FIXTURE_ORDER.reference, "200 response contains order reference");
  contains(body, FIXTURE_BUYER_NAME, "200 response contains buyer name");
  contains(body, FIXTURE_BUYER_PHONE, "200 response contains buyer phone");
}

/* 5. Wrong aud -> 401 */
{
  const token = await makeToken({ payload: { aud: ["wrong-aud-tag"] } });
  const res = await runAdmin(token, defaultEnv(kv));
  await assertRefusal(res, 401, "wrong aud claim");
}

/* 6. Wrong iss -> 401 */
{
  const token = await makeToken({ payload: { iss: "https://imposter.cloudflareaccess.com" } });
  const res = await runAdmin(token, defaultEnv(kv));
  await assertRefusal(res, 401, "wrong iss claim");
}

/* 7. Expired -> 401 */
{
  const now = Math.floor(Date.now() / 1000);
  const token = await makeToken({ payload: { exp: now - 10 } });
  const res = await runAdmin(token, defaultEnv(kv));
  await assertRefusal(res, 401, "expired token");
}

/* 8. Not yet valid (nbf in future) -> 401 */
{
  const now = Math.floor(Date.now() / 1000);
  const token = await makeToken({ payload: { nbf: now + 300 } });
  const res = await runAdmin(token, defaultEnv(kv));
  await assertRefusal(res, 401, "nbf in future");
}

/* 9. Unknown kid -> 401 */
{
  const token = await makeToken({ header: { alg: "RS256", kid: "unknown-kid-999", typ: "JWT" } });
  const res = await runAdmin(token, defaultEnv(kv));
  await assertRefusal(res, 401, "unknown kid");
}

/* 10. Tampered payload -> 401 */
{
  const validToken = await makeToken();
  const [h, p, s] = validToken.split(".");
  const tamperedPayload = jsonToBase64Url({
    aud: [AUD],
    iss: `https://${TEAM_DOMAIN}`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    name: "Hacker",
  });
  const tamperedToken = `${h}.${tamperedPayload}.${s}`;
  const res = await runAdmin(tamperedToken, defaultEnv(kv));
  await assertRefusal(res, 401, "tampered payload signature verification");
}

/* 11. alg: none -> 401 */
{
  const noneHeader = jsonToBase64Url({ alg: "none", typ: "JWT" });
  const nonePayload = jsonToBase64Url({
    aud: [AUD],
    iss: `https://${TEAM_DOMAIN}`,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const res = await runAdmin(`${noneHeader}.${nonePayload}.`, defaultEnv(kv));
  await assertRefusal(res, 401, "alg: none refused");
}

/* 12. alg: HS256 signed with public key as secret -> 401 */
{
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JSON.stringify(publicJwk)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const hsHeader = jsonToBase64Url({ alg: "HS256", kid: KID, typ: "JWT" });
  const hsPayload = jsonToBase64Url({
    aud: [AUD],
    iss: `https://${TEAM_DOMAIN}`,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const data = new TextEncoder().encode(`${hsHeader}.${hsPayload}`);
  const sig = await crypto.subtle.sign("HMAC", hmacKey, data);
  const hsToken = `${hsHeader}.${hsPayload}.${toBase64Url(new Uint8Array(sig))}`;
  const res = await runAdmin(hsToken, defaultEnv(kv));
  await assertRefusal(res, 401, "alg: HS256 refused");
}

console.log("\n  Order listing tests\n");

/* 13. Pending orders are not shown; paid orders newest first; retired slug renders */
{
  const testKv = createMockKv();
  const olderPaid = {
    reference: "MA-OLD1-PAID",
    status: "paid",
    amount: 1000,
    createdAt: 10000,
    items: [{ slug: "crew-tee", qty: 1 }],
    name: "Older Buyer",
    msisdn: "254711111111",
  };
  const newerPaid = {
    reference: "MA-NEW2-PAID",
    status: "paid",
    amount: 2000,
    createdAt: 20000,
    items: [{ slug: "retired-graphic-tee", qty: 2 }],
    name: "Newer Buyer",
    msisdn: "254722222222",
  };
  const pendingOrder = {
    reference: "MA-PEND-9999",
    status: "pending",
    amount: 3000,
    createdAt: 30000,
    items: [{ slug: "crew-tee", qty: 1 }],
    name: "Pending Buyer",
    msisdn: "254733333333",
  };

  await testKv.put(refKey(olderPaid.reference), olderPaid);
  await testKv.put(paidIndexKey(olderPaid.createdAt, olderPaid.reference), olderPaid.reference);
  await testKv.put(refKey(newerPaid.reference), newerPaid);
  await testKv.put(paidIndexKey(newerPaid.createdAt, newerPaid.reference), newerPaid.reference);
  await testKv.put(refKey(pendingOrder.reference), pendingOrder);

  const token = await makeToken();
  const res = await runAdmin(token, defaultEnv(testKv));
  eq(res.status, 200, "orders listing returns 200");
  const body = await res.text();

  lacks(body, "MA-PEND-9999", "pending orders are not shown");
  contains(body, "MA-OLD1-PAID", "older paid order shown");
  contains(body, "MA-NEW2-PAID", "newer paid order shown");

  const idxNewer = body.indexOf("MA-NEW2-PAID");
  const idxOlder = body.indexOf("MA-OLD1-PAID");
  check(idxNewer !== -1 && idxOlder !== -1 && idxNewer < idxOlder, "paid orders sorted newest first");

  contains(body, "retired-graphic-tee", "retired product slug renders when not in catalogue");
}

/* 14. Buyer name with markup is HTML-escaped */
{
  const testKv = createMockKv();
  const xssOrder = {
    reference: "MA-XSS1-TEST",
    status: "paid",
    amount: 1500,
    createdAt: 40000,
    items: [{ slug: "crew-tee", qty: 1 }],
    name: '<script>alert("xss")</script> & Co',
    msisdn: "254700000000",
    delivery: {
      county: "nairobi",
      label: "Nairobi",
      area: '<img src=x onerror=alert(1)>',
      landmark: 'Stage "Six" & Seven',
    },
  };
  await testKv.put(refKey(xssOrder.reference), xssOrder);
  await testKv.put(paidIndexKey(xssOrder.createdAt, xssOrder.reference), xssOrder.reference);

  const token = await makeToken();
  const res = await runAdmin(token, defaultEnv(testKv));
  const body = await res.text();

  lacks(body, '<script>alert("xss")</script>', "script tag is escaped, not executable");
  contains(body, "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; Co", "name markup correctly escaped");
  lacks(body, "<img src=x", "img tag in area is escaped");
  contains(body, "Stage &quot;Six&quot; &amp; Seven", "landmark quotes and ampersands escaped");
}

/* 15. Missing optional fields omitted rather than 'null' */
{
  const testKv = createMockKv();
  const bareOrder = {
    reference: "MA-BARE-1234",
    status: "paid",
    amount: 1500,
    createdAt: 50000,
    items: [{ slug: "crew-tee", qty: 1 }],
    name: "Minimal Buyer",
    msisdn: "254711223344",
    /* no email, no area, no landmark, no promoCode */
  };
  await testKv.put(refKey(bareOrder.reference), bareOrder);
  await testKv.put(paidIndexKey(bareOrder.createdAt, bareOrder.reference), bareOrder.reference);

  const token = await makeToken();
  const res = await runAdmin(token, defaultEnv(testKv));
  const body = await res.text();

  lacks(body, "null", "nothing missing renders as 'null'");
  lacks(body, "mailto:", "no mailto link when email is absent");
  lacks(body, "Promo:", "no promo block when promo is absent");
}

/* 16. Cursor-based pagination works */
{
  const testKv = createMockKv();
  for (let i = 1; i <= 25; i++) {
    const pad = String(i).padStart(2, "0");
    const ord = {
      reference: `MA-PAGE-${pad}`,
      status: "paid",
      amount: 1000,
      createdAt: 100000 + i * 1000,
      items: [{ slug: "crew-tee", qty: 1 }],
      name: `Buyer ${pad}`,
      msisdn: `2547000000${pad}`,
    };
    await testKv.put(refKey(ord.reference), ord);
    await testKv.put(paidIndexKey(ord.createdAt, ord.reference), ord.reference);
  }

  const token = await makeToken();
  /* Page 1 */
  const res1 = await runAdmin(token, defaultEnv(testKv), "/admin/orders");
  const body1 = await res1.text();
  contains(body1, "MA-PAGE-25", "page 1 contains newest order");
  contains(body1, "MA-PAGE-06", "page 1 contains 20th order");
  lacks(body1, "MA-PAGE-05", "page 1 does not contain 21st order");
  contains(body1, "NEXT PAGE", "page 1 links to next page");
  const nextMatch = body1.match(/href="(\/admin\/orders\?cursor=[^"]+)"/);
  check(Boolean(nextMatch), "page 1 carries next cursor URL");

  /* Page 2 */
  const nextPageUrl = nextMatch ? nextMatch[1] : "/admin/orders";
  const res2 = await runAdmin(token, defaultEnv(testKv), nextPageUrl);
  const body2 = await res2.text();
  contains(body2, "MA-PAGE-05", "page 2 contains 21st order");
  contains(body2, "MA-PAGE-01", "page 2 contains 25th order");
  lacks(body2, "MA-PAGE-25", "page 2 does not contain page 1 orders");
  contains(body2, "PREVIOUS PAGE", "page 2 links to previous page");
  contains(body2, 'href="/admin/orders"', "page 2 links back to page 1");
  lacks(body2, "NEXT PAGE", "page 2 has no next link when at end");
}

/* 17. Time-ordered index survives >500 total keys without losing paid orders */
{
  const testKv = createMockKv();
  /* Seed 520 pending orders */
  for (let i = 1; i <= 520; i++) {
    const pad = String(i).padStart(4, "0");
    const ord = {
      reference: `MA-PEND-${pad}`,
      status: "pending",
      amount: 1000,
      createdAt: 50000 + i,
      items: [{ slug: "crew-tee", qty: 1 }],
      name: `Pending ${pad}`,
      msisdn: `25470000${pad}`,
    };
    await testKv.put(refKey(ord.reference), ord);
  }
  /* Seed 30 paid orders */
  for (let i = 1; i <= 30; i++) {
    const pad = String(i).padStart(2, "0");
    const ord = {
      reference: `MA-PAID-${pad}`,
      status: "paid",
      amount: 2000,
      createdAt: 500000 + i * 1000,
      items: [{ slug: "crew-tee", qty: 1 }],
      name: `Paid ${pad}`,
      msisdn: `2547111100${pad}`,
    };
    await testKv.put(refKey(ord.reference), ord);
    await testKv.put(paidIndexKey(ord.createdAt, ord.reference), ord.reference);
  }

  const token = await makeToken();
  const res1 = await runAdmin(token, defaultEnv(testKv), "/admin/orders");
  const body1 = await res1.text();
  contains(body1, "MA-PAID-30", "newest paid order is visible despite >500 keys in KV");
  contains(body1, "MA-PAID-11", "20th paid order is visible on page 1");
  lacks(body1, "MA-PEND-", "pending orders are never shown in admin");

  const nextMatch = body1.match(/href="(\/admin\/orders\?cursor=[^"]+)"/);
  check(Boolean(nextMatch), "page 1 has next cursor link for remaining paid orders");
  if (nextMatch) {
    const res2 = await runAdmin(token, defaultEnv(testKv), nextMatch[1]);
    const body2 = await res2.text();
    contains(body2, "MA-PAID-10", "page 2 contains 21st paid order");
    contains(body2, "MA-PAID-01", "page 2 contains 30th paid order");
  }
}

/* 18. Long unbroken buyer email (250 chars) wraps without overflow */
{
  const testKv = createMockKv();
  const longEmail = "a".repeat(64) + "@" + "subdomain.".repeat(15) + "example.com";
  const longOrder = {
    reference: "MA-LONG-MAIL",
    status: "paid",
    amount: 1500,
    createdAt: 600000,
    items: [{ slug: "crew-tee", qty: 1 }],
    name: "Long Address Buyer",
    msisdn: "254700998877",
    email: longEmail,
    delivery: {
      county: "nairobi",
      label: "Nairobi",
      area: "UnbrokenLongAreaNameThatCouldOverflowWithoutAnywhereWrappingRule",
      landmark: "NearTheVeryLongLandmarkNameDescribedByBuyer",
    },
  };
  await testKv.put(refKey(longOrder.reference), longOrder);
  await testKv.put(paidIndexKey(longOrder.createdAt, longOrder.reference), longOrder.reference);

  const token = await makeToken();
  const res = await runAdmin(token, defaultEnv(testKv));
  const body = await res.text();
  contains(body, longEmail, "250-character email is rendered");
  contains(body, "overflow-wrap: anywhere", "stylesheet specifies overflow-wrap: anywhere");
  contains(body, "word-break: break-word", "contact-link specifies word-break: break-word");
  contains(body, "max-width: 100%", "contact-link specifies max-width: 100%");
}

/* 19. Typography limits: no font-weight 600 outside logo */
{
  const testKv = createMockKv();
  await testKv.put(refKey(FIXTURE_ORDER.reference), FIXTURE_ORDER);
  await testKv.put(paidIndexKey(FIXTURE_ORDER.createdAt, FIXTURE_ORDER.reference), FIXTURE_ORDER.reference);

  const token = await makeToken();
  const res = await runAdmin(token, defaultEnv(testKv));
  const body = await res.text();
  lacks(body, "font-weight: 600", "font-weight: 600 is forbidden outside logo per CLAUDE.md");
  contains(body, "font-weight: 500", "font-weight 500 is used instead");
}

/* 20. Headings and navigation have uppercase styling */
{
  const testKv = createMockKv();
  for (let i = 1; i <= 25; i++) {
    const pad = String(i).padStart(2, "0");
    const ord = {
      reference: `MA-UPPER-${pad}`,
      status: "paid",
      amount: 1000,
      createdAt: 700000 + i * 1000,
      items: [{ slug: "crew-tee", qty: 1 }],
      name: `Buyer Upper ${pad}`,
      msisdn: `2547990000${pad}`,
    };
    await testKv.put(refKey(ord.reference), ord);
    await testKv.put(paidIndexKey(ord.createdAt, ord.reference), ord.reference);
  }

  const token = await makeToken();
  const res = await runAdmin(token, defaultEnv(testKv));
  const body = await res.text();
  contains(body, "<h1>ORDERS</h1>", "heading is uppercase");
  contains(body, "text-transform: uppercase", "CSS applies text-transform: uppercase");
  contains(body, "NEXT PAGE", "pagination link is uppercase");
  contains(body, "Buyer Upper 25", "buyer name retains original case");
  contains(body, "Crew tee", "product name retains original case");
}

/* 21. Pre-deployment paid orders without paid-at: index are backfilled and remain visible alongside new orders */
{
  const testKv = createMockKv();
  _resetBackfillCache();

  // 1. Pre-deployment orders: stored only under ref:, NO paid-at: key
  const oldPaid1 = {
    reference: "MA-PRE1-PAID",
    status: "paid",
    amount: 1500,
    createdAt: 100000,
    items: [{ slug: "crew-tee", qty: 1 }],
    name: "Pre-deploy Buyer One",
    msisdn: "254711000001",
  };
  const oldPaid2 = {
    reference: "MA-PRE2-PAID",
    status: "paid",
    amount: 2500,
    createdAt: 200000,
    items: [{ slug: "faith-hoodie", qty: 1 }],
    name: "Pre-deploy Buyer Two",
    msisdn: "254711000002",
  };
  const oldPending = {
    reference: "MA-PRE3-PEND",
    status: "pending",
    amount: 3500,
    createdAt: 300000,
    items: [{ slug: "crew-tee", qty: 1 }],
    name: "Pre-deploy Pending",
    msisdn: "254711000003",
  };
  await testKv.put(refKey(oldPaid1.reference), oldPaid1);
  await testKv.put(refKey(oldPaid2.reference), oldPaid2);
  await testKv.put(refKey(oldPending.reference), oldPending);

  // 2. Post-deployment order: created with paid-at: index key
  const newPaid = {
    reference: "MA-POST-PAID",
    status: "paid",
    amount: 900,
    createdAt: 400000,
    items: [{ slug: "sized-tee", qty: 1, size: "M" }],
    name: "Post-deploy Buyer",
    msisdn: "254722000000",
  };
  await testKv.put(refKey(newPaid.reference), newPaid);
  await testKv.put(paidIndexKey(newPaid.createdAt, newPaid.reference), newPaid.reference);

  const token = await makeToken();
  const res = await runAdmin(token, defaultEnv(testKv));
  eq(res.status, 200, "orders listing returns 200 with older + newer paid orders");
  const body = await res.text();

  // All paid orders must appear
  contains(body, "MA-POST-PAID", "newly paid order is shown");
  contains(body, "MA-PRE2-PAID", "pre-deployment paid order 2 is shown");
  contains(body, "MA-PRE1-PAID", "pre-deployment paid order 1 is shown");
  lacks(body, "MA-PRE3-PEND", "pending pre-deployment order is not shown");

  // Newest first ordering: POST (400k) -> PRE2 (200k) -> PRE1 (100k)
  const idxPost = body.indexOf("MA-POST-PAID");
  const idxPre2 = body.indexOf("MA-PRE2-PAID");
  const idxPre1 = body.indexOf("MA-PRE1-PAID");
  check(idxPost !== -1 && idxPre2 !== -1 && idxPre1 !== -1, "all 3 paid orders found in body");
  check(idxPost < idxPre2 && idxPre2 < idxPre1, "orders sorted newest first across pre- and post-deployment orders");

  // Marker is set so backfill only runs once
  const marker = await testKv.get("meta:paid-index-backfilled");
  eq(marker, "1", "meta:paid-index-backfilled is recorded in KV");
}

/* 22. Backfill preserves source record's expiry and avoids extending existing entries */
{
  const testKv = createMockKv();
  _resetBackfillCache();

  const nowSec = Math.floor(Date.now() / 1000);
  const targetExpiry = nowSec + 3600; // 1 hour remaining

  // Pre-deployment order with 1 hour remaining
  const preOrder = {
    reference: "MA-PRE-TTL",
    status: "paid",
    amount: 1200,
    createdAt: (nowSec - 86400 * 6) * 1000,
    items: [{ slug: "crew-tee", qty: 1 }],
    name: "Expiry Buyer",
    msisdn: "254711999999",
  };
  await testKv.put(refKey(preOrder.reference), preOrder, { expiration: targetExpiry });

  // Post-deployment order already in index with 24 hours remaining
  const postOrder = {
    reference: "MA-POST-TTL",
    status: "paid",
    amount: 2200,
    createdAt: (nowSec - 3600) * 1000,
    items: [{ slug: "faith-hoodie", qty: 1 }],
    name: "Existing Buyer",
    msisdn: "254722888888",
  };
  const postExistingExpiry = nowSec + 86400;
  const postIndexKey = paidIndexKey(postOrder.createdAt, postOrder.reference);
  await testKv.put(refKey(postOrder.reference), postOrder, { expiration: postExistingExpiry });
  await testKv.put(postIndexKey, postOrder.reference, { expiration: postExistingExpiry });

  // Pre-deployment order expiring in 10s (should be skipped, not resurrected)
  const expiredOrder = {
    reference: "MA-DEAD-TTL",
    status: "paid",
    amount: 500,
    createdAt: (nowSec - 86400 * 7) * 1000,
    items: [{ slug: "crew-tee", qty: 1 }],
    name: "Dead Buyer",
    msisdn: "254733777777",
  };
  await testKv.put(refKey(expiredOrder.reference), expiredOrder, { expiration: nowSec + 10 });

  await ensurePaidIndex(defaultEnv(testKv));

  // 1. Pre-order index key was created with the source record's expiry
  const preIndexKey = paidIndexKey(preOrder.createdAt, preOrder.reference);
  const preVal = await testKv.get(preIndexKey, "json");
  eq(preVal, preOrder.reference, "pre-deployment order index was created");
  const preExp = testKv.expirations.get(preIndexKey);
  eq(preExp, targetExpiry, "pre-deployment index entry inherited exact source expiry (not fresh 7-day)");

  // 2. Existing post-order index key was NOT extended
  const postExp = testKv.expirations.get(postIndexKey);
  eq(postExp, postExistingExpiry, "existing index entry expiry was not extended");

  // 3. Expired/near-expiry record was skipped
  const deadIndexKey = paidIndexKey(expiredOrder.createdAt, expiredOrder.reference);
  const deadVal = await testKv.get(deadIndexKey);
  eq(deadVal, null, "near-expiry record was skipped and not indexed");
}

console.log("\n  Order alert tests (Telegram & Resend email)\n");

const ALERT_ENV = {
  ENVIRONMENT: "production",
  TELEGRAM_BOT_TOKEN: "fake-telegram-bot-token-xyz",
  TELEGRAM_CHAT_ID: "fake-chat-id-12345",
  ALERT_EMAIL_API_KEY: "fake-resend-api-key-abc",
  ALERT_EMAIL_FROM: "MomentAura <alerts@momentaurastores.co.ke>",
  ALERT_EMAIL_TO: "owner@momentaurastores.co.ke",
};

/* 17. Alert message content, order of fields, truncation, promo code only */
{
  const orderWithPromo = {
    reference: "MA-ALRT-1001",
    status: "paid",
    amount: 1300,
    createdAt: Date.parse("2026-11-20T10:30:00+03:00"),
    items: [
      { slug: "crew-tee", qty: 1 },
      { slug: "sized-tee", qty: 2, size: "M" },
    ],
    name: "Jane Doe".repeat(20), // 160 chars, must be truncated to 80
    msisdn: "254712345678",
    delivery: {
      county: "nairobi",
      label: "Nairobi",
      area: "Kilimani Estate ".repeat(10), // must be truncated to 80
      landmark: "Opposite Yaya Center ".repeat(10), // must be truncated to 120
      fee: 0,
    },
    promoCode: "SAVE10",
    promoAmountOff: 200,
    discountKsh: 200,
  };

  const msg = formatAlertMessage(orderWithPromo);
  const lines = msg.split("\n");

  eq(lines[0], "MA-ALRT-1001", "1. reference is first");
  eq(lines[1], "KSh 1,300", "2. paid total in KSh is second");
  eq(lines[2], "1x Crew tee", "3. first item line quantity and product name");
  eq(lines[3], "2x Sized tee (M)", "3. second item line quantity, product name and size");
  check(lines[4].length <= 80, "4. buyer name is truncated to max 80 chars");
  eq(lines[5], "254712345678", "5. buyer phone");
  contains(lines[6], "Nairobi", "6. county");
  contains(lines[6], "Kilimani Estate", "6. area");
  contains(lines[6], "Opposite Yaya Center", "6. landmark");
  eq(lines[7], "Promo: SAVE10", "7. promo code label only");
  lacks(msg, "200", "promo amount off never appears in alert message");
  contains(lines[8], "EAT", "8. order time in East Africa Time");
}

/* 18. Pending to paid transition sends exactly 1 Telegram and 1 email; second settle sends none */
{
  telegramCalls = [];
  emailCalls = [];

  const testKv = createMockKv();
  const testEnv = {
    ORDERS: testKv,
    ...ALERT_ENV,
  };

  const checkoutId = "ws_TEST_ALERT_1";
  const orderRef = "MA-SETT-1111";
  const pendingRecord = {
    reference: orderRef,
    checkoutRequestId: checkoutId,
    amount: 1500,
    status: "pending",
    createdAt: Date.now(),
    items: [{ slug: "crew-tee", qty: 2 }],
    name: "Alert Buyer",
    msisdn: "254799887766",
    delivery: { county: "nairobi", label: "Nairobi", area: "CBD", fee: 0 },
  };

  await putPending(testEnv, checkoutId, pendingRecord);
  await putPending(testEnv, refKey(orderRef), pendingRecord);

  const waitUntilPromises = [];
  const context = { waitUntil: (p) => waitUntilPromises.push(p) };

  /* First settle: pending -> paid */
  const res1 = await settle(
    testEnv,
    checkoutId,
    { state: "paid", amount: 1500, via: "callback" },
    context
  );
  eq(res1.outcome, "settled", "first settle outcome is settled");
  await Promise.all(waitUntilPromises);

  eq(telegramCalls.length, 1, "exactly one Telegram call sent on transition to paid");
  eq(emailCalls.length, 1, "exactly one email call sent on transition to paid");

  const tg = telegramCalls[0];
  contains(tg.url, "fake-telegram-bot-token-xyz", "Telegram API called with bot token URL");
  eq(tg.body.chat_id, "fake-chat-id-12345", "Telegram chat_id sent");
  contains(tg.body.text, orderRef, "Telegram text contains reference");
  eq(tg.body.parse_mode, undefined, "Telegram parse_mode is undefined (plain text)");

  const em = emailCalls[0];
  eq(em.options.headers.Authorization, "Bearer fake-resend-api-key-abc", "Resend auth header sent");
  eq(em.options.headers["User-Agent"], "MomentAura/1.0", "Resend User-Agent sent");
  eq(em.body.from, "MomentAura <alerts@momentaurastores.co.ke>", "Email from sent");
  eq(em.body.to[0], "owner@momentaurastores.co.ke", "Email to sent");
  eq(em.body.html, undefined, "Email html is undefined (plain text only)");
  contains(em.body.text, orderRef, "Email text contains reference");

  /* Second settle: already paid */
  const res2 = await settle(
    testEnv,
    checkoutId,
    { state: "paid", amount: 1500, via: "callback" },
    context
  );
  eq(res2.outcome, "already", "second settle outcome is already");
  await Promise.all(waitUntilPromises);

  eq(telegramCalls.length, 1, "second settle sends NO additional Telegram call");
  eq(emailCalls.length, 1, "second settle sends NO additional email call");
}

/* 19. Telegram failure still lets settle succeed and email still goes */
{
  telegramCalls = [];
  emailCalls = [];
  telegramShouldFail = true;

  const testKv = createMockKv();
  const testEnv = {
    ORDERS: testKv,
    ...ALERT_ENV,
  };

  const checkoutId = "ws_TEST_ALERT_2";
  const orderRef = "MA-FAIL-2222";
  const pendingRecord = {
    reference: orderRef,
    checkoutRequestId: checkoutId,
    amount: 1500,
    status: "pending",
    createdAt: Date.now(),
    items: [{ slug: "crew-tee", qty: 2 }],
    name: "Failure Buyer",
    msisdn: "254799887766",
  };

  await putPending(testEnv, checkoutId, pendingRecord);
  await putPending(testEnv, refKey(orderRef), pendingRecord);

  const waitUntilPromises = [];
  const context = { waitUntil: (p) => waitUntilPromises.push(p) };

  const res = await settle(
    testEnv,
    checkoutId,
    { state: "paid", amount: 1500, via: "callback" },
    context
  );
  eq(res.outcome, "settled", "settle still succeeds despite Telegram failure");
  await Promise.all(waitUntilPromises);

  eq(emailCalls.length, 1, "email still sent when Telegram fails");

  telegramShouldFail = false;
}

/* 20. Missing secrets send nothing and throw nothing */
{
  telegramCalls = [];
  emailCalls = [];

  const testKv = createMockKv();
  const testEnv = {
    ORDERS: testKv,
    ENVIRONMENT: "production",
    // All alert secrets absent
  };

  const checkoutId = "ws_TEST_ALERT_3";
  const orderRef = "MA-NOSEC-3333";
  const pendingRecord = {
    reference: orderRef,
    checkoutRequestId: checkoutId,
    amount: 1500,
    status: "pending",
    createdAt: Date.now(),
    items: [{ slug: "crew-tee", qty: 2 }],
    name: "No Secret Buyer",
    msisdn: "254799887766",
  };

  await putPending(testEnv, checkoutId, pendingRecord);
  await putPending(testEnv, refKey(orderRef), pendingRecord);

  const waitUntilPromises = [];
  const context = { waitUntil: (p) => waitUntilPromises.push(p) };

  let threw = false;
  try {
    const res = await settle(
      testEnv,
      checkoutId,
      { state: "paid", amount: 1500, via: "callback" },
      context
    );
    eq(res.outcome, "settled", "settle succeeds with missing secrets");
    await Promise.all(waitUntilPromises);
  } catch {
    threw = true;
  }

  check(!threw, "missing secrets throw nothing");
  eq(telegramCalls.length, 0, "missing secrets send 0 Telegram calls");
  eq(emailCalls.length, 0, "missing secrets send 0 email calls");
}

/* 21. Preview deployments must not alert */
{
  telegramCalls = [];
  emailCalls = [];

  const testKv = createMockKv();
  const previewEnv = {
    ORDERS: testKv,
    CF_PAGES_ENVIRONMENT: "preview",
    CF_PAGES_BRANCH: "order-alerts",
    ...ALERT_ENV,
  };

  const checkoutId = "ws_TEST_ALERT_4";
  const orderRef = "MA-PREV-4444";
  const pendingRecord = {
    reference: orderRef,
    checkoutRequestId: checkoutId,
    amount: 1500,
    status: "pending",
    createdAt: Date.now(),
    items: [{ slug: "crew-tee", qty: 2 }],
    name: "Preview Buyer",
    msisdn: "254799887766",
  };

  await putPending(previewEnv, checkoutId, pendingRecord);
  await putPending(previewEnv, refKey(orderRef), pendingRecord);

  const waitUntilPromises = [];
  const context = { waitUntil: (p) => waitUntilPromises.push(p) };

  await settle(
    previewEnv,
    checkoutId,
    { state: "paid", amount: 1500, via: "callback" },
    context
  );
  await Promise.all(waitUntilPromises);

  eq(telegramCalls.length, 0, "preview deployment sends NO Telegram alert");
  eq(emailCalls.length, 0, "preview deployment sends NO email alert");
}

/* 22. Buyer name with markup is sent as plain text */
{
  const markupOrder = {
    reference: "MA-MARK-5555",
    amount: 1000,
    name: "<b>Bold</b> & <i>Italic</i>",
    items: [{ slug: "crew-tee", qty: 1 }],
  };
  const msg = formatAlertMessage(markupOrder);
  contains(msg, "<b>Bold</b> & <i>Italic</i>", "markup sent as plain text string without escaping");
}

/* 23. No secret appears in any captured log line */
{
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(String).join(" "));
    origLog(...args);
  };

  const testKv = createMockKv();
  const testEnv = {
    ORDERS: testKv,
    ...ALERT_ENV,
  };

  const checkoutId = "ws_TEST_ALERT_LOG";
  const orderRef = "MA-LOGS-6666";
  const pendingRecord = {
    reference: orderRef,
    checkoutRequestId: checkoutId,
    amount: 1500,
    status: "pending",
    createdAt: Date.now(),
    items: [{ slug: "crew-tee", qty: 2 }],
    name: "Log Test Buyer",
    msisdn: "254799887766",
  };

  await putPending(testEnv, checkoutId, pendingRecord);
  await putPending(testEnv, refKey(orderRef), pendingRecord);

  const waitUntilPromises = [];
  const context = { waitUntil: (p) => waitUntilPromises.push(p) };

  await settle(
    testEnv,
    checkoutId,
    { state: "paid", amount: 1500, via: "callback" },
    context
  );
  await Promise.all(waitUntilPromises);

  console.log = origLog;

  const combinedLogs = logs.join("\n");
  lacks(combinedLogs, "fake-telegram-bot-token-xyz", "bot token never logged");
  lacks(combinedLogs, "fake-chat-id-12345", "chat id never logged");
  lacks(combinedLogs, "fake-resend-api-key-abc", "email api key never logged");
  lacks(combinedLogs, "Log Test Buyer", "buyer name never logged");
  lacks(combinedLogs, "254799887766", "buyer phone never logged");
}

/* Restore fetch */
globalThis.fetch = originalFetch;

console.log(`\n  ${failed ? `${failed} FAILED, ` : ""}${passed} checks pass.\n`);
process.exit(failed ? 1 : 0);
