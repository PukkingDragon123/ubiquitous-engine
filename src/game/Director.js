// The tide director: calm building time, the stopwatch warning, the rising
// sea with crab armies and bosses, and the receding tide that leaves gifts.
import * as THREE from 'three';
import { Stopwatch } from '../entities/Stopwatch.js';
import { BLUEPRINT_ORDER, BUILDINGS } from '../buildings/buildingTypes.js';
import { rnd, pick, clamp, shuffle } from '../core/math.js';
import { CRAB_TYPES } from '../entities/Crab.js';

const WARNING = 45;

export class Director {
  constructor(game) {
    this.game = game;
    this.wave = 0;
    this.phase = 'idle';
    this.timer = 0;
    this.stopwatch = new Stopwatch(game);
    this.spawnQueue = [];
    this.washTimer = 15;
    this.pulseTimer = 20;
    this.seaRising = false;
    this.bossAlive = null;
    this.waveStartTime = 0;
    game.events.on('unitDied', (u) => {
      if (u === game.king) this._kingDied();
      else game.stats.lost++;
    });
    game.events.on('enemyDied', () => game.stats.kills++);
    game.events.on('specialDelivered', (it) => this.openSpecial(it));
    game.events.on('openSpecial', (it) => this.openSpecial(it));
  }

  start(skipIntro) {
    this.wave = 0;
    this.phase = 'calm';
    this.timer = skipIntro ? 120 : 160;
    if (this.game.params.has('fastwave')) this.timer = WARNING + 3;
    this.washTimer = 10;
    this.game.events.emit('phase', 'calm', this.timer);
  }

  get timeToRise() {
    if (this.phase === 'calm') return this.timer + WARNING;
    if (this.phase === 'warning') return this.timer;
    return 0;
  }

  debugNextWave() {
    if (this.phase === 'calm') this.timer = 1;
    else if (this.phase === 'warning') this.timer = 1;
  }

  update(dt) {
    const game = this.game;
    if (game.state !== 'play') { this.stopwatch.update(dt); return; }
    this.stopwatch.update(dt);
    switch (this.phase) {
      case 'calm':
        this.timer -= dt;
        this._calmLife(dt);
        if (this.timer <= 0) this._beginWarning();
        break;
      case 'warning':
        this.timer -= dt;
        this._calmLife(dt);
        this.stopwatch.setRemaining(Math.max(0, this.timer));
        this.game.events.emit('countdown', Math.max(0, this.timer));
        if (this.timer <= 0) this._beginRising();
        break;
      case 'battle':
        this.timer += dt;
        this._battle(dt);
        break;
      case 'receding':
        this.timer -= dt;
        if (this.timer <= 0) this._endWave();
        break;
      default: break;
    }
  }

