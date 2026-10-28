// Enemy manager: spawning, AI, severed parts and instanced rendering.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Crab, CRAB_TYPES, LEG_HIPS, mkFrame } from './Crab.js';
import { InstancedLayer } from './InstancedLayer.js';
import { clamp, damp, rnd, pick, smoothstep, lerp } from '../core/math.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const _c = new THREE.Color();
const _footTmp = new THREE.Vector3();
const _toast = new THREE.Color();
const _burnt = new THREE.Color(0x3a1a0e);

// ---------------------------------------------------------------------------------
class EnemyAI {
  constructor(game) { this.game = game; }

  emerge(c, dt) {
    const game = this.game;
    if (c.stateT < 0.05 && !c._splashed) {
      c._splashed = true;
      game.particles.splash(c.pos.x, game.sim.surfaceAt(c.pos.x, c.pos.z), c.pos.z, 18 * c.size, 1 + c.size * 0.3);
      game.events.emit('crabEmerge', c);
    }
    c.vel.x = damp(c.vel.x, Math.sin(c.yaw) * 0.8, 4, dt);
    c.vel.z = damp(c.vel.z, Math.cos(c.yaw) * 0.8, 4, dt);
    if (c.stateT > 1.15) {
      c.state = 'warcry';
      c.stateT = 0;
      c.shout = 1;
      game.events.emit('crabWarcry', c);
      // shake off water
      game.particles.splash(c.pos.x, c.pos.y + c.height, c.pos.z, 10, 0.6);
    }
  }

