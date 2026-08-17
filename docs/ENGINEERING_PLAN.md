# Engineering plan — MomentAura

**Version** 0.1 · **Date** 9 August 2026
**Derives from** `PRD.md` and `DESIGN_BRIEF.md`. Requirement IDs below (M2.4, FR-1.3)
refer to the PRD.

---

## 1. Architecture

```
Browser
  │
  ├─ Static HTML from Cloudflare Pages edge          no server, no database
  │
  ├─ cart.js  (localStorage)                          the only client-side JS
  │
  ├─ POST /api/checkout ──► Pages Function (edge)
  │                           re-prices from own catalogue
  │                           gateway secret lives here only
  │                           └─► gateway hosted checkout ──► M-Pesa / card
  │
  └─ POST /api/quote ─────► Pages Function (edge)
                              validates, rate-limits, emails owner
```

**Two properties this buys, and they are the reason for the whole design:**

`[C]` No card field ever exists on our domain. Checkout is a redirect to the gateway's
own hosted page, which keeps PCI scope at the lightest tier.

`[C]` No database and no admin login. The two most common e-commerce compromise routes
— plugin CVEs and credential stuffing on a login page — do not exist here.

### Stack and rationale

| Layer | Choice | Why |
|---|---|---|
| Framework | Astro 5, static output | Ships zero JS by default; the payload budget is pass/fail |
| Host | Cloudflare Pages | `[C]` Free tier permits commercial use, unlimited bandwidth. Vercel Hobby and GitHub Pages prohibit it |
| Edge functions | Pages Functions | 100k req/day free; keeps secrets server-side |
| Payments | IntaSend or Pesapal, hosted checkout | `[C]` Free WooCommerce-grade plugins exist but we need the API; both support M-Pesa |
| Forms | Pages Function → email | No third-party form service, no extra script |
| Fonts | Self-hosted woff2 | `[C]` No third-party request, faster on mobile |
| Analytics | GA4 + Cloudflare Web Analytics | GA4 needed for Hermes anyway |
| CDN, SSL, WAF | Cloudflare | Included free; edge serving matters on Kenyan mobile |

**Fixed cost: KSh 0/year** plus domain renewal. Against `[L]` KSh 45,000–61,000 for
Shopify Basic.

### Why not WordPress

`[C]` WordPress adds a database, an admin login, a plugin patch treadmill and PHP
execution — three new attack surfaces and a maintenance burden, for one benefit:
content editing without a deploy. `[L]` at eight pages edited monthly, that benefit
does not pay for itself. Revisit when weekly edits by a non-technical person become
the norm.

## 2. Repository layout

```
momentaura/
  CLAUDE.md                    agent constraints — read every session
  AGENTS.md                    pointer for Antigravity
  README.md                    build and deploy runbook
  docs/
    PRD.md  DESIGN_BRIEF.md  ENGINEERING_PLAN.md
    brand-brief.md            positioning and page copy
    STYLE-dark-editorial.md   dark system spec
  src/
    styles/     tokens.css  tokens-dark.css  global.css
    layouts/    Base.astro
    components/ ProductCard  DispatchLabel  CapacityNotice  ProductReveal  QuoteForm
    pages/      index  gift-sets  personalised  bulk-orders  delivery  about
                contact  privacy  order  order-received  products/[slug]
    data/       products.json
    lib/        cart.js  catalogue.js  format.js
  functions/api/ checkout.js  quote.js
  public/fonts/  archivo-variable.woff2  jetbrains-mono-variable.woff2
  scripts/       validate-catalogue.js
```

## 3. Data model

`products.json` is the single source of truth. `[C]` never hardcode a product into a
template.

