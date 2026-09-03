import data from "../data/site.json";

/* The facts about the shop itself, as opposed to the things it sells.
 *
 * EVERY VALUE HERE IS null UNTIL A REAL ONE EXISTS, and that is the same rule
 * products.json follows: a null renders as an omission or as a stated absence,
 * never as a placeholder and never as a guess. "Nairobi and surrounds, KSh 300"
 * invented to fill a delivery table is the exact dishonesty this whole site is
 * built against — a buyer who is quoted a figure that turns out not to be real
 * has been given a reason to believe the rest of the page is also decorative.
 *
 * Nothing in here can be derived, looked up or reasoned out. Each one is a fact
 * only Ric holds, and each one is listed in GAPS below with the thing it blocks,
 * so the outstanding set is one list rather than a search through five pages.
 *
 * `dispatchFrom` is the exception that proves the rule: it is already true and
 * already stated across the site, because every product in products.json carries
 * dispatch "Nairobi".
 */

export interface Zone {
  /** What a buyer would recognise as their area. */
  name: string;
  /** Integer KSh, like every other price in this repo. */
  cost: number;
  /** Working days from dispatch. Rendered as a date wherever a buyer acts on it. */
  days: number;
}

export interface Site {
  owner: {
    /** The real name of the person who packs and sends the orders. */
    name: string | null;
    /** A real photograph of that person. No AI, no stock, no avatar. */
    photo: string | null;
    /** The part of Nairobi they work from. Specific enough to be checkable. */
    area: string | null;
  };
  contact: {
    /** A number that rings and is answered. */
    phone: string | null;
    /** The WhatsApp number, if it is a different one. */
    whatsapp: string | null;
    /** When a person is actually there, e.g. "Mon-Sat, 9am-6pm". */
    hours: string | null;
  };
  delivery: {
    dispatchFrom: string | null;
    zones: Zone[];
    returnsWindowDays: number | null;
    returnsCondition: string | null;
  };
}

export const site = data as Site;

/** A value is usable only if it is a real one. Empty strings are not. */
export const known = (value: unknown): boolean =>
  typeof value === "number"
    ? Number.isFinite(value)
    : Array.isArray(value)
      ? value.length > 0
      : typeof value === "string" && value.trim() !== "";

/* What is still missing, what it blocks, and who can supply it.
 *
 * Derived from the data rather than written down twice, so this list cannot
 * claim something is present when it is null. The dev-only marker on each page
 * reads from the same source, and BUILD-ORDER section 10 points here rather than
 * keeping its own copy that would drift.
 */
export interface Gap {
  key: string;
  what: string;
  blocks: string;
}

const CANDIDATES: (Gap & { value: unknown })[] = [
  {
    key: "owner.name",
    value: site.owner.name,
    what: "the real name of the person who packs and sends the orders",
    blocks: "the About page's first line, and the byline on Contact",
  },
  {
    key: "owner.photo",
    value: site.owner.photo,
    what: "a real photograph of that person — no AI, no stock, no avatar",
    blocks: "the About page's portrait",
  },
  {
    key: "owner.area",
    value: site.owner.area,
    what: "the part of Nairobi they work from, specific enough to be checkable",
    blocks: "the About page's location line",
  },
  {
    key: "contact.phone",
    value: site.contact.phone,
    what: "a number that rings and is answered",
    blocks:
      "the Contact page, and the phone number CLAUDE.md requires on every error " +
      "message in /api/checkout and /api/mpesa/stk",
  },
  {
    key: "contact.whatsapp",
    value: site.contact.whatsapp,
    what: "the WhatsApp number, if it differs from the phone",
    blocks: "the WhatsApp route on Contact",
  },
  {
    key: "contact.hours",
    value: site.contact.hours,
    what: "when a person is actually there",
    blocks: "the Contact page's hours line",
  },
  {
    key: "delivery.zones",
    value: site.delivery.zones,
    what: "the delivery zones with real costs and real working-day counts",
    blocks: "the Delivery page's zone table, and any delivery cost at checkout",
  },
  {
    key: "delivery.returnsWindowDays",
    value: site.delivery.returnsWindowDays,
    what: "how many days a buyer has to return something",
    blocks: "the Delivery page's returns section",
  },
  {
    key: "delivery.returnsCondition",
    value: site.delivery.returnsCondition,
    what: "what condition a returned item has to be in",
    blocks: "the Delivery page's returns section",
  },
];

export const GAPS: Gap[] = CANDIDATES.filter((c) => !known(c.value)).map(
  ({ key, what, blocks }) => ({ key, what, blocks })
);
