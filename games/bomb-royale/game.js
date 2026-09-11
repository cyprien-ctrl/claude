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
    fuseCarrier: 9,          // secondes dans les mains d'un même joueur
    fuseGlobal: 26,          // mode "mèche globale"
    blastRadius: 130,
    throwMin: 420, throwMax: 1000, chargeTime: 0.75,
    magnetRadius: 150,       // rayon d'attraction vers un joueur
    magnetForce: 1500,
    ropeLen: 420,            // mode ventouse
    groundFriction: 1.6,
    pickupGrace: 0.55,       // temps avant que le lanceur puisse la reprendre
    respawnDelay: 2.0
  },
  trap: { slowFactor: .42, slowTime: 1.4, stunTime: 1.1, revealTime: 4, rearm: 6 },
  door: { openTime: 1.1 },
  pickup: { respawn: 12 },
  bonus: { speedMult: 1.45, speedTime: 7, radarTime: 9, shortFuse: 3.5 }
};

const COLORS = ['#ff6ec7','#5cf1ff','#b6ff5c','#ffd84d','#ff8b4d','#c08bff','#4dffb0','#ff5c5c'];
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
  r = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

// collision cercle <-> AABB (renvoie true si corrigé)
function resolveCircleRect(p, r, rect){
  if (!rect.solid) return false;
  const cx = clamp(p.x, rect.x, rect.x+rect.w);
  const cy = clamp(p.y, rect.y, rect.y+rect.h);
  let dx = p.x-cx, dy = p.y-cy;
  let d2 = dx*dx+dy*dy;
  if (d2 > r*r) return false;
  if (d2 > 0.0001){
    const d = Math.sqrt(d2);
    p.x = cx + dx/d*r; p.y = cy + dy/d*r;
    return true;
  }
  // centre dans le rect: pousser vers le bord le plus proche
  const left=p.x-rect.x, right=rect.x+rect.w-p.x, top=p.y-rect.y, bot=rect.y+rect.h-p.y;
  const m = Math.min(left,right,top,bot);
  if (m===left) p.x = rect.x-r; else if (m===right) p.x = rect.x+rect.w+r;
  else if (m===top) p.y = rect.y-r; else p.y = rect.y+rect.h+r;
  return true;
}

