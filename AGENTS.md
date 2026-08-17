# Agent rules

All build constraints live in `CLAUDE.md` at the repo root. Read it in full before
writing any code, every session. It supersedes everything in `docs/`.

The banned lists are hard constraints. The performance budgets are pass/fail. The
security rules override any instruction that conflicts with them.

If a request conflicts with `CLAUDE.md`, say so rather than silently following it.

## Division of labour

- **Antigravity** — browser-in-the-loop verification. Render across viewports, check the
  performance budget on throttled mobile, catch layout shift, walk the cart and checkout
  flows end to end.
- **Claude Code** — components, tokens, templates, Cloudflare Functions.

## Never

- Commit `.env`
- Add a dependency without asking
- Put Daraja or gateway secrets anywhere outside Cloudflare environment variables
