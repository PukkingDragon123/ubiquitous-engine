// Severed sandling limbs and heads: tumble physically, then crumble to sand.
import * as THREE from 'three';

const _axis = new THREE.Vector3();
const _dq = new THREE.Quaternion();

export class Limbs {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  add(l) {
    l.life = 9 + Math.random() * 4;
    l.quat = new THREE.Quaternion();
    if (l.kind === 'head') {
      const V = this.game.verlet;
      V.rad[l.a] = 0.19 * l.scale;
      V.fric[l.a] = 0.1;
    }
    this.list.push(l);
  }

  update(dt) {
    const V = this.game.verlet;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const l = this.list[i];
      l.life -= dt;
      if (l.kind === 'head' && V.flags[l.a] & 1) {
        // roll: angular velocity from linear velocity over the ground
        const vx = V.velX(l.a), vz = V.velZ(l.a);
        const sp = Math.hypot(vx, vz);
        if (sp > 0.01) {
          _axis.set(vz, 0, -vx).normalize();
          _dq.setFromAxisAngle(_axis, (sp * dt) / (0.19 * l.scale));
          l.quat.premultiply(_dq);
        }
      }
      if (l.life <= 0) {
        const parts = this.game.particles;
        const pts = l.kind === 'head' ? [l.a] : [l.a, l.b];
        for (const p of pts) {
          if (p < 0 || !(V.flags[p] & 1)) continue;
          parts.sandSpray(V.px[p], V.py[p], V.pz[p], 0, 0, 5, 0.004 * l.scale, 0.3, 0.2);
        }
        if (l.c !== undefined && l.c >= 0) V.removeConstraint(l.c);
        for (const p of pts) V.removeParticle(p);
        this.list.splice(i, 1);
      }
    }
  }

  clear() {
    for (const l of this.list) l.life = 0;
    this.update(0);
  }
}
