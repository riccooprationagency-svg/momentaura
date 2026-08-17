# MOMENTAURA — Style Reference

> The packing bench at midnight. A single boxed object in warm dark, kraft and cream, every claim printed like a consignment docket.

**Theme:** dark
**Derived from:** Oryzo (structural grammar), rebuilt on a different material world.

Oryzo treats a cork coaster as a museum artifact — walnut void, cream type, one ember
accent held back for credits. MomentAura keeps that grammar and changes the material
source: not cork and workshop tools, but **kraft board, tissue paper, tape and a
dispatch label**. The object in the void is a boxed gift set. The tools in frame are
the packing bench.

Three deliberate inversions from the source system:

1. **Radius inverts.** Oryzo is deliberately chunky — never below 12px. Cardboard has
   sharp corners, so surfaces here sit at 2px. Only buttons go pill. The material
   dictates the geometry.
2. **The accent inverts.** Oryzo's ember appears only on credits and never on
   actionable elements. MomentAura's Foil Green appears **only on verifiable facts** —
   lead times, dispatch points, capacity, stock. Never on decoration, never on a
   headline. The accent means *this is checkable*, which makes it the trust mechanism
   rather than a highlight colour.
3. **The serial label becomes a docket.** Oryzo runs "ORYZO 1-MODEL" vertically down
   the right margin as a physical-product artifact. MomentAura's equivalent is the
   **consignment docket** — a mono block carrying contents, lead time, dispatch point
   and capacity. It appears on every product section. It is the signature element.

---

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Tissue Cream | `#f6efe2` | `--color-tissue-cream` | All reading text, headlines, nav, borders on interactive elements. Never pure white — the paper tint is the system's signature. |
| Packing Dark | `#0e0b07` | `--color-packing-dark` | Page canvas and every section ground. Warm near-black with a kraft cast, never pure black. The void the object sits in. |
| Kraft Board | `#3a2e1e` | `--color-kraft-board` | The one elevated solid — filled button, docket ground, capacity notice. One chromatic step above the canvas. |
| Twine | `#4a4034` | `--color-twine` | Hairline and dashed dividers, docket borders, section separators. |
| Sisal | `#8f8371` | `--color-sisal` | Mid-tone warm grey. Docket field labels, muted structural text, secondary captions. |
| Foil Green | `#2fbf8b` | `--color-foil-green` | **Verifiable facts only** — lead time, dispatch point, stock, capacity remaining. Never headlines, never decoration, never a CTA fill. |
| Seal | `#8c3a24` | `--color-seal` | Reserved. Sold out, cut-off passed, order closed. Appears at most once per page and often never. |

---

## Tokens — Typography

### Archivo — variable · `--font-archivo`

The only display and reading face. Weight 500 at display sizes drives uppercase
headlines with tight 0.9 line-height, so the letterforms stack as solid form rather
than sitting in lines. Weight 400 at 26px is the system's sole mixed-case
conversational voice. Free, variable, self-hosted — chosen over Halyard because the
payload budget is a hard constraint on Kenyan mobile.

- **Substitute:** Inter, Söhne
- **Weights:** 400, 500
- **Sizes:** 11, 12, 14, 17, 22, 26, 38, 48px
- **Line height:** 0.9 at display, 1.3 at body
- **Letter spacing:** normal at display, +0.08em at uppercase labels

### JetBrains Mono — variable · `--font-jetbrains-mono`

Data only. Consignment dockets, prices, quantities, order codes, lead times, capacity
counts. Never body copy, never headlines. The typeface shift is the signal that the
reader has moved from persuasion to fact.

- **Substitute:** IBM Plex Mono, ui-monospace
- **Weights:** 400, 500
- **Sizes:** 11, 12, 14px
- **Line height:** 1.7
- **Letter spacing:** +0.06em on uppercase field labels

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| docket | 12px | 1.7 | 0.06em | `--text-docket` |
| label | 12px | 1.4 | 0.08em | `--text-label` |
| caption | 14px | 1.4 | — | `--text-caption` |
| body-sm | 17px | 1.5 | — | `--text-body-sm` |
| body | 26px | 1.3 | — | `--text-body` |
| heading | 38px | 0.9 | — | `--text-heading` |
| display | 48px | 0.9 | — | `--text-display` |

Display and heading clamp down on mobile: `clamp(30px, 8vw, 48px)`.

---

## Tokens — Spacing & Shapes

**Base unit:** 4px · **Density:** comfortable

### Spacing Scale

`8 · 12 · 16 · 20 · 28 · 40 · 56 · 80 · 120 · 160px`

### Border Radius

| Element | Value |
|---------|-------|
| surfaces, cards, dockets | 2px |
| images | 2px |
| inputs | 0px (underline only) |
| buttons | 999px |

Two values carry the whole system. The near-square surfaces come from the material —
boxes, labels, printed dockets. The pill buttons are the one soft thing, and their
softness is what marks them as interactive.

### Layout

- **Page max-width:** 1240px
- **Section gap:** 100vh on product reveals, 120px on content bands
- **Docket padding:** 16px 20px
- **Element gap:** 20px

