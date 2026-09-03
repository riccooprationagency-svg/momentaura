# Build constraints — MomentAura

Read this file fully before writing any code. Every session.

**This file supersedes everything in `docs/`.** Those documents carry reasoning and
history; this one carries the rules. Where they conflict, this file wins. If a prompt
conflicts with this file, say so rather than silently following it.

---

## Stack

Astro (static output) · Cloudflare Pages · Cloudflare KV for order state · Cloudflare
Functions for anything touching money. No React, no Tailwind, no UI library. Plain CSS
with custom properties. Ask before adding any dependency; the answer is almost always no.

## What this sells

Apparel and accessories — t-shirts, hoodies, sweatshirts, bags, watches, necklaces.
Nairobi, Kenya. Prices in KSh. Payment by M-Pesa.

## The buyer

Arrives **suspicious**, not curious. They have been burned by a vendor who took the
money and went quiet, or know someone who has.

Every decision gets one test: **does this reduce suspicion or add to it?** Vagueness
adds. Specificity reduces. "Fast delivery" adds. "Nairobi, 5 working days" reduces.
Anything that cannot be checked is a liability however good it looks.

---

## The two systems

The site runs **two visual systems simultaneously**, chosen per product.

```js
product.photo === null  →  light system    (honest placeholder)
product.photo !== null  →  dark editorial  (the real thing)
```

The dark system does not degrade without photography — strip the product out and what
remains is an empty rectangle. So a product without a real photograph renders light,
with a kraft placeholder block, until it has one.

Never render a product dark with a placeholder inside it.

---

## Tokens

All live in `src/styles/tokens.css`. A raw hex or magic pixel value anywhere else is a bug.

### Dark editorial — default

```
--packing-dark   #0e0b07   canvas, every section ground
--tissue-cream   #f6efe2   all text, borders on interactive elements
--kraft-board    #3a2e1e   docket, capacity notice, filled button — only elevated solid
--twine          #4a4034   hairlines, dashed dividers, docket borders
--sisal          #a89c88   docket field labels, muted text
--foil-green     #2fbf8b   VERIFIABLE FACTS ONLY
--seal           #8c3a24   sold out, run closed. Docket Stock row, detail view only
```

### Light — products without photography

```
--paper          #f7f5f0   page ground
--ink            #17181a   headings, body, prices
--muted          #535659   secondary text
--kraft          #d9cfbc   placeholder blocks, docket ground
--dispatch       #0c6248   accent, same rule as foil-green
--rule           #e2ded5   hairlines
```

### The accent rule — both systems

`--foil-green` and `--dispatch` mean exactly one thing: **you can check this.**

Permitted: lead time, dispatch point, stock status, capacity remaining, run counts.
Forbidden: headlines, decoration, button fills, hover states, the logo, anything else.

One misuse destroys its meaning across the whole site. This is the single most important
constraint in this file.

### Contrast — verified, do not revert

`--sisal`, `--foil-green` and `--kraft-deep` were each corrected after failing WCAG AA on
the surface they actually sit on. `--sisal` took two passes: #7a6e5c to #8f8371 to
#a89c88, because the first correction fixed `--foil-green` and left sisal at 3.56:1 on
Kraft Board behind a comment claiming both were done. `--seal` is fill-only for the same
reason — as text it fails on both grounds.

`--muted` and `--dispatch` were corrected the same way, at 3.32:1 and 3.44:1 on `--kraft`.
That is the light system's docket ground, so those two set every field label and every
checkable fact on a site where every product still renders light. Neither pairing was in
the table, which is why the miss reached four tokens rather than one.

Any new token gets computed against every surface it will sit on, not eyeballed, and
`node scripts/contrast.mjs` reads the real values out of `tokens.css` to prove it.
Which surfaces those are is derived, not recalled: `verify.mjs` V9 computes the reachable
set from the scope blocks at the foot of this file's token list and fails on any pairing
missing a row. **Never add a token to a scope block without running both scripts.**

