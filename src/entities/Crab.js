// Crabs and friends: verlet-bodied sea creatures with procedural legs.
import * as THREE from 'three';
import { PF } from './Verlet.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, rnd, smoothstep, TAU } from '../core/math.js';

export const CRAB_TYPES = {
  forker: { name: 'Fork Crab', hp: 34, speed: 2.3, dmg: 7, range: 1.05, cooldown: 1.2, size: 1.0, weapon: 'fork', color: 0xe2553f, belly: 0xf3c3a0, armor: 0, bounty: { shells: 1 } },
  knifer: { name: 'Butter-knife Crab', hp: 22, speed: 3.6, dmg: 5, range: 0.95, cooldown: 0.8, size: 0.8, weapon: 'knife', color: 0xf08a3c, belly: 0xffd9b0, armor: 0, bounty: { shells: 1 } },
  spooner: { name: 'Spoon Crab', hp: 52, speed: 2.0, dmg: 6, range: 1.1, cooldown: 1.5, size: 1.1, weapon: 'spoon', shield: true, color: 0xc8463a, belly: 0xf0b898, armor: 0.15, knock: 9, bounty: { shells: 2 } },
  hermit: { name: 'Tin-can Hermit', hp: 140, speed: 1.45, dmg: 10, range: 1.2, cooldown: 1.6, size: 1.2, weapon: null, shell: 'can', color: 0xd96a4a, belly: 0xf5c8a8, armor: 0.5, siege: 2.6, bounty: { shells: 2, pebbles: 2 } },
  lobster: { name: 'Lobster Brute', hp: 190, speed: 1.9, dmg: 15, range: 1.6, cooldown: 1.7, size: 1.55, weapon: null, grabber: true, color: 0xa8231f, belly: 0xe88a6a, armor: 0.25, knock: 11, bounty: { shells: 4, treasure: 1 } },
  shrimp: { name: 'Pistol Shrimp', hp: 26, speed: 2.7, dmg: 6, range: 8.5, cooldown: 2.4, size: 0.85, ranged: true, color: 0xff8f8a, belly: 0xffd0c8, armor: 0, bounty: { shells: 1, seaweed: 1 } },
  kingcrab: { name: 'Sir Pinchington, Lord of the Fork', hp: 2600, speed: 1.35, dmg: 38, range: 4.2, cooldown: 2.6, size: 5.2, weapon: 'trident', boss: true, color: 0xb8322a, belly: 0xf2b08a, armor: 0.3, knock: 16, siege: 3, bounty: { shells: 40, gems: 6, treasure: 6 } },
};

let CID = 1;
const _v = new THREE.Vector3();

// Local pose of body particles (x = side, y = up, z = forward), unit size.
const BODY = [[-0.26, 0, 0.1], [0.26, 0, 0.1], [0, 0, -0.24]];
const CLAWS = [[-0.36, 0.02, 0.5], [0.36, 0.02, 0.5]];
export const LEG_HIPS = [];
export const LEG_REST = [];
for (const side of [-1, 1]) {
  for (let i = 0; i < 4; i++) {
    const z = 0.08 - i * 0.1;
    LEG_HIPS.push([side * 0.22, -0.01, z]);
    LEG_REST.push([side * 0.62, 0, 0.28 - i * 0.2]);
  }
}

