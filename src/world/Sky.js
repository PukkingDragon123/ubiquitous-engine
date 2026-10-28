// Painterly sky dome, sun/moon lighting, fog, environment map and the day cycle.
import * as THREE from 'three';
import { globalUniforms, NOISE_GLSL } from './shaderLib.js';
import { clamp, smoothstep, lerp, damp } from '../core/math.js';

const col = (hex) => new THREE.Color(hex);

// A brewing storm the sky leans toward while something huge is in the water.
const STORM = { zen: col(0x2c3846), hor: col(0x6d7a80), sun: col(0xbfc8cc), fog: col(0x7c878a) };

// Palette keyframes by sun elevation (sin of altitude).
const KEYS = [
  { e: -0.35, zen: col(0x0a1530), hor: col(0x1c2a4a), sun: col(0x8fa8d8), sunI: 0.35, hemi: 0.22, fog: col(0x1a2440) },
  { e: -0.08, zen: col(0x1d2c55), hor: col(0x5a4a6a), sun: col(0xa0a8d0), sunI: 0.25, hemi: 0.3, fog: col(0x4a4460) },
  { e: 0.02, zen: col(0x3a5a96), hor: col(0xffa877), sun: col(0xff9a5a), sunI: 1.4, hemi: 0.55, fog: col(0xf2a882) },
  { e: 0.16, zen: col(0x4a83c4), hor: col(0xffd6a6), sun: col(0xffcf98), sunI: 2.4, hemi: 0.8, fog: col(0xf6d7b4) },
  { e: 0.4, zen: col(0x3f8ae0), hor: col(0xc9e6f4), sun: col(0xfff0dc), sunI: 2.7, hemi: 0.95, fog: col(0xcfe5f2) },
  { e: 1.0, zen: col(0x2f7fe0), hor: col(0xbfe0f4), sun: col(0xfff6ea), sunI: 2.9, hemi: 1.0, fog: col(0xc6e0f2) },
];

function samplePalette(e, out) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (e >= KEYS[i].e && e <= KEYS[i + 1].e) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  }
  if (e < KEYS[0].e) b = a;
  if (e > KEYS[KEYS.length - 1].e) a = b;
  const t = a === b ? 0 : smoothstep(0, 1, (e - a.e) / (b.e - a.e));
  out.zen.copy(a.zen).lerp(b.zen, t);
  out.hor.copy(a.hor).lerp(b.hor, t);
  out.sun.copy(a.sun).lerp(b.sun, t);
  out.fog.copy(a.fog).lerp(b.fog, t);
  out.sunI = lerp(a.sunI, b.sunI, t);
  out.hemi = lerp(a.hemi, b.hemi, t);
  return out;
}

