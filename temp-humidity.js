// Dual Ring Tile — Temperature (left) + Humidity (right)
// Multi-source rotation + countdown + upright battery indicator
// v1.9 — fixes color mapping (green ≥20%, red <20%) and removes duplicate injectCSSOnce

(() => {
  /* ====== CONFIG ====== */
  const HOST_TILE_ID    = 'tile-32';
  const HOST_TILE_TITLE = null;

  const SOURCES = [ { id:'tile-20' }, { id:'tile-6' }, { id:'tile-9' } ];
  const SOURCE_VALUE_SELECTOR = null;

  const ROTATE_EVERY_MS = 5000;
  const HIDE_HOST_TILE_TITLE = true;

  // Temperature color mapping (degF)
  const TEMP_COLORS_F = [
    [-10,'#e95bb8'], [0,'#b253e6'], [10,'#6a60ff'], [20,'#4f66e0'],
    [30,'#3aa2ee'], [40,'#60d0e7'], [50,'#b6df48'], [60,'#ffd15a'],
    [70,'#ffc247'], [80,'#ffb536'], [90,'#ff9f2e'], [100,'#ff8a26'],
    [110,'#f06a20'], [999,'#e25c1a'],
  ];
  const HUMID_ARC_COLOR = '#5a63ff';
  const HUMID_TRACK     = 'rgba(200,205,215,0.35)';

  // SVG canvas
  const VIEW_W = 400, VIEW_H = 200;

  // Rings
  const RING_R = 64, RING_W = 12;
  const LEFT_CX = 120, LEFT_CY = 86;
  const RIGHT_CX = 280, RIGHT_CY = 86;

  // Typography
  const VALUE_FONT_SIZE = 36;
  const LABEL_FONT_SIZE = 14;
  const UNIT_FONT_SIZE  = Math.round(VALUE_FONT_SIZE * 0.45);
  const SUP_RAISE       = Math.round(VALUE_FONT_SIZE * 0.36);
  const SUP_GAP_X       = 3;

  // Labels below rings (factor 1.5)
  const LABEL_OFFSET_FACTOR = 1.5;
  const LEFT_LABEL_Y  = LEFT_CY  + RING_R + RING_W*LABEL_OFFSET_FACTOR;
  const RIGHT_LABEL_Y = RIGHT_CY + RING_R + RING_W*LABEL_OFFSET_FACTOR;

  // Bottom title
  const BOTTOM_TITLE_Y = VIEW_H - 8;

  // Rotate button (bottom-right)
  const BTN_X = VIEW_W - 22, BTN_Y = VIEW_H - 22;
  const BTN_R = 14, BTN_STROKE_W = 2.5;
  const BTN_GREEN = '#36c36a', BTN_RED = '#e2574c', BTN_BG = 'rgba(0,0,0,0.25)';
  const BTN_TEXT_COLOR = '#fff', BTN_TEXT_SIZE = 10;

  // Battery (bottom-left, upright)
  const BATT_GROUP_X = 10;
  const BATT_GROUP_Y = VIEW_H - 20;
  const BATT_OUT_W   = 14;
  const BATT_OUT_H   = 26;
  const BATT_OUT_RX  = 2;

  // Corrected mapping: green when >=20%, red when <20%
  const BATT_COLOR_GOOD = '#36c36a';
  const BATT_COLOR_BAD  = '#e2574c';

  const BATT_STROKE_W= 2;
  const BATT_BAR_GAP = 1;
  const BATT_TEXT_X_OFFSET = 10;
  const BATT_TEXT_SIZE = 12;

  /* ====== CSS ====== */
  const CSS = `
  .duorings-host{position:relative;overflow:hidden}
  .duorings-wrap{position:absolute;inset:8px;display:grid;place-items:center;
    font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji"}
  .duorings-canvas{width:100%;height:100%;display:block}
  .hide-title .tile-title, .hide-title .title{display:none!important}
  .source-hidden{opacity:0!important;position:absolute!important;pointer-events:none!important;width:1px!important;height:1px!important;overflow:hidden!important}
  `;

  /* ====== utilities ====== */
  const injectCSSOnce=(id,css)=>{ if(!document.getElementById(id)){ const s=document.createElement('style'); s.id=id; s.textContent=css; document.head.appendChild(s);} };
  const rafDebounce=(fn)=>{ let p=false; return (...a)=>{ if(p) return; p=true; requestAnimationFrame(()=>{ p=false; fn(...a); }); }; };
  const byId=(id)=> id && document.getElementById(id);
  function findTileByTitle(title){
    for(const t of document.querySelectorAll('.tile')){
      const el=t.querySelector('.tile-title, .tile .title');
      if(el && el.textContent.trim()===title) return t;
    }
    return null;
  }
  const nodeText = el => (el?.innerText || el?.textContent || '').trim();

  function findValueNode(tile){
    if(!tile) return null;
    if(SOURCE_VALUE_SELECTOR){
      const n=tile.querySelector(SOURCE_VALUE_SELECTOR); if(n) return n;
    }
    const attr = tile.querySelector('.tile-contents, .tile-primary, .tile .primary, .tile .value, .tile-content, .tile .content');
    if(attr && attr.textContent.trim()) return attr;
    const hv = tile.querySelector('div.flex.flex-grow.w-full.justify-center.items-center');
    if(hv && hv.textContent.trim()) return hv;
    // deepest leaf
    let best=null,len=0;
    (function walk(n){
      if(!n || n.nodeType!==1) return;
      if(n.children.length===0){
        const t=(n.textContent||'').trim();
        if(t && t.length>len){ best=n; len=t.length; }
      }
      for(const c of n.children) walk(c);
    })(tile);
    return best||tile;
  }

  // ---- icon-targeted extraction + battery ----
  function textAfter(el){
    let n = el && el.nextSibling;
    while(n){
      if(n.nodeType===3){ const s=n.textContent.trim(); if(s) return s; }
      else if(n.nodeType===1){ const s=(n.textContent||'').trim(); if(s) return s; }
      n = n.nextSibling;
    }
    return '';
  }
  function extractFromIcons(root){
    let temp=null, unit='F', hum=null;
    const tIcon = root.querySelector('i.ewi-temperature');
    if(tIcon){
      const s = textAfter(tIcon);
      const m = s.match(/(-?\d+(?:\.\d+)?)\s*°\s*([CF])/i);
      if(m){ temp=parseFloat(m[1]); unit=m[2].toUpperCase(); }
    }
    const hIcon = root.querySelector('i.ewi-humidity');
    if(hIcon){
      const s = textAfter(hIcon);
      const m = s.match(/(\d+(?:\.\d+)?)\s*%/);
      if(m){ hum=parseFloat(m[1]); }
    }
    return { temp, unit, hum };
  }
  function getBatteryPercent(root){
    const batt = root.querySelector('i[class^="ewi-batt"]');
    if(!batt) return null;
    const cls = batt.getAttribute('class') || '';
    const m = cls.match(/ewi-batt(\d{1,3})/i);
    if(m){
      let v = Math.max(0, Math.min(100, parseInt(m[1],10)));
      return v;
    }
    const s = textAfter(batt);
    const p = s.match(/(\d{1,3})\s*%/);
    if(p){
      let v = Math.max(0, Math.min(100, parseInt(p[1],10)));
      return v;
    }
    return null;
  }
  function stripBatteryAdjacentText(root, raw){
    const battEls = root.querySelectorAll('i[class^="ewi-batt"]');
    let cleaned = raw;
    battEls.forEach(el=>{
      const battTxt = textAfter(el);
      if(battTxt){ cleaned = cleaned.replace(battTxt, ''); }
    });
    return cleaned;
  }
  function parseTempHumFromNode(root){
    const r1 = extractFromIcons(root);
    if(r1.temp!=null || r1.hum!=null) return r1;
    const raw = nodeText(root);
    const cleaned = stripBatteryAdjacentText(root, raw);
    let t=null, h=null, unit='F';
    const tm = cleaned.match(/(-?\d+(?:\.\d+)?)\s*°\s*([CF])/i);
    if(tm){ t=parseFloat(tm[1]); unit=m[2].toUpperCase(); }
    const hm = cleaned.match(/(\d+(?:\.\d+)?)\s*%/);
    if(hm){ h=parseFloat(hm[1]); }
    return { temp:t, unit, hum:h };
  }

  const fFromC=(c)=> (c*9/5)+32;
  function tempColorForF(f){ for(const [max,col] of TEMP_COLORS_F){ if(f<=max) return col; } return TEMP_COLORS_F[TEMP_COLORS_F.length-1][1]; }
  const formatTemp=(v)=> (v==null||isNaN(v))?'--':(Math.round(v*10)/10).toFixed(1);
  const formatHum =(v)=> (v==null||isNaN(v))?'--':String(Math.round(v));

  function addText(svg, str, x, y, size, weight=800, anchor='middle'){
    const t=document.createElementNS('http://www.w3.org/2000/svg','text');
    t.setAttribute('x',x); t.setAttribute('y',y);
    t.setAttribute('fill','#fff'); t.setAttribute('text-anchor',anchor);
    t.setAttribute('font-size',size); t.setAttribute('font-weight',weight);
    t.setAttribute('dominant-baseline','middle');
    t.textContent=str; svg.appendChild(t); return t;
  }
  function ringPath(cx,cy,r){ return `M ${cx-r} ${cy} a ${r} ${r} 0 1 0 ${2*r} 0 a ${r} ${r} 0 1 0 ${-2*r} 0`; }
  function placeSuperscript(svg, valueEl, supEl, raise, gapX){
    if(!valueEl||!supEl) return;
    const bb=valueEl.getBBox();
    const centerY=parseFloat(valueEl.getAttribute('y')) || (bb.y+bb.height/2);
    const supX=bb.x+bb.width+gapX;
    const supY=centerY-raise;
    supEl.setAttribute('x',supX);
    supEl.setAttribute('y',supY);
  }
  function cleanTitle(s){
    if(!s) return '';
    let t=s.trim();
    if(/\s+(sensor|aqin)$/i.test(t)) t=t.replace(/\s+(sensor|aqin)$/i,'').trim();
    return t;
  }

  // Rotate button
  function makeRotateButton(svg){
    const g=document.createElementNS(svg.namespaceURI,'g');
    g.setAttribute('class','rotate-btn'); g.style.cursor='pointer';

    const bg=document.createElementNS(svg.namespaceURI,'circle');
    bg.setAttribute('cx',BTN_X); bg.setAttribute('cy',BTN_Y); bg.setAttribute('r',BTN_R);
    bg.setAttribute('fill',BTN_BG);

    const r=BTN_R-4;
    const arc1=document.createElementNS(svg.namespaceURI,'path');
    const arc2=document.createElementNS(svg.namespaceURI,'path');
    const ah1=document.createElementNS(svg.namespaceURI,'path');
    const ah2=document.createElementNS(svg.namespaceURI,'path');

    const d1=`M ${BTN_X-r} ${BTN_Y} A ${r} ${r} 0 0 1 ${BTN_X} ${BTN_Y-r}`;
    const d2=`M ${BTN_X+r} ${BTN_Y} A ${r} ${r} 0 0 1 ${BTN_X} ${BTN_Y+r}`;
    arc1.setAttribute('d',d1); arc2.setAttribute('d',d2);
    for(const a of [arc1,arc2]){
      a.setAttribute('fill','none'); a.setAttribute('stroke', '#36c36a');
      a.setAttribute('stroke-width', String(BTN_STROKE_W));
      a.setAttribute('stroke-linecap','round');
    }
    const ah1d=`M ${BTN_X-2} ${BTN_Y-r-4} l 6 0 l -3 5 z`;
    const ah2d=`M ${BTN_X+2} ${BTN_Y+r+4} l -6 0 l 3 -5 z`;
    ah1.setAttribute('d',ah1d); ah2.setAttribute('d',ah2d);
    ah1.setAttribute('fill','#36c36a'); ah2.setAttribute('fill','#36c36a');

    const text = document.createElementNS(svg.namespaceURI,'text');
    text.setAttribute('x', BTN_X); text.setAttribute('y', BTN_Y+0.5);
    text.setAttribute('fill', BTN_TEXT_COLOR);
    text.setAttribute('font-size', BTN_TEXT_SIZE);
    text.setAttribute('font-weight', 900);
    text.setAttribute('text-anchor','middle');
    text.setAttribute('dominant-baseline','middle');
    text.textContent = '';

    g.appendChild(bg); g.appendChild(arc1); g.appendChild(ah1);
    g.appendChild(arc2); g.appendChild(ah2); g.appendChild(text);

    function setColor(color){
      arc1.setAttribute('stroke',color);
      arc2.setAttribute('stroke',color);
      ah1.setAttribute('fill',color);
      ah2.setAttribute('fill',color);
    }
    return { group:g, setColor, textEl:text };
  }

  // Battery group (upright)
  function makeBatteryGroup(svg){
    const g=document.createElementNS(svg.namespaceURI,'g');
    g.setAttribute('class','battery-block');

    const x = BATT_GROUP_X;
    const y = BATT_GROUP_Y;

    const outX = x - BATT_OUT_W/2;
    const outY = y - BATT_OUT_H/2;

    const outline = document.createElementNS(svg.namespaceURI,'rect');
    outline.setAttribute('x', outX);
    outline.setAttribute('y', outY);
    outline.setAttribute('width', BATT_OUT_W);
    outline.setAttribute('height', BATT_OUT_H);
    outline.setAttribute('rx', BATT_OUT_RX);
    outline.setAttribute('fill', 'none');
    outline.setAttribute('stroke-width', BATT_STROKE_W);

    const cap = document.createElementNS(svg.namespaceURI,'rect');
    cap.setAttribute('x', x - 3);
    cap.setAttribute('y', outY - 4);
    cap.setAttribute('width', 6);
    cap.setAttribute('height', 4);

    const innerPad = 2;
    const barsH = BATT_OUT_H - innerPad*2;
    const barH = (barsH - BATT_BAR_GAP*4) / 5;
    const barW = BATT_OUT_W - innerPad*2;

    const bars = [];
    for(let i=0;i<5;i++){
      const r = document.createElementNS(svg.namespaceURI,'rect');
      const bx = outX + innerPad;
      const by = outY + innerPad + (4-i) * (barH + BATT_BAR_GAP); // bottom-up
      r.setAttribute('x', bx);
      r.setAttribute('y', by);
      r.setAttribute('width', barW);
      r.setAttribute('height', barH);
      r.setAttribute('fill', 'none');
      g.appendChild(r);
      bars.push(r);
    }

    const txt = document.createElementNS(svg.namespaceURI,'text');
    txt.setAttribute('x', outX + BATT_OUT_W + BATT_TEXT_X_OFFSET);
    txt.setAttribute('y', y + 0.5);
    txt.setAttribute('fill', '#fff');
    txt.setAttribute('font-size', BATT_TEXT_SIZE);
    txt.setAttribute('font-weight', 900);
    txt.setAttribute('text-anchor','start');
    txt.setAttribute('dominant-baseline','middle');
    txt.textContent = '';

    g.appendChild(outline);
    g.appendChild(cap);
    g.appendChild(txt);

    function setPercent(v){
      if(v==null || isNaN(v)){
        g.setAttribute('display','none');
        return;
      }
      g.removeAttribute('display');

      // Corrected color rule: GREEN if >=20, RED if <20
      const color = (v >= 20) ? BATT_COLOR_GOOD : BATT_COLOR_BAD;

      outline.setAttribute('stroke', color);
      cap.setAttribute('fill', color);

      const filled = Math.max(0, Math.min(5, Math.round(v/20)));
      for(let i=0;i<5;i++){
        bars[i].setAttribute('fill', i < filled ? color : 'none');
        bars[i].setAttribute('stroke', color);
        bars[i].setAttribute('stroke-width', 1);
      }

      txt.textContent = `${v} %`;
    }

    return { group:g, setPercent };
  }

  function resolveSource(desc){
    const tile = desc.id ? byId(desc.id) : (desc.title ? findTileByTitle(desc.title) : null);
    if(!tile) return null;
    const valueNode = findValueNode(tile);
    const titleNode = tile.querySelector('.tile-title, .tile .title');
    return { tile, valueNode, titleNode };
  }

  function init(hostTile){
    if(!hostTile || hostTile.dataset.duoRingsInstalled==='1') return;
    hostTile.dataset.duoRingsInstalled='1';

    injectCSSOnce('duorings-css-v1_9', CSS);
    if(HIDE_HOST_TILE_TITLE) hostTile.classList.add('hide-title');

    const maybeContent = hostTile.querySelector('.tile-contents, .tile-primary, .tile .primary, .tile .value, .tile-content, .tile .content');
    if(maybeContent) maybeContent.classList.add('source-hidden');

    const wrap = document.createElement('div'); wrap.className='duorings-wrap';
    const svg  = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox', `0 0 ${VIEW_W} ${VIEW_H}`);
    svg.setAttribute('class','duorings-canvas');
    wrap.appendChild(svg);
    hostTile.classList.add('duorings-host');
    hostTile.appendChild(wrap);

    // Tracks
    const leftTrack=document.createElementNS(svg.namespaceURI,'path');
    leftTrack.setAttribute('d', ringPath(LEFT_CX, LEFT_CY, RING_R));
    leftTrack.setAttribute('fill','none'); leftTrack.setAttribute('stroke','rgba(200,205,215,0.25)');
    leftTrack.setAttribute('stroke-width',RING_W); leftTrack.setAttribute('stroke-linecap','round');
    svg.appendChild(leftTrack);

    const rightTrack=document.createElementNS(svg.namespaceURI,'path');
    rightTrack.setAttribute('d', ringPath(RIGHT_CX, RIGHT_CY, RING_R));
    rightTrack.setAttribute('fill','none'); rightTrack.setAttribute('stroke',HUMID_TRACK);
    rightTrack.setAttribute('stroke-width',RING_W); rightTrack.setAttribute('stroke-linecap','round');
    svg.appendChild(rightTrack);

    // Strokes
    const leftTemp=document.createElementNS(svg.namespaceURI,'path');
    leftTemp.setAttribute('d', leftTrack.getAttribute('d'));
    leftTemp.setAttribute('fill','none'); leftTemp.setAttribute('stroke','#ffd15a');
    leftTemp.setAttribute('stroke-width',RING_W); leftTemp.setAttribute('stroke-linecap','round');
    svg.appendChild(leftTemp);

    const rightHum=document.createElementNS(svg.namespaceURI,'path');
    rightHum.setAttribute('d', rightTrack.getAttribute('d'));
    rightHum.setAttribute('fill','none'); rightHum.setAttribute('stroke',HUMID_ARC_COLOR);
    rightHum.setAttribute('stroke-width',RING_W); rightHum.setAttribute('stroke-linecap','round');
    rightHum.setAttribute('pathLength','1');
    svg.appendChild(rightHum);

    // Values
    const tempVal = addText(svg,'--', LEFT_CX, LEFT_CY, VALUE_FONT_SIZE, 900);
    const humVal  = addText(svg,'--', RIGHT_CX, RIGHT_CY, VALUE_FONT_SIZE, 900);

    // Superscripts
    const tempSup = addText(svg,'°', 0,0, UNIT_FONT_SIZE, 900, 'start');
    const humSup  = addText(svg,'%', 0,0, UNIT_FONT_SIZE, 900, 'start');

    // Labels below rings
    addText(svg,'Temperature', LEFT_CX, LEFT_LABEL_Y, LABEL_FONT_SIZE, 700);
    addText(svg,'Humidity',    RIGHT_CX, RIGHT_LABEL_Y, LABEL_FONT_SIZE, 700);

    // Bottom source title
    const bottomTitle = addText(svg,'', VIEW_W/2, BOTTOM_TITLE_Y, 13, 700);

    // Rotate button with countdown
    const btn = makeRotateButton(svg);
    svg.appendChild(btn.group);

    // Battery block
    const batt = makeBatteryGroup(svg);
    svg.appendChild(batt.group);

    // Rotation state
    let sourceMeta = SOURCES.map(resolveSource).filter(Boolean);
    let idx = 0;
    let rotating = true;
    let lastSwitch = Date.now();
    let observer = null;
    let ticker = null;

    function setBtnState(){
      btn.setColor(rotating ? BTN_GREEN : BTN_RED);
      if(rotating){
        const remain = Math.max(0, ROTATE_EVERY_MS - (Date.now() - lastSwitch));
        btn.textEl.textContent = String(Math.ceil(remain/1000));
      } else btn.textEl.textContent = '';
    }

    btn.group.addEventListener('click', (e)=>{
      e.stopPropagation();
      rotating = !rotating;
      if(rotating) lastSwitch = Date.now();
      setBtnState();
    });

    function attachObserver(node){
      if(observer){ try{observer.disconnect();}catch{} }
      if(!node) return;
      observer = new MutationObserver(refresh);
      observer.observe(node, {subtree:true,childList:true,characterData:true});
    }
    function useIndex(newIdx){
      idx = newIdx;
      const cur = sourceMeta[idx];
      lastSwitch = Date.now();
      attachObserver(cur?.valueNode || null);
      refresh();
      setBtnState();
    }
    function resolveAllKeepIndex(){
      const prev = idx;
      sourceMeta = SOURCES.map(resolveSource).filter(Boolean);
      if(sourceMeta.length===0) return;
      if(!sourceMeta[prev]) useIndex(0);
      else attachObserver(sourceMeta[prev].valueNode);
    }
    function startTicker(){
      if(ticker) return;
      ticker = setInterval(()=>{
        resolveAllKeepIndex();
        if(sourceMeta.length===0) return;
        setBtnState();
        if(rotating && sourceMeta.length>1){
          const elapsed = Date.now()-lastSwitch;
          if(elapsed>=ROTATE_EVERY_MS){
            const next=(idx+1)%sourceMeta.length;
            useIndex(next);
          }
        }
      },250);
    }

    function recolorTempRing(tempF){ leftTemp.setAttribute('stroke', tempColorForF(tempF)); }
    function drawHumidity(percent){
      if(percent==null || isNaN(percent)){
        rightHum.setAttribute('stroke-dasharray','0 1');
        humVal.textContent='--';
        return;
      }
      const p=Math.max(0,Math.min(100,percent))/100;
      rightHum.setAttribute('stroke-dasharray', `${p} ${1-p}`);
      humVal.textContent = String(Math.round(percent));
    }

    const refresh = rafDebounce(()=>{
      if(sourceMeta.length===0){ bottomTitle.textContent=''; tempVal.textContent='--'; humVal.textContent='--'; batt.setPercent(null); return; }
      const cur = sourceMeta[idx];
      const titleRaw = cur.titleNode ? cur.titleNode.textContent : '';
      bottomTitle.textContent = cleanTitle(titleRaw);

      const root = cur.valueNode || cur.tile || document;
      const { temp, unit, hum } = parseTempHumFromNode(root);
      const battPct = getBatteryPercent(root);

      let tempF=temp;
      if(temp!=null && unit==='C') tempF=(temp*9/5)+32;
      if(tempF!=null && !isNaN(tempF)){
        tempVal.textContent = (Math.round(tempF*10)/10).toFixed(1);
        recolorTempRing(tempF);
      } else {
        tempVal.textContent='--'; recolorTempRing(70);
      }
      drawHumidity(hum);

      placeSuperscript(svg,tempVal,tempSup,SUP_RAISE,SUP_GAP_X);
      placeSuperscript(svg,humVal,humSup,SUP_RAISE,SUP_GAP_X);

      batt.setPercent(battPct);
    });

    resolveAllKeepIndex();
    if(sourceMeta.length){ useIndex(0); }
    startTicker();
    setBtnState();
    setInterval(refresh,15000);
  }

  function boot(){
    injectCSSOnce('duorings-css-v1_9', CSS);
    const host = byId(HOST_TILE_ID) || (HOST_TILE_TITLE && findTileByTitle(HOST_TILE_TITLE));
    if(host) init(host);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', boot, {once:true});
  } else { boot(); setTimeout(boot,600); }
})();

