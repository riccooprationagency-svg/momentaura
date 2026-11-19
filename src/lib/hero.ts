import site from "../data/site.json";
import { products } from "./products";

/* The homepage hero's picture: one group render of existing products, written to
 * site.json "heroImage" by `node scripts/images.mjs --hero` and by nothing else.
 *
 * It is validated here, once, at build, the way products.ts validates photos: it
 * throws on an entry the script would not have produced, on a garment slug that is
 * not in products.json, and on a kind that is not "render". Null is the supported
 * way to have no hero image, and the hero then renders its copy alone.
 *
 * The disclosure line is a constant here and not a field in the data, so no entry
 * can be written without it: Gallery.astro prints HERO_CAPTION beneath the picture
 * every time, and this file refuses a kind that would make the line untrue. */

export const HERO_CAPTION = "Studio render. Not a photograph of the garments.";

/* Must match HERO_WIDTHS in scripts/images.mjs. V14 resolves every URL the page
 * emits against what is in dist/, so a width here that the script never wrote
 * fails the build instead of 404ing at a buyer. */
export const HERO_WIDTHS = [600, 900, 1200];

export const POSITIONS = ["left", "centre", "right", "joggers"] as const;
export type Position = (typeof POSITIONS)[number];

export interface HeroImage {
  src: string;
  alt: string;
  width: number;
  height: number;
  kind: "render";
  garments: { position: Position; slug: string }[];
}

const NAMED = /^\/img\/hero-trio-900\.[0-9a-f]{8}\.webp$/;

const resolve = (): HeroImage | null => {
  const raw = (site as unknown as { heroImage?: unknown }).heroImage;
  if (raw === null || raw === undefined) return null;
  const fail = (why: string): never => {
    throw new Error(`site.json: "heroImage" ${why}. Never hand-edit it; run node scripts/images.mjs --hero.`);
  };
  const h = raw as Partial<HeroImage>;
  if (typeof h !== "object") return fail("must be an object or null");
  if (typeof h.src !== "string" || !NAMED.test(h.src)) {
    fail(`src ${JSON.stringify(h.src)} is not a name the script would have written (/img/hero-trio-900.<hash>.webp)`);
  }
  if (typeof h.alt !== "string" || h.alt.trim() === "") fail("has no alt text");
  if (!Number.isInteger(h.width) || !Number.isInteger(h.height) || h.width! <= 0 || h.height! <= 0) {
    fail("needs whole-number width and height");
  }
  if (h.kind !== "render") {
    fail(`kind is ${JSON.stringify(h.kind)}; the hero picture is a render and carries its disclosure line`);
  }
  if (!Array.isArray(h.garments) || h.garments.map((g) => g.position).join() !== POSITIONS.join()) {
    fail(`garments must be ${POSITIONS.join(", ")}, in that order`);
  }
  for (const g of h.garments!) {
    if (!products.some((p) => p.slug === g.slug)) fail(`garment ${g.position} is "${g.slug}", which is not in products.json`);
  }
  return h as HeroImage;
};

export const heroImage: HeroImage | null = resolve();