  // ---- calm ---------------------------------------------------------------------
  _calmLife(dt) {
    const game = this.game;
    this.washTimer -= dt;
    if (this.washTimer <= 0) {
      this.washTimer = rnd(14, 24);
      const n = 2 + Math.floor(Math.random() * 3);
      const x0 = rnd(-38, 38);
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        const type = r < 0.45 ? 'shell' : r < 0.65 ? 'pebble' : r < 0.82 ? 'seaweed' : r < 0.93 ? 'driftwood' : r < 0.98 ? 'gem' : 'coin';
        game.items.washAshore(type, clamp(x0 + rnd(-6, 6), -45, 45));
      }
      game.events.emit('washUp', n);
    }
    // the odd bigger swell keeps the shoreline alive
    this.pulseTimer -= dt;
    if (this.pulseTimer <= 0) {
      this.pulseTimer = rnd(18, 32);
      game.sim.addPulse(rnd(0.22, 0.38), rnd(4, 6), rnd(-0.25, 0.25));
    }
  }

  _beginWarning() {
    const game = this.game;
    this.phase = 'warning';
    this.timer = WARNING;
    this.stopwatch.arrive(rnd(-10, 10), WARNING);
    game.events.emit('warning', WARNING, this.stopwatch);
    game.events.emit('phase', 'warning', WARNING);
  }

  // ---- the rise ------------------------------------------------------------------------
  _beginRising() {
    const game = this.game;
    this.wave++;
    game.stats.waves = this.wave;
    this.phase = 'battle';
    this.timer = 0;
    this.seaRising = true;
    this.waveStartTime = game.time;
    const n = this.wave;
    game.sim.targetSeaLevel = Math.min(0.42 + n * 0.07, 1.25);
    game.sim.targetWaveScale = Math.min(1.7 + n * 0.12, 2.8);
    this.pulseTimer = 2;
    this.stopwatch.hide();
    this.spawnQueue = this._composition(n);
    game.events.emit('waveStart', n, this.spawnQueue.some((g) => g.boss));
    game.events.emit('phase', 'battle', n);
  }

  _composition(n) {
    const groups = [];
    const boss = n % 5 === 0 || (this.game.params.has('boss') && n === 1);
    const count = Math.round(2.5 + n * 1.8 + (n > 6 ? (n - 6) * 1.5 : 0));
    const pool = ['forker'];
    if (n >= 2) pool.push('knifer', 'forker');
    if (n >= 3) pool.push('spooner');
    if (n >= 4) pool.push('hermit', 'shrimp');
    if (n >= 6) pool.push('lobster', 'spooner', 'knifer');
    if (n >= 8) pool.push('lobster', 'hermit', 'shrimp');
    const list = [];
    for (let i = 0; i < count; i++) list.push(pick(pool));
    if (n === 1) list.fill('forker');
    shuffle(list);
    const hpMul = 1 + Math.max(0, n - 3) * 0.08;
    let t = 2;
    const lanes = [rnd(-36, -10), rnd(-12, 12), rnd(10, 36)];
    while (list.length) {
      const size = Math.min(list.length, 2 + Math.floor(Math.random() * (2 + n * 0.3)));
      const x = clamp(pick(lanes) + rnd(-6, 6), -42, 42);
      groups.push({ t, types: list.splice(0, size), x, hpMul });
      t += rnd(4, 8) - Math.min(3, n * 0.2);
    }
    if (boss) {
      const forced = this.game.params.get('boss');
      const type = forced === 'kraken' || forced === 'kingcrab' ? forced : n % 10 === 0 ? 'kraken' : 'kingcrab';
      groups.splice(Math.min(2, groups.length), 0, { t: 12, types: [type], x: 0, hpMul: 1 + (n / 5 - 1) * 0.6, boss: true });
    }
    return groups;
  }

  _spawnGroup(g) {
    const game = this.game, sim = game.sim;
    for (let i = 0; i < g.types.length; i++) {
      const type = g.types[i];
      const big = type === 'kraken' || CRAB_TYPES[type].boss;
      const x = clamp(g.x + rnd(-3, 3) + i * 0.8, -44, 44);
      // find water of suitable depth
      let z = -14;
      for (let zz = -2; zz > -34; zz -= 0.4) {
        if (sim.depthAt(x, zz) > (big ? 1.6 : 0.45)) { z = zz; break; }
      }
      const c = game.enemyManager.spawn(type, x, z, { emerge: true, yaw: rnd(-0.3, 0.3), hpMul: g.hpMul });
      if (big) {
        this.bossAlive = c;
        game.events.emit('bossArrive', c);
        game.rig.addShake(0.6);
      }
    }
  }

  _battle(dt) {
    const game = this.game;
    while (this.spawnQueue.length && this.spawnQueue[0].t <= this.timer) this._spawnGroup(this.spawnQueue.shift());
    // big crashing swells
    this.pulseTimer -= dt;
    if (this.pulseTimer <= 0) {
      this.pulseTimer = rnd(5.5, 9);
      const A = Math.min(0.5 + this.wave * 0.05, 1.0) * rnd(0.8, 1.15);
      game.sim.addPulse(A, rnd(4.5, 7), rnd(-0.3, 0.3));
      game.events.emit('bigWave', A);
    }
    if (this.bossAlive && !this.bossAlive.alive) {
      game.events.emit('bossDefeated', this.bossAlive);
      game.slowmo = 2.2;
      this.bossAlive = null;
    }
    // a dying kraken still has its big moment before the tide turns
    const alive = game.enemies.some((e) => e.alive || (e.type === 'kraken' && !e.disposed));
    if (!this.spawnQueue.length && !alive && this.timer > 6) this._beginReceding();
    // don't let stragglers drag on forever: after a long battle the tide starts to fall anyway
    if (this.timer > 150 && !this.spawnQueue.length) game.sim.targetSeaLevel = 0.2;
  }

  _beginReceding() {
    const game = this.game;
    this.phase = 'receding';
    this.timer = 9;
    this.seaRising = false;
    game.sim.targetSeaLevel = 0;
    game.sim.targetWaveScale = 1;
    game.events.emit('waveCleared', this.wave);
    game.events.emit('phase', 'receding', this.wave);
    game.workerAI.celebrate(5);
    for (const u of game.units) if (u.alive && u.type !== 'worker' && u.type !== 'king' && !u.garrisoned) u.cheer = 3;
    // gifts from the sea
    const n = 8 + this.wave * 2;
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const type = r < 0.4 ? 'shell' : r < 0.6 ? 'pebble' : r < 0.75 ? 'seaweed' : r < 0.87 ? 'driftwood' : r < 0.95 ? 'gem' : 'coin';
      setTimeout(() => game.items.washAshore(type, rnd(-40, 40)), i * 250);
    }
    const next = BLUEPRINT_ORDER.find((k) => !game.economy.unlocked.has(k) && !this._bottled?.has(k));
    if (next) {
      (this._bottled || (this._bottled = new Set())).add(next);
      setTimeout(() => {
        const b = game.items.washAshore('bottle', rnd(-15, 15));
        b.payload = { blueprint: next };
        game.events.emit('bottleArrived', b);
      }, 2500);
    }
    if (this.wave >= 2 && Math.random() < 0.7) {
      setTimeout(() => { const j = game.items.washAshore('jar', rnd(-25, 25)); game.events.emit('jarArrived', j); }, 4000);
    }
  }

  _endWave() {
    this.phase = 'calm';
    this.timer = Math.max(70, 110 - this.wave * 2);
    this.game.events.emit('phase', 'calm', this.timer);
  }

  // ---- specials -------------------------------------------------------------------------
  openSpecial(it) {
    const game = this.game;
    if (!it || it.opened) return;
    it.opened = true;
    const pos = it.pos.clone();
    if (it.def.special === 'bottle') {
      const bp = it.payload?.blueprint || BLUEPRINT_ORDER.find((k) => !game.economy.unlocked.has(k));
      game.items.remove(it);
      game.particles.sparkle(pos.x, pos.y + 0.3, pos.z, 16, [0.8, 0.95, 1], 0.3, 0.16);
      if (bp) {
        game.economy.unlocked.add(bp);
        game.events.emit('blueprintUnlocked', bp, pos);
      }
    } else if (it.def.special === 'jar') {
      game.items.remove(it);
      game.particles.dust(pos.x, pos.y + 0.3, pos.z, 10, 0.6, [0.75, 0.45, 0.3]);
      game.particles.sparkle(pos.x, pos.y + 0.4, pos.z, 12, [1, 0.8, 0.4], 0.4, 0.16);
      const r = Math.random();
      let what;
      if (r < 0.35) {
        what = 'treasure';
        for (let i = 0; i < 6; i++) game.items.spawn(Math.random() < 0.5 ? 'coin' : 'gem', pos.x, pos.z, { y: pos.y + 0.4, vel: new THREE.Vector3(rnd(-2.5, 2.5), rnd(3, 6), rnd(-2.5, 2.5)) });
      } else if (r < 0.6) {
        what = 'shells';
        for (let i = 0; i < 10; i++) game.items.spawn('shell', pos.x, pos.z, { y: pos.y + 0.4, vel: new THREE.Vector3(rnd(-3, 3), rnd(3, 6), rnd(-3, 3)) });
      } else if (r < 0.82) {
        what = 'friend';
        const u = game.spawnUnit(Math.random() < 0.5 ? 'worker' : 'spearman', pos.x, pos.z);
        u.cheer = 2;
        u.home = game.keep;
      } else {
        what = 'crab';
        game.enemyManager.spawn(this.wave >= 4 ? 'lobster' : 'forker', pos.x, pos.z, { emerge: false });
      }
      game.events.emit('jarOpened', what, pos);
    }
  }

  _kingDied() {
    const game = this.game;
    game.events.emit('kingDied', game.king);
    setTimeout(() => game.gameOver(), 2500);
  }
}
