# MomentAura

Apparel and accessories. Nairobi, Kenya. Prices in KSh, payment by M-Pesa.

Astro, static output, deployed to Cloudflare Pages. No React, no Tailwind, no UI
library. Plain CSS with custom properties.

```bash
npm install
npm run dev      # localhost:4321
npm run build    # -> dist/
```

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
