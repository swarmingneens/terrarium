/**
 * Terrarium Loop
 * Primordial soup animation (from colony.json) + chat replay overlay.
 * No live API needed — runs entirely from static data.
 *
 * Usage:
 *   TerrariumLoop.init('canvas-id', colonyData);
 *   TerrariumLoop.destroy();
 */

(function TerrariumLoopModule() {
  'use strict';

  // ── constants ────────────────────────────────────────────────────────────
  const PARTICLE_COUNT = 280;
  const BG             = '#05040b';
  const WEB_DIST       = 80;
  const WEB_MAX_LINKS  = 4;
  const GRID_CELL      = 85;

  // Chat replay
  const CHAT_SHOW_MS   = 5200;   // how long each post stays fully visible
  const CHAT_FADE_MS   = 1400;   // fade-in + fade-out duration
  const CHAT_GAP_MS    = 1800;   // gap between posts
  const MAX_VISIBLE    = 5;      // max posts visible at once

  const FALLBACK_PALETTE = [
    '#c084fc','#67e8f9','#86efac','#fde68a',
    '#f9a8d4','#a5f3fc','#bbf7d0','#fcd34d',
    '#e879f9','#38bdf8',
  ];

  // MBTI → color tint
  const MBTI_COLORS = {
    INTJ:'#8b5cf6', INTP:'#6366f1', ENTJ:'#a855f7', ENTP:'#818cf8',
    INFJ:'#ec4899', INFP:'#f472b6', ENFJ:'#e879f9', ENFP:'#f9a8d4',
    ISTJ:'#22d3ee', ISTP:'#67e8f9', ESTJ:'#38bdf8', ESTP:'#7dd3fc',
    ISFJ:'#4ade80', ISFP:'#86efac', ESFJ:'#34d399', ESFP:'#6ee7b7',
  };

  // ── helpers ──────────────────────────────────────────────────────────────
  function hexToRGB(hex) {
    const h = (hex||'#8844ff').replace('#','');
    const f = h.length===3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h.padEnd(6,'0');
    return { r:parseInt(f.slice(0,2),16)||0, g:parseInt(f.slice(2,4),16)||0, b:parseInt(f.slice(4,6),16)||0 };
  }
  function lerp(a,b,t) { return a+(b-a)*t; }
  function clamp(v,lo,hi) { return Math.max(lo,Math.min(hi,v)); }
  function noise(x,y,z) {
    const s1 = Math.sin(x*1.3+z*0.7)*Math.cos(y*1.1+z*0.5);
    const s2 = Math.sin(x*2.7-y*1.9+z*1.3)*0.5;
    const s3 = Math.cos(x*0.8+y*2.1+z*0.3)*0.3;
    return (s1+s2+s3)/1.8;
  }

  // ── module state ─────────────────────────────────────────────────────────
  let canvas, ctx, dpr=1, W=0, H=0;
  let rafId=null, lastFrame=0, t=0;

  const sig    = { energy:0.5, stillness:0.0, murk:0.0, clarity:0.6, mutation:0.1, awakeFrac:0.6, palette:[...FALLBACK_PALETTE] };
  const smooth = { energy:0.5, stillness:0.0, murk:0.0, clarity:0.6, mutation:0.1, bloom:0.0, awakeFrac:0.6 };

  const vortices=[], blooms=[], particles=[];
  let _grid = new Map();
  const agentOrbs = new Map();

  // Chat replay state
  let _chatPosts    = [];   // full list
  let _chatIndex    = 0;    // next post to show
  let _visiblePosts = [];   // { post, shownAt, state: 'in'|'hold'|'out' }
  let _nextShowAt   = 0;    // performance.now() timestamp

  // ── soup: vortices ───────────────────────────────────────────────────────
  function makeVortex() {
    const lifespan = 18 + Math.random()*28;
    return {
      x: W*(0.12+Math.random()*0.76), y: H*(0.12+Math.random()*0.76),
      vx:(Math.random()-0.5)*0.4, vy:(Math.random()-0.5)*0.4,
      spin:(Math.random()<0.5?1:-1)*(0.5+Math.random()*1.1),
      gravity:0.08+Math.random()*0.18,
      colorIdx:Math.floor(Math.random()*10),
      age:0, lifespan, strength:0,
    };
  }
  function initVortices() {
    vortices.length=0;
    const count=3+Math.floor(Math.random()*2);
    for(let i=0;i<count;i++){const v=makeVortex();v.age=Math.random()*v.lifespan*0.5;vortices.push(v);}
  }
  function updateVortices(dt) {
    for(let i=vortices.length-1;i>=0;i--){
      const v=vortices[i]; v.age+=dt;
      const p=v.age/v.lifespan;
      v.strength=p<0.20?p/0.20:p<0.75?1.0:(1-p)/0.25;
      v.strength=clamp(v.strength,0,1);
      if(v.age>=v.lifespan){vortices.splice(i,1);continue;}
      v.vx+=(Math.random()-0.5)*0.06; v.vy+=(Math.random()-0.5)*0.06;
      if(v.x<W*0.15)v.vx+=0.08; if(v.x>W*0.85)v.vx-=0.08;
      if(v.y<H*0.15)v.vy+=0.08; if(v.y>H*0.85)v.vy-=0.08;
      v.vx=clamp(v.vx,-0.55,0.55); v.vy=clamp(v.vy,-0.55,0.55);
      v.x+=v.vx*dt*14; v.y+=v.vy*dt*14;
    }
    const target=3+Math.floor(smooth.energy*(6-3));
    if(vortices.length<target&&Math.random()<dt*0.4)vortices.push(makeVortex());
  }

  function pal(i) {
    const p=sig.palette.length?sig.palette:FALLBACK_PALETTE;
    return p[((i%p.length)+p.length)%p.length];
  }

  function flowAt(px,py) {
    const nx=noise(px/W*2.6,py/H*2.6,t*0.08);
    const ny=noise(px/W*2.6+4.1,py/H*2.6+2.3,t*0.08);
    let fx=nx, fy=ny;
    const speed=0.5+smooth.energy*2.0;
    for(const v of vortices){
      if(v.strength<0.01)continue;
      const dx=px-v.x, dy=py-v.y, d2=dx*dx+dy*dy;
      const r=Math.min(W,H)*(0.28+smooth.energy*0.18);
      if(d2>r*r*1.4||d2<1)continue;
      const d=Math.sqrt(d2), inv=v.strength*speed*(1-d/r)*(1-d/r);
      fx+=(-dy/d)*v.spin*inv*0.75; fy+=(dx/d)*v.spin*inv*0.75;
      fx-=(dx/d)*v.gravity*inv*0.5; fy-=(dy/d)*v.gravity*inv*0.5;
    }
    return {fx,fy};
  }

  // ── soup: particles ───────────────────────────────────────────────────────
  function initParticles() {
    particles.length=0;
    for(let i=0;i<PARTICLE_COUNT;i++){
      particles.push({
        x:Math.random()*W, y:Math.random()*H,
        vx:(Math.random()-0.5)*0.5, vy:(Math.random()-0.5)*0.5,
        r:0.8+Math.random()*3.2, phase:Math.random()*Math.PI*2,
        colorIdx:Math.floor(Math.random()*10), age:Math.random()*30,
      });
    }
  }
  function updateParticles(dt) {
    const speed=0.5+smooth.energy*2.8, still=1-smooth.stillness*0.72, jitter=smooth.mutation*18;
    for(const p of particles){
      p.age+=dt;
      const{fx,fy}=flowAt(p.x,p.y);
      const jx=jitter?noise(p.x/W*7,p.y/H*7,t*0.6+p.phase)*jitter:0;
      const jy=jitter?noise(p.x/W*7+3,p.y/H*7+5,t*0.6+p.phase)*jitter:0;
      p.vx=lerp(p.vx,(fx+jx/18)*speed*still,dt*3.5);
      p.vy=lerp(p.vy,(fy+jy/18)*speed*still,dt*3.5);
      p.x+=p.vx*dt*55; p.y+=p.vy*dt*55;
      if(p.x<-8)p.x=W+4; if(p.x>W+8)p.x=-4;
      if(p.y<-8)p.y=H+4; if(p.y>H+8)p.y=-4;
      if(p.age>12+Math.random()*10){p.colorIdx=Math.floor(Math.random()*Math.max(1,sig.palette.length));p.age=0;}
    }
  }

  // ── soup: grid + webs ──────────────────────────────────────────────────────
  function buildGrid() {
    _grid.clear();
    for(let i=0;i<particles.length;i++){
      const p=particles[i], gc=Math.floor(p.x/GRID_CELL), gr=Math.floor(p.y/GRID_CELL), k=gc*1000+gr;
      if(!_grid.has(k))_grid.set(k,[]);
      _grid.get(k).push(i);
    }
  }
  function gridNeighbors(p) {
    const gc=Math.floor(p.x/GRID_CELL), gr=Math.floor(p.y/GRID_CELL), out=[];
    for(let dc=-1;dc<=1;dc++)for(let dr=-1;dr<=1;dr++){const cell=_grid.get((gc+dc)*1000+(gr+dr));if(cell)for(const i of cell)out.push(i);}
    return out;
  }

  // ── soup: agent orbs ───────────────────────────────────────────────────────
  function initOrbs(agents) {
    agentOrbs.clear();
    const tierBase={0:18,1:14,2:10};
    for(const a of agents){
      const color=MBTI_COLORS[a.mbti]||FALLBACK_PALETTE[Math.abs(a.name.charCodeAt(0)*31)%FALLBACK_PALETTE.length];
      const baseR=tierBase[Math.min(a.generation,2)]??8;
      agentOrbs.set(a.id,{
        id:a.id, name:a.name, color,
        x:W*(0.12+Math.random()*0.76), y:H*(0.12+Math.random()*0.76),
        vx:(Math.random()-0.5)*0.3, vy:(Math.random()-0.5)*0.3,
        r:baseR, targetR:baseR, alpha:0, targetAlpha:0.6+Math.random()*0.3,
        phase:Math.random()*Math.PI*2,
      });
    }
  }
  function updateOrbs(dt) {
    for(const o of agentOrbs.values()){
      const{fx,fy}=flowAt(o.x,o.y);
      const speed=0.12+smooth.energy*0.18;
      o.vx=lerp(o.vx,fx*speed,dt*1.8); o.vy=lerp(o.vy,fy*speed,dt*1.8);
      o.x+=o.vx*dt*38; o.y+=o.vy*dt*38;
      if(o.x<-20)o.x=W+10; if(o.x>W+20)o.x=-10;
      if(o.y<-20)o.y=H+10; if(o.y>H+20)o.y=-10;
      o.r=lerp(o.r,o.targetR,dt*1.5); o.alpha=lerp(o.alpha,o.targetAlpha,dt*1.2);
    }
  }

  // ── soup: draw ─────────────────────────────────────────────────────────────
  function cellTypeColor(type,alpha) {
    if(type==='eukaryote')    return `rgba(100,200,180,${alpha})`;
    if(type==='prokaryote')   return `rgba(200,180,100,${alpha})`;
    if(type==='lipid_vesicle')return `rgba(255,200,80,${alpha})`;
    return `rgba(150,150,150,${alpha})`;
  }

  function drawWebs() {
    buildGrid();
    const webAlpha=(0.05+smooth.clarity*0.12+smooth.awakeFrac*0.06)*(1-smooth.stillness*0.65);
    if(webAlpha<0.008)return;
    const distSq=WEB_DIST*WEB_DIST;
    for(let i=0;i<particles.length;i++){
      const p=particles[i], neighbors=gridNeighbors(p); let links=0;
      for(const j of neighbors){
        if(j<=i||links>=WEB_MAX_LINKS)continue;
        const q=particles[j], dx=q.x-p.x, dy=q.y-p.y, d2=dx*dx+dy*dy;
        if(d2>distSq||d2<4)continue;
        const fade=1-Math.sqrt(d2)/WEB_DIST, a=webAlpha*fade*fade;
        const{r:pr,g:pg,b:pb}=hexToRGB(pal(p.colorIdx));
        const{r:qr,g:qg,b:qb}=hexToRGB(pal(q.colorIdx));
        ctx.beginPath(); ctx.moveTo(p.x,p.y);
        const wobble=smooth.mutation*14*(Math.random()-0.5);
        const mx=(p.x+q.x)/2-dy/Math.sqrt(d2)*wobble, my=(p.y+q.y)/2+dx/Math.sqrt(d2)*wobble;
        ctx.quadraticCurveTo(mx,my,q.x,q.y);
        const grad=ctx.createLinearGradient(p.x,p.y,q.x,q.y);
        grad.addColorStop(0,`rgba(${pr},${pg},${pb},${a.toFixed(3)})`);
        grad.addColorStop(0.5,`rgba(${Math.round((pr+qr)/2)},${Math.round((pg+qg)/2)},${Math.round((pb+qb)/2)},${(a*1.3).toFixed(3)})`);
        grad.addColorStop(1,`rgba(${qr},${qg},${qb},${a.toFixed(3)})`);
        ctx.strokeStyle=grad; ctx.lineWidth=0.35+fade*0.55; ctx.stroke();
        links++;
      }
    }
  }

  function drawParticles() {
    for(const p of particles){
      const hex=pal(p.colorIdx), {r:pr,g:pg,b:pb}=hexToRGB(hex);
      const pulse=0.5+0.5*Math.sin(t*2.0+p.phase);
      const base=0.14+smooth.awakeFrac*0.30+smooth.energy*0.18;
      const alpha=clamp(base*(0.55+pulse*0.45)*(1-smooth.stillness*0.55),0.02,0.95);
      const radius=p.r*(0.75+smooth.energy*0.5);
      ctx.beginPath();
      const grd=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,radius*2.4);
      grd.addColorStop(0,`rgba(${pr},${pg},${pb},${alpha.toFixed(3)})`);
      grd.addColorStop(0.45,`rgba(${pr},${pg},${pb},${(alpha*0.4).toFixed(3)})`);
      grd.addColorStop(1,'rgba(5,4,11,0)');
      ctx.fillStyle=grd; ctx.arc(p.x,p.y,radius*2.4,0,Math.PI*2); ctx.fill();
    }
  }

  function drawOrbs() {
    for(const o of agentOrbs.values()){
      if(o.alpha<0.01)continue;
      const{r:cr,g:cg,b:cb}=hexToRGB(o.color);
      const pulse=0.88+0.12*Math.sin(t*1.8+o.phase);
      const r=o.r*pulse;
      const glowR=r*3.2;
      const glow=ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,glowR);
      glow.addColorStop(0,`rgba(${cr},${cg},${cb},${(o.alpha*0.25).toFixed(3)})`);
      glow.addColorStop(0.5,`rgba(${cr},${cg},${cb},${(o.alpha*0.07).toFixed(3)})`);
      glow.addColorStop(1,'rgba(5,4,11,0)');
      ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(o.x,o.y,glowR,0,Math.PI*2); ctx.fill();
      const core=ctx.createRadialGradient(o.x-r*0.3,o.y-r*0.3,r*0.1,o.x,o.y,r);
      const litR=Math.min(255,cr+70),litG=Math.min(255,cg+70),litB=Math.min(255,cb+70);
      core.addColorStop(0,`rgba(${litR},${litG},${litB},${o.alpha.toFixed(3)})`);
      core.addColorStop(0.5,`rgba(${cr},${cg},${cb},${(o.alpha*0.9).toFixed(3)})`);
      core.addColorStop(1,`rgba(${Math.max(0,cr-30)},${Math.max(0,cg-30)},${Math.max(0,cb-30)},${(o.alpha*0.7).toFixed(3)})`);
      ctx.fillStyle=core; ctx.beginPath(); ctx.arc(o.x,o.y,r,0,Math.PI*2); ctx.fill();
    }
  }

  function drawVortexGlow() {
    for(const v of vortices){
      const hex=pal(v.colorIdx), {r:cr,g:cg,b:cb}=hexToRGB(hex);
      const r=Math.min(W,H)*(0.22+smooth.energy*0.12);
      const brightness=(0.055+smooth.awakeFrac*0.09+smooth.energy*0.045)*v.strength;
      const grd=ctx.createRadialGradient(v.x,v.y,0,v.x,v.y,r);
      grd.addColorStop(0,`rgba(${cr},${cg},${cb},${brightness.toFixed(3)})`);
      grd.addColorStop(0.45,`rgba(${cr},${cg},${cb},${(brightness*0.28).toFixed(3)})`);
      grd.addColorStop(1,'rgba(5,4,11,0)');
      ctx.fillStyle=grd; ctx.fillRect(0,0,W,H);
    }
  }

  function drawVignette() {
    const v=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.25,W/2,H/2,Math.max(W,H)*0.75);
    v.addColorStop(0,'rgba(5,4,11,0)'); v.addColorStop(1,'rgba(5,4,11,0.82)');
    ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
  }

  function drawBlooms() {
    for(let i=blooms.length-1;i>=0;i--){
      const bl=blooms[i]; bl.age+=0.016;
      if(bl.age>=bl.maxAge){blooms.splice(i,1);continue;}
      const progress=bl.age/bl.maxAge, alpha=(1-progress)*(1-progress)*0.75;
      const ringR=progress*Math.min(W,H)*0.44;
      const{r:br,g:bg,b:bb}=hexToRGB(bl.color);
      ctx.beginPath(); ctx.arc(bl.x,bl.y,ringR,0,Math.PI*2);
      ctx.strokeStyle=`rgba(${br},${bg},${bb},${alpha.toFixed(3)})`;
      ctx.lineWidth=1.8*(1-progress); ctx.stroke();
    }
  }

  function smoothSignals(dt) {
    const k=dt*0.55;
    smooth.energy=lerp(smooth.energy,sig.energy,k);
    smooth.stillness=lerp(smooth.stillness,sig.stillness,k);
    smooth.murk=lerp(smooth.murk,sig.murk,k);
    smooth.clarity=lerp(smooth.clarity,sig.clarity,k);
    smooth.mutation=lerp(smooth.mutation,sig.mutation,k);
    smooth.awakeFrac=lerp(smooth.awakeFrac,sig.awakeFrac,k);
    smooth.bloom=lerp(smooth.bloom,sig.bloom,dt*1.4);
    sig.bloom=Math.max(0,sig.bloom-dt*0.12);
  }

  function drawSoup() {
    const trailAlpha=0.042+smooth.stillness*0.045;
    ctx.fillStyle=`rgba(5,4,11,${clamp(trailAlpha,0.03,0.11)})`;
    ctx.fillRect(0,0,W,H);
    drawVortexGlow();
    drawWebs();
    drawParticles();
    drawOrbs();
    drawBlooms();
    drawVignette();
  }

  // ── chat overlay ───────────────────────────────────────────────────────────
  function wrapText(text, maxW, fontSize) {
    // Split into lines that fit within maxW
    const words = text.split(' ');
    const lines = [];
    let line = '';
    ctx.font = `${fontSize}px 'Courier New', monospace`;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function tickChat(now) {
    if (!_chatPosts.length) return;

    // Advance states of visible posts
    for (let i = _visiblePosts.length - 1; i >= 0; i--) {
      const vp = _visiblePosts[i];
      const elapsed = now - vp.shownAt;
      if (vp.state === 'in'   && elapsed > CHAT_FADE_MS)  vp.state = 'hold';
      if (vp.state === 'hold' && elapsed > CHAT_FADE_MS + CHAT_SHOW_MS) vp.state = 'out';
      if (vp.state === 'out'  && elapsed > CHAT_FADE_MS + CHAT_SHOW_MS + CHAT_FADE_MS) {
        _visiblePosts.splice(i, 1);
      }
    }

    // Show next post when it's time
    if (now >= _nextShowAt && _visiblePosts.length < MAX_VISIBLE) {
      const post = _chatPosts[_chatIndex % _chatPosts.length];
      _chatIndex++;
      _visiblePosts.push({ post, shownAt: now, state: 'in' });
      _nextShowAt = now + CHAT_FADE_MS + CHAT_SHOW_MS * 0.6 + CHAT_GAP_MS;
    }
  }

  function drawChat() {
    if (!_visiblePosts.length) return;

    const PANEL_W   = Math.min(420, W * 0.52);
    const FONT_NAME = 11;
    const FONT_BODY = 12;
    const PAD       = 14;
    const LINE_H    = FONT_BODY * 1.65;
    const GAP_BETWEEN = 12;

    // Draw from bottom up
    let y = H * 0.88;

    for (let i = _visiblePosts.length - 1; i >= 0; i--) {
      const { post, shownAt, state } = _visiblePosts[i];
      const now = performance.now();
      const elapsed = now - shownAt;
      let alpha = 1;
      if (state === 'in')  alpha = clamp(elapsed / CHAT_FADE_MS, 0, 1);
      if (state === 'out') alpha = clamp(1 - (elapsed - CHAT_FADE_MS - CHAT_SHOW_MS) / CHAT_FADE_MS, 0, 1);

      // Wrap content
      const maxTextW = PANEL_W - PAD * 2;
      const lines = wrapText(post.content || '', maxTextW, FONT_BODY);
      const cardH = PAD * 1.5 + FONT_NAME * 1.4 + lines.length * LINE_H + PAD * 0.5;
      const x = W - PANEL_W - 20;
      y -= cardH;

      ctx.save();
      ctx.globalAlpha = alpha * 0.92;

      // Card background
      ctx.fillStyle = 'rgba(5,4,11,0.72)';
      ctx.strokeStyle = 'rgba(80,100,70,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(x, y, PANEL_W, cardH, 5);
      ctx.fill();
      ctx.stroke();

      // Author name
      ctx.font = `700 ${FONT_NAME}px 'Courier New', monospace`;
      ctx.fillStyle = '#7ab060';
      ctx.textBaseline = 'top';
      ctx.fillText(post.author || '?', x + PAD, y + PAD * 0.8);

      // Body text
      ctx.font = `${FONT_BODY}px 'Courier New', monospace`;
      ctx.fillStyle = 'rgba(200,210,190,0.88)';
      let lineY = y + PAD * 0.8 + FONT_NAME * 1.5;
      for (const line of lines) {
        ctx.fillText(line, x + PAD, lineY);
        lineY += LINE_H;
      }

      ctx.restore();
      y -= GAP_BETWEEN;
    }
  }

  // ── frame loop ─────────────────────────────────────────────────────────────
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min((ts - lastFrame) / 1000, 0.08);
    lastFrame = ts;
    t += dt;

    smoothSignals(dt);
    updateVortices(dt);
    updateParticles(dt);
    updateOrbs(dt);
    drawSoup();
    tickChat(ts);
    drawChat();
  }

  // ── init from colony.json data ─────────────────────────────────────────────
  function seedFromData(data) {
    const agents = data.agents || [];
    const count  = agents.length || 1;

    // Derive signals from static snapshot
    const gen0 = agents.filter(a => a.generation === 0).length;
    sig.energy    = clamp(0.3 + (count / 80) * 0.5, 0.2, 0.9);
    sig.awakeFrac = clamp(0.4 + (count / 60) * 0.4, 0.3, 0.9);
    sig.clarity   = clamp(0.5 + (gen0 / count) * 0.3, 0.4, 0.9);
    sig.mutation  = 0.15 + Math.random() * 0.15;
    sig.stillness = 0.05;
    sig.murk      = 0.05;

    // Build palette from MBTI colors of agents
    const colors = [];
    for (const a of agents) {
      const c = MBTI_COLORS[a.mbti];
      if (c && !colors.includes(c)) colors.push(c);
      if (colors.length >= 12) break;
    }
    if (colors.length < 4) colors.push(...FALLBACK_PALETTE.slice(0, 6));
    sig.palette = colors;

    initOrbs(agents);

    // Chat posts — only use loop_posts (dispatches stay in their own tab)
    const posts = data.loop_posts || [];
    _chatPosts  = posts;
    _chatIndex  = 0;
    _visiblePosts = [];
    _nextShowAt = performance.now() + 2000; // 2s delay before first post
  }

  // ── resize ─────────────────────────────────────────────────────────────────
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W   = canvas.clientWidth  || 800;
    H   = canvas.clientHeight || 480;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initVortices();
  }

  // ── public API ─────────────────────────────────────────────────────────────
  window.TerrariumLoop = {
    init(canvasId, colonyData) {
      canvas = document.getElementById(canvasId);
      if (!canvas) { console.error('[terrarium-loop] canvas not found:', canvasId); return; }
      ctx = canvas.getContext('2d');
      resize();
      window.addEventListener('resize', resize);
      initParticles();
      seedFromData(colonyData || {});
      lastFrame = performance.now();
      rafId = requestAnimationFrame(frame);
    },
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      window.removeEventListener('resize', resize);
      particles.length = 0; blooms.length = 0; vortices.length = 0;
      agentOrbs.clear(); _visiblePosts = []; _chatPosts = [];
    },
  };
})();