export class Sky {
  constructor(engine) {
    this.engine = engine;
    const scene = engine.scene;
    this.dayLength = 16 * 60; // seconds per full day
    this.timeOfDay = 0.34; // 0..1 (0.25 sunrise, 0.5 noon, 0.75 sunset)
    this.timeScale = 1;
    this.frozen = false;
    this.gloom = 0;
    this.gloomTarget = 0;
    this._lastEnvGloom = 0;
    this.baseCloud = globalUniforms.uCloudCover.value;
    this.pal = { zen: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), fog: new THREE.Color(), sunI: 3, hemi: 1 };

    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: globalUniforms.uSunDir,
      uSunColor: globalUniforms.uSunColor,
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uTime: globalUniforms.uTime,
      uCloudCover: globalUniforms.uCloudCover,
      uWind: globalUniforms.uWind,
      uNight: globalUniforms.uNight,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uMoonDir;
        uniform float uTime, uCloudCover, uNight;
        uniform vec2 uWind;
        varying vec3 vDir;
        ${NOISE_GLSL}
        void main() {
          vec3 d = normalize(vDir);
          float y = d.y;
          float t = pow(clamp(y, 0.0, 1.0), 0.38);
          vec3 c = mix(uHorizon, uZenith, t);
          // soft bright haze band right at the horizon
          c = mix(c, uHorizon * 1.08, exp(-abs(y) * 22.0) * 0.6);
          c = mix(c, uHorizon * 0.92, smoothstep(0.0, -0.25, y));
          float sd = max(dot(d, uSunDir), 0.0);
          float sunUp = smoothstep(-0.12, 0.05, uSunDir.y);
          c += uSunColor * (pow(sd, 5.0) * 0.22 + pow(sd, 48.0) * 0.45) * sunUp;
          c += uSunColor * smoothstep(0.99935, 0.99965, sd) * 14.0 * sunUp;
          // moon
          float md = max(dot(d, uMoonDir), 0.0);
          c += vec3(0.75, 0.82, 1.0) * (smoothstep(0.99955, 0.9998, md) * 3.0 + pow(md, 80.0) * 0.12) * uNight;
          // stars
          if (uNight > 0.01 && y > 0.0) {
            vec2 sp = d.xz / (y + 0.4) * 160.0;
            vec2 cell = floor(sp);
            float h = hash12(cell);
            float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h * 50.0);
            vec2 f = fract(sp) - hash22(cell) ;
            float star = step(0.985, h) * smoothstep(0.06, 0.0, length(f - 0.0)) * tw;
            c += vec3(0.9, 0.95, 1.0) * star * uNight * smoothstep(0.0, 0.2, y) * 1.6;
          }
          // painterly clouds on a virtual plane
          if (y > -0.02) {
            float yy = max(y, 0.0);
            vec2 p = d.xz / (yy + 0.11) * 0.55 + uWind * uTime * 0.0016;
            float n = fbm(p * 1.1) * 0.62 + fbm(p * 2.6 + 9.0) * 0.28 + fbm(p * 6.0 - 3.0) * 0.1;
            float cov = uCloudCover;
            float a = smoothstep(1.0 - cov - 0.06, 1.0 - cov + 0.28, n);
            // light from the sun side of each cloud
            float n2 = fbm((p + uSunDir.xz * 0.06) * 1.1) * 0.62 + fbm((p + uSunDir.xz * 0.06) * 2.6 + 9.0) * 0.28;
            float shade = clamp((n - n2) * 4.0 + 0.55, 0.0, 1.0);
            vec3 lit = mix(uHorizon * 1.05, vec3(1.0, 0.98, 0.96), 0.55) * (0.75 + 0.45 * sunUp);
            vec3 dark = mix(uZenith, uHorizon, 0.55) * 0.82;
            vec3 cc = mix(dark, lit, shade);
            cc += uSunColor * pow(sd, 8.0) * (1.0 - a) * 1.3 * sunUp; // silver lining
            cc = mix(cc, cc * vec3(0.35, 0.4, 0.6), uNight * 0.85);
            float fade = smoothstep(-0.02, 0.18, y);
            c = mix(c, cc, a * fade * 0.92);
          }
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), mat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(4096, 4096);
    s.bias = -0.0004;
    s.normalBias = 0.035;
    s.radius = 2.2;
    s.camera.near = 1;
    s.camera.far = 400;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfdcff, 0xe7c99a, 0.6);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xdcebf0, 0.00048);

    // environment for reflections
    this.pmrem = new THREE.PMREMGenerator(engine.renderer);
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(this.dome.geometry, mat);
    this.envScene.add(this.envDome);
    this.envTarget = null;
    this._envTimer = 0;
    this._lastEnvElev = 99;

    this.shadowFocus = new THREE.Vector3();
    this.shadowSize = 40;
    this.update(0, true);
  }

  get sunElevation() { return globalUniforms.uSunDir.value.y; }
  get isNight() { return globalUniforms.uNight.value > 0.5; }
  get hours() { return (this.timeOfDay * 24) % 24; }

  update(dt, force = false) {
    if (!this.frozen) {
      // nights pass faster
      const nightBoost = this.isNight ? 2.4 : 1;
      this.timeOfDay = (this.timeOfDay + (dt * this.timeScale * nightBoost) / this.dayLength) % 1;
    }
    const ang = (this.timeOfDay - 0.25) * Math.PI * 2; // 0 at sunrise
    const elev = Math.sin(ang) * 0.92;
    const az = -0.55 + (this.timeOfDay - 0.5) * 2.2;
    const sunDir = globalUniforms.uSunDir.value;
    const horiz = Math.sqrt(Math.max(0, 1 - elev * elev));
    // the sun travels across the ocean side so the water glitters toward the camera
    sunDir.set(Math.sin(az) * horiz, elev, -Math.cos(az) * horiz).normalize();
    const moonDir = this.uniforms.uMoonDir.value.set(-sunDir.x * 0.8, Math.max(0.25, -sunDir.y), -sunDir.z * 0.6 - 0.3).normalize();
    const night = clamp(smoothstep(0.02, -0.16, elev));
    globalUniforms.uNight.value = night;

    const pal = samplePalette(elev, this.pal);
    this.gloom = damp(this.gloom, this.gloomTarget, 0.45, dt);
    if (this.gloom > 0.002) {
      const g = this.gloom;
      pal.zen.lerp(STORM.zen, g * 0.7);
      pal.hor.lerp(STORM.hor, g * 0.65);
      pal.fog.lerp(STORM.fog, g * 0.6);
      pal.sun.lerp(STORM.sun, g * 0.5);
      pal.sunI *= 1 - 0.5 * g;
      pal.hemi *= 1 - 0.2 * g;
    }
    globalUniforms.uCloudCover.value = lerp(this.baseCloud, 0.9, this.gloom);
    this.uniforms.uZenith.value.copy(pal.zen);
    this.uniforms.uHorizon.value.copy(pal.hor);
    globalUniforms.uSunColor.value.copy(pal.sun);

    // Directional light follows the sun by day and the moon by night.
    const lightDir = elev > -0.05 ? sunDir : moonDir;
    const li = elev > -0.05 ? pal.sunI * smoothstep(-0.05, 0.06, elev) : 0.55 * night;
    this.sun.intensity = li;
    this.sun.color.copy(elev > -0.05 ? pal.sun : new THREE.Color(0x9fb4ff));
    const f = this.shadowFocus;
    // snap the shadow camera to texels to prevent shimmering
    const size = this.shadowSize;
    const texel = (size * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
    this.sun.position.set(fx + lightDir.x * 150, f.y + Math.max(0.15, lightDir.y) * 150, fz + lightDir.z * 150);
    this.sun.target.position.set(fx, f.y, fz);
    const cam = this.sun.shadow.camera;
    if (cam.right !== size) {
      cam.left = -size; cam.right = size; cam.top = size; cam.bottom = -size;
      cam.updateProjectionMatrix();
    }

    this.hemi.intensity = pal.hemi * 0.55;
    this.hemi.color.copy(pal.zen).lerp(new THREE.Color(0xffffff), 0.4);
    this.hemi.groundColor.copy(pal.hor).lerp(new THREE.Color(0xd8b98a), 0.6);
    this.engine.scene.fog.color.copy(pal.fog);

    // refresh reflections when the light changed enough
    this._envTimer -= dt;
    if (force || (this._envTimer <= 0 && (Math.abs(elev - this._lastEnvElev) > 0.012 || Math.abs(this.gloom - this._lastEnvGloom) > 0.04))) {
      this._envTimer = 1.5;
      this._lastEnvElev = elev;
      this._lastEnvGloom = this.gloom;
      this.refreshEnvironment();
    }
  }

  refreshEnvironment() {
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, 5000);
    this.engine.scene.environment = this.envTarget.texture;
    const night = globalUniforms.uNight.value;
    this.engine.scene.environmentIntensity = lerp(0.75, 0.3, night);
    if (old) old.dispose();
  }
}
