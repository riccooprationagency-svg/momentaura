# Experience specification — MomentAura

**Version:** 0.1 · 30 July 2026
**Scope:** Every stage of the site and the customer journey, what the buyer sees, what
they should feel, and the mechanism that produces it.

**Relationship to other documents**

| Document | Owns |
|---|---|
| `brand-brief.md` | Positioning, voice, market diagnosis |
| `PRD.md` | Requirements and scope |
| `DESIGN_BRIEF.md` | Visual system rules |
| `STYLE-dark-editorial.md` | Tokens and components |
| `IDENTITY.md` | Logo and its applications |
| **`EXPERIENCE.md`** (this) | **Stage-by-stage behaviour and emotional intent** |

**Conflict warning.** `PRD.md` was written for corporate gifting. This document is
written for **apparel and accessories**, following the direction set by the hero
brief, the reference images and the garment flats. Where they disagree, this document
reflects the current direction and the PRD needs rewriting.

---

## Part 1 — The emotional thesis

### The starting position

The buyer arrives **suspicious**. Not neutral. Not curious. Actively scanning for
evidence that this is another store that will take the M-Pesa and go quiet.

This is the single most important fact in this document. Almost every design instinct
that feels right — big aspirational imagery, mood-first copy, dramatic reveals — is
calibrated for a buyer who arrives *curious*. Ours doesn't.

### The arc

| Stage | State | What moves them |
|---|---|---|
| Arrival | **Suspicion** | Speed, legibility, absence of anything trying too hard |
| First scroll | **Recognition** | This is a real shop with real things and real prices |
| Product | **Relief** | Every question answered before it is asked |
| Decision | **Confidence** | Terms stated plainly, no pressure applied |
| Post-order | **Reassurance** | Told what happens next, then it happens |
| Delivery | **Recommendation** | The package matches the site |

**Relief is the conversion event.** The moment they stop looking for reasons this is
fake is the moment they start choosing a size.

### The test for every decision

> Does this reduce suspicion, or add to it?

Vagueness adds. Specificity reduces. "Fast delivery" adds, because it is what someone
writes when they have no number. "Nairobi, 5 working days" reduces.

Anything that cannot be checked is a liability, however good it looks.

---

## Part 2 — Stage by stage

Each stage below: **what they see · what they should feel · what they do next ·
the mechanism · the failure mode.**

---

### Stage 0 — Arrival (0–3 seconds)

**Sees:** Text and layout, immediately. Wordmark, headline, and the capacity line
render before any image finishes loading.

**Feels:** Nothing consciously — but the suspicion meter moves. A page that renders
instantly on mobile data is read as competent before a word is processed.

**Does:** Stays. Or leaves. This is the highest-attrition moment on the entire site.

**Mechanism:** Text-first render. Under 500KB total. Video never loads below 480px.
Poster frame set, `preload="none"`. No layout shift — explicit width and height on
every image.

**Failure mode:** A spinner, a blank dark screen, or a hero that pops in after 4
seconds. Each reads as *this store is not maintained*. On a metered bundle, a heavy
homepage is also literally charging them to look.

---

### Stage 1 — Hero

**Sees:** Full viewport, Packing Dark. Wordmark upper left at 48px uppercase,
positioning line in mono above it, capacity notice lower left in kraft with the
remaining figure in Foil Green. Nav upper right, transparent. Vertical edge stamp down
the right margin. Behind it: one product, one continuous shot, silent, looping.

**Feels:** *This is a workshop, not a storefront.* Restraint reads as a business too
busy making things to shout.

**Does:** Scrolls. There is nothing else to do — deliberately. One route forward.

**Mechanism:** One object in frame. No cuts. No music. No scroll indicator, no badge,
no overlay CTA. The capacity number is the only thing asking for anything, and it asks
by stating a fact.

**Failure mode:** A montage of six categories. It says *we sell everything*, which for
an unknown store says *we own nothing*. Also: any urgency device here poisons every
stage that follows.

---

### Stage 2 — Dispatch rule

**Sees:** A dashed hairline across the column, interrupted at its midpoint by mono
uppercase: `NAIROBI · 5 WORKING DAYS · M-PESA`.

**Feels:** First reduction in suspicion. Three of their four questions answered in one
line, before they asked.

**Does:** Keeps scrolling, slightly less defensively.

**Mechanism:** A divider that carries a fact rather than filling a gap. It costs no
space, no weight, and no attention, and it does the work a trust-badge row pretends to.

**Failure mode:** A row of icon badges — "Fast shipping", "Secure checkout", "Quality
guaranteed". Generic reassurance is the visual grammar of stores with something to
hide.

---

### Stage 3 — Category tiles

**Sees:** Six tiles, three across, two rows. Each a 3:4 photograph, 2px radius,
category name in mono uppercase beneath. Nothing else.

**Feels:** Orientation. *This is what they sell and I can see all of it.*

**Does:** Either clicks into a category, or continues down the page.

**Mechanism:** Every tile identical in treatment. Consistency across categories is what
makes six product types read as one company rather than a marketplace. No hover zoom,
no overlay text, no "shop now" — the photograph and the name are sufficient.

