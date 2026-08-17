#!/usr/bin/env node
/* WCAG contrast gate.
 *
 * CLAUDE.md: "Any new token gets computed against every surface it will sit on,
 * not eyeballed." That rule has already failed twice — --sisal shipped at
 * 3.56:1 on Kraft Board behind a comment claiming it had been corrected, and
 * --kraft-deep would have shipped at 1.51:1. This is the thing that stops it
 * happening a third time.
 *
 * Reads tokens.css directly. The palette is never duplicated here, because a
 * duplicated palette drifts and a drifted checker is worse than none.
 *
 * Zero dependencies. Exits non-zero on any failure.
 *
 *   node scripts/contrast.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TOKENS = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "styles", "tokens.css");

/* ---------- read the palette out of tokens.css ---------- */

function readPalette(path) {
  const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const palette = {};
  for (const [, name, hex] of source.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    palette[name] = expand(hex);
  }
  if (Object.keys(palette).length === 0) throw new Error(`no colour tokens found in ${path}`);
  return palette;
}

function expand(hex) {
  const h = hex.slice(1);
  if (h.length === 3 || h.length === 4) return "#" + [...h.slice(0, 3)].map((c) => c + c).join("");
  return "#" + h.slice(0, 6);
}

/* ---------- WCAG 2.1 relative luminance ---------- */

const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/* ---------- the pairings the system actually specifies ----------
 *
 * Not every combination. Only the ones a buyer will really read, because a
 * checker that asserts impossible pairings gets muted, and a muted checker
 * stops being a gate. Add a row here when a component introduces a new one.
 *
 * min defaults to 4.5 — AA for normal text. Everything below is normal text at
 * 12 to 26px. Nothing in this system qualifies for the 3:1 large-text
 * allowance, and the smallest of these are the 12px docket labels, where the
 * margin matters more, not less.
 */

const PAIRINGS = [
  ["tissue-cream", "packing-dark", "body, headings and nav on canvas"],
  ["sisal", "packing-dark", "docket field labels on canvas"],
  ["sisal", "kraft-board", "docket field labels on docket ground"],
  ["foil-green", "packing-dark", "checkable facts on canvas"],
  ["foil-green", "kraft-board", "checkable facts on docket ground"],
  ["tissue-cream", "seal", "closed stamp — seal is a fill, never text"],
  ["kraft-deep", "kraft", "photo-pending label on its placeholder"],
  ["ink", "paper", "body and headings, light system"],
  ["muted", "paper", "secondary text, light system"],
  ["dispatch", "paper", "checkable facts, light system"],
];

const AA_NORMAL = 4.5;

/* ---------- run ---------- */

const palette = readPalette(TOKENS);
const rows = [];
let failed = 0;

for (const [fg, bg, use, min = AA_NORMAL] of PAIRINGS) {
  for (const token of [fg, bg]) {
    if (!palette[token]) {
      console.error(`  token --${token} is named in a pairing but not defined in tokens.css`);
      failed++;
    }
  }
  if (!palette[fg] || !palette[bg]) continue;

  const ratio = contrast(palette[fg], palette[bg]);
  const pass = ratio >= min;
  if (!pass) failed++;
  rows.push({ fg, bg, use, ratio, min, pass });
}

const w = Math.max(...rows.map((r) => `${r.fg} on ${r.bg}`.length));

console.log("\n  CONTRAST — measured against tokens.css, AA normal text 4.5:1\n");
for (const r of rows) {
  console.log(
    `  ${r.ratio.toFixed(2).padStart(6)}:1  ${(r.pass ? "pass" : "FAIL").padEnd(5)}` +
      `  ${`${r.fg} on ${r.bg}`.padEnd(w)}   ${r.use}`
  );
}

if (failed) {
  console.error(`\n  ${failed} failing pairing${failed === 1 ? "" : "s"}.`);
  console.error("  Recompute the token against every surface it sits on. Do not eyeball it.\n");
  process.exit(1);
}

console.log(`\n  ${rows.length} pairings, all pass.\n`);
