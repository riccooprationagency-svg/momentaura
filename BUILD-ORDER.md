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
renders it: the button present and disabled — `--fg-muted` text, `--fg-muted` outline set
as the full `border` shorthand, no fill, `cursor: not-allowed`, `aria-disabled` — under a
docket that stamps its Stock row,
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

| Link | Was | Now |
|---|---|---|
| `.nav__wordmark` | 26px | **44px.** The home link, standalone, and there was room in a 56px bar. Same treatment as the nav links beside it, and the bar's height is unchanged |
| `.skip-link` | 42px | **42px, deliberately. Do not "fix" this.** See below |

Everything else clears it: nav 44, order count 44×44, footer links 44 each, buttons 44,
category tiles 529, product cards 592. The one link inside prose — *delivery terms* at 18px
— is correctly excluded; a link in running text is not a tap target.

**The skip link is a deliberate exemption at 42px.** It is reachable by focus and by
nothing else: it sits translated off the top of the page until `:focus-visible` brings it
down, so no thumb ever lands on it and no pointer ever finds it. The 44px minimum exists
for touch, and this control cannot be touched. Padding it to 44 would move a keyboard-only
affordance to satisfy a rule about fingers. It is listed here because it will keep showing
up in any audit that measures heights without asking how the control is reached.

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
| `aria-disabled` at step 7 | `aria-disabled` does not prevent activation. The cart's click handler must check it before acting, or a disabled Add to order will add to the order |
| `//` blanking in `stripAllComments` | It strips `//` to end of line, guarded only by a `://` test. A source line carrying `//` inside a string that is not a URL would be blanked, and every check downstream would read a line that is not there. No such line exists in `src/` today |

**Product page banding — reproduce it deliberately.** The page runs paper detail section,
then a dark band for the related grid, then light cards sitting on that dark. It is not a
violation: the detail section is light because the product has no photograph, `.related`
carries no `data-system` so it inherits the dark chrome, and each card sets light for
itself. It reads as intended and it is the same rhythm as the homepage. But the effect
comes from three separate decisions rather than one, and the next grid added to a light
page will only look right if whoever adds it reproduces that stack on purpose. It is worth
knowing before it is copied.

**UNVERIFIED — for the real device, not for more reasoning.** Two things go on the phone
together, and neither is settled by reading anything:

- **Narrow widths.** The two-column product page and both grids have never been seen below
  1242px. The rules were read out of built CSS, which has twice proved a weaker signal than
  looking, and the browser extension cannot resize this window
- **`--measure` at `--t-body-sm`.** 34ch caps the 17px copy at roughly 289px. That is the
  right character count and possibly the wrong column on a phone, where the gutter is
  already 20px. Look at the closed-stock line and the category description on a real screen
  before deciding whether UI copy needs its own measure

Both need the real phone on Safaricom data that this file already requires before deploy.

**Check:** measured, not estimated. Category page 3,662 bytes gzipped, product page 4,514,
plus 75,332 bytes of fonts shared across the site. Zero JS, zero images. Both page types
land near 80KB on a cold first view against a 1MB budget.

## 7 — Cart
localStorage only. `client:idle`.

No quote path in v1. This is an apparel store with a cart. The 10-unit quote route
and the Order Bar's "Request a quote" behaviour in `docs/STYLE-dark-editorial.md`
are both gifting-era and do not apply.

**Found here, deferred to section 8 on purpose: nothing stopped a quantity above
stock.** The cart caps at 99 and never consults stock, so the steppers would take
a six-stock item to twenty and the order page would total it up and offer a
checkout button.

It was deferred rather than fixed here because the fix that matters is not a cart
change. A quantity is a client value, and a client value is never trusted for a
decision that costs money — the same rule as never trusting a client price. The
enforcement therefore belongs in `functions/api/checkout.js`, which re-reads stock
from the catalogue and rejects the line by name with the real figure, and that
file does not exist until section 8. Building the clamp here first would have put
the whole guard on the buyer's own machine and left the endpoint trusting it,
which is the wrong shape however well the clamp is written.

Both halves land together in section 8: the server check that actually stops the
order, and a courtesy clamp on the stepper and the add handler at
`min(99, stock)` so an honest buyer is not walked into a refusal at the worst
moment in the flow. The clamp refuses an increase and never lowers a quantity
already in the order — a line that sold out while it sat there stays visible and
blocked rather than being quietly trimmed, because silently dropping part of an
order is the failure this shop exists to not commit.

## 8 — Checkout
Cloudflare Function. Re-price server-side. Redirect to the hosted gateway page.
**No card field on our domain.**

