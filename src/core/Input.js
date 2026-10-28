// Low-level input: keyboard state, pointer gestures (click / hold / drag),
// wheel, pointer lock and helpers to build picking rays.
import * as THREE from 'three';

export class Input {
  constructor(dom, camera) {
    this.dom = dom;
    this.camera = camera;
    this.keys = Object.create(null);
    this.pressed = new Set(); // keys pressed this frame
    this.mouse = new THREE.Vector2(); // pixels
    this.ndc = new THREE.Vector2(-10, -10); // off-screen until the mouse moves
    this.buttons = 0;
    this.handlers = [];
    this.locked = false;
    this.freeLook = false;
    this.lockDX = 0;
    this.lockDY = 0;
    this._ray = new THREE.Raycaster();
    this.downInfo = [null, null, null];
    this.overUI = false;

    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (!this.keys[e.code]) this.pressed.add(e.code);
      this.keys[e.code] = true;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this._emit('keydown', e);
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      this._emit('keyup', e);
    });
    window.addEventListener('blur', () => {
      this.keys = Object.create(null);
      this.buttons = 0;
    });

    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._move(e));
    window.addEventListener('pointerup', (e) => this._up(e));
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._emit('wheel', e);
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      this._emit('lockchange', this.locked);
    });
  }

  on(fn) {
    this.handlers.push(fn);
    return () => (this.handlers = this.handlers.filter((h) => h !== fn));
  }

  _emit(type, e, extra) {
    for (const h of this.handlers) h(type, e, extra);
  }

  _setMouse(e) {
    this.mouse.set(e.clientX, e.clientY);
    this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }

  _down(e) {
    this.dom.focus();
    this._setMouse(e);
    this.buttons = e.buttons;
    try { this.dom.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.downInfo[e.button] = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, held: false };
    this._emit('down', e);
  }

  _move(e) {
    // mouse-look deltas; without pointer lock (e.g. in a sandboxed frame) plain movement still steers
    if (this.locked || this.freeLook) {
      this.lockDX += e.movementX || 0;
      this.lockDY += e.movementY || 0;
    }
    const px = this.mouse.x, py = this.mouse.y;
    this._setMouse(e);
    this.buttons = e.buttons;
    for (let b = 0; b < 3; b++) {
      const d = this.downInfo[b];
      if (d && !d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7) {
        d.moved = true;
        this._emit('dragstart', e, { button: b });
      }
    }
    this._emit('move', e, { dx: e.clientX - px, dy: e.clientY - py });
  }

  _up(e) {
    this._setMouse(e);
    this.buttons = e.buttons;
    const d = this.downInfo[e.button];
    if (d) {
      const dt = performance.now() - d.t;
      if (!d.moved && !d.held && dt < 450) this._emit('click', e, { button: e.button });
      if (d.moved) this._emit('dragend', e, { button: e.button });
      if (d.held) this._emit('holdend', e, { button: e.button });
    }
    this.downInfo[e.button] = null;
    this._emit('up', e);
  }

  // called every frame
  update() {
    const now = performance.now();
    for (let b = 0; b < 3; b++) {
      const d = this.downInfo[b];
      if (d && !d.moved && !d.held && now - d.t > 380) {
        d.held = true;
        this._emit('holdstart', null, { button: b });
      }
    }
  }

  endFrame() {
    this.pressed.clear();
    this.lockDX = 0;
    this.lockDY = 0;
  }

  isDown(b) { return !!this.downInfo[b]; }
  isHolding(b) { return !!(this.downInfo[b] && this.downInfo[b].held); }
  isDragging(b) { return !!(this.downInfo[b] && this.downInfo[b].moved); }

  ray(ndc = this.ndc) {
    this._ray.setFromCamera(ndc, this.camera);
    return this._ray.ray;
  }

  requestLock() {
    try {
      const p = this.dom.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* ignore */ }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