  pickTarget(c) {
    const game = this.game;
    let best = null, bd = c.def.siege ? 3 : 5.5;
    // nearby sandlings
    if (!c.def.siege || Math.random() < 0.4) {
      game.spatial.query(c.pos.x, c.pos.z, bd + 1, (o) => {
        if (o.kind !== 'unit' || !o.alive || o.hidden || o.garrisoned) return;
        const d = Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z);
        if (d < bd) { bd = d; best = o; }
      });
    }
    if (best) return best;
    const king = game.king;
    if (king && king.alive && Math.hypot(king.pos.x - c.pos.x, king.pos.z - c.pos.z) < 7) return king;
    // buildings close by (siege crabs look further)
    let bb = null, bbd = c.def.siege ? 10 : 2.6;
    for (const b of game.buildings.list) {
      if (!b.alive || b.type === 'trap' || b.type === 'bridge') continue;
      const d = Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z) - b.radius;
      if (d < bbd) { bbd = d; bb = b; }
    }
    if (bb) return bb;
    if (game.keep && game.keep.alive) return game.keep;
    if (king && king.alive) return king;
    // otherwise nearest unit anywhere
    let nu = null, nd = Infinity;
    for (const u of game.units) {
      if (!u.alive || u.hidden) continue;
      const d = u.pos.distanceTo(c.pos);
      if (d < nd) { nd = d; nu = u; }
    }
    return nu;
  }

  think(c, dt) {
    const game = this.game;
    if (c.state === 'warcry') {
      c.vel.multiplyScalar(0.85);
      if (c.stateT > 0.8) { c.state = 'walk'; c.stateT = 0; }
      return;
    }
    c.retarget = (c.retarget || 0) - dt;
    if (c.retarget <= 0 || !c.target || !c.target.alive || c.target.hidden) {
      c.retarget = rnd(0.6, 1.2);
      c.target = this.pickTarget(c);
    }
    const t = c.target;
    if (!t) { c.vel.multiplyScalar(0.9); return; }
    // point to approach
    let tx = t.pos.x, tz = t.pos.z, reach;
    if (t.kind === 'building') {
      const dx = c.pos.x - t.pos.x, dz = c.pos.z - t.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      tx = t.pos.x + (dx / d) * t.radius;
      tz = t.pos.z + (dz / d) * t.radius;
      reach = c.def.range * c.size * 0.55 + 0.35;
    } else {
      reach = c.def.range * Math.max(1, c.size * 0.6) + (t.radius || 0.3) * 0.5;
    }
    const dx = tx - c.pos.x, dz = tz - c.pos.z;
    const dist = Math.hypot(dx, dz);
    const faceYaw = Math.atan2(dx, dz);
    const speed = c.def.speed * c.speedMul * (game.sim.depthAt(c.pos.x, c.pos.z) > 0.4 ? 0.75 : 1);

    if (c.def.boss) this._bossAbilities(c, dt);

    // lobsters carry their catch then hurl it
    if (c.grabbed) {
      c.grabT = (c.grabT || 0) + dt;
      this._holdVictim(c);
      if (c.grabT > 1.4) this._throwVictim(c);
    }

    if (c.def.ranged && t.kind !== 'building' && dist < c.def.range && dist > 2) {
      c.goalYaw = faceYaw;
      c.vel.multiplyScalar(0.85);
      c.state = 'shoot';
      if (c.startAttack()) game.projectiles.bubble(c, t);
      return;
    }

    if (dist <= reach) {
      c.state = 'attack';
      c.goalYaw = faceYaw;
      c.vel.multiplyScalar(0.8);
      if (c.attackT < 0) c.startAttack();
      else if (c.attackT > 0.5 && !c.struck) {
        c.struck = true;
        this._strike(c, t, dx / (dist || 1), dz / (dist || 1));
      }
      return;
    }
    // walk: sideways when far, face the target when close
    c.state = dist < 4 ? 'chase' : 'walk';
    let mx = dx / dist, mz = dz / dist;
    const sep = game.separation(c, c.radius);
    mx += sep.x * 0.8; mz += sep.z * 0.8;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml; mz /= ml;
    c.vel.x = damp(c.vel.x, mx * speed, 5, dt);
    c.vel.z = damp(c.vel.z, mz * speed, 5, dt);
    if (dist < 4 || c.def.boss) c.goalYaw = faceYaw;
    else {
      // crabs walk sideways: put the side axis along the motion
      const a1 = Math.atan2(mx, mz) + Math.PI / 2, a2 = a1 - Math.PI;
      const d1 = Math.abs(Math.atan2(Math.sin(a1 - c.yaw), Math.cos(a1 - c.yaw)));
      const d2 = Math.abs(Math.atan2(Math.sin(a2 - c.yaw), Math.cos(a2 - c.yaw)));
      c.goalYaw = d1 < d2 ? a1 : a2;
    }
    // stuck against something? bash whatever building is in front
    const moved = Math.hypot(c.pos.x - c.lastPos.x, c.pos.z - c.lastPos.z);
    c.lastPos.set(c.pos.x, 0, c.pos.z);
    if (moved < speed * dt * 0.25) c.stuckT += dt; else c.stuckT = Math.max(0, c.stuckT - dt);
    if (c.stuckT > 0.9) {
      const blocker = game.buildings.list.find((b) => b.alive && b.registered && Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z) < b.radius + c.radius + 1.0);
      if (blocker) { c.target = blocker; c.retarget = 3; }
      c.stuckT = 0;
    }
  }

  _bossAbilities(c, dt) {
    const game = this.game;
    c.stompT = (c.stompT ?? 6) - dt;
    // reinforcements as he weakens
    const f = c.hp / c.maxHp;
    c.summoned = c.summoned || 0;
    if ((f < 0.66 && c.summoned < 1) || (f < 0.33 && c.summoned < 2)) {
      c.summoned++;
      c.state = 'warcry';
      c.stateT = 0;
      c.shout = 1.5;
      game.events.emit('crabWarcry', c);
      game.events.emit('bossSummon', c);
      for (let i = 0; i < 4 + game.director.wave / 5; i++) {
        const x = clamp(c.pos.x + rnd(-10, 10), -44, 44);
        let z = -14;
        for (let zz = -2; zz > -34; zz -= 0.4) if (game.sim.depthAt(x, zz) > 0.45) { z = zz; break; }
        game.enemyManager.spawn(Math.random() < 0.5 ? 'forker' : 'knifer', x, z, { emerge: true });
      }
    }
    if (c.stompT > 0 || c.attackT >= 0) return;
    // stomp when there is something worth stomping close by
    let near = 0;
    game.spatial.query(c.pos.x, c.pos.z, 6, (o) => { if (o.kind === 'unit' && o.alive) near++; });
    const bnear = game.buildings.list.some((b) => b.alive && Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z) < b.radius + 5);
    if (near >= 2 || bnear) {
      c.stompT = rnd(7, 10);
      c.stomping = 0.9;
      c.shout = 1;
      game.events.emit('bossWindup', c);
    }
  }

  _stomp(c) {
    const game = this.game, sim = game.sim;
    const R = 6.5;
    const cx = c.pos.x, cz = c.pos.z;
    for (const u of game.units) {
      if (!u.alive || !u.p.length || u.hidden) continue;
      const dx = u.pos.x - cx, dz = u.pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d > R) continue;
      const f = 1 - d / R;
      u.hit(16 * f + 3, (dx / (d || 1)) * 10 * f, 6 * f + 2, (dz / (d || 1)) * 10 * f, { knock: true, sever: f > 0.6 });
    }
    for (const b of game.buildings.list) {
      if (!b.alive) continue;
      const d = Math.hypot(b.pos.x - cx, b.pos.z - cz) - b.radius;
      if (d < R) b.damage(60 * (1 - Math.max(0, d) / R), 'crab', new THREE.Vector3(b.pos.x, b.baseY + 0.5, b.pos.z));
    }
    const res = sim.dig(cx, cz, 2.6, 0.35);
    game.particles.sandSpray(cx, sim.heightAt(cx, cz) + 0.2, cz, 0, 0, 60, res.vol, res.wet, 2.0);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      game.particles.dust(cx + Math.cos(a) * 2.5, sim.heightAt(cx, cz) + 0.2, cz + Math.sin(a) * 2.5, 1, 1.2);
    }
    if (sim.depthAt(cx, cz) > 0.1) game.particles.splash(cx, sim.surfaceAt(cx, cz), cz, 40, 2.2);
    game.rig.addShake(0.8);
    game.events.emit('bossStomp', c);
  }

  _strike(c, t, nx, nz) {
    const game = this.game;
    const dmg = c.def.dmg * c.dmgMul;
    const knock = c.def.knock || 5;
    if (c.def.boss) {
      // a sweeping trident: everything in the arc in front gets it
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      const reach = c.def.range * 1.15;
      for (const u of game.units) {
        if (!u.alive || !u.p.length || u.hidden) continue;
        const dx = u.pos.x - c.pos.x, dz = u.pos.z - c.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > reach || (dx * fx + dz * fz) / (d || 1) < -0.1) continue;
        u.hit(dmg * 0.8, (dx / (d || 1)) * knock + fx * 3, knock * 0.6 + 2, (dz / (d || 1)) * knock + fz * 3, { source: c, sever: true });
      }
      if (t.kind === 'building') t.damage(dmg * (c.def.siege || 1), 'crab', _v.set(c.pos.x + fx * reach * 0.8, t.baseY + 1, c.pos.z + fz * reach * 0.8));
      game.rig.addShake(0.3);
      game.events.emit('crabStrike', c, t);
      return;
    }
    if (t.kind === 'building') {
      const p = _v.set(c.pos.x + nx * c.radius * 1.6, t.baseY + Math.min(t.height * 0.4, 1.2), c.pos.z + nz * c.radius * 1.6);
      t.damage(dmg * (c.def.siege || 1), 'crab', p);
      game.events.emit('crabStrike', c, t);
      return;
    }
    const d = Math.hypot(t.pos.x - c.pos.x, t.pos.z - c.pos.z);
    if (d > c.def.range * Math.max(1, c.size * 0.6) + 0.8) return;
    if (c.def.grabber && !c.grabbed && t.kind === 'unit' && Math.random() < 0.55 && !t.held) {
      c.grabbed = t;
      c.grabT = 0;
      t.held = true;
      t.grabbedBy = c;
      t.knockDown(3);
      t.hit(dmg * 0.4, 0, 2, 0, { sever: false });
      game.events.emit('crabGrab', c, t);
      return;
    }
    const caps = game.economy.tech.caps && t.def && t.def.weapon ? 0.8 : 1;
    t.hit(dmg * caps, nx * knock, knock * 0.45 + 1, nz * knock, { source: c, joint: 3 });
    game.events.emit('crabStrike', c, t);
    // bosses shake the camera
    if (c.def.boss) game.rig.addShake(0.35);
  }

  _holdVictim(c) {
    const u = c.grabbed;
    if (!u || !u.alive || !u.p.length) { c.releaseGrab(); return; }
    const V = this.game.verlet;
    const ci = c.p[4] >= 0 ? c.p[4] : c.p[1];
    const hi = u.p[3] >= 0 ? u.p[3] : u.p[0];
    V.px[hi] += (V.px[ci] - V.px[hi]) * 0.5;
    V.py[hi] += (V.py[ci] + 0.2 - V.py[hi]) * 0.5;
    V.pz[hi] += (V.pz[ci] - V.pz[hi]) * 0.5;
    u.knocked = Math.max(u.knocked, 0.5);
    u.panic = 1;
  }

  _throwVictim(c) {
    const u = c.grabbed;
    c.releaseGrab();
    c.grabT = 0;
    if (!u) return;
    const b = c._basis();
    u.applyImpulse(b.fx * 9 + rnd(-2, 2), 6, b.fz * 9 + rnd(-2, 2));
    u.knockDown(2.5);
    u.thrownT = this.game.time;
    this.game.events.emit('crabThrow', c, u);
  }
}