IntaSend is the interim gateway and everything gateway-shaped is confined to
`functions/api/_gateway.js`. Step 9 rewrites that one file's body for Daraja: the import
in `checkout.js`, the client, both pages and every error state stay as they are.

**Check:** `node scripts/checkout-test.mjs` — 43 cases over the shipped handler. A client
price is ignored, an unknown slug is rejected rather than skipped, a sold-out product is
named, a quantity above stock is refused with the real figure, a repeated slug cannot step
around either cap, and no gateway detail or internal code reaches the browser on any of
the seven failure paths. Misconfiguration reads as "unavailable" and never as "declined",
because telling a buyer their payment was refused when our own key was missing is a false
statement about them.

**Untested, and stated rather than implied: the live gateway.** There are no IntaSend
sandbox credentials in this repo, so no request has ever left the machine. The request
body's shape against IntaSend's actual API, and Cloudflare's bundler accepting the JSON
import, are both unproven until someone runs it with real keys.

## 9 — M-Pesa (only once the business shortcode exists)
Cloudflare KV for pending orders. STK Push → callback → status-query fallback.
Idempotent by `CheckoutRequestID`.

### Status: built, sandbox-shaped, and NOT verified against Safaricom

**No Daraja credentials exist in this repo and no request has left the machine.**
Registration at developer.safaricom.co.ke needs a person with an account; it cannot be
done from here. So the code is written and tested against a stub of Daraja's HTTP API,
and that is a different claim from "it works". Nothing here ships until a real shortcode
exists and the paths below are re-run against the real sandbox.

**Sandbox and production credentials are entirely separate and nothing carries over.**
Consumer key, consumer secret, shortcode and passkey are all different values on the two.
The sandbox shortcode is a shared test paybill that is not ours. Going live is a full
re-issue, not a host swap — the only thing `MPESA_ENV` changes is which host is called.

**The go-live application needs live HTTPS callback URLs**, which means the site must be
deployed before production Daraja can even be applied for. **Section 11 blocks this
section**, not the other way round.

### The architecture change

This is where the site stops being purely static. STK Push is asynchronous: the request
goes out, the phone prompts, and the answer arrives later in a different request. KV holds
the order across that gap, keyed on `CheckoutRequestID`, carrying slugs, quantities, the
amount **we** computed, and a status.

### Env vars

