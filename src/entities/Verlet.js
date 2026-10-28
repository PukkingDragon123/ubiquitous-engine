// Verlet particle physics used for every body in the game (sand people, crabs,
// detached limbs). Bodies are particles joined by (breakable) distance
// constraints. Living bodies are "active ragdolls": each particle is pulled
// toward an animated target pose, so hits, waves and falls look physical and
// goofy, and the same bodies go fully limp when knocked out or killed.
import { clamp } from '../core/math.js';

export const PF = { ACTIVE: 1, COLLIDE: 2, GROUND: 4, WATER: 8, HELD: 16, GHOST: 32 };

export class Verlet {
  constructor(sim, maxP = 7000, maxC = 14000) {
    this.sim = sim;
    this.maxP = maxP;
    this.maxC = maxC;
    const f = (n) => new Float32Array(n);
    this.px = f(maxP); this.py = f(maxP); this.pz = f(maxP);
    this.ox = f(maxP); this.oy = f(maxP); this.oz = f(maxP);
    this.tx = f(maxP); this.ty = f(maxP); this.tz = f(maxP); this.tk = f(maxP);
    this.inv = f(maxP); this.rad = f(maxP);
    this.fric = f(maxP);
    this.buoy = f(maxP);
    this.body = new Int32Array(maxP).fill(-1);
    this.flags = new Uint8Array(maxP);
    this.submerge = f(maxP);
    this.impact = f(maxP); // last ground impact speed (for sounds / damage)
    this.freeP = [];
    for (let i = maxP - 1; i >= 0; i--) this.freeP.push(i);
    this.ca = new Int32Array(maxC); this.cb = new Int32Array(maxC);
    this.crest = f(maxC); this.cstiff = f(maxC);
    this.cmin = new Uint8Array(maxC); // 1 = only push apart (min distance)
    this.cactive = new Uint8Array(maxC);
    this.freeC = [];
    for (let i = maxC - 1; i >= 0; i--) this.freeC.push(i);
    this.cHigh = 0; // highest constraint index ever used
    this.pHigh = 0;
    this.colliders = []; // circles: {x, z, r, top}
    this.boxes = []; // oriented boxes: {x, z, hx, hz, c, s, top}
    this.gravity = -9.8;
    this.iterations = 4;
    this.hash = new Map();
    this.onImpact = null; // (i, speed)
  }

  addParticle(x, y, z, r = 0.1, mass = 1, body = -1, flags = PF.ACTIVE | PF.COLLIDE) {
    if (!this.freeP.length) return -1;
    const i = this.freeP.pop();
    this.px[i] = this.ox[i] = x;
    this.py[i] = this.oy[i] = y;
    this.pz[i] = this.oz[i] = z;
    this.tk[i] = 0;
    this.inv[i] = mass > 0 ? 1 / mass : 0;
    this.rad[i] = r;
    this.fric[i] = 0.55;
    this.buoy[i] = 1.0;
    this.body[i] = body;
    this.flags[i] = flags;
    this.submerge[i] = 0;
    if (i + 1 > this.pHigh) this.pHigh = i + 1;
    return i;
  }

  removeParticle(i) {
    if (i < 0 || !(this.flags[i] & PF.ACTIVE)) return;
    this.flags[i] = 0;
    this.body[i] = -1;
    this.freeP.push(i);
  }

  addConstraint(a, b, stiff = 1, rest = -1, minOnly = false) {
    if (!this.freeC.length) return -1;
    const c = this.freeC.pop();
    this.ca[c] = a; this.cb[c] = b;
    this.crest[c] = rest >= 0 ? rest : Math.hypot(this.px[b] - this.px[a], this.py[b] - this.py[a], this.pz[b] - this.pz[a]);
    this.cstiff[c] = stiff;
    this.cmin[c] = minOnly ? 1 : 0;
    this.cactive[c] = 1;
    if (c + 1 > this.cHigh) this.cHigh = c + 1;
    return c;
  }

  removeConstraint(c) {
    if (c < 0 || !this.cactive[c]) return;
    this.cactive[c] = 0;
    this.freeC.push(c);
  }

  setTarget(i, x, y, z, k) {
    this.tx[i] = x; this.ty[i] = y; this.tz[i] = z; this.tk[i] = k;
  }