**Failure mode:** Varied tile sizes, feature-tile layouts, or per-category styling.
Variation reads as instability, and instability is what they are scanning for.

---

### Stage 4 — Product reveals

**Sees:** The page slows. Three or four full-viewport sections, each holding **one**
product. Heading left at 38px uppercase, line-height 0.9. The garment centred, isolated
on Packing Dark, warm rim light from upper right so fleece texture and shoulder seam
read. Right column: one paragraph at 26px mixed case — the only conversational voice on
the site — then the docket, then one pill button.

**Feels:** Attention. The pace change is the message: *this thing is worth looking at,
so we are going to stop.*

**Does:** Reads the paragraph. Scans the docket. Clicks through, or scrolls to the next.

**Mechanism:** One object per viewport. The typographic switch — uppercase 500 to mixed
case 400 — signals a move from label to description, and the reader registers it
without noticing. The docket then switches to mono, which signals a move from
description to fact.

**Failure mode:** Two products in one section. The moment the layout has to compare, it
stops revealing.

---

### Stage 5 — Category page

**Sees:** Heading at 38px uppercase, one line of description, then a straight grid —
three across desktop, two tablet, one mobile. Every card the same: photograph, name,
price, lead time. Filters as plain mono text links along the top.

**Feels:** Efficiency. The editorial pacing has stopped and that is correct — they came
here to choose, not to be impressed.

**Does:** Filters, scans prices, opens two or three products.

**Mechanism:** Deliberately quieter than the homepage. Browsing and choosing are
different jobs and the page acknowledges it.

**Failure mode:** Carrying 100vh drama into a listing page. Nothing is more tiring than
a shop that will not let you scan it.

---

### Stage 6 — Product page

**Sees:** Two columns. Image left at 3:4 with three thumbnails beneath — front, back,
and a fabric detail close enough to see the knit. Right column in strict order:
category, name, price, one paragraph, **the docket**, size selector, quantity, one
filled pill, a hairline, then delivery terms.

**Feels:** **Relief.** This is where the arc turns. Every question they were holding —
what weight, what fit, how long, can I return it, how do I pay — is answered on screen
without a click.

**Does:** Selects a size. Adds to order.

**Mechanism:** The docket carries fabric weight, fit, print method, lead time, dispatch
point, stock. Delivery facts render in Foil Green because they are checkable, and that
colour means exactly one thing across the site: *you can verify this*. The fabric
detail thumbnail is doing more work than it looks — texture at close range is the
hardest thing to fake, so showing it is itself a claim of authenticity.

**Failure mode:** Any specification hidden behind a tab or accordion. A collapsed panel
reads as something being kept back. Also: "premium quality" anywhere on this page — it
is the phrase used in place of a fabric weight.

---

### Stage 7 — The drop (limited items)

**Sees:** Same dark system, one difference. A `LIMITED` stamp in mono on the card, and
two extra docket fields in Foil Green:

```
RUN SIZE   40
REMAINING  12
CLOSES     15 NOV
```

One line of copy: *Printed once. When the run closes it does not come back.*

**Feels:** Genuine urgency, without the taste of manipulation. The difference is
verifiability — the number is true, and it decrements because units actually sold.

**Does:** Buys sooner than they otherwise would.

**Mechanism:** When the run reaches zero the stamp turns to Seal and reads `RUN
CLOSED`, and **the product stays visible.** Visible sold-out history is more persuasive
than any countdown, because it is evidence that other people bought. A timer says
*hurry*. A closed run says *you missed one, do not miss the next*.

No discounts on this page. No bundles. No urgency copy beyond the one line. The premium
signal is the restraint around the scarcity.

**Failure mode:** A countdown timer, a fake remaining count, or a number that resets.
One invented figure collapses the credibility of every number on the site, including
the honest ones.

---

### Stage 8 — Order review

**Sees:** Line items with per-line and total cost, editable quantity, running unit
count. A restatement of delivery terms and payment methods. One button.

**Feels:** Control. Nothing has been added, nothing upsold, no shipping surprise
waiting at the next step.

**Does:** Proceeds, or edits and proceeds.

**Mechanism:** Total delivered cost is visible **before** checkout begins. Undisclosed
shipping added at the final step is among the most common causes of abandonment and it
re-triggers suspicion at the worst possible moment.

**Failure mode:** Cross-sells, "you may also like", or a progress bar with five steps.

---

### Stage 9 — Checkout

**Sees:** Name, phone, email optional. Then a redirect to the gateway's own page for
payment.

**Feels:** Safety. The handoff to a recognised payment page is reassuring rather than
jarring, provided it is expected.

**Does:** Pays.

**Mechanism:** Tell them the redirect is coming before it happens. An unannounced jump
to a different domain at the moment money moves is the single most suspicion-inducing
event in the flow. **No card field ever exists on our domain** — this is a security
requirement and it happens also to be the right experience.

**Failure mode:** Silent redirect. Or an error state that says "something went wrong"
with no phone number. Every checkout error must carry a number they can call, because a
phone number is proof of a person.

---

### Stage 10 — Confirmation

