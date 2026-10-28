// Tiny sand dragons: hatched at the roost, they circle the kingdom and roast
// crabs with breaths of scorching sand. Possess one to fly it yourself.
import * as THREE from 'three';
import { makeSandBodyMaterial } from './InstancedLayer.js';
import { clamp, damp, dampAngle, rnd, lerp } from '../core/math.js';

let DID = 1;
const _v = new THREE.Vector3();

function buildModel() {
  const g = new THREE.Group();
  const sand = makeSandBodyMaterial({ rim: 0.12 });
  sand.color.set(0xdca56a);
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xe8a868, roughness: 0.7, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x7de8c8, emissive: 0x3fe0c0, emissiveIntensity: 2.2, roughness: 0.1 });
  const hornMat = new THREE.MeshStandardMaterial({ color: 0xf6e7c4, roughness: 0.5 });
  const fx = (geo) => { geo.setAttribute('aFx', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2)); return geo; };
  const body = new THREE.Mesh(fx(new THREE.SphereGeometry(0.32, 18, 12)), sand);
  body.scale.set(0.85, 0.8, 1.35);
  const chest = new THREE.Mesh(fx(new THREE.SphereGeometry(0.24, 14, 10)), sand);
  chest.position.set(0, 0.06, 0.32);
  const neck = new THREE.Mesh(fx(new THREE.CylinderGeometry(0.1, 0.16, 0.4, 10)), sand);
  neck.position.set(0, 0.22, 0.48);
  neck.rotation.x = 0.8;
  const head = new THREE.Group();
  head.position.set(0, 0.38, 0.68);
  const skull = new THREE.Mesh(fx(new THREE.SphereGeometry(0.16, 14, 10)), sand);
  skull.scale.set(1, 0.9, 1.2);
  const snout = new THREE.Mesh(fx(new THREE.SphereGeometry(0.1, 12, 8)), sand);
  snout.scale.set(0.9, 0.7, 1.5);
  snout.position.set(0, -0.03, 0.16);
  const jaw = new THREE.Mesh(fx(new THREE.SphereGeometry(0.08, 10, 6)), sand);
  jaw.scale.set(0.9, 0.5, 1.4);
  jaw.position.set(0, -0.08, 0.13);
  head.add(skull, snout, jaw);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMat);
    eye.position.set(s * 0.085, 0.05, 0.1);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 6), hornMat);
    horn.position.set(s * 0.07, 0.15, -0.05);
    horn.rotation.x = -0.7;
    head.add(eye, horn);
  }
  // wings: two-segment membranes
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0);
  wingShape.lineTo(0.55, 0.18);
  wingShape.lineTo(0.95, 0.05);
  wingShape.quadraticCurveTo(0.7, -0.05, 0.62, -0.28);
  wingShape.quadraticCurveTo(0.42, -0.12, 0.3, -0.32);
  wingShape.quadraticCurveTo(0.18, -0.1, 0, -0.18);
  const wingGeo = new THREE.ShapeGeometry(wingShape, 6);
  wingGeo.rotateX(-Math.PI / 2);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.18, 0.18, 0.12);
    const w = new THREE.Mesh(wingGeo, wingMat);
    w.scale.set(s, 1, 1);
    pivot.add(w);
    g.add(pivot);
    wings.push(pivot);
  }
  // tail chain
  const tail = [];
  let parent = g;
  let z = -0.35;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, 0, i === 0 ? z : -0.15);
    const r = 0.11 * (1 - i / 7);
    const m = new THREE.Mesh(fx(new THREE.SphereGeometry(r, 10, 8)), sand);
    m.scale.set(1, 0.9, 1.4);
    seg.add(m);
    parent.add(seg);
    parent = seg;
    tail.push(seg);
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 4), hornMat);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.1;
  parent.add(tip);
  // little legs tucked under
  for (const [x, zz] of [[-0.14, 0.2], [0.14, 0.2], [-0.15, -0.2], [0.15, -0.2]]) {
    const leg = new THREE.Mesh(fx(new THREE.CylinderGeometry(0.035, 0.03, 0.18, 6)), sand);
    leg.position.set(x, -0.22, zz);
    leg.rotation.x = 0.6;
    g.add(leg);
  }
  g.add(body, chest, neck, head);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, wings, tail, head, jaw };
}

