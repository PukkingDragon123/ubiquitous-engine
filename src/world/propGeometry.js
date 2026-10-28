// Procedural geometry generators for natural props (all vertex-coloured).
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SimplexNoise } from '../core/noise.js';
import { mulberry32, clamp, lerp, smoothstep } from '../core/math.js';

const _c = new THREE.Color();
const _v = new THREE.Vector3();

function setColors(geo, fn) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    fn(i, pos.getX(i), pos.getY(i), pos.getZ(i), nrm ? nrm.getX(i) : 0, nrm ? nrm.getY(i) : 1, nrm ? nrm.getZ(i) : 0, _c);
    cols[i * 3] = _c.r; cols[i * 3 + 1] = _c.g; cols[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

function addAttr(geo, name, value) {
  const n = geo.attributes.position.count;
  geo.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n).fill(value), 1));
  return geo;
}

// ---- rocks ------------------------------------------------------------------
export function makeRockGeometry(seed = 1, { detail = 3, flat = 0.62, rough = 1, palette = 'beach' } = {}) {
  const nz = new SimplexNoise(seed);
  const rng = mulberry32(seed * 77 + 3);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const sx = 0.8 + rng() * 0.5, sz = 0.8 + rng() * 0.5;
  const strataF = 9 + rng() * 6;
  const disp = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    const n1 = nz.fbm3(_v.x * 1.1, _v.y * 1.1, _v.z * 1.1, 4);
    const n2 = nz.fbm3(_v.x * 3.3 + 5, _v.y * 3.3, _v.z * 3.3, 3);
    let r = 1 + 0.38 * n1 * rough + 0.12 * n2 * rough;
    r += 0.035 * Math.sin(_v.y * strataF + n1 * 3);
    disp[i] = n1 + n2 * 0.4;
    _v.multiplyScalar(r);
    _v.x *= sx; _v.z *= sz; _v.y *= flat;
    if (_v.y < -0.25) _v.y = -0.25 + (_v.y + 0.25) * 0.25;
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  g.computeVertexNormals();
  const base = palette === 'cliff' ? new THREE.Color(0x8f8072) : new THREE.Color(0x857a70);
  const warm = new THREE.Color(0xa38b72);
  const dark = new THREE.Color(0x4b4038);
  const lichen = new THREE.Color(0xc9b25a);
  const moss = new THREE.Color(0x7d8a4a);
  setColors(g, (i, x, y, z, nx, ny, nz2, out) => {
    const d = disp[i];
    out.copy(base).lerp(warm, clamp(0.5 + nz.noise3(x * 0.8, y * 0.8, z * 0.8) * 0.6));
    out.lerp(dark, clamp(0.45 - d * 1.2) * 0.75);
    const top = smoothstep(0.55, 0.95, ny);
    const spots = smoothstep(0.15, 0.45, nz.noise3(x * 2.5 + 9, y * 2.5, z * 2.5));
    out.lerp(palette === 'cliff' ? moss : lichen, top * spots * 0.55);
    // fine speckle
    const sp = nz.noise3(x * 14, y * 14, z * 14);
    out.multiplyScalar(0.9 + sp * 0.12);
  });
  return g;
}

