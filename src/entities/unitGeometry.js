// Geometry for sandling body parts and their (beach-scavenged) gear.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function strip(g) {
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function colorize(g, hex) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function merge(list) {
  const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)));
  g.computeVertexNormals();
  return g;
}

export function headGeometry() {
  const g = strip(new THREE.SphereGeometry(0.19, 22, 16));
  g.scale(1.02, 0.95, 0.97);
  return g;
}

export function torsoGeometry() {
  // egg profile from below the pelvis to the neck (local y up)
  const pts = [];
  const prof = [[0.0, -0.1], [0.1, -0.095], [0.145, -0.05], [0.158, 0.03], [0.155, 0.12], [0.142, 0.2], [0.118, 0.26], [0.08, 0.3], [0.035, 0.32], [0.0, 0.325]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const g = strip(new THREE.LatheGeometry(pts, 20));
  g.scale(1.05, 1, 0.9);
  return g;
}

// capsule from y=0 down to y=-len
export function limbGeometry(radius, len, tipRadius = radius) {
  // rounded top cap at the joint, rounded tip (hand / foot end) at -len
  const seg = 6;
  const prof = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    prof.push(new THREE.Vector2(Math.sin(a) * radius, Math.cos(a) * radius * 0.6));
  }
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI / 2 + (i / seg) * (Math.PI / 2);
    prof.push(new THREE.Vector2(Math.sin(a) * tipRadius, -len + Math.cos(a) * tipRadius));
  }
  prof.reverse();
  return strip(new THREE.LatheGeometry(prof, 10));
}

export function footGeometry() {
  const g = strip(new THREE.SphereGeometry(0.075, 12, 8));
  g.scale(0.85, 0.55, 1.25);
  g.translate(0, -0.02, 0.03);
  return g;
}

export function eyeGeometry() {
  return strip(new THREE.SphereGeometry(0.03, 10, 8));
}

export function deadEyeGeometry() {
  const a = strip(new THREE.BoxGeometry(0.075, 0.016, 0.016));
  a.rotateZ(Math.PI / 4);
  const b = strip(new THREE.BoxGeometry(0.075, 0.016, 0.016));
  b.rotateZ(-Math.PI / 4);
  return merge([a, b]);
}

export function mouthGeometry() {
  const g = strip(new THREE.SphereGeometry(0.04, 10, 6));
  g.scale(1, 0.8, 0.35);
  return g;
}

export function stumpGeometry() {
  const g = strip(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 14));
  return g;
}

export function selectionRingGeometry() {
  const g = strip(new THREE.RingGeometry(0.32, 0.4, 32));
  g.rotateX(-Math.PI / 2);
  return g;
}

// ---- hats -------------------------------------------------------------------
export function bucketHatGeometry() {
  // an upside-down beach bucket (opening down) with a handle
  const body = strip(new THREE.CylinderGeometry(0.1, 0.15, 0.17, 18, 1, true));
  const top = strip(new THREE.CircleGeometry(0.1, 18));
  top.rotateX(-Math.PI / 2);
  top.translate(0, 0.085, 0);
  const rim = strip(new THREE.TorusGeometry(0.15, 0.012, 6, 20));
  rim.rotateX(Math.PI / 2);
  rim.translate(0, -0.085, 0);
  const handle = strip(new THREE.TorusGeometry(0.13, 0.008, 5, 16, Math.PI));
  handle.rotateZ(Math.PI);
  handle.translate(0, -0.02, 0);
  const g = merge([body, top, rim, handle]);
  g.translate(0, 0.06, 0);
  return g;
}

export function helmetGeometry() {
  // scallop shell helmet
  const g = strip(new THREE.SphereGeometry(0.215, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.5));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
    const a = Math.atan2(z, x);
    const rib = 1 + 0.07 * Math.pow(Math.abs(Math.sin(a * 8)), 0.6) * (y / 0.215 + 0.2);
    p.setXYZ(i, x * rib, y * 1.05, z * rib);
  }
  const brim = strip(new THREE.TorusGeometry(0.21, 0.018, 6, 28));
  brim.rotateX(Math.PI / 2);
  const crest = strip(new THREE.ConeGeometry(0.03, 0.12, 6));
  crest.translate(0, 0.27, 0);
  const out = merge([g, brim, crest]);
  out.translate(0, -0.035, 0);
  return out;
}

export function leafHatGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.3);
  shape.quadraticCurveTo(0.2, -0.1, 0, 0.3);
  shape.quadraticCurveTo(-0.2, -0.1, 0, -0.3);
  const g = strip(new THREE.ShapeGeometry(shape, 8));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setXYZ(i, x * 1.2, -(x * x) * 3.5 - (y * y) * 1.2 + 0.06, y);
  }
  g.rotateY(Math.PI * 0.15);
  const stem = strip(new THREE.CylinderGeometry(0.008, 0.01, 0.12, 4));
  stem.rotateX(Math.PI / 2.5);
  stem.translate(0, 0.08, -0.32);
  const out = merge([g, stem]);
  return out;
}

export function bandGeometry() {
  const ring = strip(new THREE.TorusGeometry(0.185, 0.022, 6, 24));
  ring.rotateX(Math.PI / 2);
  const feather = strip(new THREE.ConeGeometry(0.035, 0.28, 5));
  feather.rotateZ(-0.35);
  feather.translate(-0.12, 0.13, -0.08);
  return merge([ring, feather]);
}

export function crownGeometry() {
  // a gold wedding ring worn as a crown, with a big diamond
  const ring = strip(new THREE.TorusGeometry(0.17, 0.05, 14, 40));
  ring.rotateX(Math.PI / 2);
  const setting = strip(new THREE.CylinderGeometry(0.05, 0.03, 0.06, 8));
  setting.translate(0, 0.0, 0.21);
  setting.rotateX(0);
  const g = merge([ring, setting]);
  return g;
}