```jsonc
{
  "slug": "founders-set",              // URL and cart key. Immutable once live.
  "name": "Founders set — flask, notebook, pen",
  "category": "gift-sets",
  "price": 4300,                        // KSh, integer. Server-side authority.
  "contents": ["500ml insulated steel flask", "A5 hardcover notebook, lined"],
  "summary": "Flask, A5 notebook, pen. Boxed.",
  "minOrder": 1,
  "bulkFrom": 10,                       // quote threshold for this product
  "leadTimeDays": 5,
  "personalisable": true,
  "personalisationLeadDays": 10,
  "photo": null,                        // null → honest placeholder
  "theme": "light",                     // "dark" requires photo != null
  "inStock": true
}
```

### Build-time validation — `scripts/validate-catalogue.js`

Runs before every build. Fails the build on any of:

1. `theme: "dark"` with `photo: null` — `[C]` enforces the DESIGN_BRIEF §4 gate
2. Duplicate or missing `slug`
3. `price` non-integer or ≤ 0
4. `bulkFrom` < 2
5. Empty `contents`
6. A `category` not present in the categories list

`[L]` this single script prevents the most likely production failure: shipping a dark
editorial section with an empty photo slot.

## 4. Build phases

Each phase has tasks and an acceptance test. Do not start the next until the test passes.

---

### Phase 0 — Foundations

| # | Task |
|---|---|
| 0.1 | `npm create astro@latest`, minimal template, TypeScript off |
| 0.2 | Commit `CLAUDE.md` and `AGENTS.md` **first**, before any component |
| 0.3 | Download Archivo and JetBrains Mono variable woff2 into `public/fonts` |
| 0.4 | Write `tokens.css` from DESIGN_BRIEF §5 |
| 0.5 | Write `global.css`: base elements, dispatch label, buttons, layout primitives |
| 0.6 | `.gitignore`, `.env.example` |
| 0.7 | Enable 2FA on GitHub. `[C]` payment links live in this repo |

**Accept:** `npm run dev` serves a blank page using tokens. No raw hex outside
`tokens.css`.

---

### Phase 1 — Catalogue and static pages (PRD M2)

| # | Task | Req |
|---|---|---|
| 1.1 | `products.json` with the cleared catalogue only | M0.1–2 |
| 1.2 | `scripts/validate-catalogue.js`, wired into `prebuild` | — |
| 1.3 | `Base.astro`: head, skip link, nav, footer, font preload | — |
| 1.4 | `DispatchLabel.astro` — takes a product, renders verifiable fields only | §6 |
| 1.5 | `ProductCard.astro` | M2.2 |
| 1.6 | `index.astro`: hero, proof row, featured, bulk CTA | M2.1 |
| 1.7 | Category pages from `getStaticPaths` over categories | M2.2 |
| 1.8 | `products/[slug].astro` | M2.3 |
| 1.9 | `delivery`, `about`, `contact`, `privacy` | M2.5–8 |
| 1.10 | Paste copy from `brand-brief.md` §10. Fill every bracket | — |
| 1.11 | Hide `inStock: false` from listings, keep the detail page reachable | M2.11 |

**Accept:** every page renders, no placeholder brackets remain, `npm run build`
succeeds with validation on, Lighthouse accessibility ≥ 95.

---

### Phase 2 — Quote path (PRD FR-2)

`[L]` Build this before checkout. It is the revenue path.

| # | Task |
|---|---|
| 2.1 | `QuoteForm.astro` — labelled fields, name and phone required only |
| 2.2 | `functions/api/quote.js` — validate, honeypot, rate-limit by IP, send email |
| 2.3 | `bulk-orders.astro` — volume tiers, lead times, "what we need", form |
| 2.4 | Confirmation state naming the one-working-day reply window |
| 2.5 | Failure state offering the phone number. `[C]` never a dead end |

**Accept:** a submission from a phone on mobile data produces an email within 60
seconds. Submitting with JS disabled degrades to a `mailto:` or tel link, not a
silent failure.

---

### Phase 3 — Cart and checkout (PRD M3)

| # | Task | Req |
|---|---|---|
| 3.1 | `lib/cart.js` — add, setQty, remove, totals, `needsQuote` | FR-1 |
| 3.2 | Header count, `client:idle` only | M3.1 |
| 3.3 | `order.astro` — review, quantities, customer fields | M3.1 |
| 3.4 | Client-side threshold redirect with explanation | FR-1.5 |
| 3.5 | `functions/api/checkout.js` | M3.3–4 |
| 3.6 | `order-received.astro` | M3.5 |
| 3.7 | Failed-payment return path | M3.7 |

