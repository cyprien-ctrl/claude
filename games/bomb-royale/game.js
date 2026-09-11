/* HOT POTATO ROYALE — POC
   Canvas 2D, zéro dépendance. 1 joueur + bots, dernier survivant gagne.
   Boucle: bombe -> passe -> explosion -> élimination. */

// ---------------------------------------------------------------- config
const CFG = {
  view: { w: 1120, h: 660 },
  world: { w: 2400, h: 1600 },
  player: { r: 20, speed: 250, accel: 1600, friction: 10 },
  dash: { speed: 760, time: 0.16, cooldown: 2.2 },
  bomb: {
    // la bombe est TOUJOURS dans les mains de quelqu'un: on la passe au contact
    fuseCarrier: 18,
    fuseGlobal: 52,
    carrierSpeed: 1.28,      // le porteur court plus vite...
    blastRadius: 130,        // ...mais n'a pas de dash
    passRadius: 120,         // portée de passe (réglable au menu)
    passStun: 1.5,           // le receveur est figé, la mèche ne tourne pas encore
    backPassLock: 2.0,       // interdit de la renvoyer tout de suite à l'expéditeur
    passAnim: 0.2,
    respawnDelay: 2.0
  },
  vision: {
    normal: 620, carrier: 980,   // rayon de vision (les ennemis au-delà sont invisibles)
    fade: 150                    // largeur du dégradé au bord
  },
  trap: { slowFactor: .42, slowTime: 1.4, stunTime: 1.1, revealTime: 4, rearm: 6 },
  door: { openTime: 1.0, stayOpen: 4.5, noiseReveal: 4 },
  turnstile: { r: 66, arms: 3, speed: 0.95, thick: 15 },
  gate: { openTime: 3.4, warnTime: 0.9, closedTime: 2.8 },
  slider: { speed: 95, pause: 0.8 },
  box: { respawn: 8, r: 26 },
  bonus: {
    speedMult: 1.5, speedTime: 7, radarTime: 9, shortFuse: 3.5,
    ghostTime: 4.5, sirenRadius: 520, sirenTime: 5,
    dropLife: 18, dropArm: 0.5
  }
};

const COLORS = ['#ff6ec7','#5cf1ff','#b6ff5c','#ffd84d','#ff8b4d','#c08bff','#4dffb0','#ff5c5c'];

/* Objets ramassés dans les cubes mystères. `w` = poids de tirage,
   `wCarrier` = poids quand on porte la bombe (on aide le chassé... et le chasseur). */
const ITEMS = {
  speed:     { name:'TURBO',        color:'#5cf1ff', w:22, wCarrier:26 },
  ghost:     { name:'FANTÔME',      color:'#e6e0ff', w:12, wCarrier:20 },
  radar:     { name:'RADAR',        color:'#b6ff5c', w:16, wCarrier:14 },
  shortfuse: { name:'MÈCHE COURTE', color:'#ff8b4d', w:12, wCarrier:16 },
  glue:      { name:'COLLE',        color:'#a878ff', w:16, wCarrier:8  },
  bear:      { name:'PIÈGE',        color:'#cdd8e8', w:14, wCarrier:6  },
  siren:     { name:'SIRÈNE',       color:'#ffd84d', w:8,  wCarrier:10 }
};
const ITEM_KEYS = Object.keys(ITEMS);
function rollItem(carrying){
  const key = carrying ? 'wCarrier' : 'w';
  let total = 0; for (const k of ITEM_KEYS) total += ITEMS[k][key];
  let r = Math.random()*total;
  for (const k of ITEM_KEYS){ r -= ITEMS[k][key]; if (r <= 0) return k; }
  return 'speed';
}
const NAMES  = ['TOI','Bibou','Kraken','Nono','Pixel','Tofu','Zigzag','Moustache'];

// ---------------------------------------------------------------- utils
const TAU = Math.PI * 2;
const clamp = (v,a,b)=>v<a?a:v>b?b:v;
const lerp  = (a,b,t)=>a+(b-a)*t;
const rand  = (a,b)=>a+Math.random()*(b-a);
const pick  = a=>a[(Math.random()*a.length)|0];
const dist2 = (a,b)=>{const dx=a.x-b.x,dy=a.y-b.y;return dx*dx+dy*dy;};
const dist  = (a,b)=>Math.sqrt(dist2(a,b));

