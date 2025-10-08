// Temperature Ring — tenths precision, superscript °, pointer arrows, hide title (pure JS, performant)
(() => {
  /* ====== CONFIG ====== */
  const MAIN_TILE_TITLE = 'Outdoor Temperature'; // Disply tile
  const MAIN_TILE_ID    = 'tile-27';             // e.g. 'tile-28'
  const CUR_TILE_TITLE  = 'Outside Temperature'; // your current temp tile (device attribute)
  const CUR_TILE_ID     = 'tile-26';             // e.g. 'tile-25'
  const MAX_TILE_TITLE  = 'Outside_Temp_Max';    // hub variable tile
  const MAX_TILE_ID     = 'tile-24';             // e.g. 'tile-25'
  const MIN_TILE_TITLE  = 'Outside_Temp_Min';    // hub variable tile
  const MIN_TILE_ID     = 'tile-25';

  const RING_THICKNESS_PX = 14;
  const SHOW_DECIMALS = true; // show tenths

  /* ====== CSS ====== */
  const CSS = `
  .temp-ring-host{position:relative;overflow:hidden}
  /* Hide ONLY this tile's title when we add .temp-hide-title to the main tile */
  .temp-hide-title .tile-title, .temp-hide-title .title{display:none!important}

  .temp-ring-wrap{position:absolute;inset:8px;display:grid;place-items:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji"}
  .temp-ring-square{position:relative;width:100%;height:100%;aspect-ratio:1/1;display:grid;place-items:center}
  .no-aspect .temp-ring-square::before{content:"";display:block;padding-top:100%}
  .no-aspect .temp-ring-square>.abs{position:absolute;inset:0}
  .temp-ring{width:92%;height:92%;border-radius:999px;background:conic-gradient(var(--ring-c1),var(--ring-c2));
    -webkit-mask:radial-gradient(closest-side,transparent calc(100% - ${RING_THICKNESS_PX}px),black calc(100% - ${RING_THICKNESS_PX-1}px));
    mask:radial-gradient(closest-side,transparent calc(100% - ${RING_THICKNESS_PX}px),black calc(100% - ${RING_THICKNESS_PX-1}px));
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);position:absolute;inset:4%}
  .temp-center{position:absolute;inset:24% 14%;display:grid;place-items:center;gap:6px;text-align:center;pointer-events:none;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.35)}
  .temp-center .row{display:inline-flex;align-items:baseline;gap:6px}
  .temp-center .max,.temp-center .min{font-size:clamp(11px,3.2vw,13px);font-weight:700;opacity:.95}
  .temp-center .now{display:inline-flex;align-items:baseline;gap:2px;font-weight:900;font-size:clamp(26px,10vw,36px);line-height:1.0}
  /* Superscript degree across all rows */
  .temp-center .deg{font-size:.6em;font-weight:800;vertical-align:super;line-height:1}
  /* Pointer arrows */
  .ptr{width:12px;height:12px;display:inline-block;flex:none}
  .ptr svg{width:12px;height:12px;display:block}
  .ptr.up   path{stroke:currentColor}
  .ptr.down path{stroke:currentColor}
  /* Hide the original tile text but keep it for updates */
  .source-hidden{opacity:0!important;position:absolute!important;pointer-events:none!important;width:1px!important;height:1px!important;overflow:hidden!important}
  `;

  /* ====== Color ranges (°F) ====== */
  const COLOR_MAP = [
    {min:-Infinity,max:-10,   c1:'#ff5ccd', c2:'#9a5cff'},
    {min:-10,     max:0,      c1:'#9a5cff', c2:'#4a5cff'},
    {min:0.1,     max:10,     c1:'#4257ff', c2:'#2a8cff'},
    {min:10.1,    max:20,     c1:'#3b63ff', c2:'#3cb1ff'},
    {min:20.1,    max:30,     c1:'#36b0ff', c2:'#4ad8ff'},
    {min:30.1,    max:40,     c1:'#59d6e0', c2:'#9be7ef'},
    {min:40.1,    max:50,     c1:'#a4df4a', c2:'#e3f28a'},
    {min:50.1,    max:60,     c1:'#ffd450', c2:'#ffe27a'},
    {min:60.1,    max:70,     c1:'#ffc54a', c2:'#ffb54a'},
    {min:70.1,    max:80,     c1:'#ffae4a', c2:'#ff974a'},
    {min:80.1,    max:90,     c1:'#ff914a', c2:'#ff7b3a'},
    {min:90.1,    max:100,    c1:'#ff6a3a', c2:'#e84a2a'},
    {min:100.1,   max:110,    c1:'#db3a26', c2:'#b72a22'},
    {min:110.00001,max:+Infinity,c1:'#a52222', c2:'#7a1a1a'},
  ];

  /* ====== Utilities (perf) ====== */
  const rafDebounce = (fn)=>{let s=false;return(...a)=>{if(s) return;s=true;requestAnimationFrame(()=>{s=false;fn(...a);});};};
  const injectCSSOnce=(id,css)=>{if(!document.getElementById(id)){const s=document.createElement('style');s.id=id;s.textContent=css;document.head.appendChild(s);}};
  function findTileByTitle(title){
    for(const t of document.querySelectorAll('.tile')){
      const el=t.querySelector('.tile-title, .tile .title'); if(el && el.textContent.trim()===title) return t;
    } return null;
  }
  const byIdOrTitle=(id,title)=>(id && document.getElementById(id)) || (title && findTileByTitle(title)) || null;

  // Robust value node finder (attribute & hub var)
  function findValueNode(tile){
    if(!tile) return null;
    const a = tile.querySelector('.tile-contents, .tile-primary, .tile .primary, .tile .value, .tile-content, .tile .content, .tile .attribute, .tile .attributename, .tile .html, .tile .template');
    if(a && a.textContent.trim()) return a;
    const hv = tile.querySelector('div.flex.flex-grow.w.full.justify-center.items-center, div.flex.flex-grow.w-full.justify-center.items-center');
    if(hv && hv.textContent.trim()) return hv;
    let best=null,len=0;
    (function walk(n){ if(!n) return;
      if(n.nodeType===1){
        if(n.children.length===0){
          const t=(n.textContent||'').trim(); if(t && t.length>len){best=n;len=t.length;}
        }
        for(const c of n.children) walk(c);
      }
    })(tile);
    return best||tile;
  }
  const nodeText = el => (el?.innerText || el?.textContent || '').trim();
  const parseNum = s => {const m=(s||'').match(/-?\d+(?:\.\d+)?/); return m?parseFloat(m[0]):NaN;};
  function colorFor(t){
    for(const r of COLOR_MAP){
      if(!Number.isFinite(r.min) && t<=r.max) return [r.c1,r.c2];
      if(!Number.isFinite(r.max) && t> r.min) return [r.c1,r.c2];
      if(t>r.min && t<=r.max) return [r.c1,r.c2];
    }
    return ['#4aa3ff','#78c9ff'];
  }
  const fmt = v => Number.isFinite(v) ? (SHOW_DECIMALS? v.toFixed(1) : Math.round(v).toString()) : '--';

  /* ====== Arrow SVGs (pointer with tail) ====== */
  const upPointerSVG = () => `
    <span class="ptr up" aria-hidden="true">
      <svg viewBox="0 0 24 24" role="img" focusable="false">
        <path d="M12 20V6M12 6l-5 5M12 6l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>`;
  const downPointerSVG = () => `
    <span class="ptr down" aria-hidden="true">
      <svg viewBox="0 0 24 24" role="img" focusable="false">
        <path d="M12 4v14M12 18l-5-5M12 18l5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>`;

  /* ====== Init ====== */
  function initOnTile(mainTile, curTile, maxTile, minTile){
    if(!mainTile || mainTile.dataset.tempRingInstalled==='1') return;
    mainTile.dataset.tempRingInstalled='1';

    injectCSSOnce('temp-ring-style-perf2', CSS);

    // Hide this tile's title
    mainTile.classList.add('temp-hide-title');

    let mainNode = findValueNode(mainTile);
    if(!mainNode) return;
    mainNode.classList.add('source-hidden');

    const wrap=document.createElement('div'); wrap.className='temp-ring-wrap';
    const square=document.createElement('div'); square.className='temp-ring-square';
    const ring=document.createElement('div'); ring.className='temp-ring';
    const center=document.createElement('div'); center.className='temp-center';
    center.innerHTML = `
      <div class="row max">${upPointerSVG()}<span class="v">--</span><span class="deg">°</span></div>
      <div class="row now"><span class="v">--</span><span class="deg">°</span></div>
      <div class="row min">${downPointerSVG()}<span class="v">--</span><span class="deg">°</span></div>`;
    square.appendChild(ring); square.appendChild(center); wrap.appendChild(square);

    if(!('aspectRatio' in document.documentElement.style)){
      wrap.classList.add('no-aspect'); const abs=document.createElement('div'); abs.className='abs';
      while(square.firstChild) abs.appendChild(square.firstChild); square.appendChild(abs);
    }

    mainTile.classList.add('temp-ring-host'); mainTile.appendChild(wrap);

    let curNode = curTile ? findValueNode(curTile) : null;
    let maxNode = maxTile ? findValueNode(maxTile) : null;
    let minNode = minTile ? findValueNode(minTile) : null;

    const maxEl=center.querySelector('.max .v');
    const nowEl=center.querySelector('.now .v');
    const minEl=center.querySelector('.min .v');

    const refresh = rafDebounce(()=> {
      const tNow = parseNum(nodeText(curNode));
      const tMax = maxNode ? parseNum(nodeText(maxNode)) : NaN;
      const tMin = minNode ? parseNum(nodeText(minNode)) : NaN;

      nowEl.textContent = fmt(tNow);
      maxEl.textContent = fmt(tMax);
      minEl.textContent = fmt(tMin);

      const [c1,c2] = colorFor(tNow);
      ring.style.setProperty('--ring-c1', c1);
      ring.style.setProperty('--ring-c2', c2);
      center.style.setProperty('--now-color', c2);
    });

    // Observe *only* the leaf nodes
    const observeLeaf=(node)=> node && new MutationObserver(refresh).observe(node,{subtree:true,childList:true,characterData:true});
    observeLeaf(mainNode); if(maxNode) observeLeaf(maxNode); if(minNode) observeLeaf(minNode);
    refresh();

    // Light re-linker every 2s (handles Hubitat replacing value nodes)
    setInterval(()=> {
      const nMain=findValueNode(mainTile);
      if(nMain && nMain!==mainNode){ mainNode.classList.remove('source-hidden'); mainNode=nMain; mainNode.classList.add('source-hidden'); observeLeaf(mainNode); refresh(); }
      if(maxTile){ const nMax=findValueNode(maxTile); if(nMax && nMax!==maxNode){ maxNode=nMax; observeLeaf(maxNode); refresh(); } }
      if(minTile){ const nMin=findValueNode(minTile); if(nMin && nMin!==minNode){ minNode=nMin; observeLeaf(minNode); refresh(); } }
    }, 2000);
  }

  function bootOnce(){
    injectCSSOnce('temp-ring-style-perf2', CSS);
    const mainTile = byIdOrTitle(MAIN_TILE_ID, MAIN_TILE_TITLE);
    const curTile  = byIdOrTitle(CUR_TILE_ID,  CUR_TILE_TITLE);
    const maxTile  = byIdOrTitle(MAX_TILE_ID,  MAX_TILE_TITLE);
    const minTile  = byIdOrTitle(MIN_TILE_ID,  MIN_TILE_TITLE);
    if(mainTile) initOnTile(mainTile, curTile, maxTile, minTile);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', bootOnce, {once:true});
  } else {
    bootOnce(); setTimeout(bootOnce, 600); // single retry
  }
})();