---

## Fonts

Two families. Both free, both variable, both self-hosted. Never load from a CDN.

| Family | Use | Weights |
|---|---|---|
| **Archivo** | Everything readable — headings, body, nav, buttons | 400, 500, 600 |
| **JetBrains Mono** | Data only — dockets, prices, quantities, lead times, order codes | 400, 500 |

The typeface switch is the signal. When type goes mono, the reader is looking at a fact.
Never set prose in mono. Never set docket data in Archivo.

```
--t-docket   12px / 1.7  / +0.06em   mono
--t-label    12px / 1.4  / +0.08em   uppercase
--t-caption  14px / 1.4
--t-body-sm  17px / 1.5
--t-body     26px / 1.3              mixed case, weight 400 — the only prose voice
--t-heading  clamp(28px, 6vw, 38px) / 0.9   uppercase, weight 500
--t-display  clamp(30px, 8vw, 48px) / 0.9   uppercase, weight 500
```

`--t-body` is the product-description register, not a document default. It is opt-in
via `.prose` — the one paragraph per product section. UI copy, dense copy and plain
paragraphs are `--t-body-sm`. Setting every `<p>` to 26px makes the interface shout.

Line-height 0.9 at display is the signature: uppercase letterforms overlap their line
bounds and stack as solid form rather than sitting in lines. Do not loosen it.

Weight ceiling 600, and 600 only in the logo. Nothing else above 500.

---

## Layout

- Max content width **1240px**, gutter 32px desktop / 20px mobile
- Radius: **2px** every surface. **999px** buttons. **0px** inputs. Nothing else
- Borders 1px solid or dashed. **Never a shadow, anywhere, for anything**
- Depth is the single luminance step from canvas to Kraft Board
- Product reveals 100vh desktop, `min-height: 620px` mobile. **One product per section**
- Category and listing pages drop the 100vh rhythm — browsing and choosing are different jobs
- Left-aligned. Headings may centre; body copy never does

## Components

**Consignment docket** — the signature element. Kraft ground, 1px Twine border, 2px
radius, mono. Two-column grid: field labels uppercase Sisal, values Tissue Cream,
checkable facts in Foil Green. Fields: contents, lead time, dispatch, min order, status.
Never decorated, animated, or shadowed. On every product.

**Capacity notice** — replaces every countdown and urgency badge. Real production figure,
real cut-off date, mono, figure in Foil Green. When the date passes it turns Seal and
reads closed. **Every number must be true. If it cannot be verified, the component does
not render.**

**Dispatch rule** — dashed Twine hairline interrupted mid-span by a mono uppercase fact.
A divider with nothing to say is vertical space instead.

**Closed stamp** — sold out, run closed, cut-off passed. `--seal` **fill** with Tissue
Cream on top, 2px radius, mono at `--t-docket`, uppercase. Seal is never a text colour:
it fails contrast on both grounds, and a closed run should read as stamped, not tinted.
The product stays visible — visible sold-out history is evidence that other people
bought.

**The stamp belongs to the docket. One per page, always.** The docket's Stock row is its
only home: that is where a buyer looks for facts, and stating checkable status is the
component's whole job. Everywhere else — cards, product page actions, listings — sold-out
status is stated in **`--fg-muted` mono, uppercase, no fill**. Mono keeps it in the data
register without spending the colour.

**That wording covers short status labels, not sentences.** "Sold out" on a card, in a
docket row, beside an action — those are data, and mono is the register for data. The line
on a product page explaining that a product cannot be ordered is **prose, and prose is
never set in mono**: it is Archivo at `--t-body-sm` in `--fg-muted`, which is what the
typography rules above already require. A rule about labels must not be read as licence to
mono-case a paragraph. No gate can tell these apart, so the distinction lives here.

