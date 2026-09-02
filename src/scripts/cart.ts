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
 * functions/api/checkout.js re-reads stock from the catalogue and rejects the
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

/* Matches price() in src/lib/products.ts. Integer KSh in the data, formatted
 * only at the edge, and the same locale on both sides so a line total and the
 * unit price above it can never disagree about how a thousand is punctuated. */
const money = (value: number): string => `KSh ${value.toLocaleString("en-KE")}`;

const units = (order: Order): number =>
  Object.values(order).reduce((total, qty) => total + qty, 0);

/* Every read is defensive. This value comes off the buyer's own disk, which
 * means it survives a deploy that renamed a product, an unrelated tab writing
 * the same key, and a person with devtools open. Anything that is not an integer
 * quantity of at least one is dropped rather than repaired. */
function read(): Order {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return {};
  }
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const order: Order = {};
  for (const [slug, qty] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) continue;
    order[slug] = Math.min(qty, MAX_QTY);
  }
  return order;
}

/* Storage can be full or blocked — Safari private browsing throws on write. The
 * page keeps working off the in-memory order; only persistence is lost, and an
 * order that silently fails to persist is a better outcome than a thrown
 * exception taking the quantity steppers down with it. */
function write(order: Order): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(order));
  } catch {
    /* Intentionally empty. See above. */
  }
}

let order = read();

/* ---------- the nav count ----------
 *
 * Present on every page, because a count that is live on two page types and
 * silent on the rest says nothing on the pages where the buyer is browsing.
 * Hidden entirely at zero: an empty indicator on a first visit is noise
 * advertising a feature they have not used.
 *
 * It server-renders hidden, so a browser with JavaScript off never sees a count
 * of zero standing in for a count it cannot compute. */
const countLink = document.querySelector<HTMLElement>("[data-order-count]");
const countValue = document.querySelector<HTMLElement>("[data-order-units]");

function paintCount(): void {
  if (!countLink || !countValue) return;
  const total = units(order);
  countValue.textContent = String(total);
  countLink.hidden = total === 0;
}

/* ---------- the product page ---------- */

const addButton = document.querySelector<HTMLElement>("[data-add]");
const addedNote = document.querySelector<HTMLElement>("[data-added]");
const addedCount = document.querySelector<HTMLElement>("[data-added-count]");

function paintAdded(): void {
  if (!addButton || !addedNote || !addedCount) return;
  const slug = addButton.dataset.slug;
  const qty = slug ? (order[slug] ?? 0) : 0;
  addedNote.hidden = qty === 0;
  addedCount.textContent = String(qty);
  /* The verb is kept through the flow. CLAUDE.md: "Add to order" becomes
   * "Added to order" — never "In cart", never a tick. */
  addButton.textContent = qty === 0 ? "Add to order" : "Added to order";
}

