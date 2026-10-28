// Physical pickups: resources the sea washes ashore, message bottles with
// blueprints, mystery jars and the stopwatch. They roll, float, drift with the
// simulated currents and are carried by sandlings (alone or in groups).
import * as THREE from 'three';
import { InstancedLayer } from './InstancedLayer.js';
import { makeShellGeometry, makeRockGeometry, makeDriftwood } from '../world/propGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rnd, clamp, pick, damp } from '../core/math.js';

export const ITEM_TYPES = {
  shell: { res: 'shells', amount: 1, weight: 1, float: 0.0, size: 0.24, label: 'Shell' },
  pebble: { res: 'pebbles', amount: 1, weight: 1.4, float: 0.0, size: 0.2, label: 'Pebble' },
  driftwood: { res: 'driftwood', amount: 3, weight: 3.2, float: 1.0, size: 1.0, label: 'Driftwood', heavy: true, carriers: 2 },
  seaweed: { res: 'seaweed', amount: 1, weight: 0.8, float: 0.8, size: 0.32, label: 'Seaweed' },
  gem: { res: 'gems', amount: 1, weight: 0.6, float: 0.0, size: 0.16, label: 'Sea glass' },
  coin: { res: 'treasure', amount: 4, weight: 0.8, float: 0.0, size: 0.14, label: 'Lost coin' },
  bottle: { special: 'bottle', weight: 1.2, float: 1.0, size: 0.42, label: 'Message in a bottle' },
  jar: { special: 'jar', weight: 2.4, float: 0.9, size: 0.5, label: 'Mysterious jar', heavy: true, carriers: 2 },
  stopwatch: { special: 'stopwatch', weight: 3, float: 0.6, size: 1.2, label: 'Stopwatch' },
};

const SHELL_COLS = [0xfbeee0, 0xf6c6a8, 0xf2a37c, 0xffe3c2, 0xe8d6ff, 0xffd1dc];
const GEM_COLS = [0x7de8c8, 0x7cc8f2, 0xb3f27c, 0xf2f2f2, 0x6ad1e8];

let IID = 1;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

export class Item {
  constructor(type, x, y, z) {
    this.id = IID++;
    this.kind = 'item';
    this.type = type;
    this.def = ITEM_TYPES[type];
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.rot = new THREE.Euler(rnd(-0.3, 0.3), rnd(0, Math.PI * 2), rnd(-0.3, 0.3));
    this.spin = new THREE.Vector3();
    this.alive = true;
    this.carriers = [];
    this.reservedBy = [];
    this.variant = Math.floor(Math.random() * 3);
    this.color = new THREE.Color(type === 'gem' ? pick(GEM_COLS) : pick(SHELL_COLS));
    this.age = 0;
    this.rest = 0;
    this.inWater = false;
    this.glint = Math.random() * 10;
    this.payload = null; // blueprint id for bottles, etc.
    this.groupTarget = null;
    this.highlight = 0;
  }

  get heavy() { return !!this.def.heavy; }
  get needed() { return this.def.carriers || 1; }
  get carried() { return this.carriers.length > 0; }

  release(unit) {
    this.carriers = this.carriers.filter((u) => u !== unit);
    this.reservedBy = this.reservedBy.filter((u) => u !== unit);
    if (unit && unit.carry === this) unit.carry = null;
    if (!this.carriers.length) {
      this.groupTarget = null;
      for (const u of this.carriers) u.carry = null;
    } else if (this.carriers.length < this.needed) {
      // not enough hands: everyone drops it
      for (const u of this.carriers.slice()) { u.carry = null; }
      this.carriers = [];
      this.groupTarget = null;
    }
  }
}