function roundRect(ctx,x,y,w,h,r){
  r = Math.min(r, Math.abs(w)/2, Math.abs(h)/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

// cercle <-> AABB
function resolveCircleRect(p, r, rect){
  if (!rect.solid) return false;
  const cx = clamp(p.x, rect.x, rect.x+rect.w);
  const cy = clamp(p.y, rect.y, rect.y+rect.h);
  const dx = p.x-cx, dy = p.y-cy, d2 = dx*dx+dy*dy;
  if (d2 > r*r) return false;
  if (d2 > 0.0001){
    const d = Math.sqrt(d2);
    p.x = cx + dx/d*r; p.y = cy + dy/d*r;
    return true;
  }
  const left=p.x-rect.x, right=rect.x+rect.w-p.x, top=p.y-rect.y, bot=rect.y+rect.h-p.y;
  const m = Math.min(left,right,top,bot);
  if (m===left) p.x = rect.x-r; else if (m===right) p.x = rect.x+rect.w+r;
  else if (m===top) p.y = rect.y-r; else p.y = rect.y+rect.h+r;
  return true;
}

// cercle <-> segment épais (bras de tourniquet)
function resolveCircleSeg(p, r, ax, ay, bx, by, half){
  const vx=bx-ax, vy=by-ay, L2=vx*vx+vy*vy;
  let t = L2 ? ((p.x-ax)*vx + (p.y-ay)*vy)/L2 : 0;
  t = clamp(t,0,1);
  const cx=ax+vx*t, cy=ay+vy*t;
  let dx=p.x-cx, dy=p.y-cy, d=Math.hypot(dx,dy);
  const min = r+half;
  if (d >= min) return false;
  if (d < 0.001){ dx = -vy; dy = vx; d = Math.hypot(dx,dy) || 1; }
  p.x = cx + dx/d*min; p.y = cy + dy/d*min;
  return true;
}

function rectsOverlap(a,b){
  return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
}

// ---------------------------------------------------------------- niveau
/* Arène "game show": 8 salles reliées par des passages obligés.
   Chaque chokepoint reçoit un piège ou un obstacle qui fait perdre du temps. */
function buildLevel(){
  const W = CFG.world.w, H = CFG.world.h, T = 40;
  const walls=[], grass=[], traps=[], doors=[], spawns=[], boxes=[], dyn=[], chokes=[];

  const wall=(x,y,w,h,c)=>{ const o={x,y,w,h,solid:true,color:c||'#7b4fd0',kind:'wall'}; walls.push(o); return o; };

  wall(0,0,W,T); wall(0,H-T,W,T); wall(0,0,T,H); wall(W-T,0,T,H);

  // cloison percée -> les trous deviennent des passages obligés
  function partition(vertical, pos, from, to, thick, gaps, color){
    let cur = from;
    for (const g of gaps){
      if (g[0] > cur){
        if (vertical) wall(pos, cur, thick, g[0]-cur, color); else wall(cur, pos, g[0]-cur, thick, color);
      }
      cur = g[1];
      chokes.push(vertical
        ? { x:pos, y:g[0], w:thick, h:g[1]-g[0], vertical:true }
        : { x:g[0], y:pos, w:g[1]-g[0], h:thick, vertical:false });
    }
    if (cur < to){
      if (vertical) wall(pos, cur, thick, to-cur, color); else wall(cur, pos, to-cur, thick, color);
    }
  }

  const A='#8f5ad6', B='#a86ae0';
  partition(true,  740,  40, H-40, 44, [[250,390],[730,870],[1180,1320]], A);
  partition(true, 1560,  40, H-40, 44, [[210,350],[660,800],[1250,1390]], A);
  partition(false, 520, 740, 1604, 44, [[1090,1230]], B);
  partition(false,1080, 740, 1604, 44, [[980,1120]], B);
  partition(false, 700,  40,  784, 44, [[290,430]], B);
  partition(false, 900,1560, 2360, 44, [[1930,2070]], B);

  // ce qu'on met dans chaque passage (dans l'ordre des chokes créés)
  // les cubes sont volontairement posés dans les goulets: tentant, mais exposé
  const plan = ['door','box','gate','box','door','turnstile','box','gate','box','door'];
  chokes.forEach((c, i)=>{
    const kind = plan[i % plan.length];
    const cx = c.x + c.w/2, cy = c.y + c.h/2;
    if (kind === 'door'){
      const d = { x:c.x, y:c.y, w:c.w, h:c.h, solid:true, open:0, stay:0, color:'#ffb84d', kind:'door' };
      doors.push(d); walls.push(d);
    } else if (kind === 'gate'){
      const g = { x:c.x, y:c.y, w:c.w, h:c.h, solid:true, kind:'gate', type:'gate',
                  t: rand(0, CFG.gate.openTime+CFG.gate.closedTime), amt:0, vertical:c.vertical };
      dyn.push(g); walls.push(g);
    } else if (kind === 'turnstile'){
      dyn.push({ kind:'turnstile', type:'turnstile', x:cx, y:cy, a:Math.random()*TAU, r:CFG.turnstile.r });
    } else {
      boxes.push({ x:cx, y:cy, t:Math.random()*9, alive:true, cd:0 });
    }
  });

  // murs coulissants: ils font perdre du temps au milieu des salles
  const sliders = [
    [300, 980, 200, 44, 300, 1380],
    [1140, 640, 44, 180, 1420, 640],
    [1860, 1080, 200, 44, 2140, 1080],
    [1000, 1300, 44, 190, 1400, 1300]
  ];
  for (const s of sliders){
    const o = { kind:'slider', type:'slider', x:s[0], y:s[1], w:s[2], h:s[3], solid:true,
                ax:s[0], ay:s[1], bx:s[4], by:s[5], t:Math.random(), dir:1, wait:0, dx:0, dy:0 };
    dyn.push(o); walls.push(o);
  }

  // blocs mousse décoratifs (couverture dans les salles)
  const blocks = [
    [180,180,240,48],[540,240,48,240],[180,1180,260,48],[560,1300,48,220],
    [900,180,48,240],[1280,220,240,48],[880,760,240,48],[1340,760,48,240],
    [900,1200,220,48],[1360,1180,48,200],[1700,180,220,48],[2120,260,48,240],
    [1680,560,48,220],[2040,620,240,48],[1700,1180,240,48],[2120,1260,48,220]
  ];
  const pastel = ['#ff8bd0','#8be0ff','#ffd84d','#a8f36a','#ffa36a'];
  blocks.forEach((b,i)=>wall(b[0],b[1],b[2],b[3], pastel[i%pastel.length]));

  // hautes herbes: on y est masqué de la minimap ET de la vue des autres
  const grassSpots = [
    [110,300,300,180],[110,900,240,230],[430,1380,300,160],
    [800,300,260,170],[1180,880,300,160],[800,1360,280,170],
    [1640,340,300,170],[2020,980,300,200],[1660,1420,300,140],[2140,640,180,220]
  ];
  for (const g of grassSpots) grass.push({x:g[0],y:g[1],w:g[2],h:g[3], seed:Math.random()*99});

  // cubes mystères dans les salles
  const boxSpots = [
    [180,600],[300,180],[480,1480],[620,1080],[300,480],
    [1120,300],[1280,1460],[1420,620],[1020,1450],[1480,980],
    [1900,760],[2260,700],[2260,1480],[2240,420],[1860,1400],[2000,1420]
  ];
  for (const p of boxSpots) boxes.push({ x:p[0], y:p[1], t:Math.random()*9, alive:true, cd:0 });

  const cand = [[140,140],[140,1460],[640,420],[640,1460],[1150,140],[1150,1460],
                [2260,140],[2260,1460],[1900,520],[1900,1200]];
  for (const c of cand) spawns.push({x:c[0],y:c[1]});

  // `traps` reste vide au départ: il ne contient plus que les pièges POSÉS par les joueurs
  return { walls, grass, traps, doors, spawns, boxes, dyn, chokes, w:W, h:H };
}

// ---------------------------------------------------------------- navigation
/* Grille + A*: c'est ce qui empêche les bots de labourer les murs.
   Les murs statiques sont "dilatés" du rayon du joueur, les obstacles
   franchissables (portes, barrières, tourniquets, murs mobiles) ne bloquent
   pas le chemin mais coûtent cher tant qu'ils sont fermés. */
class Nav {
  constructor(level, radius){
    this.cs = 32;
    this.cols = Math.ceil(level.w/this.cs);
    this.rows = Math.ceil(level.h/this.cs);
    const n = this.cols*this.rows;
    this.solid = new Uint8Array(n);
    this.pen   = new Uint8Array(n);   // pénalité dynamique (recalculée 10x/s)
    this.base  = new Uint8Array(n);   // 1 = zone d'un obstacle mobile
    this.level = level;

    const inflate = radius + 3;
    for (let cy=0; cy<this.rows; cy++) for (let cx=0; cx<this.cols; cx++){
      const box = { x:cx*this.cs-inflate, y:cy*this.cs-inflate,
                    w:this.cs+inflate*2, h:this.cs+inflate*2 };
      for (const w of level.walls){
        if (w.kind === 'wall' && rectsOverlap(box,w)){ this.solid[cy*this.cols+cx]=1; break; }
      }
    }
    // zones des obstacles franchissables -> pénalité, jamais un mur
    for (const d of level.doors) this.markZone(d, 1);
    for (const o of level.dyn){
      if (o.kind === 'gate') this.markZone(o, 1);
      else if (o.kind === 'slider')
        this.markZone({ x:Math.min(o.ax,o.bx), y:Math.min(o.ay,o.by),
                        w:Math.abs(o.bx-o.ax)+o.w, h:Math.abs(o.by-o.ay)+o.h }, 1);
      else if (o.kind === 'turnstile')
        this.markZone({ x:o.x-o.r, y:o.y-o.r, w:o.r*2, h:o.r*2 }, 1);
    }
    this.open = new Float32Array(n);
    this.g    = new Float32Array(n);
    this.from = new Int32Array(n);
    this.seen = new Int32Array(n);
    this.stamp = 0;
  }
  markZone(rect, v){
    const c0 = clamp((rect.x/this.cs)|0, 0, this.cols-1), c1 = clamp(((rect.x+rect.w)/this.cs)|0, 0, this.cols-1);
    const r0 = clamp((rect.y/this.cs)|0, 0, this.rows-1), r1 = clamp(((rect.y+rect.h)/this.cs)|0, 0, this.rows-1);
    for (let cy=r0; cy<=r1; cy++) for (let cx=c0; cx<=c1; cx++){
      this.base[cy*this.cols+cx] = v;
      this.solid[cy*this.cols+cx] = 0;
    }
  }
  // pénalités du moment: porte/barrière fermée = cher, mur mobile = cher là où il est
  refresh(level){
    this.pen.fill(0);
    const add = (rect, p)=>{
      const c0 = clamp((rect.x/this.cs)|0,0,this.cols-1), c1 = clamp(((rect.x+rect.w)/this.cs)|0,0,this.cols-1);
      const r0 = clamp((rect.y/this.cs)|0,0,this.rows-1), r1 = clamp(((rect.y+rect.h)/this.cs)|0,0,this.rows-1);
      for (let cy=r0; cy<=r1; cy++) for (let cx=c0; cx<=c1; cx++) this.pen[cy*this.cols+cx] = p;
    };
    for (const d of level.doors) if (d.solid) add(d, 14);
    for (const o of level.dyn){
      if (o.kind === 'gate' && o.solid) add(o, 10);
      else if (o.kind === 'slider') add({x:o.x-10,y:o.y-10,w:o.w+20,h:o.h+20}, 16);
      else if (o.kind === 'turnstile') add({x:o.x-o.r,y:o.y-o.r,w:o.r*2,h:o.r*2}, 5);
    }
  }
  idx(cx,cy){ return cy*this.cols+cx; }
  cellAt(x,y){
    return [clamp((x/this.cs)|0,0,this.cols-1), clamp((y/this.cs)|0,0,this.rows-1)];
  }
  free(cx,cy){ return !this.solid[cy*this.cols+cx]; }
  // cellule libre la plus proche (si on est collé dans un mur)
  nearestFree(cx,cy){
    if (this.free(cx,cy)) return [cx,cy];
    for (let r=1; r<=6; r++)
      for (let dy=-r; dy<=r; dy++) for (let dx=-r; dx<=r; dx++){
        if (Math.abs(dx)!==r && Math.abs(dy)!==r) continue;
        const nx=cx+dx, ny=cy+dy;
        if (nx<0||ny<0||nx>=this.cols||ny>=this.rows) continue;
        if (this.free(nx,ny)) return [nx,ny];
      }
    return null;
  }
  clearLine(ax,ay,bx,by){
    const steps = Math.max(2, (Math.hypot(bx-ax,by-ay)/16)|0);
    for (let i=0;i<=steps;i++){
      const t=i/steps;
      const [cx,cy] = this.cellAt(ax+(bx-ax)*t, ay+(by-ay)*t);
      if (!this.free(cx,cy)) return false;
    }
    return true;
  }
  path(sx,sy,tx,ty){
    let s = this.nearestFree(...this.cellAt(sx,sy));
    let t = this.nearestFree(...this.cellAt(tx,ty));
    if (!s || !t) return null;
    const si = this.idx(s[0],s[1]), ti = this.idx(t[0],t[1]);
    if (si === ti) return [{x:tx,y:ty}];

    const stamp = ++this.stamp;
    const heapI = [], heapF = [];
    const push = (i,f)=>{
      heapI.push(i); heapF.push(f);
      let c = heapI.length-1;
      while (c>0){ const p=(c-1)>>1;
        if (heapF[p] <= heapF[c]) break;
        [heapF[p],heapF[c]]=[heapF[c],heapF[p]]; [heapI[p],heapI[c]]=[heapI[c],heapI[p]]; c=p; }
    };
    const pop = ()=>{
      const top = heapI[0];
      const li = heapI.pop(), lf = heapF.pop();
      if (heapI.length){ heapI[0]=li; heapF[0]=lf;
        let c=0; for(;;){ const l=c*2+1, r=l+1; let m=c;
          if (l<heapF.length && heapF[l]<heapF[m]) m=l;
          if (r<heapF.length && heapF[r]<heapF[m]) m=r;
          if (m===c) break;
          [heapF[m],heapF[c]]=[heapF[c],heapF[m]]; [heapI[m],heapI[c]]=[heapI[c],heapI[m]]; c=m; } }
      return top;
    };
    const hx = t[0], hy = t[1];
    this.seen[si]=stamp; this.g[si]=0; this.from[si]=-1;
    push(si, 0);
    let guard = 0;
    while (heapI.length){
      if (++guard > 9000) return null;
      const cur = pop();
      if (cur === ti) break;
      const cx = cur % this.cols, cy = (cur/this.cols)|0;
      for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++){
        if (!dx && !dy) continue;
        const nx=cx+dx, ny=cy+dy;
        if (nx<0||ny<0||nx>=this.cols||ny>=this.rows) continue;
        const ni = this.idx(nx,ny);
        if (this.solid[ni]) continue;
        if (dx && dy && (this.solid[this.idx(cx+dx,cy)] || this.solid[this.idx(cx,cy+dy)])) continue;
        const step = (dx&&dy) ? 1.41 : 1;
        const ng = this.g[cur] + step + this.pen[ni];
        if (this.seen[ni] === stamp && ng >= this.g[ni]) continue;
        this.seen[ni] = stamp; this.g[ni] = ng; this.from[ni] = cur;
        push(ni, ng + Math.hypot(nx-hx, ny-hy));
      }
    }
    if (this.seen[ti] !== stamp) return null;
    const out = [];
    let n = ti, guard2 = 0;
    while (n !== -1 && ++guard2 < 4000){
      const cx = n % this.cols, cy = (n/this.cols)|0;
      out.push({ x: cx*this.cs + this.cs/2, y: cy*this.cs + this.cs/2 });
      n = this.from[n];
    }
    out.reverse();
    out[out.length-1] = {x:tx, y:ty};
    return out;
  }
}

// ---------------------------------------------------------------- entités
class Player {
  constructor(i, isHuman, spawn){
    this.i = i; this.name = NAMES[i%NAMES.length]; this.color = COLORS[i%COLORS.length];
    this.isHuman = isHuman;
    this.x = spawn.x; this.y = spawn.y; this.vx = 0; this.vy = 0;
    this.r = CFG.player.r; this.face = 0; this.alive = true;
    this.dashT = 0; this.dashCd = 0; this.dashDir = {x:1,y:0};
    this.slow = 0; this.stun = 0; this.revealed = 0; this.speedBoost = 0; this.radar = 0;
    this.shortFuse = 0; this.shortFuseSent = false;
    this.items = [null, null];   // 2 slots max, façon cubes mystères
    this.ghost = 0;              // traverse les murs
    this.carrying = false;
    this.inGrass = false; this.nearDoor = null;
    this.squash = 0; this.walkT = 0;
    this.ai = { path:null, node:0, repath:0, goal:null, think:0, doorT:0,
                lastX:spawn.x, lastY:spawn.y, stuck:0, unstick:0, unstickA:0, react:0 };
  }
  get speed(){
    let s = CFG.player.speed;
    if (this.carrying) s *= CFG.bomb.carrierSpeed;
    if (this.speedBoost>0) s *= CFG.bonus.speedMult;
    if (this.slow>0) s *= CFG.trap.slowFactor;
    return s;
  }
}

class Bomb {
  constructor(){
    this.x=0; this.y=0; this.r=16;
    this.carrier=null; this.lastCarrier=null;
    this.fuse=CFG.bomb.fuseCarrier; this.maxFuse=CFG.bomb.fuseCarrier;
    this.armed=true;
    this.freeze=0;        // mèche gelée tant que le receveur est figé
    this.from=null;       // qui vient de la passer (interdit de lui renvoyer tout de suite)
    this.fromLock=0;
  }
}

// ---------------------------------------------------------------- input
const Input = {
  keys:{}, mouse:{x:0,y:0,down:false}, pressed:{},
  // KeyQ / KeyE encadrent la touche "avancer" sur AZERTY (A/Z/E) comme sur QWERTY (Q/W/E)
  slotCodes: [['KeyQ','Digit1'], ['KeyE','Digit2']],
  doorCode: 'KeyF',
  labels: ['Q','E','F'],
  init(canvas){
    // affiche les vraies lettres du clavier de l'utilisateur quand le navigateur le permet
    if (navigator.keyboard && navigator.keyboard.getLayoutMap){
      navigator.keyboard.getLayoutMap().then(map=>{
        this.labels = [ (map.get('KeyQ')||'q').toUpperCase(),
                        (map.get('KeyE')||'e').toUpperCase(),
                        (map.get('KeyF')||'f').toUpperCase() ];
      }).catch(()=>{});
    }
    addEventListener('keydown', e=>{
      if (!this.keys[e.code]) this.pressed[e.code] = true;
      this.keys[e.code]=true;
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e=>{ this.keys[e.code]=false; });
    canvas.addEventListener('mousemove', e=>{
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX-r.left) * (canvas.width/r.width);
      this.mouse.y = (e.clientY-r.top)  * (canvas.height/r.height);
    });
    canvas.addEventListener('mousedown', ()=>{ this.mouse.down=true; this.pressed.Mouse=true; });
    addEventListener('mouseup', ()=>{ this.mouse.down=false; });
    addEventListener('blur', ()=>{ this.keys={}; this.mouse.down=false; });
  },
  consume(code){ const v = !!this.pressed[code]; this.pressed[code]=false; return v; },
  consumeSlot(i){
    for (const c of this.slotCodes[i]) if (this.consume(c)) return true;
    return false;
  },
  endFrame(){ this.pressed = {}; },
  axis(){
    const k=this.keys; let x=0,y=0;
    if (k.KeyA||k.ArrowLeft) x--;
    if (k.KeyD||k.ArrowRight) x++;
    if (k.KeyW||k.ArrowUp) y--;
    if (k.KeyS||k.ArrowDown) y++;
    const m=Math.hypot(x,y); return m?{x:x/m,y:y/m}:{x:0,y:0};
  }
};

// ---------------------------------------------------------------- son
/* Petit synthé WebAudio: aucun asset, tout est généré à la volée.
   Le contexte n'est créé qu'au premier clic (politique autoplay). */
class Sfx {
  constructor(){ this.ctx = null; this.muted = false; }
  ensure(){
    if (this.ctx || this.muted) return this.ctx;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch(e){ this.muted = true; }
    return this.ctx;
  }
  tone(freq, dur, type='square', vol=0.08, slideTo=0){
    const c = this.ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20,slideTo), c.currentTime+dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime+dur);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(c.currentTime+dur+0.02);
  }
  noise(dur, vol=0.3, filterFreq=900){
    const c = this.ensure(); if (!c) return;
    const n = Math.floor(c.sampleRate*dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<n;i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/n, 2);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=filterFreq;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  }
  pickup(){ [660,880,1320].forEach((f,i)=>setTimeout(()=>this.tone(f,.09,'square',.06), i*55)); }
  use(type){
    if (type==='ghost') this.tone(420,.45,'sine',.07,120);
    else if (type==='speed') this.tone(320,.25,'sawtooth',.06,900);
    else if (type==='siren'){ this.tone(700,.18,'square',.07,400); setTimeout(()=>this.tone(700,.18,'square',.07,400),180); }
    else this.tone(520,.12,'triangle',.07,300);
  }
  pass(){ this.tone(880,.07,'square',.07,1400); this.noise(.06,.12,2400); }
  receive(){ this.tone(180,.16,'square',.09,90); }
  dash(){ this.noise(.14,.16,1800); }
  boom(){ this.noise(.55,.6,600); this.tone(90,.5,'sawtooth',.12,30); }
  tick(hot){ this.tone(hot?1500:1100,.05,'square',.05); }
  win(){ [523,659,784,1046].forEach((f,i)=>setTimeout(()=>this.tone(f,.16,'square',.07), i*110)); }
}