**And the docket only spends it in a detail view.** `Docket` takes `detail`, which defaults
to **off**; the product page passes it and nothing else does. A homepage reveal is not a
detail view — it carries a *See the details* button pointing at the page that is. The
default is the load-bearing part, not the prop: it fails toward the muted state the way
tokens fail toward light and V7 fails toward requiring a background, so a new surface
composing `Docket` renders quietly rather than loudly. A component that forgets to opt in
costs nothing; one that spends the colour by accident costs it everywhere.

This is not a style preference. On a grid of three or nine sold-out cards the fills stop
reading as exceptional and start reading as the page's colour scheme, and a second stamp
80px below the first says the same thing twice. Both drain the one colour that means
*closed*. Reserve the fill for the detail view, where a single product is under
examination. Never hide the product to avoid the problem — say it in muted mono.

**Buttons** — filled pill (Kraft Board fill, cream text) or ghost pill (transparent, 1px
cream border). One filled button per section maximum.

**Disabled** is `--fg-muted` text, **`--fg-muted` outline**, no fill, `cursor: not-allowed`,
`aria-disabled`. Never the accent. Not `--border`: on paper that resolves to `--rule` at
1.23:1, which leaves the control with no visible edge — and a disabled control that stops
looking like a control defeats the whole reason for rendering it instead of hiding it.
Three rules, all learned the hard way:

- **Opacity is never how a disabled state is expressed.** Fading a filled pill halves the
  contrast of its label against the ground, so the one state that most needs to be read
  becomes the least readable on the page. Use a token measured against the surface it
  sits on
- **A disabled control is never an anchor.** An `<a href>` with `aria-disabled` still
  navigates on click and on Enter. `pointer-events: none` hides that rather than fixing
  it, and it suppresses the not-allowed cursor while leaving the keyboard path open. Drop
  the href instead
- **Set the full `border` shorthand, never `border-color` alone.** A variant that supplies
  no border of its own would otherwise render the disabled state with no outline at all.
  The state must not depend on another rule having got there first

A disabled action is never removed from the page. A missing button leaves the buyer unsure
whether the page is broken or the product unbuyable, and that ambiguity is the suspicion
this whole system exists to reduce. Render it disabled and say why in one line.

**Inputs** — underline only. 1px bottom border, no box, no fill. Focus adds a 2px Foil
Green bottom border. The one place the accent touches an interactive element, and it is
a state, not a fill.

---

## Banned — no exceptions

Gradients of any kind · gradient text · glassmorphism or `backdrop-blur` · pill badges
above headlines · three-column icon grids · centred body copy · font weights above 600 ·
dark heroes with radial glows · scroll-triggered animation · fade-up-on-scroll · parallax ·
bento grids · drop shadows · emoji anywhere including code comments · 3D blobs · mesh
gradients · stock illustration · decorative icons · skeleton loaders · countdown timers ·
"only N left" · fake stock counts · testimonials or star ratings before real reviews
exist · exit-intent popups · "someone just bought this" notifications

## Banned words

*elevate · unlock · seamless · supercharge · effortless · transform · curated · timeless ·
luxury · premium · bespoke · signature · aura · moments · journey · experience · discover ·
founded on a passion for · born from a love of*

No exclamation marks. No "simply", "just", or "please". No "we" if it is one person.

## Copy rules

- **Sentence case for products and prose. Uppercase for nav, labels, headings, buttons**
- Product names say what the thing is
- Concrete nouns and numbers instead of adjectives
- Prices always visible. Never "contact for price" under KSh 10,000
- Delivery as a **date**, not a duration. "Thursday 14 August", not "5–7 days"
- **Lead time is both, by context, and the distinction is not decoration.** On a card
  or in a docket it is a property of the product and reads as a duration — "5 working
  days". On a product page, at checkout and on the confirmation it is a **date**,
  because that is where the buyer is acting on a commitment, and a duration there asks
  them to do arithmetic before they can trust you. Do not flatten these into one
- Buttons keep their verb through the flow: "Add to order" → "Added to order"
- Errors say what happened, how to fix it, and carry a phone number. Never "something
  went wrong"

