// Procedural, hand-crafted-looking models for every building, made from the
// same things a sandling would scavenge: packed sand, driftwood, shells,
// pebbles, seaweed, toothpicks and bottle caps.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/math.js';
import { makeShellGeometry, makeRockGeometry } from '../world/propGeometry.js';

const WHITE = new THREE.Color(1, 1, 1);

// Normalise a geometry for merging: non-indexed, position + normal + color.
export function prep(g, color = WHITE) {
  let out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.color) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const n = out.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    out.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  return out;
}

class ModelBuilder {
  constructor(seed = 1) {
    this.rng = mulberry32(seed);
    this.parts = {};
    this.lift = {};
    this.flags = [];
    this.colliders = [];
    this.slots = {};
    this.height = 1;
  }
  add(mat, g, color, lift = false) {
    const t = lift ? this.lift : this.parts;
    (t[mat] || (t[mat] = [])).push(prep(g, color));
    return this;
  }
  at(g, x, y, z, ry = 0, rx = 0, rz = 0) {
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return g;
  }
  circle(x, z, r, top) { this.colliders.push({ type: 'circle', x, z, r, top }); }
  box(x, z, hx, hz, top, rot = 0) { this.colliders.push({ type: 'box', x, z, hx, hz, top, rot }); }
  flag(x, y, z, color, size = 1) { this.flags.push({ x, y, z, color, size }); }
  build() {
    const merge = (t) => {
      const out = {};
      for (const k in t) out[k] = mergeGeometries(t[k]);
      return out;
    };
    return { parts: merge(this.parts), lift: merge(this.lift), flags: this.flags, colliders: this.colliders, slots: this.slots, height: this.height };
  }
}

// ---- primitive helpers ---------------------------------------------------------
// Bucket-moulded tower: tapered, ridged, crenellated.
function bucketTower(r, h, { ridges = 3, merlons = 8, taper = 0.85, rough = 0.02, rng } = {}) {
  const pts = [];
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let rr = r * (1 - (1 - taper) * t);
    // bucket ridges
    const ridge = Math.sin(t * Math.PI * ridges * 2);
    rr += ridge > 0.85 ? r * 0.035 : 0;
    rr += (rng ? rng() - 0.5 : 0) * rough;
    pts.push(new THREE.Vector2(rr, t * h));
  }
  pts.push(new THREE.Vector2(r * taper * 0.86, h));
  pts.push(new THREE.Vector2(r * taper * 0.86, h - 0.08));
  pts.push(new THREE.Vector2(0.001, h - 0.08));
  const g = new THREE.LatheGeometry(pts, 24);
  const list = [g];
  const rt = r * taper;
  for (let i = 0; i < merlons; i++) {
    const a = (i / merlons) * Math.PI * 2;
    const m = new THREE.BoxGeometry(rt * 0.42, rt * 0.34, rt * 0.24);
    m.rotateY(-a);
    m.translate(Math.cos(a) * rt * 0.92, h + rt * 0.15, Math.sin(a) * rt * 0.92);
    list.push(m);
  }
  // keep smooth lathe normals: convert each part, then merge position + normal
  const parts = list.map((x) => {
    const n = x.index ? x.toNonIndexed() : x;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    return n;
  });
  return mergeGeometries(parts, false);
}

function finish(g) {
  return g;
}

function sandBox(w, h, d, bevel = 0.06) {
  const shape = new THREE.Shape();
  const hw = w / 2, hd = d / 2, b = Math.min(bevel, hw * 0.4, hd * 0.4);
  // the bevel grows the extrusion on both caps, so take it out of the depth
  // to keep the slab exactly h tall (models place things on top at y = h)
  const bt = Math.min(b * 0.6, h * 0.45);
  shape.moveTo(-hw + b, -hd);
  shape.lineTo(hw - b, -hd); shape.quadraticCurveTo(hw, -hd, hw, -hd + b);
  shape.lineTo(hw, hd - b); shape.quadraticCurveTo(hw, hd, hw - b, hd);
  shape.lineTo(-hw + b, hd); shape.quadraticCurveTo(-hw, hd, -hw, hd - b);
  shape.lineTo(-hw, -hd + b); shape.quadraticCurveTo(-hw, -hd, -hw + b, -hd);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, h - bt * 2), bevelEnabled: true, bevelThickness: bt, bevelSize: b * 0.5, bevelSegments: 2, curveSegments: 3 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bt, 0);
  return g;
}