**Sees:** Order reference, what was bought, amount paid, **the expected delivery date
as an actual date**, and how to reach a human.

**Feels:** Reassurance. The transaction has become a commitment with a date attached.

**Does:** Screenshots it. Possibly shares it.

**Mechanism:** A date — "Thursday 14 August" — not a duration. Durations require mental
arithmetic and feel evasive; dates are commitments. This screen will be screenshotted
and shown to other people, so design it to be read out of context.

**Failure mode:** "Thank you for your order!" and nothing else. That is the moment
buyer's remorse enters, and an empty confirmation invites it.

---

### Stage 11 — Between order and delivery

**Sees:** A dispatch message when the parcel leaves, with the courier and the date.

**Feels:** Held. The gap between paying and receiving is where trust is most fragile,
and silence in that window is what makes people write to ask if they have been scammed.

**Does:** Waits without anxiety.

**Mechanism:** One message at dispatch. Not three. Over-messaging reads as anxious.

**Failure mode:** Silence. Or a delay that goes unmentioned. **A late delivery that was
communicated early does less damage than an on-time delivery that went silent.**

---

### Stage 12 — The package

**Sees:** Kraft box. Cream wordmark. A dispatch sticker with the order number and date
**written by hand**. Tissue. The garment. A woven neck label carrying the stamp.

**Feels:** Confirmation that the site was telling the truth. This is the moment the
whole system either pays off or is exposed.

**Does:** Photographs it. Posts it. Tells someone.

**Mechanism:** The physical package is the last screen of the website. Handwriting on a
printed label is deliberate — it is proof of a human, and it is the detail people
photograph. Every visual decision made online has to survive contact with the object.

**Failure mode:** A polybag with a courier sticker. Not because it is cheap, but
because it contradicts everything the site claimed about care.

---

### Stage 13 — Return visit

**Sees:** New drops, closed runs still visible, the dispatch ledger with updated
figures.

**Feels:** Membership, mildly. They bought before it closed. There is a next one.

**Does:** Buys again, earlier in the run than last time.

**Mechanism:** Closed runs stay on the site permanently. They are the archive that
makes the current run credible.

---

## Part 3 — Proof, in place of testimonials

Until roughly twenty orders are complete, a testimonials section cannot honestly exist.
The slot is filled instead by three things available from day one:

**The dispatch ledger** — a mono block styled as a docket. Real figures, however small:
`14 ORDERS DISPATCHED · AVG 4.2 DAYS · NAIROBI, KIAMBU, MACHAKOS`. Small honest numbers
outperform impressive vague ones, because vague numbers are what fabricated ones look
like.

**The packing clip** — 15 seconds, unpolished, hands and tape and a label. The
highest-trust asset available and it costs nothing.

**A named human** — photograph, name, area, in the same section rather than a page away.

**When real reviews exist:** first name, area, product bought, one or two sentences, and
a dispatch date. No stars, no avatars, no carousel. A carousel of five-star quotes is
what fabricated looks like; a short dated list with place names is what real looks like.

---

## Part 4 — Mobile

Most traffic will be mobile, much of it arriving from a link pasted into WhatsApp.

- No hero video below 480px. A still renders instead.
- 100vh sections become `min-height: 620px`. Full-viewport sections on a phone with a
  browser chrome bar leave the buyer stranded with no visible affordance.
- Nav collapses to wordmark and order count. No hamburger containing six items —
  categories live in the tiles.
- Touch targets 44px minimum. Size selectors are the most-missed target on apparel
  sites.
- Open Graph image on every page. A link with no preview card in WhatsApp converts
  materially worse, and WhatsApp is the primary sharing surface.

---

## Part 5 — Failure states

Every one of these is a suspicion event. Design them as carefully as the happy path.

| State | Requirement |
|---|---|
| Out of stock | Say so on the card and the page. Never hide the product |
| Run closed | Stays visible, stamped `RUN CLOSED`. It is proof, not clutter |
| Checkout error | Specific message plus a phone number. Never "something went wrong" |
| Payment declined | Explain, offer to take the order by phone |
| Form failure | Never silent. Confirm on screen and log the delivery |
| Empty cart | One line and a route back. Not a mood |
| 404 | Plain, one route to categories. No joke |
| Slow connection | Text renders first. Always |

---

## Part 6 — Never

Applies at every stage, without exception.

- Countdown timers, fake stock counts, or any urgency that is not a real constraint with
  a real date
- Exit-intent popups
- "Someone in Nairobi just bought this" notifications
- Review carousels, star ratings without reviews behind them
- Stock photography, AI-generated product imagery, AI-generated customers
- Discounts before a full price has ever been paid
- Specifications hidden behind tabs or accordions
- Shipping cost revealed only at the final step
- The words *premium, luxury, exclusive, curated, elevate, timeless*
- Any claim on the site that could not be checked by someone who tried

---

## The condition all of this runs on

Every stage above is executable today except the photography, and the photography is
what makes it work. Strip the product from a dark editorial layout and what remains is
an empty rectangle.

The order of work stays: source the stock, shoot it once properly, then ship. The
document is not the product, and neither is the site.
