#!/usr/bin/env node
/* Product photography, from a file on somebody's disk to something the site can
 * serve. Run by hand, when a shoot lands. Never part of `npm run build`.
 *
 *   node scripts/images.mjs <slug> <source> <alt> [<source> <alt> ...]
 *
 *   node scripts/images.mjs crew-tee \
 *     "D:/shoot/2026-09/crew-tee-front.CR3" "Crew tee laid flat, front" \
 *     "D:/shoot/2026-09/crew-tee-label.CR3" "Neck label and size tab"
 *
 * It emits AVIF and WebP at 400, 800 and 1200 wide into public/img/, reads the
 * real pixel dimensions back off the encoded files, and writes the photos array
 * into src/data/products.json. Nothing about that array is ever hand-edited:
 * src/lib/products.ts throws at build time on an entry this script would not
 * have produced.
 *
 * WHY THE SOURCES LIVE OUTSIDE THE REPO. .gitignore says it, and it is not
 * tidiness: several images that have passed through assets-source/ are other
 * companies' product photography, and CLAUDE.md bans supplier photos and
 * third-party trademarks in imagery outright. Raw frames are also large,
 * unlicensed until they are ours, and version control is the wrong place for
 * either problem. What enters the repo is the finished rendition, at our crop,
 * of a photograph we took.
 *
 * ---------- sharp, and what V1 gave up to allow it ----------
 *
 * sharp is a devDependency, pinned to an exact version, and V1 in verify.mjs was
 * widened from an absence to a one-name allow-list to permit it. That widening
 * is a cost. The full argument — the three options, what this one bought and
 * what it cost — lives at V1 and in BUILD-ORDER section 12, not here, because
 * that is where the next person adding a name will be reading.
 *
 * The short version: it was declared rather than borrowed. Astro carries sharp
 * in its own optionalDependencies, so importing it undeclared would have worked
 * today and cost nothing in package.json — while leaving V1 printing "astro and
 * nothing else" over a build that depended on a package nothing here names, that
 * Astro chose the version of, and that `optional` means an install may skip
 * entirely. A gate confident about something it cannot see is the failure V3, V9
 * and V11 each exist to correct. This is not the fourth.
 *
 * The pin is why RECIPE below does not have to record an encoder version: the
 * encoder is fixed at 0.35.4 until someone changes it in package.json on
 * purpose, and V1 fails if the declaration is a range. Change the pin and the
 * bytes change, so change RECIPE with it.
 *
 * NOTHING ON THE SITE NEEDS SHARP. The renditions are committed to public/img/,
 * `npm run build` never imports this file, and a deploy from a tree installed
 * with --omit=dev builds and ships byte-identical output. If this script breaks
 * it breaks here, at a keyboard, with someone reading the error.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "img");
const CATALOGUE = join(ROOT, "src", "data", "products.json");

/* ---------- the recipe ----------
 *
 * One crop, three widths, two formats, across every product. CLAUDE.md fixes
 * the crop at 3:4 and the format at WebP; AVIF is the same picture at roughly
 * two thirds the bytes for every browser that can read it, and the WebP stays
 * as the one an <img> falls back to.
 *
 * Three widths and not five. 400 is a card in a three-column grid, 800 is the
 * object column on a product page, 1200 is that column on a wide screen at 2x.
 * A fourth breakpoint is another file per photograph per format on a site whose
 * homepage budget is 500KB, and no layout on this site asks for one.
 *
 * The qualities are measured, not guessed: at these settings a detailed 1200px
 * frame lands well inside the 200KB ceiling verify.mjs V14 enforces, and V14 is
 * what catches it if a future source proves that wrong.
 *
 * RECIPE goes into the content hash below. Change a width, a format or a
 * quality here and every URL changes, which is the only thing that makes the
 * one-year immutable cache header in public/_headers an honest promise rather
 * than a hope. Bump it by hand if you ever change something this string does
 * not already capture.
 */
