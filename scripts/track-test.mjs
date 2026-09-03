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

/* track.js imports the catalogue directly too, for lead times. Same redirection,
   same reason: the catalogue this repo ships is never edited to make a test pass. */
const trackPath = join(scratch, "track.js");
const trackSource = readFileSync(trackPath, "utf8");
const trackPatched = trackSource.replace(
  /^import catalogue from .*$/m,
  "const catalogue = globalThis.__catalogue;"
);
if (trackPatched === trackSource) throw new Error("could not find the catalogue import — has track.js moved it?");
writeFileSync(trackPath, trackPatched, "utf8");

globalThis.__catalogue = [
  { slug: "crew-tee", name: "Crew tee", price: 650, stock: 6, leadTimeDays: null },
  { slug: "quick-cap", name: "Quick cap", price: 900, stock: 4, leadTimeDays: 5 },
];

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
    /* track.js never writes. This exists only so a case can rewrite the stored
       order between resetKv() and the request. */
    async put(key, value) {
      store.set(key, value);
    },
  };
}

const ask = (body, method = "POST", ip = "197.0.113.5") =>
  onRequest({
    request: new Request("https://momentaura.co.ke/api/track", {
      method,
      headers: { "Content-Type": "application/json", ...(ip ? { "CF-Connecting-IP": ip } : {}) },
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
  /* dispatchDate is absent here because crew-tee has no lead time; the cases
     below cover it being present. */
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

await check("not found reads as a correction with a route to contact, not an error", async () => {
  const message = (await (await ask({ ...GOOD, reference: "MA-ZZZZ-ZZZZ" })).json()).message;
  for (const part of ["cannot be found", "Check the reference", "contact page"]) {
    if (!message.includes(part)) throw new Error(`message lacks ${JSON.stringify(part)}: ${message}`);
  }
  for (const wrong of ["Error", "error", "failed", "invalid", " we "]) {
    if (message.includes(wrong)) throw new Error(`message reads as an error or says "we": ${wrong}`);
  }
});

await check("a wrong phone does not confirm the reference exists", async () => {
  const res = await ask({ ...GOOD, phone: "0700000000" });
  const text = await res.text();
  lacks(text, REFERENCE, "the reference");
  lacks(text, "paid", "the status");
});

/* ---------- the dispatch date ---------- */

/* Rewrites the stored order so a case can set its lines and status. */
const store = async (patch) => {
  const current = await kv.get(`ref:${REFERENCE}`, "json");
  await kv.put(`ref:${REFERENCE}`, JSON.stringify({ ...current, ...patch }));
};

await check("a settled order whose lines all have a lead time gets A DATE", async () => {
  await store({ items: [{ slug: "quick-cap", qty: 1 }], status: "paid", settledAt: Date.UTC(2026, 8, 2) });
  const body = await (await ask(GOOD)).json();
  /* Wednesday 2 September 2026 plus five working days. */
  eq(body.dispatchDate, "Wednesday 9 September", "a long-form date, never a duration");
});

/* The date is formatted in Nairobi, so it has to be counted there. A settlement
   at 01:00 Nairobi is the previous day in UTC, and counting from the previous
   day either lands the promise short or lands it on a Saturday. */
await check("A SETTLEMENT AFTER MIDNIGHT IN NAIROBI COUNTS FROM THE NAIROBI DAY", async () => {
  /* 22:30 UTC on Sunday 6 September 2026 is 01:30 Monday 7 September in Nairobi. */
  await store({ items: [{ slug: "quick-cap", qty: 1 }], status: "paid", settledAt: Date.UTC(2026, 8, 6, 22, 30) });
  const body = await (await ask(GOOD)).json();
  /* Monday 7 plus five working days is Monday 14. Counted from Sunday 6 in UTC
     it would read Friday 11 — three days early, and from a Sunday that is not a
     working day at all. */
  eq(body.dispatchDate, "Monday 14 September", "counted from the Nairobi day");
});

await check("the date skips the weekend rather than counting calendar days", async () => {
  await store({ items: [{ slug: "quick-cap", qty: 1 }], status: "paid", settledAt: Date.UTC(2026, 8, 4) });
  const body = await (await ask(GOOD)).json();
  /* Friday 4 September plus five working days lands on Friday 11, not Wednesday 9. */
  eq(body.dispatchDate, "Friday 11 September", "weekend skipped");
});

await check("ONE LINE WITH NO LEAD TIME AND THE FIELD IS ABSENT ENTIRELY", async () => {
  await store({
    items: [{ slug: "quick-cap", qty: 1 }, { slug: "crew-tee", qty: 1 }],
    status: "paid",
    settledAt: Date.UTC(2026, 8, 2),
  });
  const body = await (await ask(GOOD)).json();
  if ("dispatchDate" in body) throw new Error(`a date was guessed from a null lead time: ${body.dispatchDate}`);
});

await check("the catalogue this repo ships yields no date, because every lead time is null", async () => {
  await store({ items: [{ slug: "crew-tee", qty: 2 }], status: "paid", settledAt: Date.now() });
  const body = await (await ask(GOOD)).json();
  if ("dispatchDate" in body) throw new Error("a date rendered from a null lead time");
});

await check("an unsettled order carries no dispatch date, lead time or not", async () => {
  await store({ items: [{ slug: "quick-cap", qty: 1 }], status: "pending", settledAt: Date.UTC(2026, 8, 2) });
  const body = await (await ask(GOOD)).json();
  eq(body.status, "pending", "status");
  if ("dispatchDate" in body) throw new Error("a pending order was given a delivery date");
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

/* ---------- the guessing budget ---------- */

const missTwenty = async (ip) => {
  for (let i = 0; i < 20; i++) await ask({ ...GOOD, reference: "MA-ZZZZ-ZZZZ" }, "POST", ip);
};

await check("MISSES RUN OUT — the twenty-first is refused rather than answered", async () => {
  await missTwenty("197.0.113.9");
  const res = await ask({ ...GOOD, reference: "MA-ZZZZ-ZZZZ" }, "POST", "197.0.113.9");
  eq(res.status, 429, "status");
  eq(res.headers.get("Retry-After"), "600", "Retry-After");
  const message = (await res.json()).message;
  for (const part of ["Wait ten minutes", "contact page"]) {
    if (!message.includes(part)) throw new Error(`message lacks ${JSON.stringify(part)}: ${message}`);
  }
});

await check("the budget is spent by the address that spent it, not by everyone", async () => {
  await missTwenty("197.0.113.9");
  eq((await ask(GOOD, "POST", "197.0.113.10")).status, 200, "another address is unaffected");
});

await check("A BUYER CHECKING THEIR OWN ORDER NEVER RUNS OUT — only misses count", async () => {
  for (let i = 0; i < 40; i++) {
    const res = await ask(GOOD);
    if (res.status !== 200) throw new Error(`lookup ${i + 1} was refused with ${res.status}`);
  }
});

await check("a spent budget answers before the order is read, so it confirms nothing", async () => {
  await missTwenty("197.0.113.9");
  const res = await ask(GOOD, "POST", "197.0.113.9");
  eq(res.status, 429, "a real reference is refused the same as a wrong one");
  lacks(await res.text(), REFERENCE, "the reference");
});

await check("KV FAILING NEVER LOCKS A BUYER OUT — the budget fails open", async () => {
  const reads = kv.get.bind(kv);
  kv.get = async (key, type) => {
    if (key.startsWith("try:")) throw new Error("KV read failed");
    return reads(key, type);
  };
  eq((await ask(GOOD)).status, 200, "the order is still found");
});

console.log("");
if (failures.length) {
  console.error(`  ${failures.length} failure(s), ${passed} passed:\n`);
  for (const f of failures) console.error(`    ${f}`);
  console.error("");
  process.exit(1);
}
console.log(`  ${passed} checks pass.\n`);
