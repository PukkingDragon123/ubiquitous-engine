// DOM overlay: minimal HUD, floating typography, blueprints, inspection.
import * as THREE from 'three';
import './ui.css';
import { ICONS, RES_ICON, costHTML } from './icons.js';
import { blueprintImage } from './blueprints.js';
import { BUILDINGS, BLUEPRINT_ORDER, TECHS } from '../buildings/buildingTypes.js';
import { UNIT_TYPES } from '../entities/Sandling.js';
import { clamp, rnd, pick } from '../core/math.js';
import { Tutorial } from '../game/Tutorial.js';

const _v = new THREE.Vector3();
const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html !== undefined) el.innerHTML = html;
  return el;
};

const TOOL_DEFS = [
  { id: 'hand', key: '1', tip: 'Hand — grab, select, hold to summon' },
  { id: 'shovel', key: '2', tip: 'Shovel — drag to dig · Shift/right-drag to pile' },
  { id: 'bucket', key: '3', tip: 'Bucket — stamp sand towers' },
  { id: 'rake', key: '4', tip: 'Rake — smooth the sand' },
  { id: 'bottle', key: '5', tip: 'Blueprints from the sea (B)' },
  { id: 'horn', key: '6', tip: 'War horn — send troops' },
];

// Letters that pop in one by one, grouped per word so lines only break between words.
function popLetters(parent, text, speed) {
  let n = 0;
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    const word = h('span', /\s/.test(part) ? 'sp' : 'w');
    for (const c of part) {
      const s = h('span', 'ch');
      s.textContent = c;
      s.style.animationDelay = `${n++ * speed}s`;
      word.appendChild(s);
    }
    parent.appendChild(word);
  }
}

