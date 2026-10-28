// Old Inkbeard, the Kraken. Rises from the deep under a pirate tricorn with a
// beard of little tentacles, then slaps, snatches and sweeps the beach with
// six enormous arms. An arm lying on the sand can be hacked off; the head can
// only be hit while it is above the water.
import * as THREE from 'three';
import { clamp, lerp, damp, dampAngle, rnd, pick, rndSign, smoothstep } from '../core/math.js';
import { J } from './Sandling.js';

export const KRAKEN = {
  name: 'Old Inkbeard, Terror of the Shallows',
  hp: 2600, armHp: 220, armor: 0.15, size: 6, boss: true, reach: 18,
  bounty: { treasure: 12, gems: 7, shells: 24 },
};

const ARMS = 6;
const K = 22; // spine control points per arm
const RINGS = 60; // rendered rings per arm
const RAD = 12; // vertices around each ring
const TOP = 0xa4405a, BELLY = 0xf6c3a6;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

// ---- skin -------------------------------------------------------------------------
// Blotchy wet skin, pale belly, two staggered rows of suckers that shrink toward
// the tip, raw calamari on a cut end. One instance per arm so each can flash.
function skinMaterial() {
  const flash = { value: 0 };
  const span = { value: new THREE.Vector2(0, 1) };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFlash = flash;
    sh.uniforms.uSpan = span;
    sh.uniforms.uTop = { value: new THREE.Color(TOP) };
    sh.uniforms.uBelly = { value: new THREE.Color(BELLY) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aUv;\nvarying vec3 vUv;\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUv = aUv;\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uFlash;
uniform vec2 uSpan;
uniform vec3 uTop, uBelly;
varying vec3 vUv;
varying vec3 vLocal;
float kHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float kNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(kHash(i), kHash(i + vec3(1, 0, 0)), f.x), mix(kHash(i + vec3(0, 1, 0)), kHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(kHash(i + vec3(0, 0, 1)), kHash(i + vec3(1, 0, 1)), f.x), mix(kHash(i + vec3(0, 1, 1)), kHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float th = vUv.y * 6.2831853;
  vec3 col;
  if (vUv.z > 2.5) {
    // the head: blotchy mantle over a paler chin
    float n = kNoise(vLocal * 1.3) * 0.6 + kNoise(vLocal * 3.7) * 0.4;
    col = mix(uTop * mix(0.72, 1.15, n), uBelly, smoothstep(0.3, 0.1, vUv.x));
    col *= 1.0 - smoothstep(0.62, 0.76, n) * 0.35;
  } else if (vUv.z > 0.5) {
    // a severed end: rings of raw calamari
    float rr = vUv.z - 1.0;
    col = mix(vec3(0.9, 0.42, 0.42), vec3(0.98, 0.8, 0.72), 0.5 + 0.5 * sin(rr * 19.0));
    col = mix(uTop * 0.75, col, smoothstep(0.0, 0.14, rr));
  } else {
    float U = mix(uSpan.x, uSpan.y, vUv.x);
    float under = smoothstep(-0.1, -0.55, cos(th));
    vec3 q = vec3(U * 11.0, cos(th) * 1.4, sin(th) * 1.4);
    float n = kNoise(q * 1.6) * 0.6 + kNoise(q * 4.3) * 0.4;
    col = mix(uTop * mix(0.74, 1.14, n), uBelly, under);
    col *= 1.0 - smoothstep(0.64, 0.78, n) * (1.0 - under) * 0.4;
    float w = -log(max(1.0 - 0.9 * U, 0.03)) * 24.0;
    vec2 a = vec2(fract(w) - 0.5, (th - 2.62) / 1.05);
    vec2 b = vec2(fract(w + 0.5) - 0.5, (th - 3.66) / 1.05);
    float d = min(length(a), length(b));
    float k = under * smoothstep(0.985, 0.93, U);
    col = mix(col, uBelly * 1.1 + 0.05, smoothstep(0.4, 0.34, d) * k);
    col = mix(col, uBelly * vec3(0.62, 0.42, 0.5), smoothstep(0.2, 0.13, d) * k);
  }
  diffuseColor.rgb = col;
}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.92, 0.88) * uFlash;');
  };
  mat.customProgramCacheKey = () => 'kraken-skin';
  return { mat, flash, span };
}

// ---- dynamic tube ---------------------------------------------------------------------
function catmull(out, p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  out.x = 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3);
  out.y = 0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3);
  out.z = 0.5 * (2 * p1.z + (p2.z - p0.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (3 * p1.z - p0.z - 3 * p2.z + p3.z) * t3);
  return out;
}

