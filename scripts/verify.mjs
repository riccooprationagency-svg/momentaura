#!/usr/bin/env node
/* Constraint gate. Wraps the checks from the step 1 verification plan that can
 * run without a browser.
 *
 *   V1  dependency surface — Astro and nothing else
 *   V2  no raw hex outside tokens.css
 *   V3  --accent referenced exactly once in the whole source tree
 *   V4  build output shape and page weight
 *   V6  banned constructs
 *   V8  the closed stamp is contained to the docket
 *   V9  every reachable text-on-surface pairing has a contrast.mjs row
 *
 * V2 and V3 guard the constraint CLAUDE.md calls the single most important in
 * the file, and the one most likely to erode silently: the accent means "you
 * can check this" and nothing else. Erosion is invisible — no test fails, the
 * build passes, the page looks fine, and the signal quietly stops meaning
 * anything. That is exactly the kind of rule that has to run without anyone
 * remembering to run it.
 *
 * Zero dependencies. Exits non-zero on any failure.
 *
 *   node scripts/verify.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, extname, basename } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");
const TOKENS = join(SRC, "styles", "tokens.css");

const SCANNED = new Set([".css", ".astro", ".js", ".mjs", ".ts", ".html", ".json"]);

const failures = [];
const notes = [];
const fail = (check, msg) => failures.push(`${check}  ${msg}`);
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");

function walkAll(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkAll(full, out);
    else out.push(full);
  }
  return out;
}

// Text files worth reading. Everything else — fonts, images — is weighed, not read.
const walk = (dir) => walkAll(dir).filter((f) => SCANNED.has(extname(f)));

// Blanks comments out in place rather than deleting them, so every reported
// line number still matches the real file. Collapsing a multi-line comment
// shifts every line after it and points you at the wrong place.
const blank = (m) => m.replace(/[^\n]/g, " ");
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/<!--[\s\S]*?-->/g, blank);

// Block comments plus // line comments. Any check that looks for a word rather
// than a CSS property needs this: a frontmatter comment explaining that zero
// stock renders as a stamp contains the word "stamp", and a gate that counts it
// is a gate reporting a violation that is not there. A false positive is worse
// than no check, because it trains people to ignore the thing.
// The :// guard leaves URLs alone.
const stripAllComments = (s) =>
  stripComments(s)
    .split(/\r?\n/)
    .map((l) => (l.includes("://") ? l : l.replace(/\/\/.*$/, "")))
    .join("\n");

const sourceFiles = walk(SRC).filter((f) => f !== TOKENS);

/* ---------- V1 — dependency surface ---------- */

{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const deps = Object.keys(pkg.dependencies ?? {});
  const dev = Object.keys(pkg.devDependencies ?? {});

  if (dev.length) fail("V1", `devDependencies present: ${dev.join(", ")}`);
  const extra = deps.filter((d) => d !== "astro");
  if (extra.length) fail("V1", `unexpected dependencies: ${extra.join(", ")}`);

  console.log(`  V1  dependencies      ${deps.join(", ") || "(none)"}${dev.length ? ` + dev: ${dev.join(", ")}` : ""}`);
}

/* ---------- V2 — no raw hex outside tokens.css ---------- */

{
  let hits = 0;
  for (const file of sourceFiles) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        // Length must look like a colour. #abcd12345 and the like are not.
        if (![3, 4, 6, 8].includes(m[0].length - 1)) continue;
        hits++;
        fail("V2", `${rel(file)}:${i + 1}  raw hex ${m[0]} — every colour comes from a token`);
      }
    });
  }
  console.log(`  V2  raw hex           ${hits === 0 ? "none outside tokens.css" : `${hits} found`}`);
}

/* ---------- V2b — no raw dimension outside tokens.css ----------
 *
 * CLAUDE.md: "A raw hex or magic pixel value anywhere else is a bug." The check
 * above enforced the hex half. This is the pixel half, and it is the one that
 * multiplies once components start landing.
 *
 * Allowed literals and nothing else: the identity values 0 and 0px, the border
 * widths 1px and 2px that CLAUDE.md names in prose, 100%, -1px because it is the
 * visually-hidden idiom and changing it breaks the pattern, and 1fr because a
 * grid track is structurally closer to auto than to a measurement. The 3/4
 * product ratio is unitless so it never matches.
 *
 * Media preludes are exempt. var() does not work in a media query, so a
 * breakpoint cannot be a token — that is a language limit, not a discipline
 * failure. The three breakpoints are declared in a comment at the top of
 * tokens.css so there is one place to read them.
 *
 * dev-guards.css is excluded entirely. It is inlined behind import.meta.env.DEV
 * and never reaches production, so holding it to production discipline is cost
 * with no return. This is deliberate, not an oversight — do not re-add it.
 *
 * Comments are stripped first, including // line comments — a comment recording
 * that --s-56 is 56px is not a magic value.
 */