// ---------------------------------------------------------------- jeu
class Game {
  constructor(canvas, opts){
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.level = buildLevel();
    this.nav = new Nav(this.level, CFG.player.r);
    this.navT = 0;
    this.time = 0; this.over = false; this.shake = 0; this.fx = [];
    this.cam = {x:0,y:0};
    this.sfx = new Sfx();
    this.sfx.ensure();                                  // on est dans le clic "JOUER"
    if (this.sfx.ctx && this.sfx.ctx.state === 'suspended') this.sfx.ctx.resume();
    this.hitstop = 0; this.zoom = 1; this.flash = 0; this.lastTick = 99;
    const spawns = this.level.spawns.slice().sort(()=>Math.random()-.5);
    this.players = [];
    const n = 1 + opts.bots;
    for (let i=0;i<n;i++) this.players.push(new Player(i, i===0, spawns[i%spawns.length]));
    this.me = this.players[0];
    this.cam.x = clamp(this.me.x-CFG.view.w/2, 0, this.level.w-CFG.view.w);
    this.cam.y = clamp(this.me.y-CFG.view.h/2, 0, this.level.h-CFG.view.h);
    this.bomb = new Bomb();
    this.globalFuse = CFG.bomb.fuseGlobal;
    this.giveBombTo(pick(this.players.filter(p=>!p.isHuman)) || this.me, true);
    this.announce('LA BOMBE EST LÂCHÉE !', 2.2);
  }

  get alivePlayers(){ return this.players.filter(p=>p.alive); }
  announce(txt, t){ this.toast = {txt, t, max:t, pop:0}; }

  // --- juice
  punch(amount, stop, flash){
    this.zoom = Math.max(this.zoom, 1 + amount);
    if (stop) this.hitstop = Math.max(this.hitstop, stop);
    if (flash) this.flash = Math.max(this.flash, flash);
  }
  burst(x, y, n, color){
    for (let i=0;i<n;i++){
      const a = Math.random()*TAU, sp = rand(80, 420);
      this.fx.push({type:'part', x, y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp-120,
                    t:0, life:rand(.4,.9), color, spin:rand(-12,12), rot:Math.random()*TAU});
    }
  }
  floatText(x, y, txt, color){
    this.fx.push({type:'text', x, y, txt, color, t:0, life:1.1});
  }
  screenToWorld(sx, sy){
    const W = CFG.view.w, H = CFG.view.h, z = this.zoom;
    return { x: (sx - W/2)/z + W/2 + this.cam.x,
             y: (sy - H/2)/z + H/2 + this.cam.y };
  }

  giveBombTo(p, reset, from){
    const b = this.bomb;
    if (b.carrier) b.carrier.carrying = false;
    b.carrier = p;
    p.carrying = true;
    // le receveur encaisse: figé, et la mèche ne repart qu'après
    p.stun = Math.max(p.stun, CFG.bomb.passStun);
    p.vx = p.vy = 0;
    b.freeze = CFG.bomb.passStun;
    b.from = from || null;
    b.fromLock = from ? CFG.bomb.backPassLock + CFG.bomb.passStun : 0;
    if (this.opts.fuse === 'carrier'){
      let f = CFG.bomb.fuseCarrier;
      if (b.lastCarrier && b.lastCarrier.shortFuseSent){ f -= CFG.bonus.shortFuse; b.lastCarrier.shortFuseSent=false; }
      b.fuse = Math.max(4, f); b.maxFuse = CFG.bomb.fuseCarrier;
    } else if (reset){
      b.fuse = this.globalFuse; b.maxFuse = this.globalFuse;
    }
    b.lastCarrier = p;
  }

  // ------------------------------------------------------------ update
  update(dt){
    if (this.hitstop > 0){ this.hitstop -= dt; return; }
    this.zoom = lerp(this.zoom, 1, 1-Math.pow(0.0005, dt));
    this.flash = Math.max(0, this.flash - dt*3.2);
    this.time += dt;
    if (this.toast){ this.toast.t -= dt; if (this.toast.t<=0) this.toast=null; }
    this.shake = Math.max(0, this.shake - dt*3);

    this.navT -= dt;
    if (this.navT <= 0){ this.nav.refresh(this.level); this.navT = 0.1; }

    this.updateDynamics(dt);
    for (const p of this.players){ if (p.alive) this.updatePlayer(p, dt); }
    this.updateBomb(dt);
    this.updateBoxes(dt);
    this.updateTraps(dt);
    this.updateDoors(dt);
    this.updateFx(dt);

    const focus = this.me.alive ? this.me
      : (this.bomb.carrier || (this.bomb.armed ? this.bomb : this.alivePlayers[0] || this.me));
    const tx = clamp(focus.x - CFG.view.w/2, 0, this.level.w - CFG.view.w);
    const ty = clamp(focus.y - CFG.view.h/2, 0, this.level.h - CFG.view.h);
    this.cam.x = lerp(this.cam.x, tx, 1-Math.pow(0.001, dt));
    this.cam.y = lerp(this.cam.y, ty, 1-Math.pow(0.001, dt));

    if (!this.over && this.alivePlayers.length <= 1) this.finish(this.alivePlayers[0]);
    Input.endFrame();
  }

  // obstacles mobiles: barrières rythmées, murs coulissants, tourniquets
  updateDynamics(dt){
    for (const o of this.level.dyn){
      if (o.kind === 'gate'){
        const G = CFG.gate, cycle = G.openTime + G.closedTime;
        o.t = (o.t + dt) % cycle;
        const wasSolid = o.solid;
        o.solid = o.t >= G.openTime;
        o.warn = !o.solid && o.t > G.openTime - G.warnTime;
        o.amt = o.solid ? Math.min(1, (o.t-G.openTime)/0.25) : 0;
        if (o.solid && !wasSolid)
          this.fx.push({type:'ring', x:o.x+o.w/2, y:o.y+o.h/2, r:10, max:70, t:0, life:.35, color:'#ffd84d'});
      } else if (o.kind === 'slider'){
        const S = CFG.slider;
        if (o.wait > 0){ o.wait -= dt; o.dx = o.dy = 0; continue; }
        const len = Math.hypot(o.bx-o.ax, o.by-o.ay) || 1;
        o.t += o.dir * (S.speed/len) * dt;
        if (o.t >= 1){ o.t = 1; o.dir = -1; o.wait = S.pause; }
        if (o.t <= 0){ o.t = 0; o.dir = 1;  o.wait = S.pause; }
        const nx = lerp(o.ax, o.bx, o.t), ny = lerp(o.ay, o.by, o.t);
        o.dx = nx - o.x; o.dy = ny - o.y;
        o.x = nx; o.y = ny;
      } else if (o.kind === 'turnstile'){
        o.a += CFG.turnstile.speed * dt;
      }
    }
  }

  // collisions contre les obstacles mobiles (joueurs et bombe)
  collideDynamics(ent, r){
    let hit = false;
    for (const o of this.level.dyn){
      if (o.kind === 'turnstile'){
        if (dist(o, ent) > o.r + r + 20) continue;
        for (let i=0;i<CFG.turnstile.arms;i++){
          const a = o.a + i*TAU/CFG.turnstile.arms;
          if (resolveCircleSeg(ent, r, o.x, o.y, o.x+Math.cos(a)*o.r, o.y+Math.sin(a)*o.r, CFG.turnstile.thick)){
            // le tourniquet pousse: on perd du temps, on ne passe pas en force
            ent.vx += -Math.sin(a)*60; ent.vy += Math.cos(a)*60;
            hit = true;
          }
        }
      } else if (o.kind === 'slider'){
        const before = {x:ent.x, y:ent.y};
        if (resolveCircleRect(ent, r, o)){
          ent.x += o.dx; ent.y += o.dy;
          if (Math.abs(ent.x-before.x) > 0.01 || Math.abs(ent.y-before.y) > 0.01) hit = true;
        }
      } else if (o.kind === 'gate'){
        if (resolveCircleRect(ent, r, o)) hit = true;
      }
    }
    return hit;
  }

  updatePlayer(p, dt){
    p.slow = Math.max(0, p.slow-dt);
    p.stun = Math.max(0, p.stun-dt);
    p.revealed = Math.max(0, p.revealed-dt);
    p.speedBoost = Math.max(0, p.speedBoost-dt);
    p.radar = Math.max(0, p.radar-dt);
    if (p.ghost > 0){
      p.ghost -= dt;
      if (p.ghost <= 0){
        // on ne finit jamais coincé dans un mur
        const c = this.nav.nearestFree(...this.nav.cellAt(p.x,p.y));
        if (c && !this.nav.free(...this.nav.cellAt(p.x,p.y))){
          p.x = c[0]*this.nav.cs + this.nav.cs/2;
          p.y = c[1]*this.nav.cs + this.nav.cs/2;
          this.fx.push({type:'ring', x:p.x, y:p.y, r:6, max:50, t:0, life:.3, color:'#e6e0ff'});
        }
      }
      if (p.isHuman || Math.random()<.4)
        this.fx.push({type:'trail', x:p.x, y:p.y, t:0, life:.35, color:'#e6e0ff', r:p.r});
    }
    p.dashCd = Math.max(0, p.dashCd-dt);
    p.squash = Math.max(0, p.squash-dt*4);
    p.carrying = (this.bomb.carrier === p);

    let move = {x:0,y:0}, wantDash = false, wantDoor = false, aim = null, wantPass = false;

    if (p.stun > 0){ p.vx*=0.85; p.vy*=0.85; }
    else if (p.isHuman){
      move = Input.axis();
      aim = this.screenToWorld(Input.mouse.x, Input.mouse.y);
      wantDoor = !!Input.keys[Input.doorCode];
      if (Input.consumeSlot(0)) this.useItem(p, 0);
      if (Input.consumeSlot(1)) this.useItem(p, 1);
      if (p.carrying){
        // porteur: pas de dash. ESPACE (ou clic) passe la bombe si quelqu'un est à portée
        if (Input.consume('Space') || Input.consume('Mouse')) wantPass = true;
      } else {
        wantDash = !!Input.keys.Space;
      }
      if (wantPass && p.stun<=0) this.passBomb(p);
    } else {
      const cmd = this.botThink(p, dt);
      move = cmd.move; wantDash = cmd.dash && !p.carrying; aim = cmd.aim; wantDoor = cmd.door;
      if (cmd.pass && p.carrying) this.passBomb(p);
    }

    this.tryDoor(p, wantDoor, dt);

    if (wantDash && !p.carrying && p.dashCd<=0 && p.dashT<=0 && (move.x||move.y)){
      p.dashT = CFG.dash.time; p.dashCd = CFG.dash.cooldown;
      p.dashDir = {...move}; p.squash = 1;
      this.fx.push({type:'ring', x:p.x, y:p.y, r:10, max:46, t:0, life:.3, color:p.color});
      this.sfx.dash();
    }
    if (p.dashT > 0){
      p.dashT -= dt;
      p.vx = p.dashDir.x * CFG.dash.speed; p.vy = p.dashDir.y * CFG.dash.speed;
      this.fx.push({type:'trail', x:p.x, y:p.y, t:0, life:.25, color:p.color, r:p.r});
    } else if (p.stun<=0){
      const s = p.speed, k = Math.min(1, 14*dt);
      p.vx += (move.x*s - p.vx) * k;
      p.vy += (move.y*s - p.vy) * k;
      if (!move.x && !move.y){ p.vx *= Math.max(0,1-CFG.player.friction*dt); p.vy *= Math.max(0,1-CFG.player.friction*dt); }
    }

    p.x += p.vx*dt; p.y += p.vy*dt;
    if (aim) p.face = Math.atan2(aim.y-p.y, aim.x-p.x);
    else if (Math.hypot(p.vx,p.vy)>15) p.face = Math.atan2(p.vy,p.vx);
    p.walkT += Math.hypot(p.vx,p.vy)*dt*0.05;

    if (p.ghost <= 0){
      for (const w of this.level.walls){
        if (w.kind !== 'wall' && w.kind !== 'door') continue;
        const bx=p.x, by=p.y;
        if (resolveCircleRect(p, p.r, w)) this.slide(p, p.x-bx, p.y-by);
      }
      const dx0=p.x, dy0=p.y;
      if (this.collideDynamics(p, p.r)) this.slide(p, p.x-dx0, p.y-dy0, .92);
    }
    p.x = clamp(p.x, p.r, this.level.w-p.r); p.y = clamp(p.y, p.r, this.level.h-p.r);

    p.inGrass = this.level.grass.some(g=>p.x>g.x && p.x<g.x+g.w && p.y>g.y && p.y<g.y+g.h);

    for (const o of this.players){
      if (o===p || !o.alive) continue;
      const d = dist(p,o), min = p.r+o.r;
      if (d>0 && d<min){
        const push=(min-d)/2, nx=(p.x-o.x)/d, ny=(p.y-o.y)/d;
        p.x+=nx*push; p.y+=ny*push; o.x-=nx*push; o.y-=ny*push;
      }
    }
  }

