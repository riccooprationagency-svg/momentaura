/* The order. The only client-side JavaScript on the site, and it stays the only
 * one — CLAUDE.md: "If a feature needs a second script, it does not ship."
 *
 * localStorage only. No accounts, no server state, nothing to leak. The order is
 * a map of slug to quantity and nothing else: no names, no prices, no stock.
 * Those are rendered into the page at build time from products.json, so a
 * tampered storage value can inflate a quantity but can never invent a product,
 * a price or a stock figure. Step 8 re-prices server-side regardless.
 *
 * IDLE, NOT LOAD. CLAUDE.md specifies client:idle, and that directive belongs to
 * Astro's framework islands — there is no framework here, so the guarantee it
 * names has to be built rather than declared. The module is deferred by being a
 * module, and everything it does is deferred again behind requestIdleCallback,
 * so the order count cannot compete with first paint on a metered connection.
 * The fallback is a zero-delay timer rather than a fixed wait: a browser without
 * requestIdleCallback should still paint the count within the same frame budget.
 *
 * It fails toward an empty order the way tokens.css fails toward light. Storage
 * blocked, storage full, JSON corrupt, a slug no longer in the catalogue — every
 * one of those resolves to "nothing in the order", which is a state the page
 * already renders honestly and statically. None of them throws.
 */

const KEY = "momentaura.order.v1";

/* A ceiling, not a stock figure. It stops a stuck key or a hand-edited storage
 * value from rendering a five-digit quantity against a real price. Stock is what
 * actually gates an order, and it is checked separately below. */
const MAX_QTY = 99;

type Order = Record<string, number>;

/* How high this product can honestly go: the lower of the hard ceiling and what
 * is actually in stock, read from the figure the page rendered out of
 * products.json at build time.
 *
 * COURTESY, NOT A CONTROL, AND THE DISTINCTION IS THE WHOLE POINT. Clamping here
 * stops an honest buyer being walked to checkout with a quantity that will be
 * refused there, which is a failure at the worst moment in the flow. It is not
 * what stops the order. Everything on this side of the wire is the buyer's own
 * machine to edit, so a clamp here decides nothing that costs money:
 * functions/api/mpesa/stk.js re-reads stock from the catalogue and rejects the
 * line by name with the real figure. That check is the enforcement. This one
 * must never be mistaken for it, and must never be the reason the server check
 * is thought unnecessary — same division as re-pricing, for the same reason.
 *
 * A missing or unreadable figure falls back to MAX_QTY rather than to zero. This
 * is the convenience layer, and a convenience that blocks a real order because a
 * data attribute went missing has done more damage than the refusal it exists to
 * prevent. Failing open is correct here precisely because the server does not. */
const ceiling = (stock: string | undefined): number => {
  const figure = Number(stock);
  return stock && Number.isFinite(figure) ? Math.min(MAX_QTY, figure) : MAX_QTY;
};

const units = (order: Order): number =>
  Object.values(order).reduce((total, qty) => total + qty, 0);

/* Every read is defensive. This value comes off the buyer's own disk, which
 * means it survives a deploy that renamed a product, an unrelated tab writing
 * the same key, and a person with devtools open. Anything that is not an integer
 * quantity of at least one is dropped rather than repaired. */
function read(): Order {
  let parsed: unknown;
  try {
    /* Blocked storage throws here, an absent key reads as "" and JSON.parse("")
       throws: one catch, one answer, an empty order. */
    parsed = JSON.parse(localStorage.getItem(KEY) ?? "");
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const order: Order = {};
  for (const [slug, qty] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Number.isInteger(qty) || (qty as number) < 1) continue;
    order[slug] = Math.min(qty as number, MAX_QTY);
  }
  return order;
}

/* Storage can be full or blocked — Safari private browsing throws on write. The
 * page keeps working off the in-memory order; only persistence is lost, and an
 * order that silently fails to persist is a better outcome than a thrown
 * exception taking the quantity steppers down with it. */
function write(order: Order): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    /* Intentionally empty. See above. */
  }
}

let order = read();

/* Thirty-one calls to document.querySelector, nine string literals reading
 * OFF. Neither is interesting, and together they were most of a
 * kilobyte of a budget that exists to keep this file from becoming an
 * application. Shrinking before raising the budget is the rule CLAUDE.md
 * records, and this is where the slack was. */
const q = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(selector);

const qa = (selector: string): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>(selector)];

