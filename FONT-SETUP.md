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

Alternative without npm: download the variable woff2 from Google Fonts or
`github.com/JetBrains/JetBrainsMono/releases` and drop them in `public/fonts/`.

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

## Preload — Archivo only

```html
<link rel="preload" href="/fonts/archivo.woff2" as="font" type="font/woff2" crossorigin>
```

Archivo renders above the fold on every page. JetBrains Mono appears in dockets, which
sit lower — preloading both competes for bandwidth and delays first paint.

## Budget

Roughly 30–40KB per file, latin subset, variable. Under 80KB total against a 500KB
homepage budget. Two files, two `@font-face` blocks, no exceptions.

`font-display: swap` is deliberate: text renders immediately in the fallback and swaps
when the font lands. On a slow connection a visible fallback beats invisible text.

## Rules

- Never a third weight file. Variable axes cover 400–600
- Never italic. Not in the system
- Never a third family
- Never `font-weight` above 600, and 600 only in the logo