{
  const ALLOWED = new Set([
    "0", "0px", "100%", "1fr",
    // Border widths CLAUDE.md names in prose.
    "1px", "2px",
    // Positioning idioms, not design decisions. -1px and inset(50%) are the
    // visually-hidden pattern; 50% with -50% is the centring pair; -100% is an
    // element's own height, which is a definition rather than a magic number.
    "-1px", "50%", "-50%", "-100%",
  ]);

  // Font metric overrides are measured from the font binaries, not chosen.
  // Tokenising them would imply they are design values open to adjustment.
  // Their derivation and provenance live in FONT-SETUP.md.
  const FONT_METRIC = /^\s*(size-adjust|ascent-override|descent-override|line-gap-override)\s*:/;
  // The trailing guard is a negative lookahead, not \b. \b after "%" requires a
  // word character to follow, so "40%;" never matched and every raw percentage
  // in the tree passed silently from the day this check was written.
  const UNIT =
    /-?\d*\.?\d+(px|rem|em|ex|ch|%|vw|vh|dvh|svh|lvh|vmin|vmax|pt|pc|cm|mm|in|deg|rad|turn|ms|s|fr)(?![\w%])/gi;

  let hits = 0;
  for (const file of sourceFiles.filter((f) => !f.endsWith("dev-guards.css"))) {
    stripAllComments(readFileSync(file, "utf8"))
      .split(/\r?\n/)
      .forEach((rawLine, i) => {
        if (FONT_METRIC.test(rawLine)) return;
        // Drop the media prelude before matching, keeping anything after the
        // opening brace so a declaration on the same line is still checked.
        const line = rawLine.replace(/@media[^{]*\{?/g, "");
        for (const m of line.matchAll(UNIT)) {
          if (ALLOWED.has(m[0].toLowerCase())) continue;
          hits++;
          fail("V2", `${rel(file)}:${i + 1}  raw dimension ${m[0]} — every size and space comes from a token`);
        }
      });
  }
  console.log(`  V2  raw dimensions    ${hits === 0 ? "none outside tokens.css" : `${hits} found`}`);
}

/* ---------- V3 — accent containment ---------- */

{
  const found = [];
  for (const file of sourceFiles) {
    const lines = stripComments(readFileSync(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/--accent|--foil-green|--dispatch\b/.test(line)) {
        found.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
      }
    });
  }

  if (found.length !== 1) {
    fail("V3", `expected exactly 1 accent reference in src/, found ${found.length}`);
    found.forEach((f) => fail("V3", `  ${f}`));
    if (found.length > 1) {
      fail("V3", "  The accent marks facts a buyer can verify. One misuse costs the");
      fail("V3", "  signal site-wide. If a new use is genuinely a checkable fact, add");
      fail("V3", "  it to the expected count here deliberately, never by accident.");
    }
  }
  console.log(`  V3  accent uses       ${found.length} (expected 1)${found.length === 1 ? ` — ${found[0].split("  ")[0]}` : ""}`);
}

/* ---------- V6 — banned constructs ---------- */

{
  const BANNED = [
    [/box-shadow|drop-shadow/i, "shadow — depth is the one luminance step, never a shadow"],
    [/linear-gradient|radial-gradient|conic-gradient/i, "gradient"],
    [/backdrop-filter/i, "backdrop-filter — no glassmorphism"],
    [/@keyframes/i, "@keyframes — no scroll animation, no skeleton shimmer"],
    [/scroll-behavior\s*:\s*smooth/i, "smooth scrolling"],
    [/font-weight\s*:\s*(bold(er)?|[7-9]0{2})\b/i, "font-weight above 600"],
    [/\p{Extended_Pictographic}/u, "emoji — banned anywhere, including code comments", true],
  ];

  const targets = [...sourceFiles];
  if (existsSync(DIST)) targets.push(...walk(DIST));
  else notes.push("dist/ absent — V4 and the built half of V6 skipped. Run npm run build.");

  // Banned *constructs* are only a problem in live code — a comment recording
  // why we do not use one is not a violation. Banned *characters* are a problem
  // everywhere: CLAUDE.md bans emoji "anywhere including code comments". So the
  // property rules run against stripped source and the emoji rule against raw.
  let hits = 0;
  for (const file of targets) {
    const raw = readFileSync(file, "utf8");
    const stripped = stripComments(raw);

    // dist/ is scanned raw, comments and all. In source, a comment recording
    // why we do not use a shadow is not a shadow. In built output there is no
    // such thing as an explanatory comment — a box-shadow that reaches the
    // browser is a violation wherever in the file it sits, and blanking
    // comments there hid exactly what this check exists to find.
    const isBuilt = file.startsWith(DIST);

    for (const [re, label, scanComments] of BANNED) {
      const lines = (scanComments || isBuilt ? raw : stripped).split(/\r?\n/);
      lines.forEach((line, i) => {
        if (re.test(line)) {
          hits++;
          fail("V6", `${rel(file)}:${i + 1}  ${label}`);
        }
      });
    }
  }
  console.log(`  V6  banned            ${hits === 0 ? `none in ${targets.length} files` : `${hits} found`}`);
}

/* ---------- V7 — data-system implies a background ----------
 *
 * An element that sets data-system remaps --bg, --fg, --surface, --border and
 * --accent for its whole subtree. If it then never paints --bg, it inherits the
 * surrounding ground while its text and borders switch systems — light-system
 * ink on the dark canvas, or the reverse. It reads as broken and every colour
 * involved is a legitimate token, so nothing else catches it.
 *
 * contrast.mjs cannot: the failing pairing only exists at runtime, as a
 * consequence of where the element sits. That is why this is a structural check
 * and not another row in the pairings table — fixing the one component that had
 * the bug would not have stopped the next one.
 */

{
  // <body> is the one legitimate exception: its background is declared once in
  // global.css rather than in the layout. The assertion below keeps that
  // exemption honest instead of taking it on trust.
  const EXEMPT = new Set(["Base.astro"]);
  const PAINTS_BG = /background-color:\s*var\(--bg\)/;

  if (!PAINTS_BG.test(readFileSync(join(SRC, "styles", "global.css"), "utf8"))) {
    fail("V7", "global.css no longer paints background-color: var(--bg) — the Base.astro exemption is void");
  }

  let carriers = 0;
  for (const file of sourceFiles.filter((f) => f.endsWith(".astro"))) {
    const src = stripComments(readFileSync(file, "utf8"));
    if (!/data-system\s*=/.test(src)) continue;
    carriers++;
    if (EXEMPT.has(basename(file))) continue;
    if (!PAINTS_BG.test(src)) {
      fail("V7", `${rel(file)}  sets data-system but never declares background-color: var(--bg)`);
    }
  }
  console.log(`  V7  system carriers   ${carriers} checked, all paint --bg`);
}

/* ---------- V8 — the closed stamp belongs to the docket ----------
 *
 * CLAUDE.md: the Seal fill renders in the docket's Stock row and nowhere else.
 * Everywhere else — cards, product page actions, listings — sold-out status is
 * --fg-muted mono with no fill.
 *
 * This is the same class of rule as V3 and it erodes the same way. Nothing fails
 * when a second component reaches for .stamp: the build passes, the colour is a
 * legitimate token, the page looks deliberate, and the only casualty is that
 * Seal stops meaning closed. It cost a category page three fills and a product
 * page four before anyone counted them.
 *
 * Containment in source, not a count per built page. The stronger check is one
 * stamp per rendered page, and it is not here yet because the homepage renders
 * two product reveals and therefore two dockets — see BUILD-ORDER section 6. Add
 * it once that is ruled on rather than shipping a gate that is already failing.
 */

{
  const HOME = "Docket.astro";
  const uses = [];

  for (const file of sourceFiles.filter((f) => f.endsWith(".astro"))) {
    stripAllComments(readFileSync(file, "utf8"))
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/\bstamp\b/.test(line)) uses.push({ file, line: i + 1 });
      });
  }

  const strays = uses.filter((u) => basename(u.file) !== HOME);

  if (!uses.some((u) => basename(u.file) === HOME)) {
    fail("V8", `${HOME} no longer stamps its Stock row — the closed stamp has no home`);
  }
  for (const s of strays) {
    fail("V8", `${rel(s.file)}:${s.line}  .stamp outside ${HOME}`);
  }
  if (strays.length) {
    fail("V8", "  Sold-out status outside the docket is --fg-muted mono, uppercase, no");
    fail("V8", "  fill. Nine fills on a grid read as the page's colour scheme rather");
    fail("V8", "  than as an exception, which costs Seal the one thing it means.");
  }

  console.log(
    `  V8  closed stamp      ${uses.length} use(s)${strays.length === 0 ? `, ${HOME} only` : `, ${strays.length} outside ${HOME}`}`
  );
}