const OFF = "aria-disabled";

/* Eleven listeners, each of which was `if (el) el.addEventListener(...)`. A page
 * that lacks the element simply has nothing to listen on. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const on = (el: EventTarget | null, type: string, handler: (event: any) => unknown) =>
  el?.addEventListener(type, handler);

/* Sets an attribute, or removes it for null: the pair every enable/disable below
 * was writing out by hand. */
const attr = (el: HTMLElement, name: string, value: string | null | undefined) =>
  value == null ? el.removeAttribute(name) : el.setAttribute(name, value);

/* Whether a control is in its disabled state. aria-disabled is a label and not a
 * behaviour, so every handler asks this before it acts. */
const isOff = (el: HTMLElement) => el.getAttribute(OFF) === "true";

/* Reveals the one [data-status] block named `outcome`, hides the rest. Shared
 * by /track's lookup result and /order-received's payment poll — both render
 * one of a small set of named outcomes and nothing else, and two copies of
 * "hide all, show one" is exactly the kind of drift CLAUDE.md's storage rule
 * warns about elsewhere in this file. */
function showStatus(outcome: string): void {
  for (const state of qa("[data-status]")) state.hidden = state.dataset.status !== outcome;
}

/* What an order cost (and on /track, where it is going), AS RECORDED, already
 * formatted by the server. Shared by /track's lookup and /order-received's
 * payment poll, which both answer with the same breakdown from _amounts.js.
 * Each [data-fill] names its key; one the server did not send hides its line,
 * which is how an order placed before delivery fees shows a total and nothing
 * it does not have. textContent, so an area typed as markup arrives as text. */
function fill(breakdown?: Record<string, string | number>): void {
  for (const slot of qa("[data-fill]")) {
    const value = breakdown?.[slot.dataset.fill!];
    const { pre = "", post = "" } = slot.dataset;
    /* A number is one of the promo figures, which the server sends raw. The
     * markup says how each is dressed (data-pre="KSh ", data-post="%"), so no
     * formatting rule about a particular key lives in here. */
    slot.textContent = typeof value === "number" ? pre + value.toLocaleString("en-KE") + post : (value ?? "");
    /* Missing hides the row; zero does not. A recorded discount of 0 is a fact
     * the order has, and an order that lacks the key is one that never had it. */
    slot.parentElement!.hidden = value == null;
  }
}

/* ---------- the nav count ----------
 *
 * Present on every page, because a count that is live on two page types and
 * silent on the rest says nothing on the pages where the buyer is browsing.
 * Hidden entirely at zero: an empty indicator on a first visit is noise
 * advertising a feature they have not used.
 *
 * It server-renders hidden, so a browser with JavaScript off never sees a count
 * of zero standing in for a count it cannot compute. */
const countLink = q("[data-order-count]");
const countValue = q("[data-order-units]");

function paintCount(): void {
  if (!countLink || !countValue) return;
  const total = units(order);
  countValue.textContent = `${total}`;
  countLink.hidden = !total;
}

/* ---------- the product page ---------- */

const addButton = q("[data-add]");
const addedNote = q("[data-added]");
const addedCount = q("[data-added-count]");

function paintAdded(): void {
  if (!addButton || !addedNote || !addedCount) return;
  const qty = order[addButton.dataset.slug ?? ""] ?? 0;
  addedNote.hidden = !qty;
  addedCount.textContent = `${qty}`;
  /* The verb is kept through the flow. CLAUDE.md: "Add to order" becomes
   * "Added to order" — never "In cart", never a tick. */
  addButton.textContent = qty ? "Added to order" : "Add to order";
}

if (addButton) {
  on(addButton, "click", (event) => {
    /* THE CHECK. aria-disabled does not prevent activation — it is a label for
     * assistive technology, not a behaviour — and pointer-events: none is gone
     * from this codebase deliberately, because it suppressed the not-allowed
     * cursor while leaving the keyboard path wide open. Without this branch a
     * disabled "Add to order" adds to the order, on click and on Enter. */
    if (isOff(addButton)) {
      event.preventDefault();
      return;
    }
    const slug = addButton.dataset.slug;
    if (!slug) return;

    /* Courtesy clamp — see ceiling(). At the limit this does nothing rather
       than adding a unit that checkout would refuse. */
    const next = (order[slug] ?? 0) + 1;
    if (next > ceiling(addButton.dataset.stock)) return;

    order[slug] = next;
    write(order);
    paintCount();
    paintAdded();
  });
}