function wallSegment(len, h, thick, merlons = 3) {
  const list = [sandBox(len, h, thick, 0.05)];
  const n = Math.max(1, merlons);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len / n) * (i + 0.5);
    const m = new THREE.BoxGeometry((len / n) * 0.55, thick * 0.55, thick * 1.02);
    m.translate(x, h + thick * 0.27, 0);
    list.push(m);
  }
  return list;
}

function dome(r, flat = 0.85) {
  const g = new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, flat, 1);
  return g;
}

function plank(len, w = 0.16, t = 0.05) {
  return new THREE.BoxGeometry(len, t, w);
}

function stick(len, r = 0.03) {
  const g = new THREE.CylinderGeometry(r * 0.8, r, len, 5);
  g.translate(0, len / 2, 0);
  return g;
}

function archHole(w, h, depth = 0.1) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(-w / 2, h - w / 2);
  shape.absarc(0, h - w / 2, w / 2, Math.PI, 0, true);
  shape.lineTo(w / 2, 0);
  shape.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  return g;
}

function windowHole(w, h) {
  const g = new THREE.BoxGeometry(w, h, 0.06);
  return g;
}

function shellAccent(b, mat, x, y, z, ry, s, kind = 'scallop', color = 0xf6e0cf, rx = -Math.PI / 2) {
  const g = makeShellGeometry(kind);
  g.scale(s, s, s);
  g.rotateX(rx);
  g.rotateY(ry);
  g.translate(x, y, z);
  b.add(mat, g, color);
}

function tent(w, h, d) {
  // A-frame tent of seaweed cloth on driftwood
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0); shape.lineTo(0, h); shape.lineTo(w / 2, 0); shape.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

// ---- building models -----------------------------------------------------------
export function keepModel() {
  const b = new ModelBuilder(11);
  const rng = b.rng;
  b.height = 5.2;
  // platform
  b.add('sand', sandBox(7.6, 0.55, 7.6, 0.4));
  // central keep tower
  const keep = finish(bucketTower(1.55, 3.6, { ridges: 4, merlons: 10, rng }));
  b.add('sand', b.at(keep, 0, 0.5, -0.6));
  // keep top (lifts for inspection)
  const cap = finish(bucketTower(1.05, 1.1, { ridges: 1, merlons: 8, taper: 0.8, rng }));
  b.add('sand', b.at(cap, 0, 4.1, -0.6), null, true);
  b.flag(0, 5.5, -0.6, 0xff6b5a, 1.4);
  // corner towers
  for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    const t = finish(bucketTower(0.85, 2.4, { ridges: 3, merlons: 7, rng }));
    b.add('sand', b.at(t, x, 0.5, z));
    b.flag(x, 3.45, z, [0x4fc3f7, 0xffd54f, 0x81c784, 0xf48fb1][(x > 0) + (z > 0) * 2], 0.9);
    b.circle(x, z, 0.85, 2.9);
  }
  // curtain walls
  for (const [x, z, ry, len] of [[0, -3, 0, 4.4], [-3, 0, Math.PI / 2, 4.4], [3, 0, Math.PI / 2, 4.4], [-1.9, 3, 0, 1.6], [1.9, 3, 0, 1.6]]) {
    for (const g of wallSegment(len, 1.5, 0.55, Math.round(len / 0.8))) b.add('sand', b.at(g, x, 0.5, z, ry));
    if (ry) b.box(x, z, 0.3, len / 2, 2.0); else b.box(x, z, len / 2, 0.3, 2.0);
  }
  // gate arch
  const gate = archHole(1.3, 1.3, 0.3);
  b.add('dark', b.at(gate, 0, 0.5, 2.85));
  // door planks
  for (let i = -2; i <= 2; i++) b.add('wood', b.at(new THREE.BoxGeometry(0.22, 1.05, 0.05), i * 0.24, 1.0, 3.18), 0xb8915f);
  b.circle(0, -0.6, 1.6, 4.1);
  // windows on keep
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const w = windowHole(0.22, 0.38);
    w.rotateY(-a + Math.PI / 2);
    b.add('dark', b.at(w, Math.cos(a) * 1.42, 2.6 + (i % 2) * 0.6, -0.6 + Math.sin(a) * 1.42));
  }
  // throne balcony in front of the keep
  b.add('sand', b.at(sandBox(1.6, 0.5, 1.2, 0.15), 0, 0.5, 1.15));
  const throneBack = makeShellGeometry('scallop');
  throneBack.scale(1.5, 1.5, 1.5);
  throneBack.rotateX(-Math.PI / 2 + 0.25);
  b.add('throne', b.at(throneBack, 0, 1.55, 0.72), 0xffd6c4);
  b.add('sand', b.at(sandBox(0.62, 0.26, 0.5, 0.08), 0, 1.0, 1.05));
  b.add('cloth', b.at(new THREE.BoxGeometry(0.6, 0.04, 0.5), 0, 1.3, 1.05), 0xc8323c);
  b.slots.throne = { x: 0, y: 1.32, z: 1.06, yaw: 0 };
  b.slots.door = { x: 0, z: 4.2 };
  b.slots.storage = { x: 2.2, z: 4.6 };
  // shells pressed into the walls
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2;
    shellAccent(b, 'shell', Math.cos(a) * 1.5, 1.0 + rng() * 2.6, -0.6 + Math.sin(a) * 1.5, -a + Math.PI / 2, 0.22 + rng() * 0.1, 'scallop', [0xf2c9a8, 0xeea688, 0xf6d8b4][i % 3], 0);
  }
  // garrison spots on corner towers
  b.slots.garrison = [[-3, 2.95, -3], [3, 2.95, -3], [-3, 2.95, 3], [3, 2.95, 3]].map(([x, y, z]) => ({ x, y, z }));
  b.slots.interior = { x: 0, y: 0.6, z: -0.6, r: 1.1 };
  // inside the keep: royal carpet, a shell treasure heap, a sandling-sized bed
  b.add('interior', b.at(new THREE.BoxGeometry(0.5, 0.02, 1.8), 0, 0.56, 0.6), 0xb8323c);
  b.add('interior', b.at(new THREE.BoxGeometry(0.56, 0.021, 1.86), 0, 0.555, 0.6), 0xf2c14e);
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 0.35;
    const g = new THREE.CylinderGeometry(0.05, 0.05, 0.015, 10);
    g.rotateX(rng() * 0.6);
    b.add('interior', b.at(g, 0.7 + Math.cos(a) * r, 0.58 + rng() * 0.12, -1.0 + Math.sin(a) * r), 0xffcf5a);
  }
  const kb = makeShellGeometry('clam');
  kb.scale(1.1, 0.8, 1.6);
  b.add('interior', b.at(kb, -0.65, 0.62, -0.9, 0.4), 0xffe3c2);
  b.add('interior', b.at(new THREE.BoxGeometry(0.5, 0.05, 0.42), -0.65, 0.67, -0.85, 0.4), 0x8a3ac8);
  return b.build();
}

