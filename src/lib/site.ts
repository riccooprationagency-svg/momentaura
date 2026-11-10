import { existsSync } from "node:fs";
import { join } from "node:path";
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

/* One delivery fee row. THE FEE TABLE EXISTS ONCE, HERE IN site.json, and is
 * read by three things that must never disagree: the /delivery table, the
 * county <select> on /checkout, and functions/api/_site.js, which is what the
 * server prices an order from. The form and the server speak in `key` and never
 * in `name`: a label is copy and can be reworded, a key is a contract.
 *
 * There is no working-day count on a zone. The step 10 shape carried one, and
 * no delivery duration has been supplied for any area, so a field that could
 * only ever hold a guess was removed rather than left waiting for one. */
export interface Zone {
  /** Stable machine key, e.g. "nairobi-cbd". The form posts it; the server prices by it. */
  key: string;
  /** The group it is listed under on /delivery and at checkout, e.g. "Central". */
  region: string;
  /** What a buyer would recognise as their area. */
  name: string;
  /** Integer KSh, per order rather than per item, like every other price in this repo. 0 is free. */
  cost: number;
}

export interface Site {
  /* The origin the site is served from, with scheme and no trailing slash —
   * "https://example.co.ke". It is the one fact here that cannot fail toward an
   * omission on the page alone: canonical URLs, the sitemap and Open Graph are
   * all absolute by specification, so a guessed value would not read as a
   * placeholder, it would read as a claim about where this site lives. A wrong
   * canonical points every page at somebody else's, and a sitemap of off-host
   * URLs is rejected whole. So it is null, and the three things that need it
   * are simply not emitted until it is real. */
  url: string | null;
  /* The path to the Open Graph preview image, rooted at the site — "/og.jpg".
   * A path rather than a URL, so it is made absolute from `url` in one place.
   *
   * Null, and the whole og:image tag is omitted rather than pointed at
   * something. There is no honest candidate today: every product renders light
   * with no photograph, and CLAUDE.md permits no stock, no supplier photo, no
   * AI and no blank mockup presented as a product. A preview card is worth
   * having and a dishonest one is not, so the card is title and description
   * until a real photograph exists. It lands with the photography. */
  ogImage: string | null;
  owner: {
    /** The real name of the person who packs and sends the orders. */
    name: string | null;
    /** A real photograph of that person. No AI, no stock, no avatar. */
    photo: string | null;
    /** The part of Nairobi they work from. Specific enough to be checkable. */
    area: string | null;
  };
  contact: {
    /** A number that rings and is answered, written as a buyer would read it. */
    phone: string | null;
    /** The WhatsApp number, if it is a different one. */
    whatsapp: string | null;
    /** When a person is actually there, e.g. "Mon-Sat, 9am-6pm". */
    hours: string | null;
    email: {
      /** General questions. */
      general: string | null;
      /** Problems with an order already placed. */
      orders: string | null;
    };
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

/* A malformed fee row fails the build rather than reaching a page. The server
 * drops a bad row on its own side as well (functions/api/_site.js), but the
 * table a buyer reads and the select they choose from are built here, and a fee
 * shown on /delivery that checkout then refuses is the same fact told two ways.
 * Same move products.ts makes for a hand-edited photo entry. */
{
  const seen = new Set<string>();
  for (const zone of site.delivery.zones) {
    const where = `site.json delivery.zones "${zone.key}"`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(zone.key)) throw new Error(`${where}: key must be lower-case kebab`);
    if (seen.has(zone.key)) throw new Error(`${where}: duplicate key`);
    seen.add(zone.key);
    if (!known(zone.region) || !known(zone.name)) throw new Error(`${where}: region and name are required`);
    if (!Number.isInteger(zone.cost) || zone.cost < 0) throw new Error(`${where}: cost must be a whole number of KSh, 0 or more`);
  }
}

/** A fee as a buyer reads it. 0 is "Free", never "KSh 0", in a table or a label. */
export const feeText = (cost: number): string => (cost === 0 ? "Free" : `KSh ${cost.toLocaleString("en-KE")}`);

/** The zones grouped by region, in the order site.json lists them. */
export const zonesByRegion = (): { region: string; zones: Zone[] }[] => {
  const groups = new Map<string, Zone[]>();
  for (const zone of site.delivery.zones) {
    groups.set(zone.region, [...(groups.get(zone.region) ?? []), zone]);
  }
  return [...groups].map(([region, zones]) => ({ region, zones }));
};

/** The cheapest zone, for "Delivery from KSh 0 in Nairobi CBD", or null with no zones. */
export const cheapestZone = (): Zone | null =>
  site.delivery.zones.reduce<Zone | null>((low, zone) => (low === null || zone.cost < low.cost ? zone : low), null);

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
    key: "url",
    value: site.url,
    what: "the domain the site is served from, with scheme — https://example.co.ke",
    blocks:
      "the canonical link, Open Graph, sitemap.xml and robots.txt, and therefore " +
      "Search Console, which cannot verify a sitemap it cannot fetch",
  },
  {
    key: "ogImage",
    value: site.ogImage,
    what: "a real photograph for the link preview card, 1200x630",
    blocks:
      "og:image, and with it every WhatsApp, Facebook and X preview of this " +
      "site — which is the first thing most traffic sees of it",
  },
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
      "message in /api/mpesa/stk and /api/mpesa/status",
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
    what: "the delivery fee per county, a whole number of KSh per order",
    blocks:
      "the Delivery page's fee table, the county choice at checkout, and every " +
      "order, because the server prices delivery from this list and refuses a " +
      "county that is not on it",
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