/* ---------- the order page ----------
 *
 * Every product in the catalogue renders as a hidden line at build time and is
 * revealed when it is in the order. Nothing is templated in the browser: no
 * innerHTML, no string-built markup, no product name or price crossing out of
 * storage into the DOM. The only values this script writes are numbers it
 * computed and text the page itself handed it. */
/* Looked up before the painters are defined, because paintOrder() below
 * branches on whether this page is the confirmation screen. Which painter owns
 * the [data-line] rows is a property of the page, so it is settled once, here,
 * rather than inferred at each call. */
const received = q("[data-received]");
const receivedNone = q("[data-received-none]");

const lines = qa("[data-line]");
const emptyState = q("[data-order-empty]");
const liveState = q("[data-order-live]");
const totalValue = q("[data-order-total]");
const blockedNote = q("[data-order-blocked]");
const checkout = q("[data-checkout]");

/* The county <select> on /checkout. The fee preview is read off the chosen
 * option's data-fee — rendered from site.json at build time, the same way a
 * line's price is — and never out of storage. /order-received has no copy: it
 * shows the fee the order recorded, from /api/mpesa/status. */
const county = q<HTMLSelectElement>("[name=county]");

/* A promo code the server has just priced for THIS order, held for the life of
 * the page and never written anywhere: not to the order key, not to the placed
 * snapshot. Every number in it came back from /api/promo/check, and the code is
 * the text in the field. `itemsSubtotal` is the server's own, so the figures on
 * screen are the ones it computed even if this page's catalogue has aged.
 * Cleared on any edit to the field (below), and by a refusal from the push. */
let promo: { code: string; percent: number; itemsSubtotal: number; discountKsh: number } | null = null;
const promoRow = q("[data-promo]");

/* Which answer may still be applied. Bumped when Apply starts, on every edit to
 * the field, and when the push refuses the code; a response applies only if it
 * still holds the value it was sent with. One number covers the answer that
 * arrives after the field changed and the answer that arrives after the push
 * has already said the code is no good. */
let seq = 0;

/* Read once, before anything can strip it. A blocked checkout drops its href
 * rather than leaning on aria-disabled to stop navigation — the rule
 * Button.astro already encodes for the build-time case, applied at runtime. */
const checkoutHref = checkout?.getAttribute("href");

const text = (selector: string, value: string, root: ParentNode = document): void => {
  const node = q(selector, root);
  if (node) node.textContent = value;
};

/* A list of {slug, qty} into the map the painters take. Both callers get one
 * off a wire or a disk they do not control — the confirmation screen from local
 * storage, the tracking page from a response — so both validate, and validating
 * in one place is what stops the looser of the two drifting. */
const toOrder = (items: { slug: string; qty: number }[] | undefined): Order => {
  const out: Order = {};
  for (const item of items ?? []) {
    if (typeof item.slug === "string" && Number.isInteger(item.qty)) out[item.slug] = item.qty;
  }
  return out;
};

/* Reveals the lines named in `quantities`, writes each one's quantity and
 * amount and the order total, and hands back the lines it revealed.
 *
 * Both painters want exactly this and then one thing each — /order wants the
 * first sold-out line, /order-received wants the longest lead time — so the
 * shared half is written once and each caller walks the revealed lines for its
 * own. Two copies of this loop is how a receipt and the page that produced it
 * come to disagree about what a line costs, and that is the disagreement on
 * this site that would cost the most. */