export class Crab {
  constructor(game, type, x, z, opts = {}) {
    this.game = game;
    this.id = CID++;
    this.kind = 'enemy';
    this.team = 1;
    this.type = type;
    this.def = CRAB_TYPES[type];
    this.size = this.def.size * (opts.scale || rnd(0.92, 1.08));
    this.maxHp = this.def.hp * (opts.hpMul || 1);
    this.hp = this.maxHp;
    this.alive = true;
    this.pos = new THREE.Vector3(x, game.sim.heightAt(x, z), z);
    this.vel = new THREE.Vector3();
    this.yaw = opts.yaw ?? 0;
    this.goalYaw = this.yaw;
    this.height = 0.3 * this.size;
    this.target = null;
    this.state = opts.emerge ? 'emerge' : 'walk';
    this.stateT = 0;
    this.attackT = -1;
    this.cooldown = rnd(0, 1);
    this.knocked = 0;
    this.held = false;
    this.flash = 0;
    this.claw = [0, 0]; // open amount per claw
    this.clawsOn = [true, true];
    this.legsOn = new Array(8).fill(true);
    this.legFeet = [];
    this.legLift = new Array(8).fill(0);
    this.legFrom = [];
    this.legTo = [];
    this.deadTime = 0;
    this.removed = false;
    this.eyeAnger = rnd(0.6, 1);
    this.shout = 0;
    this.grabbed = null; // unit held by a lobster
    this.color = new THREE.Color(this.def.color).offsetHSL(rnd(-0.02, 0.02), 0, rnd(-0.05, 0.05));
    this.stuckT = 0;
    this.lastPos = new THREE.Vector3(x, 0, z);
    this.radius = 0.45 * this.size;
    this.speedMul = opts.speedMul || 1;
    this.dmgMul = opts.dmgMul || 1;
    this._build();
  }