/* A file in public/, by its site-rooted path ("/favicon.ico"), or null when no
   such file exists. Build time only. A <link> or <meta> naming a file that was
   never added is a 404 a browser or a link-preview crawler asks for on every
   page, so these references appear the day the file does and not before. */
export const publicFile = (path: string | null): string | null => {
  if (!known(path)) return null;
  const clean = String(path).trim();
  /* From the project root, not import.meta.url: Astro bundles this module
     into dist/ before running it, so a path relative to the module would
     resolve against the bundle. Builds always run from the root. */
  return existsSync(join(process.cwd(), "public", clean)) ? clean : null;
};

/* The origin, normalised, or null. Trailing slashes are stripped here rather
   than at each of the four call sites, because a sitemap of "//about" URLs is
   the kind of thing that builds clean and is found by a crawler. */
export const origin = (): string | null => {
  if (!known(site.url)) return null;
  return String(site.url).trim().replace(/\/+$/, "");
};

/** An absolute URL for a path, or null while the domain is unknown. */
export const absolute = (path: string): string | null => {
  const base = origin();
  return base === null ? null : `${base}${path}`;
};

/* ---------- reaching a person ----------
 *
 * EVERY tel:, mailto: and wa.me link on the site is built here, from the values
 * above, and nowhere else. The number, the address and the shape of the
 * prefilled WhatsApp text each live in exactly one place, so a changed number
 * is one edit in site.json and a changed campaign format is one edit below.
 *
 * These throw at build time on a missing value rather than returning an empty
 * href. A page that composes a contact link is claiming there is a way to reach
 * a person, and `tel:` with nothing after it is that claim failing silently.
 */

const required = (value: string | null, key: string): string => {
  if (!known(value)) throw new Error(`site.json ${key} is required by a contact link`);
  return String(value).trim();
};

/* A Kenyan mobile number as written locally, "0753 181 901", to its
   international form "+254753181901". Strict, because a malformed number in a
   tel: href dials something else. */
const international = (local: string, key: string): string => {
  const digits = local.replace(/\D/g, "");
  if (!/^0[17]\d{8}$/.test(digits)) {
    throw new Error(`site.json ${key} "${local}" is not a Kenyan mobile number like 0712 345 678`);
  }
  return `+254${digits.slice(1)}`;
};

/** The phone number as a buyer reads it: "0753 181 901". */
export const phoneDisplay = (): string => required(site.contact.phone, "contact.phone");

/** The phone number in E.164: "+254753181901". */
export const phoneE164 = (): string => international(phoneDisplay(), "contact.phone");

export const telHref = (): string => `tel:${phoneE164()}`;

/** The WhatsApp number as a buyer reads it. */
export const whatsappDisplay = (): string => required(site.contact.whatsapp, "contact.whatsapp");

export const email = (which: "general" | "orders"): string =>
  required(site.contact.email[which], `contact.email.${which}`);

/* The address split after "@", for a <wbr> between the halves. At 390px the
   longer address does not fit on one line, and a break the browser picks for
   itself lands mid-domain ("co" / ".ke"), which reads as a different address. */
export const emailParts = (which: "general" | "orders"): [string, string] => {
  const [local, domain] = email(which).split("@");
  return [`${local}@`, domain];
};

export const mailtoHref = (which: "general" | "orders"): string => `mailto:${email(which)}`;

/* Where on the site a conversation started. The code is in the prefilled text,
   visible to the buyer and editable before sending, so it is a label rather
   than a tracker: nothing reaches WhatsApp until they tap, and nothing on this
   site records that they did. */
export type WhatsappSource =
  | "WEB-CONTACT"
  | "WEB-FOOTER"
  | "WEB-DELIVERY"
  | "WEB-ORDER"
  | "WEB-CHECKOUT"
  | "WEB-TRACK";

/**
 * A wa.me link with the campaign code in the prefilled text.
 *
 *   whatsappHref("WEB-FOOTER")
 *     -> "Hi MomentAura — WEB-FOOTER"
 *   whatsappHref({ slug: "crew-tee", name: "Crew tee" })
 *     -> "Hi MomentAura, a question about the Crew tee — WEB-PRODUCT-crew-tee"
 */
export const whatsappHref = (source: WhatsappSource | { slug: string; name: string }): string => {
  const number = international(whatsappDisplay(), "contact.whatsapp").slice(1);
  const text =
    typeof source === "string"
      ? `Hi MomentAura — ${source}`
      : `Hi MomentAura, a question about the ${source.name} — WEB-PRODUCT-${source.slug}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
};

/* The one structured-data block the site emits. Organization and a single
   customer-service contact point, and nothing else: no Product, no Offer, no
   review markup. Every product is sold out and has no photograph, and schema
   that a search engine renders as a rich result is a claim like any other. */
export const organizationLd = () => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "MomentAura",
  /* The same origin the canonical, og:url, sitemap and robots.txt use, so the
     five cannot disagree. Omitted, not required, when site.json `url` is null:
     every other absolute URL on the site omits itself in that mode, and a build
     that threw here would make the domain a precondition for building at all.
     V4's allowlist permits `url` without requiring it. */
  ...(origin() === null ? {} : { url: origin() as string }),
  contactPoint: {
    "@type": "ContactPoint",
    telephone: phoneE164(),
    email: email("general"),
    contactType: "customer service",
    areaServed: "KE",
  },
});

export const GAPS: Gap[] =CANDIDATES.filter((c) => !known(c.value)).map(
  ({ key, what, blocks }) => ({ key, what, blocks })
);
