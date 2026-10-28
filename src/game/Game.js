// Central game object: owns every system and runs the frame loop.
import * as THREE from 'three';
import { Engine } from '../core/Engine.js';
import { Input } from '../core/Input.js';
import { CameraRig } from '../core/CameraRig.js';
import { BeachSim } from '../world/BeachSim.js';
import { TerrainMesh } from '../world/TerrainMesh.js';
import { WaterMesh } from '../world/WaterMesh.js';
import { Sky } from '../world/Sky.js';
import { Props } from '../world/Props.js';
import { Particles } from '../world/Particles.js';
import { globalUniforms } from '../world/shaderLib.js';
import { Events } from '../core/Events.js';
import { SpatialHash } from '../core/SpatialHash.js';
import { Verlet } from '../entities/Verlet.js';
import { Limbs } from '../entities/Limbs.js';
import { Sandling } from '../entities/Sandling.js';
import { SandlingRenderer } from '../entities/SandlingRenderer.js';
import { BOUNDS } from '../world/config.js';
import { clamp, lerp, smoothstep, rnd } from '../core/math.js';

export class Game {
  constructor(container) {
    this.params = new URLSearchParams(location.search);
    this.debug = this.params.has('debug');
    this.engine = new Engine(container);
    this.scene = this.engine.scene;
    this.camera = this.engine.camera;
    this.input = new Input(this.engine.renderer.domElement, this.camera);
    this.sim = new BeachSim();
    this.terrain = new TerrainMesh(this.scene, this.sim);
    this.water = new WaterMesh(this.scene, this.sim);
    this.sky = new Sky(this.engine);
    this.props = new Props(this.scene, this.sim);
    this.rig = new CameraRig(this.camera, this.sim);
    this.events = new Events();
    this.particles = new Particles(this.scene, this.sim);
    this.verlet = new Verlet(this.sim);
    this.limbs = new Limbs(this);
    this.units = [];
    this.enemies = [];
    this.unitRenderer = new SandlingRenderer(this.scene);
    this.spatial = new SpatialHash(2);
    this.staticColliders = [];
    for (const c of this.props.colliders) {
      if (c.kind === 'bush') continue;
      const col = { x: c.x, z: c.z, r: c.r * (c.kind === 'rock' ? 0.85 : 1), top: c.h, walkTop: c.kind === 'rock' && c.r < 1.2 };
      this.staticColliders.push(col);
      this.verlet.colliders.push(col);
    }
    this.physAcc = 0;
    this.physTime = 0;

    this.time = 0;
    this.timeScale = 1;
    this.paused = false;
    this.clock = new THREE.Timer();
    this.frame = 0;
    this.fps = 60;

    this._bindCameraControls();
    if (this.debug) this._makeDebugOverlay();
    if (this.params.get('test') === 'units') this._testUnits();
  }

  _bindCameraControls() {
    const input = this.input;
    input.on((type, e, extra) => {
      if (type === 'wheel') {
        this.rig.zoom(Math.exp(e.deltaY * 0.0012));
      } else if (type === 'move' && this.rig.mode === 'rts') {
        if (input.isDragging(2) || input.isDragging(1)) {
          this.rig.rotate(-extra.dx * 0.006, extra.dy * 0.003);
        }
      }
    });
  }

  _makeDebugOverlay() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;font:12px/1.35 monospace;color:#fff;background:rgba(0,0,0,.45);padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre';
    document.body.appendChild(el);
    this._debugEl = el;
  }

  // ---- debug helpers -------------------------------------------------------
  _testUnits() {
    const types = ['worker', 'worker', 'worker', 'knight', 'archer', 'spearman', 'cavalry'];
    for (let i = 0; i < 26; i++) {
      const t = types[i % types.length];
      this.spawnUnit(t, rnd(-8, 8), rnd(2, 12));
    }
    this.king = this.spawnUnit('king', 0, 6, { yaw: 0 });
    this.events.on('step', (dt) => {
      for (const u of this.units) {
        if (u === this.king) continue;
        if (!u.moveTarget && Math.random() < dt * 0.4) u.moveTo(rnd(-9, 9), rnd(1, 13));
        if (u.type === 'knight' && Math.random() < dt * 0.3) u.startAttack();
        if (u.type === 'archer' && Math.random() < dt * 0.2) u.startAttack();
      }
    });
  }


  fastForward(seconds) {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      this.time += 1 / 60;
      globalUniforms.uTime.value = this.time;
      this.sim.update(1 / 60);
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

  // ---- shared queries ---------------------------------------------------------
  separation(u, r) {
    const out = this._sep || (this._sep = { x: 0, z: 0 });
    out.x = 0; out.z = 0;
    const px = u.pos.x, pz = u.pos.z;
    this.spatial.query(px, pz, r * 2, (o) => {
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

  clampToWorld(pos) {
    pos.x = clamp(pos.x, BOUNDS.minX, BOUNDS.maxX);
    pos.z = clamp(pos.z, BOUNDS.minZ, BOUNDS.maxZ);
  }

  spawnUnit(type, x, z, opts) {
    const u = new Sandling(this, type, x, z, opts);
    this.units.push(u);
    return u;
  }

  start() {
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
    const dt = this.paused ? 0 : rawDt * this.timeScale;
    this.time += dt;
    globalUniforms.uTime.value = this.time;

    if (dt > 0) {
      this._fixedUpdate(dt);
      this.sim.update(dt);
      this.particles.update(dt);
    }
    globalUniforms.uSeaLevel.value = this.sim.seaLevel;

    this.sky.update(dt);
    this.rig.update(rawDt, this.input.keys);
    this.sky.shadowFocus.copy(this.rig.target);
    this.sky.shadowSize = clamp(this.rig.dist * 0.75, 18, 70);

    this.sim.syncTextures();
    this.water.update();
    this.unitRenderer.update(this.units, this.limbs, this.verlet, this.time);
    this.particles.render();
    this._updateDOF();
    this.engine.render(rawDt);
    this.input.endFrame();

    if (this._debugEl && this.frame % 10 === 0) {
      const r = this.engine.renderer.info.render;
      this._debugEl.textContent = `fps ${this.fps.toFixed(0)}  calls ${r.calls}  tris ${(r.triangles / 1000).toFixed(0)}k\n` +
        `water ${this.sim.stats.waterMs.toFixed(2)}ms  sand ${this.sim.stats.sandMs.toFixed(2)}ms`;
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
      for (const u of this.units) if (u.alive) this.spatial.insert(u, u.pos.x, u.pos.z);
      for (const e of this.enemies) if (e.alive) this.spatial.insert(e, e.pos.x, e.pos.z);
      this.events.emit('step', STEP, this.physTime);
      for (const u of this.units) u.preStep(STEP, this.physTime);
      this.verlet.step(STEP);
      this.limbs.update(STEP);
      // cull crumbled units
      for (let i = this.units.length - 1; i >= 0; i--) if (this.units[i].crumbled) this.units.splice(i, 1);
    }
    if (n === 4) this.physAcc = 0;
  }

  _updateDOF() {
    const dof = this.engine.dof;
    const camDist = this.camera.position.distanceTo(this.rig.focusPoint);
    dof.cocMaterial.focusDistance = camDist;
    dof.cocMaterial.focusRange = clamp(camDist * 0.85, 5, 120);
    dof.bokehScale = lerp(3.2, 1.0, smoothstep(6, 90, camDist));
  }
}