---

## Components

### Product Reveal Section
**Role:** The signature layout. One product, isolated, with fact and description flanking.

Full-viewport (100vh, `min-height: 640px`) Packing Dark ground. Centred product
photograph occupying the middle 40% of width. Left column: heading at 38px weight 500
uppercase, line-height 0.9, Tissue Cream, left-aligned. Right column: body at 26px
weight 400 mixed-case, Tissue Cream, left-aligned within its column, with the
consignment docket beneath it. 20px gutters. One product per section. Never two.

### Consignment Docket
**Role:** The signature element. Verifiable facts, printed like a packing slip.

Kraft Board ground, 1px Twine border, 2px radius, 16px/20px padding. Two-column grid:
field labels in JetBrains Mono 12px uppercase Sisal with +0.06em tracking, values in
Tissue Cream. Values that are checkable delivery facts — lead time, dispatch point,
stock — render in Foil Green. Fields: contents, lead time, dispatch, min order, status.
Never decorated, never animated, never given a shadow.

### Capacity Notice
**Role:** Honest scarcity. Replaces every countdown, urgency badge and "only N left".

Kraft Board ground, 2px radius, 1px dashed Twine top border. States a real production
constraint and a real date in JetBrains Mono: capacity figure in Foil Green at 14px
weight 500, cut-off date beside it, one line of Tissue Cream body-sm explaining what
happens after. When the date passes, the figure switches to Seal and reads "closed for
December delivery". **Every number in this component must be true and checkable.** If
you cannot verify it, the component does not render.

### Filled Pill Button
**Role:** The single primary action per section.

999px radius, Kraft Board background, Tissue Cream text, 14px/28px padding, Archivo
14px weight 500 uppercase +0.08em. One per section, maximum. Its rarity is the signal.

### Ghost Pill Button
**Role:** Secondary action, or the second half of a paired CTA.

999px radius, transparent fill, 1px Tissue Cream border, Tissue Cream text, 13px/26px
padding, same type treatment. Border does the work.

### Underline Input
**Role:** Quote form and email capture fields.

0px radius, transparent background, 1px Tissue Cream bottom border only, Tissue Cream
text at 17px. No box, no fill. Mirrors the ghost-button restraint. Focus adds a 2px
Foil Green bottom border — the only place the accent touches an interactive element,
and it does so as a state, not a fill.

### Dispatch Rule
**Role:** Section divider carrying a fact rather than decorating a gap.

1px dashed Twine line spanning the content column, interrupted at its midpoint by a
short JetBrains Mono 11px uppercase label — a route, a lead time, a dispatch point.
Never a plain divider. If there is no fact to carry, use vertical space instead.

### Fixed Top Navigation
**Role:** Persistent, minimal, four items.

Transparent over the hero, Packing Dark on scroll. Wordmark "MOMENTAURA" left at 14px
weight 500 uppercase Tissue Cream. Right: SETS, PERSONALISED, BULK, CONTACT at 12px
weight 500 uppercase +0.08em. Active item carries a 1px dashed Twine underline. No
search, no mega-menu.

### Vertical Edge Label
**Role:** Edge branding, inherited from Oryzo's serial label.

Rotated 90° text down the right margin: `MOMENTAURA — NAIROBI` at 11px uppercase Sisal
with +0.08em tracking. A dispatch-origin stamp translated to UI. Desktop only.

### Order Bar
**Role:** Persistent cart affordance.

Fixed bottom-right pill, Kraft Board fill, Tissue Cream text, JetBrains Mono 12px:
unit count and running total. Appears only once the order is non-empty. At 10 units it
changes to "Request a quote" and routes to the bulk path.

---

## Do's and Don'ts

### Do

- Set all text in `#f6efe2` — never `#fff`. The paper tint is the system.
- Use `#2fbf8b` **only** on facts a buyer could verify: lead time, dispatch point,
  stock, capacity. Its meaning is "you can check this."
- Set headings uppercase weight 500 with 0.9 line-height so the letterforms stack as
  form. Use mixed case weight 400 only for the 26px body voice.
- Give every product section its own full viewport. Never compress two products into
  one band.
- Use 2px radius on every surface and 999px on buttons. Those are the only two values.
- Put a consignment docket in every product section. It is the reason the system works.
- Use dashed Twine dividers that carry a label. A divider with nothing to say is
  vertical space instead.
- Photograph every product on one surface, one light, one angle, one 3:4 crop.

### Don't

- Never use pure white or pure black. Both read as wrong against a warm system.
- Never put Foil Green on a headline, a button fill, or anything decorative. One misuse
  destroys its meaning for the whole site.
- Never state a capacity, date or lead time that is not true. The entire system's
  premise is that the facts are checkable; one invented number collapses it.
- Never use a countdown timer, an "only N left" badge, or any urgency device that is
  not a real production constraint with a real date.
- Never add a drop shadow. Depth is the two-step surface stack, nothing else.
- Never use more than one filled button per section.
- Never centre body copy. Headings may centre; descriptions never do.
- Never use lowercase for nav, labels or headings. The 26px body is the only mixed case.
- Never ship a product section with a placeholder where the photograph goes. Use the
  light system for that product until the photograph exists.