export class Dragon {
  constructor(game, x, z, opts = {}) {
    this.game = game;
    this.id = 50000 + DID++;
    this.kind = 'unit';
    this.type = 'dragon';
    this.def = { name: 'Sand Dragon', hp: 180, speed: 6.5, dmg: 24, range: 6.5, pop: 3, flying: true };
    this.name = opts.name || ['Ember', 'Gritsy', 'Dune', 'Scorch', 'Pebble', 'Sizzle'][DID % 6];
    this.maxHp = this.def.hp;
    this.hp = this.maxHp;
    this.alive = true;
    this.pos = new THREE.Vector3(x, game.sim.heightAt(x, z) + 1, z);
    this.vel = new THREE.Vector3();
    this.yaw = opts.yaw || 0;
    this.bank = 0;
    this.pitch = 0;
    this.flap = Math.random() * 6;
    this.breath = 0;
    this.breathCd = 0;
    this.target = null;
    this.home = opts.home || null;
    this.p = []; // no ragdoll
    this.scale = 1.3;
    this.radius = 0.6;
    this.possessed = false;
    this.selected = false;
    this.manual = null;
    this.circle = Math.random() * Math.PI * 2;
    const m = buildModel();
    Object.assign(this, { model: m.group, wings: m.wings, tail: m.tail, headNode: m.head, jaw: m.jaw });
    this.model.scale.setScalar(this.scale);
    game.scene.add(this.model);
    this.flash = 0;
  }

