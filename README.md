# Cricut Color Studio

**Version:** 1.0.3  
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
- Finished-size-aware cleanup presets: Fine detail, Balanced, and Easy cut.
- Advanced physical-area override for tiny-region filtering.
- Optional merging of visually similar palette colors.
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

## V1.0.3 cleanup and crop

The Fine detail, Balanced, and Easy cut presets use approximate minimum piece areas of 0.25, 1, and 3 mm² respectively, converted to pixel area using the chosen finished width. This is a heuristic, not a guarantee of minimum cuttable width; thin shapes may still be fragile. Advanced options can override the preset. Similar-color merging combines palette centers within an RGB Euclidean distance of 48. Crop values trim percentages from each image edge and can be reset.

## Important Cricut notes

- SVG geometry is vectorized; the original bitmap is not embedded as the cutting artwork.
- Cricut Design Space may import all groups as Basic Cut. SVG group metadata is not a guaranteed way to assign Cricut Draw operations.
- The Advanced draw-outline option is experimental: it traces the boundaries of dark regions and does **not** calculate true centerlines. It may produce doubled or unsuitable pen lines. Inspect it carefully in Design Space.
- HTV often needs mirroring before cutting; follow the instructions for the specific material and Design Space workflow.
- Choose the correct machine, tool, and material settings in Design Space. Test intricate projects on scrap material.

## Privacy

Image processing occurs locally in the browser. The app does not send images to a server. When hosted online, the static site itself is served by GitHub Pages; the ZIP helper and optional fonts load from third-party CDNs.

## Versioning

- Application version: `1.0.3`
- SVG export metadata and project guide identify the app version.
- Future releases should update the app version in `index.html`, `js/app.js` comments, and this README.

## License

Project code is provided under the MIT License. See `LICENSE`.
