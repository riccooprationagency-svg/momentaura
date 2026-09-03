---
name: testing-track-and-orders
description: How to run MomentAura locally with a KV-backed Cloudflare Pages dev server so /track, /api/track, the M-Pesa callback and the order lifecycle can be tested end to end in a browser.
---

# Testing /track and the order lifecycle locally

The site is static Astro plus Cloudflare Pages Functions in `functions/api`, with order
state in KV binding `ORDERS`. `astro dev` alone does NOT serve the functions — any order
test needs `wrangler pages dev` over a built `dist/`.

## Bring up a KV-backed dev server

```bash
source ~/.nvm/nvm.sh          # Node must be >= 22.12
npm run build
```

There is no committed `wrangler.toml` (Cloudflare config lives in the dashboard), so write
a **temporary, uncommitted** one at the repo root:

```toml
name = "momentaura"
pages_build_output_dir = "dist"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "ORDERS"
id = "testorders"
```

Then:

```bash
npx wrangler pages dev dist --port 8788 --persist-to .wrangler/state
```

Seed and read KV against the *same* local store (the CLI and `pages dev` share it as long
as `--persist-to` and the namespace id match):

```bash
npx wrangler kv key put --binding ORDERS --local --persist-to .wrangler/state \
  'ref:MA-4KLM-2XQP' '{"reference":"MA-4KLM-2XQP","items":[{"slug":"crew-tee","qty":2}],
   "amount":1300,"msisdn":"254712345678","name":"T","email":"t@e.com",
   "status":"pending","createdAt":1757000000000}'
npx wrangler kv key get --binding ORDERS --local --persist-to .wrangler/state 'ref:MA-4KLM-2XQP'
```

Record shape and keys come from `functions/api/mpesa/stk.js` (writes `ref:<reference>` and
the CheckoutRequestID key) and `functions/api/_pending.js`. Reference format is
`MA-XXXX-XXXX`; phone is normalised to `2547XXXXXXXX` by `msisdnFrom` in `_order.js`, so a
lookup with `07…` matches a stored `2547…`.

## Settle an order without Daraja credentials

Do not hand-write a `paid` record if you want to prove the real path. Seed a `pending`
record under both keys, then POST the callback (it only needs the token and an allowlisted
IP, both local env vars in an uncommitted `.dev.vars`):

```
MPESA_CALLBACK_TOKEN=testtoken123
MPESA_CALLBACK_IPS=127.0.0.1
```

```bash
curl -s -X POST localhost:8788/api/mpesa/callback/testtoken123 \
  -H 'Content-Type: application/json' -H 'CF-Connecting-IP: 127.0.0.1' \
  -d '{"Body":{"stkCallback":{"CheckoutRequestID":"ws_CO_TESTCHECKOUT001","ResultCode":0,
       "ResultDesc":"ok","CallbackMetadata":{"Item":[{"Name":"Amount","Value":1300},
       {"Name":"MpesaReceiptNumber","Value":"TFG5XYZ123"}]}}}}'
```

The amount must equal the stored one or `settle()` records `mismatch` instead of `paid`.

## Gotchas

- **No dispatch date will ever render with shipped data**: every product in
  `src/data/products.json` has `leadTimeDays: null`, and `dispatchDate()` in `track.js`
  returns null unless every line has a numeric lead time. To exercise the date, temporarily
  set e.g. `crew-tee` to `"leadTimeDays": 5`, rebuild, and revert afterwards.
- **The rate limiter is invisible in a local browser.** `_throttle.js` keys on
  `CF-Connecting-IP`, which localhost requests do not carry, so it fails open and the
  budget can only be driven with curl passing that header explicitly. Only misses count.
- To test a real network failure in the UI (rather than devtools offline), just kill the
  `wrangler pages dev` process, submit the form, and restart it. Cleaner on a recording
  than opening devtools.
- Clean up afterwards: delete `wrangler.toml` and `.dev.vars`, and `git checkout`
  `src/data/products.json`. None of them should be committed.

## Devin Secrets Needed

None. Everything above runs against local KV with fake Daraja values; real Daraja/IntaSend
credentials are not required and the STK push path cannot be exercised without them.
