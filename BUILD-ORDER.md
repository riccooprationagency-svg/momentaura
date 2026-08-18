# Build order

Each step is one prompt. Do not skip ahead — later steps assume the tokens and
components from earlier ones exist.

## 1 — Foundation
Scaffold Astro, static output, no integrations. Add `src/styles/tokens.css` verbatim.
Write `global.css`: font-face blocks, reset, base elements, layout primitives, the
`.docket` and `.photo-pending` classes. Fonts into `public/fonts/`.

**Check:** a blank page renders in Archivo at the right size. Nothing else.

## 2 — Layout shell
`Base.astro` — head, nav, footer, skip link. Nav transparent over the hero, Packing Dark
on scroll. Vertical edge label, desktop only.

**Check:** nav and footer on an empty page, both viewports.

## 3 — Product data
`src/data/products.json`. Every product carries `photo` (null until a real photograph
exists), `system` derived from it, contents, price, leadTimeDays, stock, and run fields
for limited items.

## 4 — Components, in this order
`Docket.astro` → `ProductCard.astro` → `DispatchRule.astro` → `Button.astro`

**`CapacityNotice.astro` is deliberately not built.** Every number it would
render — production capacity, cut-off date, run size, remaining — is currently
unknown, and CLAUDE.md is explicit that a component whose numbers cannot be
verified does not render. Build it when there is a real run with a real count.
This is a decision, not a gap.

Build and verify each in isolation before composing. The docket is the signature
element — get it right before anything depends on it.

## 5 — Homepage
Hero → dispatch rule → three category tiles → two product reveals → story block.

**Three tiles, not six.** Six was written for a catalogue that still included
watches and licensed panels. The legal deletion removed them. Three categories
exist: apparel, personalised, accessories.

**Two reveals, not one per product.** Every product is `photo: null`, so each
reveal is a light section with a kraft placeholder. Two establish the rhythm;
five identical placeholder screens establish nothing further.

**Not built, each because its data does not exist. Decisions, not gaps:**

| Omitted | Why |
|---|---|
| Hero video | No footage. Not a slot, not an empty element |
| Hero photograph | No real photography of stock we hold |
| Capacity notice | No production figure and no cut-off date. Every number it would carry is unknown |
| Dispatch ledger | Zero orders dispatched |
| Testimonials | No reviews, and none until roughly twenty orders are complete |
| Story block | No portrait and no copy. A bracketed stub is a visible absence where an omission is simply not a claim — the same rule the docket applies to its null fields |
| Reveal description | Same reason. Describing how a garment feels before anyone has handled one would be inventing facts |

Each arrives when its data does.

**Check:** transfer under 500KB. Measure, do not estimate.

## 6 — Category and product pages
Category: straight grid, no 100dvh rhythm. Product: two columns, image left at 3:4,
details right, aligned top.

**Routes.** `/apparel`, `/personalised`, `/accessories` from `src/pages/[category].astro`;
`/products/[slug]` for the five products. Which categories exist is derived from
`products.json`; their display names and the one line under each heading are declared once
in `src/lib/products.ts`. A category in the data with no entry there fails the build rather
than shipping a page headed by its own slug. `CategoryTile` pointed at `/shop/:slug`, a
path nothing builds — corrected to `/:slug`, and the homepage now maps the same derived
list instead of its own hardcoded copy.

**Three category pages, not six.** Same reason as the three tiles in section 5.

**No filter bar.** Five products across three categories cannot be filtered into a set that
reads more easily than the grid already does. The largest category holds three items. A
filter over a nine-item grid is furniture.

**Not built, each because its data or its photography does not exist. Decisions, not gaps:**

| Omitted | Why |
|---|---|
| Filters | Above. Revisit at roughly thirty products, not before |
| Product description | No copy. Optional on `Product`, absent from the data, omitted while null — the same rule the docket applies to its null fields |
| Size selector | `sizes[]` is empty on every product. A control that cannot be operated, on the page where the buyer is deciding whether this shop works, is worse than no control |
| Quantity | Named here originally, not in the step 6 ruling. It belongs with the cart in step 7, where a quantity has somewhere to go |
| Thumbnails | One crop per product at most, and no product has one |
| Spec table | `fabricWeight`, `fit` and `printMethod` are null on every product |
| Size chart | No measurements |
| Box-opening sequence | No frames. It is the one elaborate moment permitted site-wide and it arrives with real photography or not at all |

**The out-of-stock ruling, as built.** Every product is `stock: 0`, so every product page
renders it: the button present and disabled — `--fg-muted` text, `--border` outline, no
fill, `cursor: not-allowed`, `aria-disabled` — under a docket that stamps its Stock row,
above one line naming the product and saying it cannot be ordered. Never absent. A missing
button leaves the buyer unsure whether the page is broken or the product unbuyable, and
that ambiguity is the suspicion the whole system exists to reduce.

