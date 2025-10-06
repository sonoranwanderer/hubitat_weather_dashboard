// Wind Compass — centered, performant, gust from Hub Variable (pure JS)
(() => {
  /* ====== CONFIG ====== */
  const MAIN_TILE_TITLE = 'Wind Compass';          // Display tile
  const MAIN_TILE_ID    = 'tile-22';               // e.g. 'tile-28'
  const WIND_TILE_TITLE = 'Wind Compass';          // your wind attribute tile
  const WIND_TILE_ID    = 'tile-17';               // e.g. 'tile-28'
  const GUST_TILE_TITLE = 'Gust_Compass_Bearing';  // hub variable tile
  const GUST_TILE_ID    = 'tile-23';               // e.g. 'tile-25'
  const GUST_MATCH_EPSILON = 0.05;                 // fallback heuristic mph

  // SVG geometry (viewBox 0..200)
  const RING_OUTER = 92, ARROW_BASE_R = 89, ARROW_TIP_R = 74;
  const ARROW_BASE_HALF_CURRENT = 6, ARROW_BASE_HALF_GUST = 7.5;
  const BASE_WIDTH = 320, SCALE_MIN = 0.75, SCALE_MAX = 1.10;

  /* ====== CSS ====== */
  const CSS = `
  .wind-compass-tile{position:relative;overflow:hidden;--k:1}
  .wind-shell{position:absolute;inset:8px;display:grid;place-items:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji"}
  .compass-square{position:relative;width:100%;height:100%;aspect-ratio:1/1;display:grid;place-items:center}
  .no-aspect .compass-square::before{content:"";display:block;padding-top:100%}
  .no-aspect .compass-square>.compass-abs{position:absolute;inset:0}
  .compass-square svg{width:100%;height:100%;display:block}
  .wind-source-hidden{opacity:0!important;position:absolute!important;pointer-events:none!important;width:1px!important;height:1px!important;overflow:hidden!important}
  :root{--ring:#5f6b7a;--ring-alt:#8aa4c2;--ticks:#8091a7;--text:currentColor;--needle-current:#4cc3ff;--needle-gust:#ff9f43}
  .center-stack{position:absolute;inset:28% 18%;display:grid;place-items:center;gap:4px;text-align:center;pointer-events:none;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.35)}
  .center-stack .bearing{font-weight:700;font-size:calc(12px*var(--k));opacity:.95}
  .center-stack .speed{display:inline-flex;align-items:center;gap:6px;font-weight:800;font-size:calc(21px*var(--k));color:var(--needle-current);line-height:1.05}
  .center-stack .gust{font-weight:800;font-size:calc(14px*var(--k));color:var(--needle-gust);line-height:1.05}
  .center-stack .unit{font-size:calc(12px*var(--k));opacity:.9}
  .icon{width:15px;height:15px;display:inline-block}
  .icon svg{width:15px;height:15px;display:block}
  .arrow-surface{filter:drop-shadow(0 0 2px rgba(0,0,0,.35))}
  `;

  /* ====== Utilities (perf) ====== */
  const rafDebounce = (fn)=>{let s=false;return(...a)=>{if(s) return;s=true;requestAnimationFrame(()=>{s=false;fn(...a);});};};
  const injectCSSOnce = (id,css)=>{if(!document.getElementById(id)){const s=document.createElement('style');s.id=id;s.textContent=css;document.head.appendChild(s);}};
  const qsa = (s,root=document)=>Array.from(root.querySelectorAll(s));

  function findTileByTitle(title){
    for(const t of qsa('.tile')){
      const el=t.querySelector('.tile-title, .tile .title');
      if(el && el.textContent.trim()===title) return t;
    }
    return null;
  }
  const byIdOrTitle=(id,title)=> (id && document.getElementById(id)) || (title && findTileByTitle(title)) || null;

  // Robust value node finder (device attribute OR hub variable)
  function findValueNode(tile){
    if(!tile) return null;
    const attr = tile.querySelector('.tile-contents, .tile-primary, .tile .primary, .tile .value, .tile-content, .tile .content, .tile .attribute, .tile .attributename, .tile .html, .tile .template');
    if(attr && attr.textContent.trim()) return attr;
    const hubVar = tile.querySelector('div.flex.flex-grow.w-full.justify-center.items-center');
    if(hubVar && hubVar.textContent.trim()) return hubVar;
    // Fallback: deepest leaf with text
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

  /* ====== SVG bits ====== */
  const svgEl = tag => document.createElementNS('http://www.w3.org/2000/svg', tag);
  function buildCompassSVG(){
    const svg=svgEl('svg'); svg.setAttribute('viewBox','0 0 200 200'); svg.setAttribute('aria-label','Wind Compass');
    const ring=svgEl('circle'); ring.setAttribute('cx','100'); ring.setAttribute('cy','100'); ring.setAttribute('r',String(RING_OUTER));
    ring.setAttribute('fill','none'); ring.setAttribute('stroke','var(--ring)'); ring.setAttribute('stroke-width','2.5'); svg.appendChild(ring);
    const r2=svgEl('circle'); r2.setAttribute('cx','100'); r2.setAttribute('cy','100'); r2.setAttribute('r','70');
    r2.setAttribute('fill','none'); r2.setAttribute('stroke','var(--ring-alt)'); r2.setAttribute('stroke-width','1.2'); r2.setAttribute('stroke-dasharray','4 6'); svg.appendChild(r2);
    for(let d=0; d<360; d+=30){
      const rad=(d-90)*Math.PI/180, r1=86, rO=92, x1=100+r1*Math.cos(rad), y1=100+r1*Math.sin(rad), x2=100+rO*Math.cos(rad), y2=100+rO*Math.sin(rad);
      const tick=svgEl('line'); tick.setAttribute('x1',x1.toFixed(2)); tick.setAttribute('y1',y1.toFixed(2)); tick.setAttribute('x2',x2.toFixed(2)); tick.setAttribute('y2',y2.toFixed(2));
      tick.setAttribute('stroke','var(--ticks)'); tick.setAttribute('stroke-width', (d%90===0)?'2':'1'); svg.appendChild(tick);
    }
    for(const {t,x,y} of [{t:'N',x:100,y:22},{t:'E',x:178,y:103},{t:'S',x:100,y:188},{t:'W',x:22,y:103}]){
      const txt=svgEl('text'); txt.setAttribute('x',x); txt.setAttribute('y',y); txt.setAttribute('fill','var(--text)'); txt.setAttribute('font-size','14'); txt.setAttribute('font-weight','700');
      txt.setAttribute('text-anchor','middle'); txt.setAttribute('dominant-baseline','middle'); txt.textContent=t; svg.appendChild(txt);
    }
    const arrows=svgEl('g'); arrows.setAttribute('class','arrow-surface'); svg.appendChild(arrows);
    return {svg, arrows};
  }
  function makeArrow({outline=false,color='black',baseHalf=6}){
    const tipY=100-ARROW_TIP_R, baseY=100-ARROW_BASE_R, leftX=100-baseHalf, rightX=100+baseHalf;
    const p=svgEl('polygon'); p.setAttribute('points',`${leftX},${baseY} ${rightX},${baseY} 100,${tipY}`);
    if(outline){ p.setAttribute('fill','none'); p.setAttribute('stroke',color); p.setAttribute('stroke-width','3'); p.setAttribute('stroke-linejoin','round'); }
    else { p.setAttribute('fill',color); }
    return p;
  }
  const setRot = (el,deg)=> el && el.setAttribute('transform', `rotate(${Number.isFinite(deg)?deg:0} 100 100)`);

  const iconSpeedSVG = () => `
    <span class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" role="img" focusable="false">
        <path d="M3 12h10a3 3 0 1 0-3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M3 16h13a2.5 2.5 0 1 1-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M3 8h6a2 2 0 1 0-2-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </span>`;

  /* ====== Parsing ====== */
  function parseMainWind(text){
    const L=(text||'').split('\n').map(s=>s.trim()).filter(Boolean);
    let deg=NaN,speed=NaN,gust=NaN;
    if(L[0]){const m=L[0].match(/(-?\d+(?:\.\d+)?)\s*°/); if(m) deg=parseFloat(m[1]);}
    if(L[1]){const m=L[1].match(/(-?\d+(?:\.\d+)?)/);    if(m) speed=parseFloat(m[1]);}
    if(L[2]){const m=L[2].match(/(-?\d+(?:\.\d+)?)/);    if(m) gust=parseFloat(m[1]);}
    return {deg,speed,gust};
  }
  function parseBearingDegrees(text){
    const m=(text||'').match(/(-?\d+(?:\.\d+)?)\s*°?/);
    if(!m) return NaN; let d=parseFloat(m[1]); if(!Number.isFinite(d)) return NaN;
    return ((d%360)+360)%360;
  }
  function card16(deg){
    if(!Number.isFinite(deg)) return '--';
    const dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    const d=((deg%360)+360)%360; return dirs[Math.floor((d+11.25)/22.5)%16];
  }

  /* ====== Init ====== */
  function initOnceOnTile(mainTile, windTile, gustTile){
    if(!windTile || windTile.dataset.windCompassInstalled==='1') return;
    windTile.dataset.windCompassInstalled='1';

    injectCSSOnce('wind-compass-style-perf', CSS);

    let windNode = findValueNode(windTile);
    if(!windNode) return;
    let mainNode = findValueNode(mainTile);
    if(!mainNode) return;
    mainNode.classList.add('wind-source-hidden');

    const shell=document.createElement('div'); shell.className='wind-shell';
    const square=document.createElement('div'); square.className='compass-square';
    if(!('aspectRatio' in document.documentElement.style)) shell.classList.add('no-aspect');

    const {svg,arrows}=buildCompassSVG(); square.appendChild(svg);

    const stack=document.createElement('div'); stack.className='center-stack';
    stack.innerHTML = `
      <div class="bearing">--</div>
      <div class="speed">${iconSpeedSVG()}<span class="val">--</span></div>
      <div class="gust"><span class="label">Gust:&nbsp;</span><span class="val">--</span></div>
      <div class="unit">mph</div>`;
    square.appendChild(stack);

    shell.appendChild(square);
    mainTile.classList.add('wind-compass-tile');
    mainTile.appendChild(shell);

    const currentArrow=makeArrow({outline:false,color:'var(--needle-current)',baseHalf:ARROW_BASE_HALF_CURRENT});
    const gustArrow   =makeArrow({outline:true, color:'var(--needle-gust)',   baseHalf:ARROW_BASE_HALF_GUST});
    arrows.appendChild(currentArrow); arrows.appendChild(gustArrow); svg.appendChild(arrows);

    const bearingEl=stack.querySelector('.bearing');
    const speedEl  =stack.querySelector('.speed .val');
    const gustEl   =stack.querySelector('.gust .val');

    // gust dir state + storage
    const tileId = windTile.id || windTile.getAttribute('data-id') || 'wind-tile';
    const gustKey = `windCompass_gustDir_${tileId}`;
    let gustDirDeg = Number.parseFloat(localStorage.getItem(gustKey));
    if(!Number.isFinite(gustDirDeg)) gustDirDeg = NaN;

    // ---- Observe main value node (leaf only) ----
    const refresh = rafDebounce(() => {
      const {deg,speed,gust} = parseMainWind(nodeText(windNode));
      if(Number.isFinite(deg)){
        bearingEl.textContent = `${card16(deg)} ${Math.round(((deg%360)+360)%360)}°`;
        setRot(currentArrow, deg);
      } else {
        bearingEl.textContent='--';
      }

      // keep gust arrow: prefer gust tile reading if valid, else fallback memory
      const showGustDeg = Number.isFinite(gustDirDeg) ? gustDirDeg : (Number.isFinite(deg)?deg:0);
      setRot(gustArrow, showGustDeg);

      speedEl.textContent = Number.isFinite(speed)? speed.toFixed(1) : '--';
      gustEl.textContent  = Number.isFinite(gust) ? gust.toFixed(1)  : '--';

      // if no gust tile yet, update memory when speed ~= gust
      if(!Number.isFinite(gustDirDeg) && Number.isFinite(speed) && Number.isFinite(gust) && Number.isFinite(deg)){
        if(Math.abs(speed-gust) <= GUST_MATCH_EPSILON){
          gustDirDeg = deg; try{localStorage.setItem(gustKey,String(gustDirDeg));}catch(_){}
          setRot(gustArrow, gustDirDeg);
        }
      }
    });

    const moWind = new MutationObserver(refresh);
    moWind.observe(windNode, {subtree:true, childList:true, characterData:true});
    refresh();

    // Light re-linker (main leaf might get swapped)
    setInterval(()=> {
      const n = findValueNode(windTile);
      if(n && n!==windNode){
        windNode.classList.remove('wind-source-hidden');
        windNode = n; windNode.classList.add('wind-source-hidden');
        moWind.disconnect(); moWind.observe(windNode,{subtree:true,childList:true,characterData:true});
        refresh();
      }
    }, 2000);

    // ---- Gust variable tile (leaf only) ----
    if(gustTile){
      let gustNode = findValueNode(gustTile);
      const readGust = rafDebounce(()=> {
        const d = parseBearingDegrees(nodeText(gustNode));
        if(Number.isFinite(d)){
          gustDirDeg = d; try{localStorage.setItem(gustKey,String(gustDirDeg));}catch(_){}
          setRot(gustArrow, gustDirDeg);
        }
      });
      if(gustNode){
        const moG = new MutationObserver(readGust);
        moG.observe(gustNode, {subtree:true,childList:true,characterData:true});
        readGust();
        setInterval(()=> {
          const nn = findValueNode(gustTile);
          if(nn && nn!==gustNode){ moG.disconnect(); gustNode=nn; moG.observe(gustNode,{subtree:true,childList:true,characterData:true}); readGust(); }
        }, 2000);
      }
    }

    // ---- Resize (no intervals) ----
    const resize = rafDebounce(()=> {
      const w = mainTile.getBoundingClientRect().width;
      const k = Math.max(SCALE_MIN, Math.min(SCALE_MAX, w/BASE_WIDTH));
      mainTile.style.setProperty('--k', String(k));
    });
    resize();
    if('ResizeObserver' in window){ new ResizeObserver(resize).observe(mainTile); }
    else { window.addEventListener('resize', resize, {passive:true}); }
  }

  function bootOnce(){
    injectCSSOnce('wind-compass-style-perf', CSS);
    const mainTile = byIdOrTitle(MAIN_TILE_ID, MAIN_TILE_TITLE);
    const windTile = byIdOrTitle(WIND_TILE_ID, WIND_TILE_TITLE);
    const gustTile = byIdOrTitle(GUST_TILE_ID, GUST_TILE_TITLE);
    if(mainTile) initOnceOnTile(mainTile, windTile, gustTile);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', bootOnce, {once:true});
  } else {
    bootOnce(); setTimeout(bootOnce, 600); // single retry
  }
})();