// ---- beach grass --------------------------------------------------------------
export function makeGrassClump(seed = 1, { blades = 11, height = 0.9, spread = 0.18, dark = false } = {}) {
  const rng = mulberry32(seed * 131 + 7);
  const parts = [];
  const baseCol = dark ? new THREE.Color(0x1f3d22) : new THREE.Color(0x6f7d3a);
  const tipCol = dark ? new THREE.Color(0x4f7a3a) : new THREE.Color(0xd8cf8a);
  for (let b = 0; b < blades; b++) {
    const segs = 4;
    const h = height * (0.55 + rng() * 0.6);
    const w = 0.035 + rng() * 0.025;
    const ang = rng() * Math.PI * 2;
    const lean = 0.25 + rng() * 0.6;
    const ox = Math.cos(ang) * spread * rng(), oz = Math.sin(ang) * spread * rng();
    const pos = [], col = [], sway = [], idx = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const bend = t * t * lean * h;
      const cx = ox + Math.cos(ang) * bend, cz = oz + Math.sin(ang) * bend;
      const y = t * h;
      const ww = w * (1 - t * 0.92);
      const px = -Math.sin(ang) * ww, pz = Math.cos(ang) * ww;
      pos.push(cx - px, y, cz - pz, cx + px, y, cz + pz);
      _c.copy(baseCol).lerp(tipCol, Math.pow(t, 0.8));
      _c.offsetHSL((rng() - 0.5) * 0.02, 0, (rng() - 0.5) * 0.04);
      col.push(_c.r, _c.g, _c.b, _c.r, _c.g, _c.b);
      sway.push(t * t, t * t);
      if (s < segs) {
        const a = s * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
    g.setIndex(idx);
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  // grass normals point mostly up for soft lighting
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    _v.fromBufferAttribute(n, i).lerp(new THREE.Vector3(0, 1, 0), 0.6).normalize();
    n.setXYZ(i, _v.x, _v.y, _v.z);
  }
  return g;
}

// ---- palm tree ------------------------------------------------------------------
export function makePalm(seed = 1, { height = 9 } = {}) {
  const rng = mulberry32(seed * 911 + 1);
  const parts = [];
  // trunk: curved tapered tube with ring bumps
  const segs = 22, radial = 9;
  const lean = new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize().multiplyScalar(height * (0.15 + rng() * 0.2));
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(lean.x * 0.1, height * 0.35, lean.z * 0.1),
    new THREE.Vector3(lean.x * 0.6, height * 0.7, lean.z * 0.6),
    new THREE.Vector3(lean.x, height, lean.z),
  );
  const tpos = [], tcol = [], tidx = [], tsway = [];
  const r0 = height * 0.035;
  const trunkA = new THREE.Color(0x8a7058), trunkB = new THREE.Color(0xb59a78);
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const p = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const nrm = new THREE.Vector3(1, 0, 0).cross(tan).normalize();
    const bin = tan.clone().cross(nrm).normalize();
    const ring = 1 + 0.12 * Math.abs(Math.sin(t * segs * Math.PI * 0.5));
    const r = r0 * (1.25 - t * 0.5) * ring * (t < 0.06 ? 1 + (0.06 - t) * 6 : 1);
    for (let a = 0; a <= radial; a++) {
      const ang = (a / radial) * Math.PI * 2;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      tpos.push(p.x + (nrm.x * dx + bin.x * dz) * r, p.y + (nrm.y * dx + bin.y * dz) * r, p.z + (nrm.z * dx + bin.z * dz) * r);
      _c.copy(trunkA).lerp(trunkB, 0.5 + 0.5 * Math.sin(t * segs * Math.PI));
      tcol.push(_c.r, _c.g, _c.b);
      tsway.push(t * t * 0.15);
      if (s < segs && a < radial) {
        const i0 = s * (radial + 1) + a;
        tidx.push(i0, i0 + radial + 1, i0 + 1, i0 + 1, i0 + radial + 1, i0 + radial + 2);
      }
    }
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(tpos, 3));
  trunk.setAttribute('color', new THREE.Float32BufferAttribute(tcol, 3));
  trunk.setAttribute('aSway', new THREE.Float32BufferAttribute(tsway, 1));
  trunk.setAttribute('aLeaf', new THREE.Float32BufferAttribute(new Float32Array(tpos.length / 3), 1));
  trunk.setIndex(tidx);
  trunk.computeVertexNormals();
  parts.push(trunk);

  // fronds
  const top = curve.getPoint(1);
  const fronds = 9 + Math.floor(rng() * 4);
  const leafA = new THREE.Color(0x2f5a26), leafB = new THREE.Color(0x7fa54a);
  for (let f = 0; f < fronds; f++) {
    const ang = (f / fronds) * Math.PI * 2 + rng() * 0.4;
    const len = height * (0.42 + rng() * 0.18);
    const droop = 0.6 + rng() * 0.5;
    const fp = [], fc = [], fi = [], fs = [];
    const n = 14;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    let vi = 0;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const along = t * len;
      const y = Math.sin(t * Math.PI * 0.55) * len * 0.28 - t * t * len * droop * 0.55;
      const c = top.clone().addScaledVector(dir, along).add(new THREE.Vector3(0, y, 0));
      const leaflet = len * 0.22 * Math.sin(t * Math.PI) * (0.8 + 0.2 * Math.sin(s * 2.3));
      const hang = leaflet * 0.55;
      // rib + left/right leaflet tips (fishbone)
      const L = c.clone().addScaledVector(side, leaflet).add(new THREE.Vector3(0, -hang, 0)).addScaledVector(dir, leaflet * 0.25);
      const R = c.clone().addScaledVector(side, -leaflet).add(new THREE.Vector3(0, -hang, 0)).addScaledVector(dir, leaflet * 0.25);
      fp.push(L.x, L.y, L.z, c.x, c.y + 0.02, c.z, R.x, R.y, R.z);
      _c.copy(leafA).lerp(leafB, 0.25 + t * 0.6);
      const cr = _c.r, cg = _c.g, cb = _c.b;
      fc.push(cr * 0.85, cg * 0.85, cb * 0.85, cr, cg, cb, cr * 0.85, cg * 0.85, cb * 0.85);
      const sw = 0.25 + t * 0.9;
      fs.push(sw, sw, sw);
      if (s < n) {
        const a = vi;
        fi.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
      }
      vi += 3;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
    fg.setAttribute('aSway', new THREE.Float32BufferAttribute(fs, 1));
    fg.setAttribute('aLeaf', new THREE.Float32BufferAttribute(new Float32Array(fp.length / 3).fill(1), 1));
    fg.setIndex(fi);
    fg.computeVertexNormals();
    parts.push(fg);
  }
  // coconuts
  for (let c = 0; c < 3 + Math.floor(rng() * 3); c++) {
    const cg = new THREE.SphereGeometry(height * 0.03, 8, 6);
    const a = rng() * Math.PI * 2;
    cg.translate(top.x + Math.cos(a) * height * 0.035, top.y - height * 0.03, top.z + Math.sin(a) * height * 0.035);
    cg.deleteAttribute('uv');
    setColors(cg, (i, x, y, z, nx, ny, nz2, out) => out.set(0x5a4026).multiplyScalar(0.9 + ny * 0.2));
    addAttr(cg, 'aSway', 0.12);
    addAttr(cg, 'aLeaf', 0);
    parts.push(cg);
  }
  return mergeGeometries(parts.map((p) => (p.index ? p : p)), false);
}