`MPESA_ENV`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`,
`MPESA_PASSKEY`, `MPESA_TRANSACTION_TYPE`, `MPESA_CALLBACK_ORIGIN`,
`MPESA_CALLBACK_TOKEN`, `MPESA_CALLBACK_IPS`, plus the KV binding `ORDERS`. Nothing is
hardcoded: a paybill change must not need a code release.

### Known gaps, stated rather than papered over

- **The "write to KV before the push" rule cannot be fully obeyed.** The key a callback
  arrives on is the `CheckoutRequestID`, and Daraja only issues it in its response — so
  that key cannot exist beforehand. The order is written first under its own reference and
  indexed afterwards, so a death between the two is a reconciliation rather than an
  untraceable payment. Closing it needs a client-chosen idempotency key, which the STK API
  does not offer
- **KV has no compare-and-swap**, so `settle()` is read-then-write and two simultaneous
  callbacks can both observe `pending`. Bounded here — both write the same terminal state
  from the same stored amount — but it is not mutual exclusion. A Durable Object is the
  right primitive if this ever drives stock decrement or a payout
- **The IP allowlist default must be confirmed against current Daraja documentation before
  production.** It is Safaricom's list to change. It fails closed, so a stale list rejects
  real callbacks — which the status query then recovers
- **The buyer-facing flow is not wired.** `/checkout` still posts to the IntaSend endpoint.
  STK Push has no page to redirect to: it needs a "check your phone" screen that polls
  `/api/mpesa/status`. That is a client change against a 6.5KB script budget with roughly
  600 bytes spare, and it is not worth spending before a real shortcode proves the flow

### Step 8's "one file swap" assumption was wrong, and is withdrawn

Section 8 recorded that step 9 would replace the body of `_gateway.js` and touch nothing
else. That held for a hosted-page gateway, which hands back a URL to redirect to. Daraja
hands back nothing to redirect to and settles asynchronously against a callback — a
different flow, not a different implementation of the same one. So the M-Pesa endpoints
live beside `checkout.js` rather than inside it, and `checkout.js` is unchanged apart from
the shared validation move below.

`_order.js` now holds the request validation, the stock rules and the re-pricing, shared by
`/api/checkout` and `/api/mpesa/stk`. Two copies of "never trust a client price" is how one
of them gets a stock rule fixed and the other does not.

### Which failure paths were actually exercised

`scripts/mpesa-test.mjs` — 43 checks, in the pre-commit hook. The endpoints, `_pending.js`,
`_order.js` and `_daraja.js` are all the shipped code; `fetch`, the catalogue and the KV
binding are the only substitutions.

Exercised: token cached across pushes; token failure reads as unavailable; EAT timestamp
and base64 password; push stores `pending` and never `paid`; client price ignored; sold-out
and over-stock refused by name with no push; Daraja refusing inside a 200 body; Daraja HTTP
error; Daraja unreachable; missing shortcode; a 200 with no `CheckoutRequestID`; KV failing
before the push, so nothing is pushed; wrong path token; wrong source IP; empty allowlist
failing closed; successful callback; **duplicate callback**; **forged amount, high and low**;
customer cancelled (1032); wrong PIN (2001); insufficient balance (1); no response from the
phone (1037); callback for an unknown id; unreadable body; KV failure during settle
returning 500 so Safaricom retries; status query requiring reference as well as id; the
90-second grace; **callback never arrives, recovered by the query**; query returning a
failure; query returning "still processing"; **query unreachable not turning a live payment
into a failure**; a settled order answered from KV without a query; a callback arriving
after the query already settled it; and the status response carrying no amount, phone
number or receipt.

**Reasoned about only, and untestable from here:** that Safaricom accepts these request
bodies at all; that a real phone prompts; that real callbacks arrive from the allowlisted
IPs; that Daraja's real timeout behaviour matches the stub; that `expires_in` is what the
docs say; and every production-credential behaviour, since none have been issued.

## 10 — Trust pages
Delivery, About, Contact, Privacy, `/track`. `/track` takes order reference plus phone —
no accounts, no passwords.

### The content rule, and what each page omits

**A fact that does not exist is not rendered.** No brackets, no "coming soon", no
paragraph explaining that a table would go here. A delivery page missing a zone table is
honest; one carrying `[areas]` is a stub that shipped, and a stub tells a buyer the shop
was assembled from a template and abandoned — which is the suspicion this whole site
exists to reduce.

The facts live in `src/data/site.json`, every value `null`, typed in `src/lib/site.ts`.
`GAPS` is derived from which are still null, so it cannot claim something is missing after
it has been supplied. `Gap.astro` renders one **in development only**, naming the key and
what it blocks; a production build never emits it.

**Each page is thinner than it will be, and here is what thickens it:**

| Page | Renders today | Absent, and what it needs |
|---|---|---|
| `/track` | Everything. Form, four outcomes, not-found, line items, dispatch date | Nothing — this page is complete |
| `/delivery` | Paying (in full), Dispatch | Areas and cost table → `delivery.zones`. Returns → `delivery.returnsWindowDays` **and** `returnsCondition`, both or neither |
| `/about` | Kraft placeholder, what the shop sells, how it behaves | The named human → `owner.name`, `owner.photo`, `owner.area` |
| `/contact` | Routes to `/track` and `/delivery` | **Every way of reaching a person** → `contact.phone`, `contact.whatsapp`, `contact.hours` |
| `/privacy` | Everything | Nothing — it describes code, not facts |

**`/contact` is the thinnest and the most expensive.** It currently offers no way to reach
a human at all, because there is no real number and one that does not ring is worse than
none. Three error states already route here — the blocked message on `/order`, the failure
messages in `/api/checkout`, and the M-Pesa messages in `/api/mpesa/stk` — and each is a
route to a page that cannot finish the sentence.

**When a real number lands it is ONE commit:** `site.json`, then those three error states
wired through together. One edit, not four rediscoveries.

### `/track`, built first

It needs no fact Ric holds, and it closes the gap that opens the moment someone pays.
Reference plus the phone the order was placed with. No account: an account is a password
to forget and a credential store to protect, in exchange for nothing this needs.

- The reference must match the shape `_order.js` mints — `MA-XXXX-XXXX` — before it is
  used as a KV key. Lower case and surrounding whitespace are tolerated
- **It reads and never writes.** The fifth endpoint touching order data, and the only one
  that cannot change any of it
- **A wrong phone and a reference that does not exist return the identical response**,
  byte for byte. Distinguishing them would make the phone check an oracle for which
  references exist
- Not found reads as a correction with a route to `/contact`, never as an error — a
  mistyped character is far likelier than a missing order. It is one more outcome in the
  same `[data-status]` set the page already carries, so it holds a real link rather than
  being a string written into `textContent`
- A settled order gets **a date, not a duration**, computed server-side from the longest
  lead time in the order counted forward in working days. One line with a null lead time
  and the field is absent entirely — the longest of the known ones would be a guess
  wearing a date's clothes on the screen a buyer opens to find out where their money went.
  `leadTimeDays` is null on every product, so nothing renders today
- The response carries the reference, status, amount, items and the date. Never the name,
  the email, the phone number or the `CheckoutRequestID`

### `/order-received` was brought into line

It had been rendering a sentence saying the delivery date would come later. That is a
stated absence, which this step's rule forbids, so the sentence is gone and the dated line
is simply absent when there is no date.

### The script budget moved a second time, 6.5KB to 7KB

Roughly 930 bytes were shrunk first — one `q()` for thirty-one `querySelector` calls, one
constant for nine `"aria-disabled"` literals, one `send()`, one `clearErrors()`, one
`say()`, one `toOrder()` — and the tracking form still missed by 62. Folding the two form
handlers into one generic function would have closed it and would have buried the payment
path in an eight-parameter abstraction. The number moved instead. Argued in `verify.mjs`
beside the constant.

### No link on this site goes nowhere

`verify.mjs` **V12** walks every internal `href` in `dist/` and asserts it resolves to
something that was built. **202 links across 17 pages, none dead.** The five pages this
step added had been linked from the nav and footer since section 2 and had 404'd for eight
steps, and nothing in the build was unhappy about it.

### Four defects found in review after section 10 merged

Three of them were invisible to every gate in the repo, which is the property they had in
common — each was a fact the tests asserted about a shape rather than about the path a
buyer actually walks.

- **A settled order stayed `pending` on the tracking page.** The record lives under two
  KV keys — the CheckoutRequestID the callback arrives on, and `ref:<reference>`, which is
  all `/api/track` has — and `settle()` wrote only the first. Every completed payment read
  as unconfirmed on the one screen a buyer opens to check, for the whole seven-day TTL.
  Settling now writes both, **reference copy first**: if that write fails it throws before
  the id copy leaves `pending`, so the next callback retry settles both. The other order
  would have made a failed reference write permanent, because the retry would find a
  terminal status and correctly change nothing
- **The dispatch date was counted in UTC and printed in Nairobi.** A payment settling
  between midnight and 03:00 Nairobi is the previous day in UTC, so the count started a
  day early — and a Monday 01:30 settlement counted from a Sunday, producing a promise
  three days short landing on a Saturday. Counted in Nairobi now, which is a fixed UTC+3
  because Kenya keeps no daylight saving
- **A retry left the previous answer on screen.** Submitting the tracking form hid
  `[data-track-result]`, but the not-found block sits outside it — deliberately, because
  it is not a result. A connection failure on the second attempt showed the buyer "that
  order cannot be found" about a request that never reached the server. Every
  `[data-status]` block is hidden on submit now, not just the result
- **Order lookup had no guessing budget**, which the section below had recorded as open

### The guessing budget, in `_throttle.js`

Twenty misses per address per ten minutes, in KV, then a 429 carrying `Retry-After` and a
route to `/contact`.

- **Only misses are counted.** A buyer refreshing their own order all morning is the use
  the page exists for and must never be what locks them out, and the successful path is
  still one KV read
- **It fails open** — a KV wobble or a missing `CF-Connecting-IP` must not take order
  lookup down. The cost of failing closed is a buyer who paid being told they cannot look;
  the cost of failing open is that a guesser gets their free attempts back while it lasts.
  The reference is still the secret either way, and this is the one place in the repo that
  fails open on purpose
- Fixed window, read-then-write, no compare-and-swap. It undercounts slightly under
  concurrency, which is the same KV trade recorded for `settle()` in section 9

### The three endpoint gates could not run on a clean clone

`checkout-test.mjs`, `mpesa-test.mjs` and `track-test.mjs` copy `functions/api/` into a
temp directory and import it. Nothing above a temp directory declares ESM, so every `.js`
handler loaded as CommonJS and threw on its first `import` — the pre-commit hook died on
the money gate before it ran a single case. Each scratch copy now gets a
`{"type":"module"}` package.json beside it.

### Still open

- **Working days, not holidays.** Both the server's dispatch date and the confirmation
  screen's skip weekends and do not model Kenyan public holidays. Modelling them needs a
  real calendar; a date quietly wrong twice a year is worse than one honest about counting
  working days only
- The same working-day rule is implemented twice, once server-side in `track.js` and once
  client-side in `cart.ts`, because they sit on opposite sides of the wire and cannot share
  code. Both are commented as such

## 11 — Ship
Sitemap, Open Graph images, Search Console. Test on a real phone on Safaricom data.

### The mirror ordering became a gate before anything shipped

Section 10's review fixed settling so it writes both keys, and `persist()` writes
`ref:<reference>` first on purpose: if that write fails it throws before the
CheckoutRequestID copy leaves `pending`, so the retry settles again and both copies
converge. Written the other way round the failure is permanent — the retry finds a
terminal status, returns `already`, and never comes back for the buyer's copy.

That is why the `already` path repairs nothing: it cannot be reached with a stale copy,
so code to repair one there would be dead weight implying a state that cannot happen. A
self-healing mirror was drafted before this ordering existed and was dropped rather than
merged, for that reason.

It was a comment, and it decides whether someone who has paid is told nothing happened
for seven days. Five checks in `mpesa-test.mjs` now drive both settling roads with the
reference write failing and the rest of KV healthy — the quiet failure, not KV falling
over, which was already covered and is loud. The callback path stays pending and answers
500 so Safaricom retries; the retry converges both. The status query, which nothing
covered for the mirror before, reports `pending` rather than `paid` and converges on the
next poll. Reversing the two writes fails four of them; swallowing the mirror failure
fails all five.

`refKey` in `_pending.js` replaced the prefix written literally in four places across
three files. Two sides of one key that can drift is the shape of the bug the ordering
exists to prevent.

### The domain is a fact in site.json, not a constant in the config

`site.url` joins the file where every fact about the shop itself lives under the rule
that file already keeps: null until a real one exists. It is the one value there that
cannot fail toward an omission on the page alone. Canonical URLs, Open Graph and sitemap
entries are absolute by specification, so a guessed hostname would not read as a
placeholder — it would read as a claim about where this site lives, and a wrong canonical
points every page at somebody else's while an off-host sitemap is rejected whole.

So the four things that need it omit themselves instead: no canonical, no Open Graph
block, an empty `<urlset>`, and no `Sitemap:` line. Setting one line brings all four up
together.

The sitemap is `src/pages/sitemap.xml.ts`, reading the same route data the pages are
generated from. Not `@astrojs/sitemap`: that is a dependency and, more to the point, a
second thing to trust — it would walk its own idea of the route table and nothing here
would have anything to say about what it found.

`/checkout`, `/order` and `/order-received` are absent from the sitemap and disallowed in
`robots.txt`, and carry `noindex`. `/order-received` is the one that matters rather than
the tidy one: it is reached holding an order reference, and the reference is the secret
that opens an order on `/track`.

### V13, because three of these four are hand-maintained lists

This repo has already shipped a hand-maintained list wrong for eight steps with every
gate green — that is what V12 exists for. A sitemap fails the same way and more quietly.
A page missing from it is invisible in the one way nobody thinks to check, because the
site looks perfect to anyone already on it; a URL in it that was never built is a 404
handed to a crawler on purpose. Neither shows up in a browser.

V13 asserts the four against each other and against `dist/`: every built page is in the
sitemap unless `robots.txt` closes it, every sitemap URL was built, every canonical
points at the page it is written on, and a disallowed page carries `noindex` while no
other page does. `robots.txt` is read rather than restated, so the check cannot drift
from it the way a second copy of the list would. With the domain null it asserts the
empty state instead — nothing may have invented a hostname.

Dropping `/track` from the list, inventing `/shop`, removing one `noindex`, and making
`origin()` return a host while `site.json` is null each fail it.

### The domain is momentaura.store, and it is deliberately not connected

`site.url` is `https://momentaura.store` — registered, owned, and the domain the original
Shopify store ran on. `momentaura.co.ke` appeared in eight places across the three test
fixtures and was registered nowhere; it was invented for tests. It is gone. `mpesa-test.mjs`
now holds one `ORIGIN` constant used by both the env fixture and the CallBackURL
assertion, which previously matched a literal nothing else in the file used.