  /* On ne perd que la composante qui rentre dans le mur: on longe la paroi
     à pleine vitesse au lieu de s'y coller. */
  slide(p, nx, ny, keep){
    const L = Math.hypot(nx, ny);
    if (L < 0.0001) return;
    nx /= L; ny /= L;
    const vn = p.vx*nx + p.vy*ny;
    if (vn < 0){ p.vx -= nx*vn; p.vy -= ny*vn; }
    // le dash suit la paroi lui aussi
    if (p.dashT > 0 && p.dashDir){
      const dn = p.dashDir.x*nx + p.dashDir.y*ny;
      if (dn < 0){
        p.dashDir.x -= nx*dn; p.dashDir.y -= ny*dn;
        const m = Math.hypot(p.dashDir.x, p.dashDir.y);
        if (m > 0.001){ p.dashDir.x/=m; p.dashDir.y/=m; } else p.dashT = 0;
      }
    }
    if (keep !== undefined){ p.vx *= keep; p.vy *= keep; }
  }

  // portes: 1s pour ouvrir, ça fait du bruit (tu passes sur la minimap), ça se referme seul
  tryDoor(p, pressing, dt){
    const d = this.level.doors.find(d=>
      p.x > d.x-56 && p.x < d.x+d.w+56 && p.y > d.y-56 && p.y < d.y+d.h+56);
    p.nearDoor = d || null;
    if (!d || !d.solid) return;
    if (pressing){
      d.open += dt/CFG.door.openTime;
      if (d.open >= 1){
        d.solid = false; d.open = 1; d.stay = CFG.door.stayOpen;
        p.revealed = Math.max(p.revealed, CFG.door.noiseReveal);
        this.fx.push({type:'ring', x:d.x+d.w/2, y:d.y+d.h/2, r:20, max:150, t:0, life:.6, color:'#ffd84d'});
        if (p === this.me) this.announce('PORTE OUVERTE — ça s\'entend !', 1.4);
      }
    } else d.open = Math.max(0, d.open - dt*0.7);
  }

  updateDoors(dt){
    for (const d of this.level.doors){
      if (d.solid) continue;
      d.stay -= dt;
      if (d.stay <= 0){
        const blocked = this.alivePlayers.some(p=>
          p.x > d.x-p.r && p.x < d.x+d.w+p.r && p.y > d.y-p.r && p.y < d.y+d.h+p.r);
        if (!blocked){ d.solid = true; d.open = 0; }
        else d.stay = 0.4;
      }
    }
  }

  // Qui peut recevoir la bombe: le plus proche à portée, en ligne de vue,
  // avec un bonus pour celui qu'on vise vraiment.
  passTarget(p){
    if (this.bomb.carrier !== p) return null;
    const R = this.opts.passRadius;
    let best = null, bestScore = 1e9;
    for (const o of this.alivePlayers){
      if (o === p) continue;
      if (this.bomb.fromLock > 0 && o === this.bomb.from) continue;
      const d = dist(p,o);
      if (d > R) continue;
      if (!this.nav.clearLine(p.x,p.y,o.x,o.y)) continue;
      let da = Math.abs(Math.atan2(o.y-p.y, o.x-p.x) - p.face);
      while (da > Math.PI) da = TAU - da;
      const score = d * (da < 1.05 ? 0.6 : 1);   // on privilégie ce qu'on regarde
      if (score < bestScore){ bestScore = score; best = o; }
    }
    return best;
  }

  passBomb(p){
    const target = this.passTarget(p);
    if (!target) return false;
    if (p.shortFuse > 0){ p.shortFuse--; p.shortFuseSent = true; }
    this.fx.push({type:'pass', ax:p.x, ay:p.y, bx:target.x, by:target.y, t:0, life:CFG.bomb.passAnim});
    this.fx.push({type:'ring', x:target.x, y:target.y, r:12, max:64, t:0, life:.35, color:'#ff4d4d'});
    this.giveBombTo(target, false, p);
    p.squash = 1; target.squash = 1;
    this.shake = Math.min(1, this.shake+.25);
    this.punch(.028, .05);
    this.sfx.pass(); setTimeout(()=>this.sfx.receive(), 140);
    this.burst(target.x, target.y, 8, '#ff4d4d');
    this.floatText(target.x, target.y-52, 'TIENS !', '#ff4d4d');
    if (target === this.me) this.announce('TU AS LA BOMBE !', 1.3);
    else if (p === this.me) this.announce('PASSÉE À ' + target.name, 1);
    return true;
  }

  updateBomb(dt){
    const b = this.bomb;
    if (!b.armed) return;
    b.fromLock = Math.max(0, b.fromLock - dt);
    const c = b.carrier;
    if (!c || !c.alive) return;

    // la mèche ne repart qu'une fois le receveur remis de la passe
    if (b.freeze > 0) b.freeze = Math.max(0, b.freeze - dt);
    else {
      const prev = b.fuse;
      b.fuse -= dt;
      // tic-tac: de plus en plus pressant, et seul le porteur l'entend fort
      const step = b.fuse < 5 ? 0.5 : 1;
      if (Math.floor(b.fuse/step) !== Math.floor(prev/step) && b.fuse > 0
          && (c === this.me || dist(c, this.me) < 420)) this.sfx.tick(b.fuse < 5);
      if (b.fuse <= 0){ this.explode(); return; }
    }
    const off = 26;
    b.x = c.x + Math.cos(c.face)*off; b.y = c.y + Math.sin(c.face)*off - 10;
  }

  explode(){
    const b = this.bomb;
    const cx = b.carrier ? b.carrier.x : b.x, cy = b.carrier ? b.carrier.y : b.y;
    this.fx.push({type:'boom', x:cx, y:cy, r:20, max:CFG.bomb.blastRadius, t:0, life:.55});
    this.fx.push({type:'ring', x:cx, y:cy, r:10, max:CFG.bomb.blastRadius*2.2, t:0, life:.7, color:'#fff'});
    this.shake = 1;
    this.punch(.075, .12, .45);
    this.sfx.boom();
    const victims = [];
    for (const p of this.alivePlayers){
      const d = Math.hypot(p.x-cx, p.y-cy);
      if (p === b.carrier || d < CFG.bomb.blastRadius){ p.alive = false; p.carrying = false; victims.push(p); }
    }
    for (const v of victims){
      this.burst(v.x, v.y, 22, v.color);
      this.burst(v.x, v.y, 10, '#ffd84d');
      this.floatText(v.x, v.y-40, 'ÉLIMINÉ', '#ff5c5c');
    }

    if (victims.some(v=>v.isHuman)) this.announce('TU AS EXPLOSÉ 💥', 2.5);
    else if (victims.length) this.announce(victims.map(v=>v.name).join(' + ') + ' explose !', 1.8);

    if (b.carrier) b.carrier.carrying = false;
    b.carrier = null; b.from = null; b.fromLock = 0; b.armed = false;
    setTimeout(()=>{
      if (this.over || this.alivePlayers.length <= 1) return;
      // la bombe doit toujours être dans les mains de quelqu'un: le plus loin du cratère
      const target = this.alivePlayers.slice()
        .sort((a,z)=>Math.hypot(z.x-cx,z.y-cy)-Math.hypot(a.x-cx,a.y-cy))[0];
      this.globalFuse = Math.max(18, this.globalFuse - 6);
      b.armed = true;
      this.giveBombTo(target, true);
      this.announce('NOUVELLE BOMBE → ' + target.name, 1.6);
    }, CFG.bomb.respawnDelay*1000);
  }

  updateTraps(dt){
    for (const t of this.level.traps){
      t.flash = Math.max(0, t.flash-dt);
      if (t.life !== undefined){
        t.life -= dt;
        if (t.arm > 0){ t.arm -= dt; if (t.arm <= 0) t.armed = true; }
      }
      if (!t.armed){ t.cd -= dt; if (t.cd<=0) t.armed=true; continue; }
      for (const p of this.alivePlayers){
        if (dist(t,p) > t.r + p.r) continue;
        if (t.owner === p && t.life > CFG.bonus.dropLife - 1.2) continue;  // on ne se piège pas soi-même à la pose
        if (t.type==='glue'){ p.slow = CFG.trap.slowTime; t.flash=.2; }
        else if (t.type==='stun'){
          p.stun = CFG.trap.stunTime; p.vx=p.vy=0; t.armed=false; t.cd=CFG.trap.rearm; t.flash=.5;
          this.fx.push({type:'ring',x:t.x,y:t.y,r:10,max:70,t:0,life:.4,color:'#ff5c5c'});
          if (p===this.me) this.announce('PIÈGE ! Immobilisé', 1);
        } else {
          p.revealed = CFG.trap.revealTime; t.armed=false; t.cd=CFG.trap.rearm; t.flash=.6;
          this.fx.push({type:'ring',x:t.x,y:t.y,r:10,max:140,t:0,life:.7,color:'#ffd84d'});
          if (p===this.me) this.announce('BRUIT ! Tu es sur la minimap', 1.2);
        }
        if (t.life !== undefined && t.type === 'stun') t.life = 0;   // un piège posé ne sert qu'une fois
      }
    }
    this.level.traps = this.level.traps.filter(t=>t.life === undefined || t.life > 0);
  }

  updateBoxes(dt){
    for (const k of this.level.boxes){
      k.t += dt;
      if (!k.alive){ k.cd -= dt; if (k.cd<=0){ k.alive=true; k.pop=0.35; } continue; }
      if (k.pop > 0) k.pop -= dt;
      for (const p of this.alivePlayers){
        if (dist(k,p) > CFG.box.r + p.r) continue;
        const slot = p.items.indexOf(null);
        if (slot === -1) continue;                 // inventaire plein: le cube reste
        const item = rollItem(p.carrying);
        p.items[slot] = item;
        k.alive = false; k.cd = CFG.box.respawn; k.t = 0;
        this.fx.push({type:'ring', x:k.x, y:k.y, r:10, max:70, t:0, life:.4, color:ITEMS[item].color});
        this.burst(k.x, k.y, 10, ITEMS[item].color);
        if (p === this.me){
          this.floatText(k.x, k.y-30, ITEMS[item].name, ITEMS[item].color);
          this.sfx.pickup();
        }
        break;
      }
    }
  }

  useItem(p, slot){
    const type = p.items[slot];
    if (!type) return false;
    p.items[slot] = null;
    const C = CFG.bonus, I = ITEMS[type];
    if (type === 'speed'){
      p.speedBoost = C.speedTime;
      this.burst(p.x, p.y, 14, I.color);
    } else if (type === 'ghost'){
      p.ghost = C.ghostTime;
      this.fx.push({type:'ring', x:p.x, y:p.y, r:10, max:90, t:0, life:.5, color:I.color});
    } else if (type === 'radar'){
      p.radar += C.radarTime;
      this.fx.push({type:'ring', x:p.x, y:p.y, r:10, max:260, t:0, life:.8, color:I.color});
    } else if (type === 'shortfuse'){
      p.shortFuse++;
    } else if (type === 'glue' || type === 'bear'){
      // on pose derrière soi
      const a = p.face + Math.PI;
      const tx = clamp(p.x + Math.cos(a)*42, 60, this.level.w-60);
      const ty = clamp(p.y + Math.sin(a)*42, 60, this.level.h-60);
      this.level.traps.push({ type: type==='glue' ? 'glue' : 'stun', x:tx, y:ty,
        r: type==='glue' ? 62 : 32, armed:false, cd:0, flash:.4,
        owner:p, arm:CFG.bonus.dropArm, life:CFG.bonus.dropLife, drop:1 });
    } else if (type === 'siren'){
      let n = 0;
      for (const o of this.alivePlayers){
        if (o === p) continue;
        if (dist(o,p) < C.sirenRadius){ o.revealed = Math.max(o.revealed, C.sirenTime); n++; }
      }
      this.fx.push({type:'ring', x:p.x, y:p.y, r:20, max:C.sirenRadius, t:0, life:.9, color:I.color});
      if (p === this.me) this.floatText(p.x, p.y-40, n+' REPÉRÉ'+(n>1?'S':''), I.color);
    }
    if (p === this.me){
      this.floatText(p.x, p.y-46, I.name, I.color);
      this.announce(I.name, 0.9);
    }
    this.sfx.use(type);
    p.squash = 1;
    return true;
  }

