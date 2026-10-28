// Buildings: construction sites that workers supply and raise, finished
// structures that block water and crabs, erode in waves, sag when their
// foundation is dug away, and collapse back into sand.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDINGS } from './buildingTypes.js';
import { MODEL_BUILDERS, prep, bucketStackGeometry } from './models.js';
import { makeBuildingSandMaterial, makeSharedBuildingMaterials, makeFlagGeometry, makeGhostMaterial } from './materials.js';
import { X0, Z0, CELL, BOUNDS } from '../world/config.js';
import { clamp, damp, rnd, ease, smoothstep } from '../core/math.js';
import { UNIT_TYPES } from '../entities/Sandling.js';
import { globalUniforms } from '../world/shaderLib.js';

const globalNight = () => globalUniforms.uNight.value;

const modelCache = new Map();
export function getModel(type) {
  if (modelCache.has(type)) return modelCache.get(type);
  const m = MODEL_BUILDERS[type]();
  if (m.flags.length) {
    const poles = m.flags.map((f) => {
      const g = new THREE.CylinderGeometry(0.016, 0.022, 0.95 * f.size, 5);
      g.translate(f.x, f.y - 0.42 * f.size, f.z);
      return prep(g, 0xe8d3a8);
    });
    m.parts.wood = m.parts.wood ? mergeGeometries([m.parts.wood, ...poles]) : mergeGeometries(poles);
    m.flagGeo = mergeGeometries(makeFlagGeometry(m.flags));
  }
  modelCache.set(type, m);
  return m;
}

let BID = 1;
const _v = new THREE.Vector3();

export class Building {
  constructor(game, type, x, z, rot = 0, opts = {}) {
    this.game = game;
    this.id = BID++;
    this.kind = 'building';
    this.team = 0;
    this.type = type;
    this.def = BUILDINGS[type];
    this.rot = rot;
    const sim = game.sim;
    this.radius = this.def.size;
    this.baseY = opts.baseY ?? Math.max(sim.avgHeight(x, z, this.radius), sim.seaLevel + 0.05);
    this.pos = new THREE.Vector3(x, this.baseY, z);
    this.level = 1;
    this.maxHp = this.def.hp * (game.economy.tech.mortar ? 1.4 : 1);
    this.state = opts.instant ? 'built' : 'site';
    this.progress = opts.instant ? 1 : 0;
    this.toDeliver = opts.free ? 0 : Object.values(this.def.cost).reduce((a, b) => a + b, 0);
    this.delivered = opts.instant ? this.toDeliver : 0;
    this.incoming = 0;
    this.hp = opts.instant ? this.maxHp : this.maxHp * 0.12;
    this.waterDmg = 0;
    this.wet = 0;
    this.alive = true;
    this.workers = new Set();
    this.garrison = [];
    this.queue = [];
    this.lift = 0;
    this.liftTarget = 0;
    this.tiltX = 0;
    this.tiltZ = 0;
    this.timer = Math.random();
    this.cooldown = rnd(0, 1);
    this.glow = 0;
    this.pop = 0;
    this.aim = 0;
    this.model = getModel(type);
    this.height = this.model.height;
    this._makeVisual();
    if (opts.flatten !== false && !this.def.bridge && !this.def.trap) sim.flatten(x, z, this.radius * 0.95, this.baseY, 0.8);
    if (!this.def.bridge) game.props.clearArea(x, z, this.radius * 1.05);
    this.colliders = [];
    this.boxes = [];
    this.cells = [];
    if (type === 'bucket') {
      this.stack = 1;
      if (opts.stamp) this._stamp();
    }
    if (opts.instant) this._register();
  }

