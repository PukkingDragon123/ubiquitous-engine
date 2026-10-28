// A sandling: one tiny sand person. Owns an active-ragdoll body in the Verlet
// world and generates its animated target pose every physics step.
import * as THREE from 'three';
import { PF } from './Verlet.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, rnd, smoothstep, TAU } from '../core/math.js';

// Joint indices
export const J = { PELVIS: 0, LSH: 1, RSH: 2, HEAD: 3, LHAND: 4, RHAND: 5, LFOOT: 6, RFOOT: 7 };
// Rest pose (local: x = left, y = up, z = forward), unit scale.
const REST = [
  [0, 0.34, 0],
  [0.14, 0.62, 0],
  [-0.14, 0.62, 0],
  [0, 0.86, 0],
  [0.2, 0.37, 0.02],
  [-0.2, 0.37, 0.02],
  [0.085, 0.06, 0],
  [-0.085, 0.06, 0],
];
const RADII = [0.14, 0.08, 0.08, 0.19, 0.055, 0.055, 0.07, 0.07];
const MASS = [1.4, 0.7, 0.7, 0.9, 0.25, 0.25, 0.4, 0.4];

export const UNIT_TYPES = {
  worker: { name: 'Worker', hp: 30, speed: 3.3, dmg: 3, range: 0.75, cooldown: 1.0, scale: 1.0, hat: 'bucket', weapon: null, armor: 0, cost: { shells: 6 }, pop: 1, color: 0xdcb27a },
  knight: { name: 'Knight', hp: 75, speed: 2.9, dmg: 9, range: 0.95, cooldown: 0.95, scale: 1.08, hat: 'helmet', weapon: 'sword', shield: true, armor: 0.35, cost: { shells: 10, pebbles: 4 }, pop: 1, color: 0xd2a872 },
  archer: { name: 'Archer', hp: 38, speed: 3.1, dmg: 7, range: 13, cooldown: 1.6, scale: 1.0, hat: 'leaf', weapon: 'bow', armor: 0.05, ranged: true, cost: { shells: 8, driftwood: 3 }, pop: 1, color: 0xd8ad76 },
  spearman: { name: 'Spear Sandling', hp: 55, speed: 3.0, dmg: 8, range: 1.35, cooldown: 1.1, scale: 1.04, hat: 'band', weapon: 'spear', armor: 0.15, cost: { shells: 8, driftwood: 2 }, pop: 1, color: 0xd0a56e },
  cavalry: { name: 'Shell Rider', hp: 95, speed: 5.4, dmg: 11, range: 1.3, cooldown: 1.0, scale: 1.05, hat: 'helmet', weapon: 'spear', armor: 0.25, mount: true, cost: { shells: 16, seaweed: 6, pebbles: 4 }, pop: 2, color: 0xd2a872 },
  king: { name: 'The Sand King', hp: 160, speed: 2.4, dmg: 12, range: 1.0, cooldown: 1.1, scale: 1.14, hat: 'crown', weapon: 'scepter', armor: 0.2, pop: 0, color: 0xe2bb82 },
};

const _v = new THREE.Vector3();
let NEXT_ID = 1;

export class Sandling {
  constructor(game, type, x, z, opts = {}) {
    this.game = game;
    this.id = NEXT_ID++;
    this.kind = 'unit';
    this.team = 0;
    this.type = type;
    this.def = UNIT_TYPES[type];
    this.scale = this.def.scale * (opts.scale || rnd(0.92, 1.08));
    this.headScale = rnd(0.92, 1.12);
    this.maxHp = this.def.hp;
    this.hp = this.maxHp;
    this.alive = true;
    this.pos = new THREE.Vector3(x, game.sim.heightAt(x, z), z); // root (feet)
    this.vel = new THREE.Vector3();
    this.yaw = opts.yaw ?? rnd(-Math.PI, Math.PI);
    this.goalYaw = this.yaw;
    this.speedMul = 1;
    this.moveTarget = null;
    this.arriveDist = 0.4;
    this.anim = 'idle';
    this.animT = 0; // time in current anim
    this.phase = Math.random();
    this.strength = 1; // active ragdoll strength (0 = limp)
    this.knocked = 0; // seconds remaining limp
    this.stillTime = 0;
    this.getup = 0;
    this.flash = 0;
    this.wet = 0;
    this.carry = null; // item being carried
    this.carryMode = 'over'; // 'over' head | 'front'
    this.held = false; // grabbed by the hand / an enemy
    this.lookAt = null;
    this.shout = 0;
    this.blink = 0;
    this.blinkT = rnd(1, 4);
    this.attackT = -1;
    this.attackCooldown = 0;
    this.target = null;
    this.limbs = { head: true, larm: true, rarm: true, lleg: true, rleg: true };
    this.deadTime = 0;
    this.crumbled = false;
    this.selected = false;
    this.home = null;
    this.job = null;
    this.state = 'idle';
    this.mood = rnd(0, 1);
    this.name = opts.name || randomName();
    const c = new THREE.Color(this.def.color);
    c.offsetHSL(rnd(-0.015, 0.015), rnd(-0.06, 0.04), rnd(-0.07, 0.05));
    this.color = c;
    this.hatColor = new THREE.Color().setHSL(Math.random(), 0.65, 0.55);
    this.sit = null; // {x, y, z, yaw} seat
    this.sleep = false;
    this.talk = 0;
    this.cheer = 0;
    this.panic = 0;
    this.swim = 0;
    this.possessed = false;
    this.mounted = !!this.def.mount;
    this.jumpY = 0;
    this.jumpV = 0;
    this.manual = null;
    this.perch = null;
    this._buildBody();
  }

