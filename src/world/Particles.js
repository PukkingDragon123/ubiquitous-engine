// Particle effects. Sand grains carry real volume and deposit it into the
// heightfield where they land, so sprays and crumbles actually build piles.
import * as THREE from 'three';
import { globalUniforms } from './shaderLib.js';
import { rnd, clamp } from '../core/math.js';

export const P = { SAND: 0, DUST: 1, SPRAY: 2, FOAM: 3, SPARK: 4, CONFETTI: 5, SMOKE: 6, SPURT: 7, EMBER: 8 };

const MAX = 9000;

class PointLayer {
  constructor(scene, max, additive) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aColor', this.colAttr);
    g.setAttribute('aSize', this.sizeAttr);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uScale: { value: 600 },
        uSunColor: globalUniforms.uSunColor,
        uSunDir: globalUniforms.uSunDir,
        uNight: globalUniforms.uNight,
      },
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute float aSize;
        uniform float uScale;
        varying vec4 vColor;
        varying float vSoft;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float s = aSize * uScale / max(-mv.z, 0.1);
          gl_PointSize = clamp(s, 1.0, 256.0);
          vSoft = aSize > 0.15 ? 1.0 : 0.0;
          vColor = aColor;
          // fade sub-pixel particles instead of popping
          vColor.a *= clamp(s * 0.8, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        varying float vSoft;
        uniform vec3 uSunColor;
        uniform float uNight;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          if (d > 0.5) discard;
          float a = vSoft > 0.5 ? smoothstep(0.5, 0.0, d) : smoothstep(0.5, 0.35, d);
          vec3 col = vColor.rgb * mix(vec3(1.0), uSunColor * 0.9 + 0.25, 0.5) * mix(1.0, 0.4, uNight);
          gl_FragColor = vec4(col, vColor.a * a);
        }`,
    });
    if (additive) {
      this.mat.fragmentShader = /* glsl */ `
        varying vec4 vColor;
        varying float vSoft;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float core = smoothstep(0.5, 0.0, d);
          float star = max(0.0, 1.0 - abs(c.x) * 14.0) * max(0.0, 1.0 - abs(c.y) * 2.2) + max(0.0, 1.0 - abs(c.y) * 14.0) * max(0.0, 1.0 - abs(c.x) * 2.2);
          gl_FragColor = vec4(vColor.rgb * (core * core + star * 0.6) * vColor.a, 1.0);
        }`;
    }
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  begin() { this.count = 0; }
  push(x, y, z, r, g, b, a, s) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.size[i] = s;
  }
  end() {
    const n = this.count;
    this.points.geometry.setDrawRange(0, n);
    this.posAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(0, n * 3);
    this.posAttr.needsUpdate = true;
    this.colAttr.clearUpdateRanges();
    this.colAttr.addUpdateRange(0, n * 4);
    this.colAttr.needsUpdate = true;
    this.sizeAttr.clearUpdateRanges();
    this.sizeAttr.addUpdateRange(0, n);
    this.sizeAttr.needsUpdate = true;
  }
}

export class Particles {
  constructor(scene, sim) {
    this.sim = sim;
    const n = MAX;
    this.n = 0;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.life = new Float32Array(n); this.maxLife = new Float32Array(n);
    this.size = new Float32Array(n); this.grow = new Float32Array(n);
    this.r = new Float32Array(n); this.g = new Float32Array(n); this.b = new Float32Array(n); this.a = new Float32Array(n);
    this.type = new Uint8Array(n);
    this.vol = new Float32Array(n);
    this.normal = new PointLayer(scene, MAX, false);
    this.add = new PointLayer(scene, 2500, true);

    // chunks: lit tumbling pebbles / clumps
    const geo = new THREE.IcosahedronGeometry(1, 0);
    this.chunkMax = 700;
    this.chunks = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), this.chunkMax);
    this.chunks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.chunkMax * 3), 3);
    this.chunks.castShadow = true;
    this.chunks.receiveShadow = true;
    this.chunks.frustumCulled = false;
    this.chunks.count = 0;
    scene.add(this.chunks);
    this.ch = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  spawn(type, x, y, z, vx, vy, vz, life, size, r, g, b, a = 1, vol = 0, grow = 0) {
    if (this.n >= MAX) return -1;
    const i = this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.grow[i] = grow;
    this.r[i] = r; this.g[i] = g; this.b[i] = b; this.a[i] = a;
    this.type[i] = type; this.vol[i] = vol;
    return i;
  }

  // ---- convenience emitters ------------------------------------------------
  sandSpray(x, y, z, dirX, dirZ, count, totalVol, wet = 0.3, power = 1) {
    const v = count > 0 ? totalVol / count : 0;
    const dark = 1 - wet * 0.45;
    for (let i = 0; i < count; i++) {
      const sp = (1.5 + Math.random() * 3) * power;
      const tone = 0.85 + Math.random() * 0.2;
      this.spawn(P.SAND, x + rnd(-0.15, 0.15), y + 0.05, z + rnd(-0.15, 0.15),
        dirX * sp + rnd(-1, 1) * power, (2 + Math.random() * 3.5) * power, dirZ * sp + rnd(-1, 1) * power,
        3, 0.05 + Math.random() * 0.06, 0.86 * tone * dark, 0.72 * tone * dark, 0.5 * tone * dark, 1, v);
    }
  }

  dust(x, y, z, count = 6, scale = 1, color = [0.9, 0.8, 0.62]) {
    for (let i = 0; i < count; i++) {
      this.spawn(P.DUST, x + rnd(-0.3, 0.3) * scale, y + rnd(0, 0.2), z + rnd(-0.3, 0.3) * scale,
        rnd(-0.6, 0.6) * scale, rnd(0.2, 0.9) * scale, rnd(-0.6, 0.6) * scale,
        rnd(0.8, 1.6), (0.3 + Math.random() * 0.3) * scale, color[0], color[1], color[2], 0.35, 0, 0.9 * scale);
    }
  }

  splash(x, y, z, count = 14, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 1.8 * power;
      this.spawn(P.SPRAY, x, y + 0.05, z, Math.cos(a) * s, (2 + Math.random() * 3) * power, Math.sin(a) * s,
        2, 0.04 + Math.random() * 0.05, 0.92, 0.97, 1.0, 0.9);
    }
    for (let i = 0; i < count / 3; i++) {
      this.spawn(P.FOAM, x + rnd(-0.3, 0.3), y + 0.05, z + rnd(-0.3, 0.3), rnd(-0.4, 0.4), rnd(0.2, 0.7), rnd(-0.4, 0.4),
        rnd(0.6, 1.2), 0.25 + Math.random() * 0.25, 1, 1, 1, 0.5, 0, 0.5);
    }
  }

  foamBurst(x, y, z, count = 4, power = 1) {
    for (let i = 0; i < count; i++) {
      this.spawn(P.FOAM, x + rnd(-0.4, 0.4), y, z + rnd(-0.4, 0.4), rnd(-0.6, 0.6), rnd(0.6, 1.8) * power, rnd(-0.2, 1.2),
        rnd(0.7, 1.5), 0.25 + Math.random() * 0.35, 1, 1, 1, 0.55, 0, 0.8);
    }
  }

  sparkle(x, y, z, count = 8, color = [1, 0.85, 0.4], spread = 0.4, size = 0.12) {
    for (let i = 0; i < count; i++) {
      this.spawn(P.SPARK, x + rnd(-spread, spread), y + rnd(-spread, spread), z + rnd(-spread, spread),
        rnd(-0.3, 0.3), rnd(0.1, 0.8), rnd(-0.3, 0.3), rnd(0.4, 1.1), size * (0.6 + Math.random()), color[0], color[1], color[2], 1);
    }
  }

  confetti(x, y, z, count = 40) {
    const cols = [[1, 0.42, 0.42], [1, 0.8, 0.3], [0.4, 0.85, 0.7], [0.45, 0.65, 1], [0.95, 0.5, 0.9], [1, 1, 1]];
    for (let i = 0; i < count; i++) {
      const c = cols[Math.floor(Math.random() * cols.length)];
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2.5;
      this.spawn(P.CONFETTI, x, y, z, Math.cos(a) * s, 4 + Math.random() * 4, Math.sin(a) * s, 3 + Math.random() * 2, 0.07, c[0], c[1], c[2], 1);
    }
  }

  spurt(x, y, z, dx, dy, dz, count = 6, wet = 0.4) {
    // sand pouring from a wound
    const dark = 1 - wet * 0.4;
    for (let i = 0; i < count; i++) {
      this.spawn(P.SAND, x, y, z, dx * 1.5 + rnd(-0.5, 0.5), dy * 1.5 + rnd(0, 1), dz * 1.5 + rnd(-0.5, 0.5),
        2, 0.035 + Math.random() * 0.04, 0.82 * dark, 0.68 * dark, 0.46 * dark, 1, 0.00002);
    }
  }

  ember(x, y, z, count = 1) {
    for (let i = 0; i < count; i++) {
      this.spawn(P.EMBER, x + rnd(-0.1, 0.1), y, z + rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(0.5, 1.2), rnd(-0.1, 0.1), rnd(0.6, 1.4), 0.05, 1, 0.55, 0.2, 1);
    }
  }

  smoke(x, y, z, count = 1, scale = 1) {
    for (let i = 0; i < count; i++) {
      this.spawn(P.SMOKE, x + rnd(-0.1, 0.1), y, z + rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(0.4, 0.8), rnd(-0.1, 0.1), rnd(2, 3.5), 0.25 * scale, 0.75, 0.72, 0.7, 0.25, 0, 0.5 * scale);
    }
  }

  // Lit tumbling chunks (pebbles, sand clumps, shell bits). vol>0 deposits sand on rest.
  chunk(x, y, z, vx, vy, vz, size, color, life = 4, vol = 0) {
    if (this.ch.length >= this.chunkMax) return;
    this.ch.push({ x, y, z, vx, vy, vz, size, life, maxLife: life, rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
      wx: rnd(-8, 8), wy: rnd(-8, 8), wz: rnd(-8, 8), color: color instanceof THREE.Color ? color : new THREE.Color(color), vol, rest: 0 });
  }

  update(dt) {
    const sim = this.sim;
    let n = this.n;
    const { px, py, pz, vx, vy, vz, life, maxLife, size, grow, type, vol } = this;
    for (let i = 0; i < n; i++) {
      life[i] -= dt;
      const t = type[i];
      let dead = life[i] <= 0;
      if (!dead) {
        let gy = -9.8, drag = 0.02;
        if (t === P.DUST || t === P.SMOKE) { gy = 0.15; drag = 2.2; }
        else if (t === P.FOAM) { gy = -1.2; drag = 1.6; }
        else if (t === P.SPARK) { gy = 0.2; drag = 1.5; }
        else if (t === P.CONFETTI) { gy = -2.2; drag = 1.8; vx[i] += Math.sin(life[i] * 9 + i) * dt * 4; }
        else if (t === P.EMBER) { gy = 0.6; drag = 0.8; vx[i] += Math.sin(life[i] * 7 + i) * dt; }
        const k = Math.exp(-drag * dt);
        vx[i] *= k; vz[i] *= k; vy[i] = vy[i] * k + gy * dt;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
        size[i] += grow[i] * dt;
        if (t === P.SAND || t === P.SPRAY || t === P.CONFETTI) {
          const gh = sim.heightAt(px[i], pz[i]);
          const surf = gh + sim.depthAt(px[i], pz[i]);
          if (t === P.SAND && py[i] <= gh + 0.02) {
            if (vol[i] > 0) sim.addSandAt(px[i], pz[i], vol[i]);
            dead = true;
          } else if (t === P.SAND && py[i] <= surf && surf - gh > 0.05) {
            // sinking through water: slow down
            vx[i] *= 0.9; vz[i] *= 0.9; vy[i] *= 0.85;
          } else if (t === P.SPRAY && py[i] <= surf) dead = true;
          else if (t === P.CONFETTI && py[i] <= gh + 0.03) { py[i] = gh + 0.03; vx[i] = vy[i] = vz[i] = 0; }
        }
      }
      if (dead) {
        n--;
        if (i !== n) {
          px[i] = px[n]; py[i] = py[n]; pz[i] = pz[n];
          vx[i] = vx[n]; vy[i] = vy[n]; vz[i] = vz[n];
          life[i] = life[n]; maxLife[i] = maxLife[n]; size[i] = size[n]; grow[i] = grow[n];
          this.r[i] = this.r[n]; this.g[i] = this.g[n]; this.b[i] = this.b[n]; this.a[i] = this.a[n];
          type[i] = type[n]; vol[i] = vol[n];
        }
        i--;
      }
    }
    this.n = n;

    // chunks
    for (let i = this.ch.length - 1; i >= 0; i--) {
      const c = this.ch[i];
      c.life -= dt;
      if (c.life <= 0) {
        if (c.vol > 0) sim.addSandAt(c.x, c.z, c.vol);
        this.ch.splice(i, 1);
        continue;
      }
      c.vy -= 9.8 * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      const gh = sim.heightAt(c.x, c.z) + c.size * 0.6;
      if (c.y < gh) {
        c.y = gh;
        if (c.vy < -1.2) {
          c.vy *= -0.3; c.vx *= 0.6; c.vz *= 0.6;
          c.wx *= 0.6; c.wy *= 0.6; c.wz *= 0.6;
        } else {
          c.vy = 0; c.vx *= 0.85; c.vz *= 0.85;
          c.wx *= 0.85; c.wy *= 0.85; c.wz *= 0.85;
          c.rest += dt;
        }
        // water drags chunks along the bottom
        if (sim.depthAt(c.x, c.z) > 0.05) {
          const k = sim.cellIndex(c.x, c.z);
          if (k >= 0) { c.vx += sim.vx[k] * dt * 2; c.vz += sim.vz[k] * dt * 2; }
        }
      }
      c.rx += c.wx * dt; c.ry += c.wy * dt; c.rz += c.wz * dt;
    }
  }

  render() {
    const L = this.normal, A = this.add;
    L.begin(); A.begin();
    const { px, py, pz, life, maxLife, size, type } = this;
    for (let i = 0; i < this.n; i++) {
      const t = type[i];
      const f = life[i] / maxLife[i];
      let a = this.a[i];
      if (t === P.DUST || t === P.SMOKE || t === P.FOAM) a *= f * (1 - f) * 4 * (t === P.FOAM ? 1.2 : 1);
      else if (t === P.SPARK || t === P.EMBER) a *= Math.min(1, f * 3) * (0.6 + 0.4 * Math.sin(life[i] * 30 + i));
      else if (t === P.CONFETTI) a *= Math.min(1, f * 2);
      if (t === P.SPARK || t === P.EMBER) A.push(px[i], py[i], pz[i], this.r[i], this.g[i], this.b[i], clamp(a, 0, 1), size[i]);
      else L.push(px[i], py[i], pz[i], this.r[i], this.g[i], this.b[i], clamp(a, 0, 1), size[i]);
    }
    L.end(); A.end();

    const m = this._m, q = this._q, e = this._e, s = this._s, p = this._p;
    const cm = this.chunks;
    let k = 0;
    for (const c of this.ch) {
      const fade = Math.min(1, c.life / 0.6);
      e.set(c.rx, c.ry, c.rz); q.setFromEuler(e);
      s.setScalar(c.size * fade); p.set(c.x, c.y, c.z);
      m.compose(p, q, s);
      cm.setMatrixAt(k, m);
      cm.setColorAt(k, c.color);
      k++;
    }
    cm.count = k;
    cm.instanceMatrix.needsUpdate = true;
    if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
  }
}
