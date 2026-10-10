# Cricut Color Studio

**Version:** 1.1.0  
**Purpose:** Turn an uploaded image into color-separated SVG layers for Cricut Design Space.  
**Hosting:** GitHub Pages (static site)  
**Processing:** Browser-only; no image uploads, accounts, AI APIs, or application backend.

## V1 features

- Responsive desktop and mobile layout.
- PNG, JPG, and WebP image upload.
- Optional edge-connected white/near-white background removal that preserves enclosed white details.
- 4-, 8-, and 12-color simplification presets.
- Connected color-region detection and vector path generation.
- Individual layer preview and combined design preview.
- Four-color Simple mode is selected by default.
- Flat Color workflow groups similar shades and smooths isolated pixel-label noise.
- Optional experimental separate black linework layer.
- Per-layer visibility toggles: hidden layers are omitted from the preview and combined/separate SVG exports without deleting their geometry.
- Draggable crop preview with percentage fine-tuning.
- Light vector contour simplification to reduce pixel stair-steps while preserving larger features.
- Finished-size-aware cleanup presets: Fine detail, Balanced, and Easy cut.
- Advanced physical-area override for tiny-region filtering.
- Optional merging of visually similar palette colors.
- New optional Flatten Shading control (Subtle, Moderate, Strong) to combine tonal variants of a color while protecting near-black linework; off by default.
- Crop controls for trimming borders or watermarks.
- Warnings for layers with high region counts or small average pieces.
- Combined SVG export and ZIP export containing per-color SVGs plus a quick-start guide.
- Material-specific reminders for adhesive vinyl, cardstock/paper, and HTV.

## Run locally

Open `index.html` in a modern browser, or use a static local server. No build step is required.

The ZIP export uses JSZip from jsDelivr CDN. The core image processing and combined SVG export work locally in the browser. An internet connection is needed to load JSZip for ZIP packaging and Google Fonts for optional typography.

## Publish with GitHub Pages

1. Create a repository named `Cricut-Color-Studio` (or another name you prefer).
2. Upload the **contents** of this project folder to the repository root, not the outer folder.
3. Commit the files to `main`.
4. In repository **Settings → Pages**, select **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
5. Wait for GitHub Pages to publish the site.

## How the vectorizer works

The app scales the image to a maximum dimension of 700 pixels, optionally makes edge-connected near-white background pixels transparent, reduces only visible pixels to a color palette with a browser-side k-means palette, detects 4-connected regions, filters tiny components using a minimum physical-area threshold derived from the selected finished width, and traces pixel boundaries into closed SVG paths. Paths are simplified by removing collinear points.

This is an initial, deterministic V1 converter—not a professional illustration reconstruction tool. Shaded or photographic images may create many irregular patches. For best results, start with clear illustrations, cartoons, logos, and flat-color artwork.

## V1.0.5.1 cleanup and crop

The default workflow targets four colors and enables similar-color merging. A one-pass label smoother only replaces isolated color speckles when a neighboring label strongly dominates; it does not blur or smooth vector paths directly. The optional black linework layer extracts very dark, low-saturation source pixels into a separate black cut layer, so inspect it carefully. The Fine detail, Balanced, and Easy cut presets use approximate minimum piece areas of 0.25, 1, and 3 mm² respectively, converted to pixel area using the chosen finished width. This is a heuristic, not a guarantee of minimum cuttable width; thin shapes may still be fragile. Advanced options can override the preset. Similar-color merging combines palette centers within an RGB Euclidean distance of 48. Crop values trim percentages from each image edge and can be reset.

## Important Cricut notes

- SVG geometry is vectorized; the original bitmap is not embedded as the cutting artwork.
- Cricut Design Space may import all groups as Basic Cut. SVG group metadata is not a guaranteed way to assign Cricut Draw operations.
- The Advanced draw-outline option is experimental: it traces the boundaries of dark regions and does **not** calculate true centerlines. It may produce doubled or unsuitable pen lines. Inspect it carefully in Design Space.
- HTV often needs mirroring before cutting; follow the instructions for the specific material and Design Space workflow.
- Choose the correct machine, tool, and material settings in Design Space. Test intricate projects on scrap material.