  _buildBody() {
    const V = this.game.verlet;
    const s = this.scale;
    const f = this._basis();
    this.p = [];
    for (let j = 0; j < 8; j++) {
      const r = REST[j];
      const wx = this.pos.x + (f.lx * r[0] + f.fx * r[2]) * s;
      const wy = this.pos.y + r[1] * s;
      const wz = this.pos.z + (f.lz * r[0] + f.fz * r[2]) * s;
      const flags = PF.ACTIVE | (j === J.PELVIS || j === J.HEAD ? PF.COLLIDE : 0);
      const i = V.addParticle(wx, wy, wz, RADII[j] * s * (j === J.HEAD ? this.headScale : 1), MASS[j] * s, this.id, flags);
      this.p.push(i);
    }
    V.buoy[this.p[J.HEAD]] = 1.35;
    V.buoy[this.p[J.PELVIS]] = 1.15;
    const P = this.p;
    const C = (a, b, st = 1) => V.addConstraint(P[a], P[b], st);
    this.c = {
      spine: [C(J.PELVIS, J.LSH), C(J.PELVIS, J.RSH), C(J.LSH, J.RSH)],
      head: [C(J.HEAD, J.LSH, 0.9), C(J.HEAD, J.RSH, 0.9), C(J.HEAD, J.PELVIS, 0.6)],
      larm: [C(J.LSH, J.LHAND)],
      rarm: [C(J.RSH, J.RHAND)],
      lleg: [C(J.PELVIS, J.LFOOT)],
      rleg: [C(J.PELVIS, J.RFOOT)],
    };
    // keep hands/feet from collapsing into the body
    this.c.soft = [
      V.addConstraint(P[J.LHAND], P[J.RSH], 0.3, 0.2 * s, true),
      V.addConstraint(P[J.RHAND], P[J.LSH], 0.3, 0.2 * s, true),
      V.addConstraint(P[J.LFOOT], P[J.RFOOT], 0.4, 0.1 * s, true),
      V.addConstraint(P[J.LFOOT], P[J.LSH], 0.2, 0.42 * s, true),
      V.addConstraint(P[J.RFOOT], P[J.RSH], 0.2, 0.42 * s, true),
    ];
  }

  destroyBody() {
    const V = this.game.verlet;
    for (const k in this.c) for (const c of this.c[k]) V.removeConstraint(c);
    for (const i of this.p) if (i >= 0) V.removeParticle(i);
    this.p = [];
  }

  _basis() {
    const y = this.yaw;
    const fx = Math.sin(y), fz = Math.cos(y);
    return { fx, fz, lx: fz, lz: -fx };
  }

  // Head world position (for UI anchoring and camera)
  headPos(out) {
    const V = this.game.verlet;
    const i = this.p[J.HEAD];
    if (i === undefined || i < 0) return out.copy(this.pos);
    return out.set(V.px[i], V.py[i], V.pz[i]);
  }
  centerPos(out) {
    const V = this.game.verlet;
    const i = this.p[J.PELVIS];
    return out.set(V.px[i], V.py[i], V.pz[i]);
  }
  cameraAnchor(out) {
    return this.headPos(out).add(_v.set(0, 0.25 * this.scale, 0));
  }

