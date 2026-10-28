// Worker brains: a small job system plus idle life.
import * as THREE from 'three';
import { rnd, pick, clamp } from '../core/math.js';

const BUNDLE = 3;
const RES_ITEM = { shells: 'shell', pebbles: 'pebble', driftwood: 'driftwood', seaweed: 'seaweed', gems: 'gem', treasure: 'coin' };
const _v = new THREE.Vector3();

export class WorkerAI {
  constructor(game) {
    this.game = game;
    this.timer = 0;
    this.focus = null; // summon focus {x, z, r, until}
  }

  get workers() {
    return this.game.units.filter((u) => u.type === 'worker' && u.alive && !u.possessed && !u.puppet);
  }

  summon(x, z, count, r = 6) {
    const ws = this.workers.filter((u) => !u.hidden && u.isActive);
    ws.sort((a, b) => a.pos.distanceToSquared(_v.set(x, 0, z)) - b.pos.distanceToSquared(_v.set(x, 0, z)));
    const chosen = ws.slice(0, count);
    for (const u of chosen) {
      this._clearJob(u);
      u.job = { type: 'summoned', x: x + rnd(-1, 1), z: z + rnd(-1, 1) };
      u.focus = { x, z, r, until: this.game.time + 40 };
      u.shout = 0.5;
    }
    return chosen;
  }

  update(dt) {
    this.timer -= dt;
    const assign = this.timer <= 0;
    if (assign) this.timer = 0.35;
    for (const u of this.game.units) {
      if (u.type !== 'worker' || !u.alive || u.possessed || u.puppet) continue;
      this._tick(u, dt, assign);
    }
  }

  _clearJob(u) {
    const j = u.job;
    if (!j) return;
    if (j.item) {
      j.item.reservedBy = j.item.reservedBy.filter((w) => w !== u);
      if (u.carry === j.item) u.dropCarry();
    }
    if (j.bundle && u.carry === j.bundle) {
      // drop the bundle back on the beach as real items
      this.game.items.remove(j.bundle);
      u.carry = null;
      if (j.site) j.site.incoming = Math.max(0, j.site.incoming - j.amount);
      for (let i = 0; i < j.amount; i++) this.game.items.spawn(RES_ITEM[j.res], u.pos.x + rnd(-0.4, 0.4), u.pos.z + rnd(-0.4, 0.4));
    } else if (j.type === 'haul' && j.site && j.phase === 'fetch') {
      j.site.incoming = Math.max(0, j.site.incoming - j.amount);
    }
    if (j.site) j.site.workers.delete(u);
    u.job = null;
    u.setAnim('idle');
    u.carryMode = 'over';
  }

