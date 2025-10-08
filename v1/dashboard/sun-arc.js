/* Sun Arc Tile (Hubitat Dashboard) — v2.6 (IDs-only, layout-correct)
   - Arc geometry unchanged (150° span, centered)
   - Sun hidden at night; no orange segment at night
   - Az/Alt hidden at night
   - Inside-arc rows: LEFT = W/m², RIGHT = UVI (both above Az/Alt)
*/

(() => {
  /* ================= CONFIG (YOUR IDs) ================= */
  const HOST_TILE_ID          = 'tile-31';
  const SUNRISE_TILE_ID       = 'tile-28';
  const SUNSET_TILE_ID        = 'tile-29';
  const CURRENT_TIME_TILE_ID  = 'tile-30'; // display-only; we still use system clock
  const UVI_LUX_TILE_ID       = 'tile-16';

  // Sunrise/Sunset format: "MM/DD/YYYY HH:MM:SS" (24h)
  const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

  // Colors & layout
  const DAY_COLOR   = '#f3b265';   // light orange
  const NIGHT_COLOR = '#90a6c5';   // muted blue/gray
  const SUN_FACE    = '#f4d06f';
  const SUN_STROKE  = '#d7b85d';

  // Keep arc geometry identical to the good version
  const ARC_SPAN_DEG = 150;
  const VIEW_W = 840;       // same double-wide canvas
  const VIEW_H = 340;
  const PADDING = 28;
  const STROKE_W = 14;
  const ARC_TOP_OFFSET = 76;  // ensures sun never clips at top

  // Typography
  const TS_TIME  = 24;  // sunrise/sunset
  const TS_AXALT = 18;  // az/alt
  const TS_SMALL = 18;  // UVI & W/m²

  // Inside-arc vertical positions (UVI/Wm² ABOVE Az/Alt, both inside arc)
  const Y_UVWM2_FACTOR = 0.78; // higher up inside arc
  const Y_AZALT_FACTOR = 0.60; // slightly lower than UVI/Wm², still inside arc

  // Update cadence
  const TICK_MS = 15000;

  /* ================= UTILITIES ================= */
  const injectCSSOnce = (id, css) => {
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id; s.textContent = css; document.head.appendChild(s);
    }
  };
  const rafDebounce = (fn) => {
    let pending = false;
    return (...args) => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; fn(...args); });
    };
  };
  const byId = id => id ? document.getElementById(id) : null;
  const qs  = (root, sel) => root ? root.querySelector(sel) : null;
  const text = (el) => (el?.innerText || el?.textContent || '').trim();

  // Hub-variable value node
  function findHubVarValueNode(tile) {
    if (!tile) return null;
    const hv = tile.querySelector('div.flex.flex-grow.w-full.justify-center.items-center');
    if (hv && hv.textContent.trim()) return hv;
    // deepest leaf fallback
    let best=null, len=0;
    (function walk(n){
      if (!n || n.nodeType!==1) return;
      if (n.children.length===0){
        const t=(n.textContent||'').trim();
        if (t && t.length>len){ best=n; len=t.length; }
      } else for (const c of n.children) walk(c);
    })(tile);
    return best||tile;
  }

  function parseSunDate(str) {
    const m = DATE_RE.exec((str||'').trim());
    if (!m) return null;
    const [MM,DD,YYYY,hh,mm,ss] = [+m[1],+m[2],+m[3],+m[4],+m[5],+(m[6]||0)];
    return new Date(YYYY, MM-1, DD, hh, mm, ss);
  }

  function nowFromTileOrSystem() {
    // Use system time; tile-30 is just a display string.
    return new Date();
  }

  // Point along the 150° arc by fraction (0 left → 1 right)
  function arcPolar(cx, cy, r, frac) {
    const start = (180 + (180-ARC_SPAN_DEG)/2) * Math.PI/180;
    const end   = (360 - (180-ARC_SPAN_DEG)/2) * Math.PI/180;
    const ang   = start + (end - start) * frac;
    return { x: cx + r*Math.cos(ang), y: cy + r*Math.sin(ang), ang };
  }

  function fmtClock(d) {
    let h=d.getHours(), m=d.getMinutes();
    const am = h<12, hr=(h%12)||12;
    return `${hr}:${m.toString().padStart(2,'0')} ${am?'am':'pm'}`;
  }

  // Read UVI + Lux from Ecowitt tile (#tile-16)
  function readUVandLux() {
    const t = byId(UVI_LUX_TILE_ID);
    if (!t) return { uvi:null, lux:null };
    const root = t.querySelector('.tile-contents, .tile-primary, .tile-content') || t;
    let uvi=null, lux=null;

    // UVI
    const uvIco = qs(root,'i.ewi-UV');
    if (uvIco && uvIco.nextSibling) {
      const s = uvIco.nextSibling.textContent || '';
      const m = s.match(/UVI\s*([0-9]+(?:\.[0-9]+)?)/i);
      if (m) uvi = parseFloat(m[1]);
    }
    if (uvi==null){
      const m = (root.textContent||'').match(/UVI\s*([0-9]+(?:\.[0-9]+)?)/i);
      if (m) uvi = parseFloat(m[1]);
    }

    // Lux
    const lxIco = qs(root,'i.ewi-light');
    if (lxIco && lxIco.nextSibling) {
      const s = lxIco.nextSibling.textContent || '';
      const m = s.match(/([0-9]+(?:\.[0-9]+)?)\s*lux/i);
      if (m) lux = parseFloat(m[1]);
    }
    if (lux==null){
      const m = (root.textContent||'').match(/([0-9]+(?:\.[0-9]+)?)\s*lux/i);
      if (m) lux = parseFloat(m[1]);
    }

    return { uvi, lux };
  }

  // Ambient Weather approx: 1 W/m² ≈ 126.7 lux
  const luxToWm2 = lux => lux==null ? null : Math.round((lux/126.7)*10)/10;

  /* ================= RENDER SETUP ================= */
  const CSS = `
  .sunarc-host{position:relative;overflow:hidden}
  .sunarc-wrap{position:absolute;inset:8px;display:grid;place-items:center;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji"}
  .sunarc-canvas{width:100%;height:100%;display:block}
  .sunarc-hide-title .tile-title, .sunarc-hide-title .title{display:none!important}
  .sunarc-hidden{opacity:0;pointer-events:none}
  `;

  function initOnce(host) {
    if (!host || host.dataset.sunArcInstalled==='1') return null;
    host.dataset.sunArcInstalled='1';
    injectCSSOnce('sunarc-css-v26', CSS);

    // Hide native content to avoid overlap
    const tc = host.querySelector('.tile-contents, .tile-primary, .tile-content');
    if (tc) tc.classList.add('sunarc-hidden');
    host.classList.add('sunarc-host','sunarc-hide-title');

    const wrap = document.createElement('div');
    wrap.className='sunarc-wrap';
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
    svg.setAttribute('class','sunarc-canvas');
    wrap.appendChild(svg);
    host.appendChild(wrap);
    return { svg };
  }

  function buildScene(svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    const cx = VIEW_W/2;
    const usableH = VIEW_H - PADDING*2;
    const r = Math.min((VIEW_W - PADDING*2)/2, usableH - ARC_TOP_OFFSET);
    const cy = PADDING + ARC_TOP_OFFSET + r;

    // Base (night) arc
    const basePath = document.createElementNS(svg.namespaceURI,'path');
    const left = arcPolar(cx,cy,r,0), right = arcPolar(cx,cy,r,1);
    const large = ARC_SPAN_DEG > 180 ? 1 : 0;
    const dBase = `M ${left.x} ${left.y} A ${r} ${r} 0 ${large} 1 ${right.x} ${right.y}`;
    basePath.setAttribute('d', dBase);
    basePath.setAttribute('fill','none');
    basePath.setAttribute('stroke', NIGHT_COLOR);
    basePath.setAttribute('stroke-width', STROKE_W);
    basePath.setAttribute('stroke-linecap','round');
    svg.appendChild(basePath);

    // Day overlay (only shown when sun is up)
    const dayPath = document.createElementNS(svg.namespaceURI,'path');
    dayPath.setAttribute('fill','none');
    dayPath.setAttribute('stroke', DAY_COLOR);
    dayPath.setAttribute('stroke-width', STROKE_W);
    dayPath.setAttribute('stroke-linecap','round');
    svg.appendChild(dayPath);

    // Sun icon
    const sunG = document.createElementNS(svg.namespaceURI,'g');
    const sunR = 24;
    const sunC = document.createElementNS(svg.namespaceURI,'circle');
    sunC.setAttribute('r', sunR);
    sunC.setAttribute('fill', SUN_FACE);
    sunC.setAttribute('stroke', SUN_STROKE);
    sunC.setAttribute('stroke-width', 4);
    sunG.appendChild(sunC);
    for (let i=0;i<8;i++){
      const ray = document.createElementNS(svg.namespaceURI,'line');
      const a = i * Math.PI/4, L1 = sunR + 10, L2 = sunR + 18;
      ray.setAttribute('x1', Math.cos(a)*L1);
      ray.setAttribute('y1', Math.sin(a)*L1);
      ray.setAttribute('x2', Math.cos(a)*L2);
      ray.setAttribute('y2', Math.sin(a)*L2);
      ray.setAttribute('stroke', SUN_STROKE);
      ray.setAttribute('stroke-width', 6);
      ray.setAttribute('stroke-linecap','round');
      sunG.appendChild(ray);
    }
    svg.appendChild(sunG);

    // Sunrise & sunset timestamps (inside, near arc ends)
    const tLeft  = document.createElementNS(svg.namespaceURI,'text');
    const tRight = document.createElementNS(svg.namespaceURI,'text');
    [tLeft,tRight].forEach(t=>{
      t.setAttribute('fill','#fff'); t.setAttribute('font-weight',800);
      t.setAttribute('font-size', TS_TIME); t.setAttribute('dominant-baseline','hanging');
    });
    tLeft.setAttribute('text-anchor','start');
    tRight.setAttribute('text-anchor','end');
    svg.appendChild(tLeft); svg.appendChild(tRight);

    // Az/Alt centered line (hidden at night)
    const azAlt = document.createElementNS(svg.namespaceURI,'text');
    azAlt.setAttribute('fill','#fff'); azAlt.setAttribute('font-weight',800);
    azAlt.setAttribute('font-size', TS_AXALT);
    azAlt.setAttribute('text-anchor','middle');
    azAlt.setAttribute('dominant-baseline','middle');
    svg.appendChild(azAlt);

    // Inside-arc small row: LEFT = W/m², RIGHT = UVI (both above Az/Alt)
    const leftRow  = document.createElementNS(svg.namespaceURI,'text');
    const rightRow = document.createElementNS(svg.namespaceURI,'text');
    [leftRow,rightRow].forEach(t=>{
      t.setAttribute('fill','#fff'); t.setAttribute('font-weight',800);
      t.setAttribute('font-size', TS_SMALL); t.setAttribute('dominant-baseline','middle');
    });
    leftRow.setAttribute('text-anchor','start');  // LEFT text anchor
    rightRow.setAttribute('text-anchor','end');   // RIGHT text anchor
    svg.appendChild(leftRow); svg.appendChild(rightRow);

    return { cx, cy, r, dayPath, sunG, tLeft, tRight, azAlt, leftRow, rightRow };
  }

  function render(data, scene) {
    const { sunrise, sunset, now, uvi, lux } = data;
    const { cx, cy, r, dayPath, sunG, tLeft, tRight, azAlt, leftRow, rightRow } = scene;

    // Place sunrise/sunset text just inside the arc ends
    const lp = arcPolar(cx,cy,r,0), rp = arcPolar(cx,cy,r,1);
    tLeft.textContent  = sunrise ? fmtClock(sunrise) : '';
    tRight.textContent = sunset  ? fmtClock(sunset)  : '';
    tLeft.setAttribute('x',  Math.max(PADDING, lp.x + 8));
    tLeft.setAttribute('y',  Math.min(VIEW_H - PADDING, lp.y + 8));
    tRight.setAttribute('x', Math.min(VIEW_W - PADDING, rp.x - 8));
    tRight.setAttribute('y', Math.min(VIEW_H - PADDING, rp.y + 8));

    // Day/night logic
    const valid = sunrise && sunset && (sunset > sunrise);
    let isDay=false, frac=0;
    if (valid) {
      const span = sunset - sunrise;
      frac = Math.min(1, Math.max(0, (now - sunrise)/span));
      isDay = now >= sunrise && now <= sunset;
    }

    // Day segment only when sun is up
    if (isDay) {
      const a0 = arcPolar(cx,cy,r,0);
      const aN = arcPolar(cx,cy,r,frac);
      const large = (ARC_SPAN_DEG * frac) > 180 ? 1 : 0;
      const dDay = `M ${a0.x} ${a0.y} A ${r} ${r} 0 ${large} 1 ${aN.x} ${aN.y}`;
      dayPath.setAttribute('d', dDay);
      dayPath.removeAttribute('display');
    } else {
      dayPath.setAttribute('d','M 0 0');
      dayPath.setAttribute('display','none');
    }

    // Sun visibility
    if (isDay) {
      const p = arcPolar(cx,cy,r,frac);
      sunG.setAttribute('transform', `translate(${p.x},${p.y})`);
      sunG.removeAttribute('display');
    } else {
      sunG.setAttribute('display','none');
    }

    // Inside-arc rows positions
    const yUvWm2 = cy - r * Y_UVWM2_FACTOR; // higher row (closer to top of arc)
    const yAzAlt = cy - r * Y_AZALT_FACTOR; // lower row (closer to center)
    const padX = 16;

    // LEFT = W/m², RIGHT = UVI (inside arc)
    leftRow.setAttribute('x', PADDING + padX);
    leftRow.setAttribute('y', yUvWm2);
    rightRow.setAttribute('x', VIEW_W - PADDING - padX);
    rightRow.setAttribute('y', yUvWm2);

    const w = luxToWm2(lux);
    leftRow.textContent  = (w==null||isNaN(w))   ? '— W/m²' : `${w} W/m²`;
    rightRow.textContent = (uvi==null||isNaN(uvi)) ? 'UVI —' : `UVI ${uvi}`;

    // Az/Alt — hidden at night
    if (isDay) {
      const az = Math.round( (180 - ARC_SPAN_DEG/2) + ARC_SPAN_DEG*frac );
      const altPct = Math.round( (1 - Math.abs(0.5 - frac)/0.5) * 100 );
      azAlt.textContent = `Az ${az}° · Alt ${altPct}%`;
      azAlt.setAttribute('x', cx);
      azAlt.setAttribute('y', yAzAlt);
      azAlt.removeAttribute('display');
    } else {
      azAlt.setAttribute('display','none');
    }
  }

  /* ================= DATA ================= */
  function readSunTimes() {
    const srTile = byId(SUNRISE_TILE_ID);
    const ssTile = byId(SUNSET_TILE_ID);
    const srNode = findHubVarValueNode(srTile);
    const ssNode = findHubVarValueNode(ssTile);
    return {
      sunrise: parseSunDate(text(srNode)),
      sunset:  parseSunDate(text(ssNode)),
    };
  }

  const compute = () => {
    const now = nowFromTileOrSystem();
    const { sunrise, sunset } = readSunTimes();
    const { uvi, lux } = readUVandLux();
    return { now, sunrise, sunset, uvi, lux };
  };

  /* ================= BOOT ================= */
  const host = byId(HOST_TILE_ID);
  if (!host) return;
  const built = initOnce(host);
  if (!built) return;

  const scene = buildScene(built.svg);
  const refresh = rafDebounce(() => render(compute(), scene));

  // Watch source tiles
  const obsCfg = { subtree:true, childList:true, characterData:true };
  const observers = [];
  function watch(id){
    const t = byId(id); if(!t) return;
    const n = findHubVarValueNode(t) || t;
    const mo = new MutationObserver(refresh);
    mo.observe(n, obsCfg); observers.push(mo);
  }
  watch(SUNRISE_TILE_ID);
  watch(SUNSET_TILE_ID);
  watch(UVI_LUX_TILE_ID);
  watch(CURRENT_TIME_TILE_ID);

  // Keep the sun moving
  const timer = setInterval(refresh, TICK_MS);

  // Initial paint
  refresh();

  // Cleanup if tile removed
  const onGone = setInterval(() => {
    if (!document.body.contains(host)) {
      observers.forEach(o=>o.disconnect());
      clearInterval(timer); clearInterval(onGone);
    }
  }, 5000);
})();

