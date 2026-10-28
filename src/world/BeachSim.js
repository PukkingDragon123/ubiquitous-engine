// Coupled sand + shallow-water simulation on a regular heightfield grid.
//
//  * Water: "virtual pipes" shallow water model (flux based) with friction,
//    infiltration into dry sand, a sponge band that injects ocean swell and
//    absorbs reflections, and a tide (sea level) controlled by the game.
//  * Sand: angle-of-repose slumping that depends on moisture (dry sand slides,
//    damp sand holds steep walls, saturated sand slumps), hydraulic erosion /
//    deposition with suspended sediment advected by the flow, and a slow
//    swash-zone relaxation toward the natural beach profile.
//  * Moisture: water soaks into sand, groundwater keeps the low beach damp,
//    exposed sand dries in the sun, digging reveals wet sand underneath.

import * as THREE from 'three';
import { GRID_W, GRID_H, CELL, X0, Z0, SEA_LEVEL, baseHeight } from './config.js';
import { clamp } from '../core/math.js';

const G = 9.81;
const TILE = 16;

export class BeachSim {
  constructor() {
    const W = GRID_W, H = GRID_H, N = W * H;
    this.W = W; this.H = H; this.N = N; this.cs = CELL;

    this.h = new Float32Array(N);
    this.h0 = new Float32Array(N);
    this.bed = new Float32Array(N);
    this.wet = new Float32Array(N);
    this.obst = new Float32Array(N);
    this.d = new Float32Array(N);
    this.fxp = new Float32Array(N);
    this.fxn = new Float32Array(N);
    this.fzp = new Float32Array(N);
    this.fzn = new Float32Array(N);
    this.vx = new Float32Array(N);
    this.vz = new Float32Array(N);
    this.sed = new Float32Array(N);
    this.tmp = new Float32Array(N);
    this.foam = new Float32Array(N);
    this.rise = new Float32Array(N); // smoothed rate of depth change (wave fronts)
    this.sponge = new Float32Array(N);
    this.dh = new Float32Array(N); // slump deltas
    this.disturb = new Float32Array(N); // recently disturbed sand (for shading)

    this.TW = Math.ceil(W / TILE);
    this.TH = Math.ceil(H / TILE);
    this.tileActive = new Uint8Array(this.TW * this.TH);

    this.seaLevel = SEA_LEVEL;
    this.targetSeaLevel = SEA_LEVEL;
    this.time = 0;
    this.waveScale = 1;
    this.targetWaveScale = 1;
    this.pulses = [];
    this.waves = [
      { A: 0.17, L: 38, ang: 0.0, ph: 0.0 },
      { A: 0.1, L: 25, ang: 0.22, ph: 1.7 },
      { A: 0.06, L: 15, ang: -0.32, ph: 4.1 },
      { A: 0.03, L: 9.5, ang: 0.5, ph: 2.3 },
    ];
    for (const w of this.waves) {
      w.k = (Math.PI * 2) / w.L;
      w.dx = Math.sin(w.ang);
      w.dz = Math.cos(w.ang);
      w.c = Math.sqrt(G * 3.6);
      w.om = w.k * w.c;
    }

    this.accWater = 0;
    this.accSlump = 0;
    this.accErode = 0;
    this.accWet = 0;
    this.listeners = { slump: [] };
    this.stats = { waterMs: 0, sandMs: 0 };

    this._init();

    // GPU textures (A: h, wet, depth, foam | B: vx, vz, sediment, disturbance)
    this.dataA = new Float32Array(N * 4);
    this.dataB = new Float32Array(N * 4);
    this.texA = new THREE.DataTexture(this.dataA, W, H, THREE.RGBAFormat, THREE.FloatType);
    this.texB = new THREE.DataTexture(this.dataB, W, H, THREE.RGBAFormat, THREE.FloatType);
    for (const t of [this.texA, this.texB]) {
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
    }
    this.syncTextures();
  }