`Button.astro` needed fixing to render that state. Its `disabled` prop had produced a
half-transparent filled pill: `opacity: 0.5` halved the label's contrast against the
ground, so the one state that most needs to be legible was the least legible on the page.
`pointer-events: none` also suppressed the not-allowed cursor while leaving the keyboard
path to a disabled `<a href>` open. A disabled control is now never an anchor.

**The stamp cap — RESOLVED. The stamp belongs to the docket, one per page, always.**
As first built, three instructions each required a stamp and `/apparel` rendered three
while `/products/crew-tee` rendered four, two of them 80px apart. The ruling:

| Surface | Sold-out status |
|---|---|
| `Docket` Stock row | Keeps the Seal fill. Where a buyer looks for facts, and stating checkable status is the component's whole job |
| Product page action | No stamp. The disabled button under a stamped docket already says it twice; a third instance is the redundancy that drains the colour. The one line naming the product stays, as plain `--fg-muted` text |
| `ProductCard` | "Sold out" in `--fg-muted` mono, no fill. On a grid of three or nine, Seal fills stop reading as exceptional and start reading as the page's colour scheme |

Counted after the change: category pages 0, product pages 1, homepage 2. CLAUDE.md's
Closed stamp spec now states this, and `verify.mjs` V8 contains the class to
`Docket.astro` — the rule erodes exactly the way the accent rule does, silently and with
every gate still green.

**STILL OPEN — the homepage renders two.** `index.astro` composes two `ProductReveal`
sections, each with its own docket, each product `stock: 0`. That is two Seal fills on one
page, so "one per page, always" does not yet hold there. It is a step 5 surface and the fix
is a design decision, so it is flagged rather than taken:

- the ruling reserves the fill for "the detail view, where a single product is under examination", and a homepage reveal is not that — it carries a *See the details* button pointing at the page that is. By that reasoning the reveal's docket should read muted mono, which means `Docket` gains a `detail` prop defaulting to **off**, so it fails toward the muted state the way `tokens.css` fails toward light
- or the homepage drops to one reveal, which changes the rhythm section 5 chose deliberately

The stronger gate — one stamp per *rendered* page, not just one component using the class —
goes in once this is settled. Shipping it now would ship a failing gate.

**Two contrast failures found and corrected.** `--muted` was 3.32:1 and `--dispatch`
3.44:1 on `--kraft`. Both are live on every docket on the site: in the light system
`--surface` resolves to kraft, `--fg-muted` sets every field label and `--accent` every
checkable fact. Neither pairing was in the `contrast.mjs` table, so nothing caught it —
the same shape of miss as `--sisal` on Kraft Board. Now `#535659` at 4.78:1 and `#0c6248`
at 4.76:1, with both pairings asserted.

Four tokens have now failed on a surface nobody thought to check, which is one gap in the
table rather than four oversights. `verify.mjs` **V9** closes it: it derives the reachable
set from the scope blocks in `tokens.css` — every token resolving as `--fg`, `--fg-muted`
or `--accent` against every token resolving as `--bg` or `--surface` in the same scope —
and fails on any pairing with no row. 12 reachable, 14 listed, 0 unchecked. The two extra
rows are direct token uses rather than scoped roles: Cream on a Seal fill, and the
`.photo-pending` label on kraft.

Negative-tested three ways: deleting the two rows above reproduces the exact failure this
branch shipped with; remapping the dark system's `--fg-muted` to `--twine` reports both
grounds it becomes reachable against; and breaking the table parser fails loudly rather
than passing with nothing found.

**Known, blocked on data.** The docket renders lead time as a duration and CLAUDE.md
requires a date on a product page. `leadTimeDays` is null on every product, so nothing
renders and there is nothing to convert. A date cannot be computed from a null; it lands
with the first true lead time.

`/delivery` does not exist until step 10, so the product page's terms link is dead for now
— the same as the nav and footer links that have pointed at it since step 2.

`src/pages/components.astro` deleted. Its own header said step 6 replaced it.

**Check:** measured, not estimated. Category page 3,662 bytes gzipped, product page 4,514,
plus 75,332 bytes of fonts shared across the site. Zero JS, zero images. Both page types
land near 80KB on a cold first view against a 1MB budget.

## 7 — Cart
localStorage only. `client:idle`.

No quote path in v1. This is an apparel store with a cart. The 10-unit quote route
and the Order Bar's "Request a quote" behaviour in `docs/STYLE-dark-editorial.md`
are both gifting-era and do not apply.

## 8 — Checkout
Cloudflare Function. Re-price server-side. Redirect to the hosted gateway page.
**No card field on our domain.**

## 9 — M-Pesa (only once the business shortcode exists)
Cloudflare KV for pending orders. STK Push → callback → status-query fallback.
Idempotent by `CheckoutRequestID`.

## 10 — Trust pages
Delivery, About, Contact, Privacy, `/track`. `/track` takes order reference plus phone —
no accounts, no passwords.

## 11 — Ship
Sitemap, Open Graph images, Search Console. Test on a real phone on Safaricom data.
