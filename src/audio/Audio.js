// Procedural sound: everything is synthesised with WebAudio at runtime.
import * as THREE from 'three';
import { clamp, rnd, pick, lerp } from '../core/math.js';

const _v = new THREE.Vector3();
const VOWELS = [[800, 1200], [400, 2000], [300, 2400], [450, 800], [325, 700], [600, 1000], [500, 1500]];
const PENTA = [0, 2, 4, 7, 9];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.master = 0.8;
    this.musicVol = 0.42;
    this.sfxVol = 0.85;
    this.ready = false;
    this.mood = 'calm';
    this.limits = new Map();
    const start = () => {
      if (!this.ctx) this.init();
      else if (this.ctx.state === 'suspended') this.ctx.resume();
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    this._bindEvents();
  }

  init() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch { return; }
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = this.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.005; comp.release.value = 0.25;
    this.out.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.out);
    this.music = ctx.createGain(); this.music.gain.value = this.musicVol * 0.55; this.music.connect(this.out);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.9; this.amb.connect(this.out);
    // shared reverb (generated impulse) for space
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(1.8, 2.5);
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.25;
    this.verbIn.connect(this.verb).connect(this.out);
    this.noiseW = this._noise('white');
    this.noiseP = this._noise('pink');
    this.noiseB = this._noise('brown');
    this._ambient();
    this._musicStart();
    this.ready = true;
  }

  setVolume(which, v) {
    if (which === 'master') { this.master = v; if (this.out) this.out.gain.value = v; }
    if (which === 'music') { this.musicVol = v; if (this.music) this.music.gain.value = v * 0.55; }
    if (which === 'sfx') { this.sfxVol = v; if (this.sfx) this.sfx.gain.value = v; }
  }

  // ---- building blocks ---------------------------------------------------------------
  _noise(kind) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  _impulse(sec, decay) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _src(buf, loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    if (!loop) s.loopStart = 0;
    return s;
  }

  // Spatial output for a world position: stereo pan + distance falloff.
  _spatial(pos, vol = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let gain = vol;
    if (pos) {
      const cam = this.game.camera;
      _v.copy(pos).project(cam);
      const pan = clamp(_v.x, -1, 1) * 0.8;
      const d = cam.position.distanceTo(pos);
      gain *= clamp(14 / (d + 4), 0.05, 1.4);
      if (_v.z > 1 || Math.abs(_v.x) > 1.6 || Math.abs(_v.y) > 1.6) gain *= 0.35;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.sfx);
    } else g.connect(this.sfx);
    g.gain.value = gain;
    return g;
  }

  _limit(key, ms) {
    const now = performance.now();
    const last = this.limits.get(key) || 0;
    if (now - last < ms) return false;
    this.limits.set(key, now);
    return true;
  }

  _env(param, t, a, peak, d, end = 0.0001) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(end, t + a + d);
  }

  // filtered noise burst
  noise(pos, { dur = 0.15, freq = 1000, q = 1, type = 'bandpass', vol = 0.5, sweepTo, buf = 'white', attack = 0.004, verb = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this._src(buf === 'pink' ? this.noiseP : buf === 'brown' ? this.noiseB : this.noiseW);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    this._env(g.gain, t, attack, vol, dur);
    const out = this._spatial(pos, 1);
    s.connect(f).connect(g).connect(out);
    if (verb) { const vg = ctx.createGain(); vg.gain.value = verb; g.connect(vg).connect(this.verbIn); }
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  tone(pos, { freq = 440, to, dur = 0.2, type = 'sine', vol = 0.3, attack = 0.005, verb = 0, delay = 0, detune = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = ctx.createGain();
    this._env(g.gain, t, attack, vol, dur);
    const out = this._spatial(pos, 1);
    o.connect(g).connect(out);
    if (verb) { const vg = ctx.createGain(); vg.gain.value = verb; g.connect(vg).connect(this.verbIn); }
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  // FM ping (metallic)
  fm(pos, { freq = 800, ratio = 3.5, index = 400, dur = 0.25, vol = 0.2, verb = 0.2 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain();
    car.frequency.value = freq; mod.frequency.value = freq * ratio;
    mg.gain.setValueAtTime(index, t); mg.gain.exponentialRampToValueAtTime(1, t + dur);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    this._env(g.gain, t, 0.002, vol, dur);
    const out = this._spatial(pos, 1);
    car.connect(g).connect(out);
    const vg = ctx.createGain(); vg.gain.value = verb; g.connect(vg).connect(this.verbIn);
    car.start(t); mod.start(t); car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
  }

  // Gibberish speech: formant-filtered syllables.
  babble(pos, text, { pitch = 520, speed = 1, vol = 0.22, shout = false, crab = false } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const n = clamp(Math.round(text.replace(/[^a-z]/gi, '').length / 3.2), 2, shout ? 9 : 16);
    let t = ctx.currentTime + 0.02;
    const out = this._spatial(pos, 1);
    for (let i = 0; i < n; i++) {
      const dur = (0.06 + Math.random() * 0.06) / speed * (shout ? 1.4 : 1);
      const vw = pick(VOWELS);
      const o = ctx.createOscillator();
      o.type = crab ? 'sawtooth' : 'triangle';
      const f0 = pitch * (1 + rnd(-0.12, 0.18)) * (i === n - 1 && text.endsWith('?') ? 1.3 : 1);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.linearRampToValueAtTime(f0 * (shout ? 0.85 : rnd(0.9, 1.12)), t + dur);
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = vw[0] * (pitch / 400) ** 0.3; f1.Q.value = 6;
      const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = vw[1] * (pitch / 400) ** 0.3; f2.Q.value = 8;
      const g = ctx.createGain();
      this._env(g.gain, t, 0.012, vol * (shout ? 1.8 : 1), dur);
      o.connect(f1).connect(g);
      o.connect(f2).connect(g);
      g.connect(out);
      o.start(t); o.stop(t + dur + 0.06);
      // consonant tick
      if (Math.random() < 0.5) {
        const s = this._src(this.noiseW);
        const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 3000;
        const ng = ctx.createGain();
        this._env(ng.gain, t, 0.002, vol * 0.25, 0.03);
        s.connect(hf).connect(ng).connect(out);
        s.start(t, Math.random()); s.stop(t + 0.05);
      }
      t += dur + 0.02 + Math.random() * 0.04 / speed;
    }
  }

  // ---- ambience ---------------------------------------------------------------------------
  _ambient() {
    const ctx = this.ctx;
    const mk = (buf, type, freq, q, vol) => {
      const s = this._src(buf, true);
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = vol;
      const p = ctx.createStereoPanner();
      s.connect(f).connect(g).connect(p).connect(this.amb);
      s.start(0, Math.random() * 1.8);
      return { s, f, g, p };
    };
    this.surf = mk(this.noiseB, 'lowpass', 420, 0.7, 0.0);
    this.wash = mk(this.noiseP, 'bandpass', 2600, 0.6, 0.0);
    this.wash2 = mk(this.noiseP, 'bandpass', 5200, 0.8, 0.0);
    this.wind = mk(this.noiseP, 'bandpass', 600, 1.2, 0.0);
    this.gullTimer = 6;
    this.crashCooldown = 0;
  }

  _updateAmbient(dt) {
    const game = this.game, sim = game.sim, ctx = this.ctx;
    const t = ctx.currentTime;
    const cam = game.camera;
    // wave activity at the shoreline nearest the camera focus
    const fx = clamp(game.rig.focusPoint.x, -45, 45);
    let shoreZ = -12;
    for (let z = 10; z > -30; z -= 1) { if (sim.depthAt(fx, z) > 0.05) { shoreZ = z; break; } }
    let foam = 0, depth = 0;
    for (let i = -3; i <= 3; i++) {
      foam += sim.foamAt(fx + i * 3, shoreZ - 1.5);
      depth += sim.depthAt(fx + i * 3, shoreZ + 0.5);
    }
    foam /= 7; depth /= 7;
    const camH = cam.position.y - Math.max(sim.heightAt(cam.position.x, cam.position.z), sim.seaLevel);
    const near = clamp(1 - camH / 90, 0.2, 1);
    const shoreDist = Math.abs(cam.position.z - shoreZ) + camH * 0.6;
    const prox = clamp(28 / (shoreDist + 10), 0.15, 1);
    const storm = clamp(sim.waveScale - 1, 0, 2);
    const surfV = (0.16 + foam * 0.5 + storm * 0.12) * prox * (0.6 + 0.4 * (1 - near));
    const washV = (0.02 + foam * 0.35 + depth * 0.25) * prox * near;
    this.surf.g.gain.setTargetAtTime(surfV, t, 0.3);
    this.surf.f.frequency.setTargetAtTime(300 + foam * 500 + storm * 150, t, 0.4);
    this.wash.g.gain.setTargetAtTime(washV, t, 0.15);
    this.wash.f.frequency.setTargetAtTime(1800 + foam * 2400, t, 0.2);
    this.wash2.g.gain.setTargetAtTime(washV * 0.5, t, 0.1);
    const gust = 0.5 + 0.5 * Math.sin(t * 0.13) * Math.sin(t * 0.07 + 1);
    this.wind.g.gain.setTargetAtTime((0.015 + gust * 0.03) * (0.4 + (1 - near) * 1.2) + storm * 0.02, t, 0.8);
    this.wind.f.frequency.setTargetAtTime(400 + gust * 500, t, 1.2);
    // stereo: sea is "north" — pan by camera yaw
    const yaw = game.rig.yaw;
    this.surf.p.pan.value = clamp(Math.sin(yaw) * 0.6, -0.8, 0.8);
    // seagulls by day
    this.gullTimer -= dt;
    if (this.gullTimer <= 0) {
      this.gullTimer = rnd(7, 18);
      if (!game.sky.isNight) this.gull();
    }
    this.crashCooldown -= dt;
  }

  gull() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const n = 1 + Math.floor(Math.random() * 3);
    let t = ctx.currentTime;
    const pan = ctx.createStereoPanner(); pan.pan.value = rnd(-0.8, 0.8);
    const g0 = ctx.createGain(); g0.gain.value = 0.05 * rnd(0.5, 1);
    g0.connect(pan).connect(this.amb);
    const vg = ctx.createGain(); vg.gain.value = 0.6; g0.connect(vg).connect(this.verbIn);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const base = rnd(1400, 1900);
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * 1.35, t + 0.08);
      o.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.35);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 3;
      const g = ctx.createGain();
      this._env(g.gain, t, 0.03, 1, 0.35);
      o.connect(f).connect(g).connect(g0);
      o.start(t); o.stop(t + 0.45);
      t += rnd(0.3, 0.55);
    }
  }

  crash(vol = 1) {
    if (!this.ready || this.crashCooldown > 0) return;
    this.crashCooldown = 1.2;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this._src(this.noiseP);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(5000, t); f.frequency.exponentialRampToValueAtTime(300, t + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * vol, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    s.connect(f).connect(g).connect(this.amb);
    const vg = ctx.createGain(); vg.gain.value = 0.4; g.connect(vg).connect(this.verbIn);
    s.start(t); s.stop(t + 2.8);
    this.tone(null, { freq: 60, to: 32, dur: 0.9, vol: 0.25 * vol });
  }

  // ---- music ---------------------------------------------------------------------------------
  _musicStart() {
    const ctx = this.ctx;
    this.mBus = ctx.createGain();
    this.mBus.gain.value = 1;
    this.mFilter = ctx.createBiquadFilter();
    this.mFilter.type = 'lowpass';
    this.mFilter.frequency.value = 9000;
    this.mBus.connect(this.mFilter).connect(this.music);
    const mv = ctx.createGain(); mv.gain.value = 0.35; this.mBus.connect(mv).connect(this.verbIn);
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.2;
    this.bar = 0;
    this.melodyNote = 0;
    this._sched = setInterval(() => this._schedule(), 30);
  }

  _schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const mood = this.mood;
    const bpm = mood === 'battle' || mood === 'boss' ? 124 : mood === 'tension' ? 100 : 88;
    const spb = 60 / bpm / 2; // eighth notes
    while (this.nextTime < ctx.currentTime + 0.12) {
      this._playStep(this.step, this.nextTime, spb, mood);
      this.nextTime += spb * (this.step % 2 === 0 ? 1.08 : 0.92); // gentle swing
      this.step = (this.step + 1) % 16;
      if (this.step === 0) this.bar++;
    }
  }

  _playStep(step, t, spb, mood) {
    const calm = mood === 'calm' || mood === 'menu';
    const battle = mood === 'battle' || mood === 'boss';
    const prog = calm ? [[48, [0, 4, 7]], [45, [0, 3, 7]], [41, [0, 4, 7, 11]], [43, [0, 4, 7]]]
      : battle ? [[45, [0, 3, 7]], [41, [0, 4, 7]], [48, [0, 4, 7]], [43, [0, 4, 7]]]
      : [[45, [0, 3, 7]], [41, [0, 4, 7]], [40, [0, 4, 7]], [45, [0, 3, 7]]];
    const [root, chord] = prog[this.bar % 4];
    if (mood === 'silent') return;
    // bass
    if (step === 0 || step === 8 || (battle && (step === 6 || step === 14))) this._bass(mtof(root - 12 + (battle && step === 14 ? 7 : 0)), t, spb * 3);
    // pad on bar start
    if (step === 0) this._pad(chord.map((c) => mtof(root + 12 + c)), t, spb * 15, calm ? 0.035 : 0.045);
    // marimba arpeggios / melody
    const density = calm ? 0.55 : battle ? 0.8 : 0.45;
    if (step % 2 === 0 || (battle && Math.random() < 0.4)) {
      if (Math.random() < density) {
        const scale = calm ? PENTA : MINOR;
        // wandering melody with stepwise motion
        this.melodyNote = clamp(this.melodyNote + pick([-2, -1, -1, 0, 1, 1, 2]), -3, 9);
        const deg = ((this.melodyNote % scale.length) + scale.length) % scale.length;
        const oct = Math.floor(this.melodyNote / scale.length);
        const midi = (calm ? 72 : 69) + scale[deg] + oct * 12;
        this._marimba(mtof(midi), t, calm ? 0.07 : 0.06);
      }
    }
    if (step % 4 === 2 && calm && Math.random() < 0.5) this._marimba(mtof(root + 24 + pick(chord)), t, 0.04);
    // shaker
    if (!calm || step % 2 === 1) this._shaker(t, (step % 4 === 2 ? 0.035 : 0.018) * (calm ? 0.7 : 1));
    // drums
    if (battle) {
      if (step === 0 || step === 8 || step === 11) this._drum(t, 1, mood === 'boss' ? 46 : 58);
      if (step === 4 || step === 12) this._drum(t, 0.6, 110);
      if (step === 15 && this.bar % 2 === 1) { this._drum(t, 0.5, 90); this._drum(t + spb * 0.5, 0.5, 80); }
      if (step === 0 && this.bar % 2 === 0) this._brass(chord.map((c) => mtof(root + 12 + c)), t, spb * 2);
    } else if (mood === 'tension') {
      if (step === 0 || step === 3) this._drum(t, step === 0 ? 0.55 : 0.35, 52); // heartbeat
    }
  }

  _marimba(f, t, vol) {
    const ctx = this.ctx;
    for (const [mult, v, d] of [[1, 1, 0.5], [4, 0.25, 0.12], [9.2, 0.06, 0.05]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(this.mBus);
      o.start(t); o.stop(t + d + 0.02);
    }
  }

  _bass(f, t, d) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(this.mBus);
    o.start(t); o.stop(t + d + 0.05);
  }

  _pad(freqs, t, d, vol) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + d * 0.3); g.gain.linearRampToValueAtTime(0.0001, t + d);
    f.connect(g).connect(this.mBus);
    for (const fr of freqs) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.detune.value = det;
        o.connect(f); o.start(t); o.stop(t + d + 0.1);
      }
    }
  }

  _brass(freqs, t, d) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.08); f.frequency.exponentialRampToValueAtTime(600, t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    f.connect(g).connect(this.mBus);
    for (const fr of freqs) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr / 2; o.connect(f); o.start(t); o.stop(t + d + 0.05); }
  }

  _shaker(t, vol) {
    const ctx = this.ctx;
    const s = this._src(this.noiseW);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    s.connect(f).connect(g).connect(this.mBus);
    s.start(t, Math.random()); s.stop(t + 0.08);
  }

  _drum(t, vol, f0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0 * 2, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.mBus);
    o.start(t); o.stop(t + 0.45);
    const s = this._src(this.noiseB);
    const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.15 * vol, t + 0.004); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    s.connect(nf).connect(ng).connect(this.mBus);
    s.start(t, Math.random()); s.stop(t + 0.2);
  }

  setMood(m) {
    if (this.mood === m) return;
    this.mood = m;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.mFilter.frequency.setTargetAtTime(m === 'tension' ? 2500 : 9000, t, 0.8);
  }

  sting(kind) {
    if (!this.ready) return;
    const seqs = {
      victory: [[72, 0], [76, 0.12], [79, 0.24], [84, 0.38]],
      fanfare: [[67, 0], [72, 0.15], [76, 0.3], [79, 0.45], [84, 0.7]],
      defeat: [[64, 0], [62, 0.35], [60, 0.7], [55, 1.1]],
      unlock: [[79, 0], [84, 0.1], [88, 0.2]],
      warn: [[57, 0], [57, 0.2], [53, 0.45]],
    };
    for (const [m, d] of seqs[kind] || []) {
      this.tone(null, { freq: mtof(m), dur: 0.5, type: 'triangle', vol: 0.14, delay: d, verb: 0.4 });
      this.tone(null, { freq: mtof(m) * 2, dur: 0.3, type: 'sine', vol: 0.05, delay: d });
    }
  }

  horn() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [m, d, len] of [[48, 0, 0.5], [48, 0.55, 0.3], [55, 0.9, 1.2]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 5; const lg = ctx.createGain(); lg.gain.value = 4; lfo.connect(lg).connect(o.frequency);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(400, t + d); f.frequency.linearRampToValueAtTime(1400, t + d + 0.15); f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.08); g.gain.setValueAtTime(0.18, t + d + len - 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + d + len);
      o.connect(f).connect(g).connect(this.sfx);
      const vg = ctx.createGain(); vg.gain.value = 0.6; g.connect(vg).connect(this.verbIn);
      o.start(t + d); lfo.start(t + d); o.stop(t + d + len + 0.05); lfo.stop(t + d + len + 0.05);
    }
  }

  // ---- event → sound mapping -------------------------------------------------------------
  _bindEvents() {
    const game = this.game, ev = game.events;
    const V = () => game.verlet;
    ev.on('dig', (x, z, vol) => {
      if (!this._limit('dig', 70)) return;
      const p = _v.set(x, game.sim.heightAt(x, z), z).clone();
      this.noise(p, { dur: 0.09 + Math.random() * 0.05, freq: rnd(900, 1800), q: 1.2, vol: 0.35 });
      this.noise(p, { dur: 0.05, freq: 3500, q: 0.8, vol: 0.12 });
    });
    ev.on('rake', (c) => { if (this._limit('rake', 120)) this.noise(c.clone(), { dur: 0.18, freq: 2600, q: 0.6, vol: 0.12, buf: 'pink' }); });
    ev.on('bucket', (p) => {
      this.tone(p, { freq: 140, to: 50, dur: 0.25, vol: 0.4 });
      this.noise(p, { dur: 0.2, freq: 700, q: 0.8, vol: 0.3, buf: 'brown' });
    });
    ev.on('uncork', () => {
      this.tone(null, { freq: 320, to: 1300, dur: 0.09, type: 'sine', vol: 0.3 });
      this.noise(null, { dur: 0.04, freq: 4000, q: 1, vol: 0.2 });
      this.noise(null, { dur: 0.35, freq: 1800, sweepTo: 600, q: 0.5, vol: 0.1, buf: 'pink', attack: 0.08 });
    });
    ev.on('uiClick', () => this.tone(null, { freq: 900, to: 1200, dur: 0.04, vol: 0.08 }));
    ev.on('tool', () => this.tone(null, { freq: 600, to: 900, dur: 0.06, type: 'triangle', vol: 0.08 }));
    ev.on('tick', (s) => {
      const loud = s <= 10;
      this.noise(this.game.director.stopwatch.pos, { dur: 0.025, freq: s % 2 ? 3200 : 2400, q: 6, vol: loud ? 0.5 : 0.25, type: 'bandpass' });
      if (loud) this.tone(null, { freq: s % 2 ? 1760 : 1320, dur: 0.05, vol: 0.05 });
    });
    ev.on('warning', () => { this.sting('warn'); this.setMood('tension'); });
    ev.on('waveStart', (n, boss) => { this.horn(); this.setMood(boss ? 'boss' : 'battle'); setTimeout(() => this.crash(1.3), 600); });
    ev.on('waveCleared', () => { this.sting('victory'); this.setMood('calm'); });
    ev.on('bigWave', (A) => setTimeout(() => this.crash(0.6 + A), 2500));
    ev.on('bossArrive', (c) => {
      const ctx = this.ctx; if (!ctx) return;
      this.tone(null, { freq: 70, to: 40, dur: 2.2, type: 'sawtooth', vol: 0.18, verb: 0.5 });
      this.noise(null, { dur: 2, freq: 300, sweepTo: 80, q: 1, vol: 0.3, buf: 'brown', attack: 0.3 });
    });
    ev.on('bossDefeated', () => this.sting('fanfare'));
    ev.on('gameover', () => { this.setMood('silent'); this.sting('defeat'); });
    ev.on('crabEmerge', (c) => { this.noise(c.pos, { dur: 0.5, freq: 900, sweepTo: 300, q: 0.7, vol: 0.3, buf: 'pink' }); });
    ev.on('crabWarcry', (c) => {
      if (!this._limit('warcry', 300)) return;
      this.babble(c.pos, 'blub blub', { pitch: c.def.boss ? 70 : 150, crab: true, vol: 0.12, speed: 1.4 });
      this._clicks(c.pos, 5);
    });
    ev.on('crabStrike', (c, t) => {
      this._clicks(c.pos, 2);
      if (t.kind === 'building') this.noise(c.pos, { dur: 0.15, freq: 600, q: 0.8, vol: 0.4, buf: 'brown' });
      else if (c.def.weapon === 'fork' || c.def.weapon === 'trident') this.fm(c.pos, { freq: 1500, ratio: 2.7, index: 600, dur: 0.18, vol: 0.06 });
    });
    ev.on('unitHit', (u, dmg, opts) => {
      const p = u.pos;
      this.noise(p, { dur: 0.08, freq: 1200, q: 1, vol: 0.3 });
      if (this._limit('ow', 120)) this.tone(p, { freq: rnd(700, 900) * (u.type === 'king' ? 0.6 : 1), to: rnd(400, 500), dur: 0.12, type: 'triangle', vol: 0.12 });
    });
    ev.on('enemyHit', (c, dmg, opts) => {
      const p = c.pos;
      if (opts && opts.ranged) this.noise(p, { dur: 0.05, freq: 2400, q: 2, vol: 0.2 });
      else { this.tone(p, { freq: 180, to: 80, dur: 0.12, vol: 0.35 }); this.fm(p, { freq: 900 + Math.random() * 400, ratio: 1.4, index: 300, dur: 0.12, vol: 0.12, verb: 0.1 }); }
    });
    ev.on('blocked', (c) => this.fm(c.pos, { freq: 2200, ratio: 2.1, index: 900, dur: 0.3, vol: 0.12 }));
    ev.on('enemyDied', (c) => {
      this.noise(c.pos, { dur: 0.3, freq: 700, sweepTo: 2000, q: 2, vol: 0.2, buf: 'pink' });
      this.tone(c.pos, { freq: 300, to: 120, dur: 0.3, type: 'square', vol: 0.04 });
    });
    ev.on('unitDied', (u) => {
      this.noise(u.pos, { dur: 0.6, freq: 1500, sweepTo: 400, q: 0.6, vol: 0.25, buf: 'pink' });
      if (u === game.king) this.sting('defeat');
    });
    ev.on('sever', (u) => this.noise(u.pos, { dur: 0.35, freq: 2800, sweepTo: 900, q: 0.8, vol: 0.25 }));
    ev.on('swing', (u) => { if (this._limit('swing', 50)) this.noise(u.pos, { dur: 0.12, freq: 1500, sweepTo: 3500, q: 1.5, vol: 0.1, buf: 'pink' }); });
    ev.on('meleeHit', (u) => this.fm(u.pos, { freq: 1800, ratio: 3.1, index: 500, dur: 0.15, vol: 0.06 }));
    ev.on('arrowShot', (p) => { if (this._limit('arrow', 40)) this.noise(p, { dur: 0.18, freq: 2500, sweepTo: 800, q: 2, vol: 0.12 }); });
    ev.on('arrowThunk', (p) => this.tone(p, { freq: 300, to: 180, dur: 0.05, vol: 0.12 }));
    ev.on('cannonFire', (p) => { this.tone(p, { freq: 110, to: 40, dur: 0.5, vol: 0.5 }); this.noise(p, { dur: 0.6, freq: 800, sweepTo: 150, q: 0.7, vol: 0.5, buf: 'brown', verb: 0.3 }); });
    ev.on('catapultFire', (p) => { this.noise(p, { dur: 0.25, freq: 600, sweepTo: 200, q: 1, vol: 0.3 }); this.tone(p, { freq: 90, to: 60, dur: 0.2, vol: 0.25 }); });
    ev.on('explosion', (p, big) => { this.tone(p, { freq: big ? 90 : 120, to: 35, dur: big ? 0.8 : 0.5, vol: 0.5 }); this.noise(p, { dur: big ? 1.0 : 0.6, freq: 1200, sweepTo: 200, q: 0.5, vol: 0.45, buf: 'brown', verb: 0.3 }); });
    ev.on('splash', (p, kind) => this.noise(p, { dur: kind === 'ball' ? 0.6 : 0.2, freq: 1400, sweepTo: 500, q: 0.6, vol: kind === 'ball' ? 0.4 : 0.15, buf: 'pink' }));
    ev.on('bubbleShot', (p) => { this.tone(p, { freq: 500, to: 1400, dur: 0.12, vol: 0.12 }); this.noise(p, { dur: 0.03, freq: 3000, vol: 0.3 }); });
    ev.on('bubblePop', (p) => this.tone(p, { freq: 900, to: 300, dur: 0.08, vol: 0.2 }));
    ev.on('buildingHit', (b, amt, src) => { if (src !== 'water' && this._limit('bhit', 80)) this.noise(b.pos, { dur: 0.18, freq: 500, q: 0.7, vol: 0.3, buf: 'brown' }); });
    ev.on('buildingDestroyed', (b) => {
      this.noise(b.pos, { dur: 1.6, freq: 700, sweepTo: 120, q: 0.6, vol: 0.55, buf: 'brown', verb: 0.3 });
      this.tone(b.pos, { freq: 80, to: 30, dur: 1.0, vol: 0.4 });
      game.rig.addShake(0.3);
    });
    ev.on('buildingComplete', (b) => {
      if (b.type === 'bucket') return;
      for (const [f, d] of [[880, 0], [1320, 0.08], [1760, 0.16]]) this.tone(b.pos, { freq: f, dur: 0.6, vol: 0.08, delay: d, verb: 0.4 });
    });
    ev.on('buildingPlaced', (b) => { if (b.type !== 'bucket') this.noise(b.pos, { dur: 0.25, freq: 500, q: 0.6, vol: 0.2, buf: 'brown' }); });
    ev.on('buildTap', (u) => { if (this._limit('tap', 90)) this.noise(u.pos, { dur: 0.06, freq: rnd(500, 900), q: 1.5, vol: 0.12, buf: 'brown' }); });
    ev.on('materialsDelivered', (s) => this.noise(s.pos, { dur: 0.12, freq: 900, q: 1, vol: 0.15 }));
    ev.on('delivered', (u, it) => {
      if (!this._limit('deliver', 60)) return;
      if (it.type === 'gem' || it.type === 'coin') this.tone(it.pos, { freq: 1568, dur: 0.4, vol: 0.08, verb: 0.3 });
      else this.tone(it.pos, { freq: rnd(1100, 1400), dur: 0.08, type: 'triangle', vol: 0.06 });
    });
    ev.on('pickup', (u, it) => { if (this._limit('pick', 60)) this.tone(u.pos, { freq: 700, to: 1000, dur: 0.05, vol: 0.05 }); });
    ev.on('groupLift', (it) => this.babble(it.pos, 'hup hup', { pitch: 480, vol: 0.12, speed: 1.3 }));
    ev.on('grab', (o) => this.tone(o.pos, { freq: 500, to: 900, dur: 0.1, type: 'triangle', vol: 0.1 }));
    ev.on('throw', (o, sp) => {
      this.noise(o.pos, { dur: 0.3, freq: 800, sweepTo: 2400, q: 1, vol: clamp(sp / 20, 0.05, 0.25), buf: 'pink' });
      if (o.kind === 'unit' && sp > 4) this.babble(o.pos, 'wheeeee', { pitch: 700, vol: 0.15, speed: 0.7 });
    });
    ev.on('crabGrab', (c) => this._clicks(c.pos, 4));
    ev.on('crabThrow', (c, u) => this.babble(u.pos, 'aaaah', { pitch: 760, vol: 0.16, speed: 0.6, shout: true }));
    ev.on('swept', (u) => { if (this._limit('swept', 400)) this.babble(u.pos, 'blub help', { pitch: 650, vol: 0.12 }); });
    ev.on('panic', (u) => { if (this._limit('panic', 700)) this.babble(u.pos, 'eek!', { pitch: 720, vol: 0.12, speed: 1.4 }); });
    ev.on('chatter', (u) => { if (this._limit('chat', 900)) this.babble(u.pos, pick(['hello there friend', 'did you see that crab', 'nice shell', 'hmm hmm']), { pitch: rnd(460, 620), vol: 0.07 }); });
    ev.on('say', (ent, text, opts) => {
      const king = opts.king;
      this.babble(ent.pos, text, { pitch: king ? 250 : 520, vol: king ? 0.2 : 0.14, shout: !!opts.shout, speed: king ? 0.95 : 1.1 });
    });
    ev.on('summoned', (n) => { if (this._limit('summon', 250)) this.tone(null, { freq: 660 + n * 20, dur: 0.08, type: 'triangle', vol: 0.06 }); });
    ev.on('summonStart', () => this.tone(null, { freq: 440, to: 660, dur: 0.15, vol: 0.08 }));
    ev.on('blueprintUnlocked', () => this.sting('unlock'));
    ev.on('unitTrained', (u) => this.babble(u.pos, 'reporting for duty', { pitch: 540, vol: 0.12 }));
    ev.on('trapSnap', (b) => this.noise(b.pos, { dur: 0.1, freq: 2600, q: 3, vol: 0.3 }));
    ev.on('impact', (i, sp) => {
      if (sp > 4 && this._limit('impact', 80)) {
        const V2 = V();
        const p = _v.set(V2.px[i], V2.py[i], V2.pz[i]).clone();
        this.noise(p, { dur: 0.1, freq: 400 + sp * 40, q: 0.8, vol: clamp(sp / 14, 0.05, 0.35), buf: 'brown' });
      }
    });
    ev.on('jump', (u) => this.tone(u.pos, { freq: 400, to: 800, dur: 0.12, type: 'triangle', vol: 0.1 }));
    ev.on('possessed', (u) => this.tone(null, { freq: 300, to: 900, dur: 0.35, type: 'sine', vol: 0.12, verb: 0.4 }));
    ev.on('unpossessed', () => this.tone(null, { freq: 900, to: 300, dur: 0.3, type: 'sine', vol: 0.1, verb: 0.4 }));
    ev.on('title', (t, opts) => { if (!opts.danger) this.tone(null, { freq: 523, dur: 0.6, type: 'triangle', vol: 0.05, verb: 0.5 }); });
  }

  _clicks(pos, n) {
    if (!this.ready || !this._limit('clicks' + Math.round(pos.x), 90)) return;
    for (let i = 0; i < n; i++) {
      setTimeout(() => this.noise(pos, { dur: 0.018, freq: rnd(2500, 4200), q: 8, vol: 0.18 }), i * rnd(40, 80));
    }
  }

  update(dt) {
    if (!this.ready) return;
    this._updateAmbient(dt);
    const d = this.game.director;
    if (this.game.state === 'play') {
      if (d.phase === 'calm' || d.phase === 'receding') this.setMood('calm');
    }
  }
}