export class Items {
  constructor(game) {
    this.game = game;
    this.list = [];
    const root = (this.root = new THREE.Group());
    game.scene.add(root);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42 });
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const weedMat = new THREE.MeshStandardMaterial({ color: 0x5d6b2a, roughness: 0.5, side: THREE.DoubleSide });
    const gemMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.82, emissive: 0xffffff, emissiveIntensity: 0.25 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffcf5a, roughness: 0.2, metalness: 1 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fe0c8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false });
    const corkMat = new THREE.MeshStandardMaterial({ color: 0xa9784a, roughness: 0.8 });
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xf3e6c4, roughness: 0.9 });
    const jarMat = new THREE.MeshStandardMaterial({ color: 0xb8673e, roughness: 0.75 });
    const L = (g, m, max, o) => new InstancedLayer(root, g, m, max, o);
    this.shells = ['scallop', 'conch', 'clam'].map((k) => L(makeShellGeometry(k), shellMat, 600));
    this.pebble = L(makeRockGeometry(901, { detail: 1, flat: 0.6 }), rockMat, 500, { colors: true });
    const wood = makeDriftwood(77, { length: 1.6 });
    this.wood = L(wood, woodMat, 120, { colors: false });
    this.weed = L(seaweedGeometry(), weedMat, 300, { colors: false });
    this.gem = L(new THREE.IcosahedronGeometry(0.5, 0), gemMat, 200, { colors: true, cast: false });
    this.coin = L(coinGeometry(), goldMat, 120, { colors: false });
    const bottle = bottleGeometry();
    this.bottleGlass = L(bottle.glass, glassMat, 30, { colors: false, cast: false, order: 4 });
    this.bottleCork = L(bottle.cork, corkMat, 30, { colors: false });
    this.bottlePaper = L(bottle.paper, paperMat, 30, { colors: false });
    this.jar = L(jarGeometry(), jarMat, 30, { colors: false });
    this.layers = [...this.shells, this.pebble, this.wood, this.weed, this.gem, this.coin, this.bottleGlass, this.bottleCork, this.bottlePaper, this.jar];
    this.spawnTimer = 6;
  }

  spawn(type, x, z, opts = {}) {
    const sim = this.game.sim;
    const y = opts.y ?? Math.max(sim.heightAt(x, z), sim.surfaceAt(x, z) - 0.05) + 0.05;
    const it = new Item(type, x, y, z);
    if (opts.vel) it.vel.copy(opts.vel);
    if (opts.payload) it.payload = opts.payload;
    this.list.push(it);
    return it;
  }

  remove(it) {
    it.alive = false;
    for (const u of it.carriers) if (u.carry === it) u.carry = null;
    it.carriers = [];
    const i = this.list.indexOf(it);
    if (i >= 0) this.list.splice(i, 1);
  }

  // Scatter starting resources on the beach.
  scatter(count = 70) {
    const sim = this.game.sim;
    let n = 0, guard = 0;
    while (n < count && guard++ < 5000) {
      const x = rnd(-46, 46), z = rnd(-10, 30);
      const h = sim.heightAt(x, z);
      if (h < sim.seaLevel + 0.15 || h > 4.5) continue;
      if (this.game.blockedAt(x, z, 0.4)) continue;
      const r = Math.random();
      const type = r < 0.55 ? 'shell' : r < 0.78 ? 'pebble' : r < 0.9 ? 'seaweed' : r < 0.96 ? 'driftwood' : 'gem';
      this.spawn(type, x, z);
      n++;
    }
  }

  // The sea delivers things: spawn just offshore with a push toward the beach.
  washAshore(type, x) {
    const sim = this.game.sim;
    // find a point in the surf zone along this x
    let z = -20;
    for (let zz = -6; zz > -30; zz -= 0.5) {
      const d = sim.depthAt(x, zz);
      if (d > 0.5) { z = zz; break; }
    }
    return this.spawn(type, x, z, { vel: new THREE.Vector3(rnd(-0.3, 0.3), 0, rnd(1.2, 2.5)) });
  }

  update(dt) {
    const sim = this.game.sim;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      it.age += dt;
      it.highlight = Math.max(0, it.highlight - dt);
      if (it.held) continue; // positioned by the hand tool
      if (it.carriers.length) {
        this._carried(it, dt);
        continue;
      }
      const ground = sim.heightAt(it.pos.x, it.pos.z);
      const depth = sim.depthAt(it.pos.x, it.pos.z);
      const surf = ground + depth;
      const f = it.def.float;
      it.inWater = depth > 0.05;
      it.vel.y -= 9.8 * dt;
      if (it.inWater) {
        const k = sim.cellIndex(it.pos.x, it.pos.z);
        const wvx = k >= 0 ? sim.vx[k] : 0, wvz = k >= 0 ? sim.vz[k] : 0;
        const drag = f > 0 ? 2.2 : 0.8;
        const sp = Math.hypot(wvx, wvz);
        // heavy things only move in strong flow
        const move = f > 0 ? 1 : clamp((sp - 0.6) / 1.4);
        it.vel.x = damp(it.vel.x, wvx * move, drag, dt);
        it.vel.z = damp(it.vel.z, wvz * move, drag, dt);
        if (f > 0) {
          const target = surf - it.def.size * 0.15;
          it.vel.y += (target - it.pos.y) * 30 * dt * f;
          it.vel.y *= 1 - 3 * dt;
          it.rot.x += Math.sin(it.age * 1.7 + it.id) * dt * 0.3;
          it.rot.z += Math.cos(it.age * 1.3 + it.id) * dt * 0.3;
        } else {
          it.vel.y *= 1 - 4 * dt;
          if (sp > 1.2) it.spin.set(rnd(-3, 3), 0, rnd(-3, 3));
        }
      }
      it.pos.addScaledVector(it.vel, dt);
      const floor = ground + it.def.size * 0.12;
      if (it.pos.y < floor) {
        it.pos.y = floor;
        if (it.vel.y < -2) it.vel.y *= -0.25; else it.vel.y = 0;
        it.vel.x *= 1 - Math.min(1, dt * 6);
        it.vel.z *= 1 - Math.min(1, dt * 6);
        it.spin.multiplyScalar(1 - Math.min(1, dt * 5));
      }
      it.rot.x += it.spin.x * dt; it.rot.z += it.spin.z * dt;
      if (!it.inWater) {
        // settle flat on the sand
        it.rot.x = damp(it.rot.x, 0, 3, dt);
        it.rot.z = damp(it.rot.z, 0, 3, dt);
      }
      // keep inside the world
      if (it.pos.x < -50 || it.pos.x > 50 || it.pos.z < -37 || it.pos.z > 37) {
        it.pos.x = clamp(it.pos.x, -50, 50);
        it.pos.z = clamp(it.pos.z, -37, 37);
        it.vel.set(0, 0, 0);
      }
      // swept far out to sea and lost
      if (depth > 3.2 && it.age > 25) this.remove(it);
    }
  }

  _carried(it, dt) {
    const carriers = it.carriers;
    const V = this.game.verlet;
    // average of carriers' hands
    let x = 0, y = 0, z = 0, n = 0;
    for (const u of carriers) {
      for (const j of [4, 5]) {
        const p = u.p[j];
        if (p === undefined || p < 0) continue;
        x += V.px[p]; y += V.py[p]; z += V.pz[p]; n++;
      }
    }
    if (n) {
      x /= n; y /= n; z /= n;
      const over = carriers.length === 1 && carriers[0].carryMode === 'over';
      it.pos.set(x, y + (over ? it.def.size * 0.35 : 0.05), z);
    }
    if (carriers.length === 1) it.rot.y = carriers[0].yaw + Math.PI / 2;
    else {
      const a = carriers[0].pos, b = carriers[1].pos;
      it.rot.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
    }
    it.rot.x = damp(it.rot.x, 0, 8, dt);
    it.rot.z = damp(it.rot.z, 0, 8, dt);
  }

  render(time) {
    for (const l of this.layers) l.begin();
    for (const it of this.list) {
      _e.copy(it.rot);
      _q.setFromEuler(_e);
      const s = it.def.size;
      switch (it.type) {
        case 'shell':
          _m.compose(it.pos, _q, _s.setScalar(s));
          this.shells[it.variant].push(_m, it.color);
          break;
        case 'pebble':
          _m.compose(it.pos, _q, _s.set(s, s * 0.7, s * 0.9));
          this.pebble.push(_m, _c.setRGB(0.55, 0.52, 0.5).multiplyScalar(0.8 + (it.id % 5) * 0.08));
          break;
        case 'driftwood':
          _m.compose(it.pos, _q, _s.setScalar(s * 0.9));
          this.wood.push(_m);
          break;
        case 'seaweed':
          _m.compose(it.pos, _q, _s.setScalar(s));
          this.weed.push(_m);
          break;
        case 'gem': {
          const pulse = 1 + 0.06 * Math.sin(time * 3 + it.id);
          _m.compose(it.pos, _q, _s.setScalar(s * pulse));
          this.gem.push(_m, it.color);
          break;
        }
        case 'coin':
          _m.compose(it.pos, _q, _s.setScalar(s));
          this.coin.push(_m);
          break;
        case 'bottle':
          _m.compose(it.pos, _q, _s.setScalar(s));
          this.bottleGlass.push(_m);
          this.bottleCork.push(_m);
          this.bottlePaper.push(_m);
          break;
        case 'jar':
          _m.compose(it.pos, _q, _s.setScalar(s));
          this.jar.push(_m);
          break;
        default:
          break;
      }
      // occasional glints on shiny things
      if ((it.type === 'gem' || it.type === 'coin' || it.type === 'bottle') && !it.carried) {
        it.glint -= 1 / 60;
        if (it.glint < 0) {
          it.glint = rnd(1.5, 4);
          this.game.particles.sparkle(it.pos.x, it.pos.y + 0.15, it.pos.z, 2, it.type === 'gem' ? [0.7, 1, 0.95] : [1, 0.9, 0.6], 0.1, 0.18);
        }
      }
    }
    for (const l of this.layers) l.end();
  }

  nearest(x, z, filter, maxDist = 1e9) {
    let best = null, bd = maxDist * maxDist;
    for (const it of this.list) {
      if (!filter(it)) continue;
      const d = (it.pos.x - x) ** 2 + (it.pos.z - z) ** 2;
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }
}