// ---- bush (sea grape style: clusters of round leaves) -------------------------
export function makeBush(seed = 1, { size = 1, flowers = true, leaves = 70, seg = 7 } = {}) {
  const rng = mulberry32(seed * 313 + 5);
  const parts = [];
  const leafA = new THREE.Color(0x3d6b2c), leafB = new THREE.Color(0x8bb04f), red = new THREE.Color(0xa64a2f);
  for (let i = 0; i < leaves; i++) {
    const g = new THREE.CircleGeometry(0.16 * size * (0.7 + rng() * 0.6) * (leaves < 50 ? 1.35 : 1), seg);
    g.deleteAttribute('uv');
    // cup the leaf
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k);
      p.setZ(k, (x * x + y * y) * 1.4);
    }
    const u = rng(), v = rng();
    const th = u * Math.PI * 2, ph = Math.acos(1 - v * 1.25);
    const r = size * (0.45 + rng() * 0.25);
    const pos = new THREE.Vector3(Math.sin(ph) * Math.cos(th) * r * 1.2, Math.cos(ph) * r * 0.85 + size * 0.2, Math.sin(ph) * Math.sin(th) * r * 1.2);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), pos.clone().normalize().add(new THREE.Vector3(rng() - 0.5, 0.6, rng() - 0.5)), new THREE.Vector3(0, 1, 0));
    m.setPosition(pos);
    g.applyMatrix4(m);
    _c.copy(leafA).lerp(leafB, rng() * 0.8 + (pos.y / (size * 1.2)) * 0.3);
    if (rng() < 0.08) _c.lerp(red, 0.7);
    const cc = _c.clone();
    setColors(g, (k, x, y, z, nx, ny, nz2, out) => out.copy(cc));
    addAttr(g, 'aSway', 0.3 + pos.y * 0.3);
    addAttr(g, 'aLeaf', 1);
    parts.push(g);
  }
  if (flowers) {
    const fc = rng() < 0.5 ? new THREE.Color(0xff6fa8) : new THREE.Color(0xffd34f);
    for (let i = 0; i < 9; i++) {
      const g = new THREE.ConeGeometry(0.06 * size, 0.08 * size, 6, 1, true);
      g.deleteAttribute('uv');
      g.rotateX(Math.PI);
      const th = rng() * Math.PI * 2;
      const r = size * 0.62;
      g.translate(Math.cos(th) * r, size * (0.5 + rng() * 0.45), Math.sin(th) * r);
      setColors(g, (k, x, y, z, nx, ny, nz2, out) => out.copy(fc));
      addAttr(g, 'aSway', 0.5);
      addAttr(g, 'aLeaf', 1);
      parts.push(g);
    }
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

// ---- coral ------------------------------------------------------------------------
export function makeCoral(seed = 1, kind = 'branch') {
  const rng = mulberry32(seed * 57 + 11);
  const palettes = [0xff7a8a, 0xff9a5a, 0xc77dff, 0xffb3c7, 0xf26b5b, 0xffc06b];
  const col = new THREE.Color(palettes[Math.floor(rng() * palettes.length)]);
  const tip = col.clone().offsetHSL(0.02, 0.05, 0.12);
  const parts = [];
  if (kind === 'branch') {
    const branch = (start, dir, len, rad, depth) => {
      const end = start.clone().addScaledVector(dir, len);
      const g = new THREE.CylinderGeometry(rad * 0.7, rad, len, 5, 1, true);
      g.deleteAttribute('uv');
      g.translate(0, len / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.applyQuaternion(q);
      g.translate(start.x, start.y, start.z);
      const t = depth / 4;
      setColors(g, (k, x, y, z, nx, ny, nz2, out) => out.copy(col).lerp(tip, t));
      parts.push(g);
      if (depth < 2) {
        const n = 2 + Math.floor(rng() * 2);
        for (let i = 0; i < n; i++) {
          const nd = dir.clone().add(new THREE.Vector3((rng() - 0.5) * 1.3, rng() * 0.4, (rng() - 0.5) * 1.3)).normalize();
          branch(end, nd, len * (0.65 + rng() * 0.2), rad * 0.7, depth + 1);
        }
      } else {
        const s = new THREE.SphereGeometry(rad * 1.25, 5, 3);
        s.deleteAttribute('uv');
        s.translate(end.x, end.y, end.z);
        setColors(s, (k, x, y, z, nx, ny, nz2, out) => out.copy(tip));
        parts.push(s);
      }
    };
    for (let i = 0; i < 3; i++) {
      branch(new THREE.Vector3((rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.2), new THREE.Vector3((rng() - 0.5) * 0.6, 1, (rng() - 0.5) * 0.6).normalize(), 0.4, 0.08, 0);
    }
  } else if (kind === 'brain') {
    let g = new THREE.SphereGeometry(0.5, 20, 14);
    g.deleteAttribute('uv');
    g = mergeVertices(g);
    const nz = new SimplexNoise(seed);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      const n = Math.abs(nz.noise3(_v.x * 5, _v.y * 5, _v.z * 5));
      _v.multiplyScalar(1 + (0.5 - n) * 0.12);
      _v.y = Math.max(_v.y * 0.65, -0.05);
      p.setXYZ(i, _v.x, _v.y, _v.z);
    }
    g.computeVertexNormals();
    setColors(g, (k, x, y, z, nx, ny, nz2, out) => out.copy(col).lerp(tip, clamp(y * 1.5)));
    parts.push(g);
  } else {
    // fan coral: flat lattice disc
    const g = new THREE.CircleGeometry(0.55, 14, 0, Math.PI);
    g.deleteAttribute('uv');
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 4) * 0.05);
    g.rotateY(rng() * Math.PI);
    setColors(g, (k, x, y, z, nx, ny, nz2, out) => out.copy(col).lerp(tip, y * 1.5));
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

// ---- driftwood ------------------------------------------------------------------------
export function makeDriftwood(seed = 1, { length = 3 } = {}) {
  const rng = mulberry32(seed * 19 + 4);
  const parts = [];
  const mk = (start, dir, len, r0, r1) => {
    const segs = 6;
    const g = new THREE.CylinderGeometry(r1, r0, len, 7, segs);
    g.deleteAttribute('uv');
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) + Math.sin(y * 2.1 + seed) * len * 0.03);
      p.setZ(i, p.getZ(i) + Math.cos(y * 1.7 + seed) * len * 0.03);
    }
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(start.x, start.y, start.z);
    parts.push(g);
  };
  const dir = new THREE.Vector3(1, 0.0, (rng() - 0.5) * 0.2).normalize();
  const r = length * 0.085;
  mk(new THREE.Vector3(-length / 2, r * 0.55, 0), dir, length, r, r * 0.55);
  for (let b = 0; b < 2; b++) {
    const t = 0.3 + rng() * 0.45;
    const st = new THREE.Vector3(-length / 2 + length * t, r * 0.6, 0);
    const side = b === 0 ? 1 : -1;
    const bd = new THREE.Vector3(0.7 + rng() * 0.5, 0.08 + rng() * 0.12, side * (0.5 + rng() * 0.6)).normalize();
    mk(st, bd, length * (0.18 + rng() * 0.16), r * 0.5, r * 0.22);
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  const nz = new SimplexNoise(seed + 3);
  setColors(g, (i, x, y, z, nx, ny, nz2, out) => {
    out.set(0xd2c3aa);
    out.lerp(new THREE.Color(0x9c8a72), clamp(0.45 + nz.noise3(x * 3, y * 9, z * 3) * 0.7));
    out.multiplyScalar(0.88 + ny * 0.12);
  });
  return g;
}