  _basis(yaw = this.yaw) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    return { fx, fz, sx: fz, sz: -fx };
  }

  _build() {
    const V = this.game.verlet;
    const s = this.size;
    const b = this._basis();
    const y0 = this.pos.y + this.height + (this.state === 'emerge' ? -0.6 * s : 0);
    this.p = [];
    const pts = [...BODY, ...CLAWS];
    pts.forEach(([lx, ly, lz], j) => {
      const wx = this.pos.x + (b.sx * lx + b.fx * lz) * s;
      const wz = this.pos.z + (b.sz * lx + b.fz * lz) * s;
      const r = j < 3 ? 0.17 * s : 0.12 * s;
      const i = V.addParticle(wx, y0 + ly * s, wz, r, (j < 3 ? 1.2 : 0.4) * s * s, 100000 + this.id, j < 3 ? PF.ACTIVE | PF.COLLIDE : PF.ACTIVE);
      V.buoy[i] = 0.55;
      V.fric[i] = 0.7;
      this.p.push(i);
    });
    const P = this.p;
    this.c = {
      body: [V.addConstraint(P[0], P[1]), V.addConstraint(P[1], P[2]), V.addConstraint(P[2], P[0])],
      claw0: [V.addConstraint(P[0], P[3], 0.8), V.addConstraint(P[2], P[3], 0.4)],
      claw1: [V.addConstraint(P[1], P[4], 0.8), V.addConstraint(P[2], P[4], 0.4)],
    };
    const gy = this.game.sim.heightAt(this.pos.x, this.pos.z);
    for (let i = 0; i < 8; i++) {
      const r = LEG_REST[i];
      const wx = this.pos.x + (b.sx * r[0] + b.fx * r[2]) * s;
      const wz = this.pos.z + (b.sz * r[0] + b.fz * r[2]) * s;
      this.legFeet.push(new THREE.Vector3(wx, gy, wz));
      this.legFrom.push(new THREE.Vector3(wx, gy, wz));
      this.legTo.push(new THREE.Vector3(wx, gy, wz));
    }
  }

  destroyBody() {
    const V = this.game.verlet;
    for (const k in this.c) for (const c of this.c[k]) V.removeConstraint(c);
    for (const i of this.p) if (i >= 0) V.removeParticle(i);
    this.p = [];
  }

  // body frame from particles
  frame(out) {
    const V = this.game.verlet;
    const [a, b, c] = this.p;
    out.p0.set(V.px[a], V.py[a], V.pz[a]);
    out.p1.set(V.px[b], V.py[b], V.pz[b]);
    out.p2.set(V.px[c], V.py[c], V.pz[c]);
    out.center.copy(out.p0).add(out.p1).add(out.p2).multiplyScalar(1 / 3);
    out.side.subVectors(out.p1, out.p0).normalize();
    out.fwd.addVectors(out.p0, out.p1).multiplyScalar(0.5).sub(out.p2);
    out.fwd.addScaledVector(out.side, -out.fwd.dot(out.side)).normalize();
    out.up.crossVectors(out.fwd, out.side).normalize();
    return out;
  }

  centerPos(out) {
    const V = this.game.verlet;
    if (!this.p.length) return out.copy(this.pos);
    const [a, b, c] = this.p;
    return out.set((V.px[a] + V.px[b] + V.px[c]) / 3, (V.py[a] + V.py[b] + V.py[c]) / 3, (V.pz[a] + V.pz[b] + V.pz[c]) / 3);
  }

  grabParticle() { return this.p[2]; }

  get isActive() { return this.alive && this.knocked <= 0 && !this.held && this.state !== 'emerge'; }

  applyImpulse(ix, iy, iz) {
    const V = this.game.verlet;
    for (const i of this.p) if (i >= 0) V.impulse(i, ix, iy, iz);
  }

  knockDown(sec = 1.2) {
    this.knocked = Math.max(this.knocked, sec);
    if (this.grabbed) this.releaseGrab();
  }

  hit(dmg, ix = 0, iy = 0, iz = 0, opts = {}) {
    if (!this.alive) { this.applyImpulse(ix, iy, iz); return; }
    let armor = this.def.armor || 0;
    // spoon shields block frontal arrows
    if (opts.ranged && this.def.shield) {
      const b = this._basis();
      const fromFront = -(ix * b.fx + iz * b.fz) / (Math.hypot(ix, iz) || 1);
      if (fromFront > 0.3 && Math.random() < 0.65) { this.game.events.emit('blocked', this); this.flash = 0.5; return; }
    }
    if (opts.pierce) armor *= 0.4;
    const real = dmg * (1 - armor);
    this.hp -= real;
    this.flash = 1;
    const sizeK = 1 / Math.max(1, this.size * 0.8);
    this.applyImpulse(ix * sizeK, iy * sizeK, iz * sizeK);
    const mag = Math.hypot(ix, iy, iz) * sizeK;
    if ((mag > 5.5 || opts.knock) && !this.def.boss) this.knockDown(clamp(mag * 0.2, 0.6, 2.5));
    this.game.events.emit('enemyHit', this, real, opts);
    // pop off a leg or claw on heavy hits
    if (!this.def.boss && (mag > 6 || real > 15) && Math.random() < 0.4) this.severRandom(ix, iy, iz);
    if (this.hp <= 0) this.die(ix, iy, iz, opts);
  }

  severRandom(ix, iy, iz) {
    const opts = [];
    for (let i = 0; i < 8; i++) if (this.legsOn[i]) opts.push(['leg', i]);
    if (this.clawsOn[0]) opts.push(['claw', 0]);
    if (this.clawsOn[1]) opts.push(['claw', 1]);
    if (!opts.length) return;
    const [k, i] = opts[Math.floor(Math.random() * opts.length)];
    this.sever(k, i, ix, iy, iz);
  }

  sever(kind, i, ix = 0, iy = 2, iz = 0) {
    const game = this.game;
    const s = this.size;
    if (kind === 'leg') {
      if (!this.legsOn[i]) return;
      this.legsOn[i] = false;
      const foot = this.legFeet[i];
      game.enemyManager.flyingPart('leg', foot.x, foot.y + 0.1, foot.z, ix * 0.6 + rnd(-1, 1), 3 + iy * 0.3, iz * 0.6 + rnd(-1, 1), s, this.color);
    } else {
      if (!this.clawsOn[i]) return;
      this.clawsOn[i] = false;
      const V = game.verlet;
      for (const c of this.c['claw' + i]) V.removeConstraint(c);
      this.c['claw' + i] = [];
      const pi = this.p[3 + i];
      game.enemyManager.flyingPart('claw', V.px[pi], V.py[pi], V.pz[pi], ix * 0.8 + rnd(-1, 1), 3.5 + iy * 0.3, iz * 0.8 + rnd(-1, 1), s, this.color, this.def.weapon && i === 1 ? this.def.weapon : null);
      V.removeParticle(pi);
      this.p[3 + i] = -1;
    }
    game.particles.splash(this.pos.x, this.pos.y + 0.3 * s, this.pos.z, 5, 0.5);
    game.events.emit('crabSever', this, kind);
  }

  die(ix = 0, iy = 0, iz = 0, opts = {}) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.deadTime = 0;
    if (this.grabbed) this.releaseGrab();
    // flip over with a spin
    const V = this.game.verlet;
    if (this.p[0] >= 0) {
      V.impulse(this.p[0], 0, 3.5 + Math.random() * 2, 0);
      V.impulse(this.p[2], 0, -1, 0);
    }
    this.game.events.emit('enemyDied', this, opts);
  }

  releaseGrab() {
    const u = this.grabbed;
    this.grabbed = null;
    if (u) { u.held = false; u.grabbedBy = null; }
  }

  // ---- AI + pose (each physics step) -------------------------------------------------
  preStep(dt, t) {
    const V = this.game.verlet;
    if (!this.p.length) return;
    const sim = this.game.sim;
    const s = this.size;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.shout = Math.max(0, this.shout - dt);
    if (!this.alive) {
      for (const i of this.p) if (i >= 0) V.tk[i] = 0;
      this.deadTime += dt;
      return;
    }
    // knocked / flipped: limp until resting, then right itself
    if (this.knocked > 0) {
      this.knocked -= dt;
      const ci = this.p[2];
      const sp = Math.hypot(V.velX(ci), V.velY(ci), V.velZ(ci));
      if (sp > 1.0 || this.held) this.knocked = Math.max(this.knocked, 0.25);
      for (const i of this.p) if (i >= 0) V.tk[i] = 0;
      if (this.knocked <= 0) {
        // hop back upright
        const f = this.frame(this._f || (this._f = mkFrame()));
        if (f.up.y < 0.3) { for (const i of this.p) if (i >= 0) V.impulse(i, 0, 3.2, 0); this.knocked = 0.15; this.righting = true; }
        else { this.pos.x = f.center.x; this.pos.z = f.center.z; this.yaw = Math.atan2(f.fwd.x, f.fwd.z); this.goalYaw = this.yaw; this.righting = false; }
      }
      return;
    }
    if (this.held) { for (const i of this.p) if (i >= 0) V.tk[i] = 0; return; }

    this.stateT += dt;
    if (this.scripted) {
      this.game.intro.driveCrab(this, dt);
    } else if (this.state === 'emerge') {
      this.game.enemyManager.ai.emerge(this, dt);
    } else {
      this.game.enemyManager.ai.think(this, dt);
    }
    this._locomote(dt);
    this._pose(dt, t);
  }

  _locomote(dt) {
    const sim = this.game.sim;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.game.resolveStatic(this.pos, this.radius);
    this.game.clampToWorld(this.pos);
    this.pos.y = sim.heightAt(this.pos.x, this.pos.z);
    this.yaw = dampAngle(this.yaw, this.goalYaw, 7, dt);
    this.speed = sp;
  }

  _pose(dt, t) {
    const V = this.game.verlet;
    const s = this.size;
    const b = this._basis();
    let lunge = 0, rear = 0, bob = 0;
    if (this.attackT >= 0) {
      const at = this.attackT;
      rear = smoothstep(0, 0.45, at) * (1 - smoothstep(0.45, 0.6, at));
      lunge = smoothstep(0.45, 0.6, at) * (1 - smoothstep(0.7, 1, at));
    }
    if (this.speed > 0.2) bob = Math.abs(Math.sin(t * 14 + this.id)) * 0.03 * s;
    const emergeLift = this.state === 'emerge' ? smoothstep(0, 1.1, this.stateT) : 1;
    const baseY = this.pos.y + (this.height + bob) * emergeLift - (1 - emergeLift) * 0.5 * s;
    const pts = [...BODY, ...CLAWS];
    const cheer = this.state === 'warcry' ? 1 : 0;
    for (let j = 0; j < 5; j++) {
      const i = this.p[j];
      if (i < 0) continue;
      let [lx, ly, lz] = pts[j];
      if (j < 3) {
        // body pitches up when rearing back, forward on the lunge
        ly += (j === 2 ? -rear * 0.12 + lunge * 0.06 : rear * 0.14 - lunge * 0.05);
        lz += lunge * 0.25 - rear * 0.08;
      } else {
        const side = j === 3 ? -1 : 1;
        // claws: raised + snapping
        const raise = Math.max(rear * 0.55, cheer * (0.5 + 0.15 * Math.sin(t * 9 + j)), this.state === 'chase' ? 0.12 : 0.05);
        ly += raise + lunge * 0.1;
        lz += lunge * 0.4 - rear * 0.15 + cheer * 0.05;
        lx += side * (rear * 0.1 + cheer * 0.12);
        if (this.grabbed && j === 4) { ly += 0.35; lz -= 0.05; }
      }
      const wx = this.pos.x + (b.sx * lx + b.fx * lz) * s;
      const wz = this.pos.z + (b.sz * lx + b.fz * lz) * s;
      V.setTarget(i, wx, baseY + ly * s, wz, j < 3 ? 0.35 : 0.3);
    }
    // claw snapping
    for (let c = 0; c < 2; c++) {
      const want = this.attackT >= 0 ? (this.attackT < 0.5 ? 1 : 0) : (cheer ? 0.5 + 0.5 * Math.sin(t * 12 + c * 2) : 0.15 + 0.15 * Math.sin(t * 2 + this.id + c));
      this.claw[c] = damp(this.claw[c], want, 18, dt);
    }
    if (this.attackT >= 0) {
      this.attackT += dt / (this.def.boss ? 1.4 : 0.6);
      if (this.attackT >= 1) this.attackT = -1;
    }
    this.cooldown -= dt;
  }

  startAttack() {
    if (this.attackT >= 0 || this.cooldown > 0) return false;
    this.attackT = 0;
    this.cooldown = this.def.cooldown * rnd(0.85, 1.15);
    this.shout = 0.5;
    this.struck = false;
    return true;
  }

  // Procedural legs: update foot plants (called per render frame).
  updateLegs(dt, f, t) {
    const sim = this.game.sim;
    const s = this.size;
    const flipped = f.up.y < 0.2;
    for (let i = 0; i < 8; i++) {
      if (!this.legsOn[i]) continue;
      const r = LEG_REST[i];
      const want = _v.copy(f.center).addScaledVector(f.side, r[0] * s).addScaledVector(f.fwd, r[2] * s);
      if (!this.alive || flipped || this.knocked > 0 || this.held) {
        // wiggle in the air (or curl up when dead)
        const curl = this.alive ? 0 : clamp(this.deadTime * 2, 0, 1);
        want.copy(f.center).addScaledVector(f.side, r[0] * s * (1 - curl * 0.5)).addScaledVector(f.fwd, r[2] * s * 0.8)
          .addScaledVector(f.up, (0.25 + Math.sin(t * 18 + i * 1.7) * 0.12 * (1 - curl)) * s);
        this.legFeet[i].lerp(want, Math.min(1, dt * 20));
        continue;
      }
      want.y = sim.heightAt(want.x, want.z);
      const foot = this.legFeet[i];
      if (this.legLift[i] > 0) {
        this.legLift[i] = Math.max(0, this.legLift[i] - dt / 0.11);
        const k = 1 - this.legLift[i];
        foot.lerpVectors(this.legFrom[i], this.legTo[i], k);
        foot.y += Math.sin(k * Math.PI) * 0.18 * s;
      } else {
        const d = Math.hypot(foot.x - want.x, foot.z - want.z);
        const groupOk = this.legLift[(i + 1) % 8] === 0 && this.legLift[(i + 7) % 8] === 0;
        if (d > 0.22 * s && groupOk) {
          this.legLift[i] = 1;
          this.legFrom[i].copy(foot);
          this.legTo[i].copy(want).add(_v.set(this.vel.x * 0.08, 0, this.vel.z * 0.08));
          this.legTo[i].y = sim.heightAt(this.legTo[i].x, this.legTo[i].z);
        } else foot.y = damp(foot.y, want.y, 10, dt);
      }
    }
  }
}

export function mkFrame() {
  return { p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), center: new THREE.Vector3(), side: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3() };
}