export function campModel() {
  const b = new ModelBuilder(21);
  const rng = b.rng;
  b.height = 2.0;
  b.add('sand', sandBox(5.6, 0.18, 5.6, 0.8));
  const colors = [0x6e8a3a, 0x8a7a3a, 0x5a7a4a];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 1.75, z = Math.sin(a) * 1.75;
    const t = tent(1.5, 1.25, 1.4);
    t.rotateY(-a + Math.PI / 2);
    t.translate(x, 0.18, z);
    b.add('cloth', t, colors[i % 3], true);
    // driftwood ridge pole
    const pole = plank(1.6, 0.07, 0.07);
    pole.rotateY(-a + Math.PI / 2 + Math.PI / 2);
    b.add('wood', b.at(pole, x, 1.45, z), 0xc9b08a, true);
    b.circle(x, z, 0.7, 1.4);
  }
  // campfire ring
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = makeRockGeometry(300 + i, { detail: 1, flat: 0.6 });
    r.scale(0.14, 0.14, 0.14);
    b.add('stone', b.at(r, Math.cos(a) * 0.4, 0.22, Math.sin(a) * 0.4), 0x8a8078);
  }
  for (let i = 0; i < 4; i++) {
    const s = stick(0.55, 0.035);
    s.rotateZ(0.9);
    s.rotateY((i / 4) * Math.PI * 2);
    b.add('wood', b.at(s, 0, 0.2, 0), 0x6a4a2a);
  }
  b.slots.fire = { x: 0, y: 0.35, z: 0 };
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const roll = new THREE.CapsuleGeometry(0.11, 0.5, 4, 8);
    roll.rotateZ(Math.PI / 2);
    b.add('interior', b.at(roll, Math.cos(a) * 1.75, 0.3, Math.sin(a) * 1.75, -a), [0x6e8a3a, 0x8a5a3a, 0x5a6aa8, 0xa84a4a][i]);
  }
  // shell storage pile
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 0.45;
    shellAccent(b, 'shell', 2.1 + Math.cos(a) * r, 0.22 + rng() * 0.25, 2.1 + Math.sin(a) * r, rng() * 6, 0.2 + rng() * 0.12, ['scallop', 'conch', 'clam'][i % 3], [0xfbeee0, 0xf6c6a8, 0xf2a37c][i % 3], -Math.PI / 2 + rng());
  }
  b.slots.storage = { x: 2.1, z: 2.1 };
  b.slots.door = { x: 0, z: 0.9 };
  // sign post
  b.add('wood', b.at(stick(1.2, 0.04), -2.4, 0.15, 2.3), 0xb8915f);
  b.add('wood', b.at(new THREE.BoxGeometry(0.7, 0.3, 0.05), -2.4, 1.15, 2.3), 0xd8b98a);
  b.flag(-2.4, 1.6, 2.3, 0xffb74d, 0.6);
  b.slots.interior = { x: 0, y: 0.25, z: 0, r: 1.2 };
  return b.build();
}