---

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Packing Dark | `#0e0b07` | Page canvas, every section ground |
| 1 | Kraft Board | `#3a2e1e` | Docket, capacity notice, filled button — the only elevated solid |
| 2 | Twine | `#4a4034` | Hairlines, dashed dividers, docket borders |
| 3 | Tissue Cream | `#f6efe2` | Foreground text, nav, interactive borders |

## Elevation

No shadows. Depth is a single luminance step from `#0e0b07` to `#3a2e1e`. The
photography provides all dimensional depth; the interface stays flat and printed.

---

## Imagery

The object is the hero and the packing bench is its context. Photography is close, warm
and top-down: the boxed set open on kraft paper with tissue, tape, a marker and a
printed label visible in frame — the tools of dispatch, not lifestyle props. Product
reveals isolate one boxed set against Packing Dark, lit from the upper right with a warm
rim light so kraft texture and the box edge read clearly.

No AI-generated product imagery. No supplier photographs. No stock lifestyle. No people
except hands, and hands only where they show scale or the act of packing.

**Hard gate:** this system does not degrade gracefully without photography. A product
section with an empty slot is an empty dark box, and reads as a site under construction.
Any product without a real photograph stays on the light system until it has one.

## Layout

Full-bleed throughout, content anchored to a 1240px column. Hero: full-viewport
photograph of a boxed set on the packing bench, MOMENTAURA wordmark at 48px upper-left,
positioning line above it at 12px uppercase, fixed nav upper-right, vertical edge label
down the right margin, capacity notice lower-left. Beneath: one 100vh product reveal per
set, three columns of heading / object / description-plus-docket. Content bands (bulk
orders, delivery, about) drop to 120px vertical rhythm and a denser two-column grid,
because a procurement buyer reading volume tiers wants information density, not theatre.

Bulk orders and delivery pages carry the palette and type but **not** the 100vh rhythm.
Editorial pacing is for browsing; the quote path is for deciding.

## Typography Voice

Two modes, and the switch between them is the meaning.

**UPPERCASE WEIGHT 500** — nav, headings, labels, buttons, edge stamps. Declarative,
printed, museum-label. Line-height tightens as size grows: 1.4 at label, 0.9 at display.

**Mixed case weight 400 at 26px** — the only conversational voice, used for the one
paragraph per section that explains the product. When the case and weight drop, the
reader knows they have moved from label to description.

**JetBrains Mono** — the third register, and the one the system is really built on.
When type shifts to mono, the reader is looking at a fact.

## Motion

Restrained and weighted. Transitions 200–300ms on `cubic-bezier(0.625, 0.05, 0, 1)` —
a slow-out curve that reads as considered rather than snappy. Permitted: opacity fades,
transform slides, border-colour shifts on focus.

One elaborate moment, and only one: **the box opening** on a product reveal. An image
sequence, lazy-loaded, under 400KB, triggered on tap rather than scroll. It answers
"what is actually in it" — it is not atmosphere.

Never: spring physics, bounce easing, animated hue, scroll-jacking, parallax,
fade-up-on-scroll. Everything respects `prefers-reduced-motion`.

## Quick Start

```css
:root {
  --color-tissue-cream: #f6efe2;
  --color-packing-dark: #0e0b07;
  --color-kraft-board: #3a2e1e;
  --color-twine: #4a4034;
  --color-sisal: #8f8371;
  --color-foil-green: #2fbf8b;
  --color-seal: #8c3a24;

  --font-archivo: "Archivo", ui-sans-serif, system-ui, sans-serif;
  --font-jetbrains-mono: "JetBrains Mono", ui-monospace, monospace;

  --text-docket: 12px;
  --text-label: 12px;
  --text-caption: 14px;
  --text-body-sm: 17px;
  --text-body: 26px;
  --text-heading: clamp(28px, 6vw, 38px);
  --text-display: clamp(30px, 8vw, 48px);

  --leading-display: 0.9;
  --leading-body: 1.3;
  --leading-docket: 1.7;

  --tracking-label: 0.08em;
  --tracking-docket: 0.06em;

  --space-8: 8px;
  --space-12: 12px;
  --space-16: 16px;
  --space-20: 20px;
  --space-28: 28px;
  --space-40: 40px;
  --space-56: 56px;
  --space-80: 80px;
  --space-120: 120px;
  --space-160: 160px;

  --page-max-width: 1240px;
  --radius-surface: 2px;
  --radius-button: 999px;
  --radius-input: 0px;

  --dur: 240ms;
  --ease: cubic-bezier(0.625, 0.05, 0, 1);
}

@media (prefers-reduced-motion: reduce) {
  :root { --dur: 0ms; }
}
```

---

## The condition this system runs on

Everything above is executable today except the imagery, and the imagery is what makes
it work. Oryzo is a cork coaster rendered in a studio; strip the render and the layout
is an empty dark rectangle.

So: **light system until a product has a real photograph, dark system the moment it
does.** Both are in the repo. Products carry a flag. The site can run mixed, and it
will get darker as the photography lands.