  _stamp() {
    this.stampT = 1;
    const p = this.game.particles;
    p.dust(this.pos.x, this.baseY + 0.1, this.pos.z, 10, 0.8);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      p.chunk(this.pos.x + Math.cos(a) * 0.6, this.baseY + 0.1, this.pos.z + Math.sin(a) * 0.6, Math.cos(a) * 2, 1.5, Math.sin(a) * 2, 0.06, 0xb89a6c, 1.5, 0.001);
    }
  }

  addStack() {
    if (this.type !== 'bucket' || this.stack >= 3) return;
    const geo = bucketStackGeometry(this.stack);
    const m = new THREE.Mesh(geo, this.sandMat);
    m.castShadow = m.receiveShadow = true;
    m.position.y = this.height - 0.18;
    this.group.add(m);
    this.stack++;
    this.height += 0.62;
    this.maxHp += 45;
    this.hp += 45;
    this.sandMat.userData.u.uHeight.value = this.height + 0.3;
    for (const c of this.colliders) c.top = this.baseY + this.height;
    this.stampT = 1;
    this._stampMesh = m;
    this.game.particles.dust(this.pos.x, this.baseY + this.height, this.pos.z, 6, 0.5);
    // re-block water at the new height
    this.registered = false;
    this._unregisterQuiet();
    this.colliders = []; this.boxes = [];
    for (const k of this.cells) this.game.sim.obst[k] = this.game.sim.obstRock[k];
    this.cells = [];
    this._register();
    for (const c of this.colliders) c.top = this.baseY + this.height;
  }

  _makeVisual() {
    const game = this.game;
    const mats = game.buildings.mats;
    const g = (this.group = new THREE.Group());
    g.position.copy(this.pos);
    g.rotation.y = this.rot;
    this.sandMat = makeBuildingSandMaterial();
    const u = this.sandMat.userData.u;
    u.uBaseY.value = this.baseY - 0.05;
    u.uHeight.value = this.model.height + 0.35;
    u.uReveal.value = this.state === 'built' ? 1 : 0;
    this.details = new THREE.Group();
    this.liftGroup = new THREE.Group();
    for (const [k, geo] of Object.entries(this.model.parts)) {
      const mesh = new THREE.Mesh(geo, k === 'sand' ? this.sandMat : mats[k]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      (k === 'sand' ? g : this.details).add(mesh);
    }
    for (const [k, geo] of Object.entries(this.model.lift)) {
      const mesh = new THREE.Mesh(geo, k === 'sand' ? this.sandMat : mats[k]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.liftGroup.add(mesh);
    }
    if (this.model.flagGeo) {
      const f = new THREE.Mesh(this.model.flagGeo, mats.flag);
      f.castShadow = true;
      this.details.add(f);
    }
    this.details.add(this.liftGroup);
    g.add(this.details);
    if (this.state !== 'built') {
      this.details.visible = false;
      if (this.model.parts.sand) {
        this.ghost = new THREE.Mesh(this.model.parts.sand, game.buildings.ghostMat);
        this.ghost.renderOrder = 6;
        g.add(this.ghost);
      }
    }
    game.scene.add(g);
  }

  get isStorage() { return !!this.def.storage && this.state === 'built'; }
  get needsMaterials() { return this.state === 'site' && this.delivered + this.incoming < this.toDeliver; }
  get readyToBuild() { return this.state === 'site' && this.delivered >= this.toDeliver; }
  get damaged() { return this.state === 'built' && this.hp < this.maxHp * 0.85; }

  worldPoint(lx, lz, out = new THREE.Vector3()) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    return out.set(this.pos.x + lx * c + lz * s, this.baseY, this.pos.z - lx * s + lz * c);
  }

  slot(name) {
    const sl = this.model.slots[name];
    if (!sl) return null;
    const p = this.worldPoint(sl.x, sl.z);
    p.y = this.baseY + (sl.y || 0);
    return { x: p.x, y: p.y, z: p.z, yaw: this.rot + (sl.yaw || 0) };
  }

  doorPoint(out = new THREE.Vector3()) {
    const d = this.model.slots.door;
    if (d) return this.worldPoint(d.x, d.z, out);
    return out.set(this.pos.x, this.baseY, this.pos.z + this.radius + 0.6);
  }

  // A spot around the perimeter for a worker to stand at.
  workSpot(i, n, out = new THREE.Vector3()) {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + this.id;
    const r = this.radius + 0.45;
    return out.set(this.pos.x + Math.cos(a) * r, this.baseY, this.pos.z + Math.sin(a) * r);
  }

  _register() {
    if (this.registered) return;
    this.registered = true;
    const game = this.game, V = game.verlet, sim = game.sim;
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    for (const col of this.model.colliders) {
      const wx = this.pos.x + col.x * c + col.z * s;
      const wz = this.pos.z - col.x * s + col.z * c;
      const top = this.baseY + col.top;
      if (col.type === 'circle') {
        const o = { x: wx, z: wz, r: col.r, top, building: this, walkTop: true };
        this.colliders.push(o);
        V.colliders.push(o);
        game.staticColliders.push(o);
      } else {
        const rot = -this.rot + (col.rot || 0);
        const o = { x: wx, z: wz, hx: col.hx, hz: col.hz, c: Math.cos(rot), s: Math.sin(rot), top, building: this, walkTop: true, bridge: !!this.def.bridge };
        this.boxes.push(o);
        V.boxes.push(o);
      }
    }
    if (this.def.bridge) {
      const rot = -this.rot;
      const o = { x: this.pos.x, z: this.pos.z, hx: 0.8, hz: 2.1, c: Math.cos(rot), s: Math.sin(rot), top: this.baseY + 0.3, building: this, walkTop: true, deck: true };
      game.bridges.push(o);
    }
    // block water flow
    const W = sim.W;
    const add = (wx, wz, test, top) => {
      const r = 3.5;
      const i0 = Math.max(1, Math.floor((wx - r - X0) / CELL)), i1 = Math.min(W - 2, Math.ceil((wx + r - X0) / CELL));
      const j0 = Math.max(1, Math.floor((wz - r - Z0) / CELL)), j1 = Math.min(sim.H - 2, Math.ceil((wz + r - Z0) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = X0 + i * CELL, z = Z0 + j * CELL;
        if (!test(x, z)) continue;
        const k = j * W + i;
        const hgt = top - sim.h[k];
        if (hgt > sim.obst[k]) sim.obst[k] = hgt;
        this.cells.push(k);
      }
    };
    for (const o of this.colliders) add(o.x, o.z, (x, z) => (x - o.x) ** 2 + (z - o.z) ** 2 < (o.r * 0.9) ** 2, o.top);
    for (const o of this.boxes) {
      if (o.bridge) continue;
      add(o.x, o.z, (x, z) => {
        const dx = x - o.x, dz = z - o.z;
        const lx = dx * o.c + dz * o.s, lz = -dx * o.s + dz * o.c;
        return Math.abs(lx) < o.hx * 0.95 && Math.abs(lz) < o.hz * 0.95;
      }, o.top);
    }
  }

  _unregister() {
    const game = this.game, V = game.verlet, sim = game.sim;
    const rm = (arr, set) => { for (let i = arr.length - 1; i >= 0; i--) if (set.includes(arr[i])) arr.splice(i, 1); };
    rm(V.colliders, this.colliders);
    rm(game.staticColliders, this.colliders);
    rm(V.boxes, this.boxes);
    game.bridges = game.bridges.filter((b) => b.building !== this);
    for (const k of this.cells) sim.obst[k] = sim.obstRock[k];
    // restore overlapping neighbours
    const others = game.buildings.list.filter((b) => b !== this && b.registered && b.pos.distanceTo(this.pos) < b.radius + this.radius + 1);
    for (const b of others) { b.registered = false; b.colliders = []; b.boxes = []; b.cells = []; b._unregisterQuiet(); b._register(); }
    this.colliders = []; this.boxes = []; this.cells = [];
    this.registered = false;
  }

  _unregisterQuiet() {
    const game = this.game, V = game.verlet;
    V.colliders = V.colliders.filter((o) => o.building !== this);
    game.staticColliders = game.staticColliders.filter((o) => o.building !== this);
    V.boxes = V.boxes.filter((o) => o.building !== this);
  }

  addWork(amount) {
    if (this.state !== 'site' || !this.readyToBuild) return;
    this.progress = Math.min(1, this.progress + amount / this.def.work);
    this.hp = Math.min(this.maxHp, this.hp + (amount / this.def.work) * this.maxHp * 0.9);
    if (this.progress > 0.15 && !this.registered) this._register();
    if (this.progress >= 1) this.complete();
  }

  complete() {
    if (this.state === 'built') return;
    this.state = 'built';
    this.progress = 1;
    this.hp = Math.max(this.hp, this.maxHp);
    this._register();
    this.sandMat.userData.u.uReveal.value = 1;
    if (this.ghost) { this.group.remove(this.ghost); this.ghost = null; }
    this.details.visible = true;
    this.pop = 1;
    this.glow = 1;
    const p = this.game.particles;
    p.dust(this.pos.x, this.baseY + 0.3, this.pos.z, 14, this.radius * 0.6);
    p.confetti(this.pos.x, this.baseY + this.height, this.pos.z, 24);
    this.game.events.emit('buildingComplete', this);
  }

  repair(amount) {
    if (this.state !== 'built') return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.waterDmg = Math.max(0, this.waterDmg - amount);
  }

  damage(amount, source = 'hit', at = null) {
    if (!this.alive) return;
    this.hp -= amount;
    this.glow = Math.max(this.glow, 0.5);
    if (source === 'water') this.waterDmg += amount;
    const p = this.game.particles;
    if (source !== 'water' && at) {
      const n = Math.min(6, 1 + Math.floor(amount / 6));
      for (let i = 0; i < n; i++) {
        p.chunk(at.x, at.y, at.z, rnd(-2, 2), rnd(1, 3.5), rnd(-2, 2), rnd(0.05, 0.12), 0xd9b98a, rnd(1.5, 3), 0.0015);
      }
      p.dust(at.x, at.y, at.z, 3, 0.5);
    }
    this.game.events.emit('buildingHit', this, amount, source);
    if (this.hp <= 0) this.collapse(source);
  }

  collapse(source) {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'destroyed';
    this._unregister();
    const game = this.game, p = game.particles;
    const r = this.radius, h = this.height;
    const vol = r * r * h * 0.35;
    const n = Math.min(60, 14 + Math.floor(r * h * 4));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
      const y = this.baseY + Math.random() * h * 0.8;
      p.chunk(this.pos.x + Math.cos(a) * d, y, this.pos.z + Math.sin(a) * d, Math.cos(a) * rnd(1, 4), rnd(1, 5), Math.sin(a) * rnd(1, 4),
        rnd(0.1, 0.3) * Math.min(1.5, r), 0xd6b585, rnd(2, 4), (vol * 0.4) / n);
    }
    p.dust(this.pos.x, this.baseY + h * 0.3, this.pos.z, 30, r * 0.9);
    p.sandSpray(this.pos.x, this.baseY + h * 0.4, this.pos.z, 0, 0, 40, vol * 0.1, this.wet, 1.2);
    game.sim.deposit(this.pos.x, this.pos.z, r * 1.1, vol * 0.5, 0.5);
    game.scene.remove(this.group);
    this.sandMat.dispose();
    for (const u of this.garrison) { u.sit = null; u.garrisoned = null; u.knockDown(2); }
    this.garrison = [];
    game.events.emit('buildingDestroyed', this, source);
  }

  remove() {
    this.alive = false;
    this.state = 'destroyed';
    this._unregister();
    this.game.scene.remove(this.group);
  }

  update(dt) {
    const game = this.game, sim = game.sim;
    this.timer += dt;
    const u = this.sandMat.userData.u;
    if (this.state === 'site') {
      u.uReveal.value = damp(u.uReveal.value, Math.max(0.0, this.progress), 6, dt);
      if (this.ghost) this.ghost.visible = this.progress < 0.98;
    }
    // completion pop: details spring into place
    if (this.pop > 0) {
      this.pop = Math.max(0, this.pop - dt * 1.6);
      this.details.scale.setScalar(Math.max(0.001, ease.outBack(1 - this.pop)));
    }
    // bucket stamp squash
    if (this.stampT > 0) {
      this.stampT = Math.max(0, this.stampT - dt * 3);
      const k = this.stampT;
      const sq = 1 - Math.sin(k * Math.PI) * 0.18;
      const target = this._stampMesh || this.group;
      target.scale.set(1 + (1 - sq) * 0.6, sq, 1 + (1 - sq) * 0.6);
      if (k === 0) { target.scale.set(1, 1, 1); this._stampMesh = null; }
    }
    // inspection roof lift
    this.lift = damp(this.lift, this.liftTarget, 5, dt);
    // roofs pop off, spin and shrink away (dollhouse view)
    this.liftGroup.position.y = this.lift * 2.4;
    this.liftGroup.rotation.y = this.lift * 0.9;
    const ls = Math.max(0.001, 1 - this.lift * this.lift);
    this.liftGroup.scale.setScalar(ls);
    this.liftGroup.visible = ls > 0.02;
    this.glow = Math.max(0, this.glow - dt * 1.5);
    u.uGlow.value = Math.max(this.glow, this.hover ? 0.35 : 0);
    u.uDamage.value = clamp(1 - (this.hp + this.waterDmg * 0.6) / this.maxHp, 0, 1) * (this.state === 'built' ? 1 : 0);
    u.uErode.value = damp(u.uErode.value, clamp(this.waterDmg / this.maxHp * 1.3, 0, 0.9), 2, dt);
    u.uWet.value = damp(u.uWet.value, this.wet, 3, dt);

    // periodic physical checks
    if (Math.floor(this.timer * 4) !== Math.floor((this.timer - dt) * 4) && this.state !== 'destroyed') this._checkWater(0.25);
    if (Math.floor(this.timer * 2) !== Math.floor((this.timer - dt) * 2) && this.state === 'built' && !this.def.bridge && !this.def.trap) this._checkSupport(0.5);
    this.group.rotation.x = damp(this.group.rotation.x, this.tiltX, 2, dt);
    this.group.rotation.z = damp(this.group.rotation.z, this.tiltZ, 2, dt);

    // training
    if (this.queue.length && this.state === 'built') {
      const q = this.queue[0];
      q.t += dt;
      if (q.t >= q.time) {
        this.queue.shift();
        const d = this.doorPoint(_v);
        const unit = game.spawnUnit(q.type, d.x + rnd(-0.3, 0.3), d.z + rnd(-0.3, 0.3), { yaw: this.rot });
        unit.home = this;
        unit.cheer = 1.2;
        game.events.emit('unitTrained', unit, this);
      }
    }
  }

  _checkWater(dt) {
    const sim = this.game.sim;
    const w = sim.sampleWaterAround(this.pos.x, this.pos.z, this.radius * 0.95 + 0.35);
    if (w.maxD > 0.04 && !this.def.bridge) {
      this.wet = Math.min(1, this.wet + w.maxD * 0.8 * dt * 4);
      const mortar = this.game.economy.tech.mortar ? 0.6 : 1;
      const dmg = (w.maxD * 1.6 + w.maxS * w.maxD * 3.2) * 10 * dt * mortar * (this.state === 'site' ? 1.5 : 1);
      if (dmg > 0.02) this.damage(dmg, 'water');
      if (Math.random() < w.maxS * 0.15) this.game.particles.foamBurst(this.pos.x + rnd(-this.radius, this.radius), this.baseY + 0.2, this.pos.z + rnd(-this.radius, this.radius), 2, 0.6);
    } else {
      this.wet = Math.max(0, this.wet - dt * 0.015);
    }
  }

  _checkSupport(dt) {
    const sim = this.game.sim;
    const r = this.radius * 0.75;
    let lowX = 0, lowZ = 0, sum = 0, n = 0;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const x = this.pos.x + Math.cos(ang) * r, z = this.pos.z + Math.sin(ang) * r;
      const drop = this.baseY - sim.heightAt(x, z);
      sum += drop; n++;
      if (drop > 0.2) { lowX += Math.cos(ang) * drop; lowZ += Math.sin(ang) * drop; }
    }
    const avg = sum / n;
    // tilt toward undermined sides
    this.tiltX = clamp(lowZ * 0.12, -0.25, 0.25);
    this.tiltZ = clamp(-lowX * 0.12, -0.25, 0.25);
    if (avg > 0.3 || Math.hypot(lowX, lowZ) > 1.2) {
      this.damage((Math.max(avg - 0.3, 0) * 70 + Math.hypot(lowX, lowZ) * 8) * dt, 'support');
    }
  }

  train(type) {
    const def = UNIT_TYPES[type];
    if (!def || !this.def.trains || !this.def.trains.includes(type)) return { ok: false, reason: 'Cannot train here' };
    const eco = this.game.economy;
    if (eco.pop + (def.pop || 1) > eco.popCap) return { ok: false, reason: 'Need more housing' };
    if (!eco.spend(def.cost)) return { ok: false, reason: 'Not enough resources' };
    this.queue.push({ type, t: 0, time: 6 + (def.pop || 1) * 3 });
    return { ok: true };
  }

  upgradeCost() {
    const mult = 0.9 * this.level;
    const c = {};
    const base = Object.keys(this.def.cost).length ? this.def.cost : { shells: 30, pebbles: 10 };
    for (const k in base) c[k] = Math.ceil(base[k] * mult + 4);
    return c;
  }

  upgrade() {
    if (this.level >= 3 || this.state !== 'built') return false;
    if (!this.game.economy.spend(this.upgradeCost())) return false;
    this.level++;
    this.maxHp = Math.round(this.maxHp * 1.45);
    this.hp = this.maxHp;
    this.waterDmg = 0;
    this.group.scale.setScalar(1 + (this.level - 1) * 0.06);
    this.pop = 1;
    this.glow = 1;
    this.game.particles.sparkle(this.pos.x, this.baseY + this.height, this.pos.z, 30, [1, 0.9, 0.5], this.radius, 0.2);
    this.game.events.emit('buildingUpgraded', this);
    return true;
  }
}