export function houseModel() {
  const b = new ModelBuilder(31);
  const rng = b.rng;
  b.height = 2.1;
  b.add('sand', sandBox(2.8, 0.15, 2.8, 0.6));
  const d = dome(1.15, 1.0);
  b.add('sand', b.at(d, 0, 0.12, 0));
  // conch shell roof (lifts off)
  const roof = makeShellGeometry('conch');
  roof.rotateZ(-Math.PI / 2);
  roof.scale(2.0, 2.3, 2.0);
  b.add('shell', b.at(roof, 0, 1.15, 0), 0xf6c6a8, true);
  // door + window
  b.add('dark', b.at(archHole(0.55, 0.75, 0.25), 0, 0.12, 0.98));
  const win = new THREE.CircleGeometry(0.16, 12);
  b.add('dark', b.at(win, 0.7, 0.75, 0.82, 0.7));
  b.add('wood', b.at(new THREE.BoxGeometry(0.7, 0.06, 0.25), 0, 0.92, 1.08), 0xc9a26b);
  // little garden of shells
  for (let i = 0; i < 6; i++) shellAccent(b, 'shell', -1.1 + rng() * 0.4, 0.17, 0.9 + rng() * 0.3, rng() * 6, 0.14, 'clam', 0xffe3c2, -Math.PI / 2);
  b.circle(0, 0, 1.15, 1.6);
  b.slots.door = { x: 0, z: 1.6 };
  b.slots.interior = { x: 0, y: 0.15, z: 0, r: 0.7 };
  b.slots.beds = [{ x: -0.42, z: -0.3 }, { x: 0.42, z: -0.3 }, { x: 0, z: 0.38 }];
  // clam-shell beds with seaweed blankets, a pebble table and a tiny candle
  for (const bd of b.slots.beds) {
    const bed = makeShellGeometry('clam');
    bed.scale(0.85, 0.7, 1.25);
    b.add('interior', b.at(bed, bd.x, 0.2, bd.z, Math.atan2(bd.x, bd.z)), 0xf6dcc4);
    const blanket = new THREE.BoxGeometry(0.42, 0.04, 0.36);
    b.add('interior', b.at(blanket, bd.x, 0.24, bd.z + 0.06, Math.atan2(bd.x, bd.z)), [0x5d8a3a, 0x7a9a4a, 0x4f7a36][Math.abs(Math.round(bd.x * 10)) % 3]);
  }
  const table = makeRockGeometry(321, { detail: 1, flat: 0.5 });
  table.scale(0.18, 0.14, 0.18);
  b.add('interior', b.at(table, 0.05, 0.2, -0.05), 0x9a9086);
  b.add('interior', b.at(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 6), 0.05, 0.31, -0.05), 0xfff4d0);
  return b.build();
}

