/* Cricut Color Studio v1.1.0 — browser-only image processing */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const state = { image: null, originalImage: null, fileName: "my-design", count: 4, layers: [], selected: -1, width: 6, merge: true, backgroundRemoved: true, backgroundPixelCount: 0, crop: {top:0,right:0,bottom:0,left:0}, hiddenColors: [], overlapMM: 0, cleanupStats: {watermarkPixels:0, tinyPixels:0, sliverPixels:0, holePixels:0, recoloredPixels:0, absorbedPieces:0, splitsProtected:0} };
  const canvas = $("workCanvas"), ctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  const fileInput = $("fileInput");
  const paletteButtons = [...document.querySelectorAll("[data-colors]")];

  // Area-average (box) downscale with alpha-premultiplied accumulation. Pure JS, so the result
  // does not depend on the browser's canvas resampling filter.
  function boxDownscale(src, outW, outH) {
    const sw = src.width, sh = src.height, sd = src.data;
    if (sw === outW && sh === outH) return new ImageData(new Uint8ClampedArray(sd), sw, sh);
    const out = new ImageData(outW, outH), od = out.data;
    const xs = sw / outW, ys = sh / outH;
    for (let oy = 0; oy < outH; oy++) {
      const y0 = oy * ys, y1 = (oy + 1) * ys, iy0 = Math.floor(y0), iy1 = Math.min(sh, Math.ceil(y1));
      for (let ox = 0; ox < outW; ox++) {
        const x0 = ox * xs, x1 = (ox + 1) * xs, ix0 = Math.floor(x0), ix1 = Math.min(sw, Math.ceil(x1));
        let r = 0, g = 0, b = 0, a = 0, wsum = 0;
        for (let y = iy0; y < iy1; y++) {
          const wy = Math.min(y + 1, y1) - Math.max(y, y0);
          for (let x = ix0; x < ix1; x++) {
            const wgt = wy * (Math.min(x + 1, x1) - Math.max(x, x0)), i = (y * sw + x) * 4, al = sd[i+3] / 255;
            r += sd[i] * al * wgt; g += sd[i+1] * al * wgt; b += sd[i+2] * al * wgt; a += al * wgt; wsum += wgt;
          }
        }
        const o = (oy * outW + ox) * 4;
        if (a > 0 && wsum > 0) { od[o] = Math.round(r / a); od[o+1] = Math.round(g / a); od[o+2] = Math.round(b / a); od[o+3] = Math.round(255 * a / wsum); }
      }
    }
    return out;
  }

  function safeName(s) { return (s || "my-design").replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "my-design"; }
  function escapeXml(s) { return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c])); }
  function showError(message) {
    let el = $("errorMessage");
    if (!el) { el = document.createElement("div"); el.id = "errorMessage"; el.className = "error"; $("uploadPanel").appendChild(el); }
    el.textContent = message;
  }
  function clearError() { const el = $("errorMessage"); if (el) el.remove(); }

  async function loadFile(file) {
    clearError();
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) { showError("Please choose a PNG, JPG, or WebP image."); return; }
    if (file.size > 18 * 1024 * 1024) { showError("That image is larger than 18 MB. Try a smaller copy for this first version."); return; }
    try {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxSide = 700;
        const nw = img.naturalWidth, nh = img.naturalHeight;
        const scale = Math.min(1, maxSide / Math.max(nw, nh));
        const outW = Math.max(1, Math.round(nw * scale)), outH = Math.max(1, Math.round(nh * scale));
        // Decode at (up to) full size, then downscale in JS with an area-average filter.
        // Browser drawImage() resampling differs between Chrome and Safari; doing the
        // downscale ourselves gives both browsers the same pixels. Very large sources are
        // pre-shrunk by the browser first to stay under canvas memory limits (notably iOS Safari).
        const MAX_DECODE_PIXELS = 12000000;
        let decW = nw, decH = nh;
        if (nw * nh > MAX_DECODE_PIXELS) { const f = Math.sqrt(MAX_DECODE_PIXELS / (nw * nh)); decW = Math.max(outW, Math.floor(nw * f)); decH = Math.max(outH, Math.floor(nh * f)); }
        canvas.width = decW; canvas.height = decH;
        ctx.clearRect(0, 0, decW, decH);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, decW, decH);
        const full = ctx.getImageData(0, 0, decW, decH);
        state.originalImage = boxDownscale(full, outW, outH);
        canvas.width = 1; canvas.height = 1; // release the large decode buffer
        renderCropSource();
        state.image = new ImageData(new Uint8ClampedArray(state.originalImage.data), state.originalImage.width, state.originalImage.height);
        state.fileName = safeName(file.name);
        state.hiddenColors = [];
        state.crop = {top:0,right:0,bottom:0,left:0};
        ["cropTop","cropRight","cropBottom","cropLeft"].forEach(id => { if ($(id)) $(id).value = 0; });
        applyBackgroundSetting();
        $("uploadPanel").classList.add("hidden");
        $("workspace").classList.remove("hidden");
        $("results").classList.add("hidden");
        clearError();
        processImage();
      };
      img.onerror = () => { URL.revokeObjectURL(url); showError("Sorry, this image could not be opened. Please try another file."); };
      img.src = url;
    } catch (e) { showError("We couldn't load that image. Please try another one."); }
  }
  fileInput.addEventListener("change", e => loadFile(e.target.files[0]));
  $("uploadPanel").addEventListener("dragover", e => { e.preventDefault(); $("uploadPanel").style.background = "#f6f2ff"; });
  $("uploadPanel").addEventListener("dragleave", () => $("uploadPanel").style.background = "");
  $("uploadPanel").addEventListener("drop", e => { e.preventDefault(); $("uploadPanel").style.background = ""; loadFile(e.dataTransfer.files[0]); });
  $("startOverBtn").addEventListener("click", () => {
    state.image = null; state.layers = []; state.hiddenColors = []; fileInput.value = "";
    $("workspace").classList.add("hidden"); $("uploadPanel").classList.remove("hidden"); clearError();
  });
  paletteButtons.forEach(btn => btn.addEventListener("click", () => {
    paletteButtons.forEach(b => b.classList.toggle("selected", b === btn));
    state.count = Number(btn.dataset.colors);
    if (state.image) processImage();
  }));
  $("mergeBtn").textContent = state.merge ? "Stop merging colors" : "Merge similar colors";
  $("processBtn").addEventListener("click", processImage);
  $("rebuildBtn").addEventListener("click", processImage);
  $("mergeBtn").addEventListener("click", () => {
    state.merge = !state.merge;
    $("mergeBtn").textContent = state.merge ? "Stop merging colors" : "Merge similar colors";
    processImage();
  });
  $("material").addEventListener("change", updateMaterialHelp);
  $("removeBackground").addEventListener("change", () => { applyBackgroundSetting(); if (state.image) processImage(); });
  $("cleanupPreset").addEventListener("change", () => { if ($("minRegion").value === "auto" && state.image) processImage(); });
  $("addBlackOutlines").addEventListener("change", () => { if (state.image) processImage(); });
  $("flattenShading").addEventListener("change", () => { if (state.image) processImage(); });
  $("simplifyStrength").addEventListener("change", () => { if (state.image) processImage(); });
  $("layerOverlap").addEventListener("change", () => { if (state.image) processImage(); });
  $("showTinyPieces").addEventListener("change", () => renderComposite());
  $("minRegion").addEventListener("change", () => { if (state.image) processImage(); });
  $("designWidth").addEventListener("change", () => { if (state.image) processImage(); });
  $("applyCropBtn").addEventListener("click", () => {
    const nextCrop = {
      top: clampPercent($("cropTop").value),
      right: clampPercent($("cropRight").value),
      bottom: clampPercent($("cropBottom").value),
      left: clampPercent($("cropLeft").value)
    };
    if (nextCrop.left + nextCrop.right > 60 || nextCrop.top + nextCrop.bottom > 60) {
      alert("Please leave at least 40% of the image visible in each direction."); return;
    }
    state.crop = nextCrop;
    applyBackgroundSetting(); if (state.image) processImage();
  });
  $("resetCropBtn").addEventListener("click", () => {
    state.crop = {top:0,right:0,bottom:0,left:0};
    ["cropTop","cropRight","cropBottom","cropLeft"].forEach(id => $(id).value = 0);
    updateCropOverlay(); applyBackgroundSetting(); if (state.image) processImage();
  });
  ["cropTop","cropRight","cropBottom","cropLeft"].forEach(id => $(id).addEventListener("input", updateCropOverlay));
  setupCropDragging();
  const aiPrompt = `Edit the attached image directly to prepare it for layered vinyl cutting or screen printing.

Preserve the original subject, pose, composition, proportions, and recognizable details. Do not redesign the subject or add new elements.

SIMPLIFY THE ARTWORK
- Remove the background completely and return a transparent background.
- Reduce the image to approximately 4–6 solid colors, including black where appropriate.
- Flatten highlights and shadows by merging closely related shades into broader color regions.
- Remove gradients, texture, noise, cross-hatching, stippling, and unnecessary sketch marks.
- Simplify complicated shading into clean, contiguous shapes.
- Preserve important outlines, facial features, lettering, symbols, and other defining details.
- Remove tiny isolated specks and accidental fragments, but retain small details important to recognizing the subject.

PREPARE FOR CUTTING
- Use crisp, clean boundaries and uniform solid fills.
- Avoid fuzzy edges, narrow accidental slivers, and unnecessary tiny islands.
- Keep distinct colors in clearly separated regions.
- Prefer simple, broad shapes over realistic shading.

Maintain the original aspect ratio and include the entire subject without cropping. Return a high-resolution PNG with a genuinely transparent background. Do not return an SVG; Cricut Color Studio will create the vector layers. Prioritize clean, cuttable shapes while preserving the identity and important details of the original artwork.`;
  const copyPromptBtn = $("copyAiPromptBtn");
  if (copyPromptBtn) copyPromptBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(aiPrompt);
      copyPromptBtn.textContent = "Prompt copied!";
      setTimeout(() => { copyPromptBtn.textContent = "Copy AI simplification prompt"; }, 1800);
    } catch (_) {
      const helper = $("aiPromptText");
      helper.hidden = false; helper.focus(); helper.select();
      copyPromptBtn.textContent = "Select and copy the prompt below";
    }
  });
  $("showAllLayers").addEventListener("click", () => setAllLayersVisible(true));
  $("hideAllLayers").addEventListener("click", () => setAllLayersVisible(false));
  $("downloadCombined").addEventListener("click", downloadCombined);
  $("downloadZip").addEventListener("click", downloadZip);

  function renderCropSource() {
    const preview = $("cropPreviewCanvas");
    if (!state.originalImage || !preview) return;
    preview.width = state.originalImage.width; preview.height = state.originalImage.height;
    preview.getContext("2d").putImageData(state.originalImage, 0, 0);
    updateCropOverlay();
  }
  function cropValuesFromInputs() {
    return {top:clampPercent($("cropTop").value),right:clampPercent($("cropRight").value),bottom:clampPercent($("cropBottom").value),left:clampPercent($("cropLeft").value)};
  }
  function updateCropOverlay() {
    const crop = cropValuesFromInputs(), win = $("cropWindow"), shade = $("cropShade");
    if (!win || !shade) return;
    const left = Math.min(60, crop.left), top = Math.min(60, crop.top);
    const right = Math.min(60, crop.right), bottom = Math.min(60, crop.bottom);
    win.style.left = left + "%"; win.style.top = top + "%";
    win.style.right = right + "%"; win.style.bottom = bottom + "%";
    shade.style.setProperty("--crop-top", top + "%"); shade.style.setProperty("--crop-right", right + "%");
    shade.style.setProperty("--crop-bottom", bottom + "%"); shade.style.setProperty("--crop-left", left + "%");
  }
  function setupCropDragging() {
    const win = $("cropWindow"), wrap = $("cropPreviewWrap");
    if (!win || !wrap) return;
    let drag = null;
    win.querySelectorAll("[data-edge]").forEach(handle => {
      handle.addEventListener("pointerdown", e => {
        if (!state.originalImage) return;
        e.preventDefault(); e.stopPropagation();
        drag = {edge:handle.dataset.edge, startX:e.clientX, startY:e.clientY, initial:cropValuesFromInputs()};
        handle.setPointerCapture?.(e.pointerId);
      });
      handle.addEventListener("pointermove", e => {
        if (!drag || !state.originalImage) return;
        const rect = wrap.getBoundingClientRect();
        const dx = (e.clientX-drag.startX)/rect.width*100, dy=(e.clientY-drag.startY)/rect.height*100;
        const next={...drag.initial};
        if(drag.edge==="left") next.left=clampPercent(drag.initial.left+dx);
        if(drag.edge==="right") next.right=clampPercent(drag.initial.right-dx);
        if(drag.edge==="top") next.top=clampPercent(drag.initial.top+dy);
        if(drag.edge==="bottom") next.bottom=clampPercent(drag.initial.bottom-dy);
        if(next.left+next.right>60 || next.top+next.bottom>60) return;
        for(const edge of ["top","right","bottom","left"]) $("crop"+edge[0].toUpperCase()+edge.slice(1)).value=Math.round(next[edge]);
        updateCropOverlay();
      });
      const end = () => { drag=null; };
      handle.addEventListener("pointerup",end); handle.addEventListener("pointercancel",end);
    });
  }

  function clampPercent(value) { return Math.max(0, Math.min(30, Number(value) || 0)); }

  function cropImageData(src, crop) {
    const left = Math.floor(src.width * crop.left / 100);
    const right = Math.floor(src.width * crop.right / 100);
    const top = Math.floor(src.height * crop.top / 100);
    const bottom = Math.floor(src.height * crop.bottom / 100);
    const width = Math.max(1, src.width - left - right);
    const height = Math.max(1, src.height - top - bottom);
    const out = new ImageData(width, height);
    for (let y=0; y<height; y++) {
      const from = ((y + top) * src.width + left) * 4;
      const to = y * width * 4;
      out.data.set(src.data.subarray(from, from + width * 4), to);
    }
    return out;
  }

  function applyBackgroundSetting() {
    if (!state.originalImage) return;
    const src = cropImageData(state.originalImage, state.crop);
    const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    state.backgroundRemoved = $("removeBackground").checked;
    state.backgroundPixelCount = 0;
    if (state.backgroundRemoved) {
      const w = src.width, h = src.height, data = out.data, n = w * h;
      const seen = new Uint8Array(n), queue = new Int32Array(n);
      let head = 0, tail = 0;
      const isBackgroundPixel = p => {
        const i = p * 4, r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
        return a > 0 && r >= 242 && g >= 242 && b >= 242 &&
          Math.max(r,g,b) - Math.min(r,g,b) <= 18;
      };
      const add = p => { if (!seen[p] && isBackgroundPixel(p)) { seen[p] = 1; queue[tail++] = p; } };
      for (let x=0; x<w; x++) { add(x); add((h-1)*w+x); }
      for (let y=0; y<h; y++) { add(y*w); add(y*w+w-1); }
      while (head < tail) {
        const p = queue[head++], x = p % w, y = (p / w) | 0;
        if (x > 0) add(p-1);
        if (x < w-1) add(p+1);
        if (y > 0) add(p-w);
        if (y < h-1) add(p+w);
      }
      for (let p=0; p<n; p++) if (seen[p]) { data[p*4+3] = 0; state.backgroundPixelCount++; }
    }
    state.image = out;
    const status = $("backgroundStatus");
    if (status) {
      status.textContent = state.backgroundRemoved
        ? `Background removed: ${state.backgroundPixelCount.toLocaleString()} edge-connected pixels.`
        : "Background removal is off; the original background will be kept.";
    }
  }

  function updateMaterialHelp() {
    const m = $("material").value;
    $("materialHelp").textContent = m === "htv"
      ? "Iron-on vinyl is pressed onto shirts and bags. It is usually flipped (mirrored) before cutting."
      : m === "paper" ? "Use a different paper color for each layer. Bigger shapes are easier to glue."
      : "Use a different color of sticky vinyl for each layer.";
    updateWarnings();
  }
  function colorDist(a,b) { return (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2; }
  // Deterministic, convergent palette builder.
  //  * Histogram on 5 bits/channel (no random/stride sampling; absorbs +/-1-2 level decoder noise).
  //  * Weight-aware farthest-point initialisation so small accent colors (e.g. an orange) get their own center.
  //  * Weighted k-means run until assignments stop changing.
  //  * Each center is snapped to the most common REAL color in its cluster, so anti-aliased edge blends
  //    never become palette colors (previously produced "mud" such as #466E69).
  function quantize(data, requested, mergeSimilar = false) {
    const n = data.length / 4, opaque = [];
    for (let i=0;i<n;i++) if (data[i*4+3] !== 0) opaque.push(i);
    if (!opaque.length) throw new Error("The image appears to be fully transparent. Turn off background removal or try another image.");
    const bins = new Map();
    for (const i of opaque) {
      const p=i*4, r=data[p], g=data[p+1], b=data[p+2], key=((r>>3)<<10)|((g>>3)<<5)|(b>>3);
      let e = bins.get(key);
      if (!e) bins.set(key, e = {n:0, r:0, g:0, b:0, exact:new Map()});
      e.n++; e.r+=r; e.g+=g; e.b+=b;
      const ek=(r<<16)|(g<<8)|b; e.exact.set(ek,(e.exact.get(ek)||0)+1);
    }
    // Sort keys so results never depend on Map insertion order.
    const pts = [...bins.entries()].sort((a,b)=>a[0]-b[0]).map(([key,e])=>{
      let top=-1, topN=-1;
      for (const [ek,c] of e.exact) if (c>topN || (c===topN && ek<top)) { topN=c; top=ek; }
      return {c:[e.r/e.n, e.g/e.n, e.b/e.n], n:e.n, real:[(top>>16)&255,(top>>8)&255,top&255], realN:topN};
    });
    const k = Math.max(1, Math.min(requested, 12, pts.length));
    const centers = [pts.reduce((a,b)=>b.n>a.n?b:a).c.slice()];
    const minD = pts.map(p=>colorDist(p.c, centers[0]));
    while (centers.length < k) {
      let best=0, score=-1;
      for (let i=0;i<pts.length;i++) { const sc=minD[i]*Math.sqrt(pts[i].n); if (sc>score) { score=sc; best=i; } }
      if (score <= 0) break;
      const nc = pts[best].c.slice(); centers.push(nc);
      for (let i=0;i<pts.length;i++) minD[i]=Math.min(minD[i], colorDist(pts[i].c, nc));
    }
    const kk = centers.length, assign = new Int16Array(pts.length).fill(-1);
    for (let iter=0; iter<60; iter++) {
      let changed=false; const sums=Array.from({length:kk},()=>[0,0,0,0]);
      for (let i=0;i<pts.length;i++) {
        let bj=0, bd=Infinity;
        for (let j=0;j<kk;j++) { const d=colorDist(pts[i].c, centers[j]); if (d<bd) { bd=d; bj=j; } }
        if (assign[i]!==bj) { assign[i]=bj; changed=true; }
        const s=sums[bj], w=pts[i].n; s[0]+=pts[i].c[0]*w; s[1]+=pts[i].c[1]*w; s[2]+=pts[i].c[2]*w; s[3]+=w;
      }
      for (let j=0;j<kk;j++) if (sums[j][3]) for (let ch=0;ch<3;ch++) centers[j][ch]=sums[j][ch]/sums[j][3];
      if (!changed) break;
    }
    // Snap to real colors; track pixel weight per center.
    let palette = [], weight = [];
    for (let j=0;j<kk;j++) {
      let top=null, total=0;
      for (let i=0;i<pts.length;i++) if (assign[i]===j) { total+=pts[i].n; if (!top || pts[i].realN>top.realN) top=pts[i]; }
      if (!total) continue;
      palette.push(top.real.slice()); weight.push(total);
    }
    const snapped = palette.map(c=>c.slice());
    let centerMap = palette.map((_,i)=>i);
    if (mergeSimilar && palette.length > 1) {
      const parent = palette.map((_,i)=>i);
      const root = x => { while (parent[x]!==x) { parent[x]=parent[parent[x]]; x=parent[x]; } return x; };
      const join = (a,b) => { a=root(a); b=root(b); if (a!==b) parent[b]=a; };
      const threshold = 48*48;
      for (let a=0;a<palette.length;a++) for (let b=a+1;b<palette.length;b++) if (colorDist(palette[a],palette[b])<=threshold) join(a,b);
      const roots=[...new Set(palette.map((_,i)=>root(i)))].sort((a,b)=>a-b);
      // A merged group keeps the color of its heaviest member (a real color, not a blend).
      const mergedPalette = roots.map(r=>{ let best=-1; palette.forEach((c,i)=>{ if (root(i)===r && (best<0 || weight[i]>weight[best])) best=i; }); return palette[best].slice(); });
      centerMap = palette.map((_,i)=>roots.indexOf(root(i)));
      palette = mergedPalette;
    }
    return finishQuantize(data, n, opaque, snapped, centerMap, palette);
  }
  function finishQuantize(data, n, opaque, snapped, centerMap, palette) {
    const cache = new Map(), pixels = new Uint8Array(n); pixels.fill(255); // 255 = transparent
    for (const i of opaque) {
      const p=i*4, ek=(data[p]<<16)|(data[p+1]<<8)|data[p+2];
      let m = cache.get(ek);
      if (m === undefined) {
        const c=[data[p],data[p+1],data[p+2]]; let best=0, bd=Infinity;
        for (let j=0;j<snapped.length;j++) { const d=colorDist(c,snapped[j]); if (d<bd) { bd=d; best=j; } }
        m = centerMap[best]; cache.set(ek, m);
      }
      pixels[i]=m;
    }
    const used=[...new Set(opaque.map(i=>pixels[i]))].sort((a,b)=>a-b), remap=new Map(used.map((v,i)=>[v,i]));
    for (const i of opaque) pixels[i]=remap.get(pixels[i]);
    return {pixels, colors:used.map(i=>palette[i])};
  }
  // Shared "this is linework, not shading" luminance cutoff. Used by tonal flattening (never merge
  // these colors) and by the optional black-outline mask, so the two cannot drift apart.
  const DARK_LUM = 48;
  const lumOf = c => 0.299*c[0] + 0.587*c[1] + 0.114*c[2];

  // Apply an old-label -> new-label mapping and compact the labels to 0..n-1.
  // Single pass with typed lookup tables (no array spreading); 255 stays "transparent".
  function remapLabels(q, oldToNew, newPalette) {
    const pixels = new Uint8Array(q.pixels.length).fill(255), seen = new Uint8Array(256);
    for (let i=0;i<pixels.length;i++) { const v=q.pixels[i]; if (v!==255) { const m=oldToNew[v]; pixels[i]=m; seen[m]=1; } }
    const remap = new Int16Array(256).fill(-1), colors = [];
    for (let m=0;m<newPalette.length;m++) if (seen[m]) { remap[m]=colors.length; colors.push(newPalette[m].slice()); }
    for (let i=0;i<pixels.length;i++) if (pixels[i]!==255) pixels[i]=remap[pixels[i]];
    return {pixels, colors};
  }
  function labelCounts(q) {
    const counts = new Uint32Array(q.colors.length);
    for (let i=0;i<q.pixels.length;i++) { const v=q.pixels[i]; if (v!==255 && v<counts.length) counts[v]++; }
    return counts;
  }

  // Merge near-black palette variants even when tonal flattening is active. This only acts on
  // very dark colors (luminance <= 48), leaving charcoal/gray shading available as a distinct tone.
  // Groups use the same conservative RGB distance as the standard merge pass; geometry remains intact.
  function mergeSimilarDarkColors(q) {
    if (q.colors.length < 2) return q;
    const dark = q.colors.map((c,i)=>({i,c,lum:lumOf(c)})).filter(x=>x.lum<=48);
    if (dark.length < 2) return q;
    const parent=q.colors.map((_,i)=>i);
    const root=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
    const join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parent[b]=a;};
    for(let a=0;a<dark.length;a++) for(let b=a+1;b<dark.length;b++) {
      if(colorDist(dark[a].c,dark[b].c)<=48*48) join(dark[a].i,dark[b].i);
    }
    if (!dark.some(x=>root(x.i)!==x.i)) return q;
    const counts=labelCounts(q), roots=[...new Set(q.colors.map((_,i)=>root(i)))].sort((a,b)=>a-b);
    const newPalette=roots.map(r=>{let best=-1;for(let i=0;i<q.colors.length;i++)if(root(i)===r&&(best<0||counts[i]>counts[best]))best=i;return q.colors[best].slice();});
    const rootToNew=new Map(roots.map((r,i)=>[r,i]));
    return remapLabels(q,q.colors.map((_,i)=>rootToNew.get(root(i))),newPalette);
  }

  // Optional tonal flattening: merge shades that look like highlights/shadows of the same color
  // family. Near-black colors are protected as linework.
  // Grouping is ANCHORED, not transitive: colors are processed heaviest-first and may only join a
  // group if they are close to that group's anchor (its heaviest member). This keeps the luminance
  // and hue limits meaningful; a chain of small steps can no longer collapse a whole gradient.
  function flattenTonalShades(q, level) {
    if (!level || level === "off" || q.colors.length < 2) return q;
    const limits = {subtle: 42, moderate: 78, strong: 118};
    const maxLumDelta = limits[level] || limits.moderate;
    const colors = q.colors;
    const info = colors.map(c => {
      const r=c[0]/255, g=c[1]/255, b=c[2]/255;
      const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
      let hue=0;
      if (d) hue=max===r ? 60*(((g-b)/d)%6) : max===g ? 60*((b-r)/d+2) : 60*((r-g)/d+4);
      if (hue<0) hue+=360;
      const lum=lumOf(c), sat=max===0?0:d/max;
      return {hue, lum, sat, veryDark: lum<DARK_LUM};
    });
    const hueGap=(a,b)=>{const d=Math.abs(a-b);return Math.min(d,360-d);};
    const compatible=(A,B)=>{
      if (A.veryDark || B.veryDark) return false;
      if (Math.abs(A.lum-B.lum)>maxLumDelta) return false;
      const nA=A.sat<0.16, nB=B.sat<0.16;
      if (nA && nB) return true;
      if (nA!==nB) return false;
      return hueGap(A.hue,B.hue)<=22 && Math.abs(A.sat-B.sat)<=0.42;
    };
    const counts = labelCounts(q);
    const order = colors.map((_,i)=>i).sort((a,b)=>counts[b]-counts[a] || a-b);
    const groups = []; // each: {anchor}
    const oldToNew = new Array(colors.length);
    for (const i of order) {
      let bestG=-1, bestDelta=Infinity;
      for (let g=0; g<groups.length; g++) {
        const anchor=groups[g].anchor;
        if (!compatible(info[anchor], info[i])) continue;
        const delta=Math.abs(info[anchor].lum-info[i].lum);
        if (delta<bestDelta) { bestDelta=delta; bestG=g; }
      }
      if (bestG<0) { groups.push({anchor:i}); bestG=groups.length-1; }
      oldToNew[i]=bestG;
    }
    if (groups.length===colors.length) return q;
    return remapLabels(q, oldToNew, groups.map(g=>colors[g.anchor]));
  }

  // Reduce a palette to `target` colors by repeatedly merging the cheapest pair (Ward-style cost:
  // squared RGB distance weighted by pixel counts, so small accents are not swallowed lightly).
  // The heavier color survives, so the result is always a real color.
  function reduceToCount(q, target) {
    if (q.colors.length <= target) return q;
    const counts = Array.from(labelCounts(q));
    let cols = q.colors.map(c=>c.slice()), map = cols.map((_,i)=>i), alive = cols.map((_,i)=>i);
    while (alive.length > target) {
      let bi=-1, bj=-1, bc=Infinity;
      for (let x=0;x<alive.length;x++) for (let y=x+1;y<alive.length;y++) {
        const a=alive[x], b=alive[y];
        const cost=colorDist(cols[a],cols[b])*(counts[a]*counts[b])/Math.max(1,counts[a]+counts[b]);
        if (cost<bc) { bc=cost; bi=a; bj=b; }
      }
      const keep = counts[bi]>=counts[bj] ? bi : bj, drop = keep===bi ? bj : bi;
      counts[keep]+=counts[drop];
      for (let k=0;k<map.length;k++) if (map[k]===drop) map[k]=keep;
      alive=alive.filter(v=>v!==drop);
    }
    const newIndex = new Map(alive.map((v,i)=>[v,i]));
    return remapLabels(q, map.map(v=>newIndex.get(v)), alive.map(v=>cols[v]));
  }

  function smoothColorLabels(pixels, w, h, iterations = 1) {
    let current = new Uint8Array(pixels);
    for (let pass=0; pass<iterations; pass++) {
      const next = new Uint8Array(current);
      for (let y=1; y<h-1; y++) for (let x=1; x<w-1; x++) {
        const i=y*w+x, center=current[i];
        if (center===255) continue;
        const counts=new Map();
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
          const v=current[(y+dy)*w+x+dx];
          if(v!==255) counts.set(v,(counts.get(v)||0)+1);
        }
        let best=center,bestCount=counts.get(center)||0;
        for(const [v,c] of counts) if(c>bestCount){best=v;bestCount=c;}
        // Only change isolated speckles; keep balanced boundaries intact.
        if(best!==center && bestCount>=5 && (counts.get(center)||0)<=3) next[i]=best;
      }
      current=next;
    }
    return current;
  }

  // In Simplify for Cutting mode, fill only tiny transparent components that are fully
  // enclosed by artwork. Transparent components touching the canvas edge are always preserved.
  function fillTinyEnclosedHoles(pixels, w, h, colorCount, maxArea=18) {
    const seen=new Uint8Array(pixels.length), queue=new Int32Array(pixels.length);
    let filled=0;
    for(let start=0;start<pixels.length;start++) {
      if(seen[start] || pixels[start]!==255) continue;
      let head=0,tail=0; queue[tail++]=start; seen[start]=1;
      const ids=[]; let touchesEdge=false; const neighbors=new Map();
      while(head<tail) {
        const id=queue[head++], x=id%w, y=(id/w)|0; ids.push(id);
        if(x===0||y===0||x===w-1||y===h-1) touchesEdge=true;
        const around=[];
        if(x>0)around.push(id-1); if(x<w-1)around.push(id+1);
        if(y>0)around.push(id-w); if(y<h-1)around.push(id+w);
        for(const n of around) {
          const v=pixels[n];
          if(v===255) { if(!seen[n]){seen[n]=1;queue[tail++]=n;} }
          else neighbors.set(v,(neighbors.get(v)||0)+1);
        }
      }
      if(touchesEdge || ids.length>maxArea || !neighbors.size) continue;
      let best=-1,count=0;
      for(const [color,n] of neighbors) if(n>count){best=color;count=n;}
      if(best>=0) { for(const id of ids)pixels[id]=best; filled+=ids.length; }
    }
    return filled;
  }

  function findComponents(pixels, w, h, colorCount) {
    const seen = new Uint8Array(pixels.length), comps = Array.from({length:colorCount},()=>[]);
    const queue = new Int32Array(pixels.length);
    for(let start=0;start<pixels.length;start++){
      if(seen[start])continue;
      if(pixels[start]===255){seen[start]=1;continue;}
      const color=pixels[start];let head=0,tail=0;queue[tail++]=start;seen[start]=1;const ids=[];
      while(head<tail){const p=queue[head++];ids.push(p);const x=p%w,y=(p/w)|0;
        if(x>0){const q=p-1;if(!seen[q]&&pixels[q]===color){seen[q]=1;queue[tail++]=q;}}
        if(x<w-1){const q=p+1;if(!seen[q]&&pixels[q]===color){seen[q]=1;queue[tail++]=q;}}
        if(y>0){const q=p-w;if(!seen[q]&&pixels[q]===color){seen[q]=1;queue[tail++]=q;}}
        if(y<h-1){const q=p+w;if(!seen[q]&&pixels[q]===color){seen[q]=1;queue[tail++]=q;}}
      }
      comps[color].push(ids);
    }
    return comps;
  }
  function pointSegmentDistance(p, a, b) {
    const dx=b[0]-a[0], dy=b[1]-a[1];
    if(dx===0 && dy===0) return Math.hypot(p[0]-a[0],p[1]-a[1]);
    const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));
    return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy));
  }
  function simplifyOpen(points, tolerance) {
    if(points.length<=3) return points;
    let max=0,index=0; const first=points[0],last=points[points.length-1];
    for(let i=1;i<points.length-1;i++){const d=pointSegmentDistance(points[i],first,last);if(d>max){max=d;index=i;}}
    if(max<=tolerance) return [first,last];
    const left=simplifyOpen(points.slice(0,index+1),tolerance),right=simplifyOpen(points.slice(index),tolerance);
    return left.slice(0,-1).concat(right);
  }
  function simplifyClosed(points, tolerance=1.05) {
    if(points.length<8) return points;
    let far=1,max=-1;
    for(let i=1;i<points.length;i++){const d=(points[i][0]-points[0][0])**2+(points[i][1]-points[0][1])**2;if(d>max){max=d;far=i;}}
    const a=simplifyOpen(points.slice(0,far+1),tolerance);
    const b=simplifyOpen(points.slice(far).concat([points[0]]),tolerance);
    const merged=a.slice(0,-1).concat(b.slice(0,-1));
    return merged.length>=3 ? merged : points;
  }

  // Trace each connected pixel region as oriented boundary edges. Collinear edges are merged.
  function componentPath(ids, w, h) {
    const set=new Set(ids), edges=[];
    for(const p of ids){const x=p%w,y=(p/w)|0;
      if(y===0||!set.has(p-w))edges.push([x,y,x+1,y]);
      if(x===w-1||!set.has(p+1))edges.push([x+1,y,x+1,y+1]);
      if(y===h-1||!set.has(p+w))edges.push([x+1,y+1,x,y+1]);
      if(x===0||!set.has(p-1))edges.push([x,y+1,x,y]);
    }
    const key=(x,y)=>x+","+y, outgoing=new Map();
    edges.forEach((e,i)=>{const k=key(e[0],e[1]);if(!outgoing.has(k))outgoing.set(k,[]);outgoing.get(k).push(i);});
    const used=new Uint8Array(edges.length), paths=[];
    for(let ei=0;ei<edges.length;ei++){
      if(used[ei])continue;
      const points=[], first=edges[ei];let cur=ei, guard=0;
      while(!used[cur]&&guard++<edges.length+5){
        used[cur]=1;const e=edges[cur];points.push([e[0],e[1]]);
        const end=key(e[2],e[3]);if(end===key(first[0],first[1]))break;
        const candidates=(outgoing.get(end)||[]).filter(i=>!used[i]);if(!candidates.length){points.push([e[2],e[3]]);break;}
        // At ambiguous diagonal corners, prefer a right turn, then straight, left, reverse.
        const dx=e[2]-e[0],dy=e[3]-e[1];
        const rank=i=>{const n=edges[i],ndx=n[2]-n[0],ndy=n[3]-n[1];if(ndx===-dy&&ndy===dx)return 0;if(ndx===dx&&ndy===dy)return 1;if(ndx===dy&&ndy===-dx)return 2;return 3;};
        candidates.sort((a,b)=>rank(a)-rank(b));cur=candidates[0];
      }
      if(points.length>=3){
        const simplified=[];
        for(let i=0;i<points.length;i++){const prev=points[(i+points.length-1)%points.length],curp=points[i],next=points[(i+1)%points.length];if((curp[0]-prev[0])*(next[1]-curp[1])!==(curp[1]-prev[1])*(next[0]-curp[0]))simplified.push(curp);}
        if(simplified.length>=3) {
          // A light 1-pixel contour simplification removes stair-step noise while preserving larger features.
          const clean=simplifyClosed(simplified,1.05);
          paths.push("M"+clean.map(p=>p[0]+","+p[1]).join(" L")+" Z");
        }
      }
    }
    return paths.join(" ");
  }
  function hexDist2(a,b){const pa=[1,3,5].map(i=>parseInt(a.slice(i,i+2),16)),pb=[1,3,5].map(i=>parseInt(b.slice(i,i+2),16));return colorDist(pa,pb);}
  function rememberHidden(){ state.hiddenColors=state.layers.filter(l=>l.visible===false).map(l=>l.color); }
  // Encouraging or gently warning message about how many pieces the design has.
  function updateFriendlyNote(){
    const el=$("friendlyNote"); if(!el) return;
    const total=state.layers.reduce((n,l)=>n+l.regions,0), tiny=state.layers.reduce((n,l)=>n+(l.smallPieces||0),0);
    el.classList.remove("hidden","good","tricky");
    if(total>100){ el.classList.add("tricky"); el.textContent=`This picture makes ${total} separate pieces, which will be tricky to cut and peel. For an easier project, try a simpler picture, pick Simple (4 colors), or open Advanced options and set Simplify for cutting to Strong.`; }
    else if(total<=60 && tiny===0){ el.classList.add("good"); el.textContent=`Nice and simple! Your design has ${total} pieces and no tiny ones, so it should be easy to cut.`; }
    else { el.classList.add("hidden"); }
  }
  function hex(rgb){return "#"+rgb.map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,"0")).join("").toUpperCase();}
  // Detect a conservative, word-like cluster of small components in the lower-right
  // edge area, where source-image watermarks commonly appear. Only remove the cluster
  // when several independent, small components form a shallow horizontal band.
  function removeLikelyWatermarkCluster(pixels, w, h, colorCount) {
    const components = findComponents(pixels, w, h, colorCount);
    const candidates = [];
    const maxComponentArea = Math.max(24, Math.floor(w*h*0.006));
    for (let color=0; color<components.length; color++) {
      for (const ids of components[color]) {
        if (ids.length > maxComponentArea) continue;
        let minX=w, minY=h, maxX=0, maxY=0;
        for (const id of ids) {
          const x=id%w, y=(id/w)|0;
          if(x<minX)minX=x; if(x>maxX)maxX=x;
          if(y<minY)minY=y; if(y>maxY)maxY=y;
        }
        const bw=maxX-minX+1, bh=maxY-minY+1;
        if (minX < w*0.55 || minY < h*0.80 || maxY < h*0.88) continue;
        if (bw > w*0.22 || bh > h*0.09) continue;
        candidates.push({ids,minX,minY,maxX,maxY,area:ids.length});
      }
    }
    if (candidates.length < 5) return 0;
    const minX=Math.min(...candidates.map(c=>c.minX));
    const minY=Math.min(...candidates.map(c=>c.minY));
    const maxX=Math.max(...candidates.map(c=>c.maxX));
    const maxY=Math.max(...candidates.map(c=>c.maxY));
    const totalArea=candidates.reduce((n,c)=>n+c.area,0);
    const spanX=maxX-minX+1, spanY=maxY-minY+1;
    // Word-like: horizontally spread, shallow, close to the bottom, and small overall.
    if (spanX < w*0.08 || spanY > h*0.10 || maxY < h*0.92 || totalArea > w*h*0.025) return 0;
    for (const c of candidates) for (const id of c.ids) pixels[id]=255;
    return totalArea;
  }

  // ---- Simplify for Cutting -------------------------------------------------------------
  // Thin halos and tiny fragments are reassigned to the color they sit inside, BEFORE tracing, so
  // they never become separate cut pieces and never leave transparent specks behind. (Deleting a
  // tiny piece at trace time, as the normal cleanup does, leaves a hole in the artwork.)
  // Simplify strengths: minimum piece area (mm²) and minimum feature thickness (mm). Features smaller or
  // thinner than this are absorbed by the color around them.
  const TINY_MM2 = 8;   // pieces smaller than this are flagged as tiny (hard to peel)
  const SIMPLIFY_LEVELS = { light:{mm2:3, thickness:0.6}, medium:{mm2:6, thickness:1.0}, strong:{mm2:12, thickness:1.5}, max:{mm2:20, thickness:2.0} };

  // Windowed plurality filter: a pixel changes only if another color clearly dominates its
  // (2r+1)x(2r+1) neighborhood. Thin lines and halos narrower than ~r pixels disappear; wide
  // regions and straight boundaries are left alone. Transparent pixels never vote or change.
  function majorityFilter(pixels, w, h, r, passes) {
    let cur = new Uint8Array(pixels);
    const margin = Math.ceil(r * 1.5), counts = new Int32Array(256), touched = new Uint8Array(256);
    for (let pass=0; pass<passes; pass++) {
      const next = new Uint8Array(cur);
      for (let y=r; y<h-r; y++) for (let x=r; x<w-r; x++) {
        const i=y*w+x, own=cur[i];
        if (own===255) continue;
        let nt=0;
        for (let dy=-r; dy<=r; dy++) { const row=(y+dy)*w+x; for (let dx=-r; dx<=r; dx++) {
          const v=cur[row+dx]; if (v===255) continue;
          if (!counts[v]) touched[nt++]=v; counts[v]++;
        } }
        let best=own, bc=counts[own];
        for (let t=0;t<nt;t++) { const v=touched[t]; if (counts[v]>bc) { best=v; bc=counts[v]; } }
        if (best!==own && bc>=counts[own]+margin) next[i]=best;
        for (let t=0;t<nt;t++) counts[touched[t]]=0;
      }
      cur = next;
    }
    return cur;
  }

  // Give a connected piece the color it touches most (4-neighbors). Returns false when the piece touches
  // only transparent pixels, so callers can decide whether to leave or delete it.
  function reassignToNeighbor(pixels, ids, w, h) {
    const own=new Set(ids), votes=new Map();
    for (const id of ids) {
      const x=id%w, y=(id/w)|0;
      const around=[x>0?id-1:-1, x<w-1?id+1:-1, y>0?id-w:-1, y<h-1?id+w:-1];
      for (const n of around) { if (n<0 || own.has(n)) continue; const v=pixels[n]; if (v!==255) votes.set(v,(votes.get(v)||0)+1); }
    }
    if (!votes.size) return false;
    let best=-1, bc=0; for (const [v,c] of votes) if (c>bc) { best=v; bc=c; }
    for (const id of ids) pixels[id]=best;
    return true;
  }

  // Reassign every connected piece smaller than minArea to the neighboring color it touches most
  // (smallest first, a few rounds, because absorbing one piece can merge others).
  function absorbSmallComponents(pixels, w, h, colorCount, minArea, rounds=3) {
    let recolored=0, pieces=0;
    for (let round=0; round<rounds; round++) {
      const comps=findComponents(pixels,w,h,colorCount), small=[];
      for (const list of comps) for (const ids of list) if (ids.length<minArea) small.push(ids);
      if (!small.length) break;
      small.sort((a,b)=>a.length-b.length);
      let any=false;
      for (const ids of small) if (reassignToNeighbor(pixels,ids,w,h)) { recolored+=ids.length; pieces++; any=true; }
      if (!any) break;
    }
    return {recolored, pieces};
  }

  // Safety net for the smoothing filter: if it would split one significant piece (>= minArea) into two or
  // more significant pieces (for example by thinning a ring or a narrow neck), undo this filter's changes
  // inside that piece. Returns how many pieces were protected.
  function protectSplitPieces(before, after, w, h, colorCount, minArea) {
    const compsBefore=findComponents(before,w,h,colorCount), compsAfter=findComponents(after,w,h,colorCount);
    const afterId=new Int32Array(after.length).fill(-1); let nid=0;
    for (const list of compsAfter) for (const ids of list) { if (ids.length>=minArea) for (const id of ids) afterId[id]=nid; nid++; }
    let count=0;
    for (let c=0;c<compsBefore.length;c++) for (const ids of compsBefore[c]) {
      if (ids.length<minArea) continue;
      const seen=new Set();
      for (const id of ids) if (after[id]===c && afterId[id]>=0) { seen.add(afterId[id]); if (seen.size>1) break; }
      if (seen.size>1) { for (const id of ids) if (after[id]!==before[id]) after[id]=before[id]; count++; }
    }
    return count;
  }

  // Full Simplify for Cutting pass (in place). Returns stats for the warnings panel.
  function simplifyLabelsForCutting(pixels, w, h, colorCount, mmPerPixel, minAreaPx, thicknessMM=1.0) {
    const before = new Uint8Array(pixels);
    const radius = Math.max(1, Math.min(4, Math.round(thicknessMM / mmPerPixel / 2)));
    const floorArea = Math.max(minAreaPx, 12);
    const filtered = majorityFilter(pixels, w, h, radius, 2);
    const protectedPieces = protectSplitPieces(before, filtered, w, h, colorCount, floorArea);
    pixels.set(filtered);
    const absorbed = absorbSmallComponents(pixels, w, h, colorCount, floorArea);
    const holes = fillTinyEnclosedHoles(pixels, w, h, colorCount, 18);
    let recolored=0; for (let i=0;i<pixels.length;i++) if (pixels[i]!==before[i] && before[i]!==255 && pixels[i]!==255) recolored++;
    return {radius, recolored, pieces:absorbed.pieces, holes, protectedPieces};
  }

  // Conservative artifact cleanup: remove only tiny, isolated, extremely elongated components.
  // Area and aspect ratio are both required so meaningful long details are usually retained.
  function removeLikelySlivers(pixels, w, h, colorCount) {
    const components=findComponents(pixels,w,h,colorCount);
    let changed=0;
    for(let color=0;color<components.length;color++) {
      const list=components[color];
      // Never touch the largest region of a color; it may be a legitimate outline or body shape.
      let largest=-1; for(let i=0;i<list.length;i++) if(largest<0||list[i].length>list[largest].length) largest=i;
      for(let i=0;i<list.length;i++) {
        if(i===largest) continue;
        const ids=list[i]; if(ids.length>28) continue;
        let minX=w,minY=h,maxX=0,maxY=0;
        for(const id of ids){const x=id%w,y=(id/w)|0;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
        const bw=maxX-minX+1,bh=maxY-minY+1,ratio=Math.max(bw/bh,bh/bw);
        if(ratio>=12 && Math.max(bw,bh)<=90){
          // Recolor into the surrounding color; only delete when the fragment touches nothing but transparency.
          if(!reassignToNeighbor(pixels,ids,w,h)) for(const id of ids)pixels[id]=255;
          changed+=ids.length;
        }
      }
    }
    return changed;
  }

  // Layer overlap ("trap") for side-by-side vinyl: a lighter layer is grown by r pixels underneath the
  // darker colors next to it, so tiny registration gaps do not show. Returns a 0/255 mask of that layer.
  function overlapMask(pixels, w, h, keptLists, colLum, c, r) {
    let cur=new Uint8Array(w*h).fill(255);
    for (const ids of keptLists) for (const id of ids) cur[id]=0;
    for (let step=0; step<r; step++) {
      const next=new Uint8Array(cur);
      for (let id=0; id<cur.length; id++) {
        if (cur[id]!==255) continue;
        const lab=pixels[id];
        if (lab===255 || lab===c || colLum[lab]>=colLum[c]) continue;
        const x=id%w, y=(id/w)|0;
        if ((x>0&&cur[id-1]===0)||(x<w-1&&cur[id+1]===0)||(y>0&&cur[id-w]===0)||(y<h-1&&cur[id+w]===0)) next[id]=0;
      }
      cur=next;
    }
    return cur;
  }

  function processImage() {
    if(!state.image)return;
    const btn=$("processBtn");btn.disabled=true;btn.textContent="Working…";
    // Yield one frame so the busy state is visible.
    setTimeout(()=>{
      try {
        const {width:w,height:h,data}=state.image;
        // When flattening, oversample first so tonal variants can be grouped before reducing to
        // the requested palette size. Then merge near-black variants separately: this preserves
        // the tonal flattener's protection for linework without leaving redundant near-black layers.
        const flatten=$("flattenShading").value;
        let q=quantize(data, flatten==="off" ? state.count : Math.max(state.count,12), flatten==="off" ? state.merge : false);
        if(flatten!=="off") q=flattenTonalShades(q, flatten);
        if(state.merge) q=mergeSimilarDarkColors(q);
        if(flatten!=="off") q=reduceToCount(q, state.count);
        const level=SIMPLIFY_LEVELS[$("simplifyStrength").value]||null, simplifyForCutting=!!level;
        const presetMM2 = {fine:0.25, balanced:1, easy:3}[$("cleanupPreset").value] || 1;
        const override = $("minRegion").value;
        let minMM2 = override === "auto" ? presetMM2 : Math.max(0, Number(override) || 0);
        // Simplify strength sets a floor for the minimum piece size (a larger manual value still wins).
        if (level) minMM2 = Math.max(minMM2, level.mm2);
        const mmPerPixel = (Math.max(2,Math.min(24,Number($("designWidth").value)||6)) * 25.4) / w;
        const minArea = minMM2 / (mmPerPixel * mmPerPixel);
        q.pixels=smoothColorLabels(q.pixels,w,h,1);
        // Tiny pieces are RECOLORED to their surroundings before tracing (never deleted), so they cannot
        // leave transparent specks. Simplify adds smoothing of thin halos on top of this.
        const cs=state.cleanupStats;
        cs.holePixels=0; cs.recoloredPixels=0; cs.absorbedPieces=0; cs.splitsProtected=0; cs.tinyPixels=0; cs.sliverPixels=0;
        if (simplifyForCutting) {
          const st=simplifyLabelsForCutting(q.pixels,w,h,q.colors.length,mmPerPixel,minArea,level.thickness);
          cs.holePixels=st.holes; cs.recoloredPixels=st.recolored; cs.absorbedPieces=st.pieces; cs.splitsProtected=st.protectedPieces;
        }
        // Remove only a strongly watermark-like cluster at the lower-right edge.
        // This is deliberately conservative; cropping remains available for other layouts.
        cs.watermarkPixels=removeLikelyWatermarkCluster(q.pixels,w,h,q.colors.length);
        if (!simplifyForCutting) {
          if (minArea>0) { const ab=absorbSmallComponents(q.pixels,w,h,q.colors.length,minArea); cs.recoloredPixels=ab.recolored; cs.absorbedPieces=ab.pieces; }
          cs.sliverPixels=removeLikelySlivers(q.pixels,w,h,q.colors.length);
        }
        let outlineMask = null;
        if ($("addBlackOutlines").checked) {
          outlineMask = new Uint8Array(w*h); outlineMask.fill(255);
          for (let i=0; i<w*h; i++) {
            if (data[i*4+3] === 0) continue;
            const r=data[i*4], g=data[i*4+1], b=data[i*4+2];
            const lum=lumOf([r,g,b]);
            const spread=Math.max(r,g,b)-Math.min(r,g,b);
            if (lum < DARK_LUM && spread < 90) {
              outlineMask[i]=0;
              q.pixels[i]=255;
            }
          }
        }
        const comps=findComponents(q.pixels,w,h,q.colors.length);
        const overlapMM=Number($("layerOverlap").value)||0; state.overlapMM=overlapMM;
        const overlapPx=overlapMM>0 ? Math.max(1,Math.min(3,Math.round(overlapMM/mmPerPixel))) : 0;
        const colLum=q.colors.map(lumOf);
        const tinyPx=TINY_MM2/(mmPerPixel*mmPerPixel);
        const layers=[];
        for(let c=0;c<q.colors.length;c++){
          const kept=[]; let removed=0;
          for(const ids of comps[c]){
            if(ids.length<minArea){removed+=ids.length;cs.tinyPixels+=ids.length;continue;}
            kept.push(ids);
          }
          // With overlap on, this layer is grown underneath the darker colors next to it.
          const pieces=(overlapPx>0 && kept.length) ? findComponents(overlapMask(q.pixels,w,h,kept,colLum,c,overlapPx),w,h,1)[0] : kept;
          const paths=[], tinyPaths=[]; let keptArea=0;
          for(const ids of pieces){
            const d=componentPath(ids,w,h);
            if(d){paths.push(d);keptArea+=ids.length;if(ids.length<tinyPx)tinyPaths.push(d);}
          }
          if(paths.length)layers.push({color:hex(q.colors[c]),paths,tinyPaths,area:keptArea,regions:paths.length,smallPieces:tinyPaths.length,removed,lum:colLum[c],operation:"cut",averageRegionArea:keptArea/paths.length,visible:true});
        }
        // Optional outline layer separates very dark source pixels into a dedicated black cut layer.
        // This is project metadata only: Design Space may ignore SVG operation metadata,
        // ; the outline layer is not a pen centerline.
        if (outlineMask) {
          const outlineComponents=findComponents(outlineMask,w,h,1);
          const outlinePaths=[], outlineTiny=[]; let outlineArea=0;
          for (const ids of outlineComponents[0]) {
            if (ids.length < Math.max(2, minArea*0.5)) continue;
            const d=componentPath(ids,w,h);
            if (d) { outlinePaths.push(d); outlineArea+=ids.length; if(ids.length<tinyPx)outlineTiny.push(d); }
          }
          if (outlinePaths.length) layers.push({color:"#08090d",paths:outlinePaths,tinyPaths:outlineTiny,area:outlineArea,regions:outlinePaths.length,smallPieces:outlineTiny.length,removed:0,lum:8,operation:"cut",averageRegionArea:outlineArea/outlinePaths.length,isOutline:true,visible:true});
        }
        layers.sort((a,b)=>b.area-a.area);
        layers.forEach((l,i)=>{l.name="Color "+(i+1)+(l.operation==="draw"?" · draw intended":"");l.id="layer-"+(i+1);});
        if(!layers.length)throw new Error("No usable regions found. Try a lower cleanup setting or a different image.");
        // Remember which colors the person turned off, so changing a setting does not switch them back on.
        layers.forEach(l=>{ if(state.hiddenColors.some(hc=>hexDist2(hc,l.color)<=900)) l.visible=false; });
        const widthIn=Math.max(2,Math.min(24,Number($("designWidth").value)||6));
        state.width=widthIn;state.layers=layers;state.selected=-1;
        $("results").classList.remove("hidden");
        $("layerCount").textContent=layers.length+" layers";
        $("dimensions").textContent=widthIn.toFixed(1)+'" wide';
        $("statusPill").textContent="Preview ready";
        renderLayers();renderComposite();updateWarnings();
        updateFriendlyNote();
        updateExportButtons();
      }catch(e){alert(e.message||"Something went wrong while making the layers.");}
      finally{btn.disabled=false;btn.textContent="Make my color layers";}
    },30);
  }
  function svgFor(layers, visibleOnly=true) {
    const w=state.image.width,h=state.image.height, widthIn=state.width, heightIn=widthIn*h/w;
    let included=visibleOnly ? layers.filter(l=>l.visible !== false) : layers;
    // With layer overlap, lighter colors are drawn first so the darker colors sit on top of the overlap.
    if(state.overlapMM>0) included=[...included].sort((a,b)=>(b.lum||0)-(a.lum||0));
    const groups=included.map(l=>{
      const op=l.operation||"cut";
      return `<g id="${escapeXml(l.id)}" data-name="${escapeXml(l.name)}" data-color="${l.color}" data-operation="${op}" fill="${l.color}" fill-rule="evenodd" stroke="none">${l.paths.map(d=>`<path d="${d}"/>`).join("")}</g>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${widthIn}in" height="${heightIn.toFixed(3)}in" viewBox="0 0 ${w} ${h}">\n<title>${escapeXml(state.fileName)} - Cricut Color Studio</title>\n<desc>Color-separated vector artwork generated by Cricut Color Studio 1.1.0. Imported SVG elements may need their operations assigned in Cricut Design Space.</desc>\n${groups}\n</svg>`;
  }
  function renderComposite(){
    const host=$("compositePreview");
    const selected=state.selected;
    let layers=state.layers.filter(l=>l.visible !== false);
    if(selected>=0 && state.layers[selected] && state.layers[selected].visible !== false) layers=[state.layers[selected]];
    let markup=layers.length ? svgFor(layers) : '<div class="empty-preview">Turn on a color on the right to see your design.</div>';
    // Preview only (never exported): outline tiny pieces in red.
    const tinyBox=$("showTinyPieces"); let tinyTotal=0;
    if(layers.length){ layers.forEach(l=>tinyTotal+=(l.tinyPaths||[]).length); }
    if(layers.length && tinyBox && tinyBox.checked && tinyTotal){
      const overlay='<g fill="rgba(255,45,85,.35)" stroke="#ff2d55" stroke-width="2" vector-effect="non-scaling-stroke" fill-rule="evenodd">'+layers.map(l=>(l.tinyPaths||[]).map(d=>`<path d="${d}" vector-effect="non-scaling-stroke"/>`).join("")).join("")+'</g>';
      markup=markup.replace("</svg>",overlay+"</svg>");
    }
    host.innerHTML=markup;
    const tinyLabel=$("tinyCount"); if(tinyLabel) tinyLabel.textContent=tinyTotal?`${tinyTotal} tiny piece${tinyTotal===1?"":"s"}`:"no tiny pieces";
    const svg=host.querySelector("svg");
    if(svg){svg.removeAttribute("width");svg.removeAttribute("height");svg.setAttribute("preserveAspectRatio","xMidYMid meet");}
    $("legend").innerHTML="";
    state.layers.forEach((l,i)=>{const b=document.createElement("button");b.className="legend-chip"+(i===selected?" active":"");b.style.background=l.color;b.title=l.name;b.setAttribute("aria-label","Preview "+l.name);b.addEventListener("click",()=>selectLayer(i));$("legend").appendChild(b);});
  }
  function renderLayers(){
    const host=$("layerList");host.innerHTML="";
    state.layers.forEach((l,i)=>{
      const row=document.createElement("div");row.className="layer-item"+(i===state.selected?" active":"")+(l.visible===false?" layer-hidden":"");
      const select=document.createElement("button");select.className="layer-select";select.type="button";select.setAttribute("aria-label","Inspect "+l.name);
      const sw=document.createElement("span");sw.className="swatch";sw.style.background=l.color;
      const name=document.createElement("span");name.className="layer-name";name.textContent=l.name;
      const meta=document.createElement("span");meta.className="layer-meta";meta.textContent=`${l.regions} piece${l.regions===1?"":"s"}${l.smallPieces?` · ${l.smallPieces} tiny`:""}${l.operation==="draw"?" · draw intended":""}`;
      name.appendChild(meta);select.append(sw,name);select.addEventListener("click",()=>selectLayer(i));
      const label=document.createElement("label");label.className="layer-toggle";label.title=(l.visible===false?"Include ":"Exclude ")+l.name+" in preview and exports";
      const check=document.createElement("input");check.type="checkbox";check.checked=l.visible!==false;check.setAttribute("aria-label","Include "+l.name+" in preview and exports");
      check.addEventListener("change",()=>{l.visible=check.checked;rememberHidden();if(state.selected===i&&!l.visible)state.selected=-1;renderLayers();renderComposite();updateWarnings();updateExportButtons();});
      label.append(check);row.append(select,label);host.appendChild(row);
    });
  }
  function setAllLayersVisible(visible){
    state.layers.forEach(l=>l.visible=visible);
    rememberHidden();
    if(!visible)state.selected=-1;
    renderLayers();renderComposite();updateWarnings();updateExportButtons();
  }
  function updateExportButtons(){
    const count=state.layers.filter(l=>l.visible!==false).length;
    $("downloadCombined").disabled=count===0;$("downloadZip").disabled=count===0;
    const summary=$("layerCount");if(summary)summary.textContent=`${count} of ${state.layers.length} layers selected`;
  }
  function selectLayer(i){state.selected=state.selected===i?-1:i;renderLayers();renderComposite();}
  function updateWarnings(){
    const m=$("material").value;let msg=[];
    if(m==="htv")msg.push("Iron-on: you usually need to mirror (flip) the design before cutting. Check the instructions that came with your material.");
    if(m==="paper")msg.push("Paper: do a small test cut first, and pick the right material setting.");
    if(m==="vinyl")msg.push("Vinyl: very small pieces are hard to peel, so check the tiny-piece count above.");
    if(state.layers.length) {
      const activeLayers=state.layers.filter(l=>l.visible!==false);
      const off=state.layers.length-activeLayers.length;
      if(off>0)msg.push(`${off} color${off===1?" is":"s are"} turned off and will not be in your downloads.`);
      const cs=state.cleanupStats;
      if(cs.watermarkPixels>0)msg.push("A small mark in the bottom-right corner looked like a watermark, so it was removed. Check the preview to make sure nothing important is missing.");
      if(cs.absorbedPieces>0)msg.push(`${cs.absorbedPieces.toLocaleString()} tiny bits were blended into the colors around them so they will not be cut as little pieces. Check small details like eyes and faces.`);
      if(cs.splitsProtected>0)msg.push(`Kept ${cs.splitsProtected} thin shape${cs.splitsProtected===1?"":"s"} (like a ring) from being broken apart.`);
    }
    if(state.overlapMM>0)msg.push(`Layer overlap is on (${state.overlapMM} mm): lighter colors slide a tiny bit under darker ones so gaps do not show.`);
    msg.push("Design Space may treat every layer as a normal cut. That is fine for most projects.");
    $("exportWarnings").textContent=msg.join(" ");
    const gu=$("grownUpNote"); if(gu) gu.textContent=m==="htv"
      ? "Ask a grown-up for help: the cutting machine has a sharp blade, and iron-on needs a hot iron or heat press."
      : "Ask a grown-up for help with the cutting machine. It has a sharp blade and moving parts.";
  }
  function download(name,content,type="image/svg+xml;charset=utf-8"){
    const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
  }
  function downloadCombined(){const active=state.layers.filter(l=>l.visible!==false);if(active.length)download(state.fileName+"-cricut-color-studio.svg",svgFor(active));}
  async function downloadZip(){
    const activeLayers=state.layers.filter(l=>l.visible!==false);
    if(!activeLayers.length)return;
    if(typeof JSZip==="undefined"){alert("The ZIP helper could not load. Check your internet connection and refresh; combined SVG export still works.");return;}
    const zip=new JSZip(),folder=zip.folder(state.fileName+"-cricut-color-studio");
    folder.file(state.fileName+"-combined.svg",svgFor(activeLayers));
    activeLayers.forEach((l,i)=>{
      const layerSvg=svgFor([l]);
      folder.file(String(i+1).padStart(2,"0")+"-"+l.color.slice(1)+".svg",layerSvg);
    });
    const m=$("material").value;
    const materialName=m==="htv"?"Iron-on / heat-transfer vinyl (HTV)":m==="paper"?"Cardstock / paper":"Adhesive vinyl";
    const guide=`CRICUT COLOR STUDIO — V1.1.0
Project: ${state.fileName}
Finished width: ${state.width} inches
Material selected: ${materialName}
Cut detail preset: ${$("cleanupPreset").value}
Flat Color mode: Yes
Similar colors merged: ${state.merge ? "Yes" : "No"}
Flatten shading: ${$("flattenShading").value}
Simplify for Cutting: ${$("simplifyStrength").value}
Layer overlap: ${state.overlapMM>0 ? state.overlapMM+" mm" : "Off"}
Minimum piece area override: ${$("minRegion").value}
Separate black linework: ${$("addBlackOutlines").checked ? "Yes (experimental)" : "No"}
Crop percentages (top/right/bottom/left): ${state.crop.top}/${state.crop.right}/${state.crop.bottom}/${state.crop.left}
Color layers exported: ${activeLayers.length} of ${state.layers.length}

FILES
- ${state.fileName}-combined.svg: all color layers in their original alignment.
- Numbered SVG files: one enabled color layer per file, all sharing the same viewBox and dimensions. Disabled layers are omitted from all SVG exports.

QUICK START
1. Open Cricut Design Space and create a new project.
2. Upload the combined SVG. Inspect it on the canvas.
3. If importing separate SVG files, keep every layer at the same size and align their positions before cutting.
4. Choose the appropriate material, blade/tool, and machine settings in Design Space.
5. For multicolor projects, cut each color from its matching material and assemble carefully.
6. For HTV, mirror the design when required by the specific material/workflow and follow the manufacturer's heat and layering instructions.
7. Design Space may assign imported SVG elements to Basic Cut. To draw with a pen, select the intended supported linework and assign Draw > Pen, then Attach related elements to preserve alignment.

IMPORTANT
This app creates vector shapes from image colors; it cannot guarantee that every detail is suitable for cutting. Preview the design, check tiny details, and test on scrap material. Advanced draw-outline mode traces boundaries of dark regions, not true centerlines, and may produce doubled lines. Always inspect before making.
No image is uploaded by this application. Image processing runs in your browser.
`;
    folder.file("START-HERE.txt",guide);
    try{const blob=await zip.generateAsync({type:"blob"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=state.fileName+"-cricut-project.zip";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);}
    catch(e){alert("Could not create the ZIP package. Try downloading the combined SVG instead.");}
  }
  updateMaterialHelp();
})();