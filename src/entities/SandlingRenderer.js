// Instanced rendering of all sandlings, their gear and severed limbs.
import * as THREE from 'three';
import { InstancedLayer, makeSandBodyMaterial } from './InstancedLayer.js';
import * as G from './unitGeometry.js';
import { J } from './Sandling.js';
import { clamp, smoothstep, lerp } from '../core/math.js';

const MAXU = 420;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
const UP = new THREE.Vector3(), LEFT = new THREE.Vector3(), FWD = new THREE.Vector3(), MID = new THREE.Vector3();
const HUP = new THREE.Vector3(), HLEFT = new THREE.Vector3(), HFWD = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const Y = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const WHITE = new THREE.Color(1, 1, 1);

function basisMatrix(out, left, up, fwd, pos, sx, sy = sx, sz = sx) {
  out.makeBasis(left, up, fwd);
  const e = out.elements;
  e[0] *= sx; e[1] *= sx; e[2] *= sx;
  e[4] *= sy; e[5] *= sy; e[6] *= sy;
  e[8] *= sz; e[9] *= sz; e[10] *= sz;
  e[12] = pos.x; e[13] = pos.y; e[14] = pos.z;
  return out;
}

// Orient a limb mesh (modelled from y=0 down to y=-geoLen) from a to b.
function segmentMatrix(out, a, b, geoLen, s) {
  D.subVectors(b, a);
  const len = D.length() || 1e-4;
  D.divideScalar(len);
  _q.setFromUnitVectors(DOWN, D);
  _s.set(s, len / geoLen, s);
  out.compose(a, _q, _s);
  return out;
}
const FH = new THREE.Vector3(), LH = new THREE.Vector3(), E = new THREE.Vector3(), TMP = new THREE.Vector3();
const TILT = new THREE.Matrix4().makeRotationZ(0.12);