export function barracksModel() {
  const b = new ModelBuilder(41);
  b.height = 2.6;
  b.add('sand', sandBox(5.0, 0.2, 3.8, 0.5));
  b.add('sand', b.at(sandBox(4.2, 1.35, 2.8, 0.12), 0, 0.2, -0.1));
  // pitched driftwood plank roof (lifts)
  for (let i = 0; i < 9; i++) {
    const z = -1.5 + i * 0.36;
    for (const side of [-1, 1]) {
      const p = plank(2.5, 0.38, 0.06);
      p.rotateZ(side * 0.42);
      b.add('wood', b.at(p, side * 1.12, 2.05, z - 0.1), [0xc9b08a, 0xb79a72, 0xd2bc98][i % 3], true);
    }
  }
  b.add('wood', b.at(plank(0.2, 3.4, 0.2), 0, 2.55, -0.1, Math.PI / 2), 0x9a7a52, true);
  // door + windows
  b.add('dark', b.at(archHole(0.7, 1.0, 0.2), 0, 0.2, 1.25));
  for (const x of [-1.4, 1.4]) b.add('dark', b.at(windowHole(0.4, 0.35), x, 1.0, 1.32));
  // banner
  b.add('wood', b.at(stick(2.6, 0.04), 2.2, 0.2, 1.5), 0xb8915f);
  b.flag(2.2, 2.7, 1.5, 0xd84343, 1.2);
  // weapon rack with toothpicks
  for (let i = 0; i < 5; i++) {
    const s = stick(0.85, 0.015);
    s.rotateZ(0.12);
    b.add('wood', b.at(s, -2.2 + i * 0.12, 0.2, 1.55), 0xe8d3a8);
  }
  b.add('wood', b.at(plank(0.8, 0.06, 0.06), -1.95, 0.7, 1.55), 0x9a7a52);
  // training dummy
  b.add('wood', b.at(stick(0.9, 0.04), -2.0, 0.2, -1.4), 0x9a7a52);
  b.add('sand', b.at(new THREE.SphereGeometry(0.22, 10, 8), -2.0, 1.1, -1.4));
  b.add('cloth', b.at(new THREE.BoxGeometry(0.5, 0.06, 0.06), -2.0, 0.85, -1.4), 0xd84343);
  b.box(0, -0.1, 2.1, 1.4, 1.6);
  b.slots.door = { x: 0, z: 2.0 };
  b.slots.interior = { x: 0, y: 0.25, z: -0.1, r: 1.2 };
  for (let i = 0; i < 3; i++) {
    b.add('interior', b.at(new THREE.BoxGeometry(0.42, 0.08, 0.8), -1.5 + i * 0.55, 0.3, -0.85), 0xb79a72);
    b.add('interior', b.at(new THREE.BoxGeometry(0.36, 0.05, 0.6), -1.5 + i * 0.55, 0.36, -0.85), 0xc8463a);
  }
  for (let i = 0; i < 4; i++) b.add('interior', b.at(stick(0.7, 0.015), 1.2 + i * 0.12, 0.22, -0.95, 0, 0, 0.1), 0xe8d3a8);
  b.add('interior', b.at(stick(0.55, 0.035), 1.2, 0.22, 0.4), 0x9a7a52);
  b.add('interior', b.at(new THREE.SphereGeometry(0.16, 10, 8), 1.2, 0.85, 0.4), 0xe0bf8a);
  return b.build();
}

export function towerModel() {
  const b = new ModelBuilder(51);
  const rng = b.rng;
  b.height = 5.0;
  b.add('sand', sandBox(2.6, 0.15, 2.6, 0.5));
  const t = finish(bucketTower(1.0, 3.8, { ridges: 5, merlons: 0, taper: 0.82, rng }));
  b.add('sand', b.at(t, 0, 0.12, 0));
  // lookout platform of driftwood planks
  for (let i = 0; i < 7; i++) b.add('wood', b.at(plank(2.0, 0.28, 0.07), 0, 3.95, -0.84 + i * 0.28), [0xc9b08a, 0xb79a72][i % 2]);
  // railings (toothpicks)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    b.add('wood', b.at(stick(0.45, 0.015), Math.cos(a) * 0.95, 3.98, Math.sin(a) * 0.95), 0xe8d3a8);
  }
  const rail = new THREE.TorusGeometry(0.95, 0.02, 4, 24);
  rail.rotateX(Math.PI / 2);
  b.add('wood', b.at(rail, 0, 4.4, 0), 0xe8d3a8);
  // ladder
  for (const x of [-0.12, 0.12]) b.add('wood', b.at(stick(3.9, 0.018), x, 0.12, 0.98), 0xd8b98a);
  for (let i = 0; i < 12; i++) b.add('wood', b.at(new THREE.BoxGeometry(0.26, 0.02, 0.02), 0, 0.35 + i * 0.3, 1.0), 0xd8b98a);
  b.add('dark', b.at(archHole(0.45, 0.7, 0.2), 0, 0.12, 0.86));
  for (let i = 0; i < 3; i++) b.add('dark', b.at(windowHole(0.12, 0.3), 0, 1.4 + i * 0.85, 0.9 - i * 0.02, 0));
  b.add('wood', b.at(stick(1.3, 0.025), 0.75, 4.0, -0.6), 0xb8915f);
  b.flag(0.75, 5.2, -0.6, 0x4fc3f7, 0.9);
  b.circle(0, 0, 1.05, 4.0);
  b.slots.garrison = [{ x: -0.4, y: 4.0, z: 0.1 }, { x: 0.4, y: 4.0, z: 0.1 }, { x: 0, y: 4.0, z: -0.45 }];
  b.slots.door = { x: 0, z: 1.6 };
  b.slots.interior = { x: 0, y: 0.15, z: 0, r: 0.6 };
  return b.build();
}

