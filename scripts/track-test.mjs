#!/usr/bin/env node
/* Exercises functions/api/track.js — order lookup by reference plus phone.
 *
 * Not a money endpoint, but it is an ACCESS endpoint: it decides who gets to see
 * what somebody bought and for how much. The properties worth a gate are the
 * ones that are invisible when they work — that a wrong phone number and a
 * reference that does not exist give the identical answer, and that the response
 * carries nothing beyond what the buyer already knows.
 *
 * The handler and the modules it imports are the shipped code. Only the
 * catalogue import (via _order.js) and the KV binding are substituted.
 *
 *   node scripts/track-test.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = join(ROOT, "functions", "api");

const scratch = join(tmpdir(), `momentaura-track-${Date.now()}`);
mkdirSync(scratch, { recursive: true });
cpSync(API, scratch, { recursive: true });

const orderPath = join(scratch, "_order.js");
const orderSource = readFileSync(orderPath, "utf8");
const orderPatched = orderSource.replace(
  /^import catalogue from .*$/m,
  "const catalogue = globalThis.__catalogue;"
);
if (orderPatched === orderSource) throw new Error("could not find the catalogue import — has _order.js moved it?");
writeFileSync(orderPath, orderPatched, "utf8");
globalThis.__catalogue = [{ slug: "crew-tee", name: "Crew tee", price: 650, stock: 6 }];

const { onRequest } = await import(pathToFileURL(join(scratch, "track.js")).href);

/* ---------- an in-memory KV holding one order ---------- */

const REFERENCE = "MA-4KLM-2XQP";

let kv;
function resetKv() {
  const store = new Map();
  store.set(
    `ref:${REFERENCE}`,
    JSON.stringify({
      reference: REFERENCE,
      items: [{ slug: "crew-tee", qty: 2 }],
      amount: 1300,
      msisdn: "254712345678",
      name: "Amina Wanjiru",
      email: "amina@example.com",
      checkoutRequestId: "ws_CO_TEST_1",
      status: "paid",
      createdAt: 1_700_000_000_000,
    })
  );
  kv = {
    failReads: false,
    async get(key, type) {
      if (this.failReads) throw new Error("KV read failed");
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put() {},
  };
}

const ask = (body, method = "POST") =>
  onRequest({
    request: new Request("https://momentaura.co.ke/api/track", {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    }),
    env: { ORDERS: kv },
  });

/* ---------- harness ---------- */

let passed = 0;
const failures = [];

async function check(label, fn) {
  resetKv();
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
const lacks = (h, n, what) => {
  if (String(h).includes(n)) throw new Error(`${what}: LEAKS ${JSON.stringify(n)}`);
};

const GOOD = { reference: REFERENCE, phone: "0712345678" };

console.log("\n  track.js — an order, by reference and phone\n");

await check("the right reference and phone find the order", async () => {
  const res = await ask(GOOD);
  eq(res.status, 200, "status");
  const body = await res.json();
  eq(body.reference, REFERENCE, "reference");
  eq(body.status, "paid", "status");
  eq(body.amount, 1300, "amount");
  eq(body.items, [{ slug: "crew-tee", qty: 2 }], "items");
});

await check("the response carries nothing beyond what the buyer already knows", async () => {
  const res = await ask(GOOD);
  const text = await res.text();
  eq(Object.keys(JSON.parse(text)).sort(), ["amount", "items", "placedAt", "reference", "status"], "keys");
  lacks(text, "Amina", "the name");
  lacks(text, "amina@example.com", "the email");
  lacks(text, "254712345678", "the phone number");
  lacks(text, "ws_CO_TEST_1", "the CheckoutRequestID");
});

await check("the phone matches however it was typed", async () => {
  for (const phone of ["0712345678", "+254712345678", "254712345678", "0712 345 678", "0712-345-678"]) {
    resetKv();
    const res = await ask({ ...GOOD, phone });
    if (res.status !== 200) throw new Error(`${phone} was refused with ${res.status}`);
  }
});

await check("a lower-case reference still finds the order", async () => {
  eq((await ask({ ...GOOD, reference: REFERENCE.toLowerCase() })).status, 200, "status");
});

await check("surrounding whitespace on the reference is tolerated", async () => {
  eq((await ask({ ...GOOD, reference: `  ${REFERENCE} ` })).status, 200, "status");
});

/* ---------- the property this endpoint exists to hold ---------- */

await check("A WRONG PHONE AND AN UNKNOWN REFERENCE GIVE THE IDENTICAL ANSWER", async () => {
  const wrongPhone = await ask({ ...GOOD, phone: "0700000000" });
  resetKv();
  const noSuchOrder = await ask({ ...GOOD, reference: "MA-ZZZZ-ZZZZ" });

  eq(wrongPhone.status, noSuchOrder.status, "status");
  eq(wrongPhone.status, 404, "both are 404");
  eq(await wrongPhone.text(), await noSuchOrder.text(), "body");
});

await check("a wrong phone does not confirm the reference exists", async () => {
  const res = await ask({ ...GOOD, phone: "0700000000" });
  const text = await res.text();
  lacks(text, REFERENCE, "the reference");
  lacks(text, "paid", "the status");
});

/* ---------- what the buyer typed ---------- */

await check("a malformed reference is a field-level correction", async () => {
  const res = await ask({ ...GOOD, reference: "not-a-reference" });
  eq(res.status, 400, "status");
  eq((await res.json()).field, "reference", "field");
});

await check("a malformed phone is a field-level correction", async () => {
  const res = await ask({ ...GOOD, phone: "+447700900000" });
  eq(res.status, 400, "status");
  eq((await res.json()).field, "phone", "field");
});

for (const [label, body] of [
  ["not JSON at all", "{{{"],
  ["null", null],
  ["an array", []],
  ["no reference", { phone: "0712345678" }],
  ["no phone", { reference: REFERENCE }],
  ["a reference that is not a string", { reference: 12, phone: "0712345678" }],
]) {
  await check(`rejected: ${label}`, async () => {
    const res = await ask(body);
    if (res.status < 400 || res.status > 499) throw new Error(`expected a 4xx, got ${res.status}`);
  });
}

/* ---------- method, headers, failure ---------- */

await check("a GET is refused", async () => {
  const res = await ask(null, "GET");
  eq(res.status, 405, "status");
  eq(res.headers.get("Allow"), "POST", "Allow");
});

await check("a lookup is never cached", async () => {
  const res = await ask(GOOD);
  eq(res.headers.get("Cache-Control"), "no-store", "Cache-Control");
  eq(res.headers.get("X-Content-Type-Options"), "nosniff", "nosniff");
});

await check("KV failing says so rather than reporting no such order", async () => {
  kv.failReads = true;
  const res = await ask(GOOD);
  eq(res.status, 503, "status");
  lacks(await res.text(), "No order matches", "never claims the order does not exist");
});

console.log("");
if (failures.length) {
  console.error(`  ${failures.length} failure(s), ${passed} passed:\n`);
  for (const f of failures) console.error(`    ${f}`);
  console.error("");
  process.exit(1);
}
console.log(`  ${passed} checks pass.\n`);
