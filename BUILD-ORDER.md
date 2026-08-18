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

**And the docket only spends the fill in a detail view.** `Docket` takes `detail`,
defaulting to **off**. The product page passes it; the homepage reveal does not, because a
reveal is not a detail view — it carries a *See the details* button pointing at the page
that is. Its Stock row reads `--fg-muted` mono via `.docket__value--closed`, the same as a
card.

The default is the load-bearing part, not the prop. It fails toward the muted state the way
`tokens.css` fails toward light and V7 fails toward requiring a background: a surface that
forgets to opt in renders quietly, never loudly. Forgetting costs nothing; spending the
colour by accident costs it everywhere.

The homepage keeps both reveals. Step 5 chose two deliberately — enough to establish the
rhythm without five identical placeholder screens — and changing a layout decision to
satisfy a colour rule is the wrong direction of fit.

**Counted from `dist/` after the change: homepage 0, category pages 0, product pages 1.**

Both halves are now gated. `verify.mjs` **V8** contains the class to `Docket.astro`, which
keeps it from spreading to a second component where the fix is cheap. **V8b** counts Seal
fills per built page and fails above one, which is the rule itself — one component rendered
three times spends the colour three times, and source containment cannot see that. It is
countable from `dist/` and nowhere else: `/apparel` renders one component nine times, so no
amount of reading `src/` gives you the totals. Negative-tested by passing `detail` from
`ProductReveal`, which reports `dist/index.html  2 Seal fills on one page`.

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

**Reviewed, and what the review found.** Devin raised two, both real, both mine: `Button`
derived its attributes from `href` while picking its tag from `href && !disabled`, so
`<Button href disabled>` rendered `<button href>` with no `type` — and a button with no
type defaults to submit; and `/shop` in the nav pointed at a page scheduled by no step.
Both fixed. `verify.mjs` **V10** now asserts that a component picking its tag conditionally
derives every tag-specific attribute from the same named condition, and **V10b** asserts
the rendered elements in `dist/` carry only their own attributes. A dist check alone would
have stayed green over the original bug, because no caller rendered the broken combination.

Four areas were checked by hand afterwards, by construction rather than by reading:

| Area | Finding |
|---|---|
| `Docket` field combinations | Holds across all seven, including only `Stock` surviving at zero, at one and at twelve, and everything null including stock, which renders nothing. A one-row docket reads as a small fact card, not as a mistake |
| Docket with full data | **Three of six rows render in the accent** — lead time, dispatch and stock are each permitted, so this is within the rule, but a half-green docket is the same dilution the Seal fill had. Invisible today at one or two rows. Look again when the first product carries real data |
| `CATEGORY_COPY` failure | Fails during `getStaticPaths`, exit code 1, **zero pages written** — no partial site can ship. The message names the offending category, both files and the fix. The stack trace points into bundled output, so the message carrying the source path is what makes it actionable |
| Disabled button | `<button type="button">`, `aria-disabled`, no native `disabled`, `tabIndex` 0, and it **took focus when asked** — reachable and announceable, which was the intent. Accessible name "Add to order" from contents, nothing overriding it |
| `aria-hidden` placeholders | Correct. Removed from the tree, **zero focusable descendants** — the trap this attribute usually creates is absent — and the product name is carried by the `h1` and the card `h3`, so nothing is lost |

**OPEN — the disabled button states no reason to a screen reader.** The line explaining why
it cannot be ordered is a sibling `<p>` with no association to the control. Tabbing between
controls gives "Add to order, unavailable" and no cause. `aria-describedby` pointing at
`.detail__closed` would carry the reason with the control.

**Tap targets, measured across every page.** `.detail__category a` was a 12px mono link
with no hit area and is now 44px, matching the nav links, the order count and the footer
links. Measuring every standalone link on the site found exactly two others under 44px:

| Link | Height | Standing |
|---|---|---|
| `.nav__wordmark` | **26px** | A real gap. The home link, standalone, in a 56px bar with room for it. One line, same fix. Not applied — reported, as instructed |
| `.skip-link` | 42px | Keyboard-only. It is reachable by focus and never by a thumb, so 44px buys nothing |

Everything else clears it: nav 44, order count 44×44, footer links 44 each, buttons 44,
category tiles 529, product cards 592. The one link inside prose — *delivery terms* at 18px
— is correctly excluded; a link in running text is not a tap target.

**No gate for this, deliberately.** Separating a standalone link from a prose link needs
judgement, not a selector: `.detail__category a` and the *delivery terms* link are both an
`<a>` inside a `<p>`, and only intent distinguishes them. A static check would have to
guess, and a gate that guesses gets muted. The browser measurement above is repeatable by
hand and that is the right tool for it.

**Known, none of them live. Recorded so they are not rediscovered as surprises:**

| Item | Why it is not live, and what would make it live |
|---|---|
| Root catch-all shadowing | `[category].astro` sits at the root but static output emits only the three declared paths, so nothing is shadowed. A future category slug colliding with a real page — `delivery`, `about`, `cart` — would collide for real |
| Implicit system on category pages | The page sets no `data-system`; its heading and line inherit `Base`'s default. The cards set their own, so a change to that default would move the page furniture and not the cards |
| V8 word-match holes | V8 matches `\bstamp\b` in stripped source. A component applying the class through a variable or a `class:list` array evades it. V8b still catches the render, which is why the pair exists |
| V9 scope coverage | Now asserts every declared scope yields at least one pairing. It still only looks for three known selectors, so a fourth scope added to `tokens.css` would not be seen at all |
| Button border dependency | The disabled outline is `--border`, which on paper is `--rule` at 1.23:1 — nearly invisible. WCAG exempts disabled controls from non-text contrast and the label carries the meaning, so this is a note, not a defect |
| `aria-disabled` at step 7 | `aria-disabled` does not prevent activation. The cart's click handler must check it before acting, or a disabled Add to order will add to the order |

**UNVERIFIED — narrow widths.** The two-column product page and both grids have never been
seen below 1242px. The rules were read out of built CSS, which has twice proved a weaker
signal than looking, and the browser extension cannot resize this window. This needs the
real phone on Safaricom data that this file already requires before deploy.

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