## Privacy

Image processing occurs locally in the browser. The app does not send images to a server. When hosted online, the static site itself is served by GitHub Pages; the ZIP helper and optional fonts load from third-party CDNs.

## Versioning

- Application version: `1.1.0`
- SVG export metadata and project guide identify the app version.
- Future releases should update the app version in `index.html`, `js/app.js` comments, and this README.

## License

Project code is provided under the MIT License. See `LICENSE`.


## V1.0.5.1 notes

- Color layer checkboxes control whether a layer appears in the composite preview and whether it is exported. Hidden layer geometry remains in memory and can be restored by checking the layer again; it is not deleted or regenerated. “Show all” and “Hide all” are available.
- Advanced crop controls now include a visual preview. Drag the purple edge handles or adjust the percentage fields, then select Apply crop to regenerate the design.
- Vector contours receive a conservative ~1-pixel simplification after collinear edges are merged. Inspect facial details and fine regions at the intended finished size before cutting.
- All processing remains in the browser; there is no AI API or application backend. The ZIP download uses the existing JSZip CDN dependency.


V1.0.5.1 hotfix: versioned the stylesheet URL to prevent browsers from reusing cached CSS from the previous layer-panel layout.


## V1.0.6 cleanup and export validation

- Retains the selected-layer export rule: disabled layers are omitted from the combined SVG and from the per-color ZIP exports.
- Adds conservative detection for a word-like cluster of small, separate components near the lower-right edge, a common location for source-image watermarks. When detected, the cluster is removed before vectorization and the app reports the pixel count so the preview can be checked. This heuristic is intentionally narrow and may not identify watermarks elsewhere; use the crop controls when a watermark overlaps artwork or is in another location.
- Reports when tiny regions are removed and keeps the finished-size-aware minimum-piece-area controls.
- SVG descriptions and the ZIP quick-start guide identify version 1.0.6.
- Browser-only processing; no server or image upload is introduced.


## V1.0.7 cross-browser consistency fix

Safari and Chrome could export different palettes and path counts from the same image. Causes and fixes:

- **Quantizer rewritten.** The old k-means seeded centers by luminance quantile, ran a fixed 7 iterations on a strided sample, and used mean colors, so small accent colors (e.g. orange) could be absorbed into blends such as muted green. The new quantizer is deterministic: 5-bit histogram, weight-aware farthest-point seeding, k-means to convergence, and each palette color snapped to the most common real color in its cluster. Merged groups keep the color of their heaviest member.
- **Downscale done in JS.** The image is decoded at (up to) full size and reduced with an area-average filter instead of `drawImage` resampling, which differs between browsers. Canvas is requested in sRGB. Sources above 12 MP are pre-shrunk by the browser to respect iOS canvas limits.
- Removed a duplicate `clearRect` and a no-op `.replace`.

Remaining browser differences can come only from how each browser decodes the file and handles embedded ICC color profiles. For identical results, export source art as sRGB PNG.


## V1.0.7.1 flatten-shading fixes

- **Anchored grouping.** Flatten used transitive union-find, so a gradient of small steps collapsed into one color regardless of the Subtle/Moderate/Strong limit. Colors are now processed heaviest-first and may only join a group whose anchor (heaviest member) is within the limits.
- **Oversample, then reduce.** With flatten on, the palette is built at max(selected count, 12) colors, tonal variants are combined, and the result is reduced back to the selected count by merging the cheapest pair (pixel-weighted). Previously flatten could only leave fewer layers than requested.
- **Live update.** Changing the Flatten shading dropdown now re-runs processing immediately.
- Shared `DARK_LUM` (48) constant for flatten protection and the black-outline mask.
- Label remapping uses typed lookup tables instead of array spreading.
- While flatten is on, the RGB "Merge similar colors" pass is skipped (flatten does its own anchored merging). That pass is transitive and, with the 12-color oversample, collapsed whole shade ramps before flatten could act.


## Version 1.0.9

