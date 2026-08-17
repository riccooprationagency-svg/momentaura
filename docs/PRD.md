# PRD — MomentAura

**Version** 0.1 · **Date** 9 August 2026 · **Owner** Ric · **Status** Draft, pre-validation

Downstream documents: `DESIGN_BRIEF.md`, `ENGINEERING_PLAN.md`. Both derive from this
one. If a requirement changes here, change it there.

**Confidence tags:** `[C]` certain — verified or logically necessary. `[L]` likely —
strong inference. `[G]` guessing — filling a gap, treat as a hypothesis to test.

---

## 1. Problem

`[C]` A Shopify store exists at momentaura.store with 14 SKUs, no inventory, no sales,
and no search presence. Three defects block any growth spend:

1. **Legal exposure.** Listings reproduce licensed characters (Demon Slayer, Dragon
   Ball) and a trademarked watch. Grounds for DMCA takedown and account closure.
2. **Category incoherence.** Four unrelated businesses — corporate gift sets, anime
   merchandise, luxury-coded watches, blank print-on-demand — sharing one storefront.
   No single buyer wants more than one of them.
3. **Trust gap.** Luxury language over supplier photographs, AI-generated models and
   blank mockups. `[L]` Reads as a dropship front to the Kenyan online shopper, who is
   well-calibrated on that pattern.

`[C]` No amount of design or marketing resolves 1 or 2. They are deletions and a
decision, not features.

## 2. Product vision

A store that a Nairobi procurement buyer trusts on first visit, because every claim on
it is specific, checkable, and true.

**North star: plain, exact, dependable.**

## 3. Goals and non-goals

### Goals

| # | Goal | Measure |
|---|---|---|
| G1 | Remove legal exposure | Zero infringing listings live |
| G2 | Present one coherent business | One buyer profile, one catalogue |
| G3 | Convert an unknown visitor into a quote request | Quote form submissions |
| G4 | Make the site trustworthy without inventory-scale spend | Qualitative: buyer feedback on 20 outreach calls |
| G5 | Run at zero fixed cost until revenue justifies otherwise | KSh 0/month hosting |

### Non-goals for v1

- Customer accounts, order history, wishlists
- Multi-currency, international shipping
- Loyalty, referral, subscription
- Blog, CMS, editorial content
- Anime line (deferred — see §9)
- Native mobile app

## 4. Users

`[G]` Unvalidated. Falsify against real conversations before building to these.

### Primary — "Wanjiru", procurement buyer

Office manager, HR lead or marketing coordinator at a Nairobi SME, agency, bank, NGO,
sacco or church. Orders 20–100 units for end-of-year staff gifts, client thank-yous or
onboarding kits. Budget approved in advance; must not overspend or be late.

**Jobs:** get a quote she can forward to finance; confirm a delivery date in writing;
know the supplier is real and reachable.
**Anxieties:** paying a stranger; missing the party date; receiving something that
doesn't match the photos; being personally blamed.
**Behaviour:** `[L]` decides by phone and WhatsApp. Pays by invoice, bank transfer or
paybill. Does not use a self-serve cart at this order size.

### Secondary — "Brian", individual buyer

Buys 1–3 items for himself or a gift. Wants price, delivery time, and a way to pay
now. `[L]` Mobile, on metered data, low patience for a slow page.

### Anti-user

The wholesale price-shopper comparing us to Alibaba. We are not competing on price and
should not design for them.

## 5. Success metrics

**Pre-launch gate — the only metric that matters right now:**

> **Ten sales to people not related to the founder, made by hand, before the site is
> built.** `[C]` Everything in §7 M2 onward is contingent on clearing this.

**Post-launch, first 90 days:**

| Metric | Target | Why |
|---|---|---|
| Quote requests | 8/month | Primary revenue path |
| Quote → order conversion | 25% `[G]` | Baseline to be replaced with real data |
| Cart orders | 10/month | Secondary path, validates checkout |
| Homepage LCP on 3G | < 2.5s | `[C]` Mobile-metered market |
| Homepage transfer | < 500KB | Same |
| Bounce on product pages | < 60% `[G]` | Trust proxy |
| Search: brand name query returns the site | Yes | `[C]` Currently returns nothing |

## 6. The fork — decided

`[C]` Four categories cannot share one storefront. **Corporate and personalised
gifting is the chosen business.**

Rationale: highest AOV (KSh 4,300–5,200 vs KSh 650–1,400), repeat and bulk by nature,
invoice-based, and `[L]` word-of-mouth within a small Nairobi buyer community compounds
faster than any ad spend available at this budget.