/* ---------- V9 — the pairings table is complete ----------
 *
 * Numbered V9 because V8 is the closed-stamp check above.
 *
 * Every token that resolves as --fg, --fg-muted or --accent must have a row in
 * contrast.mjs against every token that can resolve as --bg or --surface in the
 * same scope. Not the pairings someone remembered to add — the pairings the
 * scoping in tokens.css makes reachable.
 *
 * Four tokens have now failed on a surface nobody thought to check: --sisal on
 * Kraft Board, --kraft-deep on kraft, and --muted and --dispatch on kraft. That
 * is not four oversights, it is one gap in the table, and it is the wrong shape
 * of thing to fix four times. contrast.mjs proves the listed pairings pass; this
 * proves the list is the right list.
 *
 * The mechanism the misses share: --fg-muted and --accent are scoped aliases, so
 * one class puts them on two grounds per system without naming either. Nothing
 * in the component says "sisal on kraft board" — the docket says --fg-muted on
 * --surface, and which surface that is depends on where it renders. So the
 * reachable set has to be derived from the scope blocks, never enumerated by
 * hand, because enumerating by hand is the failure.
 *
 * Borders are excluded on purpose. --border is not text, and WCAG's non-text
 * 3:1 does not apply to the hairlines here — a docket edge is not a control
 * boundary, and a disabled control is explicitly exempt.
 */