**The site ships to the Cloudflare Pages `.pages.dev` URL only.** momentaura.store stays
unconnected and uncrawled until there is real stock and photography. Google forming a
first impression of a shop with five out-of-stock products and kraft placeholders is a
cost paid once and hard to undo, and a first impression is the entire subject of this
build.

So `public/_headers` carries `X-Robots-Tag: noindex, nofollow` on `/*`. Not `Disallow` in
robots.txt: a disallowed page is not read, so its noindex is not read either, and a URL
discovered from a link elsewhere can still be listed. noindex is read and obeyed.

The canonical links and the sitemap name momentaura.store while the site is served from
.pages.dev, and that is correct rather than contradictory — they describe where the site
lives, the header describes whether to index what is being served. The noindex is what
makes the mismatch harmless in the meantime, and it means the canonicals are already
right on the day the domain connects rather than being a second change to remember.

**Search Console waits.** Submitting a sitemap that names a host which is not serving
achieves nothing and starts a record of failed fetches. DNS TXT verification is preferred
over the meta tag when it does happen, so no markup is owed to it.

### What changes at go-live, in order

1. Connect momentaura.store to the Pages project
2. **Delete the `X-Robots-Tag` block from `public/_headers`.** Leaving it makes the real
   shop unfindable, silently, with every gate green. `verify.mjs` V13b prints a note on
   every build for as long as the block exists, because no gate can detect a DNS change
   that happens outside this repo — the header is correct today and wrong the moment the
   domain is connected
