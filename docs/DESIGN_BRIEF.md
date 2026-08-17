# Design brief — MomentAura

**Version** 0.1 · **Date** 9 August 2026 · **Derives from** `PRD.md`
**Companion specs:** `STYLE-dark-editorial.md` (full dark system), `CLAUDE.md`
(operational constraints for agents)

---

## 1. The design problem

Not "make it look premium." The problem is narrower and harder:

> **Make an unknown Kenyan online store trustworthy to someone about to spend
> KSh 176,000 of their employer's money with a stranger.**

`[L]` Your competition is not Rolex. It is the Instagram vendor who takes the M-Pesa
and goes quiet. That is a lower bar and a completely different brief. The buyer's
question is not *"is this aspirational"* — it is *"will a real person actually send me
this thing."*

**Trust is the aesthetic.** Every design decision resolves against that.

## 2. Why the current site fails

`[C]` Observed on the live store:

| Symptom | Diagnosis |
|---|---|
| `THE APEX OF CUSTOM HOROLOGY` over a phone snap on paving stones | Borrowed prestige language with no prestige behind it |
| Grey product names on near-black | Illegible — reads as "didn't notice" or "didn't care" |
| Four photographic languages in one grid | Assembled from other people's images |
| 4 of 14 items sold out and still shown | Abandoned |
| Default Shopify email copy, "Powered by Shopify" footer | Unfinished |
| Nav of Home / Catalog / Contact only | No delivery, returns, or human — the trust surface is missing entirely |

`[L]` The failure is not low design quality. It is the **mismatch** between luxury
framing and the evidence on the page. A buyer registers the cheapest signal in the
room, not the most expensive one.

## 3. North star

**Plain. Exact. Dependable.**

Test every decision against those three words. "Aura" fails all three — which is the
strongest design argument for the naming decision in `PRD.md` D1.

## 4. Two systems, one gate

The site runs **two visual systems simultaneously**, selected per product.

| | Light system (default) | Dark editorial system |
|---|---|---|
| When | Always. Any product without real photography. | Only products with a real, properly-lit photograph |
| Feel | Legible, plain, dense, fast | Isolated object in warm dark, one per viewport |
| Ground | Warm paper | Warm near-black |
| Reference | Apple product pages — consistency, no shadows, one accent, alternating bands | Oryzo — void-mode reveal, tight uppercase, dashed rules |
| Full spec | §5 below | `STYLE-dark-editorial.md` |

**The gate, and why it exists:** `[C]` the dark system does not degrade without
photography. Strip the lit object out of a void-mode section and what remains is an
empty dark rectangle that reads as a site under construction. `[L]` a product with a
placeholder in the dark treatment looks materially worse than the same product in the
light treatment.

**Implementation:** each product carries `theme: "light" | "dark"`. A build-time check
fails the build if `theme: "dark"` and `photo: null`.

## 5. Light system — tokens

### Palette

| Role | Hex | Use |
|---|---|---|
| Paper | `#f7f5f0` | Page ground |
| Ink | `#17181a` | Headings, body, prices |
| Muted | `#6b6e72` | Secondary text, descriptions |
| Kraft | `#d9cfbc` | Dispatch label blocks, honest placeholders |
| Dispatch | `#0f7a5a` | The only accent — delivery facts, buttons. Twice per viewport max |
| Rule | `#e2ded5` | Hairlines, borders, dividers |

The greys are deliberately **cool** against a **warm** paper ground. `[L]` warm paper +
warm greys + a warm accent is the current default look of AI-generated design; the
temperature split is a deliberate move away from it. Do not warm the greys and do not
add a second accent.

### Type

Two families. Both variable, both self-hosted, both under the payload budget.

- **Archivo** — everything. Headings 500–600 with tight tracking, body 400.
- **JetBrains Mono** — data only. Prices, quantities, lead times, order codes.

Scale: 12 / 13 / 15 / 17 / 22 / 30 / 44. Nothing between, nothing above.
Body 16px minimum, line-height 1.6. Never a weight above 600.

`[C]` No Google Fonts CDN call. woff2 files ship from `/public/fonts`.

### Structure

- One radius: **4px**. Everywhere.
- Hairline `1px solid var(--rule)`. **Never a shadow for separation.**
- Left-aligned. Max width 1180px. Gutter 32px desktop / 20px mobile.
- Product grid 3 / 2 / 1.
- Generous negative space. If it feels slightly too empty, it is close to right.