{
  const TEXT_ROLES = ["fg", "fg-muted", "accent"];
  const SURFACE_ROLES = ["bg", "surface"];

  const tokensSrc = stripComments(readFileSync(TOKENS, "utf8"));
  const contrastPath = join(ROOT, "scripts", "contrast.mjs");
  const contrastSrc = stripComments(readFileSync(contrastPath, "utf8"));

  // Every block opened by `selector {`, sliced to its matching close brace so a
  // :root nested inside an @media is read as the :root scope it is.
  const blocksFor = (pattern) => {
    const out = [];
    const re = new RegExp(`${pattern}\\s*\\{`, "g");
    let m;
    while ((m = re.exec(tokensSrc))) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (i < tokensSrc.length && depth > 0) {
        if (tokensSrc[i] === "{") depth++;
        else if (tokensSrc[i] === "}") depth--;
        i++;
      }
      out.push(tokensSrc.slice(start, i - 1));
    }
    return out;
  };

  // Only `--role: var(--token)` counts. The palette block assigns raw hex, which
  // is a definition rather than a mapping, and must not be read as one.
  const mapping = (label, pattern) => {
    const roles = {};
    for (const block of blocksFor(pattern)) {
      for (const [, role, token] of block.matchAll(/--([a-z-]+)\s*:\s*var\(\s*--([a-z0-9-]+)\s*\)/g)) {
        roles[role] = token;
      }
    }
    return { label, roles };
  };

  const scopes = [
    // Bare :root is the fail-safe light system, not a theoretical scope. An
    // element that never receives data-system renders from it, so its pairings
    // are as reachable as either explicit system's.
    mapping(":root", ":root"),
    mapping('[data-system="dark"]', '\\[data-system="dark"\\]'),
    mapping('[data-system="light"]', '\\[data-system="light"\\]'),
  ];

  // The table, read out of contrast.mjs rather than restated here. Only the two
  // token names of each row matter; the ratio is contrast.mjs's job.
  const pairingsBlock = contrastSrc.match(/const PAIRINGS\s*=\s*\[([\s\S]*?)\n\];/);
  const have = new Set();
  let rowsSeen = 0;

  if (!pairingsBlock) {
    fail("V9", `could not find the PAIRINGS table in ${rel(contrastPath)} — this check is blind`);
  } else {
    rowsSeen = [...pairingsBlock[1].matchAll(/\[\s*"/g)].length;
    const parsed = [...pairingsBlock[1].matchAll(/\[\s*"([a-z0-9-]+)"\s*,\s*"([a-z0-9-]+)"/g)];
    for (const [, fg, bg] of parsed) have.add(`${fg} on ${bg}`);
    // A regex that silently stops matching turns this into a check that passes
    // because it found nothing. Count the rows two ways and compare.
    if (parsed.length !== rowsSeen) {
      fail("V9", `parsed ${parsed.length} of ${rowsSeen} PAIRINGS rows — the parser lost rows, fix it before trusting this`);
    }
  }

  // Distinct pairings. :root and [data-system="light"] map the same six tokens,
  // deliberately — light is the fail-safe — so counting both would overstate.
  const required = new Set();
  const missing = new Map();

  for (const { label, roles } of scopes) {
    const texts = TEXT_ROLES.filter((r) => roles[r]);
    const surfaces = SURFACE_ROLES.filter((r) => roles[r]);

    if (texts.length && !surfaces.length) {
      fail("V9", `${label} remaps ${texts.join(", ")} but no ground — the pairing it creates cannot be checked`);
      continue;
    }

    for (const textRole of texts) {
      for (const surfaceRole of surfaces) {
        const key = `${roles[textRole]} on ${roles[surfaceRole]}`;
        required.add(key);
        if (!have.has(key) && !missing.has(key)) {
          missing.set(key, `--${textRole} on --${surfaceRole} in ${label}`);
        }
      }
    }
  }

  if (!required.size) {
    fail("V9", "derived no pairings from tokens.css — the scope blocks moved and this check is blind");
  }

  for (const [key, where] of missing) {
    fail("V9", `${key} is reachable and has no PAIRINGS row — ${where}`);
  }
  if (missing.size) {
    fail("V9", "  Add the row to scripts/contrast.mjs and let it compute the ratio.");
    fail("V9", "  If it fails, correct the token against every surface it sits on.");
  }

  console.log(
    `  V9  pairings table    ${required.size} reachable, ${rowsSeen} listed, ${missing.size} unchecked`
  );
}

/* ---------- V4 — build output shape and weight ---------- */

if (existsSync(DIST)) {
  const files = walkAll(DIST);
  const bytes = (p) => statSync(p).size;

  const html = files.filter((f) => f.endsWith(".html"));
  const js = files.filter((f) => f.endsWith(".js"));
  const fonts = files.filter((f) => f.endsWith(".woff2"));

  for (const page of html) {
    const source = readFileSync(page, "utf8");
    if (/<script/i.test(source)) fail("V4", `${rel(page)} contains a <script> tag — zero render-blocking JS`);
  }
  if (js.length) fail("V4", `JavaScript emitted: ${js.map(rel).join(", ")}`);
  if (fonts.length !== 2) fail("V4", `expected 2 woff2 in dist/, found ${fonts.length}`);

  // Shared cost every page pays: the fonts, plus any stylesheet not inlined.
  const shared =
    files.filter((f) => f.endsWith(".css") || f.endsWith(".woff2")).reduce((n, f) => n + bytes(f), 0);

  console.log(
    `  V4  output            ${files.length} files, ${html.length} page(s), ${js.length} js, ${fonts.length} fonts`
  );
  for (const page of html) {
    const total = bytes(page) + shared;
    const budget = rel(page) === "dist/index.html" ? 500_000 : 1_000_000;
    const ok = total <= budget;
    if (!ok) fail("V4", `${rel(page)} is ${total} bytes against a ${budget} budget`);
    console.log(
      `      ${rel(page).padEnd(24)} ${String(total).padStart(7)} bytes / ${budget}  ${ok ? "within budget" : "OVER"}`
    );
  }
}

/* ---------- report ---------- */

for (const n of notes) console.log(`\n  note: ${n}`);

if (failures.length) {
  console.error(`\n  ${failures.length} failure${failures.length === 1 ? "" : "s"}:\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error("");
  process.exit(1);
}

console.log("\n  all checks pass.\n");