Cost of this choice: `[G]` if the existing audience is anime-first, this is a cold
start with no distribution. **Validate before M1.**

## 7. Scope and milestones

Each milestone has an exit gate. Do not start the next until the gate clears.

### M0 — Unblock (this week, ~KSh 0)

| ID | Requirement | Priority |
|---|---|---|
| M0.1 | Delete all listings using licensed characters | P0 |
| M0.2 | Delete watch listings bearing third-party trademarks | P0 |
| M0.3 | Halt the Shopify API reinstall | P0 |
| M0.4 | Downgrade Shopify to Starter or cancel | P0 |
| M0.5 | Confirm the gifting fork against the existing audience | P0 |
| M0.6 | Settle the brand name and domain | P0 |
| M0.7 | Check `.store` renewal price at the registrar | P1 |

**Gate:** zero infringing listings live; name decided in writing.

### M1 — Prove demand by hand (30 days, ≤ KSh 15,000)

| ID | Requirement | Priority |
|---|---|---|
| M1.1 | Buy physical stock for three gift sets | P0 |
| M1.2 | Photograph all three to the standard in `DESIGN_BRIEF.md` §7 | P0 |
| M1.3 | Shoot the 15-second packing clip | P1 |
| M1.4 | WhatsApp Business catalogue live | P0 |
| M1.5 | Safaricom Buy Goods till active | P0 |
| M1.6 | Twenty outreach calls with a physical sample | P0 |
| M1.7 | Record every objection verbatim | P1 |

**Gate: ten sales.** `[C]` Until this clears, the site is speculative.

### M2 — Catalogue site (light system)

| ID | Requirement | Priority |
|---|---|---|
| M2.1 | Homepage: static hero, proof row, categories, featured sets, bulk CTA | P0 |
| M2.2 | Category pages: gift sets, personalised, apparel | P0 |
| M2.3 | Product pages: contents, dispatch label, price, add to order | P0 |
| M2.4 | Bulk orders page: volume tiers, lead times, quote form | P0 |
| M2.5 | Delivery and returns: zones, timelines, payment, return window | P0 |
| M2.6 | About: real name, face, Nairobi location, packing clip | P0 |
| M2.7 | Contact: phone, WhatsApp, email, hours | P0 |
| M2.8 | Privacy policy with working marketing opt-out | P0 |
| M2.9 | Quote form submits and notifies within one minute | P0 |
| M2.10 | Sitemap submitted to Google Search Console | P0 |
| M2.11 | Sold-out products hidden from listings | P1 |

**Gate:** a stranger can find the site, understand the offer, and submit a quote
request on a phone in under 90 seconds.

### M3 — Checkout

| ID | Requirement | Priority |
|---|---|---|
| M3.1 | Browser cart, persists across pages | P0 |
| M3.2 | Orders ≥ 10 units route to the quote path, not checkout | P0 |
| M3.3 | Server-side re-pricing from own catalogue | P0 |
| M3.4 | Hosted gateway checkout — no card fields on our domain | P0 |
| M3.5 | Order confirmation page and email | P0 |
| M3.6 | Out-of-stock items blocked at checkout | P0 |
| M3.7 | Failed-payment path returns the buyer to a usable state | P1 |

**Gate:** one real end-to-end transaction on a live phone, including the refund path.

### M4 — Dark editorial system

`[C]` Gated on real photography existing. See `DESIGN_BRIEF.md` §4.

| ID | Requirement | Priority |
|---|---|---|
| M4.1 | Per-product flag switching light ↔ dark treatment | P0 |
| M4.2 | Product reveal section, one product per viewport | P0 |
| M4.3 | Consignment docket component | P0 |
| M4.4 | Capacity notice — real numbers only | P1 |
| M4.5 | Box-opening image sequence, < 400KB, tap-triggered | P2 |
| M4.6 | Hero video — own footage only, ≤ 2MB, mobile falls back to poster | P2 |

**Gate:** no product renders the dark treatment with a placeholder in the photo slot.

### M5 — Measurement and Hermes

| ID | Requirement | Priority |
|---|---|---|
| M5.1 | GA4 integration | P0 |
| M5.2 | Microsoft Clarity integration | P1 |
| M5.3 | Conversion Intelligence schema reworked for the quote funnel | P1 |
| M5.4 | Order data feed to Hermes | P2 |

`[C]` M5.1 and M5.2 are platform-agnostic and can be built at any point. Order
integration cannot, and should wait for M3.

## 8. Functional requirements — detail

### FR-1 Two purchase paths

`[L]` The single most important structural requirement.