  // Add a velocity change (units / s).
  impulse(i, vx, vy, vz, dt = 1 / 60) {
    this.ox[i] -= vx * dt;
    this.oy[i] -= vy * dt;
    this.oz[i] -= vz * dt;
  }

  velX(i, dt = 1 / 60) { return (this.px[i] - this.ox[i]) / dt; }
  velY(i, dt = 1 / 60) { return (this.py[i] - this.oy[i]) / dt; }
  velZ(i, dt = 1 / 60) { return (this.pz[i] - this.oz[i]) / dt; }

  teleport(i, x, y, z) {
    this.px[i] = this.ox[i] = x;
    this.py[i] = this.oy[i] = y;
    this.pz[i] = this.oz[i] = z;
  }

  step(dt) {
    const { px, py, pz, ox, oy, oz, tx, ty, tz, tk, inv, flags, buoy, submerge } = this;
    const sim = this.sim;
    const g = this.gravity * dt * dt;
    const n = this.pHigh;
    // integrate + pose targets + water forces
    for (let i = 0; i < n; i++) {
      const fl = flags[i];
      if (!(fl & PF.ACTIVE)) continue;
      if (inv[i] === 0) continue;
      let vx = (px[i] - ox[i]) * 0.995;
      let vy = (py[i] - oy[i]) * 0.995;
      let vz = (pz[i] - oz[i]) * 0.995;
      // water: buoyancy + drag toward the current
      const sub = submerge[i];
      if (sub > 0) {
        const k = sim.cellIndex(px[i], pz[i]);
        if (k >= 0) {
          const wvx = sim.vx[k] * dt, wvz = sim.vz[k] * dt;
          const drag = 0.06 * sub;
          vx += (wvx - vx) * drag;
          vz += (wvz - vz) * drag;
          vy *= 1 - 0.08 * sub;
          vy -= g * buoy[i] * sub;
        }
      }
      ox[i] = px[i]; oy[i] = py[i]; oz[i] = pz[i];
      px[i] += vx; py[i] += vy + g; pz[i] += vz;
      const k = tk[i];
      if (k > 0) {
        px[i] += (tx[i] - px[i]) * k;
        py[i] += (ty[i] - py[i]) * k;
        pz[i] += (tz[i] - pz[i]) * k;
      }
    }
    for (let it = 0; it < this.iterations; it++) {
      this._solveConstraints();
      if (it === 1) this._bodyCollisions();
    }
    this._collide(dt);
  }

  _solveConstraints() {
    const { px, py, pz, inv, ca, cb, crest, cstiff, cactive, cmin } = this;
    const m = this.cHigh;
    for (let c = 0; c < m; c++) {
      if (!cactive[c]) continue;
      const a = ca[c], b = cb[c];
      const dx = px[b] - px[a], dy = py[b] - py[a], dz = pz[b] - pz[a];
      const d2 = dx * dx + dy * dy + dz * dz;
      const r = crest[c];
      if (cmin[c] && d2 >= r * r) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const wa = inv[a], wb = inv[b];
      const w = wa + wb;
      if (w === 0) continue;
      const diff = ((d - r) / d) * cstiff[c] / w;
      px[a] += dx * diff * wa; py[a] += dy * diff * wa; pz[a] += dz * diff * wa;
      px[b] -= dx * diff * wb; py[b] -= dy * diff * wb; pz[b] -= dz * diff * wb;
    }
  }