## 6. Signature element — the dispatch label

Present in both systems. It is the thing the site is remembered by.

A block styled like a packing docket: kraft ground, hairline border, mono type, and
**only facts a buyer could verify**.

```
CONTENTS   flask · notebook · pen
LEAD TIME  5 working days
DISPATCH   Nairobi
MIN ORDER  1
STATUS     In stock
```

**Why this and not something prettier:** `[L]` structural devices should encode
something true about the content rather than decorate it. This one comes from the
subject's own world — consignment notes and packing slips — and it carries exactly the
information that closes the trust gap. It is the entire brief compressed into one
component.

**Rules:** never decorated, never animated, never given a shadow, never populated with
a figure that cannot be checked. In the dark system, verifiable delivery facts render
in the accent colour; everything else in cream.

## 7. Photography standard

`[L]` **If only one item on this brief is executed, make it this one.** Consistency in
photography will do more for perceived quality than colour, type and layout combined —
because inconsistency is the specific tell that a store is assembled from other
people's images rather than stocked with real things.

### The shoot — step by step

1. **Surface.** One large sheet of paper-white or warm-grey cartridge paper, curved up
   the wall to make a seamless sweep. No table edge in frame.
2. **Light.** Indirect daylight from a window, side-on. Between 10am and 2pm on an
   overcast day if possible. No flash, no room lamps, no mixed sources.
3. **Camera.** Your phone on a KSh 500 tripod. Lock exposure and white balance. Do not
   move the tripod between products.
4. **Angle.** Choose straight-on or 30° once. Never deviate across the set.
5. **Sequence per product.** Closed box → open box, contents visible → contents laid
   out flat → one detail shot of personalisation.
6. **Crop.** Every product to 3:4. Same margin around the object.
7. **Post.** Correct white balance identically across the whole set. Nothing else. No
   filters, no background replacement.
8. **Export.** WebP, longest edge 1600px, quality 80.

### Same session, three deliverables

- Product stills for the catalogue
- Box-opening image sequence (M4.5)
- The 15-second packing clip: hands, tape, label, handed to a rider (M1.3)

### Absolute prohibitions

`[C]` No AI-generated product imagery. No supplier photographs. No blank mockups
presented as products. No stock lifestyle. No people except hands, and hands only where
they show scale or the act of packing.

`[C]` AI generation of a product depicts *a* flask, not *your* flask. Proportions,
finish and construction will differ visibly from what ships. That is misrepresentation
regardless of intent, and `[L]` the cost is not a refund — it is a corporate buyer who
stops answering and tells the other office managers.

**Legitimate AI uses:** original artwork for a future anime line, storyboarding the
shoot before you take it, backgrounds and social graphics where no product appears, and
white-balance correction on real photographs. Note `[C]` that AI background replacement
is named in Meta's disclosure requirements, so keep it to correction on anything you
will run as an ad.

## 8. Motion

Near zero in the light system. `[L]` restraint reads as competence; effects read as
someone hiding thin content behind movement.

**Permitted:**
- Hover and focus state changes, no transition longer than 120ms
- Cart drawer slide-in
- Dark system only: 200–300ms on `cubic-bezier(0.625, 0.05, 0, 1)` for opacity and
  transform

**One elaborate moment, and only one:** the box-opening sequence on a product page. An
image sequence, lazy-loaded below the fold, tap-triggered, under 400KB. `[L]` it earns
its bytes because it replaces four photographs and a paragraph — it answers "what is
actually in it", which is the buyer's real question. It is not atmosphere.

**Banned:** scroll-triggered animation, fade-up-on-scroll, parallax, scroll-jacking,
spring physics, bounce easing, animated hue. Everything respects
`prefers-reduced-motion`.

## 9. Anti-generic constraints

`[L]` The tools will produce the templated look by default, because their training
clusters there. These are hard constraints, not preferences.

**Never:** gradient backgrounds or text · glassmorphism and backdrop-blur · a pill badge
above the headline · three-column icon-in-rounded-square feature grids · centred body
text · font weights above 600 · dark hero with a radial glow · bento grids · layered
drop shadows · emoji · abstract 3D blobs and mesh gradients · decorative icon-library
use · skeleton loaders on a static site · testimonial sections before real testimonials
exist.