  get isActive() { return this.alive; }
  headPos(out) { return this.headNode.getWorldPosition(out); }
  centerPos(out) { return out.copy(this.pos); }
  cameraAnchor(out) { return out.copy(this.pos).add(_v.set(0, 0.6, 0)); }
  hit(dmg, ix = 0, iy = 0, iz = 0) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.flash = 1;
    this.vel.x += ix * 0.3; this.vel.y += iy * 0.3; this.vel.z += iz * 0.3;
    if (this.hp <= 0) this.die();
  }
  applyImpulse(ix, iy, iz) { this.vel.x += ix * 0.3; this.vel.y += iy * 0.3; this.vel.z += iz * 0.3; }
  knockDown() {}
  die() {
    this.alive = false;
    const p = this.game.particles;
    p.sandSpray(this.pos.x, this.pos.y, this.pos.z, 0, 0, 40, 0.05, 0.3, 1);
    p.dust(this.pos.x, this.pos.y, this.pos.z, 12, 1);
    this.game.scene.remove(this.model);
    this.game.events.emit('unitDied', this);
  }

  _nearestEnemy(r) {
    let best = null, bd = r;
    const cx = this.home && this.home.alive ? this.home.pos.x : this.pos.x;
    const cz = this.home && this.home.alive ? this.home.pos.z : this.pos.z;
    for (const e of this.game.enemies) {
      if (!e.alive) continue;
      const d = Math.min(Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z), Math.hypot(e.pos.x - cx, e.pos.z - cz) + 4);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  update(dt) {
    if (!this.alive) return;
    const game = this.game, sim = game.sim;
    this.flash = Math.max(0, this.flash - dt * 3);
    const ground = Math.max(sim.heightAt(this.pos.x, this.pos.z), sim.seaLevel);
    let want = new THREE.Vector3();
    let wantY = ground + 5;
    let breathing = false;
    if (this.possessed && this.manual) {
      const m = this.manual;
      want.set(m.x, 0, m.z).multiplyScalar(this.def.speed * (m.sprint ? 1.5 : 1));
      wantY = this.pos.y + m.y * 4;
      if (m.face !== undefined) this.yaw = dampAngle(this.yaw, m.face, 6, dt);
      breathing = m.fire;
    } else {
      if (!this.target || !this.target.alive || Math.random() < dt * 0.5) this.target = this._nearestEnemy(24);
      const t = this.target;
      if (t) {
        const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        wantY = ground + 3.2;
        if (d > this.def.range * 0.8) want.set(dx / d, 0, dz / d).multiplyScalar(this.def.speed);
        else want.set(-dz / d, 0, dx / d).multiplyScalar(1.2); // strafe while roasting
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 5, dt);
        breathing = d < this.def.range && this.breathCd <= 0;
      } else {
        // lazy circles over home
        const hx = this.home && this.home.alive ? this.home.pos.x : 0, hz = this.home && this.home.alive ? this.home.pos.z : 6;
        this.circle += dt * 0.45;
        const tx = hx + Math.cos(this.circle) * 7, tz = hz + Math.sin(this.circle) * 7;
        want.set(tx - this.pos.x, 0, tz - this.pos.z);
        const l = want.length();
        if (l > 0.01) want.multiplyScalar(Math.min(this.def.speed * 0.6, l) / l);
        if (want.lengthSq() > 0.1) this.yaw = dampAngle(this.yaw, Math.atan2(want.x, want.z), 3, dt);
        wantY = ground + 6;
      }
    }
    this.vel.x = damp(this.vel.x, want.x, 2.5, dt);
    this.vel.z = damp(this.vel.z, want.z, 2.5, dt);
    this.vel.y = damp(this.vel.y, clamp((wantY - this.pos.y) * 2, -4, 4), 3, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.pos.y = Math.max(this.pos.y, ground + 0.8);
    this.pos.x = clamp(this.pos.x, -50, 50);
    this.pos.z = clamp(this.pos.z, -45, 45);
    // breath of scorching sand
    this.breathCd -= dt;
    if (breathing) {
      this.breath += dt;
      const head = this.headPos(_v);
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const p = game.particles;
      for (let i = 0; i < 3; i++) {
        p.spawn(8, head.x + fx * 0.2, head.y - 0.05, head.z + fz * 0.2, fx * rnd(5, 8) + rnd(-1, 1), rnd(-2.5, -0.5), fz * rnd(5, 8) + rnd(-1, 1), rnd(0.4, 0.8), rnd(0.06, 0.12), 1, rnd(0.4, 0.7), 0.15, 1);
        p.spawn(1, head.x + fx * 0.4, head.y, head.z + fz * 0.4, fx * rnd(3, 6), rnd(-1.5, 0), fz * rnd(3, 6), rnd(0.5, 0.9), rnd(0.25, 0.4), 1, 0.6, 0.25, 0.5, 0, 1.2);
      }
      for (const e of game.enemies) {
        if (!e.alive) continue;
        const ex = e.pos.x - head.x, ez = e.pos.z - head.z;
        const d = Math.hypot(ex, ez);
        if (d > this.def.range || (ex * fx + ez * fz) / (d || 1) < 0.8) continue;
        e.hit(this.def.dmg * dt * (this.possessed ? 1.5 : 1), fx * 0.6, 0.3, fz * 0.6, { fire: true, sever: false });
        e.toasted = Math.min(1, (e.toasted || 0) + dt * 0.5);
      }
      if (Math.random() < dt * 6) game.events.emit('dragonFire', this);
      if (this.breath > 2.4 && !this.possessed) { this.breath = 0; this.breathCd = 2.2; }
    } else this.breath = Math.max(0, this.breath - dt);
    this._animate(dt, breathing);
  }

  _animate(dt, breathing) {
    const m = this.model;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.flap += dt * (breathing ? 9 : 7 + sp * 0.6);
    const wingA = Math.sin(this.flap) * 0.9;
    this.wings[0].rotation.z = wingA;
    this.wings[1].rotation.z = -wingA;
    // bank into turns, pitch with climb
    const turn = (this.yaw - (this._lastYaw ?? this.yaw)) / Math.max(dt, 1e-4);
    this._lastYaw = this.yaw;
    this.bank = damp(this.bank, clamp(-turn * 0.25, -0.6, 0.6), 4, dt);
    this.pitch = damp(this.pitch, clamp(-this.vel.y * 0.12, -0.4, 0.4), 4, dt);
    m.position.copy(this.pos);
    m.position.y += Math.sin(this.flap) * 0.06;
    m.rotation.set(this.pitch, this.yaw, this.bank, 'YXZ');
    for (let i = 0; i < this.tail.length; i++) this.tail[i].rotation.y = Math.sin(this.flap * 0.5 - i * 0.6) * 0.25;
    this.jaw.rotation.x = breathing ? 0.5 : 0.05;
    this.headNode.rotation.x = breathing ? 0.35 : Math.sin(this.flap * 0.3) * 0.1;
  }
}