const WIDTHS = [400, 800, 1200];
const BASE = 800; // the width an <img src> points at, and the one measured back
const RATIO = 4 / 3; // height / width. One 3:4 crop, everywhere.
const AVIF = { quality: 52, effort: 4 };
const WEBP = { quality: 80, effort: 5 };
const RECIPE = `v1|${WIDTHS.join(",")}|3:4|avif${AVIF.quality}/${AVIF.effort}|webp${WEBP.quality}/${WEBP.effort}`;

/* verify.mjs V14 fails the build above this. Named here too so the script says
 * so at the moment it writes the file, rather than a gate saying it later. */
const CEILING = 200 * 1024;

const die = (msg) => {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
};

/* sharp is optional in this tree the way every devDependency is: a colleague who
 * ran `npm ci --omit=dev` to build the site has no sharp and does not need one.
 * Say that, rather than handing them a module-resolution stack trace. */
let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  die(
    "sharp is not installed. It is a devDependency and only this script uses it:\n" +
      "  npm install\n" +
      "Building and deploying the site does not need it — the renditions in\n" +
      "public/img/ are committed."
  );
}

/* ---------- arguments ---------- */

const argv = process.argv.slice(2);
const USAGE =
  "node scripts/images.mjs <slug> <source> <alt> [<source> <alt> ...]\n\n" +
  "  Sources and alt text come in pairs. Alt text is not optional and the script\n" +
  "  will not invent it: the only line it could generate is the product name,\n" +
  "  which the heading beside the image already carries.";

if (argv.length < 3 || (argv.length - 1) % 2 !== 0) die(`Usage:\n\n  ${USAGE}`);

const [slug, ...rest] = argv;
const sources = [];
for (let i = 0; i < rest.length; i += 2) {
  const alt = rest[i + 1].trim();
  if (alt === "") die(`No alt text for ${rest[i]}. Say what the photograph shows.`);
  sources.push({ file: rest[i], alt });
}

const catalogue = JSON.parse(readFileSync(CATALOGUE, "utf8"));
const product = catalogue.find((p) => p.slug === slug);
if (!product) {
  die(`No product "${slug}" in src/data/products.json.\nSlugs: ${catalogue.map((p) => p.slug).join(", ")}`);
}

/* ---------- encode ---------- */

mkdirSync(OUT, { recursive: true });

const written = new Set();
const photos = [];
const report = [];