---

## Motion

Transitions 200–300ms on `cubic-bezier(0.625, 0.05, 0, 1)`. Opacity, transform and
border-colour only. Never spring, bounce, animated hue, scroll-jacking, or parallax.

One elaborate moment permitted site-wide: the box-opening or fold sequence on a product
page. Image sequence, under 400KB, lazy-loaded, tap-triggered, below the fold. It answers
"what is actually in it" — it is not atmosphere.

Everything respects `prefers-reduced-motion`.

## Imagery

Real photographs only. **No AI-generated product imagery. No AI-generated people. No
supplier photos in production. No stock lifestyle. No blank mockups presented as products.**

One surface, one light, one angle, one 3:4 crop, across every product. WebP, lazy-loaded
below the fold, explicit width and height on every image.

Where no real photograph exists: light system, kraft placeholder block, product name in
mono. An honest placeholder beats a dishonest photograph.

## Performance — pass/fail, not aspirational

Kenyan mobile traffic on metered bundles.

- Homepage transfer **under 500KB**. Any page under 1MB
- LCP **under 2.5s on throttled 3G**
- Text renders before any image completes. Zero render-blocking JS
- No hero video below 480px — a still renders instead
- Cart is the only client-side JS. `client:idle`, never `client:load`. There is no
  framework here, so `client:idle` is a guarantee to build rather than a directive to
  write: the cart is a plain `<script>` in `Base.astro`, which Astro bundles and
  references as `type="module"`, and everything it does is deferred again behind
  `requestIdleCallback`. It ships as one named file — `dist/_astro/cart.<hash>.js`,
  named by a plugin in `astro.config.mjs` because Astro's own name records which
  template held the tag and not what the file is. `assetsInlineLimit: 0` keeps it a
  file at all; Astro inlines a small hoisted script by default, which is how one
  script silently becomes one copy per page
- Touch targets 44px minimum

Test on a real phone on mobile data before every deploy. Not on wifi.

## Security

- **Never build a card form.** Payment always redirects to the gateway's hosted page
- **Never commit secrets.** Gateway and Daraja credentials live in Cloudflare environment
  variables, read only inside `functions/`
- Re-price server-side from our own catalogue. Never trust a client price
- The M-Pesa callback is unauthenticated — Safaricom does not sign it. Unguessable path,
  IP allowlist, idempotent by `CheckoutRequestID`, never trust the amount in the body
- **An STK prompt is not a payment.** Only a callback or a successful status query marks
  an order paid
- Payment code is the highest-risk in the repo. Every change read line by line

## Legal

- No licensed characters, no third-party trademarks, in imagery or copy. Ever
- Privacy policy and a working marketing opt-out ship with the first deploy
- Never state a stock figure, capacity, date or lead time that is not true

---

## How to work in this repo

- **One branch per build step, branched from current `main`, then PR, merge, delete.**
  Never commit a step directly to `main`. The gates catch constraint violations, not
  design mistakes — nothing in `contrast.mjs` or `verify.mjs` can tell you a hero is
  empty, a rhythm is wrong, or a docket reads badly. A pull request is the only place
  those surface before they ship
- Build components, not pages. Pages compose components
- Product data lives in `src/data/products.json`. Never hardcode a product into a template
- Prefer deleting to adding. If a section can be cut without losing information, cut it
- Every colour, size and space comes from a token
- `global.css` imports `tokens.css`. Never import `tokens.css` separately in a page or
  a component — one import path only, so the custom properties can never be undefined.
  A page that imports only `global.css` gets both; a page that imports only `tokens.css`
  gets a stylesheet that builds clean and renders unstyled