function paintLines(quantities: Order): HTMLElement[] {
  /* Matches price() in src/lib/products.ts. Integer KSh in the data, formatted
   * only at the edge, and the same locale on both sides so a line total and the
   * unit price above it can never disagree about how a thousand is punctuated.
   * Only this function formats money, so it lives here. */
  const money = (value: number): string => `KSh ${value.toLocaleString("en-KE")}`;

  let total = 0;

  for (const line of lines) {
    const qty = quantities[line.dataset.slug ?? ""] ?? 0;
    line.hidden = !qty;
    if (!qty) continue;

    const sum = Number(line.dataset.price) * qty;
    total += sum;
    text("[data-qty]", `${qty}`, line);
    text("[data-line-total]", money(sum), line);
  }

  if (promo) total = promo.itemsSubtotal;
  if (totalValue) totalValue.textContent = money(total);
  if (promoRow) {
    promoRow.hidden = !promo;
    if (promo) {
      text("[data-promo-label]", `${promo.code} — ${promo.percent}% off`, promoRow);
      text("[data-promo-off]", money(promo.discountKsh), promoRow);
    }
  }

  /* DELIVERY, AS A PREVIEW. Only once a county is chosen — the placeholder
   * option carries no data-fee — so the page never shows a total that is
   * missing its fee; until then the Delivery and Total lines keep the page's
   * own "Choose a county". The fee charged is recomputed by the server from
   * the county key, never read from here. Free is written as Free. */
  const fee = county?.selectedOptions[0]?.dataset.fee;
  if (fee) {
    /* Delivery is added AFTER the discount and never discounted, the same order
     * the push computes it in. */
    const due = money(total - (promo?.discountKsh ?? 0) + +fee);
    text("[data-order-fee]", +fee ? money(+fee) : "Free");
    text("[data-order-due]", due);
    /* Not while a submit is in flight: the button is saying "Sending the
     * payment prompt" then, and send() restores the label it captured, so the
     * submit handler repaints after every restore instead (below). Without
     * both halves, a county changed mid-request left the button promising the
     * old total next to a summary showing the new one. */
    if (submitButton && !isOff(submitButton)) {
      submitButton.textContent = `${submitButton.dataset.pay} — ${due}`;
    }
  }
  return lines.filter((line) => !line.hidden);
}

function paintOrder(): void {
  if (!lines.length) return;

  /* ONLY THE PAGES THAT SHOW THE LIVE ORDER. Three other screens now render the
   * same [data-line] rows and fill them from somewhere else: /order-received
   * from the snapshot taken at submit, /track from what the server returned.
   * Letting this painter loose on those walks every line back to whatever is in
   * the cart right now — zero on the confirmation screen, because the order was
   * cleared when it was placed, and somebody else's basket on a tracked order.
   *
   * The guard is the presence of the live-order UI rather than a list of pages
   * to skip, so a fourth screen composing these rows is excluded by default
   * instead of by remembering to add it here. Same direction of failure as
   * Docket's `detail` prop: opting in is the loud thing. */
  if (!liveState && !emptyState) return;

  /* The first sold-out line only. Naming one product is a specific
   * instruction; listing three is a wall to parse before they can act. */
  const soldOut = paintLines(order).find((line) => Number(line.dataset.stock) === 0);
  const blocked = soldOut ? (soldOut.dataset.name ?? soldOut.dataset.slug ?? "") : null;

  const empty = !units(order);
  if (emptyState) emptyState.hidden = !empty;
  if (liveState) liveState.hidden = empty;

  if (blockedNote) blockedNote.hidden = blocked === null;
  if (blocked !== null) {
    say(
      blockedNote,
      `${blocked} is sold out, so this order cannot be sent. Remove it to continue with the rest.`
    );
  }

  if (checkout) {
    attr(checkout, OFF, blocked === null ? null : "true");
    attr(checkout, "aria-describedby", blocked === null ? null : "order-blocked");
    attr(checkout, "href", blocked === null ? checkoutHref : null);
  }
}

/* A slug that is no longer in the catalogue is dropped here and nowhere else,
 * because this is the only page that knows the whole catalogue. Left in place it
 * would hold the nav count above the number of lines the order page can show,
 * which is the count quietly lying. */
if (lines.length) {
  const known = new Set(lines.map((line) => line.dataset.slug));
  for (const slug of Object.keys(order)) {
    if (!known.has(slug)) {
      delete order[slug];
      write(order);
    }
  }

  for (const line of lines) {
    const slug = line.dataset.slug ?? "";

    const step = (by: number) => {
      const current = order[slug] ?? 0;

      /* Courtesy clamp — see ceiling(). It refuses an increase past what is in
       * stock and NEVER LOWERS WHAT IS ALREADY THERE. A line that sold out
       * while it sat in the order, or one already above stock, stays visible at
       * the quantity the buyer chose and is blocked by the order page and named
       * by the server. Trimming it to fit would be silently dropping part of an
       * order, which is the one thing this must not do. Going down is always
       * allowed: that is the buyer removing the problem themselves. */
      const capped =
        by > 0 && current + by > ceiling(line.dataset.stock) ? current : current + by;

      if (capped < 1) delete order[slug];
      else order[slug] = capped;
      write(order);
      paintCount();
      paintOrder();
    };

    const down = q("[data-qty-down]", line);
    const up = q("[data-qty-up]", line);
    const remove = q("[data-remove]", line);

    on(down, "click", () => step(-1));
    on(up, "click", () => step(1));
    on(remove, "click", () => {
      delete order[slug];
      write(order);
      paintCount();
      paintOrder();
    });
  }

  on(county, "change", paintOrder);
  on(q("[data-clear]"), "click", () => {
    order = {};
    write(order);
    paintCount();
    paintOrder();
  });
}