- Added a copyable AI simplification prompt above the crop tool in Advanced Options. AI processing remains external and optional; this app still performs local vectorization and SVG export.
- Added conservative cleanup for tiny, isolated, highly elongated sliver artifacts. Removed pixels are reported for review.
- When Merge Similar Colors is enabled, similar very-dark palette variants are merged even when Flatten Shading is active; charcoal tones above the near-black cutoff remain eligible to stay distinct.
- Updated flattening help text, version labels, and cache-busting URLs.
- Preserve v1.0.7.2 as a fallback while testing.


## Version 1.0.9

- Added experimental **Simplify for Cutting** mode.
- Applies additional conservative color-label smoothing before vector tracing.
- Fills only small transparent holes fully enclosed by artwork; canvas-edge transparency is preserved.
- Existing layer alignment, palette controls, and exports remain unchanged.
- Validate on detailed artwork before cutting; this is a conservative first implementation, not a guarantee that every small shape is unwanted.


## Version 1.0.9.1: Simplify for Cutting fix

- **Checkbox now works immediately.** `simplifyForCutting` re-processes on change like the other options.
- **Reassign instead of delete.** Previously, tiny pieces were deleted at trace time (and slivers set to transparent), leaving hundreds of specks that the hole-filler never saw because it ran earlier. Simplify now runs before any deletion: a 5x5 plurality filter removes thin halos, then every piece below the minimum size is recolored to the neighbor it touches most.
- **Thickness-aware.** The filter radius derives from a 1 mm minimum feature size and the design width.
- Sliver removal is skipped in Simplify mode (those fragments are already absorbed). The normal cleanup path is unchanged when Simplify is off.
- A warnings-panel note reports how many pieces were merged.
- ZIP guide version string corrected.


## Version 1.0.9.2: Simplify strength and new defaults

- **Simplify strength dropdown** replaces the checkbox: Off, Light (3 mm²), Medium (6 mm², default), Strong (12 mm²), Maximum (20 mm²). Each level sets both a minimum piece area and a minimum feature thickness (0.6 / 1.0 / 1.5 / 2.0 mm) for the smoothing radius.
- **New defaults:** Cut detail = Easy cut; Simplify = Medium. Flatten shading stays Off (image dependent).
- **Minimum piece area** now offers 10, 12 and 20 mm², and re-processes on change. Changing the finished width also re-processes, since all thresholds are real-world sizes.
- **Layer list** shows how many pieces per layer are under 8 mm².
- ZIP guide records the Simplify strength and the minimum piece area override.


## Version 1.1.0: friendlier, safer, fewer pieces

Made so a young maker can use it without help. All the Advanced controls are kept.

- **Plain-language screens.** Friendly labels and help text ("How many colors?", "What will you cut?", "How easy to cut?"), layers show "pieces" and "tiny" instead of regions, pixels and mm², and the warnings are short and kind.
- **Message about how hard the design is.** Under 60 pieces with no tiny ones: "Nice and simple!". Over 100 pieces: a gentle "tricky" note with what to try.
- **Show tiny pieces in red** (preview only, never exported). A tiny piece is under 8 mm².
- **Grown-up note and next steps.** A short safety note (blade, and heat for iron-on) and a three-step "What to do next" card for Design Space.
- **Thin shapes are protected.** The smoothing filter can no longer break a ring or a narrow neck into separate pieces (the Batman emblem problem). Anything it would have split is left as it was.
- **Tiny pieces are recolored in every mode**, including Simplify = Off. Cleanup no longer deletes pieces and leaves transparent specks. "Keep all pieces" still keeps everything.
- **Hidden colors are remembered** when you change a setting. Colors are matched approximately, and the memory is cleared for a new picture or Start over.
- **Layer overlap (Advanced)**: Off, 0.3 mm or 0.5 mm. For side-by-side vinyl, lighter colors slide a little under the darker ones so hairline gaps do not show. Lighter colors are drawn first in the combined SVG when overlap is on.
- **Automated tests** in `tests/`. Run `node tests/run-tests.js` (no install needed). They check version strings, palette stability, specks, piece counts, protection of thin shapes, recoloring, overlap and color matching. Run them after every change.
