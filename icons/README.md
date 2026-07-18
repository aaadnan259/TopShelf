# Icons

`icon.svg` is the source of truth. The manifest references four rendered
PNGs (`icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`) that are
**not committed** — generate them once with a rasterizer installed:

```
npm i -D sharp        # recommended, no system dependencies
node scripts/render-icons.mjs
```

`scripts/render-icons.mjs` also accepts ImageMagick, Inkscape, or librsvg
(`rsvg-convert`) if any is already on your PATH.

Until the PNGs exist, the extension loads fine unpacked (Chrome shows a
default puzzle-piece icon) but `scripts/package.sh` will refuse to build a
store zip.