  updateFx(dt){
    for (const f of this.fx){
      f.t += dt;
      if (f.type==='part'){ f.x+=f.vx*dt; f.y+=f.vy*dt; f.vy+=900*dt; f.rot=(f.rot||0)+(f.spin||0)*dt; }
    }
    this.fx = this.fx.filter(f=>f.t < f.life);
  }

  finish(winner){
    this.over = true; this.winner = winner;
    this.sfx.win();
    if (winner) this.burst(winner.x, winner.y, 40, '#ffd84d');
    if (this.onEnd) this.onEnd(winner);
  }

  // Choix d'objet du bot: on garde les pièges pour quand ça chauffe.
  botItems(p, dt, hasBomb){
    if (p.stun > 0) return;
    p.ai.itemCd = (p.ai.itemCd || 0) - dt;
    if (p.ai.itemCd > 0) return;
    const carrier = this.bomb.carrier;
    const threat = carrier && carrier !== p ? dist(p, carrier) : 1e9;
    for (let i=0;i<2;i++){
      const it = p.items[i];
      if (!it) continue;
      let use = false;
      if (hasBomb){
        // porteur: tout ce qui aide à rattraper, tout de suite
        use = (it==='speed' || it==='ghost' || it==='radar' || it==='siren');
        if (it==='shortfuse') use = !!this.passTarget(p);
      } else {
        if (it==='speed')  use = threat < 420;
        if (it==='ghost')  use = threat < 280;
        if (it==='glue' || it==='bear') use = threat < 300;
        if (it==='radar')  use = threat > 900;
        if (it==='siren')  use = threat > 700;
        if (it==='shortfuse') use = false;
      }
      if (use){ this.useItem(p, i); p.ai.itemCd = rand(0.5, 1.2); return; }
    }
  }

  // ------------------------------------------------------------ IA bots
  // Un bot choisit un objectif, demande un chemin A*, puis lisse le suivi.
  botThink(p, dt){
    const out = { move:{x:0,y:0}, dash:false, aim:null, pass:false, door:false };
    const b = this.bomb;
    const others = this.alivePlayers.filter(o=>o!==p);
    if (!others.length) return out;

    const hasBomb = b.carrier === p;
    let goal = null, chase = null;
    this.botItems(p, dt, hasBomb);

    if (hasBomb){
      let best=null, bd=1e9;
      for (const o of others){
        const d = dist(p,o) * (this.nav.clearLine(p.x,p.y,o.x,o.y) ? 0.7 : 1);
        if (d<bd){ bd=d; best=o; }
      }
      chase = best; goal = {x:best.x, y:best.y};
      out.aim = goal;
      // on colle à la cible et on passe dès qu'elle est à portée (petit temps de réaction)
      p.ai.think -= dt;
      if (this.passTarget(p)){
        if (p.ai.react <= 0) p.ai.react = rand(0.10, 0.22);
        p.ai.react -= dt;
        if (p.ai.react <= 0){ out.pass = true; p.ai.react = 0; }
      } else p.ai.react = 0;
    } else if (b.carrier){
      const c = b.carrier, d = dist(p, c);
      if (d < 480){
        // fuir: on vise un point éloigné du porteur mais atteignable
        const a = Math.atan2(p.y-c.y, p.x-c.x);
        let found = null;
        for (let k=0; k<7 && !found; k++){
          for (const s of [0, 1, -1]){
            const na = a + s*k*0.5;
            const tx = clamp(p.x + Math.cos(na)*430, 60, this.level.w-60);
            const ty = clamp(p.y + Math.sin(na)*430, 60, this.level.h-60);
            const [cx,cy] = this.nav.cellAt(tx,ty);
            if (this.nav.free(cx,cy)){ found = {x:tx,y:ty}; break; }
          }
        }
        goal = found || {x:p.x, y:p.y};
        if (d < 240 && p.dashCd<=0) out.dash = true;
      }
    }

    if (!goal){
      p.ai.think -= dt;
      const k = p.items.includes(null)
        ? this.level.boxes.filter(k=>k.alive).sort((a,c)=>dist(p,a)-dist(p,c))[0] : null;
      if (k && dist(p,k) < 700) goal = {x:k.x,y:k.y};
      else {
        if (!p.ai.goal || p.ai.think<=0 || dist(p,p.ai.goal) < 70){
          for (let i=0;i<12;i++){
            const c = {x: rand(80,this.level.w-80), y: rand(80,this.level.h-80)};
            const [cx,cy] = this.nav.cellAt(c.x,c.y);
            if (this.nav.free(cx,cy)){ p.ai.goal = c; break; }
          }
          p.ai.think = rand(3,6);
        }
        goal = p.ai.goal;
      }
    }

    // --- chemin
    p.ai.repath -= dt;
    const stale = !p.ai.path || p.ai.repath <= 0 ||
      (p.ai.pathGoal && dist(p.ai.pathGoal, goal) > 90);
    if (stale){
      p.ai.path = this.nav.path(p.x, p.y, goal.x, goal.y);
      p.ai.pathGoal = {x:goal.x, y:goal.y};
      p.ai.repath = chase ? 0.25 : rand(0.4, 0.7);
    }

    let target = goal;
    const path = p.ai.path;
    if (path && path.length){
      while (path.length > 1 && dist(p, path[0]) < 30) path.shift();
      // string pulling: on vise le point le plus loin encore en ligne libre
      target = path[0];
      for (let i=Math.min(path.length-1, 8); i>=0; i--){
        if (this.nav.clearLine(p.x, p.y, path[i].x, path[i].y)){ target = path[i]; break; }
      }
    }

    let a = Math.atan2(target.y-p.y, target.x-p.x);

    // anti-blocage: si on n'avance plus, on repart en crabe et on recalcule
    const moved = Math.hypot(p.x-p.ai.lastX, p.y-p.ai.lastY);
    p.ai.lastX = p.x; p.ai.lastY = p.y;
    if (p.ai.unstick > 0){
      p.ai.unstick -= dt;
      a = p.ai.unstickA;
    } else if (p.stun<=0 && moved < 0.45*dt*CFG.player.speed){
      p.ai.stuck += dt;
      if (p.ai.stuck > 0.55){
        p.ai.stuck = 0; p.ai.unstick = 0.45;
        p.ai.unstickA = a + (Math.random()<.5?1:-1) * (Math.PI/2 + rand(-.4,.4));
        p.ai.path = null; p.ai.repath = 0;
      }
    } else p.ai.stuck = Math.max(0, p.ai.stuck - dt);

    out.move = {x:Math.cos(a), y:Math.sin(a)};
    out.aim = out.aim || {x: p.x+Math.cos(a)*100, y: p.y+Math.sin(a)*100};

    // ouvrir la porte qui barre la route (les bots aussi font du bruit)
    const d = p.nearDoor;
    out.door = !!(d && d.solid && this.nav.clearLine(p.x,p.y,target.x,target.y) === false
                  ? true : (d && d.solid && dist(p, {x:d.x+d.w/2, y:d.y+d.h/2}) < 90));
    if (out.dash && !this.nav.clearLine(p.x, p.y, p.x+out.move.x*90, p.y+out.move.y*90)) out.dash = false;
    return out;
  }

  // ------------------------------------------------------------ rendu
  get visionRadius(){
    if (!this.me.alive) return 9999;
    return this.me.carrying ? CFG.vision.carrier : CFG.vision.normal;
  }

  draw(){
    const ctx = this.ctx, cam = this.cam;
    const W = CFG.view.w, H = CFG.view.h;
    ctx.save();
    if (this.shake > 0){ const s=this.shake*10; ctx.translate(rand(-s,s), rand(-s,s)); }
    if (this.zoom !== 1){
      ctx.translate(W/2, H/2); ctx.scale(this.zoom, this.zoom); ctx.translate(-W/2, -H/2);
    }
    ctx.translate(-cam.x, -cam.y);

    this.drawGround(ctx);
    this.drawTraps(ctx);
    this.drawBoxes(ctx);
    this.drawRails(ctx);
    this.drawWalls(ctx);
    this.drawDoors(ctx);
    this.drawDynamics(ctx);

    const R = this.visionRadius, fade = CFG.vision.fade;
    for (const p of this.alivePlayers){
      if (p === this.me) continue;
      const d = dist(p, this.me);
      let a = 1 - clamp((d-(R-fade))/fade, 0, 1);
      if (p.inGrass && !this.me.inGrass) a *= d < 200 ? .45 : 0;
      if (this.bomb.carrier === p) a = Math.max(a, d < R+200 ? .85 : 0);   // le porteur est repérable
      if (a <= 0.02) continue;
      ctx.globalAlpha = a; this.drawPlayer(ctx, p); ctx.globalAlpha = 1;
    }
    if (this.me.alive) this.drawPlayer(ctx, this.me);

    this.drawBomb(ctx);
    this.drawGrass(ctx);
    this.drawFx(ctx);
    ctx.restore();

    this.drawVision(ctx);
    if (this.flash > 0){
      ctx.fillStyle = `rgba(255,255,255,${clamp(this.flash,0,1)*0.75})`;
      ctx.fillRect(0,0,CFG.view.w,CFG.view.h);
    }
    this.drawHud(ctx);
  }

  drawGround(ctx){
    const {w,h} = this.level, cell = 160;
    ctx.fillStyle = '#7ad7f0'; ctx.fillRect(0,0,w,h);
    for (let y=0;y<h;y+=cell) for (let x=0;x<w;x+=cell){
      ctx.fillStyle = ((x/cell)+(y/cell))%2===0 ? 'rgba(255,255,255,.16)' : 'rgba(90,200,240,.25)';
      ctx.fillRect(x,y,cell,cell);
    }
    ctx.fillStyle = 'rgba(255,110,199,.12)';
    for (let i=0;i<6;i++) ctx.fillRect(0, 180+i*260, w, 46);
  }

  drawWalls(ctx){
    for (const w of this.level.walls){
      if (w.kind !== 'wall') continue;
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      roundRect(ctx, w.x+6, w.y+10, w.w, w.h, 14); ctx.fill();
      ctx.fillStyle = w.color;
      roundRect(ctx, w.x, w.y, w.w, w.h, 14); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      roundRect(ctx, w.x+6, w.y+6, w.w-12, Math.min(14, w.h-12), 8); ctx.fill();
    }
  }

