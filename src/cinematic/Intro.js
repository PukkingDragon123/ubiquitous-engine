// Opening cinematic, scripted with async/await on game time.
import * as THREE from 'three';
import { clamp, lerp, ease, rnd, smoothstep } from '../core/math.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

class Skip extends Error {}

export class Intro {
  constructor(game) {
    this.game = game;
    this.running = false;
    this.waits = [];
    this.shot = null;
    this.skipped = false;
    game.input.on((type, e) => {
      if (!this.running) return;
      if (type === 'keydown' && (e.code === 'Space' || e.code === 'Escape' || e.code === 'Enter')) this.skip();
    });
  }

  wait(sec) {
    return new Promise((resolve, reject) => {
      if (this.skipped) { reject(new Skip()); return; }
      this.waits.push({ t: this.game.time + sec, resolve, reject });
    });
  }

  // camera shot: fn(u) → { pos, look, fov } over `dur` seconds with easing
  setShot(dur, fn, easing = ease.inOutSine) {
    this.shot = { start: this.game.time, dur, fn, easing };
  }

  update(dt) {
    if (!this.running) return;
    const now = this.game.time;
    for (let i = this.waits.length - 1; i >= 0; i--) {
      if (now >= this.waits[i].t) { const w = this.waits.splice(i, 1)[0]; w.resolve(); }
    }
    if (this.shot) {
      const s = this.shot;
      const u = clamp((now - s.start) / s.dur);
      const r = s.fn(s.easing(u), u);
      const rig = this.game.rig;
      rig.cine.pos.copy(r.pos);
      rig.cine.look.copy(r.look);
      rig.cine.fov = r.fov || 34;
      rig.cine.focusMul = r.focus || 1;
    }
    if (this.ring) {
      this.ringT += dt;
      this.ring.rotation.y += dt * 0.6;
      if (Math.random() < dt * 4) {
        const p = this.ring.position;
        this.game.particles.sparkle(p.x, p.y + 0.15, p.z, 1, [1, 0.9, 0.55], 0.12, 0.2);
      }
    }
  }

  skip() {
    if (!this.running || this.skipped) return;
    this.skipped = true;
    for (const w of this.waits) w.reject(new Skip());
    this.waits = [];
  }

  async play() {
    const game = this.game;
    this.running = true;
    game.state = 'intro';
    game.interaction.enabled = false;
    game.ui.showHUD(false);
    game.ui.letterbox(true);
    game.sky.timeOfDay = 0.295;
    game.rig.setMode('cinematic', { instant: true });
    game.audio.setMood('calm');
    try {
      await this._script();
    } catch (e) {
      if (!(e instanceof Skip)) console.error(e);
    }
    this._finish();
  }

