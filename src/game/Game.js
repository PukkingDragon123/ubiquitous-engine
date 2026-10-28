// Central game object: owns every system and runs the frame loop.
import * as THREE from 'three';
import { Engine } from '../core/Engine.js';
import { Input } from '../core/Input.js';
import { CameraRig } from '../core/CameraRig.js';
import { Events } from '../core/Events.js';
import { SpatialHash } from '../core/SpatialHash.js';
import { BeachSim } from '../world/BeachSim.js';
import { TerrainMesh } from '../world/TerrainMesh.js';
import { WaterMesh } from '../world/WaterMesh.js';
import { Sky } from '../world/Sky.js';
import { Props } from '../world/Props.js';
import { Particles } from '../world/Particles.js';
import { globalUniforms } from '../world/shaderLib.js';
import { BOUNDS } from '../world/config.js';
import { Verlet } from '../entities/Verlet.js';
import { Limbs } from '../entities/Limbs.js';
import { Sandling } from '../entities/Sandling.js';
import { Dragon } from '../entities/Dragon.js';
import { SandlingRenderer } from '../entities/SandlingRenderer.js';
import { Items } from '../entities/Items.js';
import { Boulders } from '../entities/Boulders.js';
import { Enemies } from '../entities/Enemies.js';
import { Projectiles } from '../entities/Projectiles.js';
import { Buildings } from '../buildings/Buildings.js';
import { Economy } from './Economy.js';
import { WorkerAI } from './WorkerAI.js';
import { CombatAI } from './CombatAI.js';
import { Interaction } from './Interaction.js';
import { Possession } from './Possession.js';
import { Director } from './Director.js';
import { UI } from '../ui/UI.js';
import { Audio } from '../audio/Audio.js';
import { Intro } from '../cinematic/Intro.js';
import { clamp, lerp, smoothstep, rnd } from '../core/math.js';

export class Game {
  constructor(container) {
    this.params = new URLSearchParams(location.search);
    this.debug = this.params.has('debug');
    this.engine = new Engine(container);
    this.scene = this.engine.scene;
    this.camera = this.engine.camera;
    this.events = new Events();
    this.input = new Input(this.engine.renderer.domElement, this.camera);
    this.sim = new BeachSim();
    this.terrain = new TerrainMesh(this.scene, this.sim);
    this.water = new WaterMesh(this.scene, this.sim);
    this.sky = new Sky(this.engine);
    this.props = new Props(this.scene, this.sim);
    this.rig = new CameraRig(this.camera, this.sim);
    this.particles = new Particles(this.scene, this.sim);
    this.verlet = new Verlet(this.sim);
    this.limbs = new Limbs(this);
    this.units = [];
    this.dragons = [];
    this.puppets = [];
    this.spatial = new SpatialHash(2);
    this.staticColliders = [];
    for (const c of this.props.colliders) {
      if (c.kind === 'bush') continue;
      const col = { x: c.x, z: c.z, r: c.r * (c.kind === 'rock' ? 0.85 : 1), top: c.h, walkTop: c.kind === 'rock' && c.r < 1.2 };
      this.staticColliders.push(col);
      this.verlet.colliders.push(col);
    }
    this.unitRenderer = new SandlingRenderer(this.scene);
    this.economy = new Economy(this);
    this.buildings = new Buildings(this);
    this.rig.buildings = this.buildings;
    this.items = new Items(this);
    this.boulders = new Boulders(this);
    this.enemies = [];
    this.enemyManager = new Enemies(this);
    this.projectiles = new Projectiles(this);
    this.workerAI = new WorkerAI(this);
    this.combatAI = new CombatAI(this);
    this.interaction = new Interaction(this);
    this.possession = new Possession(this);
    this.director = new Director(this);
    this.audio = new Audio(this);
    this.ui = new UI(this);
    this.intro = new Intro(this);

    this.time = 0;
    this.timeScale = 1;
    this.slowmo = 0;
    this.paused = false;
    this.state = 'boot';
    this.clock = new THREE.Timer();
    this.frame = 0;
    this.fps = 60;
    this.physAcc = 0;
    this.physTime = 0;
    this.keep = null;
    this.king = null;
    this.stats = { kills: 0, lost: 0, waves: 0, built: 0, gathered: 0 };

    this.verlet.onImpact = (i, speed) => this.events.emit('impact', i, speed);
    if (this.params.has('low')) this.engine.setQuality('low');
    this._bindCameraControls();
    this._bindGlobalKeys();
    if (this.debug) this._makeDebugOverlay();
  }