  drawDoors(ctx){
    for (const d of this.level.doors){
      const shut = d.solid;
      ctx.save();
      if (!shut){
        // battants repliés sur les côtés
        ctx.globalAlpha = .55; ctx.fillStyle = d.color;
        if (d.w > d.h){ roundRect(ctx,d.x,d.y,16,d.h,6); ctx.fill(); roundRect(ctx,d.x+d.w-16,d.y,16,d.h,6); ctx.fill(); }
        else { roundRect(ctx,d.x,d.y,d.w,16,6); ctx.fill(); roundRect(ctx,d.x,d.y+d.h-16,d.w,16,6); ctx.fill(); }
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,216,77,.18)';
        ctx.fillRect(d.x, d.y, d.w, d.h);
      } else {
        ctx.fillStyle='rgba(0,0,0,.2)'; roundRect(ctx,d.x+5,d.y+8,d.w,d.h,10); ctx.fill();
        ctx.fillStyle = d.color; roundRect(ctx,d.x,d.y,d.w,d.h,10); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        const horiz = d.w > d.h;
        for (let i=0;i<4;i++){
          if (horiz) ctx.fillRect(d.x+14+i*((d.w-28)/4), d.y+8, 10, d.h-16);
          else ctx.fillRect(d.x+10, d.y+16+i*((d.h-32)/3), d.w-20, 6);
        }
        // poignée
        ctx.fillStyle='#7a4a12';
        ctx.beginPath(); ctx.arc(d.x+d.w/2, d.y+d.h/2, 7, 0, TAU); ctx.fill();
      }
      ctx.restore();
      if (shut && d.open>0){
        ctx.fillStyle='rgba(0,0,0,.5)'; roundRect(ctx,d.x-16,d.y-24,d.w+32,12,6); ctx.fill();
        ctx.fillStyle='#b6ff5c'; roundRect(ctx,d.x-14,d.y-22,(d.w+28)*d.open,8,4); ctx.fill();
      }
    }
  }

  drawRails(ctx){
    for (const o of this.level.dyn){
      if (o.kind !== 'slider') continue;
      ctx.save();
      ctx.strokeStyle='rgba(40,25,80,.35)'; ctx.lineWidth=8; ctx.setLineDash([14,12]);
      ctx.beginPath();
      ctx.moveTo(o.ax+o.w/2, o.ay+o.h/2); ctx.lineTo(o.bx+o.w/2, o.by+o.h/2); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    }
  }

  drawDynamics(ctx){
    for (const o of this.level.dyn){
      if (o.kind === 'gate'){
        const horiz = o.w > o.h;
        ctx.save();
        // rails + gyrophare
        ctx.fillStyle = '#4b3a7a';
        if (horiz){ ctx.fillRect(o.x-8, o.y+o.h/2-4, 8, 8); ctx.fillRect(o.x+o.w, o.y+o.h/2-4, 8, 8); }
        else { ctx.fillRect(o.x+o.w/2-4, o.y-8, 8, 8); ctx.fillRect(o.x+o.w/2-4, o.y+o.h, 8, 8); }
        if (o.solid || o.warn){
          ctx.globalAlpha = o.solid ? 1 : (Math.sin(this.time*16)>0 ? .5 : .22);
          const len = (horiz ? o.w : o.h) * (o.solid ? o.amt || 1 : 1);
          const bx = horiz ? o.x : o.x, by = o.y;
          ctx.fillStyle = '#1c1338';
          if (horiz) roundRect(ctx, bx, by+o.h/2-13, len, 26, 8); else roundRect(ctx, o.x+o.w/2-13, by, 26, len, 8);
          ctx.fill();
          // rayures de chantier
          ctx.save(); ctx.clip();
          for (let i=-2; i<40; i++){
            ctx.fillStyle = i%2 ? '#ffd84d' : '#1c1338';
            ctx.save();
            ctx.translate(o.x + i*26, o.y);
            ctx.transform(1,0,-0.6,1,0,0);
            ctx.fillRect(0, -10, 16, o.h+20);
            ctx.restore();
          }
          ctx.restore();
          ctx.globalAlpha = 1;
        }
        if (o.warn){
          ctx.fillStyle = Math.sin(this.time*22)>0 ? '#ff5c5c' : 'rgba(255,92,92,.25)';
          ctx.beginPath(); ctx.arc(o.x+o.w/2, o.y+o.h/2, 11, 0, TAU); ctx.fill();
        }
        ctx.restore();
      } else if (o.kind === 'slider'){
        ctx.fillStyle='rgba(0,0,0,.2)'; roundRect(ctx,o.x+5,o.y+9,o.w,o.h,12); ctx.fill();
        ctx.fillStyle='#5c6bd6'; roundRect(ctx,o.x,o.y,o.w,o.h,12); ctx.fill();
        ctx.fillStyle='rgba(255,255,255,.3)'; roundRect(ctx,o.x+6,o.y+6,o.w-12,Math.min(12,o.h-12),6); ctx.fill();
        // chevrons dans le sens de marche
        const horiz = Math.abs(o.bx-o.ax) > Math.abs(o.by-o.ay);
        ctx.strokeStyle='rgba(255,255,255,.7)'; ctx.lineWidth=4; ctx.lineCap='round';
        for (let i=0;i<3;i++){
          const t = (this.time*2 + i*0.4) % 1;
          ctx.globalAlpha = 0.25 + 0.5*Math.sin(t*Math.PI);
          ctx.beginPath();
          if (horiz){
            const px = o.x + (o.dir>0 ? o.w*0.3 + t*o.w*0.4 : o.w*0.7 - t*o.w*0.4);
            ctx.moveTo(px - 8*o.dir, o.y+o.h/2-8); ctx.lineTo(px+4*o.dir, o.y+o.h/2); ctx.lineTo(px-8*o.dir, o.y+o.h/2+8);
          } else {
            const py = o.y + (o.dir>0 ? o.h*0.3 + t*o.h*0.4 : o.h*0.7 - t*o.h*0.4);
            ctx.moveTo(o.x+o.w/2-8, py-8*o.dir); ctx.lineTo(o.x+o.w/2, py+4*o.dir); ctx.lineTo(o.x+o.w/2+8, py-8*o.dir);
          }
          ctx.stroke();
        }
        ctx.globalAlpha=1;
      } else if (o.kind === 'turnstile'){
        ctx.save();
        // socle
        ctx.fillStyle='rgba(40,25,80,.25)';
        ctx.beginPath(); ctx.arc(o.x,o.y,o.r+10,0,TAU); ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,.25)'; ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(o.x,o.y,o.r+10,0,TAU); ctx.stroke();
        // bras
        for (let i=0;i<CFG.turnstile.arms;i++){
          const a = o.a + i*TAU/CFG.turnstile.arms;
          const ex = o.x+Math.cos(a)*o.r, ey = o.y+Math.sin(a)*o.r;
          ctx.strokeStyle='rgba(0,0,0,.22)'; ctx.lineWidth=CFG.turnstile.thick*2+4; ctx.lineCap='round';
          ctx.beginPath(); ctx.moveTo(o.x+4,o.y+8); ctx.lineTo(ex+4,ey+8); ctx.stroke();
          ctx.strokeStyle='#ff6ec7'; ctx.lineWidth=CFG.turnstile.thick*2;
          ctx.beginPath(); ctx.moveTo(o.x,o.y); ctx.lineTo(ex,ey); ctx.stroke();
          ctx.fillStyle='#fff';
          ctx.beginPath(); ctx.arc(ex,ey,CFG.turnstile.thick*0.7,0,TAU); ctx.fill();
        }
        ctx.fillStyle='#c08bff';
        ctx.beginPath(); ctx.arc(o.x,o.y,20,0,TAU); ctx.fill();
        ctx.fillStyle='rgba(255,255,255,.45)';
        ctx.beginPath(); ctx.arc(o.x-5,o.y-5,9,0,TAU); ctx.fill();
        ctx.restore();
      }
    }
  }

  // touffes pré-rendues une fois: le sway se fait au drawImage
  bakeGrass(g){
    const pad = 20;
    const cv = document.createElement('canvas');
    cv.width = g.w + pad*2; cv.height = g.h + pad*2;
    const c = cv.getContext('2d');
    c.translate(pad, pad);
    let s = g.seed;
    const rnd = ()=>{ s = (s*9301 + 49297) % 233280; return s/233280; };
    const n = Math.round(g.w*g.h/300);
    for (let i=0;i<n;i++){
      const x = rnd()*g.w, y = rnd()*g.h, h = 20 + rnd()*18, lean = (rnd()-.5)*12;
      c.fillStyle = ['#3fb75f','#54d477','#2f9a4c','#68e08a'][(rnd()*4)|0];
      c.beginPath();
      c.moveTo(x-4, y);
      c.quadraticCurveTo(x-1+lean*0.4, y-h*0.6, x+lean, y-h);
      c.quadraticCurveTo(x+3+lean*0.4, y-h*0.5, x+4, y);
      c.closePath(); c.fill();
    }
    g.baked = cv; g.pad = pad;
    return cv;
  }

  drawGrass(ctx){
    for (const g of this.level.grass){
      if (!g.baked) this.bakeGrass(g);
      const inside = this.me.alive && this.me.x>g.x && this.me.x<g.x+g.w && this.me.y>g.y && this.me.y<g.y+g.h;
      ctx.save();
      ctx.globalAlpha = inside ? .42 : .95;
      const sway = Math.sin(this.time*1.6 + g.seed)*3;
      ctx.drawImage(g.baked, g.x - g.pad + sway, g.y - g.pad);
      ctx.restore();
    }
  }

  drawTraps(ctx){
    for (const t of this.level.traps){
      ctx.save();
      if (t.type === 'glue'){
        // flaque organique + bulles
        ctx.fillStyle = t.flash>0 ? 'rgba(178,140,255,.9)' : 'rgba(140,100,240,.62)';
        ctx.beginPath();
        for (let i=0;i<=14;i++){
          const a = i/14*TAU;
          const rr = t.r * (0.82 + 0.18*Math.sin(a*3 + t.x*0.01));
          const px = t.x+Math.cos(a)*rr, py = t.y+Math.sin(a)*rr*0.8;
          i ? ctx.lineTo(px,py) : ctx.moveTo(px,py);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle='rgba(255,255,255,.35)';
        for (let i=0;i<4;i++){
          const a = this.time*0.8 + i*1.7;
          const rr = t.r*0.45;
          const b = (Math.sin(this.time*2+i)*0.5+0.5);
          ctx.beginPath();
          ctx.arc(t.x+Math.cos(a)*rr, t.y+Math.sin(a)*rr*0.7, 3+b*4, 0, TAU); ctx.fill();
        }
      } else if (t.type === 'stun'){
        // mâchoires: ouvertes = armé, refermées = déclenché
        const open = t.armed ? 1 : 0.12;
        ctx.fillStyle='rgba(0,0,0,.2)';
        ctx.beginPath(); ctx.ellipse(t.x, t.y+8, t.r, t.r*0.5, 0,0,TAU); ctx.fill();
        ctx.fillStyle='#6b7a99';
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r*0.62,0,TAU); ctx.fill();
        ctx.fillStyle='#40507a';
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r*0.4,0,TAU); ctx.fill();
        for (const side of [-1,1]){
          ctx.save();
          ctx.translate(t.x, t.y);
          const spread = side*open*0.42;          // écartement des mâchoires
          ctx.translate(0, side*open*t.r*0.34);
          ctx.rotate(spread);
          ctx.fillStyle = t.flash>0 ? '#ffb0b0' : '#cdd8e8';
          ctx.beginPath();
          ctx.moveTo(-t.r*0.92, 0);
          ctx.quadraticCurveTo(0, side*t.r*0.5, t.r*0.92, 0);
          const teeth = 6;
          for (let i=teeth; i>=0; i--){
            const px = -t.r*0.92 + i*(t.r*1.84/teeth);
            ctx.lineTo(px + t.r*0.14, side*t.r*0.34);
            ctx.lineTo(px, 0);
          }
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle='#8d9bb3'; ctx.lineWidth=2; ctx.stroke();
          ctx.restore();
        }
        ctx.strokeStyle='rgba(255,255,255,.45)'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r*0.62,0,TAU); ctx.stroke();
      } else {
        // plaque sonore: dalle + ondes
        const pulse = t.armed ? 0 : clamp(t.flash/0.6,0,1);
        ctx.fillStyle='rgba(0,0,0,.18)';
        roundRect(ctx,t.x-t.r+4,t.y-t.r+7,t.r*2,t.r*2,10); ctx.fill();
        ctx.fillStyle = t.armed ? '#ffd84d' : '#8a7a3a';
        roundRect(ctx,t.x-t.r,t.y-t.r,t.r*2,t.r*2,10); ctx.fill();
        ctx.fillStyle='#2b1d54';
        roundRect(ctx,t.x-t.r*0.45,t.y-t.r*0.5,t.r*0.42,t.r,4); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(t.x-t.r*0.05,t.y-t.r*0.7); ctx.lineTo(t.x+t.r*0.35,t.y-t.r*0.95);
        ctx.lineTo(t.x+t.r*0.35,t.y+t.r*0.95); ctx.lineTo(t.x-t.r*0.05,t.y+t.r*0.7);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle='#2b1d54'; ctx.lineWidth=3;
        for (let i=1;i<=2;i++){
          ctx.globalAlpha = t.armed ? .5 : 1-pulse;
          ctx.beginPath();
          ctx.arc(t.x+t.r*0.45, t.y, i*9 + pulse*16, -0.9, 0.9); ctx.stroke();
        }
        ctx.globalAlpha=1;
      }
      ctx.restore();
    }
  }

  drawBoxes(ctx){
    for (const k of this.level.boxes){
      if (!k.alive) continue;
      const R = CFG.box.r;
      const bob = Math.sin(k.t*2.2)*6;
      const spin = Math.cos(k.t*2.2);              // le cube tourne sur lui-même
      const hue = (this.time*60 + k.x*0.3) % 360;
      const pop = k.pop > 0 ? 1 + k.pop*1.2 : 1;
      ctx.save();
      ctx.translate(k.x, k.y + bob);
      ctx.fillStyle='rgba(0,0,0,.22)';
      ctx.beginPath(); ctx.ellipse(0, R+10-bob, R*0.75, R*0.3, 0,0,TAU); ctx.fill();
      ctx.scale(Math.max(0.12, Math.abs(spin))*pop, pop);
      ctx.rotate(Math.sin(k.t*1.4)*0.08);
      ctx.fillStyle = `hsl(${hue} 90% 62%)`;
      roundRect(ctx, -R, -R, R*2, R*2, 9); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      roundRect(ctx, -R+5, -R+5, R*2-10, R*0.55, 6); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 3;
      roundRect(ctx, -R, -R, R*2, R*2, 9); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 30px Verdana'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('?', 0, 2);
      ctx.restore();
    }
  }

  // icônes dessinées (pas d'emoji: rendu identique partout)
  drawItemIcon(ctx, type, x, y, size, color){
    const u = size/20;
    ctx.save(); ctx.translate(x,y); ctx.scale(u,u);
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = 2.6; ctx.lineCap='round'; ctx.lineJoin='round';
    if (type === 'speed'){
      for (let i=-1;i<=1;i++){
        ctx.beginPath(); ctx.moveTo(-8+i*6,-7); ctx.lineTo(-2+i*6,0); ctx.lineTo(-8+i*6,7); ctx.stroke();
      }
    } else if (type === 'ghost'){
      ctx.beginPath();
      ctx.arc(0,-2,8,Math.PI,0);
      ctx.lineTo(8,7); ctx.lineTo(4,3); ctx.lineTo(0,7); ctx.lineTo(-4,3); ctx.lineTo(-8,7);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle='#2b1d54';
      ctx.beginPath(); ctx.arc(-3,-3,1.8,0,TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(3,-3,1.8,0,TAU); ctx.fill();
    } else if (type === 'radar'){
      ctx.beginPath(); ctx.arc(0,0,3,0,TAU); ctx.fill();
      for (let i=1;i<=2;i++){ ctx.beginPath(); ctx.arc(0,0,3+i*4,-0.8,0.8); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(9,-6); ctx.stroke();
    } else if (type === 'shortfuse'){
      ctx.beginPath(); ctx.moveTo(-8,-7); ctx.lineTo(5,4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8,7); ctx.lineTo(5,-4); ctx.stroke();
      ctx.beginPath(); ctx.arc(7,6,3,0,TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(7,-6,3,0,TAU); ctx.stroke();
    } else if (type === 'glue'){
      ctx.beginPath();
      ctx.moveTo(0,-9); ctx.quadraticCurveTo(7,0,7,3); ctx.arc(0,3,7,0,Math.PI);
      ctx.quadraticCurveTo(-7,0,0,-9); ctx.fill();
    } else if (type === 'bear'){
      ctx.beginPath(); ctx.arc(0,0,5,0,TAU); ctx.stroke();
      for (const sgn of [-1,1]){
        ctx.beginPath();
        for (let i=0;i<5;i++){
          ctx.moveTo(-9+i*4.5, sgn*4);
          ctx.lineTo(-7+i*4.5, sgn*9);
          ctx.lineTo(-5+i*4.5, sgn*4);
        }
        ctx.stroke();
      }
    } else if (type === 'siren'){
      ctx.beginPath(); ctx.moveTo(-8,-4); ctx.lineTo(-3,-4); ctx.lineTo(2,-9);
      ctx.lineTo(2,9); ctx.lineTo(-3,4); ctx.lineTo(-8,4); ctx.closePath(); ctx.fill();
      for (let i=1;i<=2;i++){ ctx.beginPath(); ctx.arc(3,0,2+i*3.5,-0.9,0.9); ctx.stroke(); }
    }
    ctx.restore();
  }

  drawPlayer(ctx, p){
    const sq = 1 + p.squash*0.3, st = 1 - p.squash*0.22;
    const bob = Math.sin(p.walkT*6)*2;
    ctx.save();
    if (p.ghost > 0){
      ctx.globalAlpha *= 0.45 + Math.sin(this.time*10)*0.08;
    }
    ctx.translate(p.x, p.y);
    ctx.fillStyle='rgba(0,0,0,.22)';
    ctx.beginPath(); ctx.ellipse(0, p.r*0.95, p.r*0.95, p.r*0.42, 0,0,TAU); ctx.fill();
    ctx.scale(st, sq); ctx.translate(0, bob);
    const w = p.r*1.9, h = p.r*2.2;
    ctx.fillStyle = p.color;
    roundRect(ctx, -w/2, -h/2, w, h, w/2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.35)';
    roundRect(ctx, -w/2+5, -h/2+8, w-10, h*0.45, w/3); ctx.fill();
    const ex = Math.cos(p.face)*4, ey = Math.sin(p.face)*3;
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(-7+ex, -6+ey, 6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc( 7+ex, -6+ey, 6, 0, TAU); ctx.fill();
    ctx.fillStyle='#20123f';
    ctx.beginPath(); ctx.arc(-7+ex*1.6, -6+ey*1.6, 2.8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc( 7+ex*1.6, -6+ey*1.6, 2.8, 0, TAU); ctx.fill();
    ctx.restore();

    if (p.stun>0){
      ctx.fillStyle='#ffd84d'; ctx.font='bold 18px Verdana'; ctx.textAlign='center';
      ctx.fillText('★', p.x + Math.cos(this.time*8)*14, p.y - p.r - 16);
    }
    if (p.slow>0){ ctx.strokeStyle='rgba(160,120,255,.9)'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r+6,0,TAU); ctx.stroke(); }
    if (p.speedBoost>0){ ctx.strokeStyle='rgba(92,241,255,.9)'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r+10,0,TAU); ctx.stroke(); }
    if (p.ghost>0){
      ctx.strokeStyle='rgba(230,224,255,.8)'; ctx.lineWidth=2; ctx.setLineDash([5,5]);
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r+7,0,TAU); ctx.stroke(); ctx.setLineDash([]);
    }

    ctx.font='bold 12px Verdana'; ctx.textAlign='center';
    ctx.fillStyle = p===this.me ? '#fff' : 'rgba(255,255,255,.8)';
    ctx.strokeStyle='rgba(0,0,0,.55)'; ctx.lineWidth=3;
    const label = p.name + (p.shortFuse?' ✂':'');
    ctx.strokeText(label, p.x, p.y - p.r - 26); ctx.fillText(label, p.x, p.y - p.r - 26);

    if (p===this.me && p.nearDoor && p.nearDoor.solid){
      ctx.font='bold 13px Verdana'; ctx.fillStyle='#ffd84d'; ctx.textAlign='center';
      ctx.fillText('[E] ouvrir (bruyant)', p.x, p.y - p.r - 44);
    }
  }

  drawBomb(ctx){
    const b = this.bomb;
    if (!b.armed || !b.carrier) return;
    const t = this.time;
    const danger = b.fuse / Math.max(1,b.maxFuse);
    const frozen = b.freeze > 0;
    const pulse = frozen ? 1 : 1 + Math.sin(t*(12 - danger*8))*0.12;

    // cible de passe: à qui ça part si on appuie
    const target = this.passTarget(b.carrier);
    if (target && (b.carrier === this.me || dist(this.me, b.carrier) < this.visionRadius)){
      ctx.save();
      ctx.strokeStyle = '#b6ff5c'; ctx.lineWidth = 4; ctx.globalAlpha = .85;
      ctx.setLineDash([10,8]); ctx.lineDashOffset = -t*30;
      ctx.beginPath(); ctx.moveTo(b.carrier.x, b.carrier.y); ctx.lineTo(target.x, target.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(target.x, target.y, target.r + 12 + Math.sin(t*9)*3, 0, TAU); ctx.stroke();
      ctx.restore();
    } else if (b.carrier === this.me){
      // portée de passe: on montre le rayon quand personne n'est attrapable
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 3; ctx.setLineDash([6,10]);
      ctx.beginPath(); ctx.arc(b.carrier.x, b.carrier.y, this.opts.passRadius, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(b.x,b.y); ctx.scale(pulse,pulse);
    ctx.fillStyle='rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0,b.r+6,b.r,b.r*.4,0,0,TAU); ctx.fill();
    ctx.fillStyle='#2b2340'; ctx.beginPath(); ctx.arc(0,0,b.r,0,TAU); ctx.fill();
    ctx.fillStyle = frozen ? '#4a4570' : (danger<0.3 ? '#ff4d4d' : '#5a4f7a');
    ctx.beginPath(); ctx.arc(-5,-5,b.r*.45,0,TAU); ctx.fill();
    ctx.strokeStyle='#c9a86a'; ctx.lineWidth=4;
    ctx.beginPath(); ctx.moveTo(0,-b.r); ctx.quadraticCurveTo(10,-b.r-12, 4,-b.r-20); ctx.stroke();
    if (frozen){
      // mèche pas encore allumée
      ctx.fillStyle='rgba(255,255,255,.5)';
      ctx.beginPath(); ctx.arc(4,-b.r-22, 4, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = Math.sin(t*30)>0 ? '#ffd84d' : '#ff8b4d';
      ctx.beginPath(); ctx.arc(4,-b.r-22, 5+Math.random()*2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawFx(ctx){
    for (const f of this.fx){
      const k = f.t/f.life;
      ctx.save();
      if (f.type==='ring'){
        ctx.globalAlpha = 1-k; ctx.strokeStyle=f.color; ctx.lineWidth=6;
        ctx.beginPath(); ctx.arc(f.x,f.y, lerp(f.r,f.max,k), 0, TAU); ctx.stroke();
      } else if (f.type==='boom'){
        ctx.globalAlpha = 1-k;
        const r = lerp(f.r,f.max,Math.sqrt(k));
        const g = ctx.createRadialGradient(f.x,f.y,0,f.x,f.y,r);
        g.addColorStop(0,'#fff'); g.addColorStop(.4,'#ffd84d'); g.addColorStop(.75,'#ff6b3d'); g.addColorStop(1,'rgba(255,80,60,0)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(f.x,f.y,r,0,TAU); ctx.fill();
      } else if (f.type==='pass'){
        const x = lerp(f.ax,f.bx,k), y = lerp(f.ay,f.by,k) - Math.sin(k*Math.PI)*34;
        ctx.globalAlpha = 1;
        ctx.fillStyle='#2b2340'; ctx.beginPath(); ctx.arc(x,y,15,0,TAU); ctx.fill();
        ctx.fillStyle='#ffd84d'; ctx.beginPath(); ctx.arc(x+4,y-18,5,0,TAU); ctx.fill();
      } else if (f.type==='part'){
        ctx.globalAlpha = 1-k; ctx.fillStyle=f.color;
        ctx.translate(f.x, f.y); ctx.rotate(f.rot||0);
        roundRect(ctx,-6,-4,12,8,3); ctx.fill();
      } else if (f.type==='trail'){
        ctx.globalAlpha = (1-k)*0.45; ctx.fillStyle=f.color;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r*(1-k*0.5), 0, TAU); ctx.fill();
      } else if (f.type==='text'){
        const pop = k < 0.18 ? lerp(1.6, 1, k/0.18) : 1;
        ctx.globalAlpha = 1 - Math.pow(k, 3);
        ctx.translate(f.x, f.y - k*42); ctx.scale(pop, pop);
        ctx.font='bold 17px Verdana'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.lineWidth=5; ctx.strokeStyle='rgba(20,12,45,.85)';
        ctx.strokeText(f.txt, 0, 0);
        ctx.fillStyle=f.color; ctx.fillText(f.txt, 0, 0);
      }
      ctx.restore();
    }
  }

  // champ de vision: large quand on porte la bombe, resserré quand on se cache
  drawVision(ctx){
    if (!this.me.alive) return;
    const W = CFG.view.w, H = CFG.view.h;
    const sx = this.me.x - this.cam.x, sy = this.me.y - this.cam.y;
    const R = this.visionRadius;
    const g = ctx.createRadialGradient(sx, sy, R*0.62, sx, sy, R*1.04);
    g.addColorStop(0, 'rgba(20,12,45,0)');
    g.addColorStop(0.65, 'rgba(20,12,45,.16)');
    g.addColorStop(1, 'rgba(20,12,45,.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);
  }

  // ------------------------------------------------------------ HUD
  drawHud(ctx){
    const W = CFG.view.w, H = CFG.view.h, b = this.bomb;

    const pct = clamp(b.fuse / Math.max(1,b.maxFuse), 0, 1);
    const hot = b.fuse < 5 && b.freeze <= 0;
    const beat = hot ? 1 + Math.abs(Math.sin(this.time*6))*0.06 : 1;
    let bw = 420, bx = W/2-bw/2, by = 22;
    ctx.save();
    ctx.translate(W/2, by+11); ctx.scale(beat, beat); ctx.translate(-W/2, -(by+11));
    ctx.fillStyle='rgba(20,12,45,.65)'; roundRect(ctx,bx-6,by-6,bw+12,34,17); ctx.fill();
    ctx.fillStyle = pct>.5 ? '#b6ff5c' : pct>.25 ? '#ffd84d' : '#ff5c5c';
    roundRect(ctx,bx,by,bw*pct,22,11); ctx.fill();
    ctx.font='bold 14px Verdana'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='#fff';
    const who = b.carrier ? (b.carrier===this.me?'TOI':b.carrier.name) : '—';
    const mode = this.opts.fuse==='carrier' ? 'MÈCHE PORTEUR' : 'MÈCHE GLOBALE';
    const label = b.freeze>0 ? `MÈCHE EN ATTENTE · ${who} encaisse` 
                             : `${mode} · ${b.fuse>0?b.fuse.toFixed(1):'0.0'}s · ${who}`;
    ctx.fillText(label, W/2, by+11);
    ctx.restore();

    ctx.textAlign='left';
    ctx.fillStyle='rgba(20,12,45,.65)'; roundRect(ctx,18,18,170,30,15); ctx.fill();
    ctx.fillStyle='#fff'; ctx.font='bold 15px Verdana';
    ctx.fillText(`SURVIVANTS : ${this.alivePlayers.length}/${this.players.length}`, 32, 34);

    // action principale: dash, ou lancer quand on porte la bombe
    const carrying = this.me.carrying;
    ctx.fillStyle='rgba(20,12,45,.65)'; roundRect(ctx,18,H-56,170,38,19); ctx.fill();
    if (carrying){
      const tgt = this.passTarget(this.me);
      ctx.fillStyle = tgt ? '#b6ff5c' : 'rgba(255,92,92,.35)';
      roundRect(ctx,24,H-50,158,26,13); ctx.fill();
      ctx.fillStyle = tgt ? '#20123f' : '#fff'; ctx.font='bold 12px Verdana'; ctx.textAlign='center';
      ctx.fillText(tgt ? 'ESPACE : PASSER à '+tgt.name : 'APPROCHE QUELQU\'UN', 103, H-37);
    } else {
      const dcd = this.me.dashCd/CFG.dash.cooldown;
      ctx.fillStyle = dcd<=0 ? '#5cf1ff' : 'rgba(92,241,255,.3)';
      roundRect(ctx,24,H-50,158*(1-dcd),26,13); ctx.fill();
      ctx.fillStyle='#20123f'; ctx.font='bold 12px Verdana'; ctx.textAlign='center';
      ctx.fillText('DASH [ESPACE]', 103, H-37);
    }

    let cx = 200;
    const chips = [];
    if (carrying) chips.push(['PORTEUR : +VITESSE, PAS DE DASH','#ff8b4d']);
    if (this.me.stun>0 && carrying) chips.push(['RÉCEPTION… '+this.me.stun.toFixed(1)+'s','#ff5c5c']);
    if (this.me.speedBoost>0) chips.push(['VITESSE '+this.me.speedBoost.toFixed(0)+'s','#5cf1ff']);
    if (this.me.radar>0) chips.push(['RADAR '+this.me.radar.toFixed(0)+'s','#b6ff5c']);
    if (this.me.shortFuse>0) chips.push(['MÈCHE COURTE x'+this.me.shortFuse,'#ff8b4d']);
    if (this.me.ghost>0) chips.push(['FANTÔME '+this.me.ghost.toFixed(1)+'s','#e6e0ff']);
    if (this.me.revealed>0) chips.push(['REPÉRÉ !','#ffd84d']);
    if (this.me.inGrass) chips.push(['CACHÉ','#4dffb0']);
    ctx.textAlign='center'; ctx.font='bold 12px Verdana';
    for (const c of chips){
      const w = ctx.measureText(c[0]).width + 26;
      ctx.fillStyle='rgba(20,12,45,.7)'; roundRect(ctx,cx,H-52,w,30,15); ctx.fill();
      ctx.fillStyle=c[1]; ctx.fillText(c[0], cx+w/2, H-37);
      cx += w+8;
    }

    this.drawInventory(ctx);
    this.drawMinimap(ctx);

    // le danger déborde sur les bords de l'écran
    if (this.me.alive && this.me.carrying && b.fuse < 5 && b.freeze <= 0){
      const a = (0.12 + Math.abs(Math.sin(this.time*6))*0.22) * (1 - b.fuse/5);
      const g = ctx.createRadialGradient(W/2,H/2, H*0.28, W/2,H/2, H*0.85);
      g.addColorStop(0,'rgba(255,60,60,0)');
      g.addColorStop(1,`rgba(255,40,40,${a})`);
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    }

    if (this.toast){
      const a = clamp(this.toast.t/0.4,0,1);
      const age = this.toast.max - this.toast.t;
      const pop = age < 0.16 ? lerp(1.45, 1, age/0.16) : 1;
      ctx.save(); ctx.globalAlpha = a;
      ctx.translate(W/2, 120); ctx.scale(pop, pop); ctx.translate(-W/2, -120);
      ctx.font='bold 34px Verdana'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.lineWidth=8; ctx.strokeStyle='rgba(20,12,45,.8)';
      ctx.strokeText(this.toast.txt, W/2, 120);
      ctx.fillStyle='#ffd84d'; ctx.fillText(this.toast.txt, W/2, 120);
      ctx.restore();
    }

    if (!this.me.alive && !this.over){
      ctx.fillStyle='rgba(20,12,45,.45)'; ctx.fillRect(0,0,W,H);
      ctx.fillStyle='#fff'; ctx.font='bold 26px Verdana'; ctx.textAlign='center';
      ctx.fillText('ÉLIMINÉ — mode spectateur', W/2, H/2);
    }
  }

  // deux emplacements, façon cubes mystères: touche sous chaque case
  drawInventory(ctx){
    const W = CFG.view.w, H = CFG.view.h;
    const S = 58, gap = 12;
    const x0 = W/2 - S - gap/2, y0 = H - S - 26;
    for (let i=0;i<2;i++){
      const x = x0 + i*(S+gap), it = this.me.items[i];
      ctx.save();
      ctx.fillStyle = 'rgba(20,12,45,.7)';
      roundRect(ctx, x, y0, S, S, 14); ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = it ? ITEMS[it].color : 'rgba(255,255,255,.18)';
      roundRect(ctx, x, y0, S, S, 14); ctx.stroke();
      if (it){
        const pulse = 1 + Math.sin(this.time*4 + i)*0.04;
        ctx.save();
        ctx.translate(x+S/2, y0+S/2); ctx.scale(pulse,pulse); ctx.translate(-(x+S/2), -(y0+S/2));
        this.drawItemIcon(ctx, it, x+S/2, y0+S/2-4, 26, ITEMS[it].color);
        ctx.restore();
        ctx.fillStyle = ITEMS[it].color; ctx.font='bold 8px Verdana';
        ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(ITEMS[it].name, x+S/2, y0+S-11);
      }
      // touche
      ctx.fillStyle = it ? ITEMS[it].color : 'rgba(255,255,255,.28)';
      roundRect(ctx, x+S/2-13, y0-15, 26, 19, 6); ctx.fill();
      ctx.fillStyle = '#20123f'; ctx.font='bold 12px Verdana';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(Input.labels[i] || (i+1), x+S/2, y0-5);
      ctx.restore();
    }
  }

  drawMinimap(ctx){
    const W = CFG.view.w, size = 210, pad = 18;
    const mx = W - size - pad, my = pad;
    const mh0 = size*this.level.h/this.level.w;
    // la minimap est un privilège: celui qui porte la bombe voit tout le monde fuir
    const allowed = !this.me.alive || this.me.carrying || this.me.radar > 0;
    if (!allowed){
      ctx.save();
      ctx.fillStyle='rgba(20,12,45,.5)'; roundRect(ctx,mx-6,my-6,size+12,mh0+12,14); ctx.fill();
      ctx.setLineDash([8,8]); ctx.strokeStyle='rgba(255,255,255,.22)'; ctx.lineWidth=2;
      roundRect(ctx,mx,my,size,mh0,10); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle='rgba(255,255,255,.45)'; ctx.font='bold 12px Verdana';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText('MINIMAP', mx+size/2, my+mh0/2-12);
      ctx.fillText('réservée au porteur', mx+size/2, my+mh0/2+6);
      ctx.fillText('(ou objet RADAR)', mx+size/2, my+mh0/2+24);
      ctx.restore();
      return;
    }
    const sx = size/this.level.w, sy = sx;
    const mh = size*this.level.h/this.level.w;

    ctx.save();
    ctx.fillStyle='rgba(20,12,45,.72)'; roundRect(ctx,mx-6,my-6,size+12,mh+12,14); ctx.fill();
    roundRect(ctx,mx,my,size,mh,10); ctx.clip();
    ctx.fillStyle='rgba(122,215,240,.35)'; ctx.fillRect(mx,my,size,mh);
    for (const g of this.level.grass){
      ctx.fillStyle='rgba(63,183,95,.55)';
      ctx.fillRect(mx+g.x*sx, my+g.y*sy, g.w*sx, g.h*sy);
    }
    for (const w of this.level.walls){
      if (w.kind === 'wall'){ ctx.fillStyle='rgba(60,40,110,.75)'; }
      else if (w.kind === 'door'){ ctx.fillStyle = w.solid ? 'rgba(255,184,77,.95)' : 'rgba(255,184,77,.25)'; }
      else if (w.kind === 'gate'){ ctx.fillStyle = w.solid ? 'rgba(255,216,77,.95)' : 'rgba(255,216,77,.2)'; }
      else if (w.kind === 'slider'){ ctx.fillStyle='rgba(92,107,214,.95)'; }
      else continue;
      ctx.fillRect(mx+w.x*sx, my+w.y*sy, Math.max(2,w.w*sx), Math.max(2,w.h*sy));
    }
    for (const o of this.level.dyn){
      if (o.kind !== 'turnstile') continue;
      ctx.strokeStyle='rgba(255,110,199,.9)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(mx+o.x*sx, my+o.y*sy, o.r*sx, 0, TAU); ctx.stroke();
    }

    const radar = this.me.radar>0;
    for (const p of this.alivePlayers){
      const isMe = p===this.me;
      const isCarrier = this.bomb.carrier===p;
      const near = dist(p,this.me) < this.visionRadius;
      const show = isMe || isCarrier || radar || p.revealed>0 || (near && !p.inGrass);
      if (!show) continue;
      const px = mx+p.x*sx, py = my+p.y*sy;
      ctx.fillStyle = isCarrier ? '#ff4d4d' : p.color;
      ctx.beginPath(); ctx.arc(px, py, isMe?5:4, 0, TAU); ctx.fill();
      if (isMe){ ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke(); }
      if (p.revealed>0){
        ctx.strokeStyle='rgba(255,216,77,.9)'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(px,py, 6+Math.sin(this.time*8)*3, 0, TAU); ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- boot
(function(){
  const canvas = document.getElementById('game');
  Input.init(canvas);

  const menu = document.getElementById('menu');
  const result = document.getElementById('result');
  const botsRange = document.getElementById('optBots');
  const botsVal = document.getElementById('optBotsV');
  botsRange.oninput = ()=>{ botsVal.textContent = botsRange.value; };

  let game = null, last = 0, raf = 0;

  function loop(ts){
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.033, (ts-last)/1000 || 0); last = ts;
    if (!game) return;
    game.update(dt);
    game.draw();
  }

  function start(){
    const opts = {
      bots: parseInt(botsRange.value,10),
      fuse: document.getElementById('optFuse').value,
      passRadius: parseInt(document.getElementById('optPass').value,10)
    };
    game = new Game(canvas, opts);
    window.__game = game;   // debug console
    game.onEnd = (winner)=>{
      setTimeout(()=>{
        document.getElementById('resultTitle').textContent =
          winner && winner.isHuman ? 'VICTOIRE ROYALE 👑' : 'PERDU 💥';
        document.getElementById('resultSub').textContent =
          winner ? `Dernier survivant : ${winner.name}` : 'Tout le monde a explosé.';
        result.classList.remove('hidden');
      }, 1200);
    };
    menu.classList.add('hidden');
    result.classList.add('hidden');
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(loop);
  }

  document.getElementById('btnPlay').onclick = start;
  document.getElementById('btnAgain').onclick = start;
})();
