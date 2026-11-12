/* What a stated time has to be before it reaches a page.
 *
 * Plain JS, not TS, for one reason: scripts/verify.mjs imports it. lib/site.ts
 * runs it over every timing in site.json at build time and throws, and V18 runs
 * it over fixtures, so the rule a buyer is protected by and the rule the gate
 * proves it works are the same function rather than two copies that drift.
 *
 * A timing is refused when it:
 *   - is empty
 *   - leans on a word that states no figure ("fast", "soon")
 *   - is a bare range with no unit ("2-5"), which a buyer cannot hold anyone to
 *   - carries an exclamation mark, which CLAUDE.md bans outright
 *
 * The range check anchors the upper bound with \b. Without it, "10-30 minutes"
 * is rejected: the engine backs off to "0-3", where the lookahead sees "0" and
 * not a unit, and calls the range bare.
 */

export const VAGUE = /\b(fast|faster|quick|quickly|express|asap|soon|shortly|swift|speedy|seamless|effortless|premium)\b/i;
export const BARE_RANGE = /\d\s*[-–]\s*\d+\b(?!\s*[a-z])/i;

/** Why a timing cannot be shown, or null when it can. */
export function timingProblem(text) {
  if (typeof text !== "string" || text.trim() === "") return "is empty";
  if (VAGUE.test(text)) return "states no figure a buyer can check";
  if (BARE_RANGE.test(text)) return "a range needs its unit";
  if (text.includes("!")) return "carries an exclamation mark";
  return null;
}