3. Set `MPESA_CALLBACK_ORIGIN` to `https://momentaura.store` and re-register the callback
   URL with Daraja
4. Then Search Console

### `MPESA_CALLBACK_ORIGIN` changes twice, and neither is in this repo

It is a Cloudflare environment variable, read only inside `functions/`, and it holds a
different value at each of three points:

| When | Value |
|---|---|
| Tests | `https://momentaura.store` — a fixture, asserting shape, not deployment |
| Daraja go-live | the `.pages.dev` URL, because go-live needs a live HTTPS callback and momentaura.store will not be serving |
| Custom domain connected | `https://momentaura.store` |

The handler builds the callback URL from the env var and asserts nothing about the host,
so nothing in the code needs to change at either step. What does need to change is the
URL registered with Safaricom, which is done in their portal and not here. A callback
URL pointing at a host that stopped serving is an order that settles only by status
query — recoverable, and only because section 9 built that fallback.

### Still open at step 11

- **The `X-Robots-Tag` block in `public/_headers`**, which has to be deleted at go-live
  and which nothing can detect the right moment for. It is first on the list above
- **`og:image`, now a declared gap in `site.json` rather than a thing nobody wrote down.**
  There is none, deliberately. Every product still renders light with no photograph, and
  CLAUDE.md permits no stock, no supplier photo, no AI and no blank mockup presented as a
  product. A preview card is worth having and a dishonest one is not, so the card is
  title and description — thin, and true. `twitter:card` follows the image: `summary`
  while there is none, because the large card reserves space for one and renders the gap.
  `site.ogImage` lands with the photography and the tag appears with it, the same way
  `site.url` brought up four artefacts at once.

  The 45 files in `assets-source/images` are not candidates. Thirty are marketplace
  listing shots and five are supplier catalogue sheets carrying a SKU overlay and a
  third-party trademark on the tag — banned by the imagery rule and, for those five, by
  the Legal section as well. The ten `2026-08-14` phone photographs are the only set that
  could qualify, and their provenance is Ric's to confirm