export class UI {
  constructor(game) {
    this.game = game;
    const root = (this.root = document.getElementById('ui'));
    this.anchors = [];
    this.inspected = null;
    this.blueprintsOpen = false;

    this.world = h('div', 'world');
    root.appendChild(this.world);

    // HUD
    this.hud = h('div', 'hud off');
    root.appendChild(this.hud);
    this.resBar = h('div', 'res-bar');
    this.hud.appendChild(this.resBar);
    this.resEls = {};
    for (const k of ['shells', 'pebbles', 'driftwood', 'seaweed', 'gems', 'treasure']) {
      const el = h('div', 'res zero', `<i>${ICONS[RES_ICON[k]]}</i><span>0</span>`);
      el.title = k;
      this.resBar.appendChild(el);
      this.resEls[k] = el;
    }
    this.popEl = h('div', 'res', `<i>${ICONS.pop}</i><span>0/0</span>`);
    this.popEl.title = 'Population / housing';
    this.resBar.appendChild(this.popEl);

    this.tide = h('div', 'tide', `<i>${ICONS.wave}</i><span>Calm seas</span>`);
    this.hud.appendChild(this.tide);
    this.bossBar = h('div', 'boss-bar hidden', `<div class="nm"></div><div class="b"><span></span></div>`);
    this.hud.appendChild(this.bossBar);

    this.belt = h('div', 'toolbelt ui-pe');
    this.toolEls = {};
    for (const t of TOOL_DEFS) {
      const b = h('button', 'tool', `${ICONS[t.id]}<span class="key">${t.key}</span><span class="tip">${t.tip}</span>`);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (t.id === 'bottle') this.toggleBlueprints();
        else { this.closeBlueprints(); game.interaction.setTool(t.id); }
        game.events.emit('uiClick');
      });
      this.belt.appendChild(b);
      this.toolEls[t.id] = b;
    }
    this.hud.appendChild(this.belt);

    this.corner = h('div', 'corner ui-pe');
    const cb = (icon, title, fn) => { const b = h('button', '', ICONS[icon]); b.title = title; b.addEventListener('click', (e) => { e.stopPropagation(); fn(); game.events.emit('uiClick'); }); this.corner.appendChild(b); };
    cb('pause', 'Pause (P)', () => game.togglePause());
    cb('gear', 'Settings', () => this.showSettings());
    cb('help', 'How to play', () => this.showHelp());
    this.hud.appendChild(this.corner);

    this.placeInfo = h('div', 'place-info hidden');
    this.hud.appendChild(this.placeInfo);

    this.bottles = h('div', 'bottles');
    this.hud.appendChild(this.bottles);
    this.scroll = h('div', 'scroll-card');
    this.hud.appendChild(this.scroll);

    this.countdown = h('div', 'countdown', `<div class="lead">THE SEA WILL RISE IN&hellip;</div><span class="num">45</span>`);
    root.appendChild(this.countdown);
    this.cdNum = this.countdown.querySelector('.num');

    this.inspectEl = h('div', 'inspect ui-pe');
    root.appendChild(this.inspectEl);

    this.titles = h('div', 'titles');
    root.appendChild(this.titles);
    this.toasts = h('div', 'toasts');
    root.appendChild(this.toasts);

    this.cine = h('div', 'cine', `<div class="bar top"></div><div class="bar bot"></div>
      <div class="game-title"><div class="n">Sandlings</div><div class="tag">a tiny kingdom against the tide</div></div>
      <div class="sub"></div><div class="skip">Space · skip</div>`);
    root.appendChild(this.cine);
    this.cineSub = this.cine.querySelector('.sub');
    this.cineTitle = this.cine.querySelector('.game-title');

    this.possessHint = h('div', 'possess-hint hidden');
    root.appendChild(this.possessHint);
    this.crosshair = h('div', 'crosshair hidden');
    root.appendChild(this.crosshair);
    this.selbox = h('div', 'selbox hidden');
    root.appendChild(this.selbox);
    this.hoverTag = h('div', 'hover-tag hidden');
    root.appendChild(this.hoverTag);

    // UI elements capture the pointer: tell the game when the mouse is over them
    root.addEventListener('pointerover', (e) => { if (e.target.closest('.ui-pe')) game.input.overUI = true; });
    root.addEventListener('pointerout', (e) => { if (e.target.closest('.ui-pe')) game.input.overUI = false; });

    this.tutorial = new Tutorial(game, this);
    this._bindEvents();
  }

  showHUD(on) {
    this.hud.classList.toggle('off', !on);
  }

  // ---- events ------------------------------------------------------------------------
  _bindEvents() {
    const game = this.game, ev = game.events;
    ev.on('resources', (res, k, n, at) => this._updateRes(res, k, n, at));
    ev.on('tool', (t) => this._updateTools(t));
    ev.on('openBlueprints', () => this.toggleBlueprints());
    ev.on('toast', (text, kind, missing) => {
      this.toast(text, kind);
      if (missing) for (const k in missing) { const el = this.resEls[k]; if (el) { el.classList.remove('short'); void el.offsetWidth; el.classList.add('short'); } }
    });
    ev.on('inspect', (b) => this.inspect(b));
    ev.on('placementInfo', (info) => this._placeInfo(info));
    ev.on('selection', (sel) => {
      if (sel.size) this.toast(`${sel.size} selected — right-click or hold to send them`, '');
    });
    ev.on('box', (b) => {
      if (!b) { this.selbox.classList.add('hidden'); return; }
      this.selbox.classList.remove('hidden');
      Object.assign(this.selbox.style, { left: Math.min(b.x0, b.x1) + 'px', top: Math.min(b.y0, b.y1) + 'px', width: Math.abs(b.x1 - b.x0) + 'px', height: Math.abs(b.y1 - b.y0) + 'px' });
    });
    ev.on('warning', (secs) => {
      this.countdown.classList.add('on');
      this.title('THE SEA IS COMING', 'a stopwatch has washed ashore', { duration: 2.6, danger: true });
    });
    ev.on('countdown', (t) => {
      const s = Math.ceil(t);
      if (s !== this._cd) {
        this._cd = s;
        this.cdNum.textContent = s;
        this.cdNum.classList.remove('tick'); void this.cdNum.offsetWidth; this.cdNum.classList.add('tick');
        this.countdown.classList.toggle('urgent', s <= 10);
      }
    });
    ev.on('waveStart', (n, boss) => {
      this.countdown.classList.remove('on');
      this.title(`WAVE ${n}`, boss ? 'something enormous stirs beneath the waves…' : pick(['the crabs have friends', 'here come the forks', 'they brought cutlery', 'pinch formation, incoming']), { duration: 3, danger: true });
    });
    ev.on('waveCleared', (n) => {
      this.title('WAVE SURVIVED!', pick(['the tide retreats… for now', 'the king is pleased', 'nobody tell the crabs we were scared', 'the sea leaves gifts on the sand']), { duration: 3.4 });
    });
    ev.on('bossArrive', (c) => {
      this.title(c.def.name.split(',')[0].toUpperCase(), c.def.name.includes(',') ? c.def.name.split(',')[1].trim() : '', { duration: 4, danger: true, boss: true });
      this.boss = c;
      this.bossBar.classList.remove('hidden');
      this.bossBar.querySelector('.nm').textContent = c.def.name;
    });
    ev.on('bossDefeated', () => {
      this.title('VICTORY!', 'the Lord of the Fork is fork-gotten', { duration: 3.5 });
      this.bossBar.classList.add('hidden');
      this.boss = null;
    });
    ev.on('buildingComplete', (b) => {
      if (b.type === 'bucket' || b.type === 'wall') return;
      this.floater(b.pos.clone().setY(b.baseY + b.height + 0.5), `${b.def.short} built!`);
    });
    ev.on('buildingDestroyed', (b, src) => {
      if (b.type === 'bucket' || b.type === 'wall') return;
      this.toast(`${b.def.short} ${src === 'water' ? 'washed away' : 'destroyed'}!`, 'warn');
    });
    ev.on('delivered', (u, it) => {
      if (Math.random() < 0.9) this.floater(it.pos.clone().setY(it.pos.y + 0.4), `+${it.def.amount}`, RES_ICON[it.def.res]);
    });
    ev.on('blueprintUnlocked', (bp, pos) => {
      this.title('NEW BLUEPRINT', BUILDINGS[bp].name, { duration: 3 });
      this.toolEls.bottle.classList.add('pulse');
      setTimeout(() => this.toolEls.bottle.classList.remove('pulse'), 8000);
    });
    ev.on('bottleArrived', () => this.toast('A message in a bottle washed ashore!', 'good'));
    ev.on('jarArrived', () => this.toast('A mysterious jar bobs in the surf…', ''));
    ev.on('jarOpened', (what, pos) => {
      const msg = { treasure: 'Treasure!', shells: 'Shells, shells, shells!', friend: 'A sandling was napping inside!', crab: 'IT WAS A TRAP' }[what];
      this.floater(pos.clone().setY(pos.y + 1), msg);
    });
    ev.on('unitTrained', (u) => this.floater(u.pos.clone().setY(u.pos.y + 1.4), `${u.def.name} ready!`));
    ev.on('possessed', (u) => {
      this.possessHint.innerHTML = u.type === 'dragon'
        ? `<b>${u.name}</b> <kbd>WASD</kbd> fly · <kbd>Mouse</kbd> look · <kbd>Hold LMB</kbd> breathe fire · <kbd>Space</kbd>/<kbd>C</kbd> up/down · <kbd>Esc</kbd> leave`
        : `<b>${u.name}</b> <kbd>WASD</kbd> move · <kbd>Mouse</kbd> look · <kbd>LMB</kbd> ${u.def.ranged ? 'shoot' : 'strike'} · <kbd>RMB</kbd> grab/throw · <kbd>Space</kbd> jump · <kbd>Esc</kbd> leave`;
      this.possessHint.classList.remove('hidden');
      this.crosshair.classList.toggle('hidden', !u.def.ranged);
      this.belt.classList.add('hidden');
      this.closeBlueprints();
      this.closeInspect();
    });
    ev.on('unpossessed', () => {
      this.possessHint.classList.add('hidden');
      this.crosshair.classList.add('hidden');
      this.belt.classList.remove('hidden');
    });
    ev.on('pause', (p) => {
      if (p) this._overlay(`<h1>Paused</h1><p class="hand">The tide politely waits.</p><div class="btns"><button class="btn" data-a="resume">Resume</button><button class="btn ghost" data-a="help">How to play</button></div>`, { resume: () => game.togglePause(false), help: () => this.showHelp() });
      else this._closeOverlay();
    });
    ev.on('gameover', (stats) => this._gameOver(stats));
    ev.on('kingDied', () => this.title('THE KING HAS FALLEN', 'the ring rolls into the surf…', { duration: 4, danger: true }));
    ev.on('phase', () => this._updateTide());
    // little bits of life
    ev.on('chatter', (u) => { if (Math.random() < 0.6) this.say(u, pick(['♪', '!', '?', '♥', '…', 'ha!', 'ooh', '♪♪', 'heh']), { small: true, silent: true, duration: 1.6, lift: 0.35 }); });
    ev.on('panic', (u) => { if (Math.random() < 0.5) this.say(u, pick(['!', '!!', 'eek!', 'AAH']), { small: true, silent: true, duration: 1.2, lift: 0.35 }); });
    ev.on('crabThrow', (c, u) => this.say(u, pick(['wheee!', 'AAAH!', 'nooo!']), { small: true, silent: true, duration: 1.4, lift: 0.35 }));
    ev.on('swept', (u) => this.say(u, pick(['blub!', 'help!', 'glub glub']), { small: true, silent: true, duration: 1.4, lift: 0.35 }));
    ev.on('groupLift', (it) => { const u = it.carriers[0]; if (u) this.say(u, pick(['hup!', 'heave!', 'together!']), { small: true, silent: true, duration: 1.2, lift: 0.35 }); });
    ev.on('waveCleared', () => {
      for (const u of this.game.units) if (u.alive && !u.hidden && Math.random() < 0.3) setTimeout(() => this.say(u, pick(['yay!', 'woo!', 'hooray!', '♪', 'we did it!']), { small: true, silent: true, duration: 1.8, lift: 0.35 }), Math.random() * 2000);
    });
  }

  // ---- HUD ------------------------------------------------------------------------------
  _updateRes(res, k, n, at) {
    for (const key in this.resEls) {
      const el = this.resEls[key];
      const v = res[key] || 0;
      const span = el.firstElementChild.nextElementSibling;
      if (span.textContent !== String(v)) {
        span.textContent = v;
        el.classList.toggle('zero', v === 0);
        el.classList.remove('bump', 'pop'); void el.offsetWidth; el.classList.add(key === k ? 'pop' : 'bump');
      }
    }
  }

  _updateTools(t) {
    for (const id in this.toolEls) this.toolEls[id].classList.toggle('active', id === t || (t === 'build' && id === 'bottle'));
    if (t !== 'build') this.placeInfo.classList.add('hidden');
  }

  _updateTide() {
    const d = this.game.director;
    const tide = this.tide;
    if (d.phase === 'battle') {
      tide.classList.add('battle');
      const n = this.game.enemies.filter((e) => e.alive && e.type !== 'krakenArm').length + d.spawnQueue.reduce((a, g) => a + g.types.length, 0);
      tide.innerHTML = `<i>${ICONS.crab}</i><span>Wave <b>${d.wave}</b> · <b>${n}</b> left</span>`;
    } else {
      tide.classList.remove('battle');
      const t = Math.ceil(d.timeToRise);
      const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
      const label = d.phase === 'receding' ? 'The tide retreats' : d.phase === 'warning' ? 'The sea rises in' : 'Calm seas';
      tide.innerHTML = `<i>${ICONS.wave}</i><span>${label}${d.phase === 'receding' ? '' : ` · <b>${mm}:${ss}</b>`}</span>`;
    }
  }

  _placeInfo(info) {
    const el = this.placeInfo;
    if (!info) { el.classList.add('hidden'); return; }
    const def = BUILDINGS[info.type];
    const cost = {};
    for (const k in info.cost) cost[k] = info.cost[k] * info.count;
    el.classList.remove('hidden');
    el.innerHTML = `<b>${def.name}${info.count > 1 ? ' ×' + info.count : ''}</b> ${costHTML(cost, this.game.economy)}
      ${info.ok === false ? `<span class="why">${info.reason}</span>` : ''}
      <span>${def.line ? 'drag to draw' : '<kbd>R</kbd> rotate'} · <kbd>Esc</kbd> cancel</span>`;
  }

  // ---- blueprints ---------------------------------------------------------------------
  toggleBlueprints() {
    if (this.blueprintsOpen) this.closeBlueprints(); else this.openBlueprints();
  }

  openBlueprints() {
    const game = this.game;
    this.blueprintsOpen = true;
    this.closeInspect();
    this.bottles.innerHTML = '';
    const eco = game.economy;
    BLUEPRINT_ORDER.forEach((type, i) => {
      const def = BUILDINGS[type];
      const unlocked = eco.unlocked.has(type);
      const el = h('div', 'bottle' + (unlocked ? '' : ' locked'), `<div class="glass">${unlocked ? ICONS.bottle : bottleLocked()}</div><div class="lbl">${unlocked ? def.short : '?'}</div>`);
      el.style.transitionDelay = `${i * 0.035}s`;
      el.addEventListener('pointerenter', () => this._showScroll(type, unlocked));
      el.addEventListener('pointerleave', () => this.scroll.classList.remove('on'));
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!unlocked) { this.toast('This blueprint is still lost at sea', 'warn'); return; }
        el.classList.add('uncork');
        game.events.emit('uncork');
        setTimeout(() => {
          this.closeBlueprints();
          game.interaction.startPlacement(type);
          game.events.emit('placementStart', type);
        }, 260);
      });
      this.bottles.appendChild(el);
    });
    requestAnimationFrame(() => this.bottles.classList.add('open'));
    this.bottles.classList.add('ui-pe');
    this.toolEls.bottle.classList.add('active');
    this.toolEls.bottle.classList.remove('pulse');
    game.events.emit('blueprintsOpened');
  }

  closeBlueprints() {
    this.blueprintsOpen = false;
    this.bottles.classList.remove('open', 'ui-pe');
    this.scroll.classList.remove('on');
    this.game.input.overUI = false;
    if (this.game.interaction.tool !== 'build') this.toolEls.bottle.classList.remove('active');
  }

  _showScroll(type, unlocked) {
    const def = BUILDINGS[type];
    const img = unlocked ? blueprintImage(this.game.engine.renderer, type) : null;
    this.scroll.innerHTML = unlocked
      ? `<h3>${def.name}</h3><img src="${img}" alt=""><p>${def.desc}</p><div class="costs">${costHTML(def.cost, this.game.economy)}</div>`
      : `<h3>Lost at sea…</h3><p>This blueprint hasn't washed ashore yet. Survive the tides — the sea returns what it takes.</p>`;
    this.scroll.classList.add('on');
  }

  // ---- inspection -----------------------------------------------------------------------
  inspect(b) {
    const game = this.game;
    if (!b || !b.alive) return;
    if (this.inspected === b) { this.closeInspect(); return; }
    this.closeInspect(true);
    this.closeBlueprints();
    this.inspected = b;
    b.liftTarget = 1;
    const cut = { keep: 1.85, house: 0.95, barracks: 1.15, tower: 1.4, shelter: 1.0, roost: 1.6 }[b.type];
    if (cut) {
      b.sandMat.side = THREE.DoubleSide;
      b.sandMat.needsUpdate = true;
      b.sandMat.userData.u.uCutY.value = b.baseY + cut;
      // windows and pressed shells above the cut would float: tuck them away
      const mats = game.buildings.mats;
      this._cutHidden = b.details.children.filter((m) => m.isMesh && (m.material === mats.dark || m.material === mats.shell));
      for (const m of this._cutHidden) m.visible = false;
    }
    this._prevCam = { goal: game.rig.goal.clone(), dist: game.rig.goalDist };
    game.rig.mode = 'inspect';
    game.rig.goal.set(b.pos.x, b.baseY + b.height * 0.35, b.pos.z);
    game.rig.goalDist = clamp(b.radius * 3.2 + 3.5, 6, 20);
    // look down into cut-open rooms; peek at open-air ones from the side
    game.rig.goalPitchOffset = cut ? 0.5 : 0.18;
    game.interaction.clearSelection();
    this._spawnPuppets(b);
    this._renderInspect();
    this.inspectEl.classList.add('on');
    game.events.emit('inspectOpen', b);
  }

  closeInspect(silent) {
    const game = this.game;
    const b = this.inspected;
    if (!b) return;
    b.liftTarget = 0;
    if (b.sandMat.userData.u.uCutY.value < 1e4) {
      b.sandMat.userData.u.uCutY.value = 1e5;
      b.sandMat.side = THREE.FrontSide;
      b.sandMat.needsUpdate = true;
      for (const m of this._cutHidden || []) m.visible = true;
      this._cutHidden = null;
    }
    this.inspected = null;
    this.inspectEl.classList.remove('on');
    game.input.overUI = false;
    this._clearPuppets();
    if (game.rig.mode === 'inspect') {
      game.rig.mode = 'rts';
      game.rig.goalPitchOffset = 0;
      if (this._prevCam && !silent) game.rig.goalDist = Math.max(this._prevCam.dist, 18);
    }
  }

  _spawnPuppets(b) {
    // little residents doing their thing inside (only while you peek in)
    const game = this.game;
    const slot = b.model.slots.interior;
    if (!slot) return;
    const residents = game.units.filter((u) => u.home === b && u.alive && !u.puppet).slice(0, 4);
    const n = Math.max(residents.length, b.type === 'keep' ? 2 : 1);
    this.puppets = [];
    for (let i = 0; i < Math.min(n, 4); i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      const p = b.worldPoint(slot.x + Math.cos(a) * slot.r * 0.6, slot.z + Math.sin(a) * slot.r * 0.6);
      const src = residents[i];
      const type = src ? src.type : b.type === 'barracks' ? 'knight' : 'worker';
      const u = game.spawnUnit(type, p.x, p.z, { yaw: rnd(0, 6.28), name: src ? src.name : undefined });
      u.puppet = true;
      if (src) { u.color = src.color; u.hatColor = src.hatColor; }
      const y = b.baseY + (slot.y || 0.2);
      u.pos.y = y;
      for (const pi of u.p) if (pi >= 0) { game.verlet.teleport(pi, p.x, y + 0.5, p.z); game.verlet.flags[pi] |= 32; game.verlet.flags[pi] &= ~2; }
      const night = game.sky.isNight;
      const act = night || b.type === 'house' ? 'sleep' : b.type === 'barracks' ? 'attack' : b.type === 'camp' ? 'talk' : pick(['talk', 'idle', 'wave']);
      u.sit = null;
      u.perch = { x: p.x, y, z: p.z };
      if (act === 'sleep') u.sleep = true;
      else if (act === 'attack') u.puppetAttack = true;
      else u.setAnim(act);
      u.lookAt = new THREE.Vector3(b.pos.x, 0, b.pos.z);
      this.puppets.push(u);
    }
  }

  _clearPuppets() {
    if (!this.puppets) return;
    for (const u of this.puppets) {
      u.destroyBody();
      u.alive = false;
      u.crumbled = true;
    }
    this.puppets = [];
  }

  _renderInspect() {
    const game = this.game;
    const b = this.inspected;
    if (!b) return;
    const def = b.def;
    const eco = game.economy;
    let html = `<button class="close" data-a="close">×</button><h2>${def.name}</h2>`;
    html += `<div class="stars">${[1, 2, 3].map((l) => `<i class="${l <= b.level ? '' : 'dim'}">${ICONS.star}</i>`).join('')}</div>`;
    html += `<div class="desc">${def.desc}</div>`;
    if (b.state === 'site') {
      const mat = b.toDeliver ? b.delivered / b.toDeliver : 1;
      html += `<div class="row"><span>Materials delivered</span><span data-k="mat">${Math.round(mat * 100)}%</span></div><div class="bar"><span data-k="matbar" style="width:${mat * 100}%"></span></div>`;
      html += `<div class="row"><span>Construction</span><span data-k="prog">${Math.round(b.progress * 100)}%</span></div><div class="bar"><span data-k="progbar" style="width:${b.progress * 100}%"></span></div>`;
      html += `<div class="row"><span>Builders</span><span data-k="workers">${b.workers.size}</span></div>`;
    } else {
      const hp = b.hp / b.maxHp;
      html += `<div class="row"><span>Sturdiness</span><span data-k="hp">${Math.ceil(b.hp)} / ${b.maxHp}</span></div><div class="bar hp${hp < 0.35 ? ' low' : ''}"><span data-k="hpbar" style="width:${hp * 100}%"></span></div>`;
      if (b.wet > 0.1) html += `<div class="row"><span>Soaked</span><span>${Math.round(b.wet * 100)}%</span></div>`;
    }
    const residents = game.units.filter((u) => u.home === b && u.alive && !u.puppet);
    if (def.pop) {
      html += `<h4>Residents (${residents.length}/${def.pop + (b.level - 1) * 2})</h4><div class="people">${residents.map((u) => `<span class="person">${u.name}</span>`).join('') || '<span class="person">nobody yet</span>'}</div>`;
    }
    if (b.garrison && b.garrison.length) html += `<h4>Garrison</h4><div class="people">${b.garrison.map((u) => `<span class="person">${u.name}</span>`).join('')}</div>`;
    const actions = [];
    if (b.state === 'built' && def.trains) {
      for (const t of def.trains) {
        const ud = UNIT_TYPES[t];
        if (!ud) continue;
        actions.push({ a: 'train:' + t, label: `Train ${ud.name}`, cost: ud.cost, ok: eco.canAfford(ud.cost) && eco.pop < eco.popCap });
      }
    }
    if (b.state === 'built' && b.level < 3 && b.type !== 'bucket') actions.push({ a: 'upgrade', label: `Upgrade to level ${b.level + 1}`, cost: b.upgradeCost(), ok: eco.canAfford(b.upgradeCost()) });
    if (b.type === 'keep') {
      for (const [k, t] of Object.entries(TECHS)) {
        if (eco.tech[k]) continue;
        actions.push({ a: 'tech:' + k, label: `${t.name}<br><small style="font-weight:500;opacity:.75">${t.desc}</small>`, cost: t.cost, ok: eco.canAfford(t.cost) });
      }
    }
    if (b.type !== 'keep') actions.push({ a: 'demolish', label: b.state === 'site' ? 'Cancel construction' : 'Knock it down', cost: {}, ok: true });
    if (b.queue.length) html += `<h4>Training</h4><div class="queue" data-k="queue">${b.queue.map((q) => UNIT_TYPES[q.type].name).join(', ')}</div>`;
    if (actions.length) {
      html += `<div class="actions">${actions.map((x) => `<button class="act${x.ok ? '' : ' disabled'}" data-a="${x.a}"><span>${x.label}</span><span class="costs">${costHTML(x.cost, eco)}</span></button>`).join('')}</div>`;
    }
    if (def.pop && eco.pop >= eco.popCap) html += `<p class="desc" style="font-size:16px;margin-top:8px">All beds are taken — build more huts to grow the kingdom.</p>`;
    this.inspectEl.innerHTML = html;
    this.inspectEl.querySelectorAll('[data-a]').forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._inspectAction(btn.dataset.a);
      game.events.emit('uiClick');
    }));
  }

  _inspectAction(a) {
    const game = this.game;
    const b = this.inspected;
    if (!b) return;
    if (a === 'close') { this.closeInspect(); return; }
    if (a.startsWith('train:')) {
      const r = b.train(a.slice(6));
      if (!r.ok) this.toast(r.reason, 'warn'); else this.toast(`Training a ${UNIT_TYPES[a.slice(6)].name}…`, 'good');
    } else if (a === 'upgrade') {
      if (!b.upgrade()) this.toast('Not enough resources', 'warn');
    } else if (a.startsWith('tech:')) {
      const k = a.slice(5);
      const t = TECHS[k];
      if (game.economy.spend(t.cost)) {
        game.economy.tech[k] = true;
        this.title(t.name.toUpperCase(), t.desc, { duration: 2.6 });
        game.events.emit('tech', k);
      } else this.toast('Not enough resources', 'warn');
    } else if (a === 'demolish') {
      if (b.state === 'site') game.economy.refund(b.def.cost, 0.8);
      else game.economy.refund(b.def.cost, 0.3);
      b.collapse('demolish');
      this.closeInspect();
      return;
    }
    this._renderInspect();
  }

  _tickInspect() {
    const b = this.inspected;
    if (!b) return;
    if (!b.alive) { this.closeInspect(); return; }
    // refresh live numbers
    const q = (k) => this.inspectEl.querySelector(`[data-k="${k}"]`);
    if (b.state === 'site') {
      const mat = b.toDeliver ? b.delivered / b.toDeliver : 1;
      const m = q('mat'); if (m) m.textContent = Math.round(mat * 100) + '%';
      const mb = q('matbar'); if (mb) mb.style.width = mat * 100 + '%';
      const p = q('prog'); if (p) p.textContent = Math.round(b.progress * 100) + '%';
      const pb = q('progbar'); if (pb) pb.style.width = b.progress * 100 + '%';
      const w = q('workers'); if (w) w.textContent = b.workers.size;
      if (b._wasSite === undefined) b._wasSite = true;
    } else {
      if (b._wasSite) { b._wasSite = false; this._renderInspect(); return; }
      const hp = q('hp'); if (hp) hp.textContent = `${Math.ceil(b.hp)} / ${b.maxHp}`;
      const hb = q('hpbar'); if (hb) hb.style.width = (b.hp / b.maxHp) * 100 + '%';
    }
    this._inspectT = (this._inspectT || 0) + 1;
    if (this._inspectT % 90 === 0) this._renderInspect();
  }

  // ---- floating text ----------------------------------------------------------------------
  anchor(el, getPos, opts = {}) {
    const a = { el, getPos, life: opts.life ?? Infinity, offsetY: opts.offsetY || 0, born: performance.now() };
    const wrap = h('div', 'anchor');
    wrap.appendChild(el);
    a.wrap = wrap;
    this.world.appendChild(wrap);
    this.anchors.push(a);
    return a;
  }

  removeAnchor(a, fade = true) {
    if (!a || a.dead) return;
    a.dead = true;
    if (fade && a.el.classList.contains('bubble')) {
      a.el.classList.add('out');
      setTimeout(() => a.wrap.remove(), 300);
    } else a.wrap.remove();
    this.anchors = this.anchors.filter((x) => x !== a);
  }

  // Speech bubble above an entity (letters pop in one by one).
  say(entity, text, opts = {}) {
    if (!entity) return null;
    if (entity._bubble) this.removeAnchor(entity._bubble);
    const cls = 'bubble' + (opts.king ? ' king' : '') + (opts.shout ? ' shout' : '') + (opts.small ? ' small' : '');
    const el = h('div', cls);
    if (opts.who) el.appendChild(h('span', 'who', opts.who));
    const body = h('span', 'txt');
    const chars = [...text];
    const speed = opts.speed || (opts.shout ? 0.045 : 0.028);
    popLetters(body, text, speed);
    el.appendChild(body);
    const dur = opts.duration ?? Math.max(2.2, chars.length * 0.065 + 1.6);
    const head = new THREE.Vector3();
    const a = this.anchor(el, () => (entity.headPos ? entity.headPos(head) : entity.pos).clone().add(new THREE.Vector3(0, (opts.lift ?? 0.45) * (entity.scale || 1), 0)), { life: dur });
    entity._bubble = a;
    if (!opts.silent) this.game.events.emit('say', entity, text, opts);
    return a;
  }

  floater(pos, text, icon) {
    const el = h('div', 'floater', `${icon ? `<i>${ICONS[icon]}</i>` : ''}${text}`);
    const p = pos.clone();
    this.anchor(el, () => p, { life: 1.4 });
  }

  title(text, sub = '', opts = {}) {
    if (this._title) { const old = this._title; old.classList.add('out'); setTimeout(() => old.remove(), 700); }
    const card = h('div', 'title-card' + (opts.danger ? ' danger' : '') + (opts.boss ? ' boss' : ''));
    const t = h('div', 't');
    popLetters(t, text, 0.04);
    card.appendChild(t);
    if (sub) card.appendChild(h('div', 's', sub));
    this.titles.appendChild(card);
    this._title = card;
    this.game.events.emit('title', text, opts);
    setTimeout(() => {
      card.classList.add('out');
      setTimeout(() => card.remove(), 700);
      if (this._title === card) this._title = null;
    }, (opts.duration || 2.5) * 1000);
  }

  // A huge spoken line in floating typography (used for dramatic declarations).
  shout(text, duration = 3) {
    const card = h('div', 'title-card shout-line');
    const t = h('div', 't');
    [...text].forEach((c, i) => {
      const s = h('span', 'ch');
      s.textContent = c;
      s.style.animationDelay = `${i * 0.035}s`;
      t.appendChild(s);
    });
    card.appendChild(t);
    this.titles.appendChild(card);
    setTimeout(() => { card.classList.add('out'); setTimeout(() => card.remove(), 700); }, duration * 1000);
  }

  toast(text, kind = '') {
    const el = h('div', 'toast ' + kind, text);
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => el.remove(), 3100);
  }

  // ---- cinematic layer (used by the intro) ------------------------------------------------
  letterbox(on) { this.cine.classList.toggle('on', on); }
  subtitle(text) {
    if (!text) { this.cineSub.classList.remove('on'); return; }
    this.cineSub.textContent = text;
    this.cineSub.classList.add('on');
  }
  gameTitle(on) { this.cineTitle.classList.toggle('on', on); }

  // ---- overlays -------------------------------------------------------------------------------
  _overlay(html, actions = {}) {
    this._closeOverlay();
    const ov = h('div', 'overlay');
    const p = h('div', 'panel', html);
    ov.appendChild(p);
    ov.addEventListener('click', (e) => { if (e.target === ov && actions.backdrop) actions.backdrop(); });
    p.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.game.events.emit('uiClick'); (actions[b.dataset.a] || (() => {}))(e, b); }));
    this.root.appendChild(ov);
    this._ov = ov;
    return p;
  }

  _closeOverlay() {
    if (this._ov) { this._ov.remove(); this._ov = null; }
  }

  showHelp() {
    const wasPaused = this.game.paused;
    this.game.paused = true;
    this._overlay(`<h1>How to play</h1>
      <p class="hand">Keep the Sand King alive. Gather what the sea washes up, build, and survive the rising tide.</p>
      <div class="keys">
        <kbd>Left-drag sand</kbd><span>Grab the beach to pan · <b>Shift-drag</b> to box-select</span>
        <kbd>Hold left</kbd><span>Summon workers to a spot (longer = more)</span>
        <kbd>Drag a sandling / crab</kbd><span>Pick it up · fling it</span>
        <kbd>Click building</kbd><span>Peek inside · train · upgrade</span>
        <kbd>Right-click sandling</kbd><span>Possess it (third person)</span>
        <kbd>Right-click ground</kbd><span>Send selected troops</span>
        <kbd>Wheel · Right/middle-drag</kbd><span>Zoom · rotate camera</span>
        <kbd>WASD · Q/E</kbd><span>Pan · rotate</span>
        <kbd>1–6</kbd><span>Hand · Shovel · Bucket · Rake · Blueprints · Horn</span>
        <kbd>Shovel</kbd><span>Drag to dig trenches & moats · Shift or right-drag piles sand</span>
        <kbd>Bucket</kbd><span>Click to stamp a tower · click it again to stack</span>
        <kbd>P · Esc</kbd><span>Pause · cancel</span>
      </div>
      <p class="hand">Sand is real: dry sand slides, damp sand holds walls, waves soak, erode and wash everything away.</p>
      <div class="btns"><button class="btn" data-a="ok">Got it</button></div>`, { ok: () => { this._closeOverlay(); this.game.paused = wasPaused; } });
  }

  showSettings() {
    const game = this.game;
    const wasPaused = game.paused;
    game.paused = true;
    const q = game.engine.quality;
    const p = this._overlay(`<h1>Settings</h1>
      <label>Graphics <span class="seg">${['low', 'medium', 'high'].map((k) => `<button data-a="q:${k}" class="${q === k ? 'on' : ''}">${k}</button>`).join('')}</span></label>
      <label>Master volume <input type="range" min="0" max="1" step="0.01" value="${game.audio.master}" data-v="master"></label>
      <label>Music <input type="range" min="0" max="1" step="0.01" value="${game.audio.musicVol}" data-v="music"></label>
      <label>Effects <input type="range" min="0" max="1" step="0.01" value="${game.audio.sfxVol}" data-v="sfx"></label>
      <label>Depth of field <span class="seg"><button data-a="dof:1" class="${game.engine.dofPass.enabled ? 'on' : ''}">on</button><button data-a="dof:0" class="${game.engine.dofPass.enabled ? '' : 'on'}">off</button></span></label>
      <div class="btns"><button class="btn" data-a="ok">Done</button></div>`, {
      ok: () => { this._closeOverlay(); game.paused = wasPaused; },
      'q:low': () => { game.engine.setQuality('low'); this.showSettings(); },
      'q:medium': () => { game.engine.setQuality('medium'); this.showSettings(); },
      'q:high': () => { game.engine.setQuality('high'); this.showSettings(); },
      'dof:1': () => { game.engine.dofPass.enabled = true; this.showSettings(); },
      'dof:0': () => { game.engine.dofPass.enabled = false; this.showSettings(); },
    });
    p.querySelectorAll('input[type=range]').forEach((inp) => inp.addEventListener('input', () => game.audio.setVolume(inp.dataset.v, +inp.value)));
  }

  _gameOver(stats) {
    setTimeout(() => {
      this.showHUD(false);
      this._overlay(`<h1>The kingdom has fallen</h1>
        <p class="hand">The wedding ring sank beneath the foam. Somewhere, a crab is wearing it now.</p>
        <div class="stats">
          <span>Tides survived</span><b>${Math.max(0, stats.waves - 1)}</b>
          <span>Crabs sent back to sea</span><b>${stats.kills}</b>
          <span>Brave sandlings lost</span><b>${stats.lost}</b>
          <span>Treasures gathered</span><b>${this.game.economy.totalGathered}</b>
        </div>
        <div class="btns"><button class="btn" data-a="again">Build a new kingdom</button></div>`, { again: () => this.game.restart() });
    }, 2600);
  }

  // ---- per frame ---------------------------------------------------------------------------
  update(dt) {
    const game = this.game;
    const cam = game.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const now = performance.now();
    for (let i = this.anchors.length - 1; i >= 0; i--) {
      const a = this.anchors[i];
      if ((now - a.born) / 1000 > a.life) { this.removeAnchor(a); continue; }
      const p = a.getPos();
      if (!p) { a.wrap.style.display = 'none'; continue; }
      _v.copy(p).project(cam);
      if (_v.z > 1 || _v.x < -1.3 || _v.x > 1.3 || _v.y < -1.3 || _v.y > 1.3) { a.wrap.style.display = 'none'; continue; }
      a.wrap.style.display = '';
      const x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
      a.wrap.style.transform = `translate3d(${x.toFixed(1)}px, ${(y - a.offsetY).toFixed(1)}px, 0)`;
    }
    this._frame = (this._frame || 0) + 1;
    if (this._frame % 15 === 0) {
      const eco = game.economy;
      this.popEl.lastElementChild.textContent = `${eco.pop}/${eco.popCap}`;
      this._updateTide();
    }
    if (this.boss) {
      const f = Math.max(0, this.boss.hp / this.boss.maxHp);
      this.bossBar.querySelector('span').style.width = f * 100 + '%';
      if (!this.boss.alive) this.bossBar.classList.add('hidden');
    }
    this._tickInspect();
    this._hover();
    // sleepy residents at night
    this._zzz = (this._zzz || 0) - dt;
    if (this._zzz <= 0) {
      this._zzz = 2.2;
      if (game.sky.isNight) for (const b of game.buildings.list) if (b.alive && (b.inside || 0) > 0 && !game.director.seaRising) this.floater(b.pos.clone().setY(b.baseY + b.height + 0.3), 'z z z');
    }
    this.tutorial.update(dt);
    // puppets inside an inspected barracks swing at the training dummy
    if (this.puppets) for (const u of this.puppets) if (u.puppetAttack && Math.random() < 0.02) u.startAttack();
  }

  _hover() {
    const game = this.game;
    const hv = game.interaction.hover;
    if (!hv || game.possession.active || game.state !== 'play') { this.hoverTag.classList.add('hidden'); return; }
    const o = hv.obj;
    let html = '';
    if (hv.kind === 'unit') html = `<b>${o.name}</b> · ${o.def.name}<span class="hp"><span style="width:${(o.hp / o.maxHp) * 100}%"></span></span>`;
    else if (hv.kind === 'enemy') html = `<b>${o.def.name}</b><span class="hp"><span style="width:${(o.hp / o.maxHp) * 100}%;background:#ff8a6a"></span></span>`;
    else if (hv.kind === 'item') html = `${o.def.label}${o.def.special === 'bottle' ? ' · click to open' : o.def.special === 'jar' ? ' · click to open' : o.def.special === 'stopwatch' ? ' · the sea is coming…' : ''}`;
    else if (hv.kind === 'building') html = `<b>${o.def.name}</b> · ${o.state === 'site' ? `building ${Math.round(o.progress * 100)}%` : `${Math.ceil(o.hp)}/${o.maxHp}`}`;
    else if (hv.kind === 'boulder') html = 'Boulder · drag to move';
    this.hoverTag.innerHTML = html;
    this.hoverTag.classList.remove('hidden');
    const m = game.input.mouse;
    this.hoverTag.style.left = m.x + 'px';
    this.hoverTag.style.top = m.y + 'px';
  }
}

function bottleLocked() {
  return `<svg viewBox="0 0 48 48"><path d="M20 4 H28 V10 Q36 14 36 24 V40 Q36 44 32 44 H16 Q12 44 12 40 V24 Q12 14 20 10 Z" fill="#7aa89a" fill-opacity=".7" stroke="#3b2a1c" stroke-width="2.6" stroke-linejoin="round"/>
    <rect x="19" y="2" width="10" height="6" rx="2" fill="#6a5040" stroke="#3b2a1c" stroke-width="2.2"/>
    <text x="24" y="34" text-anchor="middle" font-family="Georgia" font-size="16" font-weight="700" fill="#fffaf0">?</text></svg>`;
}