**`checkout.js` must, in this order:**

1. Parse and reject malformed bodies
2. Look up every slug in our own catalogue — unknown slug → 400
3. Reject out-of-stock items with the product named
4. `[C]` **Re-price server-side.** Never read a price from the request body — a client
   that can set its own price sets it to zero
5. Sum units; if ≥ threshold return 409 with a redirect to `/bulk-orders` (FR-1.3)
6. Require name and phone
7. Call the gateway with the secret from `env`, never from a bundle
8. On gateway error, log the status server-side and return a generic message with the
   phone number. `[C]` do not leak the gateway response to the browser
9. Return the hosted checkout URL

**Accept:** one real end-to-end transaction on a live phone, including refund. A
tampered price in the request body is rejected. Eleven units cannot reach checkout by
any path.

---

### Phase 4 — Dark editorial (PRD M4)

`[C]` Blocked until at least one product has a real photograph.

| # | Task |
|---|---|
| 4.1 | `tokens-dark.css` from `STYLE-dark-editorial.md` |
| 4.2 | `ProductReveal.astro` — 100vh, three columns, one product |
| 4.3 | Docket variant: verifiable facts in the accent colour |
| 4.4 | `CapacityNotice.astro` — renders only when given a real figure and date |
| 4.5 | Theme switch driven by `product.theme` |
| 4.6 | Box-opening sequence: image set, tap-triggered, lazy, < 400KB |
| 4.7 | Hero video, own footage only: ≤ 2MB, poster set, `preload="none"`, mobile serves the poster alone |

**Accept:** a mixed catalogue renders both systems without visual collision. No dark
section renders a placeholder. Payload budget still holds.

---

### Phase 5 — Measurement and Hermes (PRD M5)

| # | Task | Note |
|---|---|---|
| 5.1 | GA4 | `[C]` Platform-agnostic — build any time, never wasted |
| 5.2 | Clarity | Same |
| 5.3 | Events: `quote_submitted`, `add_to_order`, `checkout_started`, `order_received` | — |
| 5.4 | Rework Conversion Intelligence schema | See below |
| 5.5 | Order feed to Hermes | Only after Phase 3 |

**Schema rework.** `[C]` the existing fields — top categories, drop-off points,
inferred reasons — assume a self-serve cart with abandonment to analyse. `[L]` under
corporate gifting the dominant funnel is: quote requested → quiet → won or lost. New
fields: `lead_source`, `company`, `quote_value`, `date_sent`, `outcome`,
`loss_reason`.

**Hermes compatibility.** `[L]` roughly 85% of the existing build survives a platform
change, because the platform-agnostic parts were built first.

| Component | Status |
|---|---|
| `division-1-ads.js`, Asante routing, Nia, Zawadi, Meta | Untouched |
| GA4, Clarity | Untouched — platform-agnostic |
| `integrations/shopify.js` | Dies entirely. **Halt the reinstall** |
| Conversion Intelligence schema | Reworked per above |

## 5. Performance budget — pass/fail

| Metric | Budget | How to verify |
|---|---|---|
| Homepage transfer | < 500KB | DevTools network, cache disabled |
| Any page transfer | < 1MB | Same |
| LCP on 3G | < 2.5s | Lighthouse mobile throttled |
| CLS | < 0.05 | Explicit width/height on every image |
| JS shipped | Cart only | Astro build output |
| Font files | 2 total | Network panel |

`[C]` Test on a real phone on Safaricom data before every deploy. Not on wifi, not on a
laptop. `[L]` a store that takes six seconds to load loses more revenue than any fee
structure being optimised against.

**Techniques:** WebP with explicit dimensions · lazy-load below the fold ·
`client:idle` never `client:load` · self-hosted subset fonts with `font-display: swap`
· inline critical CSS · no third-party script without an explicit decision.