  // ---- game flow ---------------------------------------------------------------------
  begin() {
    const skip = this.params.has('skip') || this.params.has('test');
    if (skip) this.startPlay(true);
    else this.intro.play();
  }

  // Set up the kingdom (called by the intro at its end, or directly when skipping).
  setupKingdom() {
    if (!this.keep) this.keep = this.buildings.place('keep', 0, 6, 0, { instant: true, free: true });
    if (!this.king) this.king = this.spawnUnit('king', 0, 7.5, { yaw: 0, name: 'Pip the First' });
    const throne = this.keep.slot('throne');
    this.king.sit = throne;
    this.king.pos.set(throne.x, throne.y, throne.z);
    for (const i of this.king.p) if (i >= 0) this.verlet.teleport(i, throne.x, throne.y + 0.3, throne.z);
    if (this.units.filter((u) => u.type === 'worker').length === 0) {
      for (let i = 0; i < 3; i++) {
        const w = this.spawnUnit('worker', rnd(-2, 2), 11 + rnd(-0.5, 0.5));
        w.home = this.keep;
      }
      const guard = this.spawnUnit('knight', 2.5, 10.5, { name: 'Sir Crumbsalot' });
      guard.home = this.keep;
    }
    if (!this.items.list.length) this.items.scatter(85);
    this.economy.res.shells = Math.max(this.economy.res.shells, 14);
    this.economy.res.driftwood = Math.max(this.economy.res.driftwood, 4);
    this.events.emit('resources', this.economy.res);
  }

  startPlay(skipIntro = false) {
    this.setupKingdom();
    this.state = 'play';
    this.interaction.enabled = true;
    this.rig.setMode('rts', { blendSpeed: 0.8 });
    if (skipIntro) {
      this.rig.goal.set(0, 0, 9);
      this.rig.goalDist = 34;
      this.rig.goalYaw = 0;
      this.rig.snap();
      this.rig._blend = 1;
    }
    this.director.start(skipIntro);
    this.ui.showHUD(true);
    this.events.emit('play', skipIntro);
  }

  gameOver() {
    if (this.state === 'gameover') return;
    this.state = 'gameover';
    this.interaction.enabled = false;
    this.slowmo = 3;
    this.events.emit('gameover', this.stats);
  }

  restart() {
    location.reload();
  }