if (addButton) {
  addButton.addEventListener("click", (event) => {
    /* THE CHECK. aria-disabled does not prevent activation — it is a label for
     * assistive technology, not a behaviour — and pointer-events: none is gone
     * from this codebase deliberately, because it suppressed the not-allowed
     * cursor while leaving the keyboard path wide open. Without this branch a
     * disabled "Add to order" adds to the order, on click and on Enter. */
    if (addButton.getAttribute("aria-disabled") === "true") {
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
const received = document.querySelector<HTMLElement>("[data-received]");
const receivedNone = document.querySelector<HTMLElement>("[data-received-none]");

const lines = Array.from(document.querySelectorAll<HTMLElement>("[data-line]"));
const emptyState = document.querySelector<HTMLElement>("[data-order-empty]");
const liveState = document.querySelector<HTMLElement>("[data-order-live]");
const totalValue = document.querySelector<HTMLElement>("[data-order-total]");
const blockedNote = document.querySelector<HTMLElement>("[data-order-blocked]");
const checkout = document.querySelector<HTMLElement>("[data-checkout]");

/* Read once, before anything can strip it. A blocked checkout drops its href
 * rather than leaning on aria-disabled to stop navigation — the rule
 * Button.astro already encodes for the build-time case, applied at runtime. */
const checkoutHref = checkout ? checkout.getAttribute("href") : null;

const text = (root: HTMLElement, selector: string, value: string): void => {
  const node = root.querySelector<HTMLElement>(selector);
  if (node) node.textContent = value;
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
  const shown: HTMLElement[] = [];
  let total = 0;

  for (const line of lines) {
    const qty = quantities[line.dataset.slug ?? ""] ?? 0;
    line.hidden = qty === 0;
    if (qty === 0) continue;

    const sum = Number(line.dataset.price) * qty;
    total += sum;
    text(line, "[data-qty]", String(qty));
    text(line, "[data-line-total]", money(sum));
    shown.push(line);
  }

  if (totalValue) totalValue.textContent = money(total);
  return shown;
}

function paintOrder(): void {
  if (!lines.length) return;

  /* THE RECEIPT OWNS ITS OWN LINES. /order-received renders the same
   * [data-line] rows as /order and /checkout, but it paints them from the
   * snapshot taken at submit — and by the time it is on screen the order
   * itself has been cleared, because the order was placed. Letting this
   * painter also run there walks every line back to a quantity of zero and
   * writes "KSh 0" over the total, blanking the one screen a buyer keeps and
   * screenshots. The two painters share the markup; they must never share a
   * page. */
  if (received) return;

  /* The first sold-out line only. Naming one product is a specific
   * instruction; listing three is a wall to parse before they can act. */
  let blocked: string | null = null;
  for (const line of paintLines(order)) {
    if (Number(line.dataset.stock) === 0 && blocked === null) {
      blocked = line.dataset.name ?? line.dataset.slug ?? "";
    }
  }

  const empty = units(order) === 0;
  if (emptyState) emptyState.hidden = !empty;
  if (liveState) liveState.hidden = empty;

  if (blockedNote) {
    blockedNote.hidden = blocked === null;
    if (blocked !== null) {
      blockedNote.textContent =
        `${blocked} is sold out, so this order cannot be sent. ` +
        "Remove it to continue with the rest.";
    }
  }

  if (checkout) {
    if (blocked === null) {
      checkout.removeAttribute("aria-disabled");
      checkout.removeAttribute("aria-describedby");
      if (checkoutHref !== null) checkout.setAttribute("href", checkoutHref);
    } else {
      checkout.setAttribute("aria-disabled", "true");
      checkout.setAttribute("aria-describedby", "order-blocked");
      checkout.removeAttribute("href");
    }
  }
}

/* A slug that is no longer in the catalogue is dropped here and nowhere else,
 * because this is the only page that knows the whole catalogue. Left in place it
 * would hold the nav count above the number of lines the order page can show,
 * which is the count quietly lying. */
if (lines.length) {
  const known = new Set(lines.map((line) => line.dataset.slug));
  let dropped = false;
  for (const slug of Object.keys(order)) {
    if (!known.has(slug)) {
      delete order[slug];
      dropped = true;
    }
  }
  if (dropped) write(order);

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

    const down = line.querySelector("[data-qty-down]");
    const up = line.querySelector("[data-qty-up]");
    const remove = line.querySelector("[data-remove]");

    if (down) down.addEventListener("click", () => step(-1));
    if (up) up.addEventListener("click", () => step(1));
    if (remove) {
      remove.addEventListener("click", () => {
        delete order[slug];
        write(order);
        paintCount();
        paintOrder();
      });
    }
  }

  const clear = document.querySelector("[data-clear]");
  if (clear) {
    clear.addEventListener("click", () => {
      order = {};
      write(order);
      paintCount();
      paintOrder();
    });
  }
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

const form = document.querySelector<HTMLFormElement>("[data-checkout-form]");
const submitButton = document.querySelector<HTMLElement>("[data-checkout-submit]");
const formError = document.querySelector<HTMLElement>("[data-checkout-error]");

/* What was ordered, kept only so the confirmation screen can show it after the
 * order itself has been cleared. Slug and quantity, exactly like the order — no
 * name, no price, no stock. The amount on that screen is looked up from the
 * catalogue rendered into the page, never read back out of storage. */
const PLACED = "momentaura.placed.v1";

/* The shape checkout.js mints, checked before the value is put on the screen.
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

const setFieldError = (field: string, message: string | null) => {
  const input = document.querySelector<HTMLElement>(`[data-field="${field}"]`);
  const slot = document.querySelector<HTMLElement>(`[data-field-error="${field}"]`);
  if (slot) {
    slot.textContent = message ?? "";
    slot.hidden = message === null;
  }
  if (input) {
    if (message === null) input.removeAttribute("aria-invalid");
    else input.setAttribute("aria-invalid", "true");
  }
};

const clearErrors = () => {
  for (const field of ["name", "phone", "email"]) setFieldError(field, null);
  if (formError) {
    formError.textContent = "";
    formError.hidden = true;
  }
};

if (form && submitButton) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitButton.getAttribute("aria-disabled") === "true") return;

    clearErrors();

    const data = new FormData(form);
    const items = Object.entries(order).map(([slug, qty]) => ({ slug, qty }));
    if (!items.length) return;

    /* Disabled while the request is out, so a second tap cannot open a second
     * checkout. The label says what is happening rather than spinning. */
    const label = submitButton.textContent;
    submitButton.setAttribute("aria-disabled", "true");
    submitButton.textContent = "Contacting the payment page";

    const restore = () => {
      submitButton.removeAttribute("aria-disabled");
      submitButton.textContent = label;
    };

    let response: Response;
    let body: { url?: string; message?: string; field?: string; reference?: string };

    try {
      response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          name: data.get("name"),
          phone: data.get("phone"),
          email: data.get("email"),
        }),
      });
      body = await response.json();
    } catch {
      /* The connection, not the gateway. Says which, because "the payment
       * failed" would be a claim about the buyer's money we cannot make. */
      restore();
      if (formError) {
        formError.textContent =
          "The connection dropped before the payment page could be reached. " +
          "Nothing has been charged. Check your connection and try again.";
        formError.hidden = false;
      }
      return;
    }

    if (response.ok && body.url && body.reference) {
      /* Snapshot, then clear, then leave — in that order. If the tab dies
       * part-way the buyer keeps their order rather than losing it to a
       * confirmation screen that never rendered. */
      try {
        window.localStorage.setItem(
          PLACED,
          JSON.stringify({ reference: body.reference, items, at: Date.now() })
        );
      } catch {
        /* Storage refused. The order still goes through; only the local copy of
         * the receipt is lost, and the reference comes back in the URL. */
      }
      order = {};
      write(order);
      /* The gateway's hosted page. Its host was checked server-side before this
       * URL was handed to us. */
      window.location.href = body.url;
      return;
    }

    restore();

    const message = body.message ?? "That did not go through. Nothing has been charged.";
    if (body.field && body.field !== "items") {
      setFieldError(body.field, message);
      const input = document.querySelector<HTMLElement>(`[data-field="${body.field}"]`);
      if (input) input.focus();
    } else if (formError) {
      formError.textContent = message;
      formError.hidden = false;
    }
  });
}