/* ---------- checkout ----------
 *
 * The form posts slugs and quantities. IT DOES NOT POST A PRICE, and the
 * endpoint has no field to read one from — a client that can set its own price
 * sets it to zero. Every figure the buyer is charged is computed server-side
 * from our own catalogue.
 *
 * The summary on this page is painted by paintOrder() above, because /checkout
 * carries the same [data-line] rows as /order. One painter, both pages.
 */

/* What the buyer has ordered, as the list of slug and quantity every endpoint here
 * is sent. Nothing else about an item is ever on this side of the wire. */
const basket = () => Object.entries(order).map(([slug, qty]) => ({ slug, qty }));

const form = q<HTMLFormElement>("[data-checkout-form]");
const submitButton = q("[data-checkout-submit]");
const formError = q("[data-checkout-error]");

/* What was ordered, kept only so the confirmation screen can show it after the
 * order itself has been cleared. Slug and quantity, exactly like the order — no
 * name, no price, no stock. The amount on that screen is looked up from the
 * catalogue rendered into the page, never read back out of storage. */
const PLACED = "momentaura.placed.v1";

/* The shape stk.js mints, checked before the value is put on the screen.
 *
 * CLAUDE.md's storage rule ends "nothing crosses out of storage into the DOM:
 * the only values the script writes are numbers it computed and text the page
 * itself handed it". The reference is the one value step 8 adds to that
 * crossing — it is minted by the server, kept on the buyer's own disk, and
 * read back as text. textContent cannot inject markup, so the exposure is not
 * an injection one; the point of the test is that what gets displayed under
 * the words "your order reference" is proved to BE a reference rather than
 * whatever else ended up in that key. A snapshot that fails it is discarded
 * whole, the same way read() drops a quantity that is not an integer. */
const REFERENCE = /^MA-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/* CheckoutRequestID has no fixed shape in Daraja's own docs beyond "a string",
 * so this is a sanity floor rather than a format check: non-empty, and short
 * enough that nothing absurd ends up round-tripped into a fetch body. */
const isCheckoutRequestId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length < 100;

/* Put a message where the buyer will see it, and reveal it. Three sites wrote
 * these two lines out: the dropped connection inside send(), and each form's
 * own failure path. */
const say = (slot: HTMLElement | null, message: string) => {
  if (slot) {
    slot.textContent = message;
    slot.hidden = false;
  }
};

/* Sets or clears the message under one field. When there is a message it also
 * moves focus there, because the two callers wanted exactly that and each was
 * looking the same input up a second time to do it — the correction and the
 * caret belong together anyway: a message under a field the buyer has scrolled
 * past is a form that looks like it did nothing. */
const setFieldError = (field: string, message: string | null) => {
  const input = q(`[data-field="${field}"]`);
  const slot = q(`[data-field-error="${field}"]`);
  if (slot) {
    slot.textContent = message ?? "";
    slot.hidden = message === null;
  }
  if (input) {
    if (message === null) input.removeAttribute("aria-invalid");
    else {
      input.setAttribute("aria-invalid", "true");
      input.focus();
    }
  }
};

/* Both forms clear the same way: every field message off, then every message
 * the page marks data-msg (the line above the button and the dropped-connection
 * notes). Every one on the page rather than a list per form — each page carries
 * its own, and a list is a second place to forget a new one. Hidden only, never
 * blanked: a slot's own wording lives in its markup. */
const clearErrors = () => {
  for (const field of qa("[data-field-error]")) setFieldError(field.dataset.fieldError!, null);
  for (const note of qa("[data-msg]")) note.hidden = true;
};

/* The two forms on this site do the same five things around one fetch: refuse a
 * second tap, say what is happening on the button, post JSON, read JSON back,
 * and put the connection failure somewhere the buyer can read it. Written twice
 * that is most of a kilobyte of the script budget spent saying the same thing,
 * and two places for a retry rule to drift apart.
 *
 * It does NOT restore the button on success. /checkout navigates away, and a
 * button that becomes live again while the page is still leaving is a second
 * checkout one impatient tap later. The caller restores when it stays put. */
