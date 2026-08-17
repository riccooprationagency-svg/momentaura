# Font setup

Two families. Both free, both variable, both self-hosted. Never load from Google's CDN —
it costs a third-party DNS lookup and connection on a Kenyan mobile connection, and it
is a privacy liability under the Data Protection Act.

## Install

```bash
npm i @fontsource-variable/archivo @fontsource-variable/jetbrains-mono
```

Fontsource ships variable woff2 files into `node_modules`. Copy the two you need into
`public/fonts/` and delete the rest — you want two files total, not a directory of
static weights.

```bash
mkdir -p public/fonts
cp node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2 \
   public/fonts/archivo.woff2
cp node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2 \
   public/fonts/jetbrains-mono.woff2
```

**Latin subset only.** The full character set is roughly three times the size and none
of it renders on this site.

Fontsource is a build-time convenience, not a dependency. Install it, copy the two
files, then `npm uninstall` both packages. The committed `package.json` carries Astro
and nothing else.

Alternative without npm: download the variable woff2 from Google Fonts or
`github.com/JetBrains/JetBrainsMono/releases` and drop them in `public/fonts/`.

## Provenance

The two binaries in `public/fonts/` are committed without a lockfile entry, so their
origin is recorded here instead. Re-derive and compare these hashes before replacing
either file.

| | Archivo | JetBrains Mono |
|---|---|---|
| Package | `@fontsource-variable/archivo` | `@fontsource-variable/jetbrains-mono` |
| Version | 5.3.0 | 5.3.0 |
| Source path | `files/archivo-latin-wght-normal.woff2` | `files/jetbrains-mono-latin-wght-normal.woff2` |
| Committed as | `public/fonts/archivo.woff2` | `public/fonts/jetbrains-mono.woff2` |
| Bytes | 34,928 | 40,404 |
| SHA-256 | `8f704806dbedeaaeca334b11ec348bc3ac3a439d6431544b3afb54f534ee4967` | `18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e` |
| Axis | `wght` only | `wght` only |
| Licence | SIL Open Font Licence 1.1 | SIL Open Font Licence 1.1 |

Copied 17 August 2026. Both are the `wght` variable file, not `wdth`, and not a
static weight. Total 75,332 bytes — under the 80KB ceiling below.

## Declare

```css
@font-face {
  font-family: "Archivo";
  src: url("/fonts/archivo.woff2") format("woff2-variations");
  font-weight: 400 600;
  font-display: swap;
  font-style: normal;
}

@font-face {
  font-family: "JetBrains Mono";
  src: url("/fonts/jetbrains-mono.woff2") format("woff2-variations");
  font-weight: 400 500;
  font-display: swap;
  font-style: normal;
}
```

## The metric-matched fallback

`font-display: swap` renders text immediately in a system font and swaps when Archivo
lands. That is the right trade on a slow connection, but the swap reflows the page
unless the fallback occupies the same space. A third `@font-face` fixes that. It
downloads nothing — `local()` only — and costs about six lines.

```css
@font-face {
  font-family: "Archivo Fallback";
  src: local("Arial"), local("Helvetica Neue"), local("Helvetica"), local("Roboto");
  size-adjust: 101.61%;
  ascent-override: 86.41%;
  descent-override: 20.67%;
  line-gap-override: 0%;
}
```

It sits second in `--font-sans`, immediately after Archivo.

**These numbers are derived, not estimated.** Read from the actual binaries: Archivo
unitsPerEm 1000, hhea ascender 878, descender −210, lineGap 0, weighted average advance
0.45650em. Arial unitsPerEm 2048, weighted average advance 0.44928em. Both averages are
weighted by English letter frequency including the space. `size-adjust` is the ratio of
the two averages; the three vertical overrides restate Archivo's own metrics against
that scale.

`size-adjust` is tuned to Arial, and Helvetica is near-identical. Android's Roboto is
not, so the horizontal match is approximate there — but the three vertical overrides
are absolute and correct the line box whichever local face is picked, which is where
most of the shift lives.

## Preload — Archivo only

```html
<link rel="preload" href="/fonts/archivo.woff2" as="font" type="font/woff2" crossorigin>
```

Archivo renders above the fold on every page. JetBrains Mono appears in dockets, which
sit lower — preloading both competes for bandwidth and delays first paint.

## Budget

Roughly 30–40KB per file, latin subset, variable. Under 80KB total against a 500KB
homepage budget. Measured at step 1: 34,928 + 40,404 = 75,332 bytes.

Two downloaded files. Three `@font-face` blocks — two for those files, one for the
`local()` fallback, which adds no bytes.

`font-display: swap` is deliberate: text renders immediately in the fallback and swaps
when the font lands. On a slow connection a visible fallback beats invisible text.

## Rules

- Never a third weight file. Variable axes cover 400–600
- Never italic. Not in the system
- Never a third *downloaded* family. The metric-matched `local()` fallback above is
  not a third family — it fetches nothing and exists to stop the swap reflowing
- Never `font-weight` above 600, and 600 only in the logo