export class SandlingRenderer {
  constructor(scene) {
    const root = (this.root = new THREE.Group());
    scene.add(root);
    const sand = (this.sandMat = makeSandBodyMaterial({}));
    const L = (geo, mat, max = MAXU, opts = {}) => new InstancedLayer(root, geo, mat, max, opts);
    this.head = L(G.headGeometry(), sand, MAXU + 60, { fx: true });
    this.torso = L(G.torsoGeometry(), sand, MAXU, { fx: true });
    this.armLen = 0.235;
    this.legLen = 0.205;
    this.arm = L(G.limbGeometry(0.05, this.armLen, 0.058), sand, MAXU * 2 + 60, { fx: true });
    this.leg = L(G.limbGeometry(0.062, this.legLen, 0.06), sand, MAXU * 2 + 60, { fx: true });
    this.foot = L(G.footGeometry(), sand, MAXU * 2, { fx: true });
    this.mount = L(G.mountGeometry(), sand, 80, { fx: true });
    this.mountLeg = L(G.horseLegGeometry(), sand, 320, { fx: true });
    this.mane = L(G.maneGeometry(), new THREE.MeshStandardMaterial({ color: 0x4f7a36, roughness: 0.7 }), 80, { colors: false });

    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 0.18, metalness: 0 });
    this.eye = L(G.eyeGeometry(), eyeMat, MAXU * 2 + 120, { colors: false, cast: false });
    this.deadEye = L(G.deadEyeGeometry(), eyeMat, MAXU * 2 + 120, { colors: false, cast: false });
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x4a2418, roughness: 0.6 });
    this.mouth = L(G.mouthGeometry(), mouthMat, MAXU, { colors: false, cast: false });
    this.stump = L(G.stumpGeometry(), makeSandBodyMaterial({ stump: true, rim: 0 }), MAXU * 2, { fx: true, cast: false });

    const plastic = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0 });
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x6aa83f, roughness: 0.6, side: THREE.DoubleSide });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc94a, roughness: 0.16, metalness: 1, emissive: 0x3a2400, emissiveIntensity: 0.4 });
    const gem = new THREE.MeshStandardMaterial({ color: 0xe8fbff, roughness: 0.02, metalness: 0.1, emissive: 0x9fe8ff, emissiveIntensity: 1.6 });
    const wood = new THREE.MeshStandardMaterial({ color: 0xd8b98a, roughness: 0.75 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.75 });
    this.bucketHat = L(G.bucketHatGeometry(), plastic, MAXU);
    this.helmet = L(G.helmetGeometry(), shellMat, MAXU);
    this.leafHat = L(G.leafHatGeometry(), leafMat, MAXU, { colors: false });
    this.band = L(G.bandGeometry(), plastic, MAXU);
    this.crown = L(G.crownGeometry(), gold, 16, { colors: false });
    this.diamond = L(G.diamondGeometry(), gem, 16, { colors: false, cast: false });
    this.sword = L(G.swordGeometry(), plastic, MAXU);
    this.shield = L(G.shieldGeometry(), capMat, MAXU);
    this.bow = L(G.bowGeometry(), wood, MAXU, { colors: false });
    this.spear = L(G.spearGeometry(), wood, MAXU, { colors: false });
    this.scepter = L(G.scepterGeometry(), gold, 16, { colors: false });
    this.shovel = L(G.shovelGeometry(), plastic, MAXU);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.85, depthWrite: false });
    this.ring = L(G.selectionRingGeometry(), ringMat, MAXU, { colors: true, cast: false, receive: false, order: 3 });
    this.layers = [this.head, this.torso, this.arm, this.leg, this.foot, this.mount, this.mountLeg, this.mane, this.eye, this.deadEye, this.mouth, this.stump,
      this.bucketHat, this.helmet, this.leafHat, this.band, this.crown, this.diamond, this.sword, this.shield, this.bow, this.spear, this.scepter, this.shovel, this.ring];
    this.swordColors = [0xff5d8f, 0x3fd3c4, 0xffc23d, 0x8a7dff];
    this.shieldColors = [0xd8342c, 0x2e6fd8, 0xe8b630, 0x3aa35a];
  }

  update(units, limbs, V, time) {
    for (const l of this.layers) l.begin();
    for (const u of units) {
      if (!u.p.length) continue;
      this._unit(u, V, time);
    }
    for (const l of limbs.list) this._limb(l, V);
    for (const l of this.layers) l.end();
  }

  _unit(u, V, time) {
    const P = u.p;
    const s = u.scale;
    const pel = P[J.PELVIS], lsh = P[J.LSH], rsh = P[J.RSH];
    A.set(V.px[pel], V.py[pel], V.pz[pel]);
    B.set(V.px[lsh], V.py[lsh], V.pz[lsh]);
    C.set(V.px[rsh], V.py[rsh], V.pz[rsh]);
    MID.addVectors(B, C).multiplyScalar(0.5);
    UP.subVectors(MID, A).normalize();
    LEFT.subVectors(B, C);
    LEFT.addScaledVector(UP, -LEFT.dot(UP)).normalize();
    FWD.crossVectors(LEFT, UP);
    const wet = u.wet, fl = u.flash;
    const col = u.color;

    // mount (cavalry)
    if (u.mounted && u.alive) {
      _p.set(u.pos.x, u.pos.y, u.pos.z);
      FH.set(Math.sin(u.yaw), 0, Math.cos(u.yaw));
      LH.set(FH.z, 0, -FH.x);
      const gal = u.phase * Math.PI * 2;
      const moving = (u.speed || 0) > 0.3;
      _p.y += moving ? Math.abs(Math.sin(gal)) * 0.06 : 0;
      const ms = s * 1.1;
      basisMatrix(_m, LH, Y, FH, _p, ms);
      const mcol = _c.copy(col).multiplyScalar(0.92);
      this.mount.push(_m, mcol, wet, fl);
      this.mane.push(_m);
      // galloping legs swing about the hips
      const legs = [[0.11, 0.27, 0], [-0.11, 0.27, 0.5], [0.11, -0.28, 0.75], [-0.11, -0.28, 0.25]];
      for (const [lx, lz, off] of legs) {
        const swing = moving ? Math.sin(gal + off * Math.PI * 2) * 0.6 : 0;
        const hip = TMP.copy(_p).addScaledVector(LH, lx * ms).addScaledVector(FH, lz * ms).addScaledVector(Y, 0.42 * ms);
        _q.setFromAxisAngle(LH, swing);
        _m.makeBasis(LH, Y, FH).premultiply(new THREE.Matrix4().makeRotationFromQuaternion(_q));
        _m.scale(_s.setScalar(ms)).setPosition(hip);
        this.mountLeg.push(_m, mcol, wet, fl);
      }
    }

    basisMatrix(_m, LEFT, UP, FWD, A, s);
    this.torso.push(_m, col, wet, fl);

    // head
    const hi = P[J.HEAD];
    const hs = s * u.headScale;
    if (hi >= 0) {
      D.set(V.px[hi], V.py[hi], V.pz[hi]);
      HUP.subVectors(D, MID).normalize().add(UP).normalize();
      HLEFT.copy(LEFT).addScaledVector(HUP, -LEFT.dot(HUP)).normalize();
      HFWD.crossVectors(HLEFT, HUP);
      basisMatrix(_m, HLEFT, HUP, HFWD, D, hs);
      this.head.push(_m, col, wet, fl);
      this._face(u, D, hs, time);
      this._hat(u, D, hs, time);
    } else {
      // neck stump
      _q.setFromUnitVectors(Y, UP);
      _p.copy(MID).addScaledVector(UP, 0.05 * s);
      _m.compose(_p, _q, _s.set(s * 1.2, s, s * 1.2));
      this.stump.push(_m, null, wet, 0);
    }

    // arms
    for (const [ji, jh, part] of [[J.LSH, J.LHAND, 'larm'], [J.RSH, J.RHAND, 'rarm']]) {
      const a = P[ji];
      B.set(V.px[a], V.py[a], V.pz[a]);
      if (u.limbs[part] && P[jh] >= 0) {
        const h = P[jh];
        C.set(V.px[h], V.py[h], V.pz[h]);
        segmentMatrix(_m, B, C, this.armLen, s);
        this.arm.push(_m, col, wet, fl);
      } else {
        _q.setFromUnitVectors(Y, TMP.copy(LEFT).multiplyScalar(part === 'larm' ? 1 : -1));
        _m.compose(B, _q, _s.set(s * 0.8, s, s * 0.8));
        this.stump.push(_m, null, wet, 0);
      }
    }
    // legs + feet
    FH.copy(FWD).setY(0);
    if (FH.lengthSq() > 0.01) FH.normalize(); else FH.set(Math.sin(u.yaw), 0, Math.cos(u.yaw));
    LH.set(FH.z, 0, -FH.x);
    if (!u.mounted || !u.alive) {
      for (const [jf, side, part] of [[J.LFOOT, 1, 'lleg'], [J.RFOOT, -1, 'rleg']]) {
        B.copy(A).addScaledVector(LEFT, 0.08 * s * side).addScaledVector(UP, -0.03 * s);
        if (u.limbs[part] && P[jf] >= 0) {
          const f = P[jf];
          C.set(V.px[f], V.py[f], V.pz[f]);
          segmentMatrix(_m, B, C, this.legLen, s);
          this.leg.push(_m, col, wet, fl);
          basisMatrix(_m, LH, Y, FH, C, s);
          this.foot.push(_m, col, wet, fl);
        } else {
          _q.setFromUnitVectors(Y, DOWN);
          _m.compose(B, _q, _s.set(s * 0.9, s, s * 0.9));
          this.stump.push(_m, null, wet, 0);
        }
      }
    }

    // gear
    this._gear(u, V, s, time);

    if (u.selected && u.alive) {
      _p.set(u.pos.x, u.pos.y + 0.04, u.pos.z);
      _m.compose(_p, _q.identity(), _s.setScalar(s * (u.mounted ? 1.7 : 1)));
      this.ring.push(_m, _c.set(u.possessed ? 0x7cf3ff : 0xfff1b0));
    }
  }

  _face(u, head, hs, time) {
    const dead = !u.alive;
    const panic = u.panic > 0 || u.swim > 0.4;
    for (const side of [1, -1]) {
      _p.copy(head).addScaledVector(HFWD, 0.165 * hs).addScaledVector(HUP, 0.03 * hs).addScaledVector(HLEFT, 0.066 * hs * side);
      if (dead) {
        basisMatrix(_m, HLEFT, HUP, HFWD, _p, hs);
        this.deadEye.push(_m);
      } else {
        const blink = u.blink > 0 ? 0.15 : 1;
        const big = panic ? 1.35 : 1;
        basisMatrix(_m, HLEFT, HUP, HFWD, _p, hs * big, hs * big * blink, hs * 0.6);
        this.eye.push(_m);
      }
    }
    if (u.shout > 0 && !dead) {
      _p.copy(head).addScaledVector(HFWD, 0.172 * hs).addScaledVector(HUP, -0.06 * hs);
      const o = clamp(u.shout * 2, 0.4, 1);
      basisMatrix(_m, HLEFT, HUP, HFWD, _p, hs * o, hs * o * (0.8 + 0.3 * Math.sin(time * 30)), hs);
      this.mouth.push(_m);
    }
  }

  _hat(u, head, hs, time) {
    const hat = u.def.hat;
    _p.copy(head).addScaledVector(HUP, 0.155 * hs);
    if (hat === 'bucket') {
      _p.addScaledVector(HUP, 0.02 * hs);
      basisMatrix(_m, HLEFT, HUP, HFWD, _p, hs);
      this.bucketHat.push(_m, u.hatColor);
    } else if (hat === 'helmet') {
      _p.addScaledVector(HUP, -0.06 * hs);
      basisMatrix(_m, HLEFT, HUP, HFWD, _p, hs);
      this.helmet.push(_m, _c.set(0xf7e2d3));
    } else if (hat === 'leaf') {
      _p.addScaledVector(HUP, -0.02 * hs);
      basisMatrix(_m, HLEFT, HUP, HFWD, _p, hs);
      this.leafHat.push(_m);
    } else if (hat === 'band') {
      _p.addScaledVector(HUP, -0.07 * hs);
      basisMatrix(_m, HLEFT, HUP, HFWD, _p, hs);
      this.band.push(_m, _c.set(0xd8442c));
    } else if (hat === 'crown' && !u.crownHidden) {
      _p.addScaledVector(HUP, -0.03 * hs);
      // the oversized ring sits slightly crooked
      basisMatrix(_m, HLEFT, HUP, HFWD, _p, hs * 1.15).multiply(TILT);
      this.crown.push(_m);
      this.diamond.push(_m);
    }
  }

  _gear(u, V, s, time) {
    const P = u.p;
    const w = u.def.weapon;
    const rh = P[J.RHAND], lh = P[J.LHAND];
    const rsh = P[J.RSH];
    const isDig = u.anim === 'dig' && u.alive;
    if (isDig && rh >= 0 && lh >= 0) {
      A.set(V.px[rh], V.py[rh], V.pz[rh]);
      B.set(V.px[lh], V.py[lh], V.pz[lh]);
      TMP.addVectors(A, B).multiplyScalar(0.5);
      D.copy(FH).multiplyScalar(0.55).addScaledVector(Y, -0.85).normalize().negate();
      _q.setFromUnitVectors(Y, D);
      _m.compose(TMP, _q, _s.setScalar(s));
      this.shovel.push(_m, _c.set(0xff7a3a));
    }
    if (u.carry && u.carryMode) return;
    if (w && rh >= 0 && u.limbs.rarm && !isDig) {
      A.set(V.px[rh], V.py[rh], V.pz[rh]);
      // blade pitch from the swing phase for readable arcs
      let pitch = 0.35;
      if (u.attackT >= 0 && u.alive) {
        const at = u.attackT;
        const wind = smoothstep(0, 0.4, at), strike = smoothstep(0.4, 0.55, at), rec = smoothstep(0.6, 1, at);
        pitch = lerp(lerp(0.35, 2.5, wind), -0.45, strike);
        pitch = lerp(pitch, 0.35, rec);
      }
      if (!u.alive || u.knocked > 0) {
        B.set(V.px[rsh], V.py[rsh], V.pz[rsh]);
        D.subVectors(A, B).normalize();
      } else {
        D.copy(FH).multiplyScalar(Math.cos(pitch)).addScaledVector(UP, Math.sin(pitch)).normalize();
      }
      _q.setFromUnitVectors(Y, D);
      if (w === 'sword') {
        _m.compose(A, _q, _s.setScalar(s));
        this.sword.push(_m, _c.set(this.swordColors[u.id % 4]));
      } else if (w === 'spear') {
        if (u.alive && u.attackT < 0) D.copy(FH).multiplyScalar(0.55).addScaledVector(UP, 0.8).normalize();
        else if (u.alive) D.copy(FH).multiplyScalar(Math.cos(Math.min(pitch, 0.6))).addScaledVector(UP, Math.sin(Math.min(pitch, 0.6) * 0.5)).normalize();
        _q.setFromUnitVectors(Y, D);
        _m.compose(A, _q, _s.setScalar(s));
        this.spear.push(_m);
      } else if (w === 'scepter') {
        if (u.alive && u.attackT < 0) D.copy(UP).multiplyScalar(0.9).addScaledVector(FH, 0.3).normalize();
        _q.setFromUnitVectors(Y, D);
        _m.compose(A, _q, _s.setScalar(s));
        this.scepter.push(_m);
      }
    }
    if (lh >= 0 && u.limbs.larm) {
      B.set(V.px[lh], V.py[lh], V.pz[lh]);
      if (w === 'bow') {
        _p.copy(B).addScaledVector(FWD, 0.02 * s);
        basisMatrix(_m, LEFT, UP, FWD, _p, s);
        this.bow.push(_m);
      }
      if (u.def.shield) {
        _p.copy(B).addScaledVector(FWD, 0.05 * s);
        basisMatrix(_m, LEFT, UP, FWD, _p, s);
        this.shield.push(_m, _c.set(this.shieldColors[u.id % 4]));
      }
    }
  }

  _limb(l, V) {
    const s = l.scale;
    const wet = l.owner ? l.owner.wet : 0;
    if (l.kind === 'head') {
      if (!(V.flags[l.a] & 1)) return;
      D.set(V.px[l.a], V.py[l.a], V.pz[l.a]);
      _m.compose(D, l.quat, _s.setScalar(s));
      this.head.push(_m, l.color, wet, 0);
      // X eyes on the rolling head
      for (const side of [1, -1]) {
        E.set(0.066 * side, 0.03, 0.165).multiplyScalar(s).applyQuaternion(l.quat).add(D);
        _m.compose(E, l.quat, _s.setScalar(s));
        this.deadEye.push(_m);
      }
      if (l.hat === 'crown') {
        E.set(0, 0.125, 0).multiplyScalar(s).applyQuaternion(l.quat).add(D);
        _m.compose(E, l.quat, _s.setScalar(s * 1.15));
        this.crown.push(_m);
        this.diamond.push(_m);
      } else if (l.hat === 'bucket') {
        E.set(0, 0.175, 0).multiplyScalar(s).applyQuaternion(l.quat).add(D);
        _m.compose(E, l.quat, _s.setScalar(s));
        this.bucketHat.push(_m, l.hatColor);
      }
      return;
    }
    if (!(V.flags[l.a] & 1) || !(V.flags[l.b] & 1)) return;
    A.set(V.px[l.a], V.py[l.a], V.pz[l.a]);
    B.set(V.px[l.b], V.py[l.b], V.pz[l.b]);
    if (l.kind === 'arm') {
      segmentMatrix(_m, A, B, this.armLen, s);
      this.arm.push(_m, l.color, wet, 0);
    } else {
      segmentMatrix(_m, A, B, this.legLen, s);
      this.leg.push(_m, l.color, wet, 0);
    }
    // stump at the torn end
    D.subVectors(A, B).normalize();
    _q.setFromUnitVectors(Y, D);
    _m.compose(A, _q, _s.set(s * 0.8, s, s * 0.8));
    this.stump.push(_m, null, wet, 0);
  }
}