/* ---------- the confirmation screen ----------
 *
 * Renders from the snapshot taken at submit, matched against the reference the
 * gateway sent us back with. It does not claim the payment succeeded: a redirect
 * is a URL and anyone can type it, and CLAUDE.md is explicit that only a
 * callback or a status query marks an order paid. Step 9 supplies that.
 */


/* Working days from today. Saturday and Sunday are not dispatch days, and a
 * duration on this screen would ask the buyer to do the arithmetic themselves
 * at the moment they are deciding whether to trust us. Public holidays are not
 * modelled: that needs a real calendar, and a date quietly wrong twice a year is
 * worse than one honest about counting working days only. */
function workingDaysFrom(start: Date, days: number): Date {
  const date = new Date(start.getTime());
  let left = days;
  while (left > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return date;
}

const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

function paintReceived(): void {
  if (!received || !receivedNone) return;

  const wanted = new URLSearchParams(window.location.search).get("ref");

  let snapshot: { reference?: string; items?: { slug: string; qty: number }[] } | null = null;
  try {
    const raw = window.localStorage.getItem(PLACED);
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
    /* The reference in the URL has to match the one we stored. Without this any
     * ?ref= would render the last order under a stranger's number. */
    (wanted === null || wanted === snapshot.reference);

  if (usable && snapshot && snapshot.items) {
    const placed: Order = {};
    for (const item of snapshot.items) placed[item.slug] = item.qty;

    const refSlot = document.querySelector<HTMLElement>("[data-received-ref]");
    if (refSlot) refSlot.textContent = snapshot.reference ?? "";

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
    const dateLine = document.querySelector<HTMLElement>("[data-received-date]");
    const dateValue = document.querySelector<HTMLElement>("[data-received-date-value]");
    const noDate = document.querySelector<HTMLElement>("[data-received-nodate]");
    if (everyLineHasLead && longest > 0 && dateLine && dateValue && noDate) {
      dateValue.textContent = LONG_DATE.format(workingDaysFrom(new Date(), longest));
      dateLine.hidden = false;
      noDate.hidden = true;
    }

    received.hidden = false;
    receivedNone.hidden = true;
  }
}

/* ---------- start ---------- */

const start = () => {
  paintCount();
  paintAdded();
  paintOrder();
  paintReceived();
};

if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(start);
else window.setTimeout(start, 0);