- **Every product is `photo: null`, `stock: 0` and `leadTimeDays: null`.** (`photo`
  became `photos: []` at step 12; the rest is unchanged.) The catalogue
  ships entirely light and entirely sold out. Nothing is broken by that and no gate
  objects, but it is what a buyer would arrive to
- **The real-phone test on Safaricom data.** Not runnable here, and it is the last thing
  section 9 is still waiting on. Nothing in this repo has ever made a request to Daraja

---

## 12 — Images

The pipeline, not the photographs. Every product is still `photos: []`, so nothing on the
site looks different today. What changed is that a photograph now has one way in, and
three failures that were previously invisible now fail the build.

### `photo` became `photos`

`products.json` carried one nullable path per product. It now carries an array of
`{ src, alt, width, height }`, empty on all five, and `systemFor()` reads
`photos.length > 0`.

The old `systemFor()` had to be defensive at the point of use — `typeof photo === "string"
&& photo.trim() !== ""` — because an empty string or a whitespace path passed a null check
and rendered a product dark over a placeholder, the one combination CLAUDE.md forbids
outright. A count cannot be defensive that way, so the check moved to where it belongs: a
loop in `src/lib/products.ts` reads the array once at module load and throws on any entry
that is not a real photograph. Validating once, in a place that can say what is wrong,
beats validating at every call site that can only fail quietly toward light.

It throws rather than filtering. A silently dropped photograph is a product rendering a
kraft block while `products.json` says it has photography, and nobody finds out until a
buyer does.

### `scripts/images.mjs`, and the dependency it cost

    node scripts/images.mjs <slug> <source> <alt> [<source> <alt> ...]

Sources stay outside version control. `.gitignore` has said so since step 1 and the reason
has not changed: several images that have passed through `assets-source/` are other
companies' product photography, banned by the imagery rule and, for the five carrying a
third-party trademark, by the Legal section as well. What enters the repo is a finished
rendition, at our crop, of a photograph we took.

The script emits AVIF and WebP at 400/800/1200 from one centred 3:4 crop, reads the real
dimensions back off the encoded 800px file, prunes renditions the product no longer uses,
and writes the array into `products.json`. It refuses three things: to upscale, because a
1200px rendition of an 800px frame claims detail it does not have; to invent alt text,
because the only line it could generate is the product name the heading already carries;
and to write a file over 200KB.

