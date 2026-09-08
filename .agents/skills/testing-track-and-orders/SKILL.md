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

Cloudflare configuration lives in the dashboard, so the repo carries no `wrangler.toml`
and `.gitignore` keeps it that way. Write a **local-only** one at the repo root — it
exists to give `wrangler pages dev` a KV binding and nothing else:

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
npx wrangler pages dev dist --port 8788 --persist-to .wrangler/track-test
```

`--persist-to` names a directory this procedure owns, so cleanup can delete the seeded
data by name rather than by guessing which parts of `.wrangler/` were yours.

Seed and read KV against the *same* local store (the CLI and `pages dev` share it as long
as `--persist-to` and the namespace id match):

```bash
npx wrangler kv key put --binding ORDERS --local --persist-to .wrangler/track-test \
  'ref:MA-4KLM-2XQP' '{"reference":"MA-4KLM-2XQP","items":[{"slug":"crew-tee","qty":2}],
   "amount":1300,"msisdn":"254712345678","name":"T","email":"t@e.com",
   "status":"pending","createdAt":1757000000000}'
npx wrangler kv key get --binding ORDERS --local --persist-to .wrangler/track-test 'ref:MA-4KLM-2XQP'
```

Record shape and keys come from `functions/api/mpesa/stk.js` — it writes `ref:<reference>`
before the push goes out and the CheckoutRequestID key after it — and from
`functions/api/_pending.js`. Reference format is `MA-XXXX-XXXX`.

`msisdnFrom` in `_order.js` strips a leading `+` and replaces a leading `0` with `254`, so
`07…` stores as `2547…` and `01…` stores as `2541…`. Both are Kenyan mobile prefixes and
the normalisation does not fold either one into the other. Store the normalised form, and
a lookup typed as `07…`, `+2547…` or `2547…` finds the same record.

## Settle an order without Daraja credentials

Do not hand-write a `paid` record if you want to prove the real path. Seed a `pending`
record under **both** keys — that is the state a real push leaves behind — then POST the
callback (it only needs the token and an allowlisted IP, both local env vars in an
uncommitted `.dev.vars`):

```bash
ORDER='{"reference":"MA-4KLM-2XQP","items":[{"slug":"crew-tee","qty":2}],
 "amount":1300,"msisdn":"254712345678","name":"T","email":"t@e.com",
 "status":"pending","createdAt":1757000000000}'

for key in 'ref:MA-4KLM-2XQP' 'ws_CO_TESTCHECKOUT001'; do
  npx wrangler kv key put --binding ORDERS --local --persist-to .wrangler/track-test \
    "$key" "$ORDER"
done
```

The real CheckoutRequestID copy also carries `checkoutRequestId`, `merchantRequestId` and
`pushedAt`. Nothing on the read path uses them, so the identical record under both keys is
enough here.

```
MPESA_CALLBACK_TOKEN=testtoken123
MPESA_CALLBACK_IPS=127.0.0.1
```

**Both values are localhost fixtures and must never be set in a deployed environment.**
The token is the whole of defence 1 on `functions/api/mpesa/callback/[token].js`, the
endpoint that marks money received, and a token written down in a repo is not a secret.
`127.0.0.1` is defence 2 pointed at your own machine — in production that list is
Safaricom's published ranges. Real values live in Cloudflare environment variables and are
never written here.

```bash
curl -s -X POST localhost:8788/api/mpesa/callback/testtoken123 \
  -H 'Content-Type: application/json' -H 'CF-Connecting-IP: 127.0.0.1' \
  -d '{"Body":{"stkCallback":{"CheckoutRequestID":"ws_CO_TESTCHECKOUT001","ResultCode":0,
       "ResultDesc":"ok","CallbackMetadata":{"Item":[{"Name":"Amount","Value":1300},
       {"Name":"MpesaReceiptNumber","Value":"TFG5XYZ123"}]}}}}'
```

**The CheckoutRequestID in the body must be a key that was actually seeded.** `settle()`
looks the record up by that id alone, never by reference, so a callback naming an id KV
has never seen returns `unknown`, writes nothing, and still answers 200 — the endpoint
always answers 200. The order then sits at `pending`, and a run that seeded only the
`ref:` key reads as a bug in the code when it is a gap in the seed.

The amount must equal the stored one or `settle()` records `mismatch` instead of `paid`.

Read **both** keys back afterwards. `persist()` in `_pending.js` writes the reference copy
first and the CheckoutRequestID copy second, so a settled callback leaves both saying
`paid`. A `ref:` copy still reading `pending` is the bug PR #8 fixed and
`scripts/mpesa-test.mjs` asserts against — if it turns up locally, something is wrong with
the run rather than with the code.

## Gotchas

- **No dispatch date will ever render with shipped data**: every product in
  `src/data/products.json` has `leadTimeDays: null`, and `dispatchDate()` in `track.js`
  returns null unless every line has a numeric lead time. To exercise the date, temporarily
  set e.g. `crew-tee` to `"leadTimeDays": 5` and rebuild — after taking the guard in
  **Clean up** below, which is what makes that edit reversible.
- **The rate limiter is invisible in a local browser.** `_throttle.js` keys on
  `CF-Connecting-IP`, which localhost requests do not carry, so it fails open and the
  budget can only be driven with curl passing that header explicitly. Only misses count.
- To test a real network failure in the UI (rather than devtools offline), kill the
  `wrangler pages dev` process, submit the form, and restart it. Cleaner on a recording
  than opening devtools.

## Clean up

**Delete only what this procedure created. Never run a command that discards uncommitted
work by area** — no `git checkout .`, no `git checkout -- <path>`, no `git stash`, no
`git clean`. Another session may be working in this tree, and a restore that reaches past
your own edit takes their work with it and reports nothing. This repo has lost files that
way already.

The procedure creates three things:

- `wrangler.toml` and `.dev.vars` at the repo root — both untracked and gitignored
- the local KV store under `.wrangler/track-test`
- at most one edit to `src/data/products.json`, and only if you exercised the dispatch date

Only the last touches a tracked file, so only the last needs a guard. **Take it before the
edit, not after:**

```bash
git status --porcelain src/data/products.json
# Any output at all: STOP. Those changes are not yours and not yours to restore.
# Say so, and leave the dispatch date untested.

cp src/data/products.json /tmp/products.json.orig
```

Then, afterwards:

```bash
# Put back exactly the bytes that were there — not whatever HEAD happens to say.
cp /tmp/products.json.orig src/data/products.json && rm /tmp/products.json.orig

rm -f wrangler.toml .dev.vars
rm -rf .wrangler/track-test

# Anything still listed is somebody else's work. Leave it, and report it.
git status --porcelain
```

If you reach cleanup without having taken that copy, do not guess and do not reach for
git. Leave `src/data/products.json` as it stands, report the one line you changed, and let
a person decide what to revert.

## Devin Secrets Needed

None. Everything above runs against local KV with fake Daraja values; real Daraja/IntaSend
credentials are not required and the STK push path cannot be exercised without them.