type Sent = { status: number; body: Record<string, unknown>; restore: () => void };

/* The one way this script posts: JSON out, and the caller reads JSON back. */
const post = (url: string, payload: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

async function send(
  button: HTMLElement,
  busy: string,
  url: string,
  payload: unknown,
  slot: HTMLElement | null
): Promise<Sent | null> {
  const label = button.textContent;
  attr(button, OFF, "true");
  button.textContent = busy;

  const restore = () => {
    attr(button, OFF, null);
    button.textContent = label;
  };

  try {
    const response = await post(url, payload);
    return { status: response.status, body: await response.json(), restore };
  } catch {
    /* The connection, not the far end. Which one it was matters: "the payment
     * failed" would be a claim about the buyer's money we are not in a position
     * to make. */
    restore();
    /* The sentence is the page's: data-dropped on the slot, written in the
     * template with the shop number, the way every other message here carries
     * one. This only reveals it. */
    say(slot, slot?.dataset.dropped ?? "");
    return null;
  }
}

if (form && submitButton) {
  on(form, "submit", async (event) => {
    event.preventDefault();
    if (isOff(submitButton)) return;

    clearErrors();

    const items = basket();
    if (!items.length) return;

    const sent = await send(
      submitButton,
      "Sending the payment prompt",
      "/api/mpesa/stk",
      /* Every field the form has — name, phone, email, county, area, landmark
       * — by name, plus the items. No price and no fee: the server reads neither
       * and the form has no field for either. */
      { items, ...Object.fromEntries(new FormData(form)) },
      formError
    );
    /* send() has already restored the label it captured; repaint so the
     * button states the total for the county chosen now. */
    if (!sent) return paintOrder();

    const body = sent.body as {
      message?: string;
      field?: string;
      reference?: string;
      checkoutRequestId?: string;
    };

    /* AN STK PROMPT IS NOT A PAYMENT, and this branch does not claim one. A 200
     * here means Daraja accepted the push and the buyer's phone is about to
     * ring — /order-received is what polls for what actually happened. */
    if (sent.status === 200 && body.reference && isCheckoutRequestId(body.checkoutRequestId)) {
      /* Snapshot, then clear, then leave — in that order. If the tab dies
       * part-way the buyer keeps their order rather than losing it to a
       * confirmation screen that never rendered. */
      try {
        localStorage.setItem(
          PLACED,
          JSON.stringify({
            reference: body.reference,
            checkoutRequestId: body.checkoutRequestId,
            items,
            at: Date.now(),
          })
        );
      } catch {
        /* Storage refused. The order still goes through; only the local copy of
         * the receipt is lost, and the reference comes back in the URL. */
      }
      order = {};
      write(order);
      location.href = `/order-received/?ref=${encodeURIComponent(body.reference)}`;
      return;
    }

    if (body.field === "promo") {
      promo = null;
      seq++;
    }
    sent.restore();
    paintOrder();

    const message = body.message ?? formError!.dataset.fallback!;
    if (body.field && body.field !== "items") {
      setFieldError(body.field, message);
    } else say(formError, message);
  });
}

/* ---------- the promo field ----------
 *
 * ADVISORY. /api/promo/check says what the code would take off; the push judges
 * it again and its answer is final. This paints what the check returned and
 * computes nothing of its own beyond the subtraction in paintLines().
 *
 * ENTER APPLIES. Left alone, Enter in this field would submit the whole form,
 * and that sends the M-Pesa prompt: someone typing a code and pressing Go would
 * be asking for a payment they had not yet seen the total of. */
const promoField = q<HTMLInputElement>("[name=promo]");
const promoApply = q("[data-promo-apply]");
const promoNote = q("[data-promo-note]");

if (promoField && promoApply) {
  const apply = async () => {
    const code = promoField.value.trim();
    if (!code || isOff(promoApply)) return;

    clearErrors();
    const mine = ++seq;
    const sent = await send(
      promoApply,
      "Checking the code",
      "/api/promo/check",
      { promo: code, lines: basket() },
      promoNote
    );
    if (!sent) return;
    sent.restore();

    /* Superseded: the field changed, or the push refused the code, while this
     * was on its way. */
    if (mine !== seq) return;

    /* A refusal removes whatever was previewed BEFORE the message goes up: a
     * code that has just been refused must not leave its discount on screen. */
    const body = sent.body as NonNullable<typeof promo> & { ok?: boolean; message?: string };
    promo = body.ok ? { ...body, code } : null;
    paintOrder();
    if (!body.ok) setFieldError("promo", body.message ?? null);
  };

  on(promoApply, "click", apply);
  on(promoField, "keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    }
  });
  /* Any edit makes the preview stale, and so does the message about the last
   * answer. */
  on(promoField, "input", () => {
    promo = null;
    seq++;
    setFieldError("promo", null);
    paintOrder();
  });
}