- **FR-1.1** Under 10 units: cart → hosted checkout.
- **FR-1.2** Ten or more: quote request form. No checkout offered.
- **FR-1.3** The threshold is enforced client-side *and* server-side.
- **FR-1.4** Every product page shows both paths without ambiguity about which applies.
- **FR-1.5** Crossing the threshold in-cart redirects, with an explanation of why.

**Rationale:** `[L]` most revenue is path 2. A site that only serves path 1 has no door
for its best customer.

### FR-2 Quote request

- **FR-2.1** Fields: name, company, phone, email, product, quantity, personalisation
  yes/no/unsure, needed-by date, free text.
- **FR-2.2** Only name and phone are required. `[L]` Every additional required field
  costs submissions, and the rest can be gathered on the call.
- **FR-2.3** Submission notifies the owner by email within 60 seconds.
- **FR-2.4** Confirmation states the reply window: one working day.
- **FR-2.5** Failure state offers the phone number as fallback. Never a dead end.

### FR-3 Product presentation

- **FR-3.1** Every product page lists box contents as discrete items.
- **FR-3.2** Every product shows lead time, dispatch point, minimum order, stock status.
- **FR-3.3** Personalisable products show the personalisation lead time separately.
- **FR-3.4** Prices always visible. No "contact for price" under KSh 10,000.
- **FR-3.5** A product without a real photograph renders an honest placeholder, never a
  supplier or AI-generated image.

### FR-4 Trust surface

- **FR-4.1** Delivery zones, timelines and costs stated on a dedicated page.
- **FR-4.2** Payment methods stated explicitly, including paybill number.
- **FR-4.3** Return window and conditions stated, including the personalised-goods
  exception.
- **FR-4.4** About page carries a real name, a photograph of a person, and a Nairobi
  location. `[L]` Highest-leverage single page on the site.
- **FR-4.5** No "Powered by" third-party footer text.

### FR-5 Honest scarcity

- **FR-5.1** No countdown timers, no "only N left", no invented urgency.
- **FR-5.2** Capacity notices state a real production number and a real cut-off date.
- **FR-5.3** If a figure cannot be verified, the component does not render.
- **FR-5.4** No discount may be shown against a price that has never sold.

`[C]` §5.4 exists because nothing has ever sold at list price; a "was/now" claim is
currently unsupportable.

## 9. Deferred

| Item | Condition to revisit |
|---|---|
| Anime line | Original artwork commissioned, zero licensed characters, POD supplier AI policy checked |
| Hero video | Own product footage exists |
| Seasonal offers page | 20+ completed orders and an established price history |
| WordPress / WooCommerce | Weekly content edits by a non-technical person become the norm |
| Customer accounts | Repeat buyers ask for order history |

## 10. Constraints

- `[C]` Zero fixed hosting cost. Cloudflare Pages free tier permits commercial use;
  Vercel Hobby and GitHub Pages prohibit it.
- `[C]` No card data touches our domain, ever.
- `[C]` Homepage under 500KB, LCP under 2.5s on 3G.
- `[C]` Kenya Data Protection Act: marketing opt-out is absolute and immediate;
  no bought or scraped contact lists; written consent before using anyone's image.
- `[L]` ODPC registration required above KSh 5M turnover or 10 employees. Document
  the exemption position either way.
- Single operator. Every requirement must be maintainable by one non-specialist.

## 11. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Platform takedown before deletions complete | Medium | Severe | M0.1–2 first, before anything else |
| Gifting fork is a cold start with no audience | `[G]` Medium | Severe | Validate in M0.5; 20 calls in M1 |
| Site ships with no real photography | `[L]` High | High | M4 gate; honest placeholders by default |
| Forged M-Pesa confirmation | `[L]` High | Medium | Never dispatch on a screenshot — verify in own statement |
| Domain or account takeover | Low | Severe | 2FA everywhere, registrar lock |
| Build absorbs the effort that should go to selling | `[L]` High | High | The M1 gate exists specifically for this |

## 12. Open decisions

| # | Decision | Owner | Blocks |
|---|---|---|---|
| D1 | Brand name — keep or change | Ric | Everything |
| D2 | Gifting vs anime confirmed | Ric | M1 |
| D3 | Physical stock purchased | Ric | M1, M4 |
| D4 | Payment gateway: IntaSend / Pesapal / Paystack / direct Daraja | Ric | M3 |
| D5 | Delivery partner and zone pricing | Ric | M2.5 |
| D6 | Volume tier percentages | Ric | M2.4 |

`[C]` D1 blocks the most and costs the least to decide now. WordPress-style URL
rewrites do not apply here, but templates, metadata and the deployed domain all carry
the name.