  _bodyCollisions() {
    const { px, py, pz, rad, inv, flags, body } = this;
    const hash = this.hash;
    hash.clear();
    const n = this.pHigh;
    const CS = 0.6;
    for (let i = 0; i < n; i++) {
      if ((flags[i] & (PF.ACTIVE | PF.COLLIDE)) !== (PF.ACTIVE | PF.COLLIDE)) continue;
      const key = ((Math.floor(px[i] / CS) + 512) << 10) | (Math.floor(pz[i] / CS) + 512);
      let list = hash.get(key);
      if (!list) { list = []; hash.set(key, list); }
      list.push(i);
    }
    for (let i = 0; i < n; i++) {
      if ((flags[i] & (PF.ACTIVE | PF.COLLIDE)) !== (PF.ACTIVE | PF.COLLIDE)) continue;
      const cx = Math.floor(px[i] / CS) + 512, cz = Math.floor(pz[i] / CS) + 512;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gz = cz - 1; gz <= cz + 1; gz++) {
          const list = hash.get((gx << 10) | gz);
          if (!list) continue;
          for (let q = 0; q < list.length; q++) {
            const j = list[q];
            if (j <= i || body[j] === body[i]) continue;
            const dx = px[j] - px[i], dy = py[j] - py[i], dz = pz[j] - pz[i];
            const rr = rad[i] + rad[j];
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= rr * rr || d2 < 1e-10) continue;
            const d = Math.sqrt(d2);
            const w = inv[i] + inv[j];
            if (w === 0) continue;
            const push = ((rr - d) / d) * 0.5 / w;
            px[i] -= dx * push * inv[i]; py[i] -= dy * push * inv[i]; pz[i] -= dz * push * inv[i];
            px[j] += dx * push * inv[j]; py[j] += dy * push * inv[j]; pz[j] += dz * push * inv[j];
          }
        }
      }
    }
  }

  _collide(dt) {
    const { px, py, pz, ox, oy, oz, rad, flags, fric, submerge, inv } = this;
    const sim = this.sim;
    const n = this.pHigh;
    const cols = this.colliders, boxes = this.boxes;
    for (let i = 0; i < n; i++) {
      let fl = flags[i];
      if (!(fl & PF.ACTIVE) || inv[i] === 0) continue;
      const r = rad[i];
      const ghost = fl & PF.GHOST;
      // static circles (rocks, palms, round buildings)
      for (let c = 0; c < (ghost ? 0 : cols.length); c++) {
        const C = cols[c];
        const dx = px[i] - C.x, dz = pz[i] - C.z;
        const rr = C.r + r;
        if (dx * dx + dz * dz >= rr * rr) continue;
        if (py[i] > C.top + r) continue;
        const d = Math.sqrt(dx * dx + dz * dz) || 1e-4;
        // land on top if we're near the top surface
        if (py[i] > C.top - 0.25 && C.walkTop) { py[i] = C.top + r; oy[i] = py[i] + (oy[i] - py[i]) * 0.2; continue; }
        px[i] = C.x + (dx / d) * rr;
        pz[i] = C.z + (dz / d) * rr;
      }
      for (let b = 0; b < (ghost ? 0 : boxes.length); b++) {
        const B = boxes[b];
        const dx = px[i] - B.x, dz = pz[i] - B.z;
        const lx = dx * B.c + dz * B.s, lz = -dx * B.s + dz * B.c;
        const ex = B.hx + r, ez = B.hz + r;
        if (lx <= -ex || lx >= ex || lz <= -ez || lz >= ez) continue;
        if (py[i] > B.top + r) continue;
        if (py[i] > B.top - 0.25 && B.walkTop) { py[i] = B.top + r; continue; }
        // push out along the shallowest axis
        const pxp = ex - Math.abs(lx), pzp = ez - Math.abs(lz);
        let nlx = lx, nlz = lz;
        if (pxp < pzp) nlx = Math.sign(lx || 1) * ex; else nlz = Math.sign(lz || 1) * ez;
        px[i] = B.x + nlx * B.c - nlz * B.s;
        pz[i] = B.z + nlx * B.s + nlz * B.c;
      }
      // terrain
      const gh = sim.heightAt(px[i], pz[i]);
      const floor = gh + r;
      fl &= ~(PF.GROUND | PF.WATER);
      if (py[i] < floor) {
        const vy = (py[i] - oy[i]) / dt;
        if (vy < -2.5 && this.onImpact) this.onImpact(i, -vy);
        this.impact[i] = -vy;
        py[i] = floor;
        if (oy[i] < floor - 0.5) oy[i] = floor; // dug out from under: don't launch
        const f = fric[i];
        ox[i] += (px[i] - ox[i]) * f;
        oz[i] += (pz[i] - oz[i]) * f;
        oy[i] = py[i]; // no bounce: sand absorbs the impact
        fl |= PF.GROUND;
      }
      // water
      const k = sim.cellIndex(px[i], pz[i]);
      let sub = 0;
      if (k >= 0) {
        const d = sim.d[k];
        if (d > 0.02) {
          const surf = sim.h[k] + d;
          sub = clamp((surf - (py[i] - r)) / (2 * r + 0.05));
          if (sub > 0) fl |= PF.WATER;
        }
      }
      submerge[i] = sub;
      flags[i] = fl;
    }
  }
}