export function diamondGeometry() {
  const g = strip(new THREE.OctahedronGeometry(0.07, 0));
  g.scale(1, 1.25, 1);
  g.translate(0, 0.05, 0.22);
  return g;
}

// ---- weapons / tools (held along local +y from the grip) -----------------------
export function swordGeometry() {
  // a plastic cocktail-pick sword
  const blade = strip(new THREE.BoxGeometry(0.035, 0.42, 0.012));
  blade.translate(0, 0.27, 0);
  const tip = strip(new THREE.ConeGeometry(0.025, 0.07, 4));
  tip.translate(0, 0.515, 0);
  const guard = strip(new THREE.BoxGeometry(0.12, 0.022, 0.03));
  guard.translate(0, 0.06, 0);
  const grip = strip(new THREE.CylinderGeometry(0.014, 0.014, 0.11, 6));
  grip.translate(0, 0.0, 0);
  const pommel = strip(new THREE.SphereGeometry(0.024, 8, 6));
  pommel.translate(0, -0.06, 0);
  return merge([blade, tip, guard, grip, pommel]);
}

export function shieldGeometry() {
  // a red bottle cap with a crimped edge (faces local +z)
  const pts = [];
  for (let i = 0; i <= 42; i++) {
    const a = (i / 42) * Math.PI * 2;
    const r = 0.15 + (i % 2 === 0 ? 0.012 : 0);
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const shape = new THREE.Shape(pts);
  const g = strip(new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.008, bevelSegments: 1 }));
  g.translate(0, 0, -0.02);
  return g;
}

export function bowGeometry() {
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, 0, 0.16), new THREE.Vector3(0, 0.3, 0));
  const limb = strip(new THREE.TubeGeometry(curve, 12, 0.013, 5, false));
  const string = strip(new THREE.CylinderGeometry(0.003, 0.003, 0.6, 3));
  return merge([limb, string]);
}

export function spearGeometry() {
  const shaft = strip(new THREE.CylinderGeometry(0.014, 0.016, 0.95, 6));
  shaft.translate(0, 0.2, 0);
  const tip = strip(new THREE.ConeGeometry(0.04, 0.14, 4));
  tip.translate(0, 0.74, 0);
  return merge([shaft, tip]);
}

export function scepterGeometry() {
  const stick = strip(new THREE.BoxGeometry(0.03, 0.5, 0.012));
  stick.translate(0, 0.15, 0);
  const orb = strip(new THREE.IcosahedronGeometry(0.05, 0));
  orb.translate(0, 0.42, 0);
  return merge([stick, orb]);
}

export function shovelGeometry() {
  const handle = strip(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 6));
  handle.translate(0, 0.1, 0);
  const grip = strip(new THREE.BoxGeometry(0.08, 0.02, 0.02));
  grip.translate(0, 0.31, 0);
  const blade = strip(new THREE.SphereGeometry(0.08, 10, 6, 0, Math.PI, 0, Math.PI * 0.6));
  blade.scale(0.9, 1.3, 0.5);
  blade.rotateX(Math.PI);
  blade.translate(0, -0.13, 0);
  return merge([handle, grip, blade]);
}

export function mountGeometry() {
  // a sand-sculpted horse (local: y up, z forward); legs are separate
  const body = strip(new THREE.SphereGeometry(0.25, 18, 12));
  body.scale(0.9, 0.95, 1.7);
  body.translate(0, 0.5, -0.02);
  const chest = strip(new THREE.SphereGeometry(0.21, 14, 10));
  chest.translate(0, 0.53, 0.26);
  const rump = strip(new THREE.SphereGeometry(0.21, 14, 10));
  rump.translate(0, 0.54, -0.3);
  const neck = strip(new THREE.CylinderGeometry(0.085, 0.13, 0.42, 10));
  neck.rotateX(0.62);
  neck.translate(0, 0.72, 0.42);
  const head = strip(new THREE.SphereGeometry(0.1, 12, 10));
  head.scale(0.85, 0.95, 1.9);
  head.rotateX(0.55);
  head.translate(0, 0.9, 0.6);
  const muzzle = strip(new THREE.SphereGeometry(0.075, 10, 8));
  muzzle.translate(0, 0.8, 0.74);
  const ears = [];
  for (const x of [-0.045, 0.045]) {
    const e = strip(new THREE.ConeGeometry(0.03, 0.09, 6));
    e.translate(x, 1.0, 0.5);
    ears.push(e);
  }
  return merge([body, chest, rump, neck, head, muzzle, ...ears]);
}

export function maneGeometry() {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const g = strip(new THREE.BoxGeometry(0.035, 0.12, 0.07));
    g.rotateX(0.62);
    g.translate(0, 0.62 + t * 0.32 + 0.06, 0.3 + t * 0.26 - 0.03);
    parts.push(g);
  }
  const tail = strip(new THREE.ConeGeometry(0.07, 0.42, 6));
  tail.rotateX(-2.5);
  tail.translate(0, 0.42, -0.58);
  parts.push(tail);
  return merge(parts);
}

export function horseLegGeometry() {
  // from the hip (y=0) down to the hoof (y=-0.42)
  const leg = strip(new THREE.CylinderGeometry(0.045, 0.06, 0.38, 7));
  leg.translate(0, -0.19, 0);
  const hoof = strip(new THREE.CylinderGeometry(0.05, 0.055, 0.06, 7));
  hoof.translate(0, -0.4, 0.005);
  return merge([leg, hoof]);
}

export { colorize, merge, mergeVertices };