/* ---------- tracking an order ----------
 *
 * Reference plus phone, no account. The server decides whether those two match
 * an order; this only asks and paints the answer.
 *
 * NONE OF THE PROSE IS HERE. The four outcomes are written into track.astro as
 * hidden blocks and this reveals the one the server named, so the copy stays
 * reviewable in the file it belongs to and the script carries a status word
 * rather than four paragraphs. It also keeps the rule that nothing crosses from
 * a response into the DOM as markup: the status picks a selector, it is never
 * written into the page.
 */

const trackForm = q<HTMLFormElement>("[data-track-form]");
const trackButton = q("[data-track-submit]");
const trackError = q("[data-track-error]");
const trackResult = q("[data-track-result]");

if (trackForm && trackButton && trackResult) {
  on(trackForm, "submit", async (event) => {
    event.preventDefault();
    if (isOff(trackButton)) return;

    /* Every outcome goes, not just the result block. Not found sits outside it,
     * so hiding only the result leaves the last answer on screen underneath a
     * connection error — a buyer reading "that order cannot be found" about an
     * attempt that never reached the server. */
    clearErrors();
    trackResult.hidden = true;
    showStatus("");

    const sent = await send(
      trackButton,
      "Looking for the order",
      "/api/track",
      /* The form's own fields by name — reference and phone, which are the
       * two names the endpoint reads. */
      Object.fromEntries(new FormData(trackForm)),
      trackError
    );
    if (!sent) return;

    sent.restore();

    const body = sent.body as {
      status?: string;
      reference?: string;
      dispatchDate?: string;
      items?: { slug: string; qty: number }[];
      breakdown?: Record<string, string>;
      message?: string;
      field?: string;
    };

    /* Not found is an OUTCOME, not an error. It is one more entry in the same
     * [data-status] set the page already carries, so the loop below reveals it
     * with no extra code — and because the prose lives on the page rather than
     * in the response, it can hold a real link to the contact page, which a
     * message written into textContent could never do. */
    const outcome =
      sent.status === 200 && body.reference && body.status
        ? body.status
        : sent.status === 404
          ? "notfound"
          : null;

    if (outcome === null) {
      /* A 400 the buyer can fix, or a 503 they cannot. Both belong above the
       * button, except the two fields they typed themselves — which the server
       * names by the same names the form uses, so no translation is needed. */
      const message = body.message ?? trackError!.dataset.fallback!;
      if (body.field) setFieldError(body.field, message);
      else say(trackError, message);
      return;
    }

    /* One of the set, and only one. Hiding them all first (above) means an
       outcome this script does not recognise shows nothing rather than the
       last one. */
    showStatus(outcome);

    if (outcome === "notfound") return;

    text("[data-track-ref]", body.reference ?? "");

    /* Absent unless the server sent one, and it arrives already formatted —
     * a date is a commitment and the server is what knows the lead times. */
    const dateLine = q("[data-track-date]");
    if (dateLine) {
      dateLine.hidden = !body.dispatchDate;
      text("[data-track-date-value]", body.dispatchDate ?? "", dateLine);
    }

    paintLines(toOrder(body.items));

    /* County, area, subtotal, delivery and total. */
    fill(body.breakdown);

    trackResult.hidden = false;
  });
}

/* ---------- the confirmation screen ----------
 *
 * Renders from the snapshot taken at submit, matched against the reference the
 * STK push sent us back with. It does not claim the payment succeeded on its
 * own: CLAUDE.md is explicit that only a callback or a status query marks an
 * order paid, so this page starts on "pending" and polls /api/mpesa/status —
 * the same endpoint the server-side grace window and idempotent settle() logic
 * already cover — until the answer is paid or failed, or polling gives up.
 */