- **Any new or changed colour token requires `node scripts/contrast.mjs` to pass before
  commit.** It reads `tokens.css` directly and asserts every pairing in its `PAIRINGS`
  table. Do not eyeball it. This rule failed four times on eyeballing — `--sisal` shipped
  at 3.56:1 on Kraft Board behind a comment claiming it had been corrected, `--kraft-deep`
  would have shipped at 1.5:1, and `--muted` and `--dispatch` sat at 3.32:1 and 3.44:1 on
  kraft, which is where every docket on the site puts them
- **You do not maintain the `PAIRINGS` table by remembering.** `verify.mjs` V9 derives the
  reachable set from the scope blocks in `tokens.css` — every token resolving as `--fg`,
  `--fg-muted` or `--accent` against every token resolving as `--bg` or `--surface` in the
  same scope — and fails if any of them has no row. All four misses above were the same
  miss: `--fg-muted` and `--accent` are scoped aliases, so one class puts them on two
  grounds per system without either being named anywhere. Nothing in the docket says
  "sisal on Kraft Board". Remap a semantic role, or add a system, and V9 tells you which
  pairings you have just created
- **Breakpoints are declared in the comment at the top of `tokens.css` and written
  literally in every `@media` query.** `var()` does not work in a media prelude, so a
  breakpoint cannot be a token. There are three — 640px, 900px and 1100px. Read them there,
  change them there and in the queries together. Media preludes are the one place a
  raw pixel value is expected
- **V12 asserts that no internal link in `dist/` goes nowhere.** The nav and footer
  carried links to `/delivery`, `/contact`, `/about`, `/privacy` and `/track` from step 2,
  and all five 404'd until step 10 — eight steps, on a site whose premise is that a buyer
  arrives suspicious. Nothing in the build was unhappy about it: Astro does not know which
  hrefs a template invented, and every page rendered perfectly. A dead link is the cheapest
  confirmation a buyer can get that a shop is abandoned
- `node scripts/verify.mjs` checks the rest: no raw hex outside `tokens.css`, the accent
  confined to its sanctioned sites, the closed stamp contained to `Docket.astro`
  and counted at no more than one Seal fill per built page, the `PAIRINGS` table complete
  against the reachable set, the banned-construct list, and page weight against budget.
- **V3 pins the accent to named selectors, not to a count.** There are two sanctioned
  uses and CLAUDE.md names both in prose: the docket's fact row in `global.css`, and the
  2px focus underline on `Field.astro`'s input — "the one place the accent touches an
  interactive element, and it is a state, not a fill". The check was "exactly one
  reference" until step 8 added the second, and a bare count of two would then have
  accepted any two references anywhere. Two wrong ones pass a count; they do not pass a
  table of file plus selector. A new use fails whatever the total, and moving a sanctioned
  one fails until the table is edited on purpose — which is the point, because editing it
  is the decision being made out loud
- **V4 counts the scripts, and it is a budget rather than an absence.** It asserted zero
  JavaScript until step 7 shipped the cart — the one exception this file has always
  named — so it moved from absence to containment rather than being relaxed: exactly one
  `.js` in `dist/`, named `cart.<hash>.js`, under 7KB, referenced by that same one URL
  from every page, and no inline `<script>` body anywhere in the output. Absence needs no
  judgement and a budget nobody counts becomes a comment, which is why the loosening had
  to buy a tighter rule somewhere else.
  **The byte budget has moved twice — 5KB to 6.5KB at step 8, 6.5KB to 7KB at step 10.**
  Step 8 paid for the checkout submit and the confirmation screen; step 10 paid for order
  lookup, the sixth job this one script does. Both raises are argued in `verify.mjs`
  beside the constant, and that is the only place either may ever be argued.
  **Shrink first, and shrink more than you raise.** Step 10 removed roughly 930 bytes —
  one `q()` for thirty-one `querySelector` calls, one constant for nine `"aria-disabled"`
  literals, one `send()` for both forms' fetch-and-busy-button dance, one `clearErrors()`,
  one `say()`, one `toOrder()` — and still missed by 62. What was rejected to close that
  62 is the part worth remembering: folding the checkout submit and the tracking submit
  into one generic form handler would have fitted, and would have buried the payment path
  in an eight-parameter abstraction that this file requires to be read line by line. **A
  budget is never worth making the money code harder to read.** A budget that follows
  whatever the file happens to weigh is not a budget, and that starts with one raise
  nobody wrote down.
  **7KB is final. The budget does not move again in this project.** Two raises in two
  consecutive steps is the pattern this rule exists to prevent, and both were argued
  honestly — which is precisely how a number reaches 12KB without any single step
  looking like the one that broke it. From here there are two outcomes and no third:
  a feature fits in what remains, or it does not ship as client-side JavaScript.
  "It is only 400 bytes" was the argument both previous times. If something genuinely
  needs more room, that is a conversation held **before the code is written** — about
  whether the work belongs on the client at all, or belongs in a form post, a server
  render, a link to a page. Never a constant adjusted after the gate has failed
