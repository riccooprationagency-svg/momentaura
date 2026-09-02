#!/usr/bin/env node
/* Constraint gate. Wraps the checks from the step 1 verification plan that can
 * run without a browser.
 *
 *   V1  dependency surface — Astro and nothing else
 *   V2  no raw hex outside tokens.css
 *   V3  the accent appears only at its two sanctioned sites, by selector
 *   V4  build output shape, the one script, and page weight
 *   V6  banned constructs
 *   V8  the closed stamp is contained to the docket
 *   V8b at most one Seal fill on any rendered page
 *   V9  every reachable text-on-surface pairing has a contrast.mjs row
 *   V10 tag-specific attributes derive from the condition that picks the tag
 *   V10b the rendered elements in dist/ carry only their own attributes
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

/* ---------- V3 — accent containment ----------
 *
 * CLAUDE.md calls the accent rule the single most important constraint in the
 * file: --foil-green and --dispatch mean "you can check this" and nothing else.
 *
 * THIS CHECK ASSERTS SITES, NOT A COUNT. It used to assert "exactly 1", which
 * was the right rule while the docket's fact row was the only sanctioned use.
 * Step 8 added the second one CLAUDE.md names in prose — the input's 2px focus
 * underline, "the one place the accent touches an interactive element, and it
 * is a state, not a fill" — and a bare count of 2 would then have accepted any
 * two references anywhere. Two wrong ones pass a count. They do not pass this.
 *
 * Each sanctioned use is pinned to its file and its selector. A new use fails
 * whatever the total, and moving a sanctioned one fails until this table is
 * updated deliberately, which is the point: the table is the list of places the
 * accent is allowed to be, and editing it is the decision being made out loud.
 */

{
  /* file -> the selector the reference must sit under, and why it is allowed. */
  const SANCTIONED = [
    {
      file: "src/styles/global.css",
      selector: ".docket__value--fact",
      why: "the docket's checkable fact — lead time, dispatch, stock, run counts",
    },
    {
      file: "src/components/Field.astro",
      selector: ".field__input:focus",
      why: "the input focus underline — a state, not a fill. CLAUDE.md names it",
    },
  ];

  const found = [];
  for (const file of sourceFiles) {
    const lines = stripComments(readFileSync(file, "utf8")).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/--accent|--foil-green|--dispatch\b/.test(line)) {
        found.push({ file: rel(file), line: i + 1, text: line.trim(), lines });
      }
    });
  }

  /* The declaration has to sit inside the rule the table names. Walking back up
     to the nearest selector is what makes this a check on the site rather than
     on the filename — a second --accent added lower down the same file is a
     different rule and fails, which a per-file count would have waved through. */
  const ruleFor = (hit) => {
    for (let k = hit.line - 1; k >= 0; k--) {
      const text = hit.lines[k];
      const m = text.match(/^\s*([^\s@{][^{]*?)\s*\{\s*$/);
      if (m) return m[1].trim();
    }
    return "(no enclosing rule)";
  };

  const unmatched = [...found];
  for (const allowed of SANCTIONED) {
    const idx = unmatched.findIndex(
      (hit) => hit.file === allowed.file && ruleFor(hit) === allowed.selector
    );
    if (idx === -1) {
      fail("V3", `sanctioned accent use is missing: ${allowed.file} ${allowed.selector}`);
      fail("V3", `  ${allowed.why}`);
      fail("V3", "  If it moved, move the row. If it went, delete the row. Never leave both.");
      continue;
    }
    unmatched.splice(idx, 1);
  }

  for (const hit of unmatched) {
    fail("V3", `unsanctioned accent use  ${hit.file}:${hit.line}  ${hit.text}`);
    fail("V3", `  under ${ruleFor(hit)}`);
    fail("V3", "  The accent marks facts a buyer can verify. One misuse costs the");
    fail("V3", "  signal site-wide. If this is genuinely a checkable fact or a");
    fail("V3", "  state CLAUDE.md sanctions, add it to SANCTIONED above by hand.");
  }

  console.log(
    `  V3  accent uses       ${found.length} (${SANCTIONED.length} sanctioned sites)` +
      `${found.length === SANCTIONED.length && !unmatched.length ? " — all at their named selectors" : ""}`
  );
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
 * Containment in source. V8b below counts the fills per built page, which is the
 * rule itself; this one keeps the class from spreading to a second component in
 * the first place, where the fix is cheap and obvious rather than a page count
 * someone has to trace back to a component.
 */

{
  // Docket.astro is the only component that may apply the class. global.css is
  // the stylesheet that defines it. Everything else in src/ is a stray —
  // including .css and .ts, which an .astro-only scan walked straight past.
  const HOME = "Docket.astro";
  const DEFINES = "global.css";
  const uses = [];

  for (const file of sourceFiles) {
    stripAllComments(readFileSync(file, "utf8"))
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/\bstamp\b/.test(line)) uses.push({ file, line: i + 1 });
      });
  }

  const strays = uses.filter((u) => ![HOME, DEFINES].includes(basename(u.file)));

  if (!uses.some((u) => basename(u.file) === HOME)) {
    fail("V8", `${HOME} no longer stamps its Stock row — the closed stamp has no home`);
  }
  if (!uses.some((u) => basename(u.file) === DEFINES)) {
    fail("V8", `${DEFINES} no longer defines .stamp — the class the docket applies does not exist`);
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
    `  V8  closed stamp      ${uses.length} reference(s) across ${sourceFiles.length} source files` +
      `${strays.length === 0 ? `, ${HOME} and ${DEFINES} only` : `, ${strays.length} stray`}`
  );
}