// A tapered tube re-laid along a spine every frame (arms, beard, cut-off chunks).
class Tube {
  constructor(parent, material, rings, rad) {
    this.rings = rings;
    this.rad = rad;
    const ring = rad + 1;
    const nv = rings * ring + ring + 1;
    this.pos = new Float32Array(nv * 3);
    this.nor = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 3);
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s <= rad; s++) {
        const k = (r * ring + s) * 3;
        uv[k] = r / (rings - 1);
        uv[k + 1] = s / rad;
      }
    }
    const c0 = rings * ring;
    for (let s = 0; s <= rad; s++) {
      const k = (c0 + s) * 3;
      uv[k] = 1; uv[k + 1] = s / rad; uv[k + 2] = 1;
    }
    uv[(c0 + ring) * 3] = 1;
    uv[(c0 + ring) * 3 + 2] = 2;
    const idx = [];
    for (let r = 0; r < rings - 1; r++) {
      for (let s = 0; s < rad; s++) {
        const a = r * ring + s, b = a + ring;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    for (let s = 0; s < rad; s++) idx.push(c0 + s, c0 + s + 1, c0 + ring);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.norAttr = new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.norAttr);
    g.setAttribute('aUv', new THREE.BufferAttribute(uv, 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.c = Array.from({ length: rings }, () => new THREE.Vector3());
    this.t = Array.from({ length: rings }, () => new THREE.Vector3());
    this.r = new Float32Array(rings);
    this.N = new THREE.Vector3();
    this.B = new THREE.Vector3();
  }

  // Lay the tube through `pts` with radius(s); the suckers face away from side × tangent.
  update(pts, radius, side) {
    const { rings, rad, c, t, pos, nor, N, B } = this;
    const n = pts.length;
    for (let r = 0; r < rings; r++) {
      const f = (r / (rings - 1)) * (n - 1);
      const i = Math.min(n - 2, Math.floor(f));
      catmull(c[r], pts[Math.max(0, i - 1)], pts[i], pts[i + 1], pts[Math.min(n - 1, i + 2)], f - i);
      this.r[r] = radius(r / (rings - 1));
    }
    for (let r = 0; r < rings; r++) {
      t[r].subVectors(c[Math.min(rings - 1, r + 1)], c[Math.max(0, r - 1)]);
      if (t[r].lengthSq() < 1e-12) t[r].copy(r ? t[r - 1] : UP);
      t[r].normalize();
    }
    N.crossVectors(t[0], side);
    if (N.lengthSq() < 1e-6) N.set(0, 1, 0);
    N.normalize();
    const ring = rad + 1;
    for (let r = 0; r < rings; r++) {
      const T = t[r];
      // parallel transport, nudged back toward the preferred "top" side
      N.addScaledVector(T, -N.dot(T));
      _v.crossVectors(T, side);
      const dl = _v.length();
      if (dl > 0.2) N.lerp(_v.multiplyScalar(1 / dl), 0.2);
      N.addScaledVector(T, -N.dot(T));
      if (N.lengthSq() < 1e-8) N.set(-T.y, T.x, 0);
      N.normalize();
      B.crossVectors(T, N);
      const rr = this.r[r];
      const seg = c[Math.min(rings - 1, r + 1)].distanceTo(c[Math.max(0, r - 1)]) || 1e-3;
      const slope = (this.r[Math.min(rings - 1, r + 1)] - this.r[Math.max(0, r - 1)]) / seg;
      const cx = c[r].x, cy = c[r].y, cz = c[r].z;
      for (let k = 0; k <= rad; k++) {
        const th = (k / rad) * Math.PI * 2;
        const cs = Math.cos(th), sn = Math.sin(th);
        const nx = N.x * cs + B.x * sn, ny = N.y * cs + B.y * sn, nz = N.z * cs + B.z * sn;
        const o = (r * ring + k) * 3;
        pos[o] = cx + nx * rr; pos[o + 1] = cy + ny * rr; pos[o + 2] = cz + nz * rr;
        const mx = nx - T.x * slope, my = ny - T.y * slope, mz = nz - T.z * slope;
        const ml = Math.hypot(mx, my, mz) || 1;
        nor[o] = mx / ml; nor[o + 1] = my / ml; nor[o + 2] = mz / ml;
      }
    }
    // flat end cap facing along the last tangent
    const last = (rings - 1) * ring, c0 = rings * ring;
    const T = t[rings - 1];
    for (let k = 0; k <= rad; k++) {
      const o = (c0 + k) * 3, q = (last + k) * 3;
      pos[o] = pos[q]; pos[o + 1] = pos[q + 1]; pos[o + 2] = pos[q + 2];
      nor[o] = T.x; nor[o + 1] = T.y; nor[o + 2] = T.z;
    }
    const o = (c0 + ring) * 3;
    pos[o] = c[rings - 1].x; pos[o + 1] = c[rings - 1].y; pos[o + 2] = c[rings - 1].z;
    nor[o] = T.x; nor[o + 1] = T.y; nor[o + 2] = T.z;
    this.posAttr.needsUpdate = true;
    this.norAttr.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

// Highest solid surface at (x, z): sand, rocks or the top of a building.
function topAt(game, x, z) {
  let y = game.sim.heightAt(x, z);
  const V = game.verlet;
  for (const C of V.colliders) {
    if (C.top > y && (C.building || C.top < 2.5)) {
      const dx = x - C.x, dz = z - C.z;
      if (dx * dx + dz * dz < C.r * C.r) y = C.top;
    }
  }
  for (const B of V.boxes) {
    if (B.top <= y) continue;
    const dx = x - B.x, dz = z - B.z;
    const lx = dx * B.c + dz * B.s, lz = -dx * B.s + dz * B.c;
    if (Math.abs(lx) < B.hx && Math.abs(lz) < B.hz) y = B.top;
  }
  return y;
}

// ---- the bit of an arm that sandlings can hit ----------------------------------------------
class ArmHitbox {
  constructor(arm) {
    this.arm = arm;
    this.kind = 'enemy';
    this.team = 1;
    this.type = 'krakenArm';
    this.def = { name: 'Kraken arm', boss: true, armor: 0 };
    this.size = 1.5;
    this.radius = 0.6;
    this.alive = false;
    this.removed = true; // never reaped by the crab manager
    this.deadTime = 0;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.p = [];
    this.held = false;
  }
  get hp() { return this.arm.hp; }
  get maxHp() { return this.arm.maxHp; }
  get isActive() { return this.alive; }
  centerPos(out) { return out.copy(this.pos); }
  preStep() {}
  applyImpulse() {}
  knockDown() {}
  hit(dmg, ix = 0, iy = 0, iz = 0, opts = {}) { this.arm.hurt(dmg, opts, ix, iz); }
}

// ---- one arm ----------------------------------------------------------------------------
const CALM = new Set(['idle', 'under', 'stump', 'limp', 'dive']);

class Arm {
  constructor(kr, i) {
    this.kr = kr;
    this.i = i;
    this.fan = lerp(-1.15, 1.15, i / (ARMS - 1));
    this.len = KRAKEN.reach * rnd(0.92, 1.06);
    this.r0 = rnd(0.56, 0.66);
    this.maxHp = KRAKEN.armHp * kr.hpMul;
    this.hp = this.maxHp;
    this.severed = false;
    this.cut = 1;
    this.state = 'under';
    this.t = 0;
    this.cd = rnd(0.5, 3);
    this.root = new THREE.Vector3();
    this.tip = new THREE.Vector3();
    this.tipGoal = new THREE.Vector3();
    this.tipVel = new THREE.Vector3();
    this.tipRate = 4;
    this.stiff = 8;
    this.lift = 1;
    this.liftGoal = 1;
    this.slack = 0;
    this.sway = 0.3;
    this.curl = 0;
    this.archBias = 0;
    // outer arms rear up beside the head; the middle ones snake low over the water
    const outer = Math.abs(this.fan) > 0.5;
    this.idleReach = outer ? rnd(0.34, 0.44) : rnd(0.56, 0.66);
    this.idleCurl = outer ? rnd(1.6, 2.6) : rnd(1.0, 1.6);
    this.idleHeight = outer ? rnd(1.6, 3.2) : rnd(0.2, 0.6);
    this.idleLift = outer ? 1 : 0.3;
    this.goal = Array.from({ length: K }, () => new THREE.Vector3());
    this.pts = Array.from({ length: K }, () => new THREE.Vector3());
    this.side = new THREE.Vector3(1, 0, 0);
    this.flash = 0;
    this.phase = rnd(0, 6.28);
    this.target = new THREE.Vector3();
    this.prey = null;
    this.victim = null;
    this.holdDmg = 0;
    this.struck = new Set();
    this.exposedAt = -1;
    this.hitbox = new ArmHitbox(this);
    this.skin = skinMaterial();
    this.tube = new Tube(kr.group, this.skin.mat, RINGS, RAD);
    this.radiusFn = (s) => this.radius(s);
    // a warning splat on the sand where the arm is about to land
    this.mark = new THREE.Mesh(kr.markGeo, kr.markMat.clone());
    this.mark.rotation.x = -Math.PI / 2;
    this.mark.visible = false;
    this.mark.renderOrder = 2;
    kr.game.scene.add(this.mark);
    // start curled up under the head
    kr.rootOf(this, this.root);
    this.tip.copy(this.root).add(_v.set(Math.sin(this.fan) * 3, -1, Math.cos(this.fan) * 3));
    this._spine(0);
    for (let k = 0; k < K; k++) this.pts[k].copy(this.goal[k]);
  }

  get busy() { return !CALM.has(this.state); }

  radius(s) {
    const S = s * this.cut;
    let r = this.r0 * (1 - 0.86 * S) * (1 + 0.3 * Math.exp(-S * 16));
    if (this.cut >= 1 && s > 0.95) r *= Math.sqrt(Math.max(0, (1 - s) / 0.05));
    return Math.max(r, 0.004);
  }

  go(state) {
    this.state = state;
    this.t = 0;
    this.struck.clear();
  }

  // forward-ish direction this arm likes to rest in
  _restDir(out) {
    const a = this.kr.yaw + this.fan * 1.35;
    return out.set(Math.sin(a), 0, Math.cos(a));
  }

  update(dt, time) {
    const kr = this.kr, game = kr.game, sim = game.sim;
    this.t += dt;
    this.cd -= dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    kr.rootOf(this, this.root);
    const L = this.len * this.cut;
    const rest = this._restDir(_v2);
    const surf = kr.surf;
    switch (this.state) {
      case 'under':
      case 'dive':
        this.tipGoal.copy(this.root).addScaledVector(rest, 3.5).setY(Math.min(this.root.y, surf - 2.2));
        this._set(3, 6, 1, 0.3, 0);
        break;
      case 'emerge':
        this.tipGoal.copy(this.root).addScaledVector(rest, L * 0.35).setY(surf + 5.5 + (this.i % 2) * 2);
        this._set(3.2, 7, 1, 0.4, 0.6);
        if (this.t > 1.4) this.go('idle');
        break;
      case 'idle':
        this._idleGoal(time, rest, L);
        this._set(2.5, 7, this.idleLift, 0.6, this.idleCurl);
        break;
      case 'raise':
        this.tipGoal.copy(this.root).addScaledVector(rest, L * 0.2).setY(surf + 10);
        this._set(3.5, 8, 0.6, 0.3, 1.6);
        break;
      case 'splash':
        this.tipGoal.copy(this.root).addScaledVector(rest, L * 0.62).setY(surf - 0.6);
        this._set(16, 22, 1, 0, 0);
        if (this.t > 0.3) this.go('retract');
        break;
      case 'windup': {
        const tg = this.target;
        const dx = this.root.x - tg.x, dz = this.root.z - tg.z, d = Math.hypot(dx, dz) || 1;
        this.tipGoal.set(tg.x + (dx / d) * 2.2, tg.y + 5.8, tg.z + (dz / d) * 2.2);
        this._set(4.5, 9, 1, 0.15, 0.4);
        this.archBias = 0.6;
        if (this.t > kr.windup) this.go('strike');
        break;
      }
      case 'strike':
        this.tipGoal.copy(this.target).setY(this.target.y + 0.3);
        this._set(30, 42, 1, 0, 0);
        this.archBias = 0.6;
        if (this.t > 0.16) { this._impact(); this.go('pinned'); }
        break;
      case 'pinned':
        this.tipGoal.copy(this.target).setY(this.target.y + 0.3);
        this._set(10, 12, 0, 0.25, 0);
        this.archBias = 0;
        if (this.t > 3.2) this.go('retract');
        break;
      case 'retract':
        this._idleGoal(time, rest, L);
        this._set(2.2, 8, 1, 0.3, 0.6);
        this.archBias = 0;
        this._plough(dt);
        if (this.t > 1.4) { this.go('idle'); this.cd = rnd(2.5, 5); }
        break;
      case 'reach': {
        const u = this.prey;
        if (!u || !u.alive || u.held || !u.p.length || u.hidden || this.t > 2.4) { this.prey = null; this.go('retract'); break; }
        u.centerPos(this.tipGoal);
        this.tipGoal.y += 0.15;
        if (this.tipGoal.distanceTo(this.root) > L * 0.97) { this.prey = null; this.go('retract'); break; }
        this._set(3.6, 11, 0.55, 0, 0);
        if (this.pts[K - 1].distanceTo(this.tipGoal) < 0.85) this._grab(u);
        break;
      }
      case 'lift':
        this._hold(dt);
        this.tipGoal.copy(kr.pos).addScaledVector(kr.fwd, 3.4).setY(kr.pos.y + 4.8);
        this._set(2.8, 9, 1, 0, 0.2);
        if (this.t > 1.2) {
          if (!this.victim) this.go('retract');
          else if (this.victim !== game.king && this.victim.alive && Math.random() < 0.3 && !kr.chewing) { kr.chewing = this; this.go('gulp'); }
          else this.go('fling');
        }
        break;
      case 'gulp':
        this._hold(dt);
        kr.mouthPos(this.tipGoal);
        this._set(3.2, 10, 1, 0, 0);
        kr.mouthGoal = 1;
        if (this.t > 1.0) { kr.eat(this.victim); this.victim = null; kr.chewing = null; this.go('retract'); }
        break;
      case 'fling': {
        this._hold(dt);
        // haul back over the head, then whip toward the beach and let go
        if (this.t < 0.4) {
          this.tipGoal.copy(kr.pos).addScaledVector(kr.fwd, -1.5).setY(kr.pos.y + 7);
          this._set(5, 12, 1, 0, 0);
        } else {
          this.tipGoal.copy(kr.pos).addScaledVector(kr.fwd, L * 0.8).setY(kr.pos.y + 2.5);
          this._set(14, 18, 1, 0, 0);
          if (this.t > 0.52 && this.victim) {
            const f = kr.fwd;
            this._release(_v.set(f.x * rnd(3, 6) + rnd(-3, 3), rnd(3, 5), f.z * rnd(3, 6) + rnd(-3, 3)));
          }
        }
        if (this.t > 0.85) this.go('retract');
        break;
      }
      case 'sweepWind':
        this._sweepPoint(this.sweepA0, this.tipGoal);
        this._set(3, 9, 0.8, 0, 0);
        if (this.t > 1.0) { this.go('sweep'); game.events.emit('tentacleSweep', this.hitbox); }
        break;
      case 'sweep': {
        const f = smoothstep(0, 1.25, this.t);
        this._sweepPoint(lerp(this.sweepA0, this.sweepA1, f), this.tipGoal);
        this._set(12, 16, 0.3, 0, 0);
        this._sweepHits(dt);
        this._plough(dt);
        if (this.t > 1.35) this.go('retract');
        break;
      }
      case 'flail': {
        if (Math.floor(this.t * 7) !== this._flailK) {
          this._flailK = Math.floor(this.t * 7);
          this.tipGoal.copy(this.root).add(_v.set(rnd(-4, 4), rnd(1, 4.5), rnd(-1, 4)));
        }
        this._set(9, 14, 1, 0, 0);
        const e = this.pts[K - 1];
        if (Math.random() < dt * 30) game.particles.spawn(6, e.x, e.y, e.z, rnd(-1, 1), rnd(-0.5, 1), rnd(-1, 1), rnd(1.5, 3), rnd(0.35, 0.6), 0.16, 0.06, 0.18, 0.7, 0, 0.8);
        if (this.t > 1.5) this.go('stump');
        break;
      }
      case 'stump':
        this.tipGoal.copy(this.root).addScaledVector(rest, L * 0.55).setY(surf + 0.6 + Math.sin(time * 2 + this.phase) * 0.4);
        this._set(2, 5, 1, 0.5, 0);
        break;
      case 'limp':
        this.tipGoal.copy(this.root).addScaledVector(rest, L * 0.8);
        this.tipGoal.y = Math.max(sim.heightAt(this.tipGoal.x, this.tipGoal.z), surf) - this.t * 0.35;
        this._set(1.4, 4, 0, 0.1, 0);
        break;
      default: break;
    }
    // move the tip, then lay the arm out from root to tip at full length
    _v3.copy(this.tip);
    this.tip.x = damp(this.tip.x, this.tipGoal.x, this.tipRate, dt);
    this.tip.y = damp(this.tip.y, this.tipGoal.y, this.tipRate, dt);
    this.tip.z = damp(this.tip.z, this.tipGoal.z, this.tipRate, dt);
    this.tipVel.subVectors(this.tip, _v3).divideScalar(dt);
    this.lift = damp(this.lift, this.liftGoal, 3, dt);
    this._spine(time);
    // follow-through: the outer arm lags behind the root
    this.pts[0].copy(this.goal[0]);
    for (let k = 1; k < K; k++) {
      const lam = lerp(this.stiff * 2.2, this.stiff, k / (K - 1));
      const p = this.pts[k], g = this.goal[k];
      p.x = damp(p.x, g.x, lam, dt); p.y = damp(p.y, g.y, lam, dt); p.z = damp(p.z, g.z, lam, dt);
    }
    // drape over sand, rocks and walls instead of sinking into them
    for (let k = 1; k < K; k++) {
      const p = this.pts[k];
      const floor = topAt(game, p.x, p.z) + this.radius(k / (K - 1)) * 0.85;
      if (p.y < floor) p.y = floor;
    }
    if (this.victim && this.state !== 'lift' && this.state !== 'gulp' && this.state !== 'fling') this._release(null);
    // water drips off raised arms, foam where they cut the surface
    if (Math.random() < dt * 6) {
      const k = 6 + Math.floor(Math.random() * (K - 7));
      const p = this.pts[k];
      if (p.y > surf + 0.6) game.particles.spawn(2, p.x, p.y - 0.3, p.z, rnd(-0.3, 0.3), -0.5, rnd(-0.3, 0.3), 1.2, 0.07, 0.8, 0.9, 1, 0.8);
      else if (Math.abs(p.y - surf) < 0.5 && sim.depthAt(p.x, p.z) > 0.2) game.particles.foamBurst(p.x, surf, p.z, 1, 0.5);
    }
  }

  _set(tipRate, stiff, lift, sway, curl) {
    this.tipRate = tipRate;
    this.stiff = stiff;
    this.liftGoal = lift;
    this.sway = sway;
    this.curl = curl;
  }

  _idleGoal(time, rest, L) {
    const kr = this.kr;
    const side = Math.sin(time * 0.5 + this.phase) * 1.2;
    this.tipGoal.copy(this.root).addScaledVector(rest, L * this.idleReach);
    this.tipGoal.x += rest.z * side;
    this.tipGoal.z -= rest.x * side;
    this.tipGoal.y = kr.surf + this.idleHeight + Math.sin(time * 0.8 + this.phase) * 0.7;
  }

  // Lay the spine from root to tip; the slack (length the straight line doesn't
  // use up) bulges into an arch over the top or a lazy S across the sand.
  _spine(time) {
    const A = this.root, T = this.tip;
    const L = this.len * this.cut;
    let dx = T.x - A.x, dy = T.y - A.y, dz = T.z - A.z;
    let chord = Math.hypot(dx, dy, dz);
    if (chord > L * 0.97) {
      const f = (L * 0.97) / chord;
      dx *= f; dy *= f; dz *= f;
      T.set(A.x + dx, A.y + dy, A.z + dz);
      chord = L * 0.97;
    }
    const hl = Math.hypot(dx, dz) || 1e-3;
    const fx = dx / hl, fz = dz / hl;
    this.side.set(fz, 0, -fx);
    const excess = L - chord;
    let k = excess > 0.01 ? Math.sqrt(4 * chord * excess) / Math.PI : 0;
    if (k > 0) {
      const l0 = this._lay(k, fx, fz, time);
      const e0 = l0 - chord;
      if (e0 > 1e-3) k *= Math.sqrt(Math.max(0, excess) / e0);
    }
    this.slack = k;
    this._lay(k, fx, fz, time);
  }

  _lay(k, fx, fz, time) {
    const A = this.root, T = this.tip, g = this.goal;
    const sx = this.side.x, sz = this.side.z;
    let len = 0;
    for (let i = 0; i < K; i++) {
      const s = i / (K - 1);
      const p = g[i];
      p.set(A.x + (T.x - A.x) * s, A.y + (T.y - A.y) * s, A.z + (T.z - A.z) * s);
      const bump = Math.sin(Math.PI * s);
      const up = k * this.lift * bump * (1 + this.archBias * (0.5 - s));
      const lat = k * (1 - this.lift) * Math.sin(Math.PI * 2.5 * s + this.phase * 0.3) * bump;
      const sw = this.sway * Math.sin(time * 1.7 + this.phase + s * 4.2) * s;
      const cu = this.curl * smoothstep(0.72, 1, s);
      p.x += sx * (lat + sw) - fx * cu * 0.6;
      p.y += up + cu;
      p.z += sz * (lat + sw) - fz * cu * 0.6;
      if (i) len += p.distanceTo(g[i - 1]);
    }
    return len;
  }

  // ---- attacks -------------------------------------------------------------------------
  attack() {
    const kr = this.kr, game = kr.game;
    const R = this.len * this.cut * 0.88;
    const rx = this.root.x, rz = this.root.z;
    const reach = (x, z) => { const d = Math.hypot(x - rx, z - rz); return d < R && d > 3; };
    const units = game.units.filter((u) => u.alive && !u.hidden && !u.held && !u.puppet && !u.garrisoned && u.p.length && reach(u.pos.x, u.pos.z));
    const blds = game.buildings.list.filter((b) => b.alive && reach(b.pos.x, b.pos.z));
    const r = Math.random();
    if (units.length && r < 0.36) {
      // snatch someone, preferring whoever stands closest to the water
      units.sort((a, b) => a.pos.distanceToSquared(this.root) - b.pos.distanceToSquared(this.root));
      const u = units[Math.floor(Math.random() * Math.min(3, units.length))];
      if (u !== game.king || Math.random() < 0.3) { this.prey = u; this.go('reach'); return true; }
    }
    if (units.length >= 3 && r < 0.56) {
      let cx = 0, cz = 0;
      for (const u of units) { cx += u.pos.x; cz += u.pos.z; }
      cx /= units.length; cz /= units.length;
      const a = Math.atan2(cx - rx, cz - rz);
      const dir = rndSign();
      this.sweepA0 = a - 0.8 * dir;
      this.sweepA1 = a + 0.8 * dir;
      this.sweepR = clamp(Math.hypot(cx - rx, cz - rz), 5, R);
      this.go('sweepWind');
      return true;
    }
    if (blds.length && r < 0.86) {
      const b = pick(blds);
      const dx = b.pos.x - rx, dz = b.pos.z - rz, d = Math.hypot(dx, dz) || 1;
      const tx = b.pos.x - (dx / d) * b.radius * 0.35, tz = b.pos.z - (dz / d) * b.radius * 0.35;
      this.target.set(tx, topAt(game, tx, tz), tz);
      this.go('windup');
      return true;
    }
    if (units.length) {
      const u = pick(units);
      this.target.set(u.pos.x, topAt(game, u.pos.x, u.pos.z), u.pos.z);
      this.go('windup');
      return true;
    }
    return false;
  }

  _sweepPoint(a, out) {
    const game = this.kr.game;
    out.set(this.root.x + Math.sin(a) * this.sweepR, 0, this.root.z + Math.cos(a) * this.sweepR);
    out.y = topAt(game, out.x, out.z) + 0.55;
    return out;
  }

  _impact() {
    const kr = this.kr, game = kr.game, sim = game.sim;
    const p = this.target;
    const R = 2.1;
    for (const u of game.units) {
      if (!u.alive || !u.p.length || u.hidden || u.puppet) continue;
      const dx = u.pos.x - p.x, dz = u.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const f = 1 - d / R;
      u.hit((10 + 22 * f) * kr.dmgMul, (dx / (d || 1)) * 9 * f, 5 + 4 * f, (dz / (d || 1)) * 9 * f, { knock: true, sever: f > 0.55 });
    }
    for (const b of game.buildings.list) {
      if (!b.alive) continue;
      if (Math.hypot(b.pos.x - p.x, b.pos.z - p.z) - b.radius < 0.9) b.damage(95 * kr.dmgMul, 'crab', _v.copy(p));
    }
    if (sim.depthAt(p.x, p.z) > 0.12) {
      game.particles.splash(p.x, sim.surfaceAt(p.x, p.z), p.z, 40, 2.0);
      sim.splashWater(p.x, p.z, 2.6, -0.4);
    } else {
      const res = sim.dig(p.x, p.z, 1.5, 0.26);
      game.particles.sandSpray(p.x, sim.heightAt(p.x, p.z) + 0.1, p.z, 0, 0, 46, res.vol, res.wet, 1.6);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        game.particles.dust(p.x + Math.cos(a) * 1.6, p.y + 0.1, p.z + Math.sin(a) * 1.6, 1, 1.0);
      }
    }
    game.rig.addShake(0.5);
    game.events.emit('tentacleSlam', this.hitbox, p);
  }

  _sweepHits() {
    const kr = this.kr, game = kr.game, sim = game.sim;
    const v = this.tipVel, sp = Math.hypot(v.x, v.z) || 1;
    const nx = v.x / sp, nz = v.z / sp;
    for (let k = Math.round(K * 0.35); k < K; k += 2) {
      const p = this.pts[k];
      if (sim.depthAt(p.x, p.z) > 0.4) continue;
      const r = this.radius(k / (K - 1)) + 0.45;
      game.spatial.query(p.x, p.z, r + 0.4, (o) => {
        if (o.kind !== 'unit' || !o.alive || this.struck.has(o) || o.puppet) return;
        if (Math.hypot(o.pos.x - p.x, o.pos.z - p.z) > r || Math.abs(o.pos.y - p.y) > 1.4) return;
        this.struck.add(o);
        o.hit(13 * kr.dmgMul, nx * 10, 5, nz * 10, { knock: true });
      });
      for (const b of game.buildings.list) {
        if (!b.alive || this.struck.has(b)) continue;
        if (Math.hypot(b.pos.x - p.x, b.pos.z - p.z) < b.radius + 0.3 && p.y < b.baseY + b.height + 0.5) {
          this.struck.add(b);
          b.damage(45 * kr.dmgMul, 'crab', _v.copy(p));
        }
      }
    }
  }

  // drag a groove through the sand where the tip scrapes along
  _plough(dt) {
    const game = this.kr.game, sim = game.sim;
    const e = this.pts[K - 2];
    const g = sim.heightAt(e.x, e.z);
    if (e.y - g > 0.7 || sim.depthAt(e.x, e.z) > 0.15) return;
    if (Math.hypot(this.tipVel.x, this.tipVel.z) < 1) return;
    const res = sim.dig(e.x, e.z, 0.5, 0.6 * dt);
    sim.deposit(e.x + this.side.x * 0.6, e.z + this.side.z * 0.6, 0.4, res.vol * 0.5, res.wet);
    sim.deposit(e.x - this.side.x * 0.6, e.z - this.side.z * 0.6, 0.4, res.vol * 0.5, res.wet);
    if (Math.random() < dt * 12) game.particles.dust(e.x, g + 0.1, e.z, 1, 0.6);
  }

  // ---- grabbing ------------------------------------------------------------------------
  _grab(u) {
    const game = this.kr.game;
    this.prey = null;
    this.victim = u;
    this.holdDmg = 0;
    u.held = true;
    u.grabbedBy = this.hitbox;
    u.knockDown(3);
    game.events.emit('tentacleGrab', this.hitbox, u);
    this.go('lift');
  }

  _hold() {
    const u = this.victim;
    if (!u || !u.p.length) { this.victim = null; return; }
    const V = this.kr.game.verlet;
    const e = this.pts[K - 1];
    const pi = u.p[J.PELVIS];
    if (pi < 0) return;
    // wrap the tip around the waist and carry it along at the tip's speed
    V.px[pi] = e.x; V.py[pi] = e.y - 0.12; V.pz[pi] = e.z;
    V.ox[pi] = e.x - this.tipVel.x / 60; V.oy[pi] = e.y - 0.12 - this.tipVel.y / 60; V.oz[pi] = e.z - this.tipVel.z / 60;
    u.knocked = Math.max(u.knocked, 0.6);
    u.panic = 1;
  }

  _release(impulse) {
    const u = this.victim;
    if (!u) return;
    this.victim = null;
    u.held = false;
    u.grabbedBy = null;
    u.knockDown(2.5);
    u.thrownT = this.kr.game.time;
    if (impulse) {
      u.applyImpulse(impulse.x, impulse.y, impulse.z);
      this.kr.game.events.emit('crabThrow', this.kr, u);
    }
  }

  // ---- getting hurt ---------------------------------------------------------------------
  hurt(dmg, opts = {}, ix = 0, iz = 0) {
    const kr = this.kr;
    if (this.severed || !kr.alive) return;
    const real = dmg * (opts.fire ? 1.3 : 1);
    // the body feels a share of what the arm soaks up (no more than the arm had left)
    kr.hp -= Math.min(real, Math.max(0, this.hp)) * 0.45;
    this.hp -= real;
    this.flash = 1;
    if (this.victim) {
      this.holdDmg += real;
      if (this.holdDmg > 45) { this._release(_v.set(rnd(-1, 1), 2, rnd(-1, 1))); this.go('retract'); }
    }
    const j = this.exposedAt >= 0 ? this.exposedAt : K - 3;
    for (let k = Math.max(1, j - 3); k < Math.min(K, j + 4); k++) {
      this.pts[k].x += ix * 0.015; this.pts[k].y += 0.1; this.pts[k].z += iz * 0.015;
    }
    kr.game.events.emit('enemyHit', this.hitbox, real, opts);
    if (this.hp <= 0) this.sever();
    else if (kr.hp <= 0) kr.die();
  }

  sever() {
    const kr = this.kr, game = kr.game;
    if (this.severed) return;
    const j = clamp(this.exposedAt >= 0 ? this.exposedAt - 1 : Math.round(K * 0.55), 5, K - 4);
    this.severed = true;
    this._release(_v.set(0, 2, 0));
    this.prey = null;
    const cutAt = this.cut * (j / (K - 1));
    kr.addChunk(this, j, cutAt);
    // the stump keeps its inner points, re-spread over the shorter length
    const inner = this.pts.slice(0, j + 1).map((p) => p.clone());
    for (let k = 0; k < K; k++) {
      const f = (k / (K - 1)) * j;
      const i = Math.min(j - 1, Math.floor(f));
      this.pts[k].lerpVectors(inner[i], inner[i + 1], f - i);
    }
    this.tip.copy(this.pts[K - 1]);
    this.cut = cutAt;
    this.skin.span.value.set(0, cutAt);
    this.go('flail');
    kr.hp -= kr.maxHp * 0.07;
    kr.hurtT = 1.4;
    game.slowmo = Math.max(game.slowmo, 0.45);
    const e = this.pts[K - 1];
    for (let i = 0; i < 18; i++) game.particles.spawn(6, e.x, e.y, e.z, rnd(-2, 2), rnd(0, 2.5), rnd(-2, 2), rnd(2, 4), rnd(0.4, 0.8), 0.15, 0.05, 0.17, 0.75, 0, 1);
    game.particles.spurt(e.x, e.y, e.z, 0, 1.5, 0, 16, 0.9);
    game.rig.addShake(0.35);
    game.events.emit('krakenSever', this.hitbox, e.clone());
    if (kr.hp <= 0) kr.die();
  }

  dispose() {
    this.tube.dispose();
    this.mark.removeFromParent();
    this.mark.material.dispose();
  }
}

// ---- head pieces ------------------------------------------------------------------------
function mantleGeometry() {
  const prof = [[0.01, -1.85], [1.4, -1.75], [1.95, -1.25], [2.06, -0.45], [2.0, 0.35], [1.92, 0.9], [2.12, 1.5], [2.36, 2.2], [2.3, 3.0], [1.96, 3.7], [1.32, 4.25], [0.52, 4.52], [0.01, 4.58]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 34);
  const pos = g.attributes.position, uv = g.attributes.uv;
  const aUv = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // the bulb leans back away from the beach
    if (y > 1) pos.setZ(i, pos.getZ(i) - Math.pow(y - 1, 1.5) * 0.2);
    aUv[i * 3] = uv.getY(i);
    aUv[i * 3 + 1] = uv.getX(i);
    aUv[i * 3 + 2] = 3;
  }
  g.setAttribute('aUv', new THREE.BufferAttribute(aUv, 3));
  g.computeVertexNormals();
  return g;
}

function hatBrimGeometry() {
  const segA = 60, segR = 6;
  const pos = [];
  const idx = [];
  const edge = [];
  for (let j = 0; j <= segR; j++) {
    const t = j / segR;
    for (let i = 0; i <= segA; i++) {
      const a = (i / segA) * Math.PI * 2;
      const lobe = 0.5 + 0.5 * Math.cos(3 * a);
      const r = lerp(1.0, 2.1, t) * (0.86 + 0.22 * lobe);
      const y = 0.1 + t * t * (0.95 - 0.7 * lobe);
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      if (j === segR && i < segA) edge.push(new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r));
    }
  }
  for (let j = 0; j < segR; j++) {
    for (let i = 0; i < segA; i++) {
      const a = j * (segA + 1) + i, b = a + segA + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const trim = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(edge, true), 120, 0.055, 6, true);
  return { brim: g, trim };
}

// ---- the beast ------------------------------------------------------------------------------
export class Kraken {
  constructor(game, x, z, opts = {}) {
    this.game = game;
    this.kind = 'enemy';
    this.team = 1;
    this.type = 'kraken';
    this.def = KRAKEN;
    this.size = KRAKEN.size;
    this.radius = 2.3;
    this.offshore = true; // melee can't wade out to the head
    this.hpMul = opts.hpMul || 1;
    this.dmgMul = 1 + (this.hpMul - 1) * 0.5;
    this.maxHp = KRAKEN.hp * this.hpMul;
    this.hp = this.maxHp;
    this.alive = true;
    this.removed = true; // the crab manager never reaps us; we sink away ourselves
    this.deadTime = 0;
    this.p = [];
    this.held = false;
    this.flash = 0;
    this.vel = new THREE.Vector3();
    this.home = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1);
    this._pickHome(x);
    this.pos.copy(this.home);
    this.surf = game.sim.surfaceAt(this.home.x, this.home.z);
    this.yaw = 0;
    this.sub = 1;
    this.subGoal = 1;
    this.subRate = 1;
    this.state = 'rise';
    this.t = 0;
    this.attackCd = 2.5;
    this.waveCd = rnd(16, 22);
    this.homeT = 5;
    this.windup = 1.15;
    this.mouth = 0;
    this.mouthGoal = 0;
    this.hurtT = 0;
    this.dives = 0;
    this.chewing = null;
    this.blinkT = rnd(2, 5);
    this.blink = 0;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.markGeo = new THREE.CircleGeometry(2.1, 40);
    this.markMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uP: { value: 0 }, uT: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float uP, uT;
        void main(){
          float r = length(vUv * 2.0 - 1.0);
          float rim = smoothstep(0.84, 0.94, r) * (1.0 - smoothstep(0.95, 1.0, r));
          float fill = smoothstep(1.0, 0.0, r) * (0.25 + 0.45 * uP);
          float pulse = 0.65 + 0.35 * sin(uT * 16.0);
          vec3 c = mix(vec3(0.16, 0.02, 0.12), vec3(1.0, 0.36, 0.22), rim);
          gl_FragColor = vec4(c, (rim * pulse + fill * (1.0 - rim)) * smoothstep(0.0, 0.15, uP));
        }`,
    });
    this._buildHead();
    this.arms = [];
    for (let i = 0; i < ARMS; i++) this.arms.push(new Arm(this, i));
    this.chunks = [];
    game.sky.gloomTarget = 1;
  }

  // a spot offshore in water deep enough to hide in, in front of the castle
  _pickHome(x) {
    const game = this.game, sim = game.sim;
    if (x === undefined || x === 0) x = game.keep ? game.keep.pos.x + rnd(-6, 6) : rnd(-15, 15);
    x = clamp(x, -36, 36);
    let z = -34;
    for (let zz = -34; zz < 14; zz += 0.5) {
      if (sim.depthAt(x, zz) < 1.6) { z = zz - 1.5; break; }
    }
    this.home.set(x, 0, clamp(z, -34, 4));
  }

  rootOf(a, out) {
    const lx = Math.sin(a.fan) * 2.1, lz = Math.cos(a.fan) * 0.9 - 0.2;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return out.set(this.pos.x + lx * c + lz * s, this.pos.y - 1.8, this.pos.z - lx * s + lz * c);
  }

  mouthPos(out) {
    return out.copy(this.pos).addScaledVector(this.fwd, 2.1).setY(this.pos.y - 0.45);
  }

  get isActive() { return this.alive; }
  centerPos(out) { return out.set(this.pos.x, this.pos.y + 0.7, this.pos.z); }
  applyImpulse() {}
  knockDown() {}

  hit(dmg, ix = 0, iy = 0, iz = 0, opts = {}) {
    if (!this.alive) return;
    if (this.sub > 0.6) {
      // ducked under: the shot just splashes
      this.game.particles.splash(this.pos.x, this.surf, this.pos.z, 4, 0.5);
      return;
    }
    const real = dmg * (1 - KRAKEN.armor) * (opts.fire ? 1.2 : 1);
    this.hp -= real;
    this.flash = 1;
    this.game.events.emit('enemyHit', this, real, opts);
    if (this.hp <= 0) this.die();
  }

  die() {
    if (!this.alive) return;
    const game = this.game;
    this.alive = false;
    this.hp = 0;
    this.state = 'dying';
    this.t = 0;
    this.subGoal = 0.1;
    this.mouthGoal = 1;
    for (const a of this.arms) {
      a._release(_v.set(rnd(-2, 2), 3, rnd(-2, 2)));
      a.prey = null;
      a.go(a.severed ? 'limp' : 'flail');
    }
    game.sky.gloomTarget = 0;
    game.rig.addShake(0.9);
    game.events.emit('enemyDied', this, {});
    game.events.emit('krakenDying', this);
  }

  // swallow a sandling whole (a hat and a puff of sand come back out)
  eat(u) {
    const game = this.game;
    if (!u) return;
    u.held = false;
    u.grabbedBy = null;
    const m = this.mouthPos(_v);
    if (u.alive) u.die();
    u.crumble();
    game.particles.sandSpray(m.x, m.y, m.z, this.fwd.x * 2, this.fwd.z * 2, 14, 0.02, 0.6, 1);
    for (let i = 0; i < 8; i++) game.particles.spawn(6, m.x, m.y, m.z, rnd(-1, 1), rnd(0.5, 1.5), rnd(-1, 1), rnd(1.5, 3), rnd(0.3, 0.5), 0.15, 0.05, 0.17, 0.6, 0, 0.6);
    this.mouthGoal = 0;
    this.chew = 1.2;
    game.events.emit('krakenGulp', this, u);
  }

  addChunk(arm, j, cutAt) {
    // reversed, so the cut face (where the tube is capped) comes last
    const pts = [], old = [];
    for (let k = K - 1; k >= j; k--) {
      pts.push(arm.pts[k].clone());
      old.push(arm.pts[k].clone().addScaledVector(arm.tipVel, -0.4 / 60));
    }
    const rest = pts.map((p, i) => (i ? p.distanceTo(pts[i - 1]) : 0));
    const skin = skinMaterial();
    skin.span.value.set(1, cutAt);
    const ch = { pts, old, rest, skin, life: 7.5, r0: arm.r0, cutAt, phase: rnd(0, 6), side: new THREE.Vector3(1, 0, 0), fade: 1 };
    ch.radius = (s) => {
      const S = lerp(1, cutAt, s);
      let r = ch.r0 * (1 - 0.86 * S);
      if (s < 0.05) r *= Math.sqrt(s / 0.05);
      return Math.max(0.004, r * ch.fade);
    };
    ch.tube = new Tube(this.group, skin.mat, 30, 10);
    this.chunks.push(ch);
  }

  // ---- per physics step ----------------------------------------------------------------------
  preStep(dt) {
    const game = this.game, sim = game.sim;
    if (this.disposed) return;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.chew = Math.max(0, (this.chew || 0) - dt);
    // drift toward home and bob with the swell
    if (this.state === 'fight') {
      this.homeT -= dt;
      if (this.homeT <= 0) { this.homeT = 5; this._pickHome(this.home.x); }
    }
    this.pos.x = damp(this.pos.x, this.home.x, 0.5, dt);
    this.pos.z = damp(this.pos.z, this.home.z, 0.5, dt);
    this.surf = damp(this.surf, sim.surfaceAt(this.pos.x, this.pos.z), 2, dt);
    this.sub = damp(this.sub, this.subGoal, this.subRate, dt);
    this.pos.y = this.surf + lerp(0.55, -7, this.sub) + Math.sin(this.t * 0.9) * 0.12;
    const keep = game.keep;
    const kx = keep ? keep.pos.x : this.pos.x, kz = keep ? keep.pos.z : this.pos.z + 10;
    if (this.alive) this.yaw = dampAngle(this.yaw, clamp(Math.atan2(kx - this.pos.x, kz - this.pos.z), -0.7, 0.7), 1.2, dt);
    this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.mouthGoal = this.chewing ? 1 : this.state === 'roar' && this.t < 1.6 ? 1 : this.state === 'dying' ? 0.8 : this.mouthGoal * 0.98;
    this.mouth = damp(this.mouth, this.mouthGoal, 6, dt);

    switch (this.state) {
      case 'rise': this._rise(dt); break;
      case 'fight': this._fight(dt); break;
      case 'roar': this._roar(dt); break;
      case 'dive': this._dive(dt); break;
      case 'dying': this._dying(dt); break;
      default: break;
    }
    for (const a of this.arms) a.update(dt, this.t);
    this._chunks(dt);
    this._exposure();
  }

  _rise() {
    const game = this.game, sim = game.sim, p = game.particles;
    const t = this.t;
    if (t < 1.8 && Math.random() < 0.6) {
      const a = rnd(0, 6.28), r = rnd(0, 4.5);
      p.foamBurst(this.home.x + Math.cos(a) * r, this.surf, this.home.z + Math.sin(a) * r, 2, 0.8);
    }
    if (this._once('bulge', t > 0.2)) sim.splashWater(this.home.x, this.home.z, 5, 0.45);
    if (this._once('up', t > 1.6)) { this.subGoal = 0; this.subRate = 1.5; }
    if (this._once('splash', t > 2.0)) this._breach();
    for (const a of this.arms) if (a.state === 'under' && t > 2.1 + a.i * 0.12) a.go('emerge');
    if (this._once('roar', t > 2.8)) this._roarFx();
    if (t > 4.4) { this.state = 'fight'; this.t = 0; }
  }

  _breach() {
    const game = this.game, sim = game.sim, p = game.particles;
    p.splash(this.pos.x, this.surf, this.pos.z, 90, 3.2);
    p.foamBurst(this.pos.x, this.surf, this.pos.z, 30, 2);
    sim.splashWater(this.pos.x, this.pos.z, 5.5, 0.6);
    sim.addPulse(0.7, 6, this.yaw * 0.5);
    game.rig.addShake(0.7);
    game.events.emit('krakenBreach', this);
  }

  _roarFx() {
    this.mouthGoal = 1;
    this.game.rig.addShake(0.6);
    this.game.events.emit('krakenRoar', this);
  }

  _once(key, cond) {
    const k = '_o_' + key + this.state;
    if (!cond || this[k]) return false;
    this[k] = true;
    return true;
  }

  _fight(dt) {
    const f = this.hp / this.maxHp;
    if ((f < 0.66 && this.dives < 1) || (f < 0.33 && this.dives < 2)) { this._setState('dive'); return; }
    this.windup = f > 0.5 ? 1.15 : 0.9;
    this.attackCd -= dt;
    this.waveCd -= dt;
    let busy = 0;
    for (const a of this.arms) if (a.busy) busy++;
    const maxBusy = f > 0.66 ? 2 : f > 0.33 ? 3 : 4;
    if (this.attackCd <= 0 && busy < maxBusy) {
      const free = this.arms.filter((a) => a.state === 'idle' && a.cd <= 0);
      if (free.length) {
        const a = pick(free);
        if (a.attack()) this.attackCd = rnd(1.3, 2.6) * (f > 0.5 ? 1 : 0.7);
        else { a.cd = 1.5; this.attackCd = 0.4; }
      }
    }
    if (this.waveCd <= 0 && busy === 0) this._setState('roar');
  }

  _setState(s) {
    this.state = s;
    this.t = 0;
    for (const k of Object.keys(this)) if (k.startsWith('_o_')) delete this[k];
  }

  // rear up, raise every free arm and slap the sea into a wave
  _roar() {
    const game = this.game, t = this.t;
    if (this._once('start', true)) {
      this._roarFx();
      for (const a of this.arms) if (a.state === 'idle') a.go('raise');
    }
    if (this._once('slap', t > 1.2)) {
      for (const a of this.arms) if (a.state === 'raise') a.go('splash');
    }
    if (this._once('wave', t > 1.45)) {
      const f = this.hp / this.maxHp;
      game.sim.addPulse(0.85 + (1 - f) * 0.35, 6, this.yaw * 0.6);
      for (const a of this.arms) {
        const e = a.pts[K - 1];
        game.particles.splash(e.x, this.surf, e.z, 30, 2.2);
        game.sim.splashWater(e.x, e.z, 3, -0.4);
      }
      game.rig.addShake(0.8);
      game.events.emit('krakenWave', this);
    }
    if (t > 2.4) {
      for (const a of this.arms) if (a.state === 'raise') a.go('retract');
      this.waveCd = rnd(20, 28);
      this._setState('fight');
    }
  }

  // duck under, reappear somewhere else along the shore
  _dive() {
    const game = this.game, t = this.t;
    if (this._once('down', true)) {
      this.subGoal = 1;
      this.subRate = 1.3;
      for (const a of this.arms) { a._release(_v.set(0, 2, 0)); a.prey = null; if (!a.severed) a.go('dive'); }
      game.particles.splash(this.pos.x, this.surf, this.pos.z, 50, 2.4);
      game.events.emit('krakenDive', this);
    }
    if (this._once('move', t > 2.6)) {
      const x = clamp(this.home.x + rndSign() * rnd(9, 15), -36, 36);
      this._pickHome(x);
      this.pos.x = this.home.x;
      this.pos.z = this.home.z;
      this.surf = game.sim.surfaceAt(this.pos.x, this.pos.z);
    }
    if (t > 2.8 && t < 3.8 && Math.random() < 0.5) {
      const a = rnd(0, 6.28), r = rnd(0, 4);
      game.particles.foamBurst(this.home.x + Math.cos(a) * r, this.surf, this.home.z + Math.sin(a) * r, 2, 0.8);
    }
    if (this._once('up', t > 3.6)) { this.subGoal = 0; this.subRate = 1.6; }
    if (this._once('splash', t > 4.0)) {
      this._breach();
      for (const a of this.arms) if (!a.severed) a.go('emerge');
    }
    if (this._once('roar', t > 4.6)) this._roarFx();
    if (t > 5.8) {
      this.dives++;
      this.attackCd = 1;
      this._setState('fight');
    }
  }

  _dying() {
    const game = this.game, t = this.t, p = game.particles;
    if (this._once('limp', t > 1.6)) for (const a of this.arms) a.go('limp');
    if (this._once('loot', t > 2.4)) this._coughUpHoard();
    if (this._once('sink', t > 3.6)) { this.subGoal = 1; this.subRate = 0.45; }
    if (t > 3 && Math.random() < 0.4) p.spawn(6, this.pos.x + rnd(-2, 2), this.surf + 0.2, this.pos.z + rnd(-2, 2), rnd(-0.5, 0.5), rnd(0, 0.6), rnd(-0.5, 0.5), rnd(2, 4), rnd(0.6, 1.2), 0.14, 0.05, 0.16, 0.5, 0, 1.2);
    if (t > 8.5) this.dispose();
  }

  // the hoard it had been sitting on comes flying out onto the beach
  _coughUpHoard() {
    const game = this.game, sim = game.sim;
    const m = this.mouthPos(new THREE.Vector3());
    // find dry sand in front
    let lz = this.pos.z;
    for (let z = this.pos.z; z < this.pos.z + 40; z += 0.5) if (sim.depthAt(this.pos.x, z) < 0.05) { lz = z; break; }
    const b = KRAKEN.bounty;
    const list = [];
    for (let i = 0; i < b.treasure; i++) list.push('coin');
    for (let i = 0; i < b.gems; i++) list.push('gem');
    for (let i = 0; i < b.shells; i++) list.push('shell');
    for (const type of list) {
      const tx = this.pos.x + rnd(-6, 6), tz = lz + rnd(1, 6);
      const T = rnd(1.1, 1.6);
      const ty = sim.heightAt(tx, tz);
      const vel = new THREE.Vector3((tx - m.x) / T, (ty - m.y + 4.9 * T * T) / T, (tz - m.z) / T);
      game.items.spawn(type, m.x, m.z, { y: m.y, vel });
    }
    game.particles.sparkle(m.x, m.y, m.z, 30, [1, 0.85, 0.4], 1, 0.2);
    game.events.emit('krakenHoard', this, m);
  }

  _chunks(dt) {
    const game = this.game, sim = game.sim;
    for (let c = this.chunks.length - 1; c >= 0; c--) {
      const ch = this.chunks[c];
      ch.life -= dt;
      const n = ch.pts.length;
      const wr = clamp((ch.life - 1.5) / 6);
      ch.fade = clamp(ch.life / 1.2);
      for (let i = 0; i < n; i++) {
        const p = ch.pts[i], o = ch.old[i];
        let vx = (p.x - o.x) * 0.985, vy = (p.y - o.y) * 0.985, vz = (p.z - o.z) * 0.985;
        o.copy(p);
        const ground = sim.heightAt(p.x, p.z);
        const surf = ground + sim.depthAt(p.x, p.z);
        const wet = p.y < surf;
        vy -= (wet ? 2 : 9.8) * dt * dt;
        if (wet) { vx *= 0.95; vy *= 0.95; vz *= 0.95; }
        // a fish-flop: a wave of sideways kicks running down the chunk
        const kick = Math.sin(this.t * 15 + i * 0.9 + ch.phase) * wr * 0.014;
        vx += ch.side.x * kick;
        vz += ch.side.z * kick;
        if (i === n >> 1 && Math.random() < dt * 2.2 * wr) vy += 0.11 * wr;
        p.x += vx; p.y += vy; p.z += vz;
        const r = ch.radius(i / (n - 1));
        if (p.y < ground + r) {
          p.y = ground + r;
          o.x = p.x - vx * 0.5;
          o.z = p.z - vz * 0.5;
        }
      }
      for (let it = 0; it < 3; it++) {
        for (let i = 1; i < n; i++) {
          const a = ch.pts[i - 1], b = ch.pts[i];
          _v.subVectors(b, a);
          const d = _v.length() || 1e-4;
          const corr = (d - ch.rest[i]) / d * 0.5;
          a.addScaledVector(_v, corr);
          b.addScaledVector(_v, -corr);
        }
      }
      _v.subVectors(ch.pts[n - 1], ch.pts[0]).setY(0);
      if (_v.lengthSq() > 1e-4) { _v.normalize(); ch.side.set(_v.z, 0, -_v.x); }
      if (ch.life < 1.2 && Math.random() < dt * 20) {
        const q = ch.pts[Math.floor(Math.random() * n)];
        game.particles.foamBurst(q.x, q.y, q.z, 1, 0.5);
      }
      if (ch.life <= 0) {
        const q = ch.pts[n >> 1];
        game.items.spawn('seaweed', q.x, q.z, { vel: new THREE.Vector3(rnd(-1, 1), 3, rnd(-1, 1)) });
        game.items.spawn('seaweed', q.x, q.z, { vel: new THREE.Vector3(rnd(-1, 1), 3, rnd(-1, 1)) });
        game.items.spawn('coin', q.x, q.z, { vel: new THREE.Vector3(rnd(-1, 1), 3.5, rnd(-1, 1)) });
        ch.tube.dispose();
        ch.skin.mat.dispose();
        this.chunks.splice(c, 1);
      }
    }
  }

  // keep the crab list in sync with whichever arms sandlings can currently reach
  _exposure() {
    const game = this.game, sim = game.sim;
    for (const a of this.arms) {
      const hb = a.hitbox;
      let j = -1;
      if (this.alive && !a.severed && this.sub < 0.5) {
        for (let k = Math.round(K * 0.3); k < K - 1; k++) {
          const p = a.pts[k];
          if (sim.depthAt(p.x, p.z) < 0.3 && p.y - sim.heightAt(p.x, p.z) < 1.6) { j = Math.min(K - 2, k + 2); break; }
        }
      }
      a.exposedAt = j;
      hb.alive = j >= 0;
      if (j >= 0) {
        hb.pos.copy(a.pts[j]);
        hb.radius = a.radius(j / (K - 1)) + 0.2;
      }
      const idx = game.enemies.indexOf(hb);
      if (hb.alive && idx < 0) game.enemies.push(hb);
      else if (!hb.alive && idx >= 0) game.enemies.splice(idx, 1);
    }
  }

  // ---- rendering ---------------------------------------------------------------------------
  _buildHead() {
    const head = (this.head = new THREE.Group());
    this.group.add(head);
    this.headSkin = skinMaterial();
    const mantle = new THREE.Mesh(mantleGeometry(), this.headSkin.mat);
    mantle.castShadow = true;
    mantle.receiveShadow = true;
    head.add(mantle);
    this.mantle = mantle;
    const white = new THREE.MeshStandardMaterial({ color: 0xfbf6ee, roughness: 0.18 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0c0608, roughness: 0.12 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a0f1e, roughness: 0.6 });
    const lidMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(TOP).multiplyScalar(0.9), roughness: 0.35 });
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x252a36, roughness: 0.7, side: THREE.DoubleSide });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc94a, roughness: 0.25, metalness: 1 });
    const bone = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.5 });
    this._mats = [white, black, dark, lidMat, hatMat, gold, bone];
    const add = (g, m, x, y, z, parent = head) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      return o;
    };
    // the good eye, and the patched one
    this.eye = add(new THREE.SphereGeometry(0.6, 22, 16), white, -0.86, 0.62, 1.66);
    this.pupil = add(new THREE.SphereGeometry(0.28, 16, 12), black, -0.86, 0.62, 2.18);
    this.lid = add(new THREE.SphereGeometry(0.64, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), lidMat, -0.86, 0.62, 1.66);
    this.lid.rotation.x = -1.2;
    const patchEye = add(new THREE.SphereGeometry(0.5, 16, 12), lidMat, 0.86, 0.62, 1.6);
    patchEye.scale.z = 0.8;
    const patch = add(new THREE.CylinderGeometry(0.58, 0.58, 0.09, 20), black, 0.86, 0.64, 2.02);
    patch.rotation.x = Math.PI / 2;
    patch.rotation.z = 0.1;
    const strap = add(new THREE.TorusGeometry(2.08, 0.05, 6, 56), black, 0, 0.7, 0.02);
    strap.rotation.x = Math.PI / 2 - 0.08;
    strap.rotation.y = -0.32;
    // an X for each eye, for the very end
    this.xEyes = new THREE.Group();
    head.add(this.xEyes);
    for (const ex of [-0.86, 0.86]) {
      for (const r of [0.78, -0.78]) {
        const bar = add(new THREE.BoxGeometry(0.7, 0.12, 0.08), black, ex, 0.62, 2.2, this.xEyes);
        bar.rotation.z = r;
      }
    }
    this.xEyes.visible = false;
    // furious brows
    this.brows = [];
    for (const s of [-1, 1]) {
      const b = add(new THREE.BoxGeometry(1.0, 0.18, 0.24), dark, s * 0.86, 1.36, 1.86);
      b.rotation.z = -s * 0.32;
      this.brows.push(b);
    }
    // a maw full of little teeth under the beard
    this.maw = new THREE.Group();
    this.maw.position.set(0, -0.5, 1.92);
    head.add(this.maw);
    add(new THREE.CircleGeometry(0.85, 26), new THREE.MeshBasicMaterial({ color: 0x24060f }), 0, 0, 0, this.maw);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const tooth = add(new THREE.ConeGeometry(0.08, 0.24, 5), white, Math.cos(a) * 0.74, Math.sin(a) * 0.74, 0.03, this.maw);
      tooth.rotation.z = a + Math.PI / 2;
    }
    // tricorn hat with a jaunty tilt, gold trim and a skull
    const hat = (this.hat = new THREE.Group());
    hat.position.set(0, 4.3, -0.82);
    hat.rotation.set(0.18, 0, 0.14);
    head.add(hat);
    const crown = add(new THREE.CylinderGeometry(0.92, 1.12, 0.95, 22), hatMat, 0, 0.55, 0, hat);
    crown.receiveShadow = true;
    const { brim, trim } = hatBrimGeometry();
    add(brim, hatMat, 0, 0, 0, hat);
    add(trim, gold, 0, 0, 0, hat);
    add(new THREE.SphereGeometry(0.2, 12, 10), bone, 0, 0.62, 1.08, hat);
    add(new THREE.BoxGeometry(0.2, 0.1, 0.12), bone, 0, 0.44, 1.07, hat);
    for (const r of [0.75, -0.75]) {
      const b = add(new THREE.CylinderGeometry(0.035, 0.035, 0.62, 6), bone, 0, 0.58, 1.02, hat);
      b.rotation.z = r;
    }
    // the beard: little tentacles hanging off the chin
    this.beard = [];
    for (let i = 0; i < 7; i++) {
      const f = i / 6 - 0.5;
      const bt = { x: f * 2.3, z: 1.62 - Math.abs(f) * 0.5, len: rnd(1.6, 2.3) * (1 - Math.abs(f) * 0.35), phase: rnd(0, 6), pts: Array.from({ length: 7 }, () => new THREE.Vector3()) };
      bt.radius = (s) => 0.17 * (1 - 0.82 * s) * (s > 0.92 ? Math.sqrt((1 - s) / 0.08) : 1) + 0.002;
      bt.tube = new Tube(this.group, this.headSkin.mat, 18, 8);
      this.beard.push(bt);
    }
    this._side = new THREE.Vector3();
  }

  render(time) {
    if (this.disposed) return;
    const t = this.t;
    // head pose: breathing, a shudder when hurt, a slump at the end
    const head = this.head;
    head.position.copy(this.pos);
    const hurt = this.hurtT > 0 ? Math.sin(time * 40) * 0.04 * this.hurtT : 0;
    const dying = this.state === 'dying' ? smoothstep(1.5, 5, t) : 0;
    head.rotation.set(-0.06 + Math.sin(time * 0.7) * 0.03 + dying * 0.35, this.yaw + hurt, Math.sin(time * 0.5) * 0.04 + hurt + dying * 0.3);
    const br = 1 + Math.sin(time * 1.7) * 0.025;
    this.mantle.scale.set(1 / Math.sqrt(br), br, 1 / Math.sqrt(br));
    head.updateMatrixWorld(true);
    this.headSkin.flash.value = this.flash * 0.6;
    // eyes: look at whatever is being attacked, blink, glare
    this.blinkT -= 1 / 60;
    if (this.blinkT <= 0) { this.blink = 1; this.blinkT = rnd(2.5, 6); }
    this.blink = Math.max(0, this.blink - 0.12);
    const squint = this.hurtT > 0 ? 0.6 : 0;
    this.lid.rotation.x = lerp(-1.2, -0.05, Math.max(this.blink, squint, dying));
    const busy = this.arms.find((a) => a.busy && (a.state === 'windup' || a.state === 'reach' || a.state === 'sweep'));
    const look = busy ? (busy.state === 'reach' && busy.prey ? busy.prey.pos : busy.state === 'windup' ? busy.target : busy.pts[K - 1]) : null;
    let lx = 0, ly = 0;
    if (look) {
      _v.copy(look);
      head.worldToLocal(_v);
      _v.sub(this.eye.position).normalize();
      lx = clamp(_v.x, -0.5, 0.5) * 0.3;
      ly = clamp(_v.y, -0.6, 0.4) * 0.3;
    }
    this.pupil.position.set(this.eye.position.x + lx, this.eye.position.y + ly, this.eye.position.z + 0.48);
    this.pupil.visible = this.state !== 'dying';
    this.xEyes.visible = this.state === 'dying';
    for (let i = 0; i < 2; i++) this.brows[i].position.y = 1.36 - (this.mouth * 0.12) + (this.hurtT > 0 ? 0.15 : 0);
    // mouth
    const chomp = this.chew > 0 ? Math.abs(Math.sin(this.chew * 12)) * 0.6 : 0;
    const mo = Math.max(this.mouth, chomp);
    this.maw.scale.setScalar(0.2 + mo * 0.9);
    // beard tentacles
    for (const bt of this.beard) {
      const pts = bt.pts;
      const splay = mo * 0.9;
      for (let k = 0; k < pts.length; k++) {
        const s = k / (pts.length - 1);
        const w = Math.sin(time * 2.2 + bt.phase + s * 3) * 0.18 * s;
        _v.set(bt.x * (1 + splay * s * 0.6) + w, -0.55 - s * bt.len * (1 - splay * 0.4), bt.z + s * 0.5 + splay * s * 0.8 + Math.sin(s * 3 + time * 1.3 + bt.phase) * 0.12);
        // curl the ends up
        _v.y += smoothstep(0.65, 1, s) * 0.45;
        _v.z += smoothstep(0.65, 1, s) * 0.25;
        pts[k].copy(_v).applyMatrix4(head.matrixWorld);
      }
      this._side.set(1, 0, 0).applyQuaternion(head.quaternion);
      bt.tube.update(pts, bt.radius, this._side);
    }
    // arms
    for (const a of this.arms) {
      a.tube.update(a.pts, a.radiusFn, a.side);
      a.skin.flash.value = a.flash * 0.7 + this.flash * 0.2;
      const show = a.state === 'windup' || a.state === 'strike';
      a.mark.visible = show;
      if (show) {
        a.mark.position.set(a.target.x, a.target.y + 0.12, a.target.z);
        const u = a.mark.material.uniforms;
        u.uP.value = a.state === 'strike' ? 1 : clamp(a.t / this.windup);
        u.uT.value = time;
        a.mark.scale.setScalar(lerp(0.6, 1, u.uP.value));
      }
    }
    for (const ch of this.chunks) ch.tube.update(ch.pts, ch.radius, ch.side);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const game = this.game;
    for (const a of this.arms) {
      a._release(null);
      a.dispose();
      const i = game.enemies.indexOf(a.hitbox);
      if (i >= 0) game.enemies.splice(i, 1);
    }
    for (const ch of this.chunks) { ch.tube.dispose(); ch.skin.mat.dispose(); }
    this.chunks = [];
    for (const bt of this.beard) bt.tube.dispose();
    this.group.removeFromParent();
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this._mats) m.dispose();
    this.headSkin.mat.dispose();
    for (const a of this.arms) a.skin.mat.dispose();
    this.markGeo.dispose();
    this.markMat.dispose();
    const i = game.enemies.indexOf(this);
    if (i >= 0) game.enemies.splice(i, 1);
  }
}
