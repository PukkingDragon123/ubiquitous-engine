// Ballistic projectiles: toothpick arrows, cannon pebbles, catapult rocks,
// and pistol-shrimp bubbles.
import * as THREE from 'three';
import { InstancedLayer } from './InstancedLayer.js';
import { makeRockGeometry } from '../world/propGeometry.js';
import { rnd, clamp } from '../core/math.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const G = 9.8;

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    const root = new THREE.Group();
    game.scene.add(root);
    const arrowGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.55, 5);
    arrowGeo.rotateX(Math.PI / 2);
    const tip = new THREE.ConeGeometry(0.022, 0.07, 5);
    tip.rotateX(Math.PI / 2);
    tip.translate(0, 0, 0.3);
    this.arrowLayer = new InstancedLayer(root, arrowGeo, new THREE.MeshStandardMaterial({ color: 0xe8d3a8, roughness: 0.7 }), 400, { colors: false });
    this.tipLayer = new InstancedLayer(root, tip, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }), 400, { colors: true });
    this.ballLayer = new InstancedLayer(root, makeRockGeometry(1234, { detail: 1, flat: 0.9 }), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), 120, { colors: false });
    this.bubbleLayer = new InstancedLayer(root, new THREE.SphereGeometry(0.5, 14, 10), new THREE.MeshStandardMaterial({ color: 0xbfefff, roughness: 0.05, transparent: true, opacity: 0.55, emissive: 0x2a6a80, emissiveIntensity: 0.4 }), 80, { colors: false, cast: false });
  }

  // velocity that reaches `to` from `from` in time t
  _solve(from, to, t, out) {
    out.set((to.x - from.x) / t, (to.y - from.y + 0.5 * G * t * t) / t, (to.z - from.z) / t);
    return out;
  }

  arrow(from, target, dmg, opts = {}) {
    const tp = target.centerPos ? target.centerPos(new THREE.Vector3()) : target.pos.clone();
    const d = from.distanceTo(tp);
    const t = clamp(d / 15, 0.25, 1.6);
    // lead moving targets
    if (target.vel) tp.addScaledVector(target.vel, t * 0.8);
    tp.x += rnd(-0.25, 0.25) * (d / 10); tp.z += rnd(-0.25, 0.25) * (d / 10);
    const vel = this._solve(from, tp, t, new THREE.Vector3());
    this.list.push({ kind: 'arrow', pos: from.clone(), vel, dmg, team: opts.team ?? 0, life: 6, stuck: 0, color: new THREE.Color(opts.color || 0xff6b6b) });
    this.game.events.emit('arrowShot', from);
  }

  cannon(from, to, dmg, splash) {
    const d = from.distanceTo(to);
    const t = clamp(d / 19, 0.35, 1.4);
    const vel = this._solve(from, to, t, new THREE.Vector3());
    this.list.push({ kind: 'ball', pos: from.clone(), vel, dmg, splash, size: 0.2, team: 0, life: 5, spin: new THREE.Vector3(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)), rot: new THREE.Euler() });
    this.game.particles.dust(from.x, from.y, from.z, 6, 0.6, [0.85, 0.82, 0.78]);
    this.game.events.emit('cannonFire', from);
    this.game.rig.addShake(0.08);
  }

  rock(from, to, dmg, splash) {
    const d = from.distanceTo(to);
    const t = 1.1 + d / 20;
    const vel = this._solve(from, to, t, new THREE.Vector3());
    this.list.push({ kind: 'ball', pos: from.clone(), vel, dmg, splash, size: 0.42, team: 0, life: 7, spin: new THREE.Vector3(rnd(-5, 5), rnd(-5, 5), rnd(-5, 5)), rot: new THREE.Euler(), big: true });
    this.game.events.emit('catapultFire', from);
  }

  bubble(shooter, target) {
    const from = shooter.centerPos(new THREE.Vector3());
    from.y += 0.2;
    const tp = target.centerPos ? target.centerPos(new THREE.Vector3()) : target.pos.clone();
    const dir = tp.sub(from).normalize();
    this.list.push({ kind: 'bubble', pos: from, vel: dir.multiplyScalar(9), dmg: shooter.def.dmg, team: 1, life: 2.5, size: 0.12 });
    this.game.events.emit('bubbleShot', from);
  }

  update(dt) {
    const game = this.game, sim = game.sim;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) { this.list.splice(i, 1); continue; }
      if (p.stuck > 0) continue;
      if (p.kind === 'bubble') {
        p.vel.y += 0.6 * dt;
        p.size = Math.min(0.2, p.size + dt * 0.05);
      } else {
        p.vel.y -= G * dt;
      }
      p.pos.addScaledVector(p.vel, dt);
      if (p.rot) { p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt; }
      if (p.kind === 'arrow') (p.q || (p.q = new THREE.Quaternion())).setFromUnitVectors(Z, _v.copy(p.vel).normalize());
      // hits
      let hit = null;
      const r = p.kind === 'ball' ? (p.big ? 0.75 : 0.5) : 0.4;
      if (p.team === 0) {
        game.spatial.query(p.pos.x, p.pos.z, r + 2, (o) => {
          if (o.kind !== 'enemy' || !o.alive) return;
          const c = o.centerPos(_v);
          const rr = r + 0.3 * o.size;
          if ((c.x - p.pos.x) ** 2 + (c.z - p.pos.z) ** 2 < rr * rr && Math.abs(c.y - p.pos.y) < 0.5 * o.size + 0.3) { hit = o; return false; }
        });
      } else {
        game.spatial.query(p.pos.x, p.pos.z, 1.5, (o) => {
          if (o.kind !== 'unit' || !o.alive) return;
          const c = o.centerPos(_v);
          if ((c.x - p.pos.x) ** 2 + (c.z - p.pos.z) ** 2 + (c.y - p.pos.y) ** 2 < 0.35 * 0.35) { hit = o; return false; }
        });
      }
      const gy = sim.heightAt(p.pos.x, p.pos.z);
      const surf = gy + sim.depthAt(p.pos.x, p.pos.z);
      if (hit) {
        this._impact(p, hit);
        this.list.splice(i, 1);
        continue;
      }
      if (p.pos.y <= surf) {
        if (surf - gy > 0.08) {
          game.particles.splash(p.pos.x, surf, p.pos.z, p.kind === 'ball' ? (p.big ? 30 : 16) : 4, p.big ? 1.6 : 0.7);
          if (p.kind === 'ball') this._explode(p, true);
          this.list.splice(i, 1);
          game.events.emit('splash', p.pos, p.kind);
        } else if (p.kind === 'arrow') {
          // stick in the sand
          p.stuck = 1;
          p.pos.y = gy + 0.08;
          p.life = 5;
          game.particles.dust(p.pos.x, gy, p.pos.z, 1, 0.3);
          game.events.emit('arrowThunk', p.pos);
        } else if (p.kind === 'ball') {
          this._explode(p, false);
          this.list.splice(i, 1);
        } else {
          game.particles.splash(p.pos.x, gy + 0.1, p.pos.z, 6, 0.5);
          this.list.splice(i, 1);
        }
      }
    }
  }

  _impact(p, target) {
    const game = this.game;
    const sp = p.vel.length() || 1;
    const nx = p.vel.x / sp, nz = p.vel.z / sp;
    if (p.kind === 'arrow') {
      const bows = game.economy.tech.bows ? 1.25 : 1;
      target.hit(p.dmg * bows, nx * 2.5, 1, nz * 2.5, { ranged: true, pierce: true });
      game.events.emit('arrowHit', target);
    } else if (p.kind === 'bubble') {
      target.hit(p.dmg, nx * 6, 3, nz * 6, { ranged: true, knock: true });
      game.particles.splash(p.pos.x, p.pos.y, p.pos.z, 10, 0.6);
      game.events.emit('bubblePop', p.pos);
    } else {
      this._explode(p, false, target);
    }
  }

  _explode(p, inWater, direct) {
    const game = this.game, sim = game.sim;
    const R = p.splash || 1.4;
    for (const e of game.enemies) {
      if (!e.alive) continue;
      const c = e.centerPos(_v);
      const dx = c.x - p.pos.x, dz = c.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > R + 0.3 * e.size) continue;
      const f = 1 - d / (R + 0.3 * e.size);
      const k = (p.big ? 11 : 8) * f;
      e.hit(p.dmg * (e === direct ? 1 : 0.4 + f * 0.6), (dx / (d || 1)) * k, k * 0.8 + 2, (dz / (d || 1)) * k, { explosion: true, knock: true });
    }
    // friendly fire knocks sandlings around too (but hurts less)
    for (const u of game.units) {
      if (!u.alive || !u.p.length) continue;
      const dx = u.pos.x - p.pos.x, dz = u.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > R * 0.8) continue;
      const f = 1 - d / (R * 0.8);
      u.hit(p.dmg * 0.15 * f, (dx / (d || 1)) * 6 * f, 4 * f, (dz / (d || 1)) * 6 * f, { explosion: true, sever: false });
    }
    if (!inWater) {
      const res = sim.dig(p.pos.x, p.pos.z, R * 0.45, p.big ? 0.35 : 0.18);
      game.particles.sandSpray(p.pos.x, sim.heightAt(p.pos.x, p.pos.z), p.pos.z, 0, 0, p.big ? 40 : 22, res.vol, res.wet, p.big ? 1.6 : 1.1);
      game.particles.dust(p.pos.x, p.pos.y, p.pos.z, p.big ? 14 : 7, p.big ? 1.4 : 0.9);
      for (let i = 0; i < (p.big ? 6 : 3); i++) game.particles.chunk(p.pos.x, p.pos.y + 0.1, p.pos.z, rnd(-3, 3), rnd(2, 5), rnd(-3, 3), rnd(0.05, 0.12), 0x8a8078, 3);
    }
    game.rig.addShake(p.big ? 0.25 : 0.12);
    game.events.emit('explosion', p.pos, p.big);
  }

  render() {
    this.arrowLayer.begin(); this.tipLayer.begin(); this.ballLayer.begin(); this.bubbleLayer.begin();
    for (const p of this.list) {
      if (p.kind === 'arrow') {
        if (!p.q) continue;
        _m.compose(p.pos, p.q, _s.setScalar(1));
        this.arrowLayer.push(_m);
        this.tipLayer.push(_m, p.color);
      } else if (p.kind === 'ball') {
        _q.setFromEuler(p.rot);
        _m.compose(p.pos, _q, _s.setScalar(p.size));
        this.ballLayer.push(_m);
      } else if (p.kind === 'bubble') {
        _m.compose(p.pos, _q.identity(), _s.setScalar(p.size));
        this.bubbleLayer.push(_m);
      }
    }
    this.arrowLayer.end(); this.tipLayer.end(); this.ballLayer.end(); this.bubbleLayer.end();
  }
}
