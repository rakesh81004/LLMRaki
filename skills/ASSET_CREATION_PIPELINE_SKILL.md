# Skill: Creating and Processing Visual Assets (Icons, Logos, Backgrounds)

## Trigger

"Make an icon/logo," "use this image as the background," anything involving a new
`.png`/`.svg`/`.icns` file, or a pasted/clipboard image that needs to become a real
asset file in the project.

## No design tools are available — work with what macOS ships

This environment has no `rsvg-convert`, ImageMagick, or Inkscape. The pipeline that
actually works, built entirely from macOS built-ins:

1. **Author the graphic as hand-written SVG.** For an icon/logo, this means writing
   real `<polygon>`/`<circle>`/`<linearGradient>` markup with actual computed
   coordinates (hexagon vertices via trig, gradient stops chosen deliberately) — not
   a placeholder. Treat it like real vector art: define gradients in `<defs>`,
   compute vertex positions from the shape's geometry, layer facets/highlights for
   depth.
2. **Render the SVG to PNG** with QuickLook's thumbnailer, since nothing else is
   installed:
   ```
   qlmanage -t -s 1024 -o . icon.svg
   ```
   This produces `icon.svg.png` at the requested size.
3. **Resize down to smaller sizes** with `sips`:
   ```
   sips -s format png -Z <size> source.png --out output.png
   ```
   **Critical gotcha**: without `-s format png` explicit, `sips -Z <size> input.jpg
   --out output.png` silently keeps the *source* encoding (JPEG) despite the `.png`
   extension on the output filename. This bit twice in this project before the
   pattern was internalized. **Always run `file <output>` after every `sips`
   conversion** to confirm the actual encoding matches the extension — don't trust
   the filename.
4. **Package a macOS `.icns`** from a set of PNGs via an iconset folder:
   ```
   mkdir icon.iconset
   # populate icon_16x16.png, icon_16x16@2x.png, icon_32x32.png, ... icon_512x512@2x.png
   iconutil -c icns icon.iconset --output build/icon.icns
   ```
   electron-builder picks this up automatically by convention if
   `directories.buildResources` in `package.json` points at `build/`.

## Extracting an image the user pasted (no file path given)

When the user pastes an image directly rather than providing a file, and there's no
accessible file path, macOS's clipboard can be read via AppleScript — but the naive
approach produces garbage:

```
osascript -e 'the clipboard as «class PNGf»' > file.png   # WRONG — not real PNG bytes
```

This produces literal *text* — AppleScript's hex-wrapped textual representation
(`«data PNGf<hex...>»`), not binary PNG data. The fix: capture that text, then
decode the hex in Python:

```python
data = raw.removeprefix('«data PNGf').removesuffix('»')
png_bytes = bytes.fromhex(data)
```

Verify with `file <output>` (should say "PNG image data") **and** actually view the
result with the Read tool before using it as an asset — confirm it visually matches
what the user pasted, since a hex-decode bug would still produce *a* file, just a
corrupt or wrong one.

## Sizing/compression discipline

A pasted or exported image is often far larger than needed (a 4K, multi-megabyte PNG
used as a CSS background banner). Before committing it to the repo:
- Resize to the actual rendered size class (e.g. ~1920px wide for a hero banner),
  not the original capture resolution.
- Convert to JPEG at a reasonable quality (`sips -s format jpeg -s formatOptions 82`)
  for photographic/gradient content — PNG is right for icons/logos with flat color
  and transparency, not for a busy photographic background.
- Check the resulting file size is proportionate (tens to low hundreds of KB for a
  background image, not multiple MB) before treating the asset as done.
- Delete the old/superseded asset file once nothing references it — grep for the
  import first to be sure.

## Iterating on a hand-authored design

When asked to adjust a custom SVG ("add more color," "make it thicker," "make the
inside less simple"), edit the actual SVG source (stroke widths, gradient stops,
added geometry) and re-render through the same pipeline — don't just tweak the
rendered PNG in place. Re-view the rendered result with the Read tool before
finalizing, the same way you'd review any other output before shipping it.