export function wallModel(len = 2.0) {
  const b = new ModelBuilder(61);
  b.height = 1.9;
  for (const g of wallSegment(len, 1.55, 0.75, 3)) b.add('sand', g);
  b.box(0, 0, len / 2, 0.38, 1.6);
  b.slots.garrison = [{ x: 0, y: 1.6, z: 0 }];
  return b.build();
}

export function cannonModel() {
  const b = new ModelBuilder(71);
  b.height = 1.4;
  b.add('sand', sandBox(2.2, 0.35, 2.2, 0.4));
  // carriage
  for (const x of [-0.35, 0.35]) b.add('wood', b.at(new THREE.BoxGeometry(0.12, 0.45, 1.1), x, 0.55, 0), 0xb79a72);
  for (const x of [-0.5, 0.5]) {
    const w = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 12);
    w.rotateZ(Math.PI / 2);
    b.add('wood', b.at(w, x, 0.6, 0.15), 0x8a6a42);
  }
  // barrel: a striped paper straw (rotates to aim) — kept in "lift" group so it can be animated
  const barrel = new THREE.CylinderGeometry(0.17, 0.2, 1.4, 14, 1, true);
  barrel.rotateX(Math.PI / 2 - 0.25);
  barrel.translate(0, 0.95, 0.25);
  b.add('metal', barrel, 0xffffff, true);
  // pebble ammo pile
  for (let i = 0; i < 7; i++) {
    const r = makeRockGeometry(700 + i, { detail: 1 });
    r.scale(0.12, 0.1, 0.12);
    b.add('stone', b.at(r, -0.7 + (i % 3) * 0.14, 0.42 + Math.floor(i / 3) * 0.1, -0.7), 0x8a8078);
  }
  b.circle(0, 0, 1.0, 1.0);
  b.slots.muzzle = { x: 0, y: 1.15, z: 0.95 };
  return b.build();
}

export function catapultModel() {
  const b = new ModelBuilder(81);
  b.height = 2.0;
  b.add('sand', sandBox(2.6, 0.3, 2.6, 0.4));
  // popsicle-stick frame
  for (const x of [-0.5, 0.5]) {
    b.add('wood', b.at(new THREE.BoxGeometry(0.1, 0.06, 1.8), x, 0.4, 0), 0xe6cfa0);
    const up = new THREE.BoxGeometry(0.1, 1.0, 0.06);
    b.add('wood', b.at(up, x, 0.85, -0.1), 0xe6cfa0);
  }
  b.add('wood', b.at(new THREE.BoxGeometry(1.1, 0.08, 0.08), 0, 1.3, -0.1), 0xe6cfa0);
  // wooden spoon arm (animated)
  const arm = new THREE.BoxGeometry(0.1, 0.05, 1.5);
  arm.translate(0, 0, -0.55);
  const bowl = new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bowl.scale(1, 0.5, 1.2);
  bowl.translate(0, 0.05, -1.35);
  const armG = mergeGeometries([prep(arm, 0xc9a26b), prep(bowl, 0xc9a26b)]);
  armG.rotateX(-0.5);
  armG.translate(0, 0.55, 0.45);
  b.add('wood', armG, 0xc9a26b, true);
  b.add('cloth', b.at(new THREE.TorusGeometry(0.1, 0.025, 5, 12), 0, 0.6, 0.2), 0xd84343);
  b.circle(0, 0, 1.1, 1.3);
  return b.build();
}

export function shelterModel() {
  const b = new ModelBuilder(91);
  const rng = b.rng;
  b.height = 2.0;
  b.add('sand', sandBox(3.2, 0.15, 3.2, 0.7));
  // cairn of stacked pebbles
  for (let ring = 0; ring < 4; ring++) {
    const n = 12 - ring * 2;
    const rr = 1.3 - ring * 0.3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.3;
      if (ring < 2 && Math.abs(a - Math.PI / 2) < 0.45) continue; // entrance
      const r = makeRockGeometry(900 + ring * 20 + i, { detail: 1, flat: 0.7 });
      const s = 0.42 - ring * 0.06 + rng() * 0.08;
      r.scale(s, s * 0.8, s);
      b.add('stone', b.at(r, Math.cos(a) * rr, 0.35 + ring * 0.42, Math.sin(a) * rr, rng() * 6), [0x8f857b, 0x7d746c, 0x9a9086][i % 3]);
    }
  }
  const cap = makeRockGeometry(999, { detail: 2, flat: 0.6 });
  cap.scale(0.75, 0.55, 0.75);
  b.add('stone', b.at(cap, 0, 1.9, 0), 0x8a8078, true);
  b.add('dark', b.at(archHole(0.7, 0.8, 0.2), 0, 0.12, 1.15));
  b.circle(0, 0, 1.4, 1.8);
  b.slots.door = { x: 0, z: 1.9 };
  b.slots.interior = { x: 0, y: 0.15, z: 0, r: 0.8 };
  return b.build();
}