/* 4s between polls, giving up past 8 minutes — well past CALLBACK_GRACE_MS
 * (90s) on the server. A phone that has not been unlocked yet, or a slow
 * network, is not unusual in the first minute or two, and giving up early
 * would send a buyer who is still mid-PIN-entry off to /track with nothing
 * there to find. Inlined rather than named: each is read at its one call site
 * below, and the comment above is the budget this file can afford to spend
 * explaining two numbers that would otherwise cost two more identifiers. */

/* Fire-and-forget, deliberately: nothing here blocks paint, and a network drop
 * just tries again on the next interval rather than surfacing a connection
 * error over a payment that may still be going through. */
function pollPaymentStatus(checkoutRequestId: string, reference: string, startedAt: number): void {
  const retry = () =>
    Date.now() - startedAt >= 480_000
      ? showStatus("stalled")
      : setTimeout(() => pollPaymentStatus(checkoutRequestId, reference, startedAt), 4_000);

  post("/api/mpesa/status", { checkoutRequestId, reference })
    .then((r) => r.json())
    .then((b: { status?: string; breakdown?: Record<string, string> }) => {
      /* Only an answer that proved the order — a 404 carries no status and
       * must not blank the Total line's fallback wording. */
      if (b.status) fill(b.breakdown);
      b.status && b.status !== "pending" ? showStatus(b.status === "paid" ? "paid" : "failed") : retry();
    })
    .catch(retry);
}


/* Working days from today. Saturday and Sunday are not dispatch days, and a
 * duration on this screen would ask the buyer to do the arithmetic themselves
 * at the moment they are deciding whether to trust us. Public holidays are not
 * modelled: that needs a real calendar, and a date quietly wrong twice a year is
 * worse than one honest about counting working days only. */
function workingDaysFrom(start: Date, days: number): Date {
  const date = new Date(+start);
  for (let left = days; left > 0; ) {
    date.setDate(date.getDate() + 1);
    /* getDay() % 6 is 0 for Sunday (0) and Saturday (6), and for no other day. */
    if (date.getDay() % 6) left--;
  }
  return date;
}

function paintReceived(): void {
  if (!received || !receivedNone) return;

  const wanted = new URLSearchParams(location.search).get("ref");

  let snapshot: {
    reference?: string;
    checkoutRequestId?: string;
    items?: { slug: string; qty: number }[];
  } | null = null;
  try {
    const raw = localStorage.getItem(PLACED);
    if (raw) snapshot = JSON.parse(raw);
  } catch {
    snapshot = null;
  }

  const usable =
    snapshot !== null &&
    Array.isArray(snapshot.items) &&
    snapshot.items.length > 0 &&
    typeof snapshot.reference === "string" &&
    REFERENCE.test(snapshot.reference) &&
    isCheckoutRequestId(snapshot.checkoutRequestId) &&
    /* The reference in the URL has to match the one we stored. Without this any
     * ?ref= would render the last order under a stranger's number. */
    (wanted === null || wanted === snapshot.reference);

  if (usable) {
    const placed = toOrder(snapshot!.items);

    text("[data-received-ref]", snapshot!.reference!);

    let longest = 0;
    let everyLineHasLead = true;

    for (const line of paintLines(placed)) {
      const lead = Number(line.dataset.lead);
      if (line.dataset.lead === "" || !Number.isFinite(lead)) everyLineHasLead = false;
      else longest = Math.max(longest, lead);
    }

    /* A DATE, never a duration. Rendered only when every line in the order has a
     * real lead time — one null and the order's arrival is unknown, and the
     * longest of the known ones would be a guess dressed as a commitment. */
    const dateLine = q("[data-received-date]");
    if (everyLineHasLead && longest > 0 && dateLine) {
      text(
        "[data-received-date-value]",
        workingDaysFrom(new Date(), longest).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
        dateLine
      );
      dateLine.hidden = false;
    }

    received.hidden = false;
    receivedNone.hidden = true;

    /* Starts on "pending" — the markup's own default — and polls until Daraja
       has actually answered. isCheckoutRequestId() already proved the field
       above, so this cast is a formality, not a trust boundary. */
    pollPaymentStatus(snapshot!.checkoutRequestId!, snapshot!.reference!, Date.now());
  }
}

/* ---------- start ---------- */

const start = () => {
  paintCount();
  paintAdded();
  paintOrder();
  paintReceived();
};

/* requestIdleCallback where it exists, a zero-delay timer where it does not. */
(self.requestIdleCallback ?? setTimeout)(start);
