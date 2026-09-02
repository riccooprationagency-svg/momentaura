# MomentAura

Apparel and accessories. Nairobi, Kenya. Prices in KSh, payment by M-Pesa.

Astro, static output, deployed to Cloudflare Pages. No React, no Tailwind, no UI
library. Plain CSS with custom properties.

```bash
npm install
npx astro telemetry disable    # see below — once per machine
npm run dev                    # localhost:4321
npm run build                  # -> dist/
```

**Telemetry is off, but that setting is global, not repo-scoped.** Astro stores it in
a per-user config outside this directory, so it does not travel with a clone. Every
fresh machine and every CI runner needs `npx astro telemetry disable` again. Sending
anonymous build data to a third party is not something this project should do silently
given the Data Protection Act reasoning in `FONT-SETUP.md`.

## Gates

```bash
cp scripts/pre-commit .git/hooks/pre-commit   # once per clone — see below
node scripts/contrast.mjs                     # WCAG, reads tokens.css directly
node scripts/verify.mjs                       # hex, accent, banned list, budget
node scripts/checkout-test.mjs                # the endpoint that touches money
```

All three run on every commit. Zero dependencies, plain Node.

`scripts/contrast.mjs` asserts every specified colour pairing against the real token
values. `scripts/verify.mjs` asserts no raw hex outside `tokens.css`, the accent only at
its two sanctioned sites — the docket's fact row and the input focus underline, each
pinned to its own selector rather than to a count — no banned constructs, one named
script under budget, and page weight against the 500KB homepage budget.

`scripts/checkout-test.mjs` exercises `functions/api/checkout.js`, which the other two
never load: `functions/` is outside the Astro build, so a broken money endpoint passes
every other gate. It runs the shipped handler on Node's own fetch primitives and proves
the rules that matter there — a client price is ignored, an unknown slug is rejected, a
sold-out product is named rather than dropped, and no gateway detail ever reaches the
browser. It cannot prove anything about a live gateway and does not claim to.

Any of the three failing refuses the commit.

**`.git/hooks/` is not version controlled, so a fresh clone has no gates until you run
that copy.** Do it first, before writing anything. The accent rule is the constraint
CLAUDE.md ranks as most important and it erodes silently — nothing fails, the build
passes, the page looks right, and the signal quietly stops meaning anything.

`SKIP_BUILD=1 git commit` skips the rebuild; `git commit --no-verify` skips the gates
entirely. Reach for the second one roughly never.

## Reading order

`CLAUDE.md` is authoritative and supersedes everything in `docs/`. Read it in full
before writing any code. `AGENTS.md` carries the division of labour, `BUILD-ORDER.md`
the sequence, `FONT-SETUP.md` the type provenance.

`docs/` is reasoning and history, not instruction. Parts of it predate the move from
corporate gifting to apparel and are wrong about the product. Where `docs/` and
`CLAUDE.md` disagree, `CLAUDE.md` wins.

## Where the build is

Step 1 of `BUILD-ORDER.md` complete — tokens, fonts, global stylesheet, layout
primitives. Step 2 is the layout shell.

## Two rules worth knowing before you touch anything

**The accent is a claim, not a colour.** `--foil-green` and `--dispatch` mean exactly
one thing: this fact can be checked. They appear on lead times, dispatch points, stock
and run counts, and nowhere else — never a headline, a button fill, a hover state or
the logo. One misuse costs the signal across the whole site.

**A product without a real photograph renders light.** The dark editorial system is
the product photograph; without one it is an empty rectangle that reads as a site
under construction. `product.photo === null` renders light with an honest kraft
placeholder. Never dark with a placeholder inside it.
