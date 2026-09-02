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

### Built. `/track` first, and it works today

All five pages exist; the nav and footer had linked to every one of them since section 2
and all five 404'd until now.

`/track` was built first because it is the only trust page that needs no fact Ric holds.
It closes the gap that opens the moment someone pays — money gone, then silence until a
parcel arrives — and it needs nothing invented to do it. Reference plus the phone the
order was placed with. No account, because an account is a password to forget and a
credential store to protect in exchange for nothing this needs.

**A wrong phone and a reference that does not exist return the identical response**,
byte for byte. Distinguishing them would make the phone check an oracle for which
references exist. `scripts/track-test.mjs` asserts it, in the pre-commit hook.

**What `/track` cannot find yet, and the page says so:** only the M-Pesa path records an
outcome, because it is the only one with a callback that settles anything. Step 8's
gateway has no webhook and writes nothing to KV. Until section 9 has credentials there is
nothing to look up, and the page states that rather than shrugging at a real reference.
Delete that paragraph when section 9 goes live.

### The gaps are data, not prose

Everything only Ric can supply lives in `src/data/site.json`, every value `null`, typed
and documented in `src/lib/site.ts`. The same rule as `products.json`: **a null renders as
an omission or as a stated absence, never as a placeholder and never as a guess.**

| Key | What is needed |
|---|---|
| `owner.name` | The real name of the person who packs and sends orders |
| `owner.photo` | A real photograph of that person. No AI, no stock, no avatar |
| `owner.area` | The part of Nairobi they work from |
| `contact.phone` | **A number that rings and is answered** |
| `contact.whatsapp` | The WhatsApp number, if it differs |
| `contact.hours` | When a person is actually there |
| `delivery.zones` | Areas with real costs and real working-day counts |
| `delivery.returnsWindowDays` | How many days to return something |
| `delivery.returnsCondition` | What condition it has to be in |

`GAPS` in `src/lib/site.ts` is derived from which of those are still null, so the list
cannot claim something is missing after it has been supplied. `Gap.astro` renders one
**in development only**, gated on `import.meta.env.DEV`, naming the key and what it
blocks. Production never sees it: a page showing "[PHONE NUMBER]" says the shop was
assembled from a template and left unfinished, which is the exact suspicion the site
exists to reduce. Production says only true things or says nothing.

**`contact.phone` is the most expensive missing value in the repo.** Every error message
on the payment path — `/api/checkout`, `/api/mpesa/stk`, the blocked order on `/order`,
the confirmation screen, `/track` — ends by routing someone to `/contact`, because
CLAUDE.md requires a phone number on an error and there has never been a real one. Each
of those is currently a route to a page that cannot finish the sentence. **One value
unblocks all of them at once**, which is why it was recorded as one dependency in section
7 rather than rediscovered five times.

### Privacy is complete, because it describes code rather than facts

It is the one trust page that could be written in full today: no analytics, no cookies,
no third-party scripts, self-hosted fonts, no accounts, order held in the browser as
product codes and quantities only, name and phone passed to the payment provider and
nobody else, no card form anywhere, pending orders expiring after seven days. Every
sentence is checkable against this repo, and the browser check asserts the page loads no
third-party resource while promising none.

The marketing opt-out CLAUDE.md requires takes its honest form: there is no mailing list
and nothing subscribes anyone to one, so the only use of an email address is the receipt
the buyer asked for. **If a mailing list is ever added, this page changes first.**

### `/track` cost no budget rise

The cart script went 7,486 bytes against a 6,656 ceiling when the tracking form landed,
and the budget did not move — CLAUDE.md's rule is shrink before raising, and there was
slack to find. Thirty-one `document.querySelector` calls became a helper, nine
`"aria-disabled"` literals became a constant, the two forms' shared fetch-and-busy-button
dance became one `send()`, and their two identical error-clearing blocks became one
`clearErrors(fields, slot)`. It ships at **6,616 of 6,656**.

### Still open

- **No rate limit on `/api/track`.** The reference is 8 characters from a 30-character
  alphabet and the phone must match, so brute force over HTTP is impractical, but
  impractical is not the same as bounded. Worth a KV attempt counter when there is traffic
  to justify the writes
- `about` and `delivery` become substantially shorter pages the moment their data lands;
  neither is padded to look finished in the meantime

## 11 — Ship
Sitemap, Open Graph images, Search Console. Test on a real phone on Safaricom data.