**Never these words:** *elevate, unlock, seamless, supercharge, effortless, transform,
curated, timeless, luxury, premium, bespoke, signature, aura, moments, journey,
experience, discover.* Also no exclamation marks, no "simply", "just" or "please".

## 10. Copy rules

- **Sentence case everywhere** in the light system. Never all-caps product names.
- Product names state contents: `Founders set — flask, notebook, pen`.
- Concrete nouns and numbers instead of adjectives. "Boxed, delivered in Nairobi in
  5 working days" outperforms every available adjective.
- Buttons name the action and keep the name through the flow: "Add to order" →
  "Added to order".
- Errors say what happened and how to fix it. No apology, never vague.
- Empty states are an invitation to act, not a mood.

## 11. Page specifications

### Homepage

```
Static hero          Positioning line, one sub-line, two CTAs. No video in v1.
Proof row            Four checkable facts: delivery, payment, personalisation, bulk.
Featured sets        Three products. Real photographs or honest placeholders.
Bulk CTA             One line and a button. The revenue path.
```

`[L]` The proof row does the job a hero video cannot: it answers the buyer's actual
questions in under a second, at almost zero payload.

### Product page

Two columns: image left at 3:4, details right. Contents as a list, dispatch label below
a hairline, price in mono, quantity and add-to-order, then the bulk fork with an
explanation of why the threshold exists.

### Bulk orders — the most important page on the site

Volume tier table, lead time table, "what we need from you", quote form. Dense and
plain. `[L]` editorial pacing is for browsing; the quote path is for deciding, and a
procurement buyer reading tiers wants information density, not theatre.

### Delivery and returns

Zones with named areas, timelines, delivery cost, payment methods including the paybill
number, return window, and the personalised-goods exception. Plain prose and tables.

### About

Real name, real photograph, real Nairobi location, plainly stated supplier situation,
the packing clip. `[L]` the highest-leverage page on the site — it is what separates
this store from the anonymous ones the domain currently resembles.

## 12. Accessibility floor

Not optional, and cheap to hold if built in from the start.

- Contrast: 4.5:1 body, 3:1 large text — both systems, verified not assumed
- Visible keyboard focus on every interactive element
- Skip-to-content link
- Every image has alt text describing the product, not the file
- Forms have real labels, not placeholder-as-label
- Explicit width and height on every image to prevent layout shift
- `prefers-reduced-motion` honoured throughout
- Minimum 16px body, minimum 44px touch targets

### 12.1 Contrast audit — dark system, computed

Two tokens in `STYLE-dark-editorial.md` as first drafted **fail WCAG AA**. Corrected
values below supersede that document; update it before any dark-system work begins.

| Pair | Original | Ratio | Verdict | Corrected | New ratio |
|---|---|---|---|---|---|
| Tissue Cream on Packing Dark | `#f6efe2` / `#0e0b07` | 17.2:1 | Pass | — | — |
| Cream on Kraft Board | `#f6efe2` / `#3a2e1e` | 11.6:1 | Pass | — | — |
| **Sisal on Packing Dark** | `#7a6e5c` / `#0e0b07` | **3.9:1** | **Fail** | `#8f8371` | 5.3:1 |
| **Foil Green on Kraft Board** | `#23a377` / `#3a2e1e` | **4.1:1** | **Fail** | `#2fbf8b` | 5.7:1 |
| Foil Green on Packing Dark | `#2fbf8b` / `#0e0b07` | 8.4:1 | Pass | — | — |

The second failure is the serious one: Foil Green on Kraft Board is the docket, which
is the signature element and carries every delivery fact on the site. The colour whose
job is "this is verifiable" was the least readable thing in the system.

Both failures came from picking hexes that looked right against a dark canvas without
checking them against the *elevated* surface. Any new token gets computed, not eyeballed.

## 13. Handoff

| Artifact | Location |
|---|---|
| Light system tokens | `src/styles/tokens.css` |
| Dark system spec | `docs/STYLE-dark-editorial.md` |
| Agent constraints | `CLAUDE.md`, `AGENTS.md` |
| Copy for every page | `docs/brand-brief.md` §10 |

**Prompting note:** ask agents for **structure**, not mood. "A two-column product page,
image left at 3:4, details right, dispatch label below a hairline" produces the right
result. "Make it look premium" produces the generic one, because premium has no visual
definition — everything in this document does.