## 6. Security

### Threat model

`[L]` Nobody attacks Cloudflare. They attack the operator.

| Threat | Likelihood | Control |
|---|---|---|
| Account takeover — Cloudflare, registrar, GitHub, gateway, email | Medium | 2FA everywhere, **authenticator app not SMS** — SIM-swap is a live problem in Kenya |
| DNS or domain hijack | Low / severe | Registrar lock, 2FA. Highest-consequence single risk |
| Repo access → payment links redirected | Medium | 2FA, review every diff touching `functions/` or payment links |
| Forged M-Pesa confirmation | `[L]` **High** | Never dispatch on a screenshot or SMS — verify in the till statement or gateway dashboard |
| Client-side price tampering | Certain if unhandled | Server-side re-pricing, Phase 3 step 4 |
| Form spam | High | Honeypot, rate limit, no email address in HTML |

`[L]` the forged-confirmation control protects more money than every technical measure
on this list combined. It is a habit, not code.

### Rules

- `[C]` Never build a card form. Ever.
- `[C]` Secrets only in Cloudflare environment variables, read only inside
  `functions/`. If a key would appear in the browser bundle, the design is wrong.
- No third-party script without an explicit decision. Each is an entry point.
- No personal data in URL parameters.

### Compliance

`[C]` Kenya DPA: privacy policy and a working marketing opt-out ship with the first
deploy. The right to object to direct marketing is absolute and immediate. No bought or
scraped lists. Written consent before using anyone's image. `[L]` ODPC registration is
required above KSh 5M turnover or 10 employees — document the exemption position either
way. Not legal advice; confirm with a Kenyan advocate before scaling.

## 7. Deployment runbook

**First deploy**

1. Push to GitHub with 2FA enabled
2. Cloudflare → Workers & Pages → connect repo
3. Build `npm run build`, output `dist`
4. Environment variables from `.env.example`
5. Custom domain → Cloudflare handles DNS and SSL
6. Registrar: enable lock and 2FA
7. Submit sitemap to Google Search Console. `[C]` the domain currently returns nothing
   in search — this is the fix

**Every deploy**

```
□ npm run build passes with catalogue validation
□ No brackets left in copy
□ Payload budget verified on throttled mobile
□ Quote form submits end to end
□ Checkout tested if functions changed
□ No secrets in the diff
```

**Rollback:** Cloudflare Pages keeps every deployment. Roll back in the dashboard, no
rebuild. Keep the previous deployment for 7 days.

## 8. Testing

| Level | What |
|---|---|
| Build | Catalogue validation, Astro build |
| Manual, per deploy | The checklist above |
| Manual, per release | Full quote and checkout flows on a real phone |
| Accessibility | Lighthouse ≥ 95, keyboard-only pass, contrast verified in both systems |

`[L]` no automated test suite at this scale. The build-time catalogue validation is
worth more than unit tests here, because the likely failures are data errors — a dark
theme with no photo, a duplicate slug, a price of zero — not logic errors.

## 9. Sequence

| Phase | Depends on | Blocked by |
|---|---|---|
| 0 Foundations | Name decided (PRD D1) | — |
| 1 Catalogue | Phase 0, deletions complete | PRD M0 |
| 2 Quote path | Phase 1 | — |
| 3 Checkout | Phase 2, gateway chosen (D4) | — |
| 4 Dark editorial | Phase 1, real photography | **PRD M1.2** |
| 5 Measurement | Phase 1 for GA4/Clarity; Phase 3 for orders | — |

**The real blocker is not on this table.** `[C]` PRD M1's gate — ten sales by hand —
sits before Phase 1 in the business sequence even though it appears nowhere in the code.
Phases 0 and 2 can proceed in parallel with selling. Phases 3 to 5 should not.

`[L]` Building feels like progress because it is measurable and nobody rejects you
while you do it. Selling feels bad because strangers say no. That asymmetry, not the
technology, is the main risk to this project.
