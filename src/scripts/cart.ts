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
    order[slug] = Math.min((order[slug] ?? 0) + 1, MAX_QTY);
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

function paintOrder(): void {
  if (!lines.length) return;

  let total = 0;
  let blocked: string | null = null;

  for (const line of lines) {
    const slug = line.dataset.slug ?? "";
    const qty = order[slug] ?? 0;
    line.hidden = qty === 0;
    if (qty === 0) continue;

    const sum = Number(line.dataset.price) * qty;
    total += sum;
    text(line, "[data-qty]", String(qty));
    text(line, "[data-line-total]", money(sum));

    /* The first sold-out line only. Naming one product is a specific
     * instruction; listing three is a wall to parse before they can act. */
    if (Number(line.dataset.stock) === 0 && blocked === null) {
      blocked = line.dataset.name ?? slug;
    }
  }

  const empty = units(order) === 0;
  if (emptyState) emptyState.hidden = !empty;
  if (liveState) liveState.hidden = empty;
  if (totalValue) totalValue.textContent = money(total);

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
      const next = (order[slug] ?? 0) + by;
      if (next < 1) delete order[slug];
      else order[slug] = Math.min(next, MAX_QTY);
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

/* ---------- start ---------- */

const start = () => {
  paintCount();
  paintAdded();
  paintOrder();
};

if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(start);
else window.setTimeout(start, 0);