**Centre crop, never sharp's `attention` heuristic.** A smart crop picks a different window
per photograph, and "one crop across every product" is a rule a heuristic cannot keep.

**Filenames carry a hash of the source bytes plus the encoding recipe.** That is what makes
the one-year `immutable` header honest: change a photograph, a width or a quality setting
and every URL changes, so a returning buyer gets the new file because it is a different
file rather than because a cache expired.

### V1 stopped being an absence, and what that bought

It asserted "astro, and no devDependencies at all". An absence needs no judgement to check.
It now holds a named list containing `sharp` at an exact version, which is a budget — the
same move V4 made at step 7 when the cart arrived, and it carries the same obligation. The
script budget was made to say what each raise bought, what was shrunk first, and what was
rejected to avoid raising it further. This gets the same treatment.

**Three options were on the table. Ric chose the second.**

| | What it does | What it costs |
|---|---|---|
| 1. Borrow Astro's | `import "sharp"` with no change to `package.json` | V1 keeps printing "astro and nothing else" while the build depends on a package nothing here declares |
| 2. **Declare it, pinned** | one name in `devDependencies`, V1 becomes a one-name allow-list | V1 stops being an absence and becomes a list someone has to keep honest |
| 3. No sharp at all | process images by hand outside the repo | "one crop, one light, one angle, across every product" stops being enforced and becomes something someone recalls |

**Why option 1 was rejected, and it is the important half.** sharp was genuinely already
reachable — Astro carries it in its own `optionalDependencies` — so the import would have
worked today and cost nothing visible. What it would actually have produced is a gate
reporting a state it cannot see: V1 printing "astro and nothing else" while the image
pipeline ran on a package Astro chose the version of, could drop in a minor release, and
marks *optional*, meaning a tree where the install skipped it is a valid tree. Nothing
would have said so until an encode silently produced different bytes.

That is the one failure this repo keeps finding. **V3** counted accent references until it
was pointed out that a count of two accepts any two. **V9** stopped maintaining `PAIRINGS`
from memory after four tokens shipped unmeasured behind a comment claiming they had been
corrected. **V11** exists because CLAUDE.md printed two hex values the source contradicted.
Three corrections, one shape: a report confident about something it had no way to check. A
borrowed sharp would have been the fourth, and introducing it deliberately after fixing it
three times is not a trade worth the name it saves.

**Why pinned rather than ranged.** `^0.35.4` lets a future install change the encoder, and
the same source frame through a different libvips is different bytes at a different size —
a silent change to the thing this repo is most careful about. V1 asserts the exact pin, so
"pinned" is a fact rather than a sentence in a comment. Moving it is a commit that says so.

**What it bought.** AVIF and WebP at three widths from one centred 3:4 crop, produced by a
script that refuses to upscale, refuses to invent alt text and refuses to write a file over
200KB — rather than by a person remembering six files per photograph. That is option 3's
cost avoided.

**What it cost.** "Astro and nothing else" stopped being true as written. It is now two
rules — astro at runtime, one named tool at build time — and every future reader holds both.

**What it did not cost, and this is why the price is as low as it is: nothing that ships.**
`npm run build` never imports sharp, the renditions are committed to `public/img/`, and a
deploy from a tree installed with `--omit=dev` produces byte-identical output. If sharp
breaks, it breaks at a keyboard with someone reading the error.

**The runtime half did not move and is not negotiable: Astro, and nothing else.** It is the
half that matters — it is what keeps the shipped output at zero JavaScript beyond the cart.
V4 holds that one script to a byte budget, but V4 only ever gets to count one file because
this list has one name on it.

**Adding a second name.** It argues its case in V1's comment, with what it buys and what it
costs, in the commit that adds it. The check is a list and not `dev.length <= 1` for exactly
that reason: a count accepts any one package and would let a swap happen silently, where a
name has to be typed on purpose. An allow-list of one is still a gate. One that grows
without an argument each time is a comment.

### `Gallery.astro`, and one placeholder

Three files carried the same photo-or-placeholder ternary — a card, a reveal and the
product page. They now compose one component, which is what makes "exactly one
`.photo-pending`" a property of the code rather than of three people remembering.

`detail` defaults to **off**, on the same reasoning as Docket's: on it renders every
photograph with the first eager at `fetchpriority="high"`, off it renders the first only,
lazily. The product page is the one surface that opts in — the same surface that is the
only one passing `detail` to `Docket`. A card in a grid of nine that forgot to opt out
would pull nine eager full-width images over a metered connection with nothing on the page
looking wrong while it happened.