for (const [index, { file, alt }] of sources.entries()) {
  if (!existsSync(file)) die(`No such file: ${file}`);

  const bytes = readFileSync(file);
  const hash = createHash("sha256").update(bytes).update(RECIPE).digest("hex").slice(0, 8);

  const meta = await sharp(bytes).metadata();
  /* EXIF orientation 5-8 swap the axes. Reading width and height without
     accounting for that measures the file rather than the picture, and a
     portrait frame shot on a phone would be rejected below as too short. */
  const rotated = (meta.orientation ?? 1) >= 5;
  const w = rotated ? meta.height : meta.width;
  const h = rotated ? meta.width : meta.height;

  /* The 3:4 window this crop takes out of the frame, at the source's own
     resolution. Whichever axis is in surplus is the one that gets trimmed. */
  const cropW = Math.min(w, Math.round(h / RATIO));
  const cropH = Math.min(h, Math.round(w * RATIO));

  /* No upscaling. A 1200px rendition generated from an 800px frame is a file
     claiming a detail it does not have, on a site whose whole argument is that
     what it says can be checked. Any phone camera since about 2015 clears this. */
  const largest = WIDTHS[WIDTHS.length - 1];
  if (cropW < largest) {
    die(
      `${basename(file)} is ${w}x${h}. A 3:4 crop of it is ${cropW}x${cropH}, and the\n` +
        `  largest rendition is ${largest}x${Math.round(largest * RATIO)}. Upscaling would invent detail.\n` +
        `  Shoot or export at ${Math.round(largest * RATIO)}px on the short edge or better.`
    );
  }

  /* Centre, never sharp's attention/entropy crop. A smart crop chooses a
     different window per photograph, and CLAUDE.md asks for one crop across
     every product — a rule a heuristic cannot keep. Centre is predictable, so a
     photographer framing to 3:4 gets back what they framed. */
  const trimmed = w - cropW > h - cropH ? `${w - cropW}px off the width` : `${h - cropH}px off the height`;
  report.push(`  ${basename(file)}  ${w}x${h} -> 3:4 centre crop, ${w === cropW && h === cropH ? "nothing trimmed" : trimmed}`);

  /* One resize, not a crop followed by a scale. `fit: "cover"` at a 3:4 target
     already takes the centred 3:4 window out of the frame and scales it, and a
     second .resize() on the same instance would replace the first rather than
     compose with it. cropW/cropH above exist to refuse an upscale and to report
     what the crop discards, which is a different job from doing it. */
  let base = null;

  for (const width of WIDTHS) {
    const height = Math.round(width * RATIO);

    for (const [ext, encode] of [
      ["avif", (p) => p.avif(AVIF)],
      ["webp", (p) => p.webp(WEBP)],
    ]) {
      const name = `${slug}-${index + 1}-${width}.${hash}.${ext}`;
      const info = await encode(
        sharp(bytes)
          .rotate() // apply EXIF orientation, then forget it
          .resize(width, height, { fit: "cover", position: "centre" })
      ).toFile(join(OUT, name));

      written.add(name);
      const size = statSync(join(OUT, name)).size;
      const over = size > CEILING;
      report.push(
        `    /img/${name.padEnd(46)} ${String(size).padStart(7)} bytes${over ? "  OVER THE 200KB CEILING" : ""}`
      );
      if (over) {
        die(
          `/img/${name} is ${size} bytes, over the ${CEILING}-byte ceiling.\n` +
            `  verify.mjs V14 fails on it. Lower the quality in RECIPE above — and change\n` +
            `  RECIPE when you do, so every cached URL changes with it.`
        );
      }

      /* The dimensions written into products.json are read off the encoded
         file, never assumed from the width asked for. Rounding, EXIF and a
         source whose crop is a pixel short all make the two disagree, and it is
         the encoded one the browser reserves space for. */
      if (width === BASE && ext === "webp") base = { src: `/img/${name}`, width: info.width, height: info.height };
    }
  }

  photos.push({ src: base.src, alt, width: base.width, height: base.height });
}

/* ---------- prune ---------- */

/* Renditions this product used to have. A re-shoot changes the hash, so the old
 * files would otherwise sit in public/img/ forever — referenced by nothing,
 * committed, and served to nobody. Only this slug's files are considered; every
 * other product's are none of this run's business. */
const stale = readdirSync(OUT).filter(
  (f) => new RegExp(`^${slug}-\\d+-\\d+\\.[0-9a-f]{8}\\.(avif|webp)$`).test(f) && !written.has(f)
);
for (const f of stale) rmSync(join(OUT, f));

/* ---------- write the catalogue back ---------- */

/* Assigned into the existing object so `photos` keeps its place between `stock`
 * and `sizes`. A rebuilt object would reorder the file and turn every future
 * image run into a diff nobody can read. */
product.photos = photos;
writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`, "utf8");

/* ---------- say what happened ---------- */

console.log(`\n  ${product.name}  (${slug})\n`);
for (const line of report) console.log(line);
if (stale.length) {
  console.log(`\n  pruned ${stale.length} superseded rendition(s):`);
  for (const f of stale) console.log(`    /img/${f}`);
}
console.log(`\n  src/data/products.json  photos: ${photos.length}`);
for (const p of photos) console.log(`    ${p.src}  ${p.width}x${p.height}  "${p.alt}"`);
console.log(
  `\n  ${slug} now renders dark. Run npm run build and node scripts/verify.mjs,\n` +
    `  and look at the page before committing — no gate can tell you a crop is wrong.\n`
);