  _danger(u) {
    let near = null, nd = 7;
    for (const e of this.game.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z);
      if (d < nd) { nd = d; near = e; }
    }
    return near;
  }

  _tick(u, dt, assign) {
    const game = this.game;
    if (u.hidden) {
      // sleeping or sheltering inside a building
      if (u.hideUntil && game.time > u.hideUntil && !this._mustHide(u)) this._unhide(u);
      return;
    }
    if (!u.isActive) return;

    // panic when something with claws is close
    const danger = this._danger(u);
    if (danger && (!u.job || u.job.type !== 'flee')) {
      this._clearJob(u);
      const away = _v.set(u.pos.x - danger.pos.x, 0, u.pos.z - danger.pos.z).normalize();
      const keep = game.keep;
      const tx = keep && keep.alive ? keep.pos.x + rnd(-2, 2) : u.pos.x + away.x * 8;
      const tz = keep && keep.alive ? keep.pos.z + keep.radius + 2 : u.pos.z + away.z * 8;
      u.job = { type: 'flee', x: tx, z: tz, until: game.time + 4 };
      u.panic = 2;
      game.events.emit('panic', u);
    }

    if (!u.job && assign) this._assign(u);
    const j = u.job;
    if (!j) return;
    switch (j.type) {
      case 'summoned': this._summoned(u, j, dt); break;
      case 'gather': this._gather(u, j, dt); break;
      case 'haul': this._haul(u, j, dt); break;
      case 'build': this._build(u, j, dt); break;
      case 'repair': this._repair(u, j, dt); break;
      case 'flee': this._flee(u, j, dt); break;
      case 'idle': this._idle(u, j, dt); break;
      case 'chat': this._chat(u, j, dt); break;
      case 'sleep': this._sleep(u, j, dt); break;
      case 'shelter': this._shelter(u, j, dt); break;
      case 'cheer':
        u.cheer = 0.3;
        if (game.time > j.until) this._clearJob(u);
        break;
      default: this._clearJob(u);
    }
    // stuck detection: if we haven't progressed toward a target for a while, sidestep
    if (u.moveTarget) {
      const d = Math.hypot(u.moveTarget.x - u.pos.x, u.moveTarget.z - u.pos.z);
      if (u._lastD !== undefined && d > u._lastD - 0.01) u._stuck = (u._stuck || 0) + dt; else u._stuck = 0;
      u._lastD = d;
      if (u._stuck > 1.4) {
        u._stuck = 0;
        const side = Math.random() < 0.5 ? -1 : 1;
        const dx = u.moveTarget.x - u.pos.x, dz = u.moveTarget.z - u.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        j.detour = { x: u.pos.x - (dz / l) * 2.5 * side + (dx / l), z: u.pos.z + (dx / l) * 2.5 * side + (dz / l), until: game.time + 1.2 };
      }
    }
  }

  _go(u, x, z, arrive = 0.5) {
    const j = u.job;
    if (j && j.detour && this.game.time < j.detour.until) { u.moveTo(j.detour.x, j.detour.z, 0.3); return false; }
    if (j) j.detour = null;
    const d = Math.hypot(x - u.pos.x, z - u.pos.z);
    if (d <= arrive) { u.stop(); return true; }
    u.moveTo(x, z, arrive * 0.8);
    return false;
  }

  _mustHide(u) {
    const game = this.game;
    return (game.director && game.director.seaRising) || (game.sky.isNight && u.home && u.home.alive);
  }

  _hide(u, b, until) {
    u.hidden = b;
    u.hideUntil = until;
    u.stop();
    u.destroyBody();
    b.inside = (b.inside || 0) + 1;
  }

  _unhide(u) {
    const b = u.hidden;
    u.hidden = null;
    if (b) b.inside = Math.max(0, (b.inside || 1) - 1);
    const d = b && b.alive ? b.doorPoint(_v) : u.pos;
    u.pos.set(d.x + rnd(-0.3, 0.3), this.game.sim.heightAt(d.x, d.z), d.z + rnd(-0.3, 0.3));
    u._buildBody();
    u.sleep = false;
    u.job = null;
  }

  _assign(u) {
    const game = this.game;
    const fx = u.focus && game.time < u.focus.until ? u.focus : null;
    const ox = fx ? fx.x : u.pos.x, oz = fx ? fx.z : u.pos.z;
    const dist = (x, z) => Math.hypot(x - ox, z - oz);
    // shelter from the rising sea
    if (game.director && game.director.seaRising && u.wet > 0.2) {
      const sh = this._nearestShelter(u);
      if (sh) { u.job = { type: 'shelter', b: sh }; return; }
    }
    let best = null, bestScore = -Infinity;
    // construction logistics
    for (const b of game.buildings.list) {
      if (!b.alive) continue;
      if (b.needsMaterials) {
        const store = game.buildings.nearestStorage(b.pos.x, b.pos.z);
        if (!store) continue;
        const s = 60 - dist(b.pos.x, b.pos.z) * 0.8 - (fx && dist(b.pos.x, b.pos.z) > fx.r ? 30 : 0);
        if (s > bestScore) { bestScore = s; best = { type: 'haul', site: b, store }; }
      } else if (b.readyToBuild && b.workers.size < Math.min(5, 2 + Math.ceil(b.radius))) {
        const s = 70 - dist(b.pos.x, b.pos.z) * 0.8 - (fx && dist(b.pos.x, b.pos.z) > fx.r ? 30 : 0);
        if (s > bestScore) { bestScore = s; best = { type: 'build', site: b }; }
      } else if (b.damaged && b.workers.size < 2 && !this._enemiesNear(b.pos, 8)) {
        const s = 40 - dist(b.pos.x, b.pos.z) * 0.8;
        if (s > bestScore) { bestScore = s; best = { type: 'repair', site: b }; }
      }
    }
    // gathering
    const item = game.items.nearest(ox, oz, (it) => {
      if (it.carried || it.held || it.def.special === 'stopwatch') return false;
      if (it.reservedBy.length >= it.needed) return false;
      if (game.sim.depthAt(it.pos.x, it.pos.z) > 0.35) return false;
      return true;
    }, fx ? fx.r + 6 : 34);
    if (item) {
      const s = 45 - dist(item.pos.x, item.pos.z) * 1.0 + (item.reservedBy.length ? 25 : 0) + (item.def.special ? 15 : 0);
      if (s > bestScore) { bestScore = s; best = { type: 'gather', item }; }
    }
    if (best) {
      if (best.type === 'haul') {
        const site = best.site;
        const remaining = site.toDeliver - site.delivered - site.incoming;
        const amount = Math.min(BUNDLE, remaining);
        // pick a resource still owed (proportional to cost)
        const keys = Object.keys(site.def.cost);
        const res = pick(keys);
        site.incoming += amount;
        u.job = { type: 'haul', site, store: best.store, amount, res, phase: 'fetch' };
        site.workers.add(u);
      } else if (best.type === 'build' || best.type === 'repair') {
        best.site.workers.add(u);
        u.job = { ...best, slot: best.site.workers.size };
      } else if (best.type === 'gather') {
        best.item.reservedBy.push(u);
        u.job = { type: 'gather', item: best.item, phase: 'go' };
      }
      return;
    }
    // nothing to do: night → go home to sleep
    if (game.sky.isNight && u.home && u.home.alive && u.home.state === 'built') {
      u.job = { type: 'sleep', b: u.home };
      return;
    }
    // idle life
    if (!u.job) this._startIdle(u);
  }

  _enemiesNear(p, r) {
    for (const e of this.game.enemies) if (e.alive && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < r) return true;
    return false;
  }

  _nearestShelter(u) {
    let best = null, bd = Infinity;
    for (const b of this.game.buildings.list) {
      if (!b.alive || b.state !== 'built') continue;
      const cap = b.def.shelter || (b.type === 'keep' ? 6 : b.type === 'house' || b.type === 'camp' ? 3 : 0);
      if (!cap || (b.inside || 0) >= cap) continue;
      const d = Math.hypot(b.pos.x - u.pos.x, b.pos.z - u.pos.z) - (b.def.shelter ? 10 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // ---- job handlers ------------------------------------------------------------
  _summoned(u, j) {
    if (this._go(u, j.x, j.z, 0.8)) {
      u.job = null;
      u.lookAt = null;
    }
  }

  _gather(u, j, dt) {
    const it = j.item;
    const game = this.game;
    if (!it.alive || (it.carried && !it.carriers.includes(u))) { this._clearJob(u); return; }
    if (j.phase === 'go') {
      if (this._go(u, it.pos.x, it.pos.z, it.heavy ? 0.85 : 0.55)) {
        if (it.heavy) {
          j.phase = 'wait';
          j.waitT = 0;
        } else {
          j.phase = 'pickup';
          u.setAnim('gather');
          j.t = 0;
        }
      }
    } else if (j.phase === 'wait') {
      // heavy: wait for a partner, then lift together
      u.lookAt = it.pos;
      j.waitT += dt;
      const ready = it.reservedBy.filter((w) => w.job && w.job.item === it && (w.job.phase === 'wait' || w.job.phase === 'carry'));
      if (ready.length >= it.needed) {
        const store = game.buildings.nearestStorage(it.pos.x, it.pos.z);
        if (!store) { this._clearJob(u); return; }
        for (const w of ready) {
          if (w.job.phase === 'carry') continue;
          w.job.phase = 'carry';
          w.carry = it;
          w.carryMode = 'front';
          if (!it.carriers.includes(w)) it.carriers.push(w);
          w.job.store = store;
          w.shout = 0.4;
        }
        game.events.emit('groupLift', it);
      } else if (j.waitT > 14) {
        this._clearJob(u);
      }
    } else if (j.phase === 'pickup') {
      j.t += dt;
      if (j.t > 0.55) {
        u.setAnim('idle');
        if (it.carried) { this._clearJob(u); return; }
        it.carriers = [u];
        u.carry = it;
        u.carryMode = 'over';
        j.phase = 'carry';
        j.store = game.buildings.nearestStorage(u.pos.x, u.pos.z);
        game.events.emit('pickup', u, it);
        if (it.def.special === 'bottle' || it.def.special === 'jar') game.events.emit('specialFound', it, u);
      }
    } else if (j.phase === 'carry') {
      const store = j.store && j.store.alive ? j.store : game.buildings.nearestStorage(u.pos.x, u.pos.z);
      if (!store) { this._clearJob(u); return; }
      j.store = store;
      const drop = store.slot('storage') || store.doorPoint(_v);
      let tx = drop.x, tz = drop.z;
      if (it.heavy && it.carriers.length > 1) {
        // walk side by side
        const idx = it.carriers.indexOf(u);
        const dx = tx - it.pos.x, dz = tz - it.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        const side = idx === 0 ? 1 : -1;
        tx += (-dz / l) * 0.45 * side; tz += (dx / l) * 0.45 * side;
        // carriers who fall behind wait; the leader slows
        const other = it.carriers[1 - idx];
        if (other && other.pos.distanceTo(u.pos) > 1.6) u.speedMul = 0.4; else u.speedMul = game.economy.tech.boots ? 1.25 : 1;
      }
      if (this._go(u, tx, tz, 1.0)) {
        if (it.heavy && it.carriers.length > 1 && it.carriers.some((w) => w !== u && w.pos.distanceTo(_v.set(tx, 0, tz)) > 2.2)) return;
        this._deliver(u, it, store);
      }
    }
  }

  _deliver(u, it, store) {
    const game = this.game;
    const carriers = it.carriers.slice();
    if (it.def.res) {
      game.economy.add(it.def.res, it.def.amount, it.pos.clone());
      game.events.emit('delivered', u, it, store);
    } else if (it.def.special) {
      game.events.emit('specialDelivered', it, u, store);
    }
    game.items.remove(it);
    for (const w of carriers) {
      w.carry = null;
      w.carryMode = 'over';
      w.speedMul = game.economy.tech.boots ? 1.25 : 1;
      if (w.job && w.job.item === it) w.job = null;
    }
    u.job = null;
  }

  _haul(u, j, dt) {
    const game = this.game;
    const site = j.site;
    if (!site.alive || site.state !== 'site') { this._clearJob(u); return; }
    if (j.phase === 'fetch') {
      const store = j.store.alive ? j.store : game.buildings.nearestStorage(u.pos.x, u.pos.z);
      if (!store) { this._clearJob(u); return; }
      const p = store.slot('storage') || store.doorPoint(_v);
      if (this._go(u, p.x, p.z, 1.0)) {
        j.phase = 'grab';
        j.t = 0;
        u.setAnim('gather');
      }
    } else if (j.phase === 'grab') {
      j.t += dt;
      if (j.t > 0.5) {
        u.setAnim('idle');
        const type = RES_ITEM[j.res] || 'shell';
        const bundle = game.items.spawn(type === 'driftwood' ? 'driftwood' : type, u.pos.x, u.pos.z);
        bundle.bundle = true;
        if (type === 'driftwood') { bundle.def = { ...bundle.def, heavy: false, carriers: 1, size: 0.75 }; }
        bundle.carriers = [u];
        u.carry = bundle;
        u.carryMode = 'over';
        j.bundle = bundle;
        j.phase = 'carry';
      }
    } else if (j.phase === 'carry') {
      const spot = site.workSpot(u.id % 6, 6, _v);
      if (this._go(u, spot.x, spot.z, 0.7)) {
        game.items.remove(j.bundle);
        u.carry = null;
        site.incoming = Math.max(0, site.incoming - j.amount);
        site.delivered = Math.min(site.toDeliver, site.delivered + j.amount);
        game.particles.dust(spot.x, site.baseY + 0.2, spot.z, 3, 0.4);
        game.events.emit('materialsDelivered', site, u);
        site.workers.delete(u);
        u.job = null;
      }
    }
  }

  _build(u, j, dt) {
    const site = j.site;
    if (!site.alive || site.state !== 'site') { this._clearJob(u); return; }
    const spot = site.workSpot(j.slot, Math.max(3, site.workers.size), _v);
    if (this._go(u, spot.x, spot.z, 0.5)) {
      u.lookAt = site.pos;
      u.setAnim('build');
      site.addWork(dt * (this.game.economy.tech.boots ? 1.1 : 1));
      if (Math.random() < dt * 3) this.game.particles.dust(u.pos.x + Math.sin(u.yaw) * 0.4, site.baseY + 0.25, u.pos.z + Math.cos(u.yaw) * 0.4, 1, 0.35);
      if (Math.random() < dt * 2) this.game.events.emit('buildTap', u, site);
    } else {
      u.setAnim('idle');
    }
  }

  _repair(u, j, dt) {
    const b = j.site;
    if (!b.alive || b.hp >= b.maxHp || this._enemiesNear(b.pos, 6)) { this._clearJob(u); return; }
    const spot = b.workSpot(j.slot, 3, _v);
    if (this._go(u, spot.x, spot.z, 0.5)) {
      u.lookAt = b.pos;
      u.setAnim('build');
      b.repair(dt * 9);
      if (Math.random() < dt * 2) this.game.events.emit('buildTap', u, b);
    }
  }

  _flee(u, j) {
    u.panic = Math.max(u.panic, 0.5);
    this._go(u, j.x, j.z, 1.2);
    if (this.game.time > j.until && !this._danger(u)) this._clearJob(u);
  }

  _shelter(u, j) {
    const b = j.b;
    if (!b.alive) { this._clearJob(u); return; }
    const d = b.doorPoint(_v);
    if (this._go(u, d.x, d.z, 0.7)) {
      this._hide(u, b, this.game.time + 5);
      u.job = null;
    }
  }

  _sleep(u, j) {
    const b = j.b;
    if (!b.alive || !this.game.sky.isNight) { this._clearJob(u); return; }
    const d = b.doorPoint(_v);
    if (this._go(u, d.x, d.z, 0.7)) {
      u.sleep = true;
      this._hide(u, b, this.game.time + 8);
      u.job = null;
    }
  }

  _startIdle(u) {
    const game = this.game;
    // chat with a nearby idle friend
    if (Math.random() < 0.3) {
      const friend = game.units.find((o) => o !== u && o.type === 'worker' && o.alive && !o.hidden && o.isActive && (!o.job || o.job.type === 'idle') && o.pos.distanceTo(u.pos) < 6);
      if (friend) {
        const mx = (u.pos.x + friend.pos.x) / 2, mz = (u.pos.z + friend.pos.z) / 2;
        const until = game.time + rnd(4, 8);
        u.job = { type: 'chat', other: friend, x: mx + 0.45, z: mz, until };
        friend.job = { type: 'chat', other: u, x: mx - 0.45, z: mz, until };
        return;
      }
    }
    const home = u.home && u.home.alive ? u.home : game.keep;
    const cx = home ? home.pos.x : u.pos.x, cz = home ? home.pos.z : u.pos.z;
    const r = home ? home.radius + 2.5 : 4;
    const a = Math.random() * Math.PI * 2;
    u.job = { type: 'idle', x: cx + Math.cos(a) * r * rnd(0.8, 1.6), z: cz + Math.sin(a) * r * rnd(0.8, 1.6), until: game.time + rnd(3, 8) };
  }

  _idle(u, j) {
    const arrived = this._go(u, j.x, j.z, 0.6);
    if (arrived && Math.random() < 0.005) u.setAnim(pick(['idle', 'wave', 'idle']));
    if (this.game.time > j.until) { u.setAnim('idle'); u.job = null; }
  }

  _chat(u, j) {
    const o = j.other;
    if (!o.alive || !o.job || o.job.type !== 'chat') { u.setAnim('idle'); u.job = null; return; }
    if (this._go(u, j.x, j.z, 0.35)) {
      u.lookAt = o.pos;
      u.setAnim('talk');
      if (Math.random() < 0.012) this.game.events.emit('chatter', u);
    }
    if (this.game.time > j.until) { u.setAnim('idle'); u.lookAt = null; u.job = null; }
  }

  celebrate(duration = 4) {
    for (const u of this.workers) {
      if (u.hidden || !u.isActive) continue;
      if (u.job && (u.job.type === 'gather' || u.job.type === 'haul') && u.carry) continue;
      this._clearJob(u);
      u.job = { type: 'cheer', until: this.game.time + rnd(duration * 0.6, duration) };
    }
  }
}
