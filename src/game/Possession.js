// Possession: right-click a sandling to take control in third person.
// WASD move · mouse look · LMB attack/shoot · RMB grab & throw · Space jump ·
// Shift sprint · Esc to leave.
import * as THREE from 'three';
import { clamp, rnd } from '../core/math.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class Possession {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.unit = null;
    this.held = null;
    this.mouseL = false;
    this.mouseR = false;
    game.events.on('possess', (u) => this.possess(u));
    game.input.on((type, e) => {
      if (!this.active) return;
      if (type === 'down') {
        if (e.button === 0) this._attack();
        if (e.button === 2) this._grabOrThrow();
        if (!game.input.locked) game.input.requestLock();
      }
      if (type === 'keydown') {
        if (e.code === 'Escape' || e.code === 'Tab' || e.code === 'KeyQ') this.release();
        if (e.code === 'Space') this._jump();
      }
      if (type === 'lockchange' && !e && this.active && this._lockedOnce) this.release();
      if (type === 'lockchange' && e) this._lockedOnce = true;
      if (type === 'wheel') game.rig.followDist = clamp(game.rig.followDist * Math.exp(e.deltaY * 0.001), 1.6, 7);
    });
  }

  possess(u) {
    const game = this.game;
    if (!u || !u.alive || game.state !== 'play') return;
    if (this.active) this.release(true);
    if (u.garrisoned) game.combatAI.ungarrison(u);
    if (u.sit && u.type === 'king') u.sit = null;
    if (u.job) game.workerAI._clearJob(u);
    this.active = true;
    this.unit = u;
    u.possessed = true;
    u.selected = true;
    u.order = null;
    u.target = null;
    this._lockedOnce = false;
    game.rig.followTarget = u;
    game.rig.followYaw = u.yaw + Math.PI;
    game.rig.followPitch = 0.28;
    game.rig.followDist = 3.2;
    game.rig.setMode('follow', { blendSpeed: 1.8 });
    game.interaction.clearSelection();
    game.input.requestLock();
    game.events.emit('possessed', u);
  }

  release(silent = false) {
    const game = this.game;
    const u = this.unit;
    if (!this.active) return;
    this.active = false;
    if (this.held) this._throw(0.2);
    if (u) {
      u.possessed = false;
      u.selected = false;
      u.manual = null;
      if (u.type === 'king' && u.alive) u.order = null;
    }
    this.unit = null;
    game.input.exitLock();
    game.rig.setMode('rts', { blendSpeed: 1.4 });
    if (u) { game.rig.goal.set(u.pos.x, u.pos.y, u.pos.z); game.rig.goalDist = Math.min(game.rig.goalDist, 22); }
    if (!silent) game.events.emit('unpossessed', u);
  }

  _aimPoint(out) {
    // point under the screen centre (slightly above)
    const game = this.game;
    const ray = game.input.ray(new THREE.Vector2(0, 0.1));
    const hit = game.sim.raycast(ray.origin, ray.direction, 80, false, out);
    if (!hit) out.copy(ray.origin).addScaledVector(ray.direction, 30);
    return out;
  }

  _attack() {
    const u = this.unit;
    if (!u || !u.isActive) return;
    if (this.held) { this._throw(1); return; }
    if (u.def.ranged) {
      if (u.startAttack()) {
        u.loosed = false;
        this._pendingShot = true;
      }
      return;
    }
    if (u.startAttack()) {
      u.struck = false;
      this.game.events.emit('swing', u);
    }
  }

  _jump() {
    const u = this.unit;
    if (!u || !u.isActive || u.jumpY > 0) return;
    u.jumpV = 5.2;
    u.jumpY = 0.001;
    this.game.particles.dust(u.pos.x, u.pos.y, u.pos.z, 3, 0.4);
    this.game.events.emit('jump', u);
  }

  _grabOrThrow() {
    const game = this.game;
    const u = this.unit;
    if (!u || !u.isActive) return;
    if (this.held) { this._throw(1); return; }
    // grab something in front: crab, item or another sandling
    const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw);
    const px = u.pos.x + fx * 0.6, pz = u.pos.z + fz * 0.6;
    let best = null, bd = 1.1;
    for (const e of game.enemies) {
      if (!e.alive || e.def.boss || e.size > 1.6) continue;
      const d = Math.hypot(e.pos.x - px, e.pos.z - pz);
      if (d < bd) { bd = d; best = { kind: 'enemy', obj: e }; }
    }
    for (const it of game.items.list) {
      if (it.carried || it.held) continue;
      const d = Math.hypot(it.pos.x - px, it.pos.z - pz);
      if (d < bd) { bd = d; best = { kind: 'item', obj: it }; }
    }
    for (const o of game.units) {
      if (o === u || !o.alive || o.hidden || !o.p.length) continue;
      const d = Math.hypot(o.pos.x - px, o.pos.z - pz);
      if (d < bd * 0.8) { bd = d; best = { kind: 'unit', obj: o }; }
    }
    if (!best) return;
    this.held = best;
    if (best.kind === 'enemy' || best.kind === 'unit') {
      best.obj.held = true;
      best.obj.knockDown(1);
    } else {
      best.obj.held = true;
    }
    u.carryMode = 'over';
    u.carry = { release: () => {}, heavy: false, fake: true };
    game.events.emit('possessGrab', u, best.obj);
  }

  _throw(power) {
    const game = this.game;
    const u = this.unit;
    const h = this.held;
    this.held = null;
    if (u && u.carry && u.carry.fake) u.carry = null;
    if (!h) return;
    const yaw = game.rig.followYaw + Math.PI;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const sp = 9 * power;
    if (h.kind === 'enemy' || h.kind === 'unit') {
      const o = h.obj;
      o.held = false;
      o.applyImpulse(fx * sp, 4.5 * power + 1, fz * sp);
      o.knockDown(1.5);
      o.thrownT = game.time;
      game.events.emit('throw', o, sp);
    } else {
      const it = h.obj;
      it.held = false;
      it.vel.set(fx * sp, 4 * power, fz * sp);
      it.spin.set(rnd(-8, 8), 0, rnd(-8, 8));
    }
  }

  update(dt) {
    const game = this.game;
    if (!this.active) return;
    const u = this.unit;
    if (!u || !u.alive) {
      game.slowmo = 1.2;
      this.release();
      return;
    }
    const input = game.input;
    const rig = game.rig;
    // mouse look
    rig.followYaw -= input.lockDX * 0.0028;
    rig.followPitch = clamp(rig.followPitch + input.lockDY * 0.0022, -0.25, 1.1);
    // move relative to the camera
    const k = input.keys;
    let mx = 0, mz = 0;
    if (k.KeyW || k.ArrowUp) mz += 1;
    if (k.KeyS || k.ArrowDown) mz -= 1;
    if (k.KeyA || k.ArrowLeft) mx += 1;
    if (k.KeyD || k.ArrowRight) mx -= 1;
    const camYaw = rig.followYaw + Math.PI; // direction the camera looks
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const lx = Math.cos(camYaw), lz = -Math.sin(camYaw);
    let dx = fx * mz + lx * mx, dz = fz * mz + lz * mx;
    const l = Math.hypot(dx, dz);
    if (l > 0) { dx /= l; dz /= l; }
    const attacking = u.attackT >= 0;
    u.manual = { x: dx, z: dz, sprint: !!(k.ShiftLeft || k.ShiftRight), face: (l > 0 && !attacking) ? Math.atan2(dx, dz) : camYaw };
    // keep held things above the head
    if (this.held) {
      const V = game.verlet;
      const hp = u.headPos(_v).add(_v2.set(0, 0.55, 0));
      const h = this.held;
      if (h.kind === 'item') {
        h.obj.pos.lerp(hp, Math.min(1, dt * 20));
      } else if (h.obj.p && h.obj.p.length) {
        const pi = h.obj.grabParticle ? h.obj.grabParticle() : h.obj.p[3] >= 0 ? h.obj.p[3] : h.obj.p[0];
        V.px[pi] += (hp.x - V.px[pi]) * 0.4; V.py[pi] += (hp.y - V.py[pi]) * 0.4; V.pz[pi] += (hp.z - V.pz[pi]) * 0.4;
        h.obj.knocked = Math.max(h.obj.knocked || 0, 0.4);
        if (!h.obj.alive && h.kind === 'enemy' && h.obj.removed) this.held = null;
      }
    }
    // melee strike frame: hit everything in a short cone
    if (!u.def.ranged && u.attackT > 0.48 && !u.struck) {
      u.struck = true;
      const reach = u.def.range * u.scale + 0.5;
      const ufx = Math.sin(u.yaw), ufz = Math.cos(u.yaw);
      let any = false;
      for (const e of game.enemies) {
        if (!e.alive) continue;
        const ex = e.pos.x - u.pos.x, ez = e.pos.z - u.pos.z;
        const d = Math.hypot(ex, ez) - e.radius;
        if (d > reach) continue;
        if ((ex * ufx + ez * ufz) / (Math.hypot(ex, ez) || 1) < 0.2) continue;
        const dmg = u.def.dmg * 1.8 * (game.economy.tech.sharp ? 1.3 : 1);
        e.hit(dmg, ufx * 7, 4, ufz * 7, { source: u, knock: true });
        any = true;
      }
      game.events.emit(any ? 'meleeHit' : 'whiff', u);
    }
    if (u.def.ranged && this._pendingShot && u.attackT > 0.7) {
      this._pendingShot = false;
      const aim = this._aimPoint(new THREE.Vector3());
      const hand = u.joint(4, new THREE.Vector3()) || u.pos.clone().setY(u.pos.y + 0.7);
      game.projectiles.arrow(hand, { pos: aim, centerPos: (o) => o.copy(aim) }, u.def.dmg * 1.6, { color: 0x7cf3ff });
    }
  }
}