- **The cart stores slug and quantity only. Never a name, a price or a stock figure.**
  This is a security property, not an implementation detail, and step 8 must not weaken
  it. localStorage is the buyer's own disk: anything the cart writes there, a buyer can
  edit, and anything the site later reads back it has to distrust. Storing only a slug and
  an integer means a tampered value can inflate a quantity and nothing else — it cannot
  invent a product, move a price, or claim stock that does not exist, because those three
  are rendered into the page from `products.json` at build time and looked up by slug.
  Cache a price into storage and the tampering surface stops being a quantity and becomes
  the order total.
  It is also why `/order` renders every product as a hidden line and reveals what is in
  the order, rather than building markup in the browser. Nothing crosses out of storage
  into the DOM: the only values the script writes are numbers it computed and text the
  page itself handed it. No `innerHTML`, anywhere, ever.
  The quantity is still a client value and still not trusted. It is capped on read, and
  step 8 re-prices server-side from our own catalogue regardless. This is the client-side
  half of the Security section's "never trust a client price", not a substitute for it
- **Step 8 added a second key, `momentaura.placed.v1`, and it obeys the same rule.** It
  holds the slugs and quantities of the order just placed, plus the order reference the
  server minted, so the confirmation screen can still say what was bought after the order
  itself has been cleared. Still no name, no price, no stock: the amounts on that screen
  are looked up from the catalogue rendered into the page, exactly as `/order` does.
  The reference is the one value that crosses from storage into the DOM, so it is checked
  against the shape `checkout.js` mints before it is written, and a snapshot that fails
  discards whole. It goes in through `textContent`, which cannot inject markup — the test
  is not about injection but about proving that what appears under "your order reference"
  is a reference. **A reference is never trusted as an assertion that an order was paid.**
  Nothing on the confirmation screen claims the money arrived, because a redirect is a URL
  and anyone can type one; only step 9's callback can say that
- **`node scripts/checkout-test.mjs` guards the money path, and it runs on every commit
  too.** `functions/` sits outside the Astro build: `contrast.mjs` reads `tokens.css` and
  `verify.mjs` walks `src/` and `dist/`, so a `checkout.js` broken in half passes every
  other gate in this repo. It runs the shipped handler on Node's own fetch primitives —
  the same ones the Workers runtime supplies — rewriting exactly two imports: the
  catalogue, so a case can set real stock without the shipped `products.json` ever being
  edited to make a test pass, and `createHostedCheckout`, so a gateway failure is
  deterministic. `GatewayError` stays real, because `checkout.js` branches on
  `instanceof` and a stubbed class would pass that branch for the wrong reason. What it
  cannot prove is anything about a live gateway, and it says so rather than implying
  otherwise
- All three scripts run on every commit via `.git/hooks/pre-commit`

## Prompting note

Ask for **structure**, never mood.

Good: "A product reveal section, 100vh, heading left at display size uppercase, product
image centred at 40% width, description and docket right."

Bad: "Make it look premium." Premium has no visual definition, so the model falls back to
its average — which is the generic result this file exists to prevent.
