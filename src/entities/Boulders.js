// Movable boulders: heavy rocks the commander's hand can drag across the beach.
// They plough grooves in the sand, block water and crabs, and can crush things.
import * as THREE from 'three';
import { makeRockGeometry } from '../world/propGeometry.js';
import { X0, Z0, CELL } from '../world/config.js';
import { damp, rnd, clamp } from '../core/math.js';

class Boulder {
  constructor(game, x, z, r, geo) {
    this.game = game;
    this.kind = 'boulder';
    this.r = r;
    this.pos = new THREE.Vector3(x, game.sim.heightAt(x, z), z);
    this.vel = new THREE.Vector3();
    this.held = false;
    this.mesh = new THREE.Mesh(geo, game.props.rockMat);
    this.mesh.scale.set(r * 1.15, r * 0.85, r * 1.05);
    this.mesh.rotation.y = rnd(0, Math.PI * 2);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    game.scene.add(this.mesh);
    this.col = { x, z, r: r * 0.95, top: this.pos.y + r * 0.8, boulder: this };
    game.staticColliders.push(this.col);
    game.verlet.colliders.push(this.col);
    this.cells = [];
    this._block();
  }

  _block() {
    const sim = this.game.sim;
    for (const k of this.cells) sim.obst[k] = sim.obstRock[k];
    this.cells = [];
    const r = this.r * 0.85;
    const i0 = Math.max(1, Math.floor((this.pos.x - r - X0) / CELL)), i1 = Math.min(sim.W - 2, Math.ceil((this.pos.x + r - X0) / CELL));
    const j0 = Math.max(1, Math.floor((this.pos.z - r - Z0) / CELL)), j1 = Math.min(sim.H - 2, Math.ceil((this.pos.z + r - Z0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = X0 + i * CELL, z = Z0 + j * CELL;
      const d2 = ((x - this.pos.x) ** 2 + (z - this.pos.z) ** 2) / (r * r);
      if (d2 > 1) continue;
      const k = j * sim.W + i;
      sim.obst[k] = Math.max(sim.obst[k], this.r * 0.8 * Math.sqrt(1 - d2));
      this.cells.push(k);
    }
  }

  dragTo(x, z, dt) {
    const sim = this.game.sim;
    const ox = this.pos.x, oz = this.pos.z;
    // heavy: lags behind the hand
    const k = 3.5 / (this.r + 0.5);
    this.pos.x = damp(this.pos.x, x, k, dt);
    this.pos.z = damp(this.pos.z, z, k, dt);
    this.pos.x = clamp(this.pos.x, X0 + 4, -X0 - 4);
    this.pos.z = clamp(this.pos.z, Z0 + 4, -Z0 - 4);
    const dx = this.pos.x - ox, dz = this.pos.z - oz;
    const d = Math.hypot(dx, dz);
    if (d > 0.002) {
      // plough: dig a groove under the rock, push sand ahead
      const res = sim.dig(this.pos.x, this.pos.z, this.r * 0.55, d * 0.5);
      sim.deposit(this.pos.x + (dx / d) * this.r * 1.1, this.pos.z + (dz / d) * this.r * 1.1, this.r * 0.6, res.vol, res.wet);
      this.mesh.rotation.x += dz / this.r;
      this.mesh.rotation.z -= dx / this.r;
      if (Math.random() < d * 6) this.game.particles.dust(this.pos.x, this.pos.y, this.pos.z, 1, 0.6);
      // crush whatever is in the way
      for (const e of this.game.enemies) {
        if (!e.alive) continue;
        if (Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) < this.r + 0.3 && d / dt > 2) e.hit(25 * (d / dt) * 0.1, (dx / d) * 6, 3, (dz / d) * 6, { crush: true });
      }
    }
    this.lift = 0.6;
  }

  release() {
    this._block();
  }

  update(dt) {
    const sim = this.game.sim;
    this.lift = damp(this.lift || 0, this.held ? 0.6 : 0, 8, dt);
    const gy = sim.heightAt(this.pos.x, this.pos.z);
    this.pos.y = damp(this.pos.y, gy, 10, dt);
    this.mesh.position.set(this.pos.x, this.pos.y + this.lift - this.r * 0.15, this.pos.z);
    this.col.x = this.pos.x; this.col.z = this.pos.z; this.col.top = this.pos.y + this.r * 0.8;
  }
}

export class Boulders {
  constructor(game) {
    this.game = game;
    this.list = [];
    const geos = [0, 1, 2].map((i) => makeRockGeometry(800 + i, { detail: 3, flat: 0.75 }));
    const spots = [[-14, 4, 0.9], [11, 10, 1.1], [24, 2, 0.8], [-28, 18, 1.0], [4, 20, 0.75], [32, 22, 1.2], [-8, -4, 0.7]];
    spots.forEach(([x, z, r], i) => {
      if (game.blockedAt(x, z, r + 0.5)) return;
      this.list.push(new Boulder(game, x, z, r, geos[i % 3]));
    });
  }
  update(dt) { for (const b of this.list) b.update(dt); }
}
