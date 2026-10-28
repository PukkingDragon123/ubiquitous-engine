// Natural mouse interactions: tools act directly on the physical beach.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp, rnd } from '../core/math.js';
import { BUILDINGS } from '../buildings/buildingTypes.js';
import { getModel } from '../buildings/Buildings.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _plane = new THREE.Plane();
const _ray = new THREE.Ray();

export const TOOLS = ['hand', 'shovel', 'bucket', 'rake', 'build', 'horn'];

export class Interaction {
  constructor(game) {
    this.game = game;
    this.tool = 'hand';
    this.cursor = new THREE.Vector3();
    this.cursorValid = false;
    this.hover = null; // {kind, obj}
    this.grab = null;
    this.selected = new Set();
    this.summon = null;
    this.dig = null;
    this.blueprint = null; // type being placed
    this.ghostRot = 0;
    this.wallStart = null;
    this.bucketCooldown = 0;
    this.enabled = false;
    this.toolPose = 0;

    const scene = game.scene;
    // terrain-conforming ring cursor
    const N = 72;
    this.ringN = N;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 2 * 3), 3));
    const idx = [];
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.ring = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xfff4d6, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 7;
    scene.add(this.ring);
    this.ringRadius = 0.6;
    this.ringColor = new THREE.Color(0xfff4d6);

    // tool models
    this.toolGroup = new THREE.Group();
    scene.add(this.toolGroup);
    this.shovelModel = makeBigShovel();
    this.bucketModel = makeBigBucket();
    this.rakeModel = makeBigRake();
    this.hornModel = makeHorn();
    for (const m of [this.shovelModel, this.bucketModel, this.rakeModel, this.hornModel]) { m.visible = false; this.toolGroup.add(m); }
    this.toolPos = new THREE.Vector3();

    // placement ghost
    this.ghost = new THREE.Group();
    scene.add(this.ghost);
    this.wallGhosts = [];

    this._bind();
  }

  setTool(t) {
    if (t === this.tool) return;
    this.cancelPlacement();
    this.tool = t;
    this.game.events.emit('tool', t);
  }

  startPlacement(type) {
    this.blueprint = type;
    this.tool = 'build';
    this.ghostRot = 0;
    this._makeGhost(type);
    this.game.events.emit('tool', 'build');
  }

  cancelPlacement() {
    this.blueprint = null;
    this.wallStart = null;
    this.ghost.clear();
    for (const g of this.wallGhosts) this.game.scene.remove(g);
    this.wallGhosts = [];
    if (this.tool === 'build') { this.tool = 'hand'; this.game.events.emit('tool', 'hand'); }
  }

  _makeGhost(type) {
    this.ghost.clear();
    const m = getModel(type);
    const mat = this.game.buildings.placeGhostMat;
    for (const geo of [...Object.values(m.parts), ...Object.values(m.lift)]) this.ghost.add(new THREE.Mesh(geo, mat));
    this.ghost.renderOrder = 8;
  }

  // ---- input binding --------------------------------------------------------------
  _bind() {
    const input = this.game.input;
    input.on((type, e, extra) => {
      if (!this.enabled || this.game.possession?.active) return;
      const btn = extra?.button ?? e?.button;
      switch (type) {
        case 'down': this._down(e.button, e); break;
        case 'dragstart': this._dragStart(btn, e); break;
        case 'dragend': this._dragEnd(btn, e); break;
        case 'click': this._click(btn, e); break;
        case 'holdstart': this._holdStart(btn); break;
        case 'up': this._up(e.button, e); break;
        case 'move': this._move(e, extra); break;
        case 'keydown': this._key(e); break;
        default: break;
      }
    });
  }

  _key(e) {
    const k = e.code;
    if (k === 'Escape') {
      if (this.blueprint) this.cancelPlacement();
      else if (this.selected.size) this.clearSelection();
      else if (this.tool !== 'hand') this.setTool('hand');
    }
    if (k === 'KeyR' && this.blueprint) this.ghostRot += Math.PI / 8;
    const map = { Digit1: 'hand', Digit2: 'shovel', Digit3: 'bucket', Digit4: 'rake', Digit6: 'horn' };
    if (map[k]) this.setTool(map[k]);
    if (k === 'Digit5' || k === 'KeyB') this.game.events.emit('openBlueprints');
  }

  _down(button, e) {
    const g = this.game;
    if (button === 0) {
      if (this.tool === 'hand' && this.hover && !e.shiftKey) {
        const h = this.hover;
        if (h.kind === 'unit' || h.kind === 'enemy' || h.kind === 'item' || h.kind === 'boulder') this.pendingGrab = h;
      }
      if (this.tool === 'shovel' || this.tool === 'rake') this.dig = { last: this.cursor.clone(), raise: e.shiftKey, t: 0 };
      if (this.tool === 'build' && this.blueprint && BUILDINGS[this.blueprint].line && this.cursorValid) this.wallStart = this.cursor.clone();
    }
    if (button === 2 && (this.tool === 'shovel')) this.dig = { last: this.cursor.clone(), raise: true, t: 0 };
  }

  _dragStart(button, e) {
    if (button !== 0) return;
    if (this.pendingGrab) { this._beginGrab(this.pendingGrab); this.pendingGrab = null; return; }
    if (this.tool === 'hand') {
      if (e.shiftKey) this.box = { x0: this.game.input.mouse.x, y0: this.game.input.mouse.y };
      else this.panning = { last: this.cursor.clone() };
    }
  }

  _dragEnd(button) {
    if (button !== 0) return;
    if (this.box) { this._boxSelect(); this.box = null; this.game.events.emit('box', null); }
  }

  _up(button) {
    if (button === 0) {
      if (this.grab) this._endGrab();
      this.pendingGrab = null;
      this.panning = null;
      if (this.summon) this._endSummon();
      if (this.wallStart && this.blueprint) this._placeWall();
      this.dig = null;
    }
    if (button === 2) this.dig = null;
  }

  _click(button, e) {
    const g = this.game;
    if (button === 0) {
      if (this.tool === 'build' && this.blueprint) {
        if (!BUILDINGS[this.blueprint].line) this._place();
        return;
      }
      if (this.tool === 'bucket') { this._bucket(); return; }
      if (this.tool === 'horn') { this._command(this.cursor, e.shiftKey); return; }
      if (this.tool === 'hand') {
        const h = this.hover;
        if (!h) { if (!e.shiftKey) this.clearSelection(); return; }
        if (h.kind === 'unit') {
          if (!e.shiftKey) this.clearSelection();
          this.select(h.obj);
        } else if (h.kind === 'building') {
          g.events.emit('inspect', h.obj);
        } else if (h.kind === 'item') {
          const it = h.obj;
          if (it.def.special === 'stopwatch') g.events.emit('inspectStopwatch', it);
          else if (it.def.special === 'bottle' || it.def.special === 'jar') g.events.emit('openSpecial', it);
          else g.workerAI.summon(it.pos.x, it.pos.z, 1, 3);
        }
      }
    } else if (button === 2) {
      // right click: possess a unit, or command selection
      const h = this.hover;
      if (h && h.kind === 'unit' && h.obj.alive) { g.events.emit('possess', h.obj); return; }
      if (this.selected.size && this.cursorValid) this._command(this.cursor, e.shiftKey);
      else if (this.blueprint) this.cancelPlacement();
    }
  }

  _holdStart(button) {
    if (button !== 0 || this.tool !== 'hand' || this.pendingGrab || !this.cursorValid) return;
    if (this.selected.size) { this._command(this.cursor, false); return; }
    this.summon = { x: this.cursor.x, z: this.cursor.z, t: 0, called: 0 };
    this.game.events.emit('summonStart', this.summon);
  }

  _endSummon() {
    const s = this.summon;
    this.summon = null;
    this.game.events.emit('summonEnd', s);
  }

  _move(e, extra) {
    if (this.panning && this.tool === 'hand') {
      // grab-the-world panning: keep the grabbed point under the cursor
      const ray = this.game.input.ray();
      _plane.set(_v.set(0, 1, 0), -this.panning.last.y);
      const hit = ray.intersectPlane(_plane, _v2);
      if (hit) {
        this.game.rig.panWorld(this.panning.last.x - hit.x, this.panning.last.z - hit.z);
      }
    }
    if (this.box) this.game.events.emit('box', { x0: this.box.x0, y0: this.box.y0, x1: this.game.input.mouse.x, y1: this.game.input.mouse.y });
  }

  // ---- selection / commands --------------------------------------------------------
  select(u) {
    if (!u || !u.alive) return;
    this.selected.add(u);
    u.selected = true;
    this.game.events.emit('selection', this.selected);
  }
  clearSelection() {
    for (const u of this.selected) u.selected = false;
    this.selected.clear();
    this.game.events.emit('selection', this.selected);
  }
  _boxSelect() {
    const g = this.game;
    const b = this.box;
    const m = g.input.mouse;
    const x0 = Math.min(b.x0, m.x), x1 = Math.max(b.x0, m.x), y0 = Math.min(b.y0, m.y), y1 = Math.max(b.y0, m.y);
    this.clearSelection();
    for (const u of g.units) {
      if (!u.alive || u.hidden || u.puppet) continue;
      const s = this._screen(u.pos.x, u.pos.y + 0.5, u.pos.z);
      if (s && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) this.select(u);
    }
  }
  _command(p, queue) {
    const g = this.game;
    let units = [...this.selected].filter((u) => u.alive);
    if (!units.length) units = g.units.filter((u) => u.alive && u.def.weapon && u.type !== 'king' && !u.garrisoned && !u.puppet);
    if (!units.length) return;
    g.combatAI.command(units, p.x, p.z);
    g.events.emit('command', p, units);
  }

  // ---- grabbing ------------------------------------------------------------------------
  _beginGrab(h) {
    const g = this.game;
    const obj = h.obj;
    const V = g.verlet;
    let y = g.sim.heightAt(this.cursor.x, this.cursor.z);
    if (h.kind === 'unit' || h.kind === 'enemy') {
      if (!obj.p || !obj.p.length) return;
      if (h.kind === 'enemy' && (obj.def.boss || obj.size > 2)) { g.events.emit('toast', 'Far too heavy to lift!', 'warn'); return; }
      if (obj.type === 'dragon') return;
      obj.held = true;
      if (obj.knockDown) obj.knockDown(1);
      const pi = obj.grabParticle ? obj.grabParticle() : obj.p[3] >= 0 ? obj.p[3] : obj.p[0];
      this.grab = { kind: h.kind, obj, p: pi, height: 1.6 + (h.kind === 'enemy' ? 0.6 : 0), hist: [] };
      g.events.emit('grab', obj);
    } else if (h.kind === 'item') {
      obj.held = true;
      for (const u of obj.carriers.slice()) obj.release(u);
      this.grab = { kind: 'item', obj, height: 1.3, hist: [] };
    } else if (h.kind === 'boulder') {
      this.grab = { kind: 'boulder', obj, height: 0, hist: [] };
      obj.held = true;
    }
    if (this.grab) this.grab.baseY = y;
  }

  _updateGrab(dt) {
    const gr = this.grab;
    const g = this.game;
    const ray = g.input.ray();
    // anchor on a horizontal plane above the ground under the cursor
    const gy = Math.max(g.sim.heightAt(this.cursor.x, this.cursor.z), g.sim.seaLevel);
    const planeY = gy + gr.height;
    _plane.set(_v.set(0, 1, 0), -planeY);
    const hit = ray.intersectPlane(_plane, _v2);
    if (!hit) return;
    const target = hit;
    gr.hist.push({ x: target.x, y: target.y, z: target.z, t: g.time });
    if (gr.hist.length > 8) gr.hist.shift();
    const V = g.verlet;
    if (gr.kind === 'unit' || gr.kind === 'enemy') {
      if (!gr.obj.p.length || V.flags[gr.p] === 0) { this._endGrab(); return; }
      // pull the grabbed particle strongly toward the anchor (body dangles)
      const k = 0.35;
      V.px[gr.p] += (target.x - V.px[gr.p]) * k;
      V.py[gr.p] += (target.y - V.py[gr.p]) * k;
      V.pz[gr.p] += (target.z - V.pz[gr.p]) * k;
      V.ox[gr.p] = lerp(V.ox[gr.p], V.px[gr.p], 0.5);
      V.oy[gr.p] = lerp(V.oy[gr.p], V.py[gr.p], 0.5);
      V.oz[gr.p] = lerp(V.oz[gr.p], V.pz[gr.p], 0.5);
      gr.obj.held = true;
      if (gr.obj.knocked !== undefined) gr.obj.knocked = Math.max(gr.obj.knocked, 0.5);
    } else if (gr.kind === 'item') {
      const it = gr.obj;
      it.pos.x = damp(it.pos.x, target.x, 18, dt);
      it.pos.y = damp(it.pos.y, target.y, 18, dt);
      it.pos.z = damp(it.pos.z, target.z, 18, dt);
      it.rot.x += dt * 2; it.rot.z += dt * 1.3;
    } else if (gr.kind === 'boulder') {
      gr.obj.dragTo(target.x, target.z, dt);
    }
  }

  _endGrab() {
    const gr = this.grab;
    this.grab = null;
    if (!gr) return;
    const g = this.game;
    // throw velocity from recent motion
    let vx = 0, vy = 0, vz = 0;
    if (gr.hist.length >= 2) {
      const a = gr.hist[0], b = gr.hist[gr.hist.length - 1];
      const dt = Math.max(0.016, b.t - a.t);
      vx = (b.x - a.x) / dt; vy = (b.y - a.y) / dt; vz = (b.z - a.z) / dt;
    }
    const sp = Math.hypot(vx, vz);
    const maxSp = 16;
    if (sp > maxSp) { vx *= maxSp / sp; vz *= maxSp / sp; }
    if (gr.kind === 'unit' || gr.kind === 'enemy') {
      const o = gr.obj;
      o.held = false;
      if (o.applyImpulse) o.applyImpulse(vx * 0.9, Math.max(vy, 0) * 0.5 + sp * 0.15, vz * 0.9);
      if (o.knockDown) o.knockDown(1.2 + sp * 0.1);
      o.thrownBy = 'hand';
      o.thrownT = g.time;
      g.events.emit('throw', o, sp);
    } else if (gr.kind === 'item') {
      const it = gr.obj;
      it.held = false;
      it.vel.set(vx * 0.8, vy * 0.5, vz * 0.8);
      it.spin.set(rnd(-6, 6), 0, rnd(-6, 6));
    } else if (gr.kind === 'boulder') {
      gr.obj.held = false;
      gr.obj.release();
    }
  }

  // ---- terrain tools -------------------------------------------------------------------
  _digStep(dt) {
    const g = this.game, sim = g.sim;
    const d = this.dig;
    const c = this.cursor;
    if (!this.cursorValid) return;
    const dx = c.x - d.last.x, dz = c.z - d.last.z;
    const len = Math.hypot(dx, dz);
    d.t += dt;
    if (this.tool === 'rake') {
      sim.smooth(c.x, c.z, 1.3, Math.min(1, dt * 6));
      if (Math.random() < dt * 8) g.particles.dust(c.x, sim.heightAt(c.x, c.z) + 0.05, c.z, 1, 0.4);
      d.last.copy(c);
      g.events.emit('rake', c);
      return;
    }
    const radius = 0.62;
    // dig continuously; along the drag path when moving
    const steps = Math.max(1, Math.ceil(len / 0.25));
    const perp = len > 0.01 ? { x: -dz / len, z: dx / len } : { x: 1, z: 0 };
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const px = d.last.x + dx * t, pz = d.last.z + dz * t;
      if (d.raise) {
        // pile sand: take from around, heap at the cursor
        sim.deposit(px, pz, 0.8, dt * 0.55 / steps, 0.6);
        if (Math.random() < 0.3) g.particles.sandSpray(px, sim.heightAt(px, pz) + 0.6, pz, 0, 0, 2, 0, 0.5, 0.3);
      } else {
        const depth = (len > 0.01 ? 0.14 : 0.9 * dt) / Math.max(1, steps * 0.6);
        const res = sim.dig(px, pz, radius, depth);
        if (res.vol > 0) {
          // throw the spoil to the right of the stroke
          const side = 1.15;
          const sx = px + perp.x * side, sz = pz + perp.z * side;
          sim.deposit(sx, sz, 0.75, res.vol * 0.7, res.wet);
          const gy = sim.heightAt(px, pz);
          g.particles.sandSpray(px, gy + 0.1, pz, perp.x * 0.8, perp.z * 0.8, Math.min(10, 2 + Math.floor(res.vol * 200)), res.vol * 0.3, res.wet, 0.8);
          g.events.emit('dig', px, pz, res.vol);
        }
      }
    }
    d.last.copy(c);
  }

  _bucket() {
    const g = this.game;
    if (!this.cursorValid || this.bucketCooldown > 0) return;
    // clicking an existing bucket tower stacks it higher
    const existing = g.buildings.list.find((b) => b.alive && b.type === 'bucket' && Math.hypot(b.pos.x - this.cursor.x, b.pos.z - this.cursor.z) < 0.9);
    if (existing) {
      if (existing.stack < 3) { existing.addStack(); this.bucketCooldown = 0.45; this.bucketAnim = 1; g.events.emit('bucket', existing.pos); }
      return;
    }
    const ok = g.buildings.canPlace('bucket', this.cursor.x, this.cursor.z, 0);
    if (!ok.ok) { g.events.emit('toast', ok.reason, 'warn'); return; }
    const b = g.buildings.place('bucket', this.cursor.x, this.cursor.z, rnd(0, Math.PI * 2), { instant: true, free: true, stamp: true });
    this.bucketCooldown = 0.45;
    this.bucketAnim = 1;
    g.events.emit('bucket', b.pos);
  }

  _place() {
    const g = this.game;
    const type = this.blueprint;
    const def = BUILDINGS[type];
    if (!this.cursorValid) return;
    const ok = g.buildings.canPlace(type, this.cursor.x, this.cursor.z, this.ghostRot);
    if (!ok.ok) { g.events.emit('toast', ok.reason, 'warn'); return; }
    if (!g.economy.spend(def.cost)) { g.events.emit('toast', 'Not enough resources', 'warn', g.economy.missing(def.cost)); return; }
    g.buildings.place(type, this.cursor.x, this.cursor.z, this.ghostRot);
    if (!this.game.input.keys.ShiftLeft && !this.game.input.keys.ShiftRight) this.cancelPlacement();
  }

  _wallSegments() {
    const a = this.wallStart, b = this.cursor;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / 1.9));
    const segs = [];
    const rot = Math.atan2(dx, dz) + Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      segs.push({ x: a.x + dx * t, z: a.z + dz * t, rot });
    }
    if (len < 0.5) segs.length = 1;
    return segs;
  }

  _placeWall() {
    const g = this.game;
    const segs = this._wallSegments();
    this.wallStart = null;
    for (const gh of this.wallGhosts) g.scene.remove(gh);
    this.wallGhosts = [];
    let placed = 0, blocked = 0, broke = false;
    for (const s of segs) {
      const ok = g.buildings.canPlace('wall', s.x, s.z, s.rot);
      if (!ok.ok) { blocked++; continue; }
      if (!g.economy.spend(BUILDINGS.wall.cost)) { broke = true; break; }
      g.buildings.place('wall', s.x, s.z, s.rot);
      placed++;
    }
    if (broke) g.events.emit('toast', 'Ran out of shells for the wall', 'warn');
    else if (blocked && !placed) g.events.emit('toast', 'Something is in the way', 'warn');
    if (!this.game.input.keys.ShiftLeft) this.cancelPlacement();
  }

  // ---- per frame ---------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    this.bucketCooldown -= dt;
    // cursor raycast
    const ray = g.input.ray();
    const hit = g.sim.raycast(ray.origin, ray.direction, 800, false, _v);
    this.cursorValid = !!hit && !g.input.overUI;
    if (hit) this.cursor.copy(hit);

    // hover detection
    this.hover = null;
    if (this.enabled && !g.input.overUI && !this.grab && this.tool !== 'build') this.hover = this._pick(ray);
    for (const b of g.buildings.list) b.hover = this.hover && this.hover.obj === b;

    if (this.grab) this._updateGrab(dt);
    if (this.dig && (g.input.isDown(0) || g.input.isDown(2))) this._digStep(dt);
    if (this.summon) {
      const s = this.summon;
      s.t += dt;
      s.x = this.cursor.x; s.z = this.cursor.z;
      const want = Math.floor(s.t / 0.3) + 1;
      if (want > s.called) {
        const chosen = g.workerAI.summon(s.x, s.z, want, 4 + s.t * 1.5);
        s.called = want;
        if (chosen.length) g.events.emit('summoned', chosen.length, s);
      }
    }
    this._updateRing(dt);
    this._updateToolModel(dt);
    this._updateGhost(dt);
  }

  _screen(x, y, z) {
    _v2.set(x, y, z).project(this.game.camera);
    if (_v2.z > 1) return null;
    return { x: (_v2.x * 0.5 + 0.5) * window.innerWidth, y: (-_v2.y * 0.5 + 0.5) * window.innerHeight };
  }

  _pick(ray) {
    const g = this.game;
    const m = g.input.mouse;
    let best = null, bd = 30 * 30;
    const test = (kind, obj, x, y, z, r = 28) => {
      const s = this._screen(x, y, z);
      if (!s) return;
      const d = (s.x - m.x) ** 2 + (s.y - m.y) ** 2;
      if (d < bd && d < r * r) { bd = d; best = { kind, obj }; }
    };
    for (const u of g.units) if (u.alive && !u.hidden && u.p.length) { u.centerPos(_v); test('unit', u, _v.x, _v.y + 0.15, _v.z, 26); }
    for (const e of g.enemies) if (e.alive && e.p && e.p.length) test('enemy', e, e.pos.x, e.pos.y + 0.4 * (e.size || 1), e.pos.z, 30 * Math.min(2.5, e.size || 1));
    for (const d of g.dragons) if (d.alive) test('unit', d, d.pos.x, d.pos.y, d.pos.z, 34);
    for (const it of g.items.list) if (!it.carried) test('item', it, it.pos.x, it.pos.y + 0.1, it.pos.z, 20);
    if (g.boulders) for (const b of g.boulders.list) test('boulder', b, b.pos.x, b.pos.y + b.r * 0.4, b.pos.z, 26 + b.r * 10);
    if (best) return best;
    const bh = g.buildings.pick(ray);
    if (bh) return { kind: 'building', obj: bh.building };
    return null;
  }

  _updateRing(dt) {
    const g = this.game, sim = g.sim;
    let r = 0, col = 0xfff4d6, op = 0.75;
    if (!this.enabled || !this.cursorValid || g.possession?.active) r = 0;
    else if (this.tool === 'shovel') { r = 0.62; col = this.dig?.raise ? 0xffd27a : 0xffb38a; }
    else if (this.tool === 'rake') { r = 1.3; col = 0xb8f0a0; }
    else if (this.tool === 'bucket') { r = 0.7; col = 0xff9a8a; }
    else if (this.tool === 'horn') { r = 0.9; col = 0xffe066; }
    else if (this.summon) { r = 1 + this.summon.t * 1.2; col = 0xfff1a0; op = 0.9; }
    else if (this.tool === 'hand') { r = this.hover ? 0 : 0.35; op = 0.45; }
    this.ringRadius = damp(this.ringRadius, r, 14, dt);
    this.ringColor.lerp(new THREE.Color(col), Math.min(1, dt * 10));
    this.ring.material.color.copy(this.ringColor);
    this.ring.material.opacity = op;
    this.ring.visible = this.ringRadius > 0.05;
    if (!this.ring.visible) return;
    const pos = this.ring.geometry.attributes.position;
    const N = this.ringN;
    const w = Math.max(0.05, this.ringRadius * 0.12);
    const wob = this.summon ? Math.sin(g.time * 10) * 0.05 : 0;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let k = 0; k < 2; k++) {
        const rr = this.ringRadius + wob + (k ? w : -w) * 0.5;
        const x = this.cursor.x + ca * rr, z = this.cursor.z + sa * rr;
        const y = Math.max(sim.heightAt(x, z), sim.surfaceAt(x, z)) + 0.04;
        pos.setXYZ(i * 2 + k, x, y, z);
      }
    }
    pos.needsUpdate = true;
  }

  _updateToolModel(dt) {
    const g = this.game, sim = g.sim;
    const t = this.tool;
    const show = this.enabled && this.cursorValid && !g.possession?.active;
    this.shovelModel.visible = show && t === 'shovel';
    this.bucketModel.visible = show && t === 'bucket';
    this.rakeModel.visible = show && t === 'rake';
    this.hornModel.visible = show && t === 'horn';
    const active = (t === 'shovel' || t === 'rake') && this.dig && (g.input.isDown(0) || g.input.isDown(2));
    this.toolPose = damp(this.toolPose, active ? 1 : 0, 12, dt);
    const gy = sim.heightAt(this.cursor.x, this.cursor.z);
    const scale = clamp(g.rig.dist * 0.035, 0.7, 3);
    this.toolPos.x = damp(this.toolPos.x, this.cursor.x, 25, dt);
    this.toolPos.z = damp(this.toolPos.z, this.cursor.z, 25, dt);
    this.toolPos.y = damp(this.toolPos.y, gy, 25, dt);
    const camYaw = g.rig.yaw;
    if (t === 'shovel') {
      const m = this.shovelModel;
      const dig = this.toolPose;
      const bob = active ? Math.sin(g.time * 18) * 0.15 : 0;
      m.position.set(this.toolPos.x, this.toolPos.y + (1.4 - dig * 1.1 + bob) * scale * 0.6, this.toolPos.z);
      m.rotation.set(-0.5 - dig * 0.5, camYaw + 0.6, 0.25);
      m.scale.setScalar(scale);
    } else if (t === 'bucket') {
      const m = this.bucketModel;
      this.bucketAnim = Math.max(0, (this.bucketAnim || 0) - dt * 2.5);
      const a = this.bucketAnim;
      const slam = a > 0.6 ? (1 - a) / 0.4 : a / 0.6;
      m.position.set(this.toolPos.x, this.toolPos.y + (1.6 - slam * 1.4) * scale * 0.7, this.toolPos.z);
      m.rotation.set(Math.PI * (0.15 + slam * 0.85), camYaw, 0);
      m.scale.setScalar(scale);
    } else if (t === 'rake') {
      const m = this.rakeModel;
      const sweep = active ? Math.sin(g.time * 12) * 0.3 : 0;
      m.position.set(this.toolPos.x, this.toolPos.y + (1.0 - this.toolPose * 0.7) * scale * 0.6, this.toolPos.z);
      m.rotation.set(-0.7, camYaw + sweep, 0);
      m.scale.setScalar(scale);
    } else if (t === 'horn') {
      const m = this.hornModel;
      m.position.set(this.toolPos.x, this.toolPos.y + 1.5 * scale * 0.6 + Math.sin(g.time * 3) * 0.05, this.toolPos.z);
      m.rotation.set(0, camYaw + Math.sin(g.time * 2) * 0.2, 0.3);
      m.scale.setScalar(scale * 0.8);
    }
  }

  _updateGhost(dt) {
    const g = this.game;
    const show = this.tool === 'build' && this.blueprint && this.cursorValid && this.enabled;
    this.ghost.visible = !!show && !this.wallStart;
    if (!show) return;
    const type = this.blueprint;
    const def = BUILDINGS[type];
    if (def.line && this.wallStart) {
      const segs = this._wallSegments();
      while (this.wallGhosts.length < segs.length) {
        const gh = new THREE.Group();
        const m = getModel('wall');
        for (const geo of Object.values(m.parts)) gh.add(new THREE.Mesh(geo, g.buildings.placeGhostMat));
        g.scene.add(gh);
        this.wallGhosts.push(gh);
      }
      while (this.wallGhosts.length > segs.length) g.scene.remove(this.wallGhosts.pop());
      segs.forEach((s, i) => {
        const gh = this.wallGhosts[i];
        gh.position.set(s.x, g.sim.avgHeight(s.x, s.z, 1), s.z);
        gh.rotation.y = s.rot;
      });
      const afford = g.economy.canAfford(def.cost, segs.length);
      g.buildings.placeGhostMat.uniforms.uValid.value = afford ? 1 : 0;
      g.events.emit('placementInfo', { type, count: segs.length, cost: def.cost, afford });
      return;
    }
    const ok = g.buildings.canPlace(type, this.cursor.x, this.cursor.z, this.ghostRot);
    const afford = g.economy.canAfford(def.cost);
    g.buildings.placeGhostMat.uniforms.uValid.value = ok.ok && afford ? 1 : 0;
    this.ghost.position.set(this.cursor.x, g.sim.avgHeight(this.cursor.x, this.cursor.z, def.size), this.cursor.z);
    this.ghost.rotation.y = damp(this.ghost.rotation.y, this.ghostRot, 12, dt);
    g.events.emit('placementInfo', { type, count: 1, cost: def.cost, afford, ok: ok.ok, reason: ok.reason });
  }
}