export function bridgeModel(len = 4) {
  const b = new ModelBuilder(101);
  b.height = 0.4;
  const n = Math.round(len / 0.3);
  for (let i = 0; i < n; i++) b.add('wood', b.at(plank(1.6, 0.26, 0.07), 0, 0.25, -len / 2 + 0.15 + i * 0.3, 0), [0xc9b08a, 0xb79a72, 0xd2bc98][i % 3]);
  for (const x of [-0.75, 0.75]) b.add('wood', b.at(plank(len, 0.08, 0.1), x, 0.2, 0, Math.PI / 2), 0x8a6a42);
  for (const x of [-0.8, 0.8]) for (const z of [-len / 2, len / 2]) b.add('wood', b.at(stick(0.6, 0.04), x, -0.1, z), 0x8a6a42);
  return b.build();
}

export function trapModel() {
  const b = new ModelBuilder(111);
  const rng = b.rng;
  b.height = 0.5;
  for (let i = 0; i < 22; i++) {
    const s = stick(0.45 + rng() * 0.2, 0.018);
    s.rotateX((rng() - 0.5) * 0.4);
    s.rotateZ((rng() - 0.5) * 0.4);
    b.add('wood', b.at(s, (rng() - 0.5) * 1.6, -0.1, (rng() - 0.5) * 1.6), 0xe8d3a8);
  }
  return b.build();
}

export function stableModel() {
  const b = new ModelBuilder(121);
  b.height = 1.8;
  b.add('sand', sandBox(5.2, 0.15, 4.2, 0.6));
  // stick fence
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const a = t * Math.PI * 2;
    if (Math.abs(a - Math.PI / 2) < 0.3) continue;
    b.add('wood', b.at(stick(0.7, 0.03), Math.cos(a) * 2.3, 0.1, Math.sin(a) * 1.8), 0xc9a26b);
  }
  const rail = new THREE.TorusGeometry(1, 0.025, 4, 40);
  rail.rotateX(Math.PI / 2);
  rail.scale(2.3, 1, 1.8);
  b.add('wood', b.at(rail, 0, 0.6, 0), 0xc9a26b);
  // shell trough + hay of seaweed
  const trough = makeShellGeometry('clam');
  trough.scale(1.6, 1.0, 1.0);
  b.add('shell', b.at(trough, -1.2, 0.35, -0.8), 0xffe3c2);
  b.add('cloth', b.at(new THREE.SphereGeometry(0.35, 8, 6), 1.3, 0.25, -0.9), 0x6e8a3a);
  // sand seahorse statue
  const neck = new THREE.CylinderGeometry(0.12, 0.2, 0.9, 10);
  neck.rotateX(-0.25);
  b.add('sand', b.at(neck, 0, 0.6, -1.2));
  b.add('sand', b.at(new THREE.SphereGeometry(0.2, 10, 8), 0, 1.15, -1.05));
  b.flag(2.2, 1.2, 1.6, 0x81c784, 0.7);
  b.add('wood', b.at(stick(1.0, 0.03), 2.2, 0.15, 1.6), 0xb8915f);
  b.slots.door = { x: 0, z: 2.2 };
  b.slots.interior = { x: 0, y: 0.15, z: 0, r: 1.4 };
  return b.build();
}

export function roostModel() {
  const b = new ModelBuilder(131);
  const rng = b.rng;
  b.height = 6.0;
  b.add('sand', sandBox(3.4, 0.2, 3.4, 0.8));
  // spiral sand spire
  const pts = [];
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    pts.push(new THREE.Vector2(1.25 * (1 - t * 0.72) + Math.sin(t * 24) * 0.04, t * 5.0));
  }
  const spire = new THREE.LatheGeometry(pts, 20);
  b.add('sand', b.at(spire, 0, 0.2, 0));
  // seaweed nest on top
  const nest = new THREE.TorusGeometry(0.55, 0.22, 8, 16);
  nest.rotateX(Math.PI / 2);
  b.add('cloth', b.at(nest, 0, 5.25, 0), 0x55702e, true);
  // sea glass gems pressed in
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2, t = rng();
    const r = 1.25 * (1 - t * 0.72);
    const g = new THREE.IcosahedronGeometry(0.1, 0);
    b.add('gem', b.at(g, Math.cos(a) * r, 0.4 + t * 4.6, Math.sin(a) * r), [0x7de8c8, 0x7cc8f2, 0xb3f27c][i % 3]);
  }
  b.circle(0, 0, 1.3, 5.0);
  b.slots.door = { x: 0, z: 2.0 };
  b.slots.nest = { x: 0, y: 5.4, z: 0 };
  return b.build();
}