// ---------------------------------------------------------------------------------
export class Enemies {
  constructor(game) {
    this.game = game;
    this.ai = new EnemyAI(game);
    this.parts = [];
    this._f = mkFrame();
    this._buildRender();
  }

  spawn(type, x, z, opts = {}) {
    const c = new Crab(this.game, type, x, z, opts);
    this.game.enemies.push(c);
    this.game.events.emit('enemySpawned', c);
    return c;
  }

  update(dt) {
    const game = this.game;
    const t = game.physTime;
    for (let i = game.enemies.length - 1; i >= 0; i--) {
      const c = game.enemies[i];
      c.preStep(dt, t);
      // fall / crush damage from being thrown
      if (c.alive && c.p.length) {
        const V = game.verlet;
        const imp = V.impact[c.p[2]];
        if (imp > 7 && !c.def.boss) { c.hit((imp - 6) * 6, 0, 0, 0, { fall: true }); V.impact[c.p[2]] = 0; }
      }
      if (!c.alive && c.deadTime > 3.2 && !c.removed) this._removeDead(c, i);
    }
    // sandlings take fall damage too (thrown by crabs or by the hand)
    for (const u of game.units) {
      if (!u.alive || !u.p.length) continue;
      const V = game.verlet;
      const imp = V.impact[u.p[0]];
      if (imp > 7.5) { u.hit((imp - 7) * 5, 0, 0, 0, { fall: true, sever: imp > 12 }); V.impact[u.p[0]] = 0; }
    }
    // flying parts
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
      const gy = game.sim.heightAt(p.pos.x, p.pos.z) + 0.05;
      if (p.pos.y < gy) {
        p.pos.y = gy;
        p.vel.y *= -0.3; p.vel.x *= 0.6; p.vel.z *= 0.6; p.spin.multiplyScalar(0.6);
      }
      if (p.life <= 0) this.parts.splice(i, 1);
    }
  }

  _removeDead(c, i) {
    const game = this.game;
    c.removed = true;
    const pos = c.centerPos(_v).clone();
    game.particles.foamBurst(pos.x, pos.y, pos.z, 6 + c.size * 4, 1);
    game.particles.splash(pos.x, pos.y, pos.z, 6, 0.5);
    // bounty: things the crab was hoarding pop out
    const b = c.def.bounty || {};
    const map = { shells: 'shell', pebbles: 'pebble', gems: 'gem', treasure: 'coin', seaweed: 'seaweed' };
    for (const k in b) {
      const n = Math.max(1, Math.round(b[k] * rnd(0.7, 1.3)));
      for (let j = 0; j < n; j++) {
        game.items.spawn(map[k], pos.x + rnd(-0.3, 0.3), pos.z + rnd(-0.3, 0.3), { y: pos.y + 0.3, vel: new THREE.Vector3(rnd(-2, 2), rnd(3, 5), rnd(-2, 2)) });
      }
    }
    c.destroyBody();
    game.enemies.splice(i, 1);
    game.events.emit('enemyRemoved', c);
  }

  flyingPart(kind, x, y, z, vx, vy, vz, size, color, weapon) {
    this.parts.push({ kind, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(vx, vy, vz), rot: new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)),
      spin: new THREE.Vector3(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12)), size, color: color.clone(), weapon, life: 7 });
  }

  // ---- rendering ----------------------------------------------------------------
  _buildRender() {
    const root = (this.root = new THREE.Group());
    this.game.scene.add(root);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0 });
    shellMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aFx;\nvarying vec2 vFx;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFx = aFx;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vFx;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.95, 0.9) * vFx.y * 0.8;');
    };
    shellMat.customProgramCacheKey = () => 'crabshell';
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x0d0a08, roughness: 0.12 });
    const rust = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.7 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc94a, roughness: 0.2, metalness: 1 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2e6fd8, roughness: 0.3, metalness: 0.7 });
    const canMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 0.9 });
    const L = (g, m, max, o = {}) => new InstancedLayer(root, g, m, max, o);
    const MAX = 260;
    this.L = {
      shell: L(carapaceGeometry(), shellMat, MAX, { fx: true }),
      belly: L(bellyGeometry(), shellMat, MAX, { fx: true }),
      stalk: L(segGeo(0.022, 0.018, 1), shellMat, MAX * 2, { fx: true }),
      eye: L(new THREE.SphereGeometry(0.05, 10, 8), eyeMat, MAX * 2, { colors: false }),
      brow: L(new THREE.BoxGeometry(0.11, 0.022, 0.03), eyeMat, MAX * 2, { colors: false, cast: false }),
      arm: L(segGeo(0.05, 0.04, 1), shellMat, MAX * 2 + 40, { fx: true }),
      clawA: L(pincerGeometry(true), shellMat, MAX * 2 + 40, { fx: true }),
      clawB: L(pincerGeometry(false), shellMat, MAX * 2 + 40, { fx: true }),
      legA: L(segGeo(0.035, 0.028, 1), shellMat, MAX * 8 + 60, { fx: true }),
      legB: L(segGeo(0.028, 0.01, 1), shellMat, MAX * 8 + 60, { fx: true }),
      fork: L(forkGeometry(false), rust, MAX, { colors: false }),
      trident: L(forkGeometry(true), rust, 8, { colors: false }),
      spoon: L(spoonGeometry(), rust, MAX, { colors: false }),
      knife: L(knifeGeometry(), rust, MAX, { colors: false }),
      cap: L(capGeometry(), capMat, MAX, { colors: false }),
      can: L(canGeometry(), canMat, MAX, { colors: false }),
      crown: L(bossCrownGeometry(), gold, 8, { colors: false }),
      tail: L(tailGeometry(), shellMat, MAX, { fx: true }),
      antenna: L(segGeo(0.012, 0.004, 1), shellMat, MAX * 2, { fx: true, cast: false }),
    };
  }

  render(time) {
    const L = this.L;
    for (const k in L) L[k].begin();
    const dt = 1 / 60;
    for (const c of this.game.enemies) {
      if (!c.p.length) continue;
      this._crab(c, dt, time);
    }
    for (const p of this.parts) {
      _q.setFromEuler(p.rot);
      const s = p.size * Math.min(1, p.life);
      _m.compose(p.pos, _q, _s.setScalar(s));
      if (p.kind === 'leg') {
        _m.compose(p.pos, _q, _s.set(s, s * 0.32, s));
        L.legA.push(_m, p.color, 0, 0);
      } else {
        L.clawA.push(_m, p.color, 0, 0);
        L.clawB.push(_m, p.color, 0, 0);
        if (p.weapon === 'fork') L.fork.push(_m);
        else if (p.weapon === 'knife') L.knife.push(_m);
        else if (p.weapon === 'spoon') L.spoon.push(_m);
      }
    }
    for (const k in L) L[k].end();
  }

  _crab(c, dt, time) {
    const L = this.L;
    const V = this.game.verlet;
    const f = c.frame(this._f);
    const s = c.size;
    c.updateLegs(dt, f, time);
    const fl = c.flash * (c.def.boss ? 0.25 : 0.7);
    const col = c.toasted ? _toast.copy(c.color).lerp(_burnt, c.toasted * 0.6) : c.color;
    const belly = _c.set(c.def.belly);
    // body
    _m.makeBasis(f.side, f.up, f.fwd);
    _m.scale(_s.setScalar(s));
    _m.setPosition(f.center.x, f.center.y + 0.02 * s, f.center.z);
    L.shell.push(_m, col, 0, fl);
    L.belly.push(_m, belly, 0, fl);
    if (c.type === 'lobster' || c.type === 'shrimp') {
      _v.copy(f.center).addScaledVector(f.fwd, -0.3 * s);
      _m.makeBasis(f.side, f.up, f.fwd).scale(_s.setScalar(s)).setPosition(_v);
      L.tail.push(_m, col, 0, fl);
      for (const side of [-1, 1]) {
        _v.copy(f.center).addScaledVector(f.fwd, 0.32 * s).addScaledVector(f.side, side * 0.06 * s).addScaledVector(f.up, 0.1 * s);
        _v2.copy(f.fwd).multiplyScalar(0.8).addScaledVector(f.up, 0.6).addScaledVector(f.side, side * 0.35).normalize();
        seg(_m, _v, _v3.copy(_v).addScaledVector(_v2, 0.7 * s), s);
        L.antenna.push(_m, col, 0, fl);
      }
    }
    // eyes on stalks
    const dead = !c.alive;
    for (const side of [-1, 1]) {
      const base = _v.copy(f.center).addScaledVector(f.side, side * 0.08 * s).addScaledVector(f.fwd, 0.2 * s).addScaledVector(f.up, 0.08 * s);
      const wob = Math.sin(time * 6 + c.id + side) * 0.03;
      const tip = _v2.copy(base).addScaledVector(f.up, (dead ? 0.06 : 0.16) * s).addScaledVector(f.side, side * (0.03 + wob) * s).addScaledVector(f.fwd, 0.02 * s);
      seg(_m, base, tip, s);
      L.stalk.push(_m, col, 0, fl);
      _m.makeBasis(f.side, f.up, f.fwd).scale(_s.set(s, s * (dead ? 0.3 : 1), s)).setPosition(tip);
      L.eye.push(_m);
      if (!dead) {
        // angry brows tilted toward the middle
        _q.setFromAxisAngle(f.fwd, -side * 0.5 * c.eyeAnger);
        _v3.copy(tip).addScaledVector(f.up, 0.05 * s).addScaledVector(f.fwd, 0.015 * s);
        const bm = new THREE.Matrix4().makeBasis(f.side, f.up, f.fwd);
        bm.premultiply(new THREE.Matrix4().makeRotationFromQuaternion(_q));
        bm.scale(_s.setScalar(s)).setPosition(_v3);
        L.brow.push(bm);
      }
    }
    // claws
    for (let k = 0; k < 2; k++) {
      if (!c.clawsOn[k]) continue;
      const pi = c.p[3 + k];
      if (pi < 0) continue;
      const tip = _v.set(V.px[pi], V.py[pi], V.pz[pi]);
      const shoulder = _v2.copy(k === 0 ? f.p0 : f.p1).addScaledVector(f.fwd, 0.06 * s);
      seg(_m, shoulder, tip, s * (c.type === 'lobster' ? 1.4 : 1));
      L.arm.push(_m, col, 0, fl);
      // pincer oriented along the arm
      const dir = _v3.subVectors(tip, shoulder).normalize();
      const sideV = new THREE.Vector3().crossVectors(f.up, dir).normalize();
      const upV = new THREE.Vector3().crossVectors(dir, sideV).normalize();
      const big = (c.type === 'lobster' ? 1.8 : k === 1 ? 1.25 : 1.0) * s;
      _m.makeBasis(sideV, upV, dir).scale(_s.setScalar(big)).setPosition(tip);
      L.clawB.push(_m, col, 0, fl);
      const open = c.claw[k] * 0.7;
      const rot = new THREE.Matrix4().makeRotationX(-open);
      const m2 = _m.clone().multiply(rot);
      L.clawA.push(m2, col, 0, fl);
      // weapon in the right claw, shield on the left
      if (k === 1 && c.def.weapon) {
        const wm = new THREE.Matrix4().makeBasis(sideV, upV, dir);
        const pitch = new THREE.Matrix4().makeRotationX(c.attackT >= 0 ? lerp(-1.6, 0.2, smoothstep(0.4, 0.6, c.attackT)) : -0.6);
        wm.multiply(pitch).scale(_s.setScalar(s * (c.def.boss ? 1.1 : 1))).setPosition(tip);
        const w = c.def.weapon;
        if (w === 'fork') L.fork.push(wm);
        else if (w === 'trident') L.trident.push(wm);
        else if (w === 'spoon') L.spoon.push(wm);
        else if (w === 'knife') L.knife.push(wm);
      }
      if (k === 0 && c.def.shield) {
        _m.makeBasis(f.side, f.up, f.fwd).scale(_s.setScalar(s)).setPosition(_v.copy(tip).addScaledVector(f.fwd, 0.08 * s));
        L.cap.push(_m);
      }
    }
    if (c.def.shell === 'can') {
      _m.makeBasis(f.side, f.up, f.fwd).scale(_s.setScalar(s)).setPosition(_v.copy(f.center).addScaledVector(f.up, 0.12 * s).addScaledVector(f.fwd, -0.08 * s));
      L.can.push(_m);
    }
    if (c.def.boss) {
      _m.makeBasis(f.side, f.up, f.fwd).scale(_s.setScalar(s)).setPosition(_v.copy(f.center).addScaledVector(f.up, 0.2 * s).addScaledVector(f.fwd, 0.05 * s));
      L.crown.push(_m);
    }
    // legs (2-bone IK, knees arch upward)
    for (let i = 0; i < 8; i++) {
      if (!c.legsOn[i]) continue;
      const h = LEG_HIPS[i];
      const hip = _v.copy(f.center).addScaledVector(f.side, h[0] * s).addScaledVector(f.up, h[1] * s).addScaledVector(f.fwd, h[2] * s);
      const a = 0.34 * s, b = 0.36 * s;
      const foot = _footTmp.copy(c.legFeet[i]);
      // never let a leg stretch beyond its reach
      const dd = _v2.subVectors(foot, hip);
      const reach = (a + b) * 0.98;
      if (dd.length() > reach) foot.copy(hip).addScaledVector(dd.normalize(), reach);
      const d = _v2.subVectors(foot, hip);
      let dl = d.length();
      const dir = d.divideScalar(dl || 1);
      dl = Math.min(dl, (a + b) * 0.98);
      const cosA = clamp((a * a + dl * dl - b * b) / (2 * a * dl), -1, 1);
      const sinA = Math.sqrt(1 - cosA * cosA);
      const bend = _v3.copy(f.up).addScaledVector(dir, -f.up.dot(dir)).normalize();
      const knee = new THREE.Vector3().copy(hip).addScaledVector(dir, cosA * a).addScaledVector(bend, sinA * a);
      seg(_m, hip, knee, s);
      L.legA.push(_m, col, 0, fl);
      seg(_m, knee, foot, s);
      L.legB.push(_m, col, 0, fl);
    }
  }
}