  // ---- shared queries ---------------------------------------------------------
  separation(u, r) {
    const out = this._sep || (this._sep = { x: 0, z: 0 });
    out.x = 0; out.z = 0;
    const px = u.pos.x, pz = u.pos.z;
    this.spatial.query(px, pz, r * 2 + 1, (o) => {
      if (o === u || !o.alive) return;
      const dx = px - o.pos.x, dz = pz - o.pos.z;
      const d2 = dx * dx + dz * dz;
      const rr = r + (o.radius || 0.3);
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const f = (rr - d) / rr;
        out.x += (dx / d) * f;
        out.z += (dz / d) * f;
      }
    });
    return out;
  }

  resolveStatic(pos, r) {
    for (const c of this.staticColliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const rr = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-4;
        pos.x = c.x + (dx / d) * rr;
        pos.z = c.z + (dz / d) * rr;
      }
    }
    for (const b of this.verlet.boxes) {
      if (b.bridge) continue;
      const dx = pos.x - b.x, dz = pos.z - b.z;
      const lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c;
      const ex = b.hx + r, ez = b.hz + r;
      if (lx <= -ex || lx >= ex || lz <= -ez || lz >= ez) continue;
      const pxp = ex - Math.abs(lx), pzp = ez - Math.abs(lz);
      let nlx = lx, nlz = lz;
      if (pxp < pzp) nlx = Math.sign(lx || 1) * ex; else nlz = Math.sign(lz || 1) * ez;
      pos.x = b.x + nlx * b.c - nlz * b.s;
      pos.z = b.z + nlx * b.s + nlz * b.c;
    }
  }

  // Ground height including walkable decks (bridges).
  walkHeight(x, z) {
    let h = this.sim.heightAt(x, z);
    for (const b of this.bridges) {
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * b.c + dz * b.s, lz = -dx * b.s + dz * b.c;
      if (Math.abs(lx) < b.hx && Math.abs(lz) < b.hz) h = Math.max(h, b.top);
    }
    return h;
  }

  blockedAt(x, z, r) {
    for (const c of this.staticColliders) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return true;
    for (const b of this.buildings.list) if (b.alive && Math.hypot(b.pos.x - x, b.pos.z - z) < b.radius + r) return true;
    return false;
  }

  clampToWorld(pos) {
    pos.x = clamp(pos.x, BOUNDS.minX, BOUNDS.maxX);
    pos.z = clamp(pos.z, BOUNDS.minZ, BOUNDS.maxZ);
  }

  spawnUnit(type, x, z, opts) {
    if (type === 'dragon') {
      const d = new Dragon(this, x, z, opts);
      this.dragons.push(d);
      this.events.emit('unitSpawned', d);
      return d;
    }
    const u = new Sandling(this, type, x, z, opts);
    this.units.push(u);
    this.events.emit('unitSpawned', u);
    return u;
  }

  // ---- input -----------------------------------------------------------------------
  _bindCameraControls() {
    const input = this.input;
    input.on((type, e, extra) => {
      if (this.possession.active) return;
      if (type === 'wheel') {
        if (this.state === 'play' || this.state === 'gameover') this.rig.zoom(Math.exp(e.deltaY * 0.0012));
      } else if (type === 'move' && (this.rig.mode === 'rts' || this.rig.mode === 'inspect')) {
        if (input.isDragging(2) || input.isDragging(1)) {
          this.rig.rotate(-extra.dx * 0.006, extra.dy * 0.003);
        }
      }
    });
  }

  _bindGlobalKeys() {
    this.input.on((type, e) => {
      if (type !== 'keydown') return;
      if (e.code === 'KeyP') this.togglePause();
      if (this.debug && e.code === 'KeyN') this.director.debugNextWave();
      if (this.debug && e.code === 'KeyM') { for (const k in this.economy.res) this.economy.res[k] += 50; this.events.emit('resources', this.economy.res); }
    });
  }

  togglePause(v) {
    this.paused = v ?? !this.paused;
    this.events.emit('pause', this.paused);
  }

  _makeDebugOverlay() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;font:12px/1.35 monospace;color:#fff;background:rgba(0,0,0,.45);padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre';
    document.body.appendChild(el);
    this._debugEl = el;
  }

  // ---- debug helpers -------------------------------------------------------
  fastForward(seconds) {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      const dt = 1 / 60;
      this.time += dt;
      globalUniforms.uTime.value = this.time;
      this.director.update(dt);
      this._fixedUpdate(dt);
      this.sim.update(dt);
      this.items.update(dt);
      this.boulders.update(dt);
      this.buildings.update(dt);
      this.projectiles.update(dt);
      this.particles.update(dt);
      this.intro.update(dt);
    }
  }

  // Like fastForward, but yields to the microtask queue so async scripts (the intro) advance.
  async fastForwardAsync(seconds) {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      this.fastForward(1 / 60);
      await null;
    }
  }

  setView(x, z, dist, yaw = 0, pitchOffset = 0) {
    this.rig.mode = 'rts';
    this.rig.goal.set(x, this.sim.heightAt(x, z) + 0.4, z);
    this.rig.goalDist = dist;
    this.rig.goalYaw = yaw;
    this.rig.goalPitchOffset = pitchOffset;
    this.rig.snap();
  }

  // ---- loop -------------------------------------------------------------------
  start() {
    this.begin();
    const loop = () => {
      requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  tick() {
    this.clock.update();
    const rawDt = Math.min(this.clock.getDelta(), 0.1);
    this.fps = lerp(this.fps, 1 / Math.max(rawDt, 1e-4), 0.05);
    this.input.update();
    // dramatic slow motion
    let scale = this.timeScale;
    if (this.slowmo > 0) {
      this.slowmo = Math.max(0, this.slowmo - rawDt);
      scale *= lerp(1, 0.25, smoothstep(0, 0.6, this.slowmo));
    }
    const dt = this.paused ? 0 : rawDt * scale;
    this.time += dt;
    globalUniforms.uTime.value = this.time;

    if (dt > 0) {
      this.director.update(dt);
      this._fixedUpdate(dt);
      this.sim.update(dt);
      this.items.update(dt);
      this.boulders.update(dt);
      this.buildings.update(dt);
      this.projectiles.update(dt);
      this.particles.update(dt);
      this.intro.update(dt);
    }
    globalUniforms.uSeaLevel.value = this.sim.seaLevel;

    this.interaction.update(rawDt);
    this.possession.update(rawDt);
    this.sky.update(dt);
    this.rig.update(rawDt, this.state === 'play' && !this.possession.active ? this.input.keys : null);
    this.sky.shadowFocus.copy(this.rig.mode === 'follow' && this.possession.unit ? this.possession.unit.pos : this.rig.target);
    this.sky.shadowSize = clamp(this.rig.dist * 0.75, 16, 70);

    this.sim.syncTextures();
    this.water.update();
    this.unitRenderer.update(this.units, this.limbs, this.verlet, this.time);
    this.enemyManager.render(this.time);
    this.items.render(this.time);
    this.projectiles.render();
    this.particles.render();
    this.ui.update(rawDt);
    this.audio.update(rawDt);
    this._updateDOF();
    this.engine.render(rawDt);
    this.input.endFrame();

    if (this._debugEl && this.frame % 10 === 0) {
      const r = this.engine.renderer.info.render;
      this._debugEl.textContent = `fps ${this.fps.toFixed(0)}  calls ${r.calls}  tris ${(r.triangles / 1000).toFixed(0)}k\n` +
        `water ${this.sim.stats.waterMs.toFixed(2)}ms  sand ${this.sim.stats.sandMs.toFixed(2)}ms\n` +
        `units ${this.units.length}  enemies ${this.enemies.length}  items ${this.items.list.length}  particles ${this.particles.n}`;
    }
    this.frame++;
  }

  _fixedUpdate(dt) {
    const STEP = 1 / 60;
    this.physAcc += dt;
    let n = 0;
    while (this.physAcc >= STEP && n < 4) {
      this.physAcc -= STEP;
      this.physTime += STEP;
      n++;
      this.spatial.clear();
      for (const u of this.units) if (u.alive && !u.hidden && u.p.length) this.spatial.insert(u, u.pos.x, u.pos.z);
      for (const e of this.enemies) if (e.alive) this.spatial.insert(e, e.pos.x, e.pos.z);
      this.events.emit('step', STEP, this.physTime);
      this.workerAI.update(STEP);
      this.combatAI.update(STEP);
      this.enemyManager.update(STEP);
      for (const u of this.units) u.preStep(STEP, this.physTime);
      for (let i = this.dragons.length - 1; i >= 0; i--) {
        const d = this.dragons[i];
        if (!d.alive) { this.dragons.splice(i, 1); continue; }
        d.update(STEP);
      }
      this.verlet.step(STEP);
      this.limbs.update(STEP);
      for (let i = this.units.length - 1; i >= 0; i--) {
        const u = this.units[i];
        if (u.crumbled) { this.units.splice(i, 1); if (u.selected) this.interaction.selected.delete(u); }
      }
    }
    if (n === 4) this.physAcc = 0;
  }

  _updateDOF() {
    const dof = this.engine.dof;
    const camDist = this.camera.position.distanceTo(this.rig.focusPoint);
    dof.cocMaterial.focusDistance = camDist;
    dof.cocMaterial.focusRange = clamp(camDist * 0.85, 4, 120) * (this.rig.mode === 'cinematic' ? this.rig.cine.focusMul || 1 : 1);
    dof.bokehScale = lerp(3.4, 1.0, smoothstep(5, 90, camDist));
  }
}