function seaweedGeometry() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.PlaneGeometry(0.16, 0.9, 1, 6);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      p.setZ(k, Math.sin(y * 6 + i) * 0.08);
      p.setX(k, p.getX(k) * (1 - Math.abs(y) * 0.5));
    }
    g.rotateX(-Math.PI / 2);
    g.rotateY((i / 6) * Math.PI * 2);
    g.translate(0, 0.02 + i * 0.01, 0);
    g.deleteAttribute('uv');
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

function coinGeometry() {
  const g = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 20);
  g.deleteAttribute('uv');
  return g;
}

function bottleGeometry() {
  const pts = [];
  const prof = [[0.0, -0.5], [0.2, -0.5], [0.22, -0.45], [0.22, 0.15], [0.12, 0.3], [0.07, 0.38], [0.07, 0.5]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const glass = new THREE.LatheGeometry(pts, 16);
  glass.deleteAttribute('uv');
  glass.rotateZ(Math.PI / 2);
  const cork = new THREE.CylinderGeometry(0.075, 0.065, 0.14, 8);
  cork.deleteAttribute('uv');
  cork.rotateZ(Math.PI / 2);
  cork.translate(-0.55, 0, 0);
  const paper = new THREE.CylinderGeometry(0.1, 0.1, 0.55, 10);
  paper.deleteAttribute('uv');
  paper.rotateZ(Math.PI / 2);
  paper.translate(0.05, 0, 0);
  return { glass, cork, paper };
}

function jarGeometry() {
  const pts = [];
  const prof = [[0.0, -0.4], [0.25, -0.38], [0.36, -0.15], [0.36, 0.1], [0.24, 0.3], [0.16, 0.36], [0.19, 0.42], [0.0, 0.46]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 14);
  g.deleteAttribute('uv');
  g.translate(0, 0.38, 0);
  g.computeVertexNormals();
  return g;
}