// segment matrix: unit-length geometry along +y from a to b
function seg(out, a, b, s) {
  _v3.subVectors(b, a);
  const len = _v3.length() || 1e-4;
  _q.setFromUnitVectors(Y, _v3.divideScalar(len));
  out.compose(a, _q, _s.set(s, len, s));
  return out;
}

// ---- geometry ----------------------------------------------------------------------
function segGeo(r0, r1, len) {
  const g = new THREE.CylinderGeometry(r1, r0, len, 6);
  g.translate(0, len / 2, 0);
  g.deleteAttribute('uv');
  return g;
}

function carapaceGeometry() {
  const g = new THREE.SphereGeometry(0.34, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    x *= 1.25; z *= 0.95; y *= 0.6;
    // ridged front edge and bumps
    const a = Math.atan2(z, x);
    if (z > 0) y += Math.max(0, Math.sin(a * 9)) * 0.015;
    y += Math.sin(x * 30) * Math.sin(z * 30) * 0.006;
    // spiky side points
    const side = Math.abs(Math.cos(a));
    if (side > 0.9 && Math.abs(z) < 0.08) { x *= 1.08; }
    p.setXYZ(i, x, y - 0.03, z);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

function bellyGeometry() {
  const g = new THREE.SphereGeometry(0.33, 22, 6, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.2);
  g.scale(1.22, 0.35, 0.92);
  g.translate(0, -0.025, 0);
  g.deleteAttribute('uv');
  return g;
}

function pincerGeometry(upper) {
  // a curved pincer finger along +z
  const shape = new THREE.Shape();
  if (upper) {
    shape.moveTo(0, 0); shape.quadraticCurveTo(0.08, 0.18, 0.0, 0.3); shape.quadraticCurveTo(0.03, 0.15, -0.04, 0.02); shape.lineTo(0, 0);
  } else {
    shape.moveTo(0, 0); shape.quadraticCurveTo(-0.11, 0.16, -0.02, 0.34); shape.quadraticCurveTo(-0.04, 0.17, 0.05, 0.03); shape.lineTo(0, 0);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 2 });
  // shape is in XY; map: shape y → +z (forward), shape x → +y (up), extrude → x
  g.rotateY(Math.PI / 2);
  g.rotateX(-Math.PI / 2);
  g.translate(0.035, 0, 0);
  const base = new THREE.SphereGeometry(0.075, 10, 8);
  base.scale(1, 0.9, 1.3);
  const parts = [g, base].map((x) => { x.deleteAttribute('uv'); return x.index ? x.toNonIndexed() : x; });
  const out = mergeGeometries(upper ? [parts[0]] : parts);
  out.computeVertexNormals();
  return out;
}

function colorRust(g, base = 0x8d8a86) {
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  const a = new THREE.Color(base), r = new THREE.Color(0xa0522d);
  for (let i = 0; i < p.count; i++) {
    const n = Math.sin(p.getX(i) * 60) * Math.sin(p.getY(i) * 45 + 1) * Math.sin(p.getZ(i) * 50 + 2);
    const t = clamp(0.4 + n * 0.8);
    _c.copy(a).lerp(r, t);
    c[i * 3] = _c.r; c[i * 3 + 1] = _c.g; c[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function forkGeometry(trident) {
  const parts = [];
  const s = trident ? 1 : 1;
  const handle = new THREE.BoxGeometry(0.05, 0.03, 0.62);
  handle.translate(0, 0, -0.05);
  parts.push(handle);
  const neck = new THREE.BoxGeometry(0.1, 0.025, 0.08);
  neck.translate(0, 0, 0.3);
  parts.push(neck);
  const n = trident ? 3 : 4;
  for (let i = 0; i < n; i++) {
    const t = new THREE.BoxGeometry(0.018, 0.02, trident ? 0.32 : 0.24);
    const x = (i - (n - 1) / 2) * (trident ? 0.05 : 0.03);
    t.translate(x, 0, trident ? 0.5 : 0.45);
    parts.push(t);
    if (trident) {
      const barb = new THREE.ConeGeometry(0.02, 0.06, 4);
      barb.rotateX(Math.PI / 2);
      barb.translate(x, 0, 0.68);
      parts.push(barb);
    }
  }
  const g = mergeGeometries(parts.map((x) => { x.deleteAttribute('uv'); return x.index ? x.toNonIndexed() : x; }));
  g.computeVertexNormals();
  g.scale(s, s, s);
  return colorRust(g, trident ? 0x9a8f80 : 0x8d8a86);
}

function spoonGeometry() {
  const handle = new THREE.BoxGeometry(0.045, 0.025, 0.5);
  handle.translate(0, 0, 0.05);
  const bowl = new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  bowl.scale(0.85, 0.35, 1.25);
  bowl.rotateX(Math.PI);
  bowl.translate(0, 0.02, 0.38);
  const g = mergeGeometries([handle, bowl].map((x) => { x.deleteAttribute('uv'); return x.index ? x.toNonIndexed() : x; }));
  g.computeVertexNormals();
  return colorRust(g, 0xb8b4ae);
}

function knifeGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.03, 0); shape.lineTo(0.035, 0); shape.lineTo(0.035, 0.3); shape.quadraticCurveTo(0.03, 0.38, -0.005, 0.4); shape.lineTo(-0.03, 0.3); shape.lineTo(-0.03, 0);
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.01, bevelEnabled: false });
  blade.rotateX(Math.PI / 2);
  blade.translate(0, 0, 0.12);
  const handle = new THREE.BoxGeometry(0.05, 0.03, 0.22);
  handle.translate(0, 0, 0.0);
  const g = mergeGeometries([blade, handle].map((x) => { x.deleteAttribute('uv'); return x.index ? x.toNonIndexed() : x; }));
  g.computeVertexNormals();
  return colorRust(g, 0xc8c4be);
}

