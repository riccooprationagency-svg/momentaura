#!/usr/bin/env node
/* Constraint gate. Wraps the checks from the step 1 verification plan that can
 * run without a browser.
 *
 *   V1  dependency surface — Astro and nothing else
 *   V2  no raw hex outside tokens.css
 *   V3  --accent referenced exactly once in the whole source tree
 *   V4  build output shape and page weight
 *   V6  banned constructs
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
import { dirname, join, relative, extname } from "node:path";

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
 * failure. The two breakpoints are declared in a comment at the top of
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
  const ALLOWED = new Set(["0", "0px", "1px", "2px", "-1px", "100%", "1fr"]);
  const UNIT =
    /-?\d*\.?\d+(px|rem|em|ex|ch|%|vw|vh|dvh|svh|lvh|vmin|vmax|pt|pc|cm|mm|in|deg|rad|turn|ms|s|fr)\b/gi;

  const strip = (s) =>
    stripComments(s)
      .split(/\r?\n/)
      .map((l) => (l.includes("://") ? l : l.replace(/\/\/.*$/, "")))
      .join("\n");

  let hits = 0;
  for (const file of sourceFiles.filter((f) => !f.endsWith("dev-guards.css"))) {
    strip(readFileSync(file, "utf8"))
      .split(/\r?\n/)
      .forEach((rawLine, i) => {
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

    for (const [re, label, scanComments] of BANNED) {
      const lines = (scanComments ? raw : stripped).split(/\r?\n/);
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