  _makeRing() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 14, 40), new THREE.MeshStandardMaterial({ color: 0xffc94a, roughness: 0.16, metalness: 1, emissive: 0x3a2400, emissiveIntensity: 0.5 }));
    ring.rotation.x = Math.PI / 2 - 0.25;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: 0xe8fbff, roughness: 0.02, emissive: 0x9fe8ff, emissiveIntensity: 1.8 }));
    gem.position.set(0, 0.06, 0.2);
    g.add(ring, gem);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  async _script() {
    const game = this.game, ui = game.ui, sim = game.sim;
    const ringPos = new THREE.Vector3(1.0, 0, 6.9);
    ringPos.y = sim.heightAt(ringPos.x, ringPos.z) + 0.05;
    this.ring = this._makeRing();
    this.ringT = 0;
    this.ring.position.copy(ringPos);
    game.scene.add(this.ring);

    // our hero, not yet a king
    const hero = (this.hero = game.spawnUnit('king', 22, -4.5, { yaw: -2.2, name: 'Pip' }));
    hero.crownHidden = true;
    hero.def = { ...hero.def, weapon: null };
    game.king = hero;
    // the crab with the rusty fork
    const crab = (this.crab = game.enemyManager.spawn('forker', 25.5, -6.5, { yaw: -2.2, scale: 1.25 }));
    crab.scripted = true;
    crab.def = { ...crab.def, speed: 2.5 };

    // --- shot A: from the enormous ocean toward the beach ---------------------------------
    const A0 = new THREE.Vector3(60, 95, -330), A1 = new THREE.Vector3(26, 18, -34);
    const L0 = new THREE.Vector3(-40, 20, -900), L1 = new THREE.Vector3(10, 0, 0);
    this.setShot(9, (u) => ({ pos: _v.lerpVectors(A0, A1, u).clone(), look: _v2.lerpVectors(L0, L1, ease.inOutCubic(u)).clone(), fov: lerp(42, 34, u), focus: 6 }), ease.inOutSine);
    await this.wait(1.6);
    ui.gameTitle(true);
    await this.wait(3.8);
    ui.gameTitle(false);
    await this.wait(0.8);
    ui.subtitle('On a quiet beach, at the edge of an enormous sea…');
    // hero starts running in panic, crab gives chase
    hero.panic = 20;
    hero.speedMul = 0.62;
    hero.moveTo(ringPos.x + 0.6, ringPos.z - 0.9, 0.2);
    this.crabChase = true;
    await this.wait(2.8);

    // --- shot B: tracking the chase -------------------------------------------------------------
    ui.subtitle('…lived a very small, very sandy, very nervous little guy.');
    const tmp = new THREE.Vector3();
    this.setShot(6.5, (u) => {
      const hp = hero.pos;
      const mid = tmp.copy(hp).lerp(crab.pos, 0.35);
      return { pos: new THREE.Vector3(mid.x + 5.5 - u * 2, hp.y + 1.7, mid.z + 3.2), look: new THREE.Vector3(mid.x, hp.y + 0.45, mid.z), fov: 36, focus: 0.35 };
    }, ease.linear);
    await this.wait(5.2);
    ui.subtitle(null);
    // trip right next to the ring
    for (let i = 0; i < 60 && hero.pos.distanceTo(ringPos) > 1.4; i++) await this.wait(0.1);
    if (hero.pos.distanceTo(ringPos) > 1.4) {
      // running late: give him a helpful little teleport just off camera
      hero.pos.set(ringPos.x + 1.2, hero.pos.y, ringPos.z - 0.8);
      for (const i of hero.p) if (i >= 0) game.verlet.teleport(i, hero.pos.x, sim.heightAt(hero.pos.x, hero.pos.z) + 0.5, hero.pos.z);
    }
    hero.panic = 0;
    hero.stop();
    hero.knockDown(1.6);
    hero.applyImpulse(-1.5, 1.5, 3.2);
    game.events.emit('impact', hero.p[0], 6);
    this.crabChase = false;
    crab.vel.set(0, 0, 0);
    crab.state = 'idle';

    // --- shot C: close on the hero and the ring ---------------------------------------------------
    this.setShot(5.5, (u) => {
      const hp = hero.pos;
      return { pos: new THREE.Vector3(ringPos.x + 1.9 - u * 0.4, hp.y + 0.85, ringPos.z + 1.7 - u * 0.3), look: new THREE.Vector3((hp.x + ringPos.x) / 2, hp.y + 0.35, (hp.z + ringPos.z) / 2), fov: 32, focus: 0.18 };
    }, ease.inOutSine);
    await this.wait(2.2);
    hero.lookAt = ringPos;
    hero.moveTo(ringPos.x - 0.35, ringPos.z, 0.15);
    await this.wait(1.3);
    hero.setAnim('gather');
    await this.wait(0.5);
    game.scene.remove(this.ring);
    this.ring = null;
    game.particles.sparkle(ringPos.x, ringPos.y + 0.3, ringPos.z, 18, [1, 0.9, 0.5], 0.3, 0.2);
    game.audio.sting('unlock');
    hero.setAnim('pose');
    hero.cheer = 0;
    await this.wait(1.2);
    // ring on the head: it's a crown now
    hero.crownHidden = false;
    game.particles.sparkle(hero.pos.x, hero.pos.y + 1.2, hero.pos.z, 30, [1, 0.88, 0.45], 0.4, 0.22);
    game.audio.tone(null, { freq: 1568, dur: 1.2, vol: 0.12, verb: 0.6 });
    game.audio.tone(null, { freq: 2093, dur: 1.4, vol: 0.08, verb: 0.6, delay: 0.1 });

    // --- shot D: heroic low angle ------------------------------------------------------------------
    hero.lookAt = crab.pos;
    const face = hero.yaw;
    this.setShot(4, (u) => {
      const hp = hero.pos;
      const fx = Math.sin(hero.yaw), fz = Math.cos(hero.yaw);
      return { pos: new THREE.Vector3(hp.x + fx * 2.3 - fz * 0.7, hp.y + 0.3, hp.z + fz * 2.3 + fx * 0.7), look: new THREE.Vector3(hp.x, hp.y + 0.75, hp.z), fov: 40 - u * 5, focus: 0.15 };
    });
    await this.wait(0.6);
    hero.setAnim('pose');
    ui.shout('I WILL DEFEND THIS WITH MY LIFE!', 3.4);
    game.events.emit('say', hero, 'I will defend this with my life', { king: true, shout: true });
    game.audio.sting('fanfare');
    await this.wait(3.4);

    // --- shot E: the castle rises out of the sand ----------------------------------------------------
    hero.stop();
    hero.pos.set(0, hero.pos.y, 7.1);
    for (const i of hero.p) if (i >= 0) game.verlet.teleport(i, 0, sim.heightAt(0, 7.1) + 0.5, 7.1);
    hero.jumpV = 4.5; hero.jumpY = 0.001;
    await this.wait(0.45);
    game.rig.addShake(0.5);
    game.particles.dust(0, sim.heightAt(0, 6) + 0.2, 6, 30, 3);
    const keep = (game.keep = game.buildings.place('keep', 0, 6, 0, { free: true }));
    keep.delivered = keep.toDeliver;
    // seen from the sea side, where the crab is
    const cdx = crab.pos.x - 0, cdz = crab.pos.z - 6;
    const cl = Math.hypot(cdx, cdz) || 1;
    const sideX = cdx / cl, sideZ = cdz / cl;
    this.setShot(4.2, (u) => ({
      pos: new THREE.Vector3(sideX * lerp(8, 15, u) + sideZ * 4, lerp(2.4, 8, u), 6 + sideZ * lerp(8, 15, u) - sideX * 4),
      look: new THREE.Vector3(sideX * 2, keep.baseY + lerp(0.8, 1.8, u), 6 + sideZ * 2),
      fov: 36, focus: 0.5,
    }));
    const rise = 2.6;
    for (let t = 0; t < rise; t += 0.1) {
      keep.progress = Math.min(1, t / rise);
      keep.hp = keep.maxHp;
      if (keep.progress > 0.15 && !keep.registered) keep._register();
      for (let k = 0; k < 6; k++) {
        const a = Math.random() * Math.PI * 2, r = 3.6 + Math.random() * 0.8;
        game.particles.sandSpray(Math.cos(a) * r, keep.baseY + 0.2, 6 + Math.sin(a) * r, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 3, 0, 0.6, 0.8);
      }
      game.rig.addShake(0.05);
      await this.wait(0.1);
    }
    keep.complete();
    // the king takes his seat
    const throne = keep.slot('throne');
    hero.sit = throne;
    hero.pos.set(throne.x, throne.y, throne.z);
    for (const i of hero.p) if (i >= 0) game.verlet.teleport(i, throne.x, throne.y + 0.4, throne.z);

    // the crab bonks into the wall
    crab.scripted = true;
    this.crabTarget = new THREE.Vector3(0, 0, 6);
    this.crabMode = 'charge';
    for (let i = 0; i < 20 && crab.pos.distanceTo(_v.set(0, crab.pos.y, 6)) > keep.radius + 0.9; i++) await this.wait(0.1);
    crab.applyImpulse(sideX * 4, 3, sideZ * 4);
    crab.knockDown(1.5);
    game.events.emit('enemyHit', crab, 0, {});
    game.rig.addShake(0.2);
    this.crabMode = null;
    await this.wait(1.7);

    // --- shot F: the crab retreats to the sea and summons an army ----------------------------------------
    crab.state = 'warcry';
    crab.stateT = 0;
    crab.shout = 1;
    game.events.emit('crabWarcry', crab);
    this.setShot(7.5, (u) => {
      const cp = crab.pos;
      return { pos: new THREE.Vector3(cp.x + 4.5, Math.max(cp.y, sim.seaLevel) + 2.6 + u * 2, cp.z + 6 - u * 1.5), look: new THREE.Vector3(cp.x, Math.max(cp.y, sim.seaLevel) + 0.3, cp.z - u * 3), fov: 36, focus: 0.6 };
    }, ease.linear);
    await this.wait(1.0);
    this.crabMode = 'retreat';
    ui.subtitle('The crab, rather upset, went home to fetch a few friends.');
    await this.wait(3.6);
    // shapes beneath the waves
    this.army = [];
    for (let i = 0; i < 9; i++) {
      const x = crab.pos.x + rnd(-6, 6), z = crab.pos.z - rnd(3, 9);
      const c = game.enemyManager.spawn('forker', x, z, { yaw: Math.PI + rnd(-0.3, 0.3) });
      c.scripted = true;
      this.army.push(c);
    }
    game.audio.tone(null, { freq: 55, to: 45, dur: 2.5, type: 'sawtooth', vol: 0.12, verb: 0.6 });
    await this.wait(2.6);
    ui.subtitle(null);

    // --- shot G: up to the kingdom --------------------------------------------------------------------------------
    await this.wait(0.3);
  }

  // scripted crab movement (called from the enemy AI)
  driveCrab(c, dt) {
    const game = this.game;
    if (c === this.crab) {
      if (this.crabChase && this.hero) {
        const hp = this.hero.pos;
        const dx = hp.x - c.pos.x, dz = hp.z - c.pos.z;
        const d = Math.hypot(dx, dz);
        const want = d > 2.2 ? 2.6 : 1.5;
        c.vel.x = (dx / d) * want; c.vel.z = (dz / d) * want;
        c.goalYaw = Math.atan2(dx, dz);
        c.state = 'chase';
        if (d < 2.4 && c.attackT < 0 && Math.random() < dt * 1.5) c.startAttack();
      } else if (this.crabMode === 'charge') {
        const t = this.crabTarget;
        const dx = t.x - c.pos.x, dz = t.z - c.pos.z;
        const d = Math.hypot(dx, dz) || 1;
        c.vel.x = (dx / d) * 3; c.vel.z = (dz / d) * 3;
        c.goalYaw = Math.atan2(dx, dz);
      } else if (this.crabMode === 'retreat') {
        // away from the castle and into the sea
        const ax = c.pos.x, az = c.pos.z - 6;
        const al = Math.hypot(ax, az) || 1;
        let vx = (ax / al) * 0.8, vz = (az / al) * 0.8 - 2.2;
        const vl = Math.hypot(vx, vz);
        c.vel.x = (vx / vl) * 2.6; c.vel.z = (vz / vl) * 2.6;
        c.goalYaw = Math.atan2(c.vel.x, c.vel.z) + Math.PI / 2;
        c.state = 'walk';
      } else {
        c.vel.multiplyScalar(0.85);
      }
    } else {
      // army members bob ominously under water
      c.vel.multiplyScalar(0.9);
      c.claw[0] = 0.5 + 0.5 * Math.sin(game.time * 8 + c.id);
    }
  }

  _finish() {
    const game = this.game, ui = game.ui;
    this.running = false;
    this.shot = null;
    ui.subtitle(null);
    ui.gameTitle(false);
    if (this.ring) { game.scene.remove(this.ring); this.ring = null; }
    // remove the scripted crabs
    for (const c of [this.crab, ...(this.army || [])]) {
      if (!c) continue;
      c.destroyBody();
      const i = game.enemies.indexOf(c);
      if (i >= 0) game.enemies.splice(i, 1);
    }
    this.crab = null;
    this.army = null;
    const hero = this.hero;
    if (hero) {
      hero.crownHidden = false;
      hero.def = hero.def.weapon === null ? { ...hero.def, weapon: 'scepter' } : hero.def;
      hero.panic = 0;
      hero.speedMul = 1;
      hero.setAnim('idle');
      game.king = hero;
    }
    if (game.keep && game.keep.state !== 'built') { game.keep.complete(); }
    if (!game.keep) game.keep = game.buildings.place('keep', 0, 6, 0, { instant: true, free: true });
    ui.letterbox(false);
    game.sky.timeOfDay = Math.max(game.sky.timeOfDay, 0.31);
    game.startPlay(false);
    if (this.skipped) {
      game.rig.goal.set(0, 0, 9);
      game.rig.goalDist = 34;
      game.rig.goalYaw = 0;
    } else {
      game.rig.goal.set(0, 0, 8);
      game.rig.goalDist = 30;
      game.rig.goalYaw = 0;
    }
  }
}