  get radius() { return 0.28 * this.scale; }
  get isActive() { return this.alive && this.knocked <= 0 && !this.held; }

  // ---- commands --------------------------------------------------------------
  moveTo(x, z, arrive = 0.4) {
    if (!this.moveTarget) this.moveTarget = new THREE.Vector3();
    this.moveTarget.set(x, 0, z);
    this.arriveDist = arrive;
  }
  stop() { this.moveTarget = null; }

  // ---- damage ----------------------------------------------------------------
  hit(dmg, ix, iy, iz, opts = {}) {
    if (!this.alive) {
      // dead bodies still fly around
      this.applyImpulse(ix, iy, iz, opts.joint);
      return;
    }
    const armor = this.def.armor || 0;
    const real = dmg * (1 - armor * (opts.pierce ? 0.3 : 1));
    this.hp -= real;
    this.flash = 1;
    this.shout = 0.6;
    this.applyImpulse(ix, iy, iz, opts.joint);
    const mag = Math.hypot(ix, iy, iz);
    if (mag > 4.5 || opts.knock) this.knockDown(clamp(mag * 0.25, 0.8, 3));
    this.game.events.emit('unitHit', this, real, opts);
    // dismemberment on heavy blows
    if (opts.sever !== false && (mag > 7 || real > 14) && Math.random() < 0.35 + (opts.sever ? 0.5 : 0)) {
      const parts = ['larm', 'rarm', 'lleg', 'rleg', 'head'].filter((p) => this.limbs[p]);
      const weights = parts.map((p) => (p === 'head' ? 0.2 : 1));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < parts.length; i++) {
        r -= weights[i];
        if (r <= 0) { this.sever(parts[i], ix, iy, iz); break; }
      }
    }
    if (this.hp <= 0) this.die(ix, iy, iz);
  }

  applyImpulse(ix, iy, iz, joint) {
    const V = this.game.verlet;
    if (!this.p.length) return;
    if (joint !== undefined && this.p[joint] >= 0) {
      V.impulse(this.p[joint], ix, iy, iz);
      for (const i of this.p) if (i >= 0) V.impulse(i, ix * 0.4, iy * 0.4, iz * 0.4);
    } else {
      for (const i of this.p) if (i >= 0) V.impulse(i, ix, iy, iz);
    }
  }

  knockDown(seconds = 1.5) {
    this.knocked = Math.max(this.knocked, seconds);
    this.strength = 0;
    if (this.carry) this.dropCarry();
  }

  sever(part, ix = 0, iy = 2, iz = 0) {
    if (!this.limbs[part]) return;
    const V = this.game.verlet;
    this.limbs[part] = false;
    for (const c of this.c[part]) V.removeConstraint(c);
    this.c[part] = [];
    const s = this.scale;
    const game = this.game;
    let a, b, len, kind, attach;
    if (part === 'head') {
      a = this.p[J.HEAD]; kind = 'head'; attach = J.HEAD;
      // remove the soft link too and turn the head into a free ball
      V.body[a] = -1000 - this.id;
      this.p[J.HEAD] = -1;
      game.limbs.add({ kind: 'head', a, b: -1, color: this.color, scale: s * this.headScale, owner: this, hat: this.def.hat, hatColor: this.hatColor });
      this.die(ix, iy, iz);
    } else {
      const map = { larm: [J.LSH, J.LHAND, 'arm'], rarm: [J.RSH, J.RHAND, 'arm'], lleg: [J.PELVIS, J.LFOOT, 'leg'], rleg: [J.PELVIS, J.RFOOT, 'leg'] };
      const [ja, jb, k] = map[part];
      kind = k; attach = ja;
      b = this.p[jb];
      // detach the end particle and give it a new partner at the joint
      V.body[b] = -1000 - this.id;
      const pa = this.p[ja];
      a = V.addParticle(V.px[pa], V.py[pa], V.pz[pa], 0.06 * s, 0.25 * s, -1000 - this.id, PF.ACTIVE);
      len = Math.hypot(V.px[b] - V.px[pa], V.py[b] - V.py[pa], V.pz[b] - V.pz[pa]);
      const c = V.addConstraint(a, b, 1, len);
      V.impulse(a, ix * 0.8, iy * 0.8 + 1, iz * 0.8);
      V.impulse(b, ix * 1.2, iy * 1.2 + 2, iz * 1.2);
      V.tk[b] = 0;
      this.p[jb] = -1;
      game.limbs.add({ kind, a, b, c, color: this.color, scale: s, owner: this });
      // weapon arm → drop weapon
      if (part === 'rarm' && this.carry) this.dropCarry();
      if ((part === 'lleg' || part === 'rleg') && Math.random() < 0.6) this.knockDown(2);
    }
    game.particles.spurt(V.px[this.p[attach] >= 0 ? this.p[attach] : a], V.py[this.p[attach] >= 0 ? this.p[attach] : a], V.pz[this.p[attach] >= 0 ? this.p[attach] : a], ix * 0.1, 1, iz * 0.1, 14, this.wet);
    game.events.emit('sever', this, part);
    this.stumpTimer = 2.5;
  }

  die(ix = 0, iy = 0, iz = 0) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.strength = 0;
    this.deadTime = 0;
    this.shout = 0;
    if (this.carry) this.dropCarry();
    this.game.events.emit('unitDied', this);
  }

  dropCarry() {
    const it = this.carry;
    if (!it) return;
    this.carry = null;
    if (it.release) it.release(this);
  }

  // Crumble into a little sand pile (after death).
  crumble() {
    if (this.crumbled) return;
    this.crumbled = true;
    const V = this.game.verlet;
    const parts = this.game.particles;
    for (const i of this.p) {
      if (i < 0) continue;
      const vol = 0.012 * this.scale;
      parts.sandSpray(V.px[i], V.py[i], V.pz[i], 0, 0, 6, vol, this.wet, 0.25);
    }
    parts.dust(V.px[this.p[J.PELVIS]], V.py[this.p[J.PELVIS]], V.pz[this.p[J.PELVIS]], 5, 0.7);
    this.destroyBody();
  }

  // ---- per physics step --------------------------------------------------------
  preStep(dt, t) {
    const V = this.game.verlet;
    if (!this.p.length) return;
    const P = this.p;
    if (!this.alive) {
      for (const i of P) if (i >= 0) V.tk[i] = 0;
      this.deadTime += dt;
      if (this.deadTime > 6 + (this.id % 5) && !this.crumbled) this.crumble();
      return;
    }

    // knocked: limp until still, then get up
    if (this.knocked > 0) {
      this.knocked -= dt;
      this.strength = 0;
      const pi = P[J.PELVIS];
      const sp = Math.hypot(V.velX(pi), V.velY(pi), V.velZ(pi));
      if (sp > 1.2 || this.held) this.knocked = Math.max(this.knocked, 0.3);
      if (this.knocked <= 0) this.getup = 0.001;
    }
    if (this.held) { this.strength = 0; }
    if (this.knocked <= 0 && !this.held) {
      // re-anchor the root under the pelvis while getting up
      if (this.getup > 0) {
        const pi = P[J.PELVIS];
        this.pos.x = V.px[pi]; this.pos.z = V.pz[pi];
        this.getup += dt;
        if (this.getup > 0.9) this.getup = 0;
        this.strength = smoothstep(0, 0.9, this.getup || 0.9);
      } else {
        this.strength = damp(this.strength, 1, 6, dt);
      }
    }

    // water: swimming / being swept away
    const sim = this.game.sim;
    const depth = sim.depthAt(this.pos.x, this.pos.z);
    this.swim = smoothstep(0.38 * this.scale, 0.62 * this.scale, depth);
    if (depth > 0.05) this.wet = Math.min(1, this.wet + dt * 0.5);
    else this.wet = Math.max(0, this.wet - dt * 0.04);
    if (depth > 0.25 && this.isActive && !this.possessed) {
      const k = sim.cellIndex(this.pos.x, this.pos.z);
      const sp = k >= 0 ? Math.hypot(sim.vx[k], sim.vz[k]) : 0;
      if (sp > 2.2 && Math.random() < dt * (sp - 1.8) * 1.5) {
        this.knockDown(1.5);
        this.game.events.emit('swept', this);
      }
    }
    // soggy sandlings slowly lose cohesion
    if (this.swim > 0.5 && this.alive) {
      this.hp -= dt * 1.6;
      if (this.hp <= 0) this.die();
    }

    this._locomotion(dt);
    this._pose(dt, t);
  }

  _locomotion(dt) {
    if (this.perch) {
      this.pos.set(this.perch.x, this.perch.y, this.perch.z);
      this.vel.set(0, 0, 0);
      this.speed = 0;
      if (this.lookAt) this.goalYaw = Math.atan2(this.lookAt.x - this.pos.x, this.lookAt.z - this.pos.z);
      this.yaw = dampAngle(this.yaw, this.goalYaw, 8, dt);
      return;
    }
    if (!this.isActive || this.getup > 0) { this.vel.multiplyScalar(0.8); return; }
    const sim = this.game.sim;
    let desiredX = 0, desiredZ = 0;
    if (this.manual) {
      desiredX = this.manual.x * this.def.speed * (this.manual.sprint ? 1.6 : 1.15) * (1 - this.swim * 0.5);
      desiredZ = this.manual.z * this.def.speed * (this.manual.sprint ? 1.6 : 1.15) * (1 - this.swim * 0.5);
      this.moveTarget = null;
    }
    const speed = this.def.speed * this.speedMul * (this.carry ? (this.carry.heavy ? 0.55 : 0.8) : 1) * (1 - this.swim * 0.55) * (this.panic > 0 ? 1.25 : 1);
    if (this.moveTarget && !this.sit) {
      const dx = this.moveTarget.x - this.pos.x, dz = this.moveTarget.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < this.arriveDist) {
        this.moveTarget = null;
      } else {
        const slow = clamp(d / 1.2, 0.25, 1);
        desiredX = (dx / d) * speed * slow;
        desiredZ = (dz / d) * speed * slow;
      }
    }
    // separation from neighbours
    const sep = this.game.separation(this, 0.55 * this.scale);
    desiredX += sep.x * 2.2;
    desiredZ += sep.z * 2.2;
    // steer
    const acc = 14;
    this.vel.x = damp(this.vel.x, desiredX, acc * 0.5, dt);
    this.vel.z = damp(this.vel.z, desiredZ, acc * 0.5, dt);
    // slope: slower uphill
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const dh = sim.heightAt(nx, nz) - sim.heightAt(this.pos.x, this.pos.z);
    const step = Math.hypot(this.vel.x, this.vel.z) * dt;
    if (step > 1e-5 && dh / step > 1.8) {
      // too steep (a wall of sand): slide along
      this.vel.multiplyScalar(0.3);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.game.resolveStatic(this.pos, this.radius);
    this.game.clampToWorld(this.pos);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.25) this.goalYaw = Math.atan2(this.vel.x, this.vel.z);
    if (this.lookAt && sp < 0.6) this.goalYaw = Math.atan2(this.lookAt.x - this.pos.x, this.lookAt.z - this.pos.z);
    if (this.sit) { this.pos.x = this.sit.x; this.pos.z = this.sit.z; this.goalYaw = this.sit.yaw; }
    if (this.manual && this.manual.face !== undefined) this.goalYaw = this.manual.face;
    this.yaw = dampAngle(this.yaw, this.goalYaw, this.manual ? 16 : 10, dt);
    const ground = this.game.walkHeight(this.pos.x, this.pos.z);
    const surf = ground + sim.depthAt(this.pos.x, this.pos.z);
    this.pos.y = this.swim > 0 ? lerp(ground, surf - 0.62 * this.scale, this.swim) : ground;
    this.speed = sp;
  }

  // Build target pose from animation state.
  _pose(dt, t) {
    const V = this.game.verlet;
    const s = this.scale;
    const P = this.p;
    const b = this._basis();
    const sp = this.speed || 0;
    const moving = sp > 0.3;
    this.animT += dt;
    // gait phase advances with distance
    const stride = 0.34 * s;
    this.phase += moving ? (sp * dt) / (stride * 2) : 0;
    const ph = this.phase * TAU;
    const sw = Math.sin(ph), cw = Math.cos(ph);
    const runF = clamp(sp / 3.5, 0, 1.3);
    const L = this._L || (this._L = REST.map((r) => r.slice()));
    for (let j = 0; j < 8; j++) { L[j][0] = REST[j][0]; L[j][1] = REST[j][1]; L[j][2] = REST[j][2]; }

    let tilt = 0; // forward lean of the whole body (radians)
    let rootY = 0;
    if (this.jumpY > 0 || this.jumpV > 0) {
      this.jumpV -= 14 * dt;
      this.jumpY = Math.max(0, this.jumpY + this.jumpV * dt);
      if (this.jumpY === 0) this.jumpV = 0;
      rootY += this.jumpY;
    }
    const idleT = t + this.id * 1.37;

    // ----- legs -----
    if (moving && !this.sit) {
      const lift = 0.09 * runF + 0.03;
      L[J.LFOOT][2] = sw * stride * 0.9; L[J.LFOOT][1] = 0.06 + Math.max(0, cw) * lift;
      L[J.RFOOT][2] = -sw * stride * 0.9; L[J.RFOOT][1] = 0.06 + Math.max(0, -cw) * lift;
      const bob = Math.abs(cw) * 0.035 * runF;
      for (const j of [J.PELVIS, J.LSH, J.RSH, J.HEAD, J.LHAND, J.RHAND]) L[j][1] += bob - 0.02 * runF;
      tilt += 0.12 * runF;
      // arm swing
      L[J.LHAND][2] = -sw * 0.16 * runF; L[J.RHAND][2] = sw * 0.16 * runF;
      L[J.LHAND][1] += Math.abs(sw) * 0.04 * runF; L[J.RHAND][1] += Math.abs(sw) * 0.04 * runF;
      // goofy waddle
      L[J.PELVIS][0] += sw * 0.02; L[J.HEAD][0] += sw * 0.025;
    } else {
      // breathing + idle sway
      const br = Math.sin(idleT * 2.1) * 0.008;
      L[J.LSH][1] += br; L[J.RSH][1] += br; L[J.HEAD][1] += br * 1.4;
      L[J.LHAND][2] += Math.sin(idleT * 1.3) * 0.015; L[J.RHAND][2] += Math.sin(idleT * 1.1 + 1) * 0.015;
      // occasional look around
      const look = Math.sin(idleT * 0.45) * Math.sin(idleT * 0.17);
      L[J.HEAD][0] += look * 0.04;
    }

    // ----- upper body by activity -----
    const a = this.anim;
    if (this.panic > 0 || a === 'panic') {
      const fl = t * 18 + this.id;
      L[J.LHAND][0] = 0.22; L[J.LHAND][1] = 0.98 + Math.sin(fl) * 0.1; L[J.LHAND][2] = 0.05;
      L[J.RHAND][0] = -0.22; L[J.RHAND][1] = 0.98 + Math.sin(fl + 2.5) * 0.1; L[J.RHAND][2] = 0.05;
      this.shout = Math.max(this.shout, 0.3);
    } else if (this.carry && this.carryMode === 'over') {
      L[J.LHAND][0] = 0.1; L[J.LHAND][1] = 1.04; L[J.LHAND][2] = 0.04;
      L[J.RHAND][0] = -0.1; L[J.RHAND][1] = 1.04; L[J.RHAND][2] = 0.04;
      tilt -= 0.04;
    } else if (this.carry && this.carryMode === 'front') {
      L[J.LHAND][0] = 0.13; L[J.LHAND][1] = 0.5; L[J.LHAND][2] = 0.2;
      L[J.RHAND][0] = -0.13; L[J.RHAND][1] = 0.5; L[J.RHAND][2] = 0.2;
      tilt -= 0.1;
    } else if (a === 'dig') {
      const c = (this.animT * 1.6) % 1;
      const down = c < 0.45 ? smoothstep(0, 0.45, c) : 1 - smoothstep(0.45, 1, c);
      L[J.RHAND][0] = -0.05; L[J.RHAND][1] = 0.62 - down * 0.25; L[J.RHAND][2] = 0.1 + down * 0.1;
      L[J.LHAND][0] = 0.06; L[J.LHAND][1] = 0.48 - down * 0.25; L[J.LHAND][2] = 0.22 + down * 0.08;
      tilt += 0.25 * down + 0.1;
    } else if (a === 'build') {
      const c = this.animT * 9 + this.id;
      L[J.LHAND][1] = 0.5 + Math.abs(Math.sin(c)) * 0.22; L[J.LHAND][2] = 0.24;
      L[J.RHAND][1] = 0.5 + Math.abs(Math.sin(c + 1.6)) * 0.22; L[J.RHAND][2] = 0.24;
      L[J.LHAND][0] = 0.1; L[J.RHAND][0] = -0.1;
      tilt += 0.2;
    } else if (a === 'gather') {
      const c = clamp(this.animT / 0.6, 0, 1);
      const down = Math.sin(c * Math.PI);
      tilt += 0.7 * down;
      L[J.LHAND][2] = 0.15 + down * 0.1; L[J.RHAND][2] = 0.15 + down * 0.1;
      L[J.LHAND][1] -= down * 0.1; L[J.RHAND][1] -= down * 0.1;
    } else if (a === 'cheer' || this.cheer > 0) {
      const hop = Math.abs(Math.sin(t * 7 + this.id));
      rootY += hop * 0.22 * s;
      L[J.LHAND][0] = 0.2; L[J.LHAND][1] = 1.05 + hop * 0.05;
      L[J.RHAND][0] = -0.2; L[J.RHAND][1] = 1.05 + hop * 0.05;
      this.shout = Math.max(this.shout, 0.2);
    } else if (a === 'talk') {
      const c = t * 6 + this.id;
      L[J.RHAND][1] = 0.55 + Math.sin(c) * 0.08; L[J.RHAND][2] = 0.16; L[J.RHAND][0] = -0.16 + Math.sin(c * 0.7) * 0.04;
      if (Math.sin(t * 1.3 + this.id) > 0.3) { L[J.LHAND][1] = 0.6 + Math.sin(c + 2) * 0.06; L[J.LHAND][2] = 0.12; }
      L[J.HEAD][1] += Math.abs(Math.sin(c * 0.9)) * 0.015;
    } else if (a === 'wave') {
      L[J.RHAND][0] = -0.26; L[J.RHAND][1] = 1.0 + Math.sin(t * 12) * 0.06; L[J.RHAND][2] = Math.sin(t * 12) * 0.08;
    } else if (a === 'point') {
      L[J.RHAND][0] = -0.12; L[J.RHAND][1] = 0.72; L[J.RHAND][2] = 0.3;
    } else if (a === 'pose') {
      // heroic declaration
      L[J.RHAND][0] = -0.2; L[J.RHAND][1] = 1.08; L[J.RHAND][2] = 0.06;
      L[J.LHAND][0] = 0.17; L[J.LHAND][1] = 0.42; L[J.LHAND][2] = -0.05;
      tilt -= 0.12;
    }

    // ----- attack overlay -----
    if (this.attackT >= 0) {
      const w = this.def.weapon;
      const at = this.attackT;
      if (w === 'bow') {
        const draw = smoothstep(0, 0.55, at) * (at < 0.75 ? 1 : 0);
        L[J.LHAND][0] = 0.04; L[J.LHAND][1] = 0.64; L[J.LHAND][2] = 0.34;
        L[J.RHAND][0] = -0.04; L[J.RHAND][1] = 0.66; L[J.RHAND][2] = 0.32 - draw * 0.28;
      } else {
        const wind = smoothstep(0, 0.4, at), strike = smoothstep(0.4, 0.55, at), rec = smoothstep(0.6, 1, at);
        const k = wind * (1 - strike);
        const hx = lerp(-0.18, -0.06, strike), hy = lerp(lerp(0.4, 0.95, wind), 0.42, strike), hz = lerp(lerp(0.02, -0.12, wind), 0.4, strike);
        L[J.RHAND][0] = lerp(hx, L[J.RHAND][0], rec); L[J.RHAND][1] = lerp(hy, L[J.RHAND][1], rec); L[J.RHAND][2] = lerp(hz, L[J.RHAND][2], rec);
        tilt += (strike * 0.25 - k * 0.12) * (1 - rec);
        L[J.LSH][2] += k * 0.05 - strike * 0.05; L[J.RSH][2] -= k * 0.05 - strike * 0.06;
        if (this.def.shield) { L[J.LHAND][0] = 0.16; L[J.LHAND][1] = 0.52; L[J.LHAND][2] = 0.22; }
      }
    } else if (this.def.shield && !this.carry && moving === false && a === 'idle') {
      L[J.LHAND][0] = 0.18; L[J.LHAND][1] = 0.45; L[J.LHAND][2] = 0.14;
    }

    // swimming: paddle
    if (this.swim > 0.3) {
      const c = t * 7 + this.id;
      L[J.LHAND][1] = 0.66 + Math.sin(c) * 0.08; L[J.LHAND][2] = 0.18 + Math.cos(c) * 0.12; L[J.LHAND][0] = 0.24;
      L[J.RHAND][1] = 0.66 + Math.sin(c + Math.PI) * 0.08; L[J.RHAND][2] = 0.18 + Math.cos(c + Math.PI) * 0.12; L[J.RHAND][0] = -0.24;
      this.shout = Math.max(this.shout, this.panic > 0 ? 0.3 : 0);
    }

    // sitting
    if (this.sit) {
      L[J.PELVIS][1] = 0.0; L[J.PELVIS][2] = -0.04;
      L[J.LSH][1] = 0.29; L[J.RSH][1] = 0.29; L[J.HEAD][1] = 0.53;
      L[J.LFOOT][1] = -0.18; L[J.RFOOT][1] = -0.18; L[J.LFOOT][2] = 0.2; L[J.RFOOT][2] = 0.2;
      L[J.LFOOT][0] = 0.1; L[J.RFOOT][0] = -0.1;
      if (a !== 'talk' && a !== 'point' && a !== 'wave' && a !== 'pose') {
        L[J.LHAND][1] = 0.12; L[J.LHAND][2] = 0.16; L[J.RHAND][1] = 0.12; L[J.RHAND][2] = 0.16;
        L[J.LHAND][0] = 0.17; L[J.RHAND][0] = -0.17;
      } else {
        for (const j of [J.LHAND, J.RHAND]) L[j][1] -= 0.33;
      }
    }

    // sleeping: lie on the back
    let lie = 0;
    if (this.sleep) lie = 1;

    // ----- write targets -----
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const sim = this.game.sim;
    const baseY = this.sit ? this.sit.y : this.pos.y;
    const pivotY = 0.06;
    const k0 = this.strength;
    for (let j = 0; j < 8; j++) {
      const i = P[j];
      if (i < 0) continue;
      let lx = L[j][0], ly = L[j][1], lz = L[j][2];
      if (j !== J.LFOOT && j !== J.RFOOT && !this.sit) {
        // tilt around the feet
        const y0 = ly - pivotY;
        const ny = y0 * ct - lz * st, nz = y0 * st + lz * ct;
        ly = ny + pivotY; lz = nz;
      }
      if (lie) {
        // rotate the whole pose to lie on the back (z = up axis of the body)
        const y0 = ly - 0.1;
        ly = 0.1 + lz * 0.6 + 0.12; lz = -y0;
      }
      let wx = this.pos.x + (b.lx * lx + b.fx * lz) * s;
      let wz = this.pos.z + (b.lz * lx + b.fz * lz) * s;
      let wy = baseY + ly * s + rootY;
      if ((j === J.LFOOT || j === J.RFOOT) && !this.sit && this.swim < 0.5 && !(this.jumpY > 0)) {
        const ground = this.perch ? this.perch.y : this.game.walkHeight(wx, wz);
        wy = Math.max(ground + (ly - 0.06) * s + RADII[j] * s, wy - 0.2);
      }
      let k = k0;
      if (j === J.LHAND || j === J.RHAND) k *= 0.42;
      else if (j === J.HEAD) k *= 0.5;
      else if (j === J.LFOOT || j === J.RFOOT) k *= this.swim > 0.5 ? 0.15 : 0.55;
      else k *= 0.6;
      V.setTarget(i, wx, wy, wz, k);
    }

    // timers
    if (this.attackT >= 0) {
      this.attackT += dt / (this.def.ranged ? 1.0 : 0.55);
      if (this.attackT >= 1) this.attackT = -1;
    }
    this.attackCooldown -= dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.shout = Math.max(0, this.shout - dt);
    this.panic = Math.max(0, this.panic - dt);
    this.cheer = Math.max(0, this.cheer - dt);
    if (this.stumpTimer > 0) {
      this.stumpTimer -= dt;
    }
    this.blinkT -= dt;
    if (this.blinkT < 0) { this.blink = 0.12; this.blinkT = rnd(1.5, 5); }
    this.blink = Math.max(0, this.blink - dt);
  }

  // Start a weapon swing; returns true when started.
  startAttack() {
    if (this.attackT >= 0 || this.attackCooldown > 0) return false;
    this.attackT = 0;
    this.attackCooldown = this.def.cooldown * rnd(0.9, 1.15);
    this.shout = 0.4;
    return true;
  }

  setAnim(a) {
    if (this.anim !== a) { this.anim = a; this.animT = 0; }
  }

  // Joint world position
  joint(j, out) {
    const V = this.game.verlet;
    const i = this.p[j];
    if (i === undefined || i < 0) return null;
    return out.set(V.px[i], V.py[i], V.pz[i]);
  }
}

const SYL = ['ba', 'bo', 'pip', 'ko', 'mu', 'di', 'lo', 'sa', 'ni', 'po', 'zu', 'ri', 'ta', 'fi', 'gu', 'mo', 'pe', 'du', 'bi', 'ra'];
function randomName() {
  const n = 2 + (Math.random() < 0.3 ? 1 : 0);
  let s = '';
  for (let i = 0; i < n; i++) s += SYL[Math.floor(Math.random() * SYL.length)];
  return s[0].toUpperCase() + s.slice(1);
}