// ---- small shells / starfish for decoration -----------------------------------------
export function makeStarfish() {
  const shape = new THREE.Shape();
  const arms = 5;
  for (let i = 0; i <= arms * 2; i++) {
    const a = (i / (arms * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.5 : 0.2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

export function makeShellGeometry(kind = 'scallop') {
  let g;
  if (kind === 'scallop') {
    g = new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.42);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const rib = 1 + 0.06 * Math.abs(Math.sin(a * 9));
      p.setX(i, x * rib); p.setZ(i, z * rib * 0.9);
      p.setY(i, (p.getY(i) - 0.32) * rib);
    }
  } else if (kind === 'conch') {
    // spiral shell
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector2(Math.sin(t * Math.PI) * 0.32 * (1 - t * 0.4) + 0.02, t * 0.9 - 0.2));
    }
    g = new THREE.LatheGeometry(pts, 12);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const s = 1 + 0.12 * Math.sin(y * 22);
      p.setX(i, p.getX(i) * s); p.setZ(i, p.getZ(i) * s);
    }
    g.rotateZ(Math.PI / 2);
    g.translate(0, 0.22, 0);
  } else {
    // clam
    g = new THREE.SphereGeometry(0.45, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.35);
    g.scale(1, 0.5, 0.8);
    g.translate(0, -0.12, 0);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}