// ---- big floating tool models -------------------------------------------------------------
function mat(color, rough = 0.35) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
}

function makeBigShovel() {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 10), mat(0x3a8fd8));
  handle.position.y = 0.95;
  const grip = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.04, 8, 16), mat(0x3a8fd8));
  grip.position.y = 1.78;
  const blade = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 10, 0, Math.PI, 0, Math.PI * 0.62), mat(0xff7a3a));
  blade.scale.set(1, 1.35, 0.45);
  blade.rotation.x = Math.PI;
  blade.position.y = 0.18;
  g.add(handle, grip, blade);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeBigBucket() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.45, 0.9, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xe8483c, roughness: 0.3, side: THREE.DoubleSide }));
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), mat(0xe8483c));
  bottom.rotation.x = Math.PI / 2;
  bottom.position.y = -0.45;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 8, 28), mat(0xffe066));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.45;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.025, 6, 24, Math.PI), mat(0xffe066));
  handle.position.y = 0.4;
  // a heap of wet sand inside
  const sand = new THREE.Mesh(new THREE.CircleGeometry(0.58, 20), new THREE.MeshStandardMaterial({ color: 0x9c7c52, roughness: 0.6 }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = 0.4;
  g.add(body, bottom, rim, handle, sand);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeBigRake() {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.6, 8), mat(0x5fbf5a));
  handle.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.1), mat(0x5fbf5a));
  head.position.y = 0.1;
  g.add(handle, head);
  for (let i = 0; i < 7; i++) {
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22, 6), mat(0x5fbf5a));
    t.rotation.x = Math.PI;
    t.position.set(-0.4 + i * 0.133, -0.03, 0);
    g.add(t);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeHorn() {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector2(0.05 + Math.pow(t, 3) * 0.35, t * 0.9));
  }
  const horn = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.25, metalness: 0.8, side: THREE.DoubleSide }));
  horn.rotation.z = Math.PI / 2;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 14), mat(0xc8323c));
  band.rotation.y = Math.PI / 2;
  band.position.x = -0.3;
  g.add(horn, band);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