function segHitsWall(ax,ay,bx,by,walls){
  const steps = Math.max(2, (Math.hypot(bx-ax,by-ay)/24)|0);
  for (let i=1;i<=steps;i++){
    const t=i/steps, x=ax+(bx-ax)*t, y=ay+(by-ay)*t;
    for (const w of walls){
      if (!w.solid) continue;
      if (x>w.x && x<w.x+w.w && y>w.y && y<w.y+w.h) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- niveau
// Arène "game show": bandes pastel, blocs mousse, buissons (cachettes), portes.
function buildLevel(){
  const W = CFG.world.w, H = CFG.world.h, T = 40;
  const walls = [], bushes = [], traps = [], doors = [], spawns = [], pickups = [];

  const wall = (x,y,w,h,c)=>walls.push({x,y,w,h,solid:true,color:c||'#8f5ad6'});

  // bordures
  wall(0,0,W,T); wall(0,H-T,W,T); wall(0,0,T,H); wall(W-T,0,T,H);

  // blocs mousse intérieurs (colorés)
  const blocks = [
    [260,240,300,60],[260,240,60,300],[900,180,60,340],[1180,300,420,60],
    [1760,220,60,420],[420,640,340,60],[980,700,60,380],[1300,880,420,60],
    [1900,760,60,420],[260,1060,320,60],[620,1180,60,300],[1500,1240,340,60],
    [820,1000,60,220],[1640,540,240,60],[560,880,220,60]
  ];
  for (const b of blocks) wall(b[0],b[1],b[2],b[3], pick(['#ff8bd0','#8be0ff','#ffd84d','#a8f36a','#c08bff']));

  // deux "salles" avec portes (couloirs)
  wall(1180, 1000, 60, 240); wall(1180, 1400, 60, 160);
  doors.push({x:1180,y:1240,w:60,h:160,solid:true,open:0,color:'#ffb84d'});
  wall(380, 380, 60, 200);
  doors.push({x:380,y:580,w:60,h:160,solid:true,open:0,color:'#ffb84d'});
  for (const d of doors) walls.push(d);

  // buissons / cachettes: on y est masqué de la minimap des autres
  const bushSpots = [[700,380],[1500,620],[520,1320],[2050,1180],[1850,380],[1080,1450],[300,820],[2120,620]];
  for (const s of bushSpots) bushes.push({x:s[0],y:s[1],r:rand(70,95)});

  // pièges
  const trapDefs = [
    ['glue',700,900],['glue',1700,1000],['glue',1350,420],['glue',500,1450],
    ['stun',1000,560],['stun',1600,1420],['stun',320,1180],['stun',2100,900],
    ['noise',1250,700],['noise',760,1250],['noise',1950,480],['noise',430,300]
  ];
  for (const t of trapDefs)
    traps.push({type:t[0], x:t[1], y:t[2], r:t[0]==='glue'?70:34, armed:true, cd:0, flash:0});

  // bonus au sol
  const pickDefs = [
    ['speed',600,220],['speed',1900,1300],['speed',1150,1150],
    ['radar',2150,300],['radar',250,1450],
    ['fuse',1450,900],['fuse',860,700],['speed',1750,1500]
  ];
  for (const p of pickDefs) pickups.push({type:p[0], x:p[1], y:p[2], r:20, t:0, alive:true, cd:0});

  // spawns
  const cand = [[160,160],[2240,160],[160,1440],[2240,1440],[1200,120],[1200,1480],[120,800],[2280,800]];
  for (const c of cand) spawns.push({x:c[0],y:c[1]});

  return { walls, bushes, traps, doors, spawns, pickups, w:W, h:H };
}

// ---------------------------------------------------------------- entités
class Player {
  constructor(i, isHuman, spawn){
    this.i = i; this.name = NAMES[i%NAMES.length]; this.color = COLORS[i%COLORS.length];
    this.isHuman = isHuman;
    this.x = spawn.x; this.y = spawn.y; this.vx = 0; this.vy = 0;
    this.r = CFG.player.r; this.face = 0; this.alive = true;
    this.dashT = 0; this.dashCd = 0; this.dashDir = {x:1,y:0};
    this.slow = 0; this.stun = 0; this.revealed = 0; this.speedBoost = 0;
    this.shortFuse = 0;          // charges de "mèche courte" à refiler
    this.charge = 0; this.charging = false;
    this.doorProgress = 0;
    this.squash = 0; this.walkT = 0;
    this.ai = { target:null, wander:{x:spawn.x,y:spawn.y}, think:0, panic:0 };
  }
  get speed(){
    let s = CFG.player.speed;
    if (this.speedBoost>0) s *= CFG.bonus.speedMult;
    if (this.slow>0) s *= CFG.trap.slowFactor;
    if (this.charging) s *= .55;
    return s;
  }
}

class Bomb {
  constructor(){
    this.x=0; this.y=0; this.vx=0; this.vy=0; this.r=16;
    this.carrier=null; this.lastCarrier=null; this.grace=0;
    this.fuse=CFG.bomb.fuseCarrier; this.maxFuse=CFG.bomb.fuseCarrier;
    this.homing=null; this.roped=false; this.thrower=null; this.armed=true;
  }
}

// ---------------------------------------------------------------- input
const Input = {
  keys:{}, mouse:{x:0,y:0,down:false},
  init(canvas){
    addEventListener('keydown', e=>{
      this.keys[e.code]=true;
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e=>{ this.keys[e.code]=false; });
    canvas.addEventListener('mousemove', e=>{
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX-r.left) * (canvas.width/r.width);
      this.mouse.y = (e.clientY-r.top)  * (canvas.height/r.height);
    });
    canvas.addEventListener('mousedown', ()=>{ this.mouse.down=true; });
    addEventListener('mouseup', ()=>{ this.mouse.down=false; });
    addEventListener('blur', ()=>{ this.keys={}; this.mouse.down=false; });
  },
  axis(){
    const k=this.keys; let x=0,y=0;
    if (k.KeyA||k.KeyQ||k.ArrowLeft) x--;
    if (k.KeyD||k.ArrowRight) x++;
    if (k.KeyW||k.KeyZ||k.ArrowUp) y--;
    if (k.KeyS||k.ArrowDown) y++;
    const m=Math.hypot(x,y); return m?{x:x/m,y:y/m}:{x:0,y:0};
  }
};

// ---------------------------------------------------------------- jeu
class Game {
  constructor(canvas, opts){
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.level = buildLevel();
    this.time = 0; this.over = false; this.shake = 0; this.fx = [];
    this.cam = {x:0,y:0};
    const spawns = this.level.spawns.slice().sort(()=>Math.random()-.5);
    this.players = [];
    const n = 1 + opts.bots;
    for (let i=0;i<n;i++) this.players.push(new Player(i, i===0, spawns[i%spawns.length]));
    this.me = this.players[0];
    this.bomb = new Bomb();
    this.globalFuse = CFG.bomb.fuseGlobal;
    this.giveBombTo(pick(this.players.filter(p=>!p.isHuman)) || this.me, true);
    this.announce('LA BOMBE EST LÂCHÉE !', 2.2);
  }

  get alivePlayers(){ return this.players.filter(p=>p.alive); }

  announce(txt, t){ this.toast = {txt, t, max:t}; }

  giveBombTo(p, reset){
    const b = this.bomb;
    b.carrier = p; b.homing = null; b.vx = b.vy = 0; b.roped = false;
    if (this.opts.fuse === 'carrier'){
      let f = CFG.bomb.fuseCarrier;
      if (b.lastCarrier && b.lastCarrier.shortFuseSent){ f -= CFG.bonus.shortFuse; b.lastCarrier.shortFuseSent=false; }
      b.fuse = Math.max(2.2, f); b.maxFuse = CFG.bomb.fuseCarrier;
    } else if (reset) {
      b.fuse = this.globalFuse; b.maxFuse = this.globalFuse;
    }
    b.lastCarrier = p;
  }

  // ------------------------------------------------------------ update
  update(dt){
    this.time += dt;
    if (this.toast){ this.toast.t -= dt; if (this.toast.t<=0) this.toast=null; }
    this.shake = Math.max(0, this.shake - dt*3);

    for (const p of this.players){ if (p.alive) this.updatePlayer(p, dt); }
    this.updateBomb(dt);
    this.updatePickups(dt);
    this.updateTraps(dt);
    this.updateDoors(dt);
    this.updateFx(dt);

    // caméra (suit le joueur; en spectateur, suit la bombe)
    const focus = this.me.alive ? this.me
      : (this.bomb.carrier || (this.bomb.armed ? this.bomb : this.alivePlayers[0] || this.me));
    const tx = clamp(focus.x - CFG.view.w/2, 0, this.level.w - CFG.view.w);
    const ty = clamp(focus.y - CFG.view.h/2, 0, this.level.h - CFG.view.h);
    this.cam.x = lerp(this.cam.x, tx, 1-Math.pow(0.001, dt));
    this.cam.y = lerp(this.cam.y, ty, 1-Math.pow(0.001, dt));

    if (!this.over){
      const alive = this.alivePlayers;
      if (alive.length <= 1) this.finish(alive[0]);
      else if (!this.me.alive && !this.deadSince) this.deadSince = this.time;
    }
  }

  updatePlayer(p, dt){
    p.slow = Math.max(0, p.slow-dt);
    p.stun = Math.max(0, p.stun-dt);
    p.revealed = Math.max(0, p.revealed-dt);
    p.speedBoost = Math.max(0, p.speedBoost-dt);
    p.dashCd = Math.max(0, p.dashCd-dt);
    p.squash = Math.max(0, p.squash-dt*4);
    let move = {x:0,y:0}, wantDash=false, aim=null;

    if (p.stun > 0){ p.vx*=0.85; p.vy*=0.85; }
    else if (p.isHuman){
      move = Input.axis();
      wantDash = !!Input.keys.Space;
      aim = { x: Input.mouse.x + this.cam.x, y: Input.mouse.y + this.cam.y };
      // charge / lancer
      if (this.bomb.carrier === p){
        if (Input.mouse.down){ p.charging = true; p.charge = Math.min(1, p.charge + dt/CFG.bomb.chargeTime); }
        else if (p.charging){ this.throwBomb(p, Math.atan2(aim.y-p.y, aim.x-p.x), p.charge); p.charging=false; p.charge=0; }
      } else { p.charging=false; p.charge=0; }
      // portes
      this.tryDoor(p, !!Input.keys.KeyE, dt);
    } else {
      const cmd = this.botThink(p, dt);
      move = cmd.move; wantDash = cmd.dash; aim = cmd.aim;
      if (cmd.throwAngle !== null && this.bomb.carrier === p) this.throwBomb(p, cmd.throwAngle, cmd.power);
      this.tryDoor(p, cmd.door, dt);
    }

    // dash
    if (wantDash && p.dashCd<=0 && p.dashT<=0 && (move.x||move.y)){
      p.dashT = CFG.dash.time; p.dashCd = CFG.dash.cooldown;
      p.dashDir = {...move}; p.squash = 1;
      this.fx.push({type:'ring', x:p.x, y:p.y, r:10, max:46, t:0, life:.3, color:p.color});
    }
    if (p.dashT > 0){
      p.dashT -= dt;
      p.vx = p.dashDir.x * CFG.dash.speed; p.vy = p.dashDir.y * CFG.dash.speed;
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

    // collisions
    for (const w of this.level.walls) if (resolveCircleRect(p, p.r, w)){ p.vx*=.4; p.vy*=.4; }
    p.x = clamp(p.x, p.r, this.level.w-p.r); p.y = clamp(p.y, p.r, this.level.h-p.r);

    // joueurs entre eux (poussée douce)
    for (const o of this.players){
      if (o===p || !o.alive) continue;
      const d = dist(p,o), min = p.r+o.r;
      if (d>0 && d<min){
        const push = (min-d)/2, nx=(p.x-o.x)/d, ny=(p.y-o.y)/d;
        p.x+=nx*push; p.y+=ny*push; o.x-=nx*push; o.y-=ny*push;
      }
    }
  }

  tryDoor(p, pressing, dt){
    const d = this.level.doors.find(d=>d.solid &&
      p.x > d.x-60 && p.x < d.x+d.w+60 && p.y > d.y-60 && p.y < d.y+d.h+60);
    p.nearDoor = d || null;
    if (d && pressing){
      d.open += dt/CFG.door.openTime;
      if (d.open >= 1){ d.solid = false; this.fx.push({type:'ring',x:d.x+d.w/2,y:d.y+d.h/2,r:20,max:110,t:0,life:.5,color:'#ffd84d'}); }
    } else if (d && d.open>0 && d.solid) d.open = Math.max(0, d.open - dt*0.6);
  }

  throwBomb(p, angle, power){
    const b = this.bomb;
    if (b.carrier !== p) return;
    const sp = lerp(CFG.bomb.throwMin, CFG.bomb.throwMax, clamp(power,0,1));
    b.carrier = null; b.thrower = p; b.grace = CFG.bomb.pickupGrace;
    b.x = p.x + Math.cos(angle)*(p.r+b.r+4); b.y = p.y + Math.sin(angle)*(p.r+b.r+4);
    b.vx = Math.cos(angle)*sp + p.vx*.3; b.vy = Math.sin(angle)*sp + p.vy*.3;
    b.roped = (this.opts.throwMode === 'rope');
    b.homing = null;
    p.squash = 1;
    if (p.shortFuse > 0){ p.shortFuse--; p.shortFuseSent = true; }
    this.fx.push({type:'ring', x:b.x, y:b.y, r:8, max:36, t:0, life:.25, color:'#fff'});
  }

  updateBomb(dt){
    const b = this.bomb;
    // mèche
    if (b.carrier || this.opts.fuse==='global'){
      b.fuse -= dt;
      if (b.fuse <= 0){ this.explode(); return; }
    }
    if (b.carrier){
      const c = b.carrier;
      const off = 26;
      b.x = c.x + Math.cos(c.face)*off; b.y = c.y + Math.sin(c.face)*off - 10;
      b.vx = b.vy = 0;
      return;
    }

    b.grace = Math.max(0, b.grace-dt);

    // aimant: la bombe au sol / en vol marche vers le joueur le plus proche
    let best=null, bestD=CFG.bomb.magnetRadius;
    for (const p of this.alivePlayers){
      if (b.grace>0 && p===b.thrower) continue;
      const d = dist(b,p);
      if (d < bestD && !segHitsWall(b.x,b.y,p.x,p.y,this.level.walls)){ bestD=d; best=p; }
    }
    b.homing = best;
    if (best){
      const a = Math.atan2(best.y-b.y, best.x-b.x);
      b.vx += Math.cos(a)*CFG.bomb.magnetForce*dt;
      b.vy += Math.sin(a)*CFG.bomb.magnetForce*dt;
      const sp = Math.hypot(b.vx,b.vy), cap = 520;
      if (sp > cap){ b.vx = b.vx/sp*cap; b.vy = b.vy/sp*cap; }
    } else {
      const f = Math.max(0, 1 - CFG.bomb.groundFriction*dt);
      b.vx *= f; b.vy *= f;
    }

    // corde (ventouse): si elle s'éloigne trop, elle revient au lanceur
    if (b.roped && b.thrower && b.thrower.alive && !best){
      const d = dist(b, b.thrower);
      if (d > CFG.bomb.ropeLen || Math.hypot(b.vx,b.vy) < 60){
        const a = Math.atan2(b.thrower.y-b.y, b.thrower.x-b.x);
        b.vx += Math.cos(a)*1800*dt; b.vy += Math.sin(a)*1800*dt;
      }
    }

    b.x += b.vx*dt; b.y += b.vy*dt;

    // rebonds sur murs
    for (const w of this.level.walls){
      if (!w.solid) continue;
      const before = {x:b.x,y:b.y};
      if (resolveCircleRect(b, b.r, w)){
        const nx = b.x-before.x, ny = b.y-before.y;
        if (Math.abs(nx) > Math.abs(ny)) b.vx = -b.vx*.55; else b.vy = -b.vy*.55;
      }
    }
    b.x = clamp(b.x, b.r, this.level.w-b.r); b.y = clamp(b.y, b.r, this.level.h-b.r);
    if (b.x<=b.r||b.x>=this.level.w-b.r) b.vx*=-.55;
    if (b.y<=b.r||b.y>=this.level.h-b.r) b.vy*=-.55;

    // ramassage
    for (const p of this.alivePlayers){
      if (b.grace>0 && p===b.thrower) continue;
      if (dist(b,p) < p.r+b.r+2){
        this.giveBombTo(p);
        p.squash = 1; this.shake = Math.min(1, this.shake+.25);
        this.fx.push({type:'ring',x:p.x,y:p.y,r:14,max:60,t:0,life:.3,color:'#ff4d4d'});
        if (p===this.me) this.announce('TU AS LA BOMBE !', 1.2);
        break;
      }
    }
  }

  explode(){
    const b = this.bomb;
    const cx = b.carrier ? b.carrier.x : b.x, cy = b.carrier ? b.carrier.y : b.y;
    this.fx.push({type:'boom', x:cx, y:cy, r:20, max:CFG.bomb.blastRadius, t:0, life:.55});
    this.shake = 1;
    const victims = [];
    for (const p of this.alivePlayers){
      const d = Math.hypot(p.x-cx, p.y-cy);
      if (p === b.carrier || d < CFG.bomb.blastRadius){ p.alive = false; victims.push(p); }
    }
    for (const v of victims)
      for (let i=0;i<14;i++)
        this.fx.push({type:'part', x:v.x, y:v.y, vx:rand(-320,320), vy:rand(-420,120), t:0, life:rand(.5,1), color:v.color});

    if (victims.some(v=>v.isHuman)) this.announce('TU AS EXPLOSÉ 💥', 2.5);
    else this.announce(victims.map(v=>v.name).join(' + ') + ' explose !', 1.8);

    // nouvelle bombe
    b.carrier = null; b.thrower = null; b.homing = null; b.vx=b.vy=0; b.armed=false;
    setTimeout(()=>{
      const alive = this.alivePlayers;
      if (alive.length <= 1 || this.over) return;
      const target = pick(alive);
      this.globalFuse = Math.max(10, this.globalFuse - 4);
      b.armed = true;
      this.giveBombTo(target, true);
      this.announce('NOUVELLE BOMBE → ' + target.name, 1.6);
    }, CFG.bomb.respawnDelay*1000);
  }

  updateTraps(dt){
    for (const t of this.level.traps){
      t.flash = Math.max(0, t.flash-dt);
      if (!t.armed){ t.cd -= dt; if (t.cd<=0) t.armed=true; continue; }
      for (const p of this.alivePlayers){
        if (dist(t,p) > t.r + p.r) continue;
        if (t.type==='glue'){ p.slow = CFG.trap.slowTime; t.flash=.2; }
        else if (t.type==='stun'){
          p.stun = CFG.trap.stunTime; p.vx=p.vy=0; t.armed=false; t.cd=CFG.trap.rearm; t.flash=.5;
          this.fx.push({type:'ring',x:t.x,y:t.y,r:10,max:70,t:0,life:.4,color:'#ff5c5c'});
          if (p===this.me) this.announce('PIÈGE ! Immobilisé', 1);
        } else if (t.type==='noise'){
          p.revealed = CFG.trap.revealTime; t.armed=false; t.cd=CFG.trap.rearm; t.flash=.6;
          this.fx.push({type:'ring',x:t.x,y:t.y,r:10,max:120,t:0,life:.6,color:'#ffd84d'});
          if (p===this.me) this.announce('BRUIT ! Tu es sur la minimap', 1.2);
        }
      }
    }
  }

  updatePickups(dt){
    for (const k of this.level.pickups){
      k.t += dt;
      if (!k.alive){ k.cd -= dt; if (k.cd<=0) k.alive=true; continue; }
      for (const p of this.alivePlayers){
        if (dist(k,p) > k.r+p.r) continue;
        k.alive=false; k.cd=CFG.pickup.respawn;
        if (k.type==='speed'){ p.speedBoost = CFG.bonus.speedTime; if(p===this.me) this.announce('BOOST DE VITESSE', 1); }
        if (k.type==='radar'){ p.radar = (p.radar||0) + CFG.bonus.radarTime; if(p===this.me) this.announce('RADAR : tous visibles', 1.2); }
        if (k.type==='fuse'){ p.shortFuse++; if(p===this.me) this.announce('MÈCHE COURTE (prochaine passe)', 1.4); }
        this.fx.push({type:'ring',x:k.x,y:k.y,r:8,max:44,t:0,life:.3,color:'#fff'});
      }
    }
    for (const p of this.players) if (p.radar>0) p.radar -= dt;
  }

  updateDoors(dt){}

  updateFx(dt){
    for (const f of this.fx){
      f.t += dt;
      if (f.type==='part'){ f.x+=f.vx*dt; f.y+=f.vy*dt; f.vy+=900*dt; }
    }
    this.fx = this.fx.filter(f=>f.t < f.life);
  }

  finish(winner){
    this.over = true; this.winner = winner;
    if (this.onEnd) this.onEnd(winner);
  }

  // ------------------------------------------------------------ IA bots
  botThink(p, dt){
    const out = { move:{x:0,y:0}, dash:false, aim:null, throwAngle:null, power:1, door:false };
    const b = this.bomb;
    const others = this.alivePlayers.filter(o=>o!==p);
    if (!others.length) return out;

    const hasBomb = b.carrier === p;
    const carrier = b.carrier;
    let goal = null;

    if (hasBomb){
      // chercher la cible la plus proche visible, foncer, lancer à portée
      let best=null, bd=1e9;
      for (const o of others){ const d=dist(p,o); if (d<bd){ bd=d; best=o; } }
      goal = {x:best.x, y:best.y};
      out.aim = goal;
      const clear = !segHitsWall(p.x,p.y,best.x,best.y,this.level.walls);
      p.ai.think -= dt;
      if (clear && bd < 460 && p.ai.think<=0){
        // vise avec un peu d'avance et d'erreur
        const lead = 0.22;
        const tx = best.x + best.vx*lead, ty = best.y + best.vy*lead;
        out.throwAngle = Math.atan2(ty-p.y, tx-p.x) + rand(-0.12,0.12);
        out.power = clamp(bd/700, .35, 1);
        p.ai.think = 0.6;
      }
      if (bd > 250 && p.dashCd<=0 && clear) out.dash = true;
      if (b.fuse < 2.5 && bd > 500) out.dash = true;
    } else if (carrier){
      // fuir le porteur; si la bombe est au sol loin, l'éviter aussi
      const d = dist(p, carrier);
      const away = Math.atan2(p.y-carrier.y, p.x-carrier.x) + rand(-.3,.3);
      if (d < 420){
        goal = {x: p.x + Math.cos(away)*400, y: p.y + Math.sin(away)*400};
        if (d < 220 && p.dashCd<=0) out.dash = true;
      }
    }

    if (!goal){
      // errance vers bonus ou point aléatoire
      p.ai.think -= dt;
      const k = this.level.pickups.filter(k=>k.alive).sort((a,c)=>dist(p,a)-dist(p,c))[0];
      if (k && dist(p,k) < 600) p.ai.wander = {x:k.x,y:k.y};
      else if (p.ai.think<=0 || dist(p,p.ai.wander) < 60){
        p.ai.wander = {x: rand(80,this.level.w-80), y: rand(80,this.level.h-80)};
        p.ai.think = rand(2,4);
      }
      goal = p.ai.wander;
    }

    // fuir la bombe au sol qui traîne
    if (!hasBomb && !carrier && b.armed){
      const db = dist(p,b);
      if (db < 200){ goal = {x: p.x + (p.x-b.x), y: p.y + (p.y-b.y)}; }
    }

    // steering + évitement mur simple (raycast court sur 3 directions)
    let a = Math.atan2(goal.y-p.y, goal.x-p.x);
    const probe = 78;
    const blocked = ang => segHitsWall(p.x,p.y, p.x+Math.cos(ang)*probe, p.y+Math.sin(ang)*probe, this.level.walls);
    if (blocked(a)){
      let found=false;
      for (let k=1;k<=6 && !found;k++){
        for (const s of [1,-1]){
          const na = a + s*k*0.35;
          if (!blocked(na)){ a = na; found=true; break; }
        }
      }
      if (!found) a += Math.PI;
    }
    out.move = {x:Math.cos(a), y:Math.sin(a)};
    out.aim = out.aim || {x: p.x+Math.cos(a)*100, y: p.y+Math.sin(a)*100};
    out.door = !!p.nearDoor;
    // évite le dash à l'aveugle contre un mur
    if (out.dash && blocked(a)) out.dash = false;
    return out;
  }

  // ------------------------------------------------------------ rendu
  draw(){
    const ctx = this.ctx, cam = this.cam;
    ctx.save();
    if (this.shake > 0){
      const s = this.shake*10;
      ctx.translate(rand(-s,s), rand(-s,s));
    }
    ctx.translate(-cam.x, -cam.y);

    this.drawGround(ctx);
    this.drawTraps(ctx);
    this.drawPickups(ctx);
    this.drawWalls(ctx);
    this.drawDoors(ctx);

    // joueurs (morts d'abord = rien, puis vivants)
    for (const p of this.alivePlayers) if (p !== this.me) this.drawPlayer(ctx, p);
    if (this.me.alive) this.drawPlayer(ctx, this.me);

    this.drawBomb(ctx);
    this.drawBushes(ctx);
    this.drawFx(ctx);
    ctx.restore();

    this.drawHud(ctx);
  }

  drawGround(ctx){
    const {w,h} = this.level, cell = 160;
    ctx.fillStyle = '#7ad7f0'; ctx.fillRect(0,0,w,h);
    for (let y=0;y<h;y+=cell) for (let x=0;x<w;x+=cell){
      const even = ((x/cell)+(y/cell))%2===0;
      ctx.fillStyle = even ? 'rgba(255,255,255,.16)' : 'rgba(90,200,240,.25)';
      ctx.fillRect(x,y,cell,cell);
    }
    // bandes décoratives
    ctx.fillStyle = 'rgba(255,110,199,.14)';
    for (let i=0;i<6;i++) ctx.fillRect(0, 180+i*260, w, 46);
  }

  drawWalls(ctx){
    for (const w of this.level.walls){
      if (this.level.doors.includes(w)) continue;
      if (!w.solid) continue;
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
      const open = d.solid ? d.open : 1;
      ctx.save();
      ctx.globalAlpha = 1 - open*0.85;
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      roundRect(ctx, d.x+5, d.y+8, d.w, d.h, 10); ctx.fill();
      ctx.fillStyle = d.color;
      roundRect(ctx, d.x, d.y, d.w, d.h, 10); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      for (let i=0;i<4;i++) ctx.fillRect(d.x+10, d.y+16+i*((d.h-32)/3), d.w-20, 6);
      ctx.restore();
      if (d.solid && d.open>0){
        ctx.fillStyle='rgba(0,0,0,.45)';
        roundRect(ctx, d.x-16, d.y-22, d.w+32, 12, 6); ctx.fill();
        ctx.fillStyle='#b6ff5c';
        roundRect(ctx, d.x-14, d.y-20, (d.w+28)*d.open, 8, 4); ctx.fill();
      }
    }
  }

  drawBushes(ctx){
    for (const b of this.level.bushes){
      ctx.save();
      ctx.globalAlpha = .82;
      ctx.fillStyle = '#3fc46b';
      for (let i=0;i<7;i++){
        const a = i/7*TAU;
        ctx.beginPath();
        ctx.arc(b.x+Math.cos(a)*b.r*.45, b.y+Math.sin(a)*b.r*.45, b.r*.52, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#55e086';
      ctx.beginPath(); ctx.arc(b.x-b.r*.2, b.y-b.r*.2, b.r*.45, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  drawTraps(ctx){
    for (const t of this.level.traps){
      ctx.save();
      if (t.type==='glue'){
        ctx.fillStyle = t.flash>0 ? 'rgba(160,120,255,.85)' : 'rgba(140,100,240,.55)';
        ctx.beginPath(); ctx.arc(t.x,t.y,t.r,0,TAU); ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,.5)'; ctx.lineWidth=3; ctx.stroke();
      } else if (t.type==='stun'){
        ctx.globalAlpha = t.armed?1:.3;
        ctx.fillStyle='#ff5c5c'; ctx.beginPath(); ctx.arc(t.x,t.y,t.r,0,TAU); ctx.fill();
        ctx.fillStyle='#2b1d54';
        for (let i=0;i<8;i++){ const a=i/8*TAU;
          ctx.beginPath(); ctx.moveTo(t.x+Math.cos(a)*t.r*.4,t.y+Math.sin(a)*t.r*.4);
          ctx.lineTo(t.x+Math.cos(a+.25)*t.r,t.y+Math.sin(a+.25)*t.r);
          ctx.lineTo(t.x+Math.cos(a-.25)*t.r,t.y+Math.sin(a-.25)*t.r); ctx.fill(); }
      } else {
        ctx.globalAlpha = t.armed?1:.3;
        ctx.fillStyle='#ffd84d'; roundRect(ctx,t.x-t.r,t.y-t.r,t.r*2,t.r*2,10); ctx.fill();
        ctx.fillStyle='#2b1d54'; ctx.font='bold 26px Verdana'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText('!', t.x, t.y+1);
      }
      ctx.restore();
    }
  }

  drawPickups(ctx){
    for (const k of this.level.pickups){
      if (!k.alive) continue;
      const bob = Math.sin(k.t*3)*5;
      ctx.save();
      ctx.translate(k.x, k.y+bob);
      ctx.fillStyle='rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(0,18-bob,16,6,0,0,TAU); ctx.fill();
      const col = k.type==='speed'?'#5cf1ff':k.type==='radar'?'#b6ff5c':'#ff8b4d';
      ctx.fillStyle = col; roundRect(ctx,-16,-16,32,32,10); ctx.fill();
      ctx.fillStyle='#20123f'; ctx.font='bold 18px Verdana'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(k.type==='speed'?'»':k.type==='radar'?'◉':'✂', 0, 1);
      ctx.restore();
    }
  }

  drawPlayer(ctx, p){
    const sq = 1 + p.squash*0.25, st = 1 - p.squash*0.18;
    const bob = Math.sin(p.walkT*6)*2;
    ctx.save();
    ctx.translate(p.x, p.y);
    // ombre
    ctx.fillStyle='rgba(0,0,0,.22)';
    ctx.beginPath(); ctx.ellipse(0, p.r*0.95, p.r*0.95, p.r*0.42, 0,0,TAU); ctx.fill();
    ctx.scale(st, sq);
    ctx.translate(0, bob);
    // corps capsule
    const w = p.r*1.9, h = p.r*2.2;
    ctx.fillStyle = p.color;
    roundRect(ctx, -w/2, -h/2, w, h, w/2); ctx.fill();
    // ventre clair
    ctx.fillStyle='rgba(255,255,255,.35)';
    roundRect(ctx, -w/2+5, -h/2+8, w-10, h*0.45, w/3); ctx.fill();
    // yeux orientés
    const ex = Math.cos(p.face)*4, ey = Math.sin(p.face)*3;
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(-7+ex, -6+ey, 6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc( 7+ex, -6+ey, 6, 0, TAU); ctx.fill();
    ctx.fillStyle='#20123f';
    ctx.beginPath(); ctx.arc(-7+ex*1.6, -6+ey*1.6, 2.8, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc( 7+ex*1.6, -6+ey*1.6, 2.8, 0, TAU); ctx.fill();
    ctx.restore();

    // états
    if (p.stun>0){
      ctx.fillStyle='#ffd84d'; ctx.font='bold 18px Verdana'; ctx.textAlign='center';
      ctx.fillText('★', p.x + Math.cos(this.time*8)*14, p.y - p.r - 16);
    }
    if (p.slow>0){ ctx.strokeStyle='rgba(160,120,255,.9)'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r+6,0,TAU); ctx.stroke(); }
    if (p.speedBoost>0){ ctx.strokeStyle='rgba(92,241,255,.9)'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r+10,0,TAU); ctx.stroke(); }

    // nom
    ctx.font='bold 12px Verdana'; ctx.textAlign='center';
    ctx.fillStyle = p===this.me ? '#fff' : 'rgba(255,255,255,.75)';
    ctx.strokeStyle='rgba(0,0,0,.55)'; ctx.lineWidth=3;
    const label = p.name + (p.shortFuse?' ✂':'');
    ctx.strokeText(label, p.x, p.y - p.r - 26); ctx.fillText(label, p.x, p.y - p.r - 26);

    // jauge de charge (humain)
    if (p.charging && p.charge>0.02){
      ctx.fillStyle='rgba(0,0,0,.5)'; roundRect(ctx,p.x-26,p.y+p.r+8,52,8,4); ctx.fill();
      ctx.fillStyle='#ffd84d'; roundRect(ctx,p.x-24,p.y+p.r+10,48*p.charge,4,2); ctx.fill();
      // trajectoire visée
      const a = p.face, sp = lerp(CFG.bomb.throwMin, CFG.bomb.throwMax, p.charge);
      ctx.setLineDash([8,8]); ctx.strokeStyle='rgba(255,255,255,.6)'; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(p.x,p.y);
      ctx.lineTo(p.x+Math.cos(a)*sp*0.35, p.y+Math.sin(a)*sp*0.35); ctx.stroke();
      ctx.setLineDash([]);
    }

    if (p.nearDoor && p===this.me && p.nearDoor.solid){
      ctx.font='bold 13px Verdana'; ctx.fillStyle='#ffd84d'; ctx.textAlign='center';
      ctx.fillText('[E] ouvrir', p.x, p.y - p.r - 44);
    }
  }

  drawBomb(ctx){
    const b = this.bomb;
    if (!b.armed) return;
    const t = this.time;
    const danger = b.fuse / Math.max(1,b.maxFuse);
    const pulse = 1 + Math.sin(t*(12 - danger*8))*0.12;
    // corde de la ventouse
    if (b.roped && !b.carrier && b.thrower && b.thrower.alive){
      ctx.strokeStyle='rgba(255,255,255,.65)'; ctx.lineWidth=3; ctx.setLineDash([6,6]);
      ctx.beginPath(); ctx.moveTo(b.thrower.x, b.thrower.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    // halo d'aimantation
    if (b.homing){
      ctx.strokeStyle='rgba(255,80,80,.5)'; ctx.lineWidth=4;
      ctx.beginPath(); ctx.arc(b.x,b.y, CFG.bomb.magnetRadius*0.5 + Math.sin(t*10)*6, 0, TAU); ctx.stroke();
    }
    ctx.save();
    ctx.translate(b.x,b.y); ctx.scale(pulse,pulse);
    ctx.fillStyle='rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0,b.r+6,b.r,b.r*.4,0,0,TAU); ctx.fill();
    ctx.fillStyle='#2b2340'; ctx.beginPath(); ctx.arc(0,0,b.r,0,TAU); ctx.fill();
    ctx.fillStyle= danger<0.3 ? '#ff4d4d' : '#5a4f7a';
    ctx.beginPath(); ctx.arc(-5,-5,b.r*.45,0,TAU); ctx.fill();
    // mèche + étincelle
    ctx.strokeStyle='#c9a86a'; ctx.lineWidth=4;
    ctx.beginPath(); ctx.moveTo(0,-b.r); ctx.quadraticCurveTo(10,-b.r-12, 4,-b.r-20); ctx.stroke();
    ctx.fillStyle = Math.sin(t*30)>0 ? '#ffd84d' : '#ff8b4d';
    ctx.beginPath(); ctx.arc(4,-b.r-22, 5+Math.random()*2, 0, TAU); ctx.fill();
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
      } else if (f.type==='part'){
        ctx.globalAlpha = 1-k; ctx.fillStyle=f.color;
        roundRect(ctx,f.x-6,f.y-6,12,12,4); ctx.fill();
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ HUD
  drawHud(ctx){
    const W = CFG.view.w, H = CFG.view.h;
    const b = this.bomb;

    // barre de mèche
    const pct = clamp(b.fuse / Math.max(1,b.maxFuse), 0, 1);
    const bw = 420, bx = W/2-bw/2, by = 22;
    ctx.fillStyle='rgba(20,12,45,.65)'; roundRect(ctx,bx-6,by-6,bw+12,34,17); ctx.fill();
    ctx.fillStyle = pct>.5 ? '#b6ff5c' : pct>.25 ? '#ffd84d' : '#ff5c5c';
    roundRect(ctx,bx,by,bw*pct,22,11); ctx.fill();
    ctx.font='bold 14px Verdana'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle='#fff';
    const who = b.carrier ? (b.carrier===this.me?'TOI':b.carrier.name) : 'au sol';
    const mode = this.opts.fuse==='carrier' ? 'MÈCHE PORTEUR' : 'MÈCHE GLOBALE';
    ctx.fillText(`${mode} · ${b.fuse>0?b.fuse.toFixed(1):'0.0'}s · ${who}`, W/2, by+11);

    // survivants
    ctx.textAlign='left';
    ctx.fillStyle='rgba(20,12,45,.65)'; roundRect(ctx,18,18,170,30,15); ctx.fill();
    ctx.fillStyle='#fff'; ctx.font='bold 15px Verdana';
    ctx.fillText(`SURVIVANTS : ${this.alivePlayers.length}/${this.players.length}`, 32, 34);

    // dash
    const dcd = this.me.dashCd/CFG.dash.cooldown;
    ctx.fillStyle='rgba(20,12,45,.65)'; roundRect(ctx,18,H-56,150,38,19); ctx.fill();
    ctx.fillStyle = dcd<=0 ? '#5cf1ff' : 'rgba(92,241,255,.3)';
    roundRect(ctx,24,H-50,138*(1-dcd),26,13); ctx.fill();
    ctx.fillStyle='#20123f'; ctx.font='bold 13px Verdana'; ctx.textAlign='center';
    ctx.fillText('DASH [ESPACE]', 93, H-37);

    // bonus actifs
    let bx2 = 182;
    const chips = [];
    if (this.me.speedBoost>0) chips.push(['VITESSE '+this.me.speedBoost.toFixed(0)+'s','#5cf1ff']);
    if (this.me.radar>0) chips.push(['RADAR '+this.me.radar.toFixed(0)+'s','#b6ff5c']);
    if (this.me.shortFuse>0) chips.push(['MÈCHE COURTE x'+this.me.shortFuse,'#ff8b4d']);
    if (this.me.revealed>0) chips.push(['REPÉRÉ !','#ffd84d']);
    ctx.textAlign='center';
    for (const c of chips){
      const w = ctx.measureText(c[0]).width + 26;
      ctx.fillStyle='rgba(20,12,45,.7)'; roundRect(ctx,bx2,H-52,w,30,15); ctx.fill();
      ctx.fillStyle=c[1]; ctx.font='bold 12px Verdana';
      ctx.fillText(c[0], bx2+w/2, H-37);
      bx2 += w+8;
    }

    this.drawMinimap(ctx);

    // toast
    if (this.toast){
      const a = clamp(this.toast.t/0.4,0,1);
      ctx.save(); ctx.globalAlpha = a;
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

  drawMinimap(ctx){
    const W = CFG.view.w, size = 210, pad = 18;
    const mx = W - size - pad, my = pad;
    const sx = size/this.level.w, sy = (size*this.level.h/this.level.w)/this.level.h;
    const mh = size*this.level.h/this.level.w;

    ctx.save();
    ctx.fillStyle='rgba(20,12,45,.72)'; roundRect(ctx,mx-6,my-6,size+12,mh+12,14); ctx.fill();
    ctx.beginPath(); roundRect(ctx,mx,my,size,mh,10); ctx.clip();
    ctx.fillStyle='rgba(122,215,240,.35)'; ctx.fillRect(mx,my,size,mh);
    for (const w of this.level.walls){
      if (!w.solid) continue;
      ctx.fillStyle = this.level.doors.includes(w) ? 'rgba(255,184,77,.9)' : 'rgba(60,40,110,.75)';
      ctx.fillRect(mx+w.x*sx, my+w.y*sy, Math.max(2,w.w*sx), Math.max(2,w.h*sy));
    }
    for (const bsh of this.level.bushes){
      ctx.fillStyle='rgba(63,196,107,.6)';
      ctx.beginPath(); ctx.arc(mx+bsh.x*sx, my+bsh.y*sy, bsh.r*sx, 0, TAU); ctx.fill();
    }

    const hidden = p => this.level.bushes.some(b=>dist(b,p) < b.r);
    const radar = this.me.radar>0;
    for (const p of this.alivePlayers){
      const isMe = p===this.me;
      const isCarrier = this.bomb.carrier===p;
      // visible si: moi, porteur de bombe, radar actif, repéré par piège sonore, ou hors cachette+proche
      const near = dist(p,this.me) < 520;
      const show = isMe || isCarrier || radar || p.revealed>0 || (near && !hidden(p));
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
    if (!this.bomb.carrier && this.bomb.armed){
      ctx.fillStyle='#ff4d4d';
      ctx.beginPath(); ctx.arc(mx+this.bomb.x*sx, my+this.bomb.y*sy, 4, 0, TAU); ctx.fill();
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
      throwMode: document.getElementById('optThrow').value
    };
    game = new Game(canvas, opts);
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