  _init() {
    const { W, H, h, h0, bed, wet, d, sponge } = this;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        const x = X0 + i * CELL, z = Z0 + j * CELL;
        const b = baseHeight(x, z);
        h[k] = b; h0[k] = b;
        bed[k] = b - 2.6;
        const gw = clamp(1 - (b - this.seaLevel - 0.15) / 1.1);
        wet[k] = gw * 0.85;
        d[k] = Math.max(0, this.seaLevel - b);
        // sponge band: seaward edges only
        const dEdgeZ = j;
        const dEdgeX = Math.min(i, W - 1 - i);
        const seaward = z < -2 ? 1 : 0;
        let s = 0;
        const band = 12;
        if (dEdgeZ < band) s = Math.max(s, 1 - dEdgeZ / band);
        if (dEdgeX < band && seaward) s = Math.max(s, (1 - dEdgeX / band) * clamp((-2 - z) / 8));
        sponge[k] = s * s;
      }
    }
    // Precomputed spatial phases for sponge cells: sin(a - wt) = sin a cos wt - cos a sin wt
    const idx = [];
    for (let k = 0; k < this.N; k++) if (sponge[k] > 0) idx.push(k);
    const n = idx.length;
    this.spongeIdx = Int32Array.from(idx);
    this.spongeSin = this.waves.map(() => new Float32Array(n));
    this.spongeCos = this.waves.map(() => new Float32Array(n));
    for (let m = 0; m < n; m++) {
      const k = idx[m];
      const x = X0 + (k % W) * CELL, z = Z0 + Math.floor(k / W) * CELL;
      this.waves.forEach((w, wi) => {
        const a = w.k * (w.dx * x + w.dz * z) + w.ph;
        this.spongeSin[wi][m] = Math.sin(a);
        this.spongeCos[wi][m] = Math.cos(a);
      });
    }
  }

  // Relax sponge cells toward the prescribed swell + tide (fast path).
  _applySponge(dt) {
    const { spongeIdx, spongeSin, spongeCos, sponge, d, h, obst, waves } = this;
    const t = this.time;
    const env = (0.75 + 0.25 * Math.sin(t * 0.11) * Math.sin(t * 0.047 + 1.0)) * this.waveScale;
    const nw = waves.length;
    const ampC = new Float32Array(nw), ampS = new Float32Array(nw);
    for (let i = 0; i < nw; i++) {
      const w = waves[i];
      ampC[i] = w.A * env * Math.cos(w.om * t);
      ampS[i] = w.A * env * Math.sin(w.om * t);
    }
    const sea = this.seaLevel;
    const hasPulses = this.pulses.length > 0;
    const n = spongeIdx.length;
    const W = this.W, cs = this.cs;
    for (let m = 0; m < n; m++) {
      const k = spongeIdx[m];
      let eta = sea;
      for (let i = 0; i < nw; i++) eta += spongeSin[i][m] * ampC[i] - spongeCos[i][m] * ampS[i];
      if (hasPulses) {
        const x = X0 + (k % W) * cs, z = Z0 + ((k / W) | 0) * cs;
        for (let q = 0; q < this.pulses.length; q++) {
          const p = this.pulses[q];
          const u = (z * p.dz + x * p.dx - (p.s0 + p.c * (t - p.t0))) / p.width;
          if (u > -4 && u < 4) eta += p.A * Math.exp(-u * u);
        }
      }
      let target = eta - h[k] - obst[k];
      if (target < 0) target = 0;
      const dk = d[k];
      d[k] = dk + (target - dk) * Math.min(1, sponge[k] * dt * 6);
    }
  }

  // ---- ocean forcing --------------------------------------------------------
  oceanSurface(x, z, t) {
    let eta = this.seaLevel;
    const ws = this.waveScale;
    // groupiness: waves come in sets
    const env = 0.75 + 0.25 * Math.sin(t * 0.11) * Math.sin(t * 0.047 + 1.0);
    for (let n = 0; n < this.waves.length; n++) {
      const w = this.waves[n];
      eta += w.A * ws * env * Math.sin(w.k * (w.dx * x + w.dz * z) - w.om * t + w.ph);
    }
    for (let n = 0; n < this.pulses.length; n++) {
      const p = this.pulses[n];
      const s = z * p.dz + x * p.dx;
      const front = p.s0 + p.c * (t - p.t0);
      const u = (s - front) / p.width;
      if (u > -4 && u < 4) eta += p.A * Math.exp(-u * u);
    }
    return eta;
  }

  // Launch one big swell toward the shore (used for attack waves).
  addPulse(A = 0.8, width = 5, ang = 0) {
    this.pulses.push({
      A, width,
      dx: Math.sin(ang), dz: Math.cos(ang),
      s0: Z0 - width * 3,
      c: Math.sqrt(G * 3.8),
      t0: this.time,
    });
  }

  // ---- main update ------------------------------------------------------------
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.seaLevel += (this.targetSeaLevel - this.seaLevel) * (1 - Math.exp(-dt * 0.35));
    this.waveScale += (this.targetWaveScale - this.waveScale) * (1 - Math.exp(-dt * 0.5));
    // retire old pulses
    if (this.pulses.length) {
      this.pulses = this.pulses.filter((p) => this.time - p.t0 < 30);
    }

    const t0 = performance.now();
    const WSTEP = 1 / 60;
    this.accWater += dt;
    let steps = 0;
    while (this.accWater >= WSTEP && steps < 3) {
      this.stepWater(WSTEP);
      this.accWater -= WSTEP;
      steps++;
    }
    if (steps === 3) this.accWater = 0;
    const t1 = performance.now();

    this.accErode += dt;
    if (this.accErode >= 1 / 30) {
      this.stepErosion(this.accErode);
      this.accErode = 0;
    }
    this.accSlump += dt;
    if (this.accSlump >= 1 / 24) {
      this.stepSlump(this.accSlump);
      this.accSlump = 0;
    }
    this.accWet += dt;
    if (this.accWet >= 0.1) {
      this.stepWetness(this.accWet);
      this.accWet = 0;
    }
    const t2 = performance.now();
    this.stats.waterMs = this.stats.waterMs * 0.95 + (t1 - t0) * 0.05;
    this.stats.sandMs = this.stats.sandMs * 0.95 + (t2 - t1) * 0.05;
  }

  stepWater(dt) {
    const { W, H, h, d, obst, fxp, fxn, fzp, fzn, vx, vz, foam, rise } = this;
    const cs = this.cs, area = cs * cs;
    const A = dt * G * cs;
    const sea = this.seaLevel;

    // 1) outflow fluxes
    for (let j = 0; j < H; j++) {
      const row = j * W;
      for (let i = 0; i < W; i++) {
        const k = row + i;
        const dk = d[k];
        if (dk <= 0) {
          fxp[k] = fxn[k] = fzp[k] = fzn[k] = 0;
          continue;
        }
        const Hk = h[k] + obst[k] + dk;
        // friction: stronger in shallow water so swash stops naturally
        const damp = 1 / (1 + dt * (0.12 + 0.05 / (dk + 0.02)));
        let o1 = 0, o2 = 0, o3 = 0, o4 = 0;
        if (i < W - 1) { const n = k + 1; o1 = fxp[k] * damp + A * (Hk - (h[n] + obst[n] + d[n])); if (o1 < 0) o1 = 0; }
        if (i > 0) { const n = k - 1; o2 = fxn[k] * damp + A * (Hk - (h[n] + obst[n] + d[n])); if (o2 < 0) o2 = 0; }
        if (j < H - 1) { const n = k + W; o3 = fzp[k] * damp + A * (Hk - (h[n] + obst[n] + d[n])); if (o3 < 0) o3 = 0; }
        if (j > 0) { const n = k - W; o4 = fzn[k] * damp + A * (Hk - (h[n] + obst[n] + d[n])); if (o4 < 0) o4 = 0; }
        const sum = o1 + o2 + o3 + o4;
        if (sum > 0) {
          const K = Math.min(1, (dk * area) / (sum * dt));
          o1 *= K; o2 *= K; o3 *= K; o4 *= K;
        }
        fxp[k] = o1; fxn[k] = o2; fzp[k] = o3; fzn[k] = o4;
      }
    }

    // 2) depth + velocity update
    for (let j = 0; j < H; j++) {
      const row = j * W;
      for (let i = 0; i < W; i++) {
        const k = row + i;
        const inL = i > 0 ? fxp[k - 1] : 0;
        const inR = i < W - 1 ? fxn[k + 1] : 0;
        const inD = j > 0 ? fzp[k - W] : 0;
        const inU = j < H - 1 ? fzn[k + W] : 0;
        const out = fxp[k] + fxn[k] + fzp[k] + fzn[k];
        const dOld = d[k];
        let dNew = dOld + (dt * (inL + inR + inD + inU - out)) / area;
        if (dNew < 0) dNew = 0;

        // infiltration of thin films into dry sand above the water table
        if (dNew > 0 && dNew < 0.06 && h[k] > sea) {
          const absorb = Math.min(dNew, dt * 0.03 * (1.15 - this.wet[k]));
          dNew -= absorb;
          this.wet[k] = Math.min(1, this.wet[k] + absorb * 25);
        }
        if (dNew < 0.0006) dNew = 0;

        const dAvg = 0.5 * (dOld + dNew);
        if (dAvg > 0.004) {
          const qx = 0.5 * (inL - fxn[k] + fxp[k] - inR);
          const qz = 0.5 * (inD - fzn[k] + fzp[k] - inU);
          // regularised depth keeps thin swash films from producing huge speeds
          const dr = dAvg > 0.06 ? dAvg : 0.06;
          let ux = qx / (cs * dr), uz = qz / (cs * dr);
          const sp = Math.sqrt(ux * ux + uz * uz);
          if (sp > 8) { ux *= 8 / sp; uz *= 8 / sp; }
          vx[k] = ux; vz[k] = uz;
        } else {
          vx[k] = 0; vz[k] = 0;
        }
        // wave-front detector and foam generation
        const r = (dNew - dOld) / dt;
        rise[k] = rise[k] * 0.9 + r * 0.1;
        if (dNew > 0) {
          const sp2 = vx[k] * vx[k] + vz[k] * vz[k];
          let gen = 0;
          if (dNew < 1.4) {
            const shallow = 1 - dNew / 1.4;
            gen += Math.max(0, rise[k] - 0.12) * 1.6 * shallow;
            gen += Math.max(0, sp2 - 1.2) * 0.12 * shallow;
          }
          let f = foam[k] + gen * dt * 3;
          f *= 1 - dt * 0.3;
          foam[k] = f > 1 ? 1 : f;
        } else {
          foam[k] *= 1 - dt * 2;
        }
        d[k] = dNew;
      }
    }
    this._applySponge(dt);
  }

  // Hydraulic erosion / deposition + sediment & foam advection.
  stepErosion(dt) {
    const { W, H, h, h0, bed, d, vx, vz, sed, tmp, foam } = this;
    const cs = this.cs;
    for (let j = 2; j < H - 2; j++) {
      const row = j * W;
      for (let i = 2; i < W - 2; i++) {
        const k = row + i;
        const dk = d[k];
        if (dk <= 0.002) {
          if (sed[k] > 0) { h[k] += sed[k]; sed[k] = 0; }
          continue;
        }
        const sp = Math.sqrt(vx[k] * vx[k] + vz[k] * vz[k]);
        const ex = sp - 0.55;
        const cap = ex > 0 ? 0.035 * ex * ex * Math.min(dk, 1.2) : 0;
        const s = sed[k];
        if (s < cap) {
          let e = (cap - s) * Math.min(1, dt * 1.6);
          const avail = h[k] - bed[k];
          if (e > avail) e = Math.max(0, avail);
          h[k] -= e; sed[k] = s + e;
        } else {
          const dep = (s - cap) * Math.min(1, dt * 2.2);
          h[k] += dep; sed[k] = s - dep;
        }
        // swash-zone relaxation toward the natural profile (beaches heal)
        h[k] += (h0[k] - h[k]) * Math.min(1, dt * 0.012 * Math.min(1, dk * 4));
        if (sp > 0.9) this._activateCell(i, j);
      }
    }
    // semi-Lagrangian advection of sediment and foam
    this._advect(sed, tmp, dt);
    this._advect(foam, tmp, dt);
  }

  _advect(field, tmp, dt) {
    const { W, H, d, vx, vz } = this;
    const inv = dt / this.cs;
    tmp.set(field);
    for (let j = 1; j < H - 1; j++) {
      const row = j * W;
      for (let i = 1; i < W - 1; i++) {
        const k = row + i;
        if (d[k] <= 0.002) continue;
        let fx = i - vx[k] * inv, fz = j - vz[k] * inv;
        if (fx < 0) fx = 0; else if (fx > W - 1.001) fx = W - 1.001;
        if (fz < 0) fz = 0; else if (fz > H - 1.001) fz = H - 1.001;
        const x0 = fx | 0, z0 = fz | 0, tx = fx - x0, tz = fz - z0;
        const k0 = z0 * W + x0;
        tmp[k] =
          (field[k0] * (1 - tx) + field[k0 + 1] * tx) * (1 - tz) +
          (field[k0 + W] * (1 - tx) + field[k0 + W + 1] * tx) * tz;
      }
    }
    field.set(tmp);
  }

  // Angle-of-repose slumping over active tiles.
  stepSlump(dt) {
    const { W, H, h, bed, wet, d, dh, TW, TH, tileActive } = this;
    const cs = this.cs;
    const rate = Math.min(1, dt * 14);
    const touched = this._touched || (this._touched = new Int32Array(W * H));
    let nT = 0;
    let total = 0;
    for (let ty = 0; ty < TH; ty++) {
      for (let tx = 0; tx < TW; tx++) {
        const ti = ty * TW + tx;
        if (!tileActive[ti]) continue;
        let moved = 0;
        const iA = Math.max(1, tx * TILE), iB = Math.min(W - 1, tx * TILE + TILE);
        const jA = Math.max(1, ty * TILE), jB = Math.min(H - 1, ty * TILE + TILE);
        for (let j = jA; j < jB; j++) {
          if (j >= H - 1) break;
          for (let i = iA; i < iB; i++) {
            if (i >= W - 1) break;
            const k = j * W + i;
            const hk = h[k];
            const tan = reposeTan(wet[k], d[k]);
            const maxd = tan * cs;
            let e1 = hk - h[k + 1] - maxd;
            let e2 = hk - h[k - 1] - maxd;
            let e3 = hk - h[k + W] - maxd;
            let e4 = hk - h[k - W] - maxd;
            if (e1 < 0) e1 = 0;
            if (e2 < 0) e2 = 0;
            if (e3 < 0) e3 = 0;
            if (e4 < 0) e4 = 0;
            const sum = e1 + e2 + e3 + e4;
            if (sum <= 1e-4) continue;
            let amt = sum * 0.22 * rate;
            const avail = hk - bed[k];
            if (amt > avail) amt = avail;
            if (amt <= 0) continue;
            const inv = amt / sum;
            if (dh[k] === 0) touched[nT++] = k;
            dh[k] -= amt;
            if (e1 > 0) { const n = k + 1; if (dh[n] === 0) touched[nT++] = n; dh[n] += e1 * inv; }
            if (e2 > 0) { const n = k - 1; if (dh[n] === 0) touched[nT++] = n; dh[n] += e2 * inv; }
            if (e3 > 0) { const n = k + W; if (dh[n] === 0) touched[nT++] = n; dh[n] += e3 * inv; }
            if (e4 > 0) { const n = k - W; if (dh[n] === 0) touched[nT++] = n; dh[n] += e4 * inv; }
            moved += amt;
          }
        }
        if (moved < 0.002) tileActive[ti] = Math.max(0, tileActive[ti] - 1);
        else {
          tileActive[ti] = Math.max(tileActive[ti], 6);
          total += moved;
        }
      }
    }
    // apply
    const disturb = this.disturb;
    for (let n = 0; n < nT; n++) {
      const k = touched[n];
      const v = dh[k];
      if (v !== 0) {
        h[k] += v;
        if (v > 0.004) disturb[k] = Math.min(1, disturb[k] + v * 6);
        dh[k] = 0;
        // spill activation to neighbouring tiles
        const i = k % W, j = (k / W) | 0;
        this._activateCell(i, j, 3);
      } else {
        dh[k] = 0;
      }
    }
    if (total > 0.05) for (const fn of this.listeners.slump) fn(total);
  }

  stepWetness(dt) {
    const { W, H, h, d, wet, disturb } = this;
    const sea = this.seaLevel;
    const dry = dt / 55;
    for (let j = 1; j < H - 1; j++) {
      const row = j * W;
      for (let i = 1; i < W - 1; i++) {
        const k = row + i;
        let w = wet[k];
        if (d[k] > 0.015) {
          w += (1 - w) * Math.min(1, dt * 3);
        } else {
          const gw = clamp(1 - (h[k] - sea - 0.12) / 1.0) * 0.82;
          if (w > gw) w = Math.max(gw, w - dry * (0.4 + w));
          else w += (gw - w) * Math.min(1, dt * 0.08);
          // capillary spreading
          const avg = (wet[k - 1] + wet[k + 1] + wet[k - W] + wet[k + W]) * 0.25;
          if (avg > w) w += (avg - w) * dt * 0.25;
        }
        wet[k] = w;
        disturb[k] *= 1 - dt * 0.05;
      }
    }
  }

  _activateCell(i, j, v = 6) {
    const tx = (i / TILE) | 0, ty = (j / TILE) | 0;
    const ti = ty * this.TW + tx;
    if (this.tileActive[ti] < v) this.tileActive[ti] = v;
    // neighbours when near a tile border
    const li = i - tx * TILE, lj = j - ty * TILE;
    if (li <= 1 && tx > 0) this.tileActive[ti - 1] = Math.max(this.tileActive[ti - 1], v);
    if (li >= TILE - 2 && tx < this.TW - 1) this.tileActive[ti + 1] = Math.max(this.tileActive[ti + 1], v);
    if (lj <= 1 && ty > 0) this.tileActive[ti - this.TW] = Math.max(this.tileActive[ti - this.TW], v);
    if (lj >= TILE - 2 && ty < this.TH - 1) this.tileActive[ti + this.TW] = Math.max(this.tileActive[ti + this.TW], v);
  }

  activateArea(x, z, r) {
    const i0 = Math.max(0, Math.floor((x - r - X0) / CELL)), i1 = Math.min(this.W - 1, Math.ceil((x + r - X0) / CELL));
    const j0 = Math.max(0, Math.floor((z - r - Z0) / CELL)), j1 = Math.min(this.H - 1, Math.ceil((z + r - Z0) / CELL));
    for (let j = j0; j <= j1; j += 4) for (let i = i0; i <= i1; i += 4) this._activateCell(i, j, 8);
    this._activateCell(i1, j1, 8);
  }

  // ---- sand editing -----------------------------------------------------------
  // Remove sand in a soft circle. Returns { vol, wet } (volume in world units^3).
  dig(x, z, radius, depth) {
    const { W, H, h, h0, bed, wet, disturb } = this;
    const cs = this.cs;
    const i0 = Math.max(2, Math.floor((x - radius - X0) / cs)), i1 = Math.min(W - 3, Math.ceil((x + radius - X0) / cs));
    const j0 = Math.max(2, Math.floor((z - radius - Z0) / cs)), j1 = Math.min(H - 3, Math.ceil((z + radius - Z0) / cs));
    let vol = 0, wsum = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = X0 + i * cs - x, dz = Z0 + j * cs - z;
        const r2 = (dx * dx + dz * dz) / (radius * radius);
        if (r2 >= 1) continue;
        const f = (1 - r2) * (1 - r2);
        const k = j * W + i;
        let a = depth * f;
        const avail = h[k] - bed[k];
        if (a > avail) a = Math.max(0, avail);
        if (a <= 0) continue;
        h[k] -= a;
        vol += a * cs * cs;
        wsum += wet[k] * a;
        // freshly exposed sand below the surface is damp
        const exposed = clamp((h0[k] - h[k]) / 0.7) * 0.8;
        if (exposed > wet[k]) wet[k] = exposed;
        disturb[k] = Math.min(1, disturb[k] + f * 0.8);
      }
    }
    this.activateArea(x, z, radius + 1);
    return { vol, wet: vol > 0 ? wsum * cs * cs / vol : 0 };
  }

  // Add a volume of sand spread over a soft circle.
  deposit(x, z, radius, vol, wetness = -1) {
    if (vol <= 0) return;
    const { W, H, h, wet, disturb } = this;
    const cs = this.cs;
    const i0 = Math.max(2, Math.floor((x - radius - X0) / cs)), i1 = Math.min(W - 3, Math.ceil((x + radius - X0) / cs));
    const j0 = Math.max(2, Math.floor((z - radius - Z0) / cs)), j1 = Math.min(H - 3, Math.ceil((z + radius - Z0) / cs));
    let wsum = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dx = X0 + i * cs - x, dz = Z0 + j * cs - z;
          const r2 = (dx * dx + dz * dz) / (radius * radius);
          if (r2 >= 1) continue;
          const f = (1 - r2) * (1 - r2);
          if (pass === 0) { wsum += f; continue; }
          const k = j * W + i;
          const add = (vol * f) / wsum / (cs * cs);
          h[k] += add;
          if (wetness >= 0) wet[k] = wet[k] + (wetness - wet[k]) * Math.min(1, f);
          disturb[k] = Math.min(1, disturb[k] + f * 0.6);
        }
      }
      if (wsum <= 0) {
        // radius smaller than a cell: drop into nearest node
        const i = Math.round((x - X0) / cs), j = Math.round((z - Z0) / cs);
        if (i > 1 && j > 1 && i < W - 2 && j < H - 2) h[j * W + i] += vol / (cs * cs);
        break;
      }
    }
    this.activateArea(x, z, radius + 1);
  }

  // Splat a small volume of sand into the 4 nearest nodes (particles landing).
  addSandAt(x, z, vol) {
    const cs = this.cs, W = this.W;
    let fx = (x - X0) / cs, fz = (z - Z0) / cs;
    if (fx < 2 || fz < 2 || fx > W - 3 || fz > this.H - 3) return;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const k = j * W + i;
    const a = vol / (cs * cs);
    this.h[k] += a * (1 - tx) * (1 - tz);
    this.h[k + 1] += a * tx * (1 - tz);
    this.h[k + W] += a * (1 - tx) * tz;
    this.h[k + W + 1] += a * tx * tz;
    this.disturb[k] = Math.min(1, this.disturb[k] + a * 4);
    this._activateCell(i, j, 6);
  }

  // Flatten toward the local average (rake / smoothing tool).
  smooth(x, z, radius, strength) {
    const { W, H, h, tmp } = this;
    const cs = this.cs;
    const i0 = Math.max(3, Math.floor((x - radius - X0) / cs)), i1 = Math.min(W - 4, Math.ceil((x + radius - X0) / cs));
    const j0 = Math.max(3, Math.floor((z - radius - Z0) / cs)), j1 = Math.min(H - 4, Math.ceil((z + radius - Z0) / cs));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * W + i;
      tmp[k] = (h[k - 1] + h[k + 1] + h[k - W] + h[k + W] + h[k] * 2) / 6;
    }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = X0 + i * cs - x, dz = Z0 + j * cs - z;
      const r2 = (dx * dx + dz * dz) / (radius * radius);
      if (r2 >= 1) continue;
      const k = j * W + i;
      h[k] += (tmp[k] - h[k]) * strength * (1 - r2);
    }
    this.activateArea(x, z, radius + 1);
  }

  // ---- queries --------------------------------------------------------------
  _sample(arr, x, z) {
    let fx = (x - X0) / CELL, fz = (z - Z0) / CELL;
    if (fx < 0) fx = 0; else if (fx > this.W - 1.001) fx = this.W - 1.001;
    if (fz < 0) fz = 0; else if (fz > this.H - 1.001) fz = this.H - 1.001;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const k = j * this.W + i;
    return (arr[k] * (1 - tx) + arr[k + 1] * tx) * (1 - tz) + (arr[k + this.W] * (1 - tx) + arr[k + this.W + 1] * tx) * tz;
  }
  heightAt(x, z) {
    if (x < X0 || z < Z0 || x > -X0 || z > -Z0) return baseHeight(x, z);
    return this._sample(this.h, x, z);
  }
  depthAt(x, z) { return this._sample(this.d, x, z); }
  surfaceAt(x, z) { return this.heightAt(x, z) + this.depthAt(x, z); }
  wetAt(x, z) { return this._sample(this.wet, x, z); }
  foamAt(x, z) { return this._sample(this.foam, x, z); }
  velAt(x, z, out) {
    out.x = this._sample(this.vx, x, z);
    out.z = this._sample(this.vz, x, z);
    return out;
  }
  normalAt(x, z, out) {
    const e = CELL;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    out.set(hl - hr, 2 * e, hd - hu).normalize();
    return out;
  }
  slopeAt(x, z) {
    const e = CELL;
    const gx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const gz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.sqrt(gx * gx + gz * gz);
  }
  cellIndex(x, z) {
    const i = Math.round((x - X0) / CELL), j = Math.round((z - Z0) / CELL);
    if (i < 0 || j < 0 || i >= this.W || j >= this.H) return -1;
    return j * this.W + i;
  }

  // Ray vs heightfield (optionally against the water surface).
  raycast(origin, dir, maxDist = 600, hitWater = false, out = new THREE.Vector3()) {
    const f = (p) => (hitWater ? this.surfaceAt(p.x, p.z) : this.heightAt(p.x, p.z));
    const p = new THREE.Vector3();
    let tPrev = 0;
    let step = 0.25;
    for (let t = 0; t < maxDist; t += step) {
      p.copy(origin).addScaledVector(dir, t);
      if (p.y < f(p)) {
        // bisection refine
        let a = tPrev, b = t;
        for (let n = 0; n < 12; n++) {
          const m = (a + b) * 0.5;
          p.copy(origin).addScaledVector(dir, m);
          if (p.y < f(p)) b = m; else a = m;
        }
        return out.copy(origin).addScaledVector(dir, b);
      }
      tPrev = t;
      // adaptive step: bigger steps when far above the ground
      const above = p.y - f(p);
      step = Math.max(0.12, Math.min(4, above * 0.5));
    }
    return null;
  }

  // Volume-weighted average water depth / speed in a rectangle (for buildings).
  sampleWaterAround(x, z, r) {
    const { W, d, vx, vz } = this;
    const i0 = Math.max(0, Math.floor((x - r - X0) / CELL)), i1 = Math.min(W - 1, Math.ceil((x + r - X0) / CELL));
    const j0 = Math.max(0, Math.floor((z - r - Z0) / CELL)), j1 = Math.min(this.H - 1, Math.ceil((z + r - Z0) / CELL));
    let maxD = 0, maxS = 0, sumD = 0, n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * W + i;
      const dk = d[k];
      if (dk > maxD) maxD = dk;
      const s = Math.sqrt(vx[k] * vx[k] + vz[k] * vz[k]);
      if (dk > 0.02 && s > maxS) maxS = s;
      sumD += dk; n++;
    }
    return { maxD, maxS, avgD: n ? sumD / n : 0 };
  }

  syncTextures() {
    const { N, h, wet, d, foam, vx, vz, sed, dataA, dataB, disturb } = this;
    for (let k = 0, o = 0; k < N; k++, o += 4) {
      dataA[o] = h[k];
      dataA[o + 1] = wet[k];
      dataA[o + 2] = d[k];
      dataA[o + 3] = foam[k];
      dataB[o] = vx[k];
      dataB[o + 1] = vz[k];
      dataB[o + 2] = sed[k];
      dataB[o + 3] = disturb[k];
    }
    this.texA.needsUpdate = true;
    this.texB.needsUpdate = true;
  }
}

// Angle of repose (as tangent) for sand with moisture w and water depth wd.
export function reposeTan(w, wd) {
  if (wd > 0.04) return 0.55; // saturated, submerged sand
  // dry 34° → damp up to ~62° → saturated slumps again
  let t = 0.67 + 1.25 * smooth01((w - 0.12) / 0.45);
  t -= 0.75 * smooth01((w - 0.86) / 0.14);
  return t;
}
function smooth01(x) {
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return x * x * (3 - 2 * x);
}