export function bucketModel() {
  const b = new ModelBuilder(141);
  b.height = 1.2;
  const t = bucketTower(0.62, 1.0, { ridges: 3, merlons: 6, taper: 0.8, rng: b.rng });
  b.add('sand', t);
  b.circle(0, 0, 0.62, 1.05);
  return b.build();
}

// A round basin of packed wet sand with a driftwood sluice facing +z. The water
// surface and the sliding gate are animated by the building itself.
export function reservoirModel() {
  const b = new ModelBuilder(97);
  const rng = b.rng;
  b.height = 1.0;
  b.add('sand', sandBox(3.3, 0.15, 3.3, 0.7));
  const gap = 0.62;
  // outside up, over the rim, inside down (so the faces point the right way)
  const prof = [[1.56, 0.12], [1.48, 0.78], [1.38, 0.86], [1.2, 0.86], [1.12, 0.78], [1.12, 0.12]].map(([r, y]) => new THREE.Vector2(r, y));
  b.add('sand', new THREE.LatheGeometry(prof, 30, gap / 2, Math.PI * 2 - gap));
  // bucket ridges around the outside
  for (const y of [0.32, 0.58]) {
    const ridge = new THREE.TorusGeometry(1.52, 0.035, 5, 40, Math.PI * 2 - gap - 0.1);
    ridge.rotateX(Math.PI / 2);
    ridge.rotateY(-(Math.PI / 2 + gap / 2 + 0.05));
    b.add('sand', b.at(ridge, 0, y, 0));
  }
  // sluice: two driftwood posts, a crossbar and a little spillway
  for (const x of [-0.42, 0.42]) b.add('wood', b.at(stick(1.25, 0.06), x, 0.1, 1.33), 0xb79a72);
  b.add('wood', b.at(plank(1.05, 0.1, 0.09), 0, 1.3, 1.33), 0xc9b08a);
  b.add('sand', b.at(sandBox(0.72, 0.1, 0.9, 0.08), 0, 0.1, 1.8));
  // a lever and a coil of seaweed rope
  b.add('wood', b.at(stick(0.9, 0.03), 0.75, 0.15, 1.5, 0, 0, -0.5), 0x9a7a52);
  const coil = new THREE.TorusGeometry(0.16, 0.05, 6, 14);
  coil.rotateX(Math.PI / 2);
  b.add('cloth', b.at(coil, -0.85, 0.2, 1.45), 0x5d8a3a);
  // shells pressed into the rim
  for (let i = 0; i < 16; i++) {
    const a = gap / 2 + 0.15 + (i / 15) * (Math.PI * 2 - gap - 0.3);
    shellAccent(b, 'shell', Math.sin(a) * 1.3, 0.88, Math.cos(a) * 1.3, a, 0.16 + rng() * 0.05, i % 3 ? 'scallop' : 'clam', [0xfbeee0, 0xf6c6a8, 0xf2a37c][i % 3], -Math.PI / 2);
  }
  b.circle(0, 0, 1.5, 0.86);
  b.slots.gate = { x: 0, z: 2.05 };
  b.slots.door = { x: 1.7, z: 1.3 };
  b.slots.interior = { x: 0, y: 0.15, z: 0, r: 0.6 };
  return b.build();
}

export function bucketStackGeometry(level) {
  const r = 0.62 * Math.pow(0.78, level);
  return prep(bucketTower(r, 0.8, { ridges: 2, merlons: 6, taper: 0.8 }));
}

export const MODEL_BUILDERS = {
  bucket: bucketModel,
  keep: keepModel,
  camp: campModel,
  house: houseModel,
  barracks: barracksModel,
  tower: towerModel,
  wall: () => wallModel(2.0),
  cannon: cannonModel,
  catapult: catapultModel,
  shelter: shelterModel,
  bridge: () => bridgeModel(4.2),
  trap: trapModel,
  stable: stableModel,
  roost: roostModel,
  reservoir: reservoirModel,
};