export class Buildings {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.mats = makeSharedBuildingMaterials();
    this.ghostMat = makeGhostMaterial();
    this.placeGhostMat = makeGhostMaterial();
    game.bridges = [];
  }

  place(type, x, z, rot = 0, opts = {}) {
    const b = new Building(this.game, type, x, z, rot, opts);
    this.list.push(b);
    this.game.events.emit('buildingPlaced', b);
    return b;
  }

  canPlace(type, x, z, rot = 0, ignore = null) {
    const def = BUILDINGS[type];
    const sim = this.game.sim;
    const r = def.size;
    if (x - r < BOUNDS.minX || x + r > BOUNDS.maxX || z - r < BOUNDS.minZ || z + r > BOUNDS.maxZ) return { ok: false, reason: 'Too close to the edge' };
    let hmin = Infinity, hmax = -Infinity, wet = 0;
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      for (const f of [0.5, 1]) {
        const px = x + Math.cos(ang) * r * f, pz = z + Math.sin(ang) * r * f;
        const h = sim.heightAt(px, pz);
        hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
        wet = Math.max(wet, sim.depthAt(px, pz));
      }
    }
    if (def.bridge) {
      // bridges want a dip (trench / moat) under the middle and solid ends
      return { ok: true };
    }
    if (wet > 0.12) return { ok: false, reason: 'Too wet — the sea would wash it away' };
    if (hmax - hmin > Math.max(1.3, r * 0.6)) return { ok: false, reason: 'Ground is too uneven' };
    for (const b of this.list) {
      if (!b.alive || b === ignore) continue;
      const minD = def.line && b.def.line ? 0.9 : (r + b.radius) * (def.line || b.def.line ? 0.75 : 0.92);
      if (Math.hypot(b.pos.x - x, b.pos.z - z) < minD) return { ok: false, reason: 'Overlaps ' + b.def.short };
    }
    for (const c of this.game.props.colliders) {
      if (c.kind !== 'rock' && c.kind !== 'palm') continue;
      if (Math.hypot(c.x - x, c.z - z) < c.r * 0.8 + r * 0.8) return { ok: false, reason: 'A rock is in the way' };
    }
    return { ok: true };
  }

  update(dt) {
    const game = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      if (!b.alive) { this.list.splice(i, 1); continue; }
      b.update(dt);
    }
    // windows and doorways glow warmly at dusk and night
    const night = game.sky ? Math.min(1, globalNight() * 1.2 + Math.max(0, 0.15 - game.sky.sunElevation) * 2) : 0;
    const flicker = 0.92 + 0.08 * Math.sin(game.time * 9.1) * Math.sin(game.time * 5.3);
    this.mats.dark.emissive.setRGB(1.0, 0.55, 0.22);
    this.mats.dark.emissiveIntensity = night * 2.4 * flicker;
    this._fires(dt, night);
  }

  _fires(dt, night) {
    const game = this.game;
    if (!this.lights) {
      this.lights = [];
      for (let i = 0; i < 3; i++) {
        const l = new THREE.PointLight(0xff9a4a, 0, 9, 1.8);
        l.position.set(0, -50, 0);
        game.scene.add(l);
        this.lights.push(l);
      }
    }
    const fires = [];
    for (const b of this.list) {
      if (!b.alive || b.state !== 'built') continue;
      const f = b.slot('fire');
      if (f) {
        fires.push({ x: f.x, y: f.y + 0.3, z: f.z, k: 1 });
        if (Math.random() < dt * 14) game.particles.ember(f.x, f.y + 0.05, f.z, 1);
        if (Math.random() < dt * 3) game.particles.smoke(f.x, f.y + 0.3, f.z, 1, 0.8);
      }
      if (b.type === 'keep' || b.type === 'barracks' || b.type === 'house') {
        const d = b.doorPoint(_v);
        fires.push({ x: d.x, y: b.baseY + 0.8, z: d.z, k: b.type === 'keep' ? 1.4 : 0.6 });
      }
    }
    const focus = game.rig.focusPoint;
    fires.sort((a, c) => (a.x - focus.x) ** 2 + (a.z - focus.z) ** 2 - ((c.x - focus.x) ** 2 + (c.z - focus.z) ** 2));
    // a cosy lamp inside whatever building is being peeked into
    const insp = game.ui && game.ui.inspected;
    const room = insp && insp.alive && insp.sandMat.userData.u.uCutY.value < 1e4 && insp.slot('interior');
    if (room) fires.unshift({ x: room.x, y: room.y + 0.75, z: room.z, k: 1, inside: insp.radius * 1.5 });
    this.lights.forEach((l, i) => {
      const f = fires[i];
      if (!f) { l.intensity = 0; return; }
      l.position.set(f.x, f.y, f.z);
      const flick = 0.85 + 0.15 * Math.sin(game.time * 13 + i * 2) * Math.sin(game.time * 7.7 + i);
      l.distance = f.inside || 9;
      l.intensity = (f.inside ? 2.6 + night * 2 : (0.4 + night * 5) * f.k) * flick;
    });
  }

  nearestStorage(x, z) {
    let best = null, bd = Infinity;
    for (const b of this.list) {
      if (!b.isStorage) continue;
      const d = Math.hypot(b.pos.x - x, b.pos.z - z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // Find a building under a world point.
  at(x, z, pad = 0.2) {
    let best = null, bd = Infinity;
    for (const b of this.list) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - x, b.pos.z - z);
      if (d < b.radius + pad && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // Ray pick against building bounding cylinders.
  pick(ray) {
    let best = null, bt = Infinity;
    const o = ray.origin, d = ray.direction;
    for (const b of this.list) {
      if (!b.alive) continue;
      const r = b.radius * 0.95;
      // ray vs vertical cylinder (2D circle test) then height
      const ox = o.x - b.pos.x, oz = o.z - b.pos.z;
      const A = d.x * d.x + d.z * d.z, B = 2 * (ox * d.x + oz * d.z), C = ox * ox + oz * oz - r * r;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      const sq = Math.sqrt(disc);
      for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
        if (t < 0) continue;
        const y = o.y + d.y * t;
        if (y >= b.baseY - 0.2 && y <= b.baseY + b.height * Math.max(0.25, b.progress) + 0.3) {
          if (t < bt) { bt = t; best = b; }
          break;
        }
      }
      // also hit the top cap
      if (d.y < 0) {
        const t = (b.baseY + b.height * Math.max(0.25, b.progress) - o.y) / d.y;
        if (t > 0) {
          const px = o.x + d.x * t - b.pos.x, pz = o.z + d.z * t - b.pos.z;
          if (px * px + pz * pz < r * r && t < bt) { bt = t; best = b; }
        }
      }
    }
    return best ? { building: best, t: bt } : null;
  }

  count(type, builtOnly = true) {
    return this.list.filter((b) => b.alive && b.type === type && (!builtOnly || b.state === 'built')).length;
  }
}
