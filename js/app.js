/* Cricut Color Studio v1.0.0 — browser-only image processing */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const state = { image: null, fileName: "my-design", count: 8, layers: [], selected: -1, width: 6, merge: false };
  const canvas = $("workCanvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
  const fileInput = $("fileInput");
  const paletteButtons = [...document.querySelectorAll("[data-colors]")];

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
        const maxSide = 700, scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        state.image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        state.fileName = safeName(file.name);
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
    state.image = null; state.layers = []; fileInput.value = "";
    $("workspace").classList.add("hidden"); $("uploadPanel").classList.remove("hidden"); clearError();
  });
  paletteButtons.forEach(btn => btn.addEventListener("click", () => {
    paletteButtons.forEach(b => b.classList.toggle("selected", b === btn));
    state.count = Number(btn.dataset.colors);
    if (state.image) processImage();
  }));
  $("processBtn").addEventListener("click", processImage);
  $("rebuildBtn").addEventListener("click", processImage);
  $("mergeBtn").addEventListener("click", () => {
    state.merge = !state.merge;
    $("mergeBtn").textContent = state.merge ? "Use full color detail" : "Merge similar colors";
    processImage();
  });
  $("material").addEventListener("change", updateMaterialHelp);
  $("downloadCombined").addEventListener("click", downloadCombined);
  $("downloadZip").addEventListener("click", downloadZip);

  function updateMaterialHelp() {
    const m = $("material").value;
    $("materialHelp").textContent = m === "htv"
      ? "HTV is usually mirrored before cutting. Check the material instructions and Design Space settings."
      : m === "paper" ? "Use separate cardstock or paper colors; consider larger shapes for easier assembly."
      : "Use separate adhesive-vinyl colors for each layer.";
    updateWarnings();
  }
  function colorDist(a,b) { return (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2; }
  function quantize(data, requested) {
    const n = data.length / 4, samples = [];
    // Sampling caps k-means cost while keeping spatially diverse pixels.
    const stride = Math.max(1, Math.floor(n / 12000));
    for (let i=0;i<n;i+=stride) {
      const p=i*4, a=data[p+3]/255;
      samples.push([Math.round(data[p]*a+255*(1-a)), Math.round(data[p+1]*a+255*(1-a)), Math.round(data[p+2]*a+255*(1-a))]);
    }
    const k = Math.max(2, Math.min(requested, 12, new Set(samples.map(c=>c.join(","))).size));
    const centers = [];
    // Seed centroids from evenly spaced samples sorted by luminance.
    samples.sort((a,b)=>(a[0]*.299+a[1]*.587+a[2]*.114)-(b[0]*.299+b[1]*.587+b[2]*.114));
    for(let j=0;j<k;j++) centers.push([...samples[Math.min(samples.length-1,Math.floor((j+.5)*samples.length/k))]]);
    for(let iter=0;iter<6;iter++){
      const sums=Array.from({length:k},()=>[0,0,0,0]);
      for(const c of samples){let best=0,bd=Infinity;for(let j=0;j<k;j++){const d=colorDist(c,centers[j]);if(d<bd){bd=d;best=j;}}const s=sums[best];s[0]+=c[0];s[1]+=c[1];s[2]+=c[2];s[3]++;}
      for(let j=0;j<k;j++)if(sums[j][3])centers[j]=sums[j].slice(0,3).map(v=>Math.round(v/sums[j][3]));
    }
    const pixels=new Uint8Array(n);
    for(let i=0;i<n;i++){const p=i*4,c=[data[p],data[p+1],data[p+2]];let best=0,bd=Infinity;for(let j=0;j<k;j++){const d=colorDist(c,centers[j]);if(d<bd){bd=d;best=j;}}pixels[i]=best;}
    // Remove unused centroids and remap indices.
    const used=[...new Set(pixels)].sort((a,b)=>a-b), remap=new Map(used.map((v,i)=>[v,i]));
    for(let i=0;i<n;i++)pixels[i]=remap.get(pixels[i]);
    return {pixels, colors:used.map(i=>centers[i])};
  }
  function findComponents(pixels, w, h, colorCount) {
    const seen = new Uint8Array(pixels.length), comps = Array.from({length:colorCount},()=>[]);
    const queue = new Int32Array(pixels.length);
    for(let start=0;start<pixels.length;start++){
      if(seen[start])continue;
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
        if(simplified.length>=3)paths.push("M"+simplified.map(p=>p[0]+","+p[1]).join(" L")+" Z");
      }
    }
    return paths.join(" ");
  }
  function hex(rgb){return "#"+rgb.map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,"0")).join("").toUpperCase();}
  function processImage() {
    if(!state.image)return;
    const btn=$("processBtn");btn.disabled=true;btn.textContent="Working…";
    // Yield one frame so the busy state is visible.
    setTimeout(()=>{
      try {
        const {width:w,height:h,data}=state.image;
        const q=quantize(data,state.merge?Math.max(2,state.count-2):state.count);
        const comps=findComponents(q.pixels,w,h,q.colors.length);
        const minArea=Number($("minRegion").value||0);
        const layers=[];
        for(let c=0;c<q.colors.length;c++){
          const paths=[];let keptArea=0, removed=0;
          for(const ids of comps[c]){
            if(ids.length<minArea){removed+=ids.length;continue;}
            const d=componentPath(ids,w,h);if(d){paths.push(d);keptArea+=ids.length;}
          }
          if(paths.length)layers.push({color:hex(q.colors[c]),paths,area:keptArea,regions:paths.length,removed,operation:"cut"});
        }
        // Largest / darkest layers are named predictably, without guessing semantic object names.
        // Advanced outline preference marks very dark color groups as intended draw layers.
        // This is project metadata only: Design Space may ignore SVG operation metadata,
        // and these are traced region boundaries rather than true pen centerlines.
        if ($("outlineMode").value === "draw") {
          layers.forEach(l => {
            const rgb = [parseInt(l.color.slice(1,3),16), parseInt(l.color.slice(3,5),16), parseInt(l.color.slice(5,7),16)];
            const luminance = rgb[0]*0.299 + rgb[1]*0.587 + rgb[2]*0.114;
            if (luminance < 85) l.operation = "draw";
          });
        }
        layers.sort((a,b)=>b.area-a.area);
        layers.forEach((l,i)=>{l.name="Color "+(i+1)+(l.operation==="draw"?" · draw intended":"");l.id="layer-"+(i+1);});
        if(!layers.length)throw new Error("No usable regions found. Try a lower cleanup setting or a different image.");
        const widthIn=Math.max(2,Math.min(24,Number($("designWidth").value)||6));
        state.width=widthIn;state.layers=layers;state.selected=-1;
        $("results").classList.remove("hidden");
        $("layerCount").textContent=layers.length+" layers";
        $("dimensions").textContent=widthIn.toFixed(1)+'" wide';
        $("statusPill").textContent="Preview ready";
        renderLayers();renderComposite();updateWarnings();
        $("downloadCombined").disabled=false;$("downloadZip").disabled=false;
      }catch(e){alert(e.message||"Something went wrong while making the layers.");}
      finally{btn.disabled=false;btn.textContent="Make my color layers";}
    },30);
  }
  function svgFor(layers, visibleOnly=false) {
    const w=state.image.width,h=state.image.height, widthIn=state.width, heightIn=widthIn*h/w;
    const groups=layers.map(l=>{
      const op=l.operation||"cut";
      return `<g id="${escapeXml(l.id)}" data-name="${escapeXml(l.name)}" data-color="${l.color}" data-operation="${op}" fill="${l.color}" fill-rule="evenodd" stroke="none">${l.paths.map(d=>`<path d="${d}"/>`).join("")}</g>`;
    }).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${widthIn}in" height="${heightIn.toFixed(3)}in" viewBox="0 0 ${w} ${h}">\n<title>${escapeXml(state.fileName)} - Cricut Color Studio</title>\n<desc>Color-separated vector artwork. Imported SVG elements may need their operations assigned in Cricut Design Space.</desc>\n${groups}\n</svg>`;
  }
  function renderComposite(){
    const host=$("compositePreview");
    const selected=state.selected;
    let layers=state.layers;
    if(selected>=0)layers=[state.layers[selected]];
    host.innerHTML=svgFor(layers);
    const svg=host.querySelector("svg");svg.removeAttribute("width");svg.removeAttribute("height");svg.setAttribute("preserveAspectRatio","xMidYMid meet");
    $("legend").innerHTML="";
    state.layers.forEach((l,i)=>{const b=document.createElement("button");b.className="legend-chip"+(i===selected?" active":"");b.style.background=l.color;b.title=l.name;b.setAttribute("aria-label","Preview "+l.name);b.addEventListener("click",()=>selectLayer(i));$("legend").appendChild(b);});
  }
  function renderLayers(){
    const host=$("layerList");host.innerHTML="";
    state.layers.forEach((l,i)=>{
      const b=document.createElement("button");b.className="layer-item"+(i===state.selected?" active":"");b.type="button";
      const sw=document.createElement("span");sw.className="swatch";sw.style.background=l.color;
      const name=document.createElement("span");name.className="layer-name";name.textContent=l.name;
      const meta=document.createElement("span");meta.className="layer-meta";meta.textContent=`${l.regions} region${l.regions===1?"":"s"} · ${l.area.toLocaleString()} px${l.operation==="draw"?" · draw intended":""}`;
      name.appendChild(meta);const eye=document.createElement("span");eye.className="layer-eye";eye.textContent="◉";
      b.append(sw,name,eye);b.addEventListener("click",()=>selectLayer(i));host.appendChild(b);
    });
  }
  function selectLayer(i){state.selected=state.selected===i?-1:i;renderLayers();renderComposite();}
  function updateWarnings(){
    const m=$("material").value;let msg=[];
    if(m==="htv")msg.push("HTV: mirror the design when required by your material and cutting workflow. Confirm settings and heat instructions for your specific HTV.");
    if(m==="paper")msg.push("Paper/cardstock: test small details and use the correct material setting and blade.");
    if(m==="vinyl")msg.push("Adhesive vinyl: small islands and narrow pieces may be difficult to weed.");
    if(state.layers.length) {
      const tiny=state.layers.reduce((n,l)=>n+l.regions,0);
      if(tiny>80)msg.push("This design has many separate regions. Consider fewer colors or stronger cleanup.");
    }
    msg.push("Cricut Design Space may import all SVG groups as Basic Cut. Assign Draw/Pen operations manually there when needed.");
    $("exportWarnings").textContent=msg.join(" ");
  }
  function download(name,content,type="image/svg+xml;charset=utf-8"){
    const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
  }
  function downloadCombined(){if(state.layers.length)download(state.fileName+"-cricut-color-studio.svg",svgFor(state.layers));}
  async function downloadZip(){
    if(!state.layers.length)return;
    if(typeof JSZip==="undefined"){alert("The ZIP helper could not load. Check your internet connection and refresh; combined SVG export still works.");return;}
    const zip=new JSZip(),folder=zip.folder(state.fileName+"-cricut-color-studio");
    folder.file(state.fileName+"-combined.svg",svgFor(state.layers));
    state.layers.forEach((l,i)=>{
      const layerSvg=svgFor([l]).replace(`id="${escapeXml(l.id)}"`,`id="${escapeXml(l.id)}"`);
      folder.file(String(i+1).padStart(2,"0")+"-"+l.color.slice(1)+".svg",layerSvg);
    });
    const m=$("material").value;
    const materialName=m==="htv"?"Iron-on / heat-transfer vinyl (HTV)":m==="paper"?"Cardstock / paper":"Adhesive vinyl";
    const guide=`CRICUT COLOR STUDIO — V1.0.0
Project: ${state.fileName}
Finished width: ${state.width} inches
Material selected: ${materialName}
Color layers: ${state.layers.length}

FILES
- ${state.fileName}-combined.svg: all color layers in their original alignment.
- Numbered SVG files: one color layer per file, all sharing the same viewBox and dimensions.

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