/* ---------- V8b — one Seal fill per rendered page ----------
 *
 * The check V8 defers to, and the one that actually states the rule: at most one
 * Seal fill on any page a buyer can load. V8 constrains which component may spend
 * the colour; only this one constrains how often it gets spent, because one
 * component rendered three times spends it three times and source containment
 * cannot see that.
 *
 * It is countable from dist/ and nowhere else. /apparel renders one component
 * nine times, a product page renders two dockets and a grid of cards, and no
 * amount of reading src/ tells you the totals. That is why this is measured, not
 * reasoned about — the same reason V4 weighs the built pages instead of
 * estimating them.
 *
 * Shippable only since Docket's fill became opt-in and defaulted off. Before
 * that the homepage rendered two reveals, so two dockets, so two fills, and
 * this gate would have shipped already failing.
 */

if (existsSync(DIST)) {
  // The class attribute, not the bare word: a class list carrying stamp counts,
  // and a page that merely says "stamp" in prose does not.
  const FILL = /class="[^"]*\bstamp\b[^"]*"/g;

  let total = 0;
  let worst = 0;
  const over = [];

  for (const page of walkAll(DIST).filter((f) => f.endsWith(".html"))) {
    const fills = [...readFileSync(page, "utf8").matchAll(FILL)].length;
    total += fills;
    worst = Math.max(worst, fills);
    if (fills > 1) over.push(`${rel(page)}  ${fills} Seal fills on one page`);
  }

  for (const o of over) fail("V8b", o);
  if (over.length) {
    fail("V8b", "  Seal means closed exactly as long as it is rare. Pass detail only");
    fail("V8b", "  where a single product is under examination; every other surface");
    fail("V8b", "  reads the Stock row as --fg-muted mono with no fill.");
  }

  console.log(`  V8b Seal fills        ${total} across the site, ${worst} the most on any page (max 1)`);
} else {
  notes.push("dist/ absent — V8b not counted. Run npm run build.");
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
    const blocks = blocksFor(pattern);
    for (const block of blocks) {
      for (const [, role, token] of block.matchAll(/--([a-z-]+)\s*:\s*var\(\s*--([a-z0-9-]+)\s*\)/g)) {
        roles[role] = token;
      }
    }
    return { label, roles, present: blocks.length > 0 };
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

  for (const { label, roles, present } of scopes) {
    const texts = TEXT_ROLES.filter((r) => roles[r]);
    const surfaces = SURFACE_ROLES.filter((r) => roles[r]);

    // A scope that exists but yields nothing is this check going quietly blind
    // on that scope — the selector was renamed, or the roles were, and the
    // derivation silently narrowed instead of failing. Cheap to assert, and the
    // failure it prevents is the whole point of deriving rather than listing.
    if (present && (!texts.length || !surfaces.length)) {
      fail("V9", `${label} is declared in tokens.css but yields no pairing`);
      fail("V9", `  text roles found: ${texts.join(", ") || "none"} — ground roles: ${surfaces.join(", ") || "none"}`);
      fail("V9", `  A scope this check cannot read is a scope it is not checking.`);
      continue;
    }
    if (!present) continue;

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

/* ---------- V10 — tag-specific attributes follow the tag ----------
 *
 * A component that picks its own element must derive every attribute belonging
 * to that element from the same condition. Button.astro picked the tag on
 * `href && !disabled` and then emitted `href` unconditionally with `type` keyed
 * off `href`, so <Button href disabled> rendered <button href> with no type —
 * and a button with no type defaults to submit.
 *
 * Nothing was broken, because no caller passed both. That is exactly why this is
 * a source check and not only a built-output one: the defect was in the
 * contract, not in any rendered page, and a dist scan would have sat green over
 * it until step 7 put a button inside a form. V10b below scans dist anyway,
 * because source containment cannot see what a future component renders. Neither
 * half is sufficient alone — the same shape as V8 and V8b.
 *
 * The condition must be a bare identifier. `const Tag = a && !b ? "a" : "button"`
 * is unparseable against an attribute expression without an AST, so the rule is
 * that you name it. Naming it is also what makes the guard legible at each
 * attribute, which is the actual fix.
 */

{
  // Attributes that mean something on one of these elements and not the other.
  const TAG_SPECIFIC = ["href", "target", "rel", "download", "type"];

  const openingTag = (src, name) => {
    const start = src.indexOf(`<${name}`);
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      else if (src[i] === ">" && depth === 0) return src.slice(start, i + 1);
    }
    return null;
  };

  // name -> raw expression, brace-balanced so a ternary inside an attribute is
  // read whole rather than truncated at its first closing brace.
  const attrsOf = (open) => {
    const out = {};
    const re = /([a-zA-Z:-]+)=\{/g;
    let m;
    while ((m = re.exec(open))) {
      let depth = 1;
      let i = re.lastIndex;
      while (i < open.length && depth > 0) {
        if (open[i] === "{") depth++;
        else if (open[i] === "}") depth--;
        i++;
      }
      out[m[1]] = open.slice(re.lastIndex, i - 1);
      re.lastIndex = i;
    }
    return out;
  };

  let components = 0;
  let guarded = 0;

  for (const file of sourceFiles.filter((f) => f.endsWith(".astro"))) {
    const src = stripAllComments(readFileSync(file, "utf8"));
    const decl = /const\s+([A-Z][\w$]*)\s*=\s*([^;]*?)\s*\?\s*"([a-z]+)"\s*:\s*"([a-z]+)"\s*;/g;
    let m;

    while ((m = decl.exec(src))) {
      const [, name, rawCond, tagA, tagB] = m;
      components++;
      const guard = rawCond.trim();

      if (!/^[A-Za-z_$][\w$]*$/.test(guard)) {
        fail("V10", `${rel(file)}  ${name} picks <${tagA}> or <${tagB}> on an inline condition: ${guard}`);
        fail("V10", `  Extract it to a named const and guard each tag-specific attribute with it.`);
        fail("V10", `  An inline condition cannot be matched against an attribute expression here.`);
        continue;
      }

      const open = openingTag(src, name);
      if (!open) {
        fail("V10", `${rel(file)}  ${name} is declared as a conditional tag but never rendered`);
        continue;
      }

      const attrs = attrsOf(open);
      const word = new RegExp(`\\b${guard}\\b`);

      for (const attr of TAG_SPECIFIC) {
        if (!(attr in attrs)) continue;
        if (!word.test(attrs[attr])) {
          fail("V10", `${rel(file)}  <${name}> emits ${attr}={${attrs[attr]}} without consulting ${guard}`);
          fail("V10", `  ${attr} belongs to one of <${tagA}>/<${tagB}>. Derive it from ${guard}, not from a prop.`);
        }
      }

      // A <button> with no type attribute defaults to submit. If either branch
      // renders one, the attribute has to be there.
      if ((tagA === "button" || tagB === "button") && !("type" in attrs)) {
        fail("V10", `${rel(file)}  <${name}> can render a <button> and never emits type — an omitted type defaults to submit`);
      }

      guarded++;
    }
  }

  // Counted from clean passes, not from the loop reaching the end — a summary
  // line that reads "all guarded" while failures are queued below it is the
  // report lying about its own result.
  const clean = components === guarded && !failures.some((f) => f.startsWith("V10 "));
  console.log(
    `  V10 tag attributes    ${components} conditional-tag component(s)${clean ? ", all guarded" : `, ${components - guarded || "some"} unguarded`}`
  );
}

/* ---------- V10b — the rendered elements agree ----------
 *
 * What actually reached the browser. V10 constrains the components in src/;
 * this constrains every element in dist/, including ones written straight into
 * a page without going through a component.
 */

if (existsSync(DIST)) {
  const ANCHOR_ONLY = ["href", "target", "rel", "download"];
  let buttons = 0;
  let anchors = 0;

  for (const page of walkAll(DIST).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(page, "utf8");

    for (const [tag] of html.matchAll(/<button\b[^>]*>/g)) {
      buttons++;
      for (const attr of ANCHOR_ONLY) {
        if (new RegExp(`\\s${attr}[=\\s>]`).test(tag)) {
          fail("V10b", `${rel(page)}  <button> carries ${attr} — that attribute belongs to an anchor`);
        }
      }
      if (!/\stype[=\s>]/.test(tag)) {
        fail("V10b", `${rel(page)}  <button> with no type — an omitted type defaults to submit`);
      }
    }

    for (const [tag] of html.matchAll(/<a\b[^>]*>/g)) {
      anchors++;
      if (/\stype[=\s>]/.test(tag)) {
        fail("V10b", `${rel(page)}  <a> carries type — that attribute belongs to a button`);
      }
    }
  }

  const bad = failures.filter((f) => f.startsWith("V10b ")).length;
  console.log(
    `  V10b rendered tags    ${buttons} button(s), ${anchors} anchor(s), ${bad === 0 ? "attributes agree" : `${bad} mismatched`}`
  );
} else {
  notes.push("dist/ absent — V10b not counted. Run npm run build.");
}

/* ---------- V11 — CLAUDE.md's palette matches tokens.css ----------
 *
 * CLAUDE.md prints the palette as a table of token names and hex values, and it
 * is the file every session is told to read first. When a token is corrected in
 * tokens.css and the table is not, the authoritative document states a colour
 * the source contradicts — and it stated two: --muted and --dispatch sat at
 * their pre-correction values while the real ones had already shipped.
 *
 * That is the exact failure CLAUDE.md documents twice in its own contrast
 * section, reproduced in the document doing the documenting. The only reason it
 * survived is that every gate here reads code and none read markdown.
 *
 * One direction only. Everything the table claims must be true; tokens.css is
 * free to hold tokens the table does not print, because it holds type, space and
 * structure tokens that are not palette entries.
 *
 * WHERE THIS COVERAGE ENDS, and it ends early.
 *
 * This reads hex values in the palette tables. Nothing else. Every prose claim
 * CLAUDE.md makes about a token is unchecked: which token a component uses, what
 * a rule is for, which surface something sits on, what the disabled state is
 * outlined in. Those are the sentences that go stale, and both drifts found so
 * far were found by review rather than by a gate — the palette hexes, and then
 * the Buttons spec still saying the disabled outline was --border after the code
 * had moved to --fg-muted.
 *
 * Do not extend this into a prose checker. Deciding whether a sentence about a
 * token still describes the code needs judgement about what the sentence means,
 * and a gate that guesses at meaning produces confident wrong answers and then
 * gets muted — which costs more than the checking is worth. The hex table is
 * mechanical and therefore checkable; the prose around it is not, and stays a
 * job for whoever reads the diff.
 */

{
  const paletteOf = (source) => {
    const out = {};
    for (const [, name, hex] of stripComments(source).matchAll(
      /--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g
    )) {
      out[name] = hex.toLowerCase();
    }
    return out;
  };

  const tokens = paletteOf(readFileSync(TOKENS, "utf8"));
  const doc = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");

  // Table rows read `--token-name   #hex   description`, one per line.
  const claims = [...doc.matchAll(/^--([a-z0-9-]+)\s+(#[0-9a-fA-F]{3,8})\b/gm)];

  if (claims.length === 0) {
    fail("V11", "no palette rows found in CLAUDE.md — the table moved and this check is blind");
  }

  let mismatched = 0;
  for (const [, name, claimed] of claims) {
    const actual = tokens[name];
    if (!actual) {
      mismatched++;
      fail("V11", `CLAUDE.md documents --${name}, which tokens.css does not define`);
      continue;
    }
    if (actual !== claimed.toLowerCase()) {
      mismatched++;
      fail("V11", `CLAUDE.md says --${name} is ${claimed}, tokens.css says ${actual}`);
    }
  }
  if (mismatched) {
    fail("V11", "  Correct the table. It is the file every session reads first, and a");
    fail("V11", "  palette it prints wrongly is worse than one it does not print at all.");
  }

  console.log(
    `  V11 documented hexes  ${claims.length} row(s) in CLAUDE.md, ${mismatched === 0 ? "all match tokens.css" : `${mismatched} wrong`}`
  );
}

/* ---------- V4 — build output shape, the one script, and page weight ----------
 *
 * This check used to assert zero JavaScript: no <script> tag in any page, no .js
 * in dist/. Step 7 shipped the cart, which CLAUDE.md has always named as the one
 * permitted exception, so the old assertion could not survive as written.
 *
 * It was not simply loosened. "Zero scripts" is trivially checkable and needs no
 * judgement; "one script" is a budget, and a budget nobody counts becomes a
 * comment. So the assertion moved from absence to containment, and it is
 * strictly more work to violate by accident than the old one was:
 *
 *   - exactly one .js file in the whole of dist/
 *   - it is named, so a second entry chunk cannot quietly take its place in the
 *     count. astro.config.mjs names it; two would collide and fail the build
 *   - under the byte budget below, so the cart cannot grow into an application
 *   - every page references that same one URL, and no page references a second
 *     script. One file, cached once, across the several product pages a buyer
 *     opens in a session
 *   - no inline <script> body anywhere in the output. Astro inlines a small
 *     hoisted script by default, which put a copy of the cart into all ten
 *     pages and left dist/ with no .js file for a gate to find. An inline body
 *     is how "one script" silently becomes ten
 *
 * The old rule survives where it still applies: a page may not carry executable
 * markup of its own, only a reference to the one bundle.
 *
 * THE BUDGET MOVED ONCE, AT STEP 8, FROM 5KB TO 6.5KB. Recorded here because a
 * budget that quietly follows whatever the file currently weighs is not a
 * budget, and the way that starts is a raise nobody wrote down.
 *
 * What it bought: the checkout submit and the confirmation screen. Both are the
 * flow the cart exists to complete, and neither can go anywhere else — CLAUDE.md
 * permits exactly one script, so "put it in a second file" is not on the table.
 * Most of the growth is error copy the same file requires: every message says
 * what happened and what to do, and those sentences are the point rather than
 * padding. The cart did three jobs at step 7 and does five now.
 *
 * What it did not buy: headroom worth spending. 6.5KB leaves a few hundred bytes
 * over the measured size — enough for the phone number to land in these messages
 * when section 10 supplies one, and not enough for another screen. The next
 * feature that needs a kilobyte fails this check, which is the whole job.
 *
 * Before raising it again, shrink instead: the two line painters were one loop
 * written twice until step 8 merged them, and duplication is what a growing
 * script accumulates first. If it must move, move it here, in a comment, with
 * the reason — never by rounding up to whatever made the build pass.
 */

if (existsSync(DIST)) {
  const files = walkAll(DIST);
  const bytes = (p) => statSync(p).size;

  const html = files.filter((f) => f.endsWith(".html"));
  const js = files.filter((f) => f.endsWith(".js"));
  const fonts = files.filter((f) => f.endsWith(".woff2"));

  // 6.5KB. Raised from 5KB at step 8 — see the note above for what it bought
  // and what has to happen before it moves again.
  const SCRIPT_BUDGET = 6.5 * 1024;
  const CART = /^cart\.[A-Za-z0-9_-]+\.js$/;

  // The one bundle.
  let cartUrl = null;
  if (js.length !== 1) {
    fail("V4", `expected exactly 1 .js in dist/, found ${js.length}${js.length ? `: ${js.map(rel).join(", ")}` : ""}`);
    fail("V4", "  The cart is the only client-side JavaScript on the site. If a feature");
    fail("V4", "  needs a second script, CLAUDE.md says it does not ship.");
  } else {
    const bundle = js[0];
    const name = basename(bundle);
    if (!CART.test(name)) {
      fail("V4", `the emitted script is ${name} — expected cart.<hash>.js`);
      fail("V4", "  astro.config.mjs names it. An unnamed chunk means the naming plugin");
      fail("V4", "  stopped matching, and the count above stops meaning 'the cart'.");
    }
    const size = bytes(bundle);
    if (size > SCRIPT_BUDGET) {
      fail("V4", `${rel(bundle)} is ${size} bytes against a ${SCRIPT_BUDGET} budget`);
    }
    cartUrl = `/${rel(bundle).replace(/^dist\//, "")}`;
    console.log(`  V4  the one script    ${name}  ${size} bytes / ${SCRIPT_BUDGET}  ${size <= SCRIPT_BUDGET ? "within budget" : "OVER"}`);
  }

  // Every page carries a reference to that bundle and nothing else executable.
  const TAG = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let referencing = 0;
  for (const page of html) {
    const source = readFileSync(page, "utf8");
    const tags = [...source.matchAll(TAG)];

    for (const [, attrs, body] of tags) {
      if (body.trim() !== "") {
        fail("V4", `${rel(page)} carries an inline <script> body — a page references the bundle, never inlines it`);
        continue;
      }
      const src = /(?:^|\s)src=["']([^"']+)["']/.exec(attrs);
      if (!src) {
        fail("V4", `${rel(page)} has a <script> with neither a body nor a src`);
        continue;
      }
      if (cartUrl && src[1] !== cartUrl) {
        fail("V4", `${rel(page)} loads ${src[1]} — the only script any page may load is ${cartUrl}`);
      }
    }

    const srcs = tags.filter(([, , body]) => body.trim() === "").length;
    if (srcs > 1) fail("V4", `${rel(page)} loads ${srcs} scripts — one file, referenced once`);
    if (srcs === 1) referencing++;
  }

  if (cartUrl && referencing !== html.length) {
    fail("V4", `${referencing} of ${html.length} pages reference the cart`);
    fail("V4", "  The order count is in the shell, so it is on every page or it is lying");
    fail("V4", "  on the ones it is missing from. One bundle, one URL, every page.");
  }

  if (fonts.length !== 2) fail("V4", `expected 2 woff2 in dist/, found ${fonts.length}`);

  // Shared cost every page pays: the fonts, any stylesheet not inlined, and now
  // the cart — every page loads it, so every page is charged for it.
  const shared = files
    .filter((f) => f.endsWith(".css") || f.endsWith(".woff2") || f.endsWith(".js"))
    .reduce((n, f) => n + bytes(f), 0);

  console.log(
    `  V4  output            ${files.length} files, ${html.length} page(s), ${js.length} js, ${fonts.length} fonts, ${referencing}/${html.length} referencing`
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