function capGeometry() {
  const pts = [];
  for (let i = 0; i <= 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const r = 0.16 + (i % 2 ? 0.012 : 0);
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.04, bevelEnabled: false });
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

function canGeometry() {
  const g = new THREE.CylinderGeometry(0.26, 0.26, 0.42, 20, 4, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const ridge = 1 + 0.03 * Math.sin(y * 50);
    p.setX(i, p.getX(i) * ridge); p.setZ(i, p.getZ(i) * ridge);
  }
  g.rotateX(Math.PI / 2 - 0.3);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

function bossCrownGeometry() {
  const parts = [];
  const band = new THREE.CylinderGeometry(0.14, 0.15, 0.06, 16, 1, true);
  parts.push(band);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sp = new THREE.ConeGeometry(0.03, 0.09, 4);
    sp.translate(Math.cos(a) * 0.145, 0.07, Math.sin(a) * 0.145);
    parts.push(sp);
  }
  const g = mergeGeometries(parts.map((x) => { x.deleteAttribute('uv'); return x.index ? x.toNonIndexed() : x; }));
  g.computeVertexNormals();
  return g;
}

function tailGeometry() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const sgm = new THREE.SphereGeometry(0.17 - i * 0.03, 12, 8);
    sgm.scale(1, 0.55, 0.8);
    sgm.translate(0, -0.02 - i * 0.01, -i * 0.16);
    parts.push(sgm);
  }
  const fan = new THREE.ConeGeometry(0.14, 0.14, 5);
  fan.rotateX(-Math.PI / 2);
  fan.scale(1.6, 0.4, 1);
  fan.translate(0, -0.06, -0.68);
  parts.push(fan);
  const g = mergeGeometries(parts.map((x) => { x.deleteAttribute('uv'); return x.index ? x.toNonIndexed() : x; }));
  g.computeVertexNormals();
  return g;
}

export { CRAB_TYPES };