`sizes` is what makes `srcset` do anything at all. Without it a browser has no width to
work from before layout exists, assumes 100vw, and fetches the 1200px file onto every
phone — the opposite of what three widths are for. It is a media-condition list, so
`var()` does not resolve in it, so **V2b's media-prelude exemption was generalised from
the prelude to the condition**: a quoted string containing a min-width or max-width
condition is exempt wherever it is written, and everything else on the line is still
matched.

### Cache headers

`public/_headers` carried only the `X-Robots-Tag` block. It now also decides caching, on
one distinction: whether the filename changes when the bytes do.

| Path | Header | Why |
|---|---|---|
| `/img/*`, `/_astro/*` | `max-age=31536000, immutable` | content-addressed, so the promise is keepable |
| `/fonts/*` | `max-age=31536000, immutable` | 75KB on every page — but the names carry no hash |
| everything else | `no-cache` | keep the copy, revalidate it |

HTML is `no-cache` rather than `no-store`: no-store makes every visit a full download, and
on a metered Kenyan bundle that is the buyer paying again for the same 21KB. It is not a
`max-age` either — what is on these pages is stock, price and dispatch, and serving a
four-minute-stale sold-out product is exactly the vendor behaviour the buyer arrived
expecting.

**The fonts are the one to be careful with.** `immutable` on a name with no hash is a
promise those exact bytes are final. A re-subset must ship under a new filename and a
matching `@font-face` update; overwriting either name in place strands every returning
buyer on the old file for a year, with no error anywhere.

`/_astro/*` was not in the brief and was raised rather than added quietly. It stays, on
Ric's ruling and on the same argument as the images: the cart bundle is content-hashed by
Astro exactly as `images.mjs` hashes a rendition, so the hash is what makes `immutable`
honest there too. Leaving the one hashed asset revalidating while fonts and images are
immutable would have been an inconsistency with nothing behind it — and the fonts, which
carry no hash, are the entry in this table that rests on a promise instead.

### V14, and what V4 was not counting

Three checks that share one property: none is visible from a desk. The build is happy, the
gates are green, the page renders, and the cost lands on a buyer who never says anything.

- **`width`, `height` and `alt` on every `<img>` in `dist/`.** Without dimensions the
  browser reserves no space, and everything under the image jumps when it arrives — on a
  product page that is the price, the docket and the add-to-order button moving under a
  thumb mid-tap
- **Every image URL a page emits resolves to a built file.** `Gallery.astro` derives five
  of each photograph's six URLs from the sixth, and its `RENDITIONS` list is a copy of
  `WIDTHS` in the script. Rather than thread a constant between an `.astro` and a
  hand-run `.mjs`, the check resolves what the page actually emits against what is
  actually in `dist/` — which catches the drift, a typo, and a pruned rendition something
  still points at. V12's argument applied to images, at higher stakes: a dead link is
  found by clicking, a dead `<img>` is a broken picture on the page whose job is to prove
  a real product exists
- **200KB per file, on `public/img/`.** On `public/` and not `dist/` because that is where
  the file enters the repo; catching it after it is in git history is catching it late

**V4 counted no image bytes at all, and would have kept passing the day photography
landed.** Five reveals at 70KB each is 350KB of a 500KB homepage arriving with nothing on
the report moving. It now charges each page for one file per `<img>` — the largest WebP
candidate, because a `<picture>` offers six renditions and the browser fetches one, so
counting six is a figure nobody pays. WebP at the top width is both the fallback format
and what a 3x phone at 400px CSS width actually requests; counting the 400w file would
flatter the number on the exact device the budget exists to protect.

### Measured, before and after

The pipeline was exercised on synthetic 2400x3200 and 2600x3400 sources, then reverted.

| | before | after, no photos | after, one photo on the page |
|---|---|---|---|
| `dist/index.html` | 103,598 | 104,219 | 208,923 |
| a product page | 104,183 | 105,000 | 209,686 |
| shared (2 fonts + cart) | 82,094 | 82,094 | 82,094 |
| `<img>` in `dist/` | 0 | 0 | 10 |
| heaviest rendition | — | — | 103,976 (1200w WebP) |

The 621-byte and 817-byte increases with no photography are the `.gallery` wrapper and its
rules, inlined into every page. The third column is one photograph on the homepage and one
on a product page, at the 1200px WebP the budget charges for: 208,923 of a 500,000
homepage budget, so roughly three more photographs fit on the homepage before it fails.

### Still open at step 12

- **There are no photographs.** All five products are `photos: []` and every page renders
  light with one kraft block. This step built the way in, not the thing
- **`og:image` is still absent**, and lands with the first photograph, as step 11 said
- **Nobody has looked at a real photograph in this layout.** No gate can tell you a crop
  is wrong, a stack reads badly, or a 3:4 window cut the product in half. The script
  prints what it trimmed for that reason, and the first shoot needs eyes on the page
