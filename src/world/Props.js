// Natural props: rocks, beach grass, bushes, palms, coral reefs, seagrass,
// driftwood, starfish, distant islands. Small props follow the simulated sand
// on the GPU (they sink, get buried or uprooted as the beach changes).
import * as THREE from 'three';
import {
  makeRockGeometry, makeGrassClump, makePalm, makeBush, makeCoral, makeDriftwood, makeStarfish, makeShellGeometry,
} from './propGeometry.js';
import { globalUniforms, NOISE_GLSL, SIMFETCH_GLSL, CLOUD_GLSL } from './shaderLib.js';
import { baseHeight, shoreZ, X0, Z0, X1, Z1, CELL, SEA_LEVEL } from './config.js';
import { noise } from '../core/noise.js';
import { mulberry32, clamp, smoothstep } from '../core/math.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

// Material with wind sway, optional terrain following and leaf translucency.
function makeFoliageMaterial(sim, { follow = false, underwater = false, leaf = true, roughness = 0.8 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, side: THREE.DoubleSide });
  const uniforms = {
    uTime: globalUniforms.uTime,
    uSunDir: globalUniforms.uSunDir,
    uSunColor: globalUniforms.uSunColor,
    uWind: globalUniforms.uWind,
    uCloudCover: globalUniforms.uCloudCover,
    uSimA: { value: sim.texA },
    uSimB: { value: sim.texB },
    uGridOrigin: globalUniforms.uGridOrigin,
    uGridSize: globalUniforms.uGridSize,
    uCell: globalUniforms.uCell,
    uWindStrength: { value: 1 },
  };
  mat.userData.uniforms = uniforms;
  mat.customProgramCacheKey = () => `foliage-${follow}-${underwater}-${leaf}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    const defs = shader.defines || (shader.defines = {});
    if (follow) defs.FOLLOW_TERRAIN = '';
    if (underwater) defs.UNDERWATER = '';
    if (leaf) defs.LEAFY = '';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform float uTime, uWindStrength;
        uniform vec2 uWind;
        uniform sampler2D uSimA, uSimB;
        ${SIMFETCH_GLSL}
        attribute float aSway;
        attribute float aLeaf;
        varying float vLeaf;
        varying vec3 vWorldP;
      `)
      .replace('#include <project_vertex>', /* glsl */ `
        vec4 mvPosition = vec4(transformed, 1.0);
        vec3 origin = vec3(0.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          origin = instanceMatrix[3].xyz;
        #endif
        vec3 wpos = (modelMatrix * mvPosition).xyz;
        vec3 worigin = (modelMatrix * vec4(origin, 1.0)).xyz;
        float sway = aSway;
        #ifdef FOLLOW_TERRAIN
          vec4 sA = simBilinear(uSimA, worigin.xz);
          float dh = sA.r - worigin.y;
          wpos.y += dh;
          // uprooted (sand dug away) or buried → shrink away
          float keep = smoothstep(-0.55, -0.3, dh) * (1.0 - smoothstep(0.45, 0.8, dh));
          wpos = mix(vec3(worigin.x, worigin.y + dh, worigin.z), wpos, keep);
        #endif
        #ifdef UNDERWATER
          vec2 flow = simBilinear(uSimB, worigin.xz).xy;
          wpos.xz += flow * 0.12 * sway;
          wpos.x += sin(uTime * 1.3 + worigin.z * 0.7) * 0.05 * sway;
        #else
          float ph = uTime * 1.7 + worigin.x * 0.35 + worigin.z * 0.22;
          float gust = 0.6 + 0.4 * sin(uTime * 0.37 + worigin.x * 0.05) * sin(uTime * 0.23 - worigin.z * 0.04);
          vec2 w = normalize(uWind) * (sin(ph) * 0.6 + 0.5) * gust * uWindStrength;
          wpos.xz += w * sway * 0.12;
          wpos.y -= abs(sway) * 0.03 * gust;
        #endif
        vLeaf = aLeaf;
        vWorldP = wpos;
        mvPosition = viewMatrix * vec4(wpos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform float uTime;
        uniform vec3 uSunDir, uSunColor;
        varying float vLeaf;
        varying vec3 vWorldP;
        ${NOISE_GLSL}
        ${CLOUD_GLSL}
      `)
      .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
        {
          float cs = cloudShadow(vWorldP);
          reflectedLight.directDiffuse *= cs;
          reflectedLight.directSpecular *= cs;
          #ifdef LEAFY
            vec3 V = normalize(cameraPosition - vWorldP);
            float trans = pow(max(dot(-V, uSunDir), 0.0), 3.0) * vLeaf;
            reflectedLight.directDiffuse += diffuseColor.rgb * uSunColor * (trans * 0.9 + 0.12 * vLeaf) * cs * smoothstep(-0.05, 0.2, uSunDir.y);
          #endif
        }
      `);
  };
  return mat;
}

function makeRockMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  const uniforms = { uSeaLevel: globalUniforms.uSeaLevel, uTime: globalUniforms.uTime, uCloudCover: globalUniforms.uCloudCover, uWind: globalUniforms.uWind };
  mat.customProgramCacheKey = () => 'rock';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldR;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wr = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wr = instanceMatrix * wr;
        #endif
        vWorldR = (modelMatrix * wr).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uSeaLevel, uTime;
        varying vec3 vWorldR;
        ${NOISE_GLSL}
        ${CLOUD_GLSL}
        float gRockWet;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float rel = vWorldR.y - uSeaLevel;
          float splash = 0.55 + 0.25 * fbm(vWorldR.xz * 0.6 + uTime * 0.05);
          gRockWet = 1.0 - smoothstep(splash - 0.25, splash + 0.15, rel);
          diffuseColor.rgb *= mix(1.0, 0.55, gRockWet);
          float algae = gRockWet * (1.0 - smoothstep(-0.6, 0.3, rel)) * smoothstep(-2.5, -0.3, rel);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.2, 0.08), algae * 0.6 * smoothstep(0.35, 0.65, vnoise(vWorldR.xz * 3.0)));
          // barnacle speckles near the waterline
          vec2 vb = voronoi(vWorldR.xz * 9.0 + vWorldR.y * 3.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.74, 0.66), smoothstep(0.18, 0.08, vb.x) * step(0.7, vb.y) * gRockWet * 0.6);
        }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.9, 0.28, gRockWet);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { float cs = cloudShadow(vWorldR); reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs; }`);
  };
  return mat;
}

export class Props {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.colliders = []; // {x, z, r, h, kind}
    this.rng = mulberry32(4242);
    this.group = new THREE.Group();
    scene.add(this.group);

    this.rockMat = makeRockMaterial();
    this.grassMat = makeFoliageMaterial(sim, { follow: true, leaf: true });
    this.staticGrassMat = makeFoliageMaterial(sim, { follow: false, leaf: true });
    this.bushMat = makeFoliageMaterial(sim, { follow: true, leaf: true, roughness: 0.65 });
    this.staticBushMat = makeFoliageMaterial(sim, { follow: false, leaf: true, roughness: 0.65 });
    this.palmMat = makeFoliageMaterial(sim, { follow: false, leaf: true, roughness: 0.7 });
    this.seaMat = makeFoliageMaterial(sim, { follow: true, underwater: true, leaf: false, roughness: 0.6 });
    this.decorMat = makeFoliageMaterial(sim, { follow: true, leaf: false, roughness: 0.5 });
    this.woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });

    this._rocks();
    this._vegetation();
    this._reef();
    this._decor();
    this._distant();
    this._applyObstacles();
  }

  _inst(geo, mat, transforms, { cast = true, receive = true, clearable = true } = {}) {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, transforms.length));
    if (clearable) {
      this.clearables = this.clearables || [];
      transforms.forEach((t, i) => { if ((t.s ?? 1) < 1.2) this.clearables.push({ mesh, i, x: t.x, z: t.z }); });
    }
    mesh.count = transforms.length;
    transforms.forEach((t, i) => {
      _e.set(t.rx || 0, t.ry || 0, t.rz || 0);
      _q.setFromEuler(_e);
      _s.set(t.sx ?? t.s, t.sy ?? t.s, t.sz ?? t.s);
      _p.set(t.x, t.y, t.z);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.frustumCulled = false;
    if (aSwayMissing(geo)) addSwayAttrs(geo);
    this.group.add(mesh);
    return mesh;
  }

  // Split far-away instances into angular sectors so whole sectors can be culled.
  _instChunked(geo, mat, transforms, opts = {}, sectors = 8) {
    const buckets = Array.from({ length: sectors }, () => []);
    for (const t of transforms) {
      const a = Math.atan2(t.z - 10, t.x) + Math.PI;
      buckets[Math.min(sectors - 1, Math.floor((a / (Math.PI * 2)) * sectors))].push(t);
    }
    for (const b of buckets) {
      if (!b.length) continue;
      const m = this._inst(geo, mat, b, { ...opts, clearable: false });
      m.computeBoundingSphere();
      m.boundingSphere.radius += 3;
      m.frustumCulled = true;
    }
  }

  _rocks() {
    const rng = this.rng;
    const variants = [];
    for (let i = 0; i < 7; i++) variants.push(makeRockGeometry(100 + i, { detail: 4, flat: 0.55 + rng() * 0.25 }));
    const lists = variants.map(() => []);
    const add = (x, z, s, opts = {}) => {
      const v = opts.v ?? Math.floor(rng() * variants.length);
      const y = baseHeight(x, z) - s * 0.12 + (opts.dy || 0);
      const sy = s * (opts.sy || 1);
      lists[v].push({ x, y, z, s, sy, ry: rng() * Math.PI * 2, rz: (rng() - 0.5) * 0.15, rx: (rng() - 0.5) * 0.15 });
      const r = s * 0.85;
      this.colliders.push({ x, z, r, h: y + sy * 0.6, kind: 'rock', big: s > 1.2 });
    };
    // headland boulder field on the left, running into the sea
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * 11;
      const x = -43 + Math.cos(a) * d * 0.8, z = -19 + Math.sin(a) * d;
      const s = 1.2 + rng() * 3.4 * (1 - d / 14);
      add(x, z, s);
    }
    // a big anchor boulder group
    add(-46, -17, 6.2, { v: 0, dy: -0.6 });
    add(-40.5, -22.5, 4.6, { v: 3, dy: -0.4 });
    add(-48, -24, 5.2, { v: 5 });
    // a few rocks on the right point
    for (let i = 0; i < 8; i++) {
      const x = 40 + rng() * 9, z = -8 + rng() * 12;
      add(x, z, 0.8 + rng() * 2.2);
    }
    // sparse beach rocks
    for (const [x, z, s] of [[16, -2, 1.3], [-22, 9, 1.6], [28, 14, 1.0], [-6, 22, 1.2], [6, -9, 0.9], [-30, 26, 2.2], [36, 30, 1.8]]) add(x, z, s);
    this.rockMeshes = variants.map((g, i) => this._inst(g, this.rockMat, lists[i]));
    // pebbles (small, plentiful, low poly)
    const pebbleGeos = [0, 1, 2].map((i) => makeRockGeometry(200 + i, { detail: 1, flat: 0.6 + rng() * 0.2 }));
    const pl = pebbleGeos.map(() => []);
    for (let i = 0; i < 170; i++) {
      const x = X0 + 4 + rng() * (X1 - X0 - 8), z = Z0 + 10 + rng() * (Z1 - Z0 - 14);
      const s = 0.08 + rng() * 0.18;
      pl[i % 3].push({ x, y: baseHeight(x, z) - s * 0.2, z, s, sy: s * 0.7, ry: rng() * 6 });
    }
    pebbleGeos.forEach((g, i) => this._inst(g, this.rockMat, pl[i]));
  }

  _vegetation() {
    const rng = this.rng;
    const sim = this.sim;
    const grassVariants = [0, 1, 2].map((i) => makeGrassClump(10 + i, { blades: 12 + i * 2, height: 0.75 + i * 0.25 }));
    const grassSim = grassVariants.map(() => []);
    const grassOuter = [[], [], [], [], []];
    const bushVariants = [0, 1, 2].map((i) => makeBush(30 + i, { size: 1, flowers: i !== 1 }));
    const farGrass = [0, 1].map((i) => makeGrassClump(20 + i, { blades: 6, height: 0.9 + i * 0.25 }));
    const farBush = [0, 1].map((i) => makeBush(40 + i, { size: 1, flowers: i === 0, leaves: 26, seg: 5 }));
    const bushSim = bushVariants.map(() => []);
    const bushOuter = [[], [], [], [], []];

    const elevAt = (x, z) => baseHeight(x, z) - SEA_LEVEL;
    const blocked = (x, z, r) => this.colliders.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + r) ** 2);
    // grass on the dunes inside the play area
    for (let i = 0; i < 2600; i++) {
      const x = X0 + 1 + rng() * (X1 - X0 - 2), z = Z0 + rng() * (Z1 - Z0);
      const e = elevAt(x, z);
      if (e < 1.5) continue;
      const dens = smoothstep(1.5, 3.2, e) * (0.45 + 0.55 * smoothstep(-0.2, 0.35, noise.fbm2(x * 0.08, z * 0.08, 3)));
      if (rng() > dens) continue;
      if (blocked(x, z, 0.3)) continue;
      const v = Math.floor(rng() * 3);
      const s = 0.8 + rng() * 0.7;
      grassSim[v].push({ x, y: sim.heightAt(x, z), z, s, ry: rng() * 6.28 });
    }
    // grass + bushes beyond the play area (backdrop)
    for (let i = 0; i < 6500; i++) {
      const a = rng() * Math.PI * 2;
      const d = 30 + Math.pow(rng(), 1.6) * 240;
      const x = Math.cos(a) * d * 1.4, z = Math.sin(a) * d + 20;
      if (x > X0 - 1 && x < X1 + 1 && z > Z0 - 1 && z < Z1 + 1) continue;
      const e = elevAt(x, z);
      if (e < 1.4) continue;
      const dens = smoothstep(1.4, 3.5, e) * (0.35 + 0.65 * smoothstep(-0.3, 0.3, noise.fbm2(x * 0.03, z * 0.03, 3)));
      if (rng() > dens) continue;
      const far = smoothstep(60, 200, d);
      if (rng() < 0.82) {
        const v = d < 70 ? Math.floor(rng() * 3) : 3 + Math.floor(rng() * 2);
        grassOuter[v].push({ x, y: baseHeight(x, z), z, s: (1 + rng() * 0.8) * (1 + far * 1.6), ry: rng() * 6.28 });
      } else {
        const v = d < 70 ? Math.floor(rng() * 3) : 3 + Math.floor(rng() * 2);
        bushOuter[v].push({ x, y: baseHeight(x, z) - 0.1, z, s: (0.8 + rng() * 1.2) * (1 + far * 1.2), ry: rng() * 6.28 });
      }
    }
    // bushes on the back dunes
    for (let i = 0; i < 260; i++) {
      const x = X0 + 2 + rng() * (X1 - X0 - 4), z = 18 + rng() * (Z1 - 18);
      const e = elevAt(x, z);
      if (e < 2.4) continue;
      if (rng() > smoothstep(-0.1, 0.4, noise.fbm2(x * 0.06 + 3, z * 0.06, 3))) continue;
      if (blocked(x, z, 0.8)) continue;
      const v = Math.floor(rng() * 3);
      bushSim[v].push({ x, y: sim.heightAt(x, z) - 0.05, z, s: 0.7 + rng() * 0.8, ry: rng() * 6.28 });
      this.colliders.push({ x, z, r: 0.6, h: 1, kind: 'bush' });
    }
    this.grassMeshes = grassVariants.map((g, i) => this._inst(g, this.grassMat, grassSim[i], { cast: false }));
    [...grassVariants, ...farGrass].forEach((g, i) => this._instChunked(g, this.staticGrassMat, grassOuter[i], { cast: false }));
    bushVariants.forEach((g, i) => this._inst(g, this.bushMat, bushSim[i], { cast: true }));
    [...bushVariants, ...farBush].forEach((g, i) => this._instChunked(g, this.staticBushMat, bushOuter[i], { cast: false }));

    // palms
    const palmVariants = [0, 1, 2].map((i) => makePalm(50 + i, { height: 8 + i * 1.6 }));
    const palms = palmVariants.map(() => []);
    const spots = [
      [-42, 30], [-35, 34], [-47, 22], [44, 28], [38, 35], [47, 18], [-20, 37], [14, 37.5],
      [-62, 40], [-70, 25], [-58, 10], [64, 38], [72, 22], [58, 46], [-30, 52], [10, 56], [30, 50], [-8, 48],
      [-90, 30], [90, 40], [-48, 60], [52, 64], [0, 70], [-75, 55], [80, 60],
    ];
    for (const [x, z] of spots) {
      if (elevAt(x, z) < 1.2) continue;
      const v = Math.floor(rng() * 3);
      palms[v].push({ x, y: baseHeight(x, z) - 0.1, z, s: 0.85 + rng() * 0.35, ry: rng() * 6.28 });
      this.colliders.push({ x, z, r: 0.5, h: 9, kind: 'palm' });
    }
    palmVariants.forEach((g, i) => this._inst(g, this.palmMat, palms[i], { cast: true }));
  }

  _reef() {
    const rng = this.rng;
    const kinds = ['branch', 'branch', 'brain', 'fan', 'branch', 'brain'];
    const corals = kinds.map((k, i) => makeCoral(70 + i, k));
    const lists = corals.map(() => []);
    const seagrass = makeGrassClump(90, { blades: 10, height: 0.8, spread: 0.25, dark: true });
    const sg = [];
    for (let i = 0; i < 2600; i++) {
      const x = X0 + 2 + rng() * (X1 - X0 - 4), z = Z0 + 2 + rng() * 34;
      const depth = SEA_LEVEL - baseHeight(x, z);
      if (depth < 0.7) continue;
      const leftReef = smoothstep(-10, -40, x);
      const patch = smoothstep(0.0, 0.4, noise.fbm2(x * 0.07 + 20, z * 0.07, 3));
      if (rng() < 0.35 * patch * (0.3 + leftReef)) {
        const v = Math.floor(rng() * corals.length);
        const s = 0.5 + rng() * 0.9;
        lists[v].push({ x, y: baseHeight(x, z) - 0.05, z, s, ry: rng() * 6.28 });
      } else if (rng() < 0.55 * smoothstep(-0.2, 0.35, noise.fbm2(x * 0.05 - 7, z * 0.09, 3))) {
        sg.push({ x, y: baseHeight(x, z), z, s: 0.8 + rng() * 0.9, ry: rng() * 6.28 });
      }
    }
    corals.forEach((g, i) => { addSwayAttrs(g, 0.05); this._inst(g, this.seaMat, lists[i], { cast: false }); });
    this._inst(seagrass, this.seaMat, sg, { cast: false });
  }

  _decor() {
    const rng = this.rng;
    // driftwood logs along the high water mark
    const woods = [0, 1, 2].map((i) => makeDriftwood(5 + i, { length: 2.5 + i * 1.2 }));
    const wl = woods.map(() => []);
    for (let i = 0; i < 9; i++) {
      const x = X0 + 6 + rng() * (X1 - X0 - 12);
      const z = shoreZ(x) + 9 + rng() * 10;
      const v = Math.floor(rng() * 3);
      wl[v].push({ x, y: baseHeight(x, z) - 0.05, z, s: 0.8 + rng() * 0.4, ry: rng() * 6.28 });
      this.colliders.push({ x, z, r: 1.0, h: 0.4, kind: 'log' });
    }
    woods.forEach((g, i) => this._inst(g, this.woodMat, wl[i]));
    // starfish and small decorative shells
    const star = makeStarfish();
    setVertexColor(star, 0xf08a4b);
    const stars = [];
    const shellKinds = ['scallop', 'conch', 'clam'];
    const shellCols = [0xf6e3d0, 0xf3b58a, 0xe9d2c0];
    const shells = shellKinds.map((k, i) => { const g = makeShellGeometry(k); setVertexColor(g, shellCols[i]); return g; });
    const sl = shells.map(() => []);
    for (let i = 0; i < 260; i++) {
      const x = X0 + 4 + rng() * (X1 - X0 - 8), z = Z0 + 14 + rng() * 44;
      const e = baseHeight(x, z) - SEA_LEVEL;
      if (e < -1.2 || e > 2.2) continue;
      if (rng() < 0.15) stars.push({ x, y: baseHeight(x, z) + 0.02, z, s: 0.22 + rng() * 0.12, ry: rng() * 6.28 });
      else {
        const v = Math.floor(rng() * 3);
        sl[v].push({ x, y: baseHeight(x, z) + 0.02, z, s: 0.12 + rng() * 0.12, ry: rng() * 6.28, rx: (rng() - 0.5) * 0.6 });
      }
    }
    addSwayAttrs(star, 0);
    this._inst(star, this.decorMat, stars, { cast: true });
    shells.forEach((g, i) => { addSwayAttrs(g, 0); this._inst(g, this.decorMat, sl[i], { cast: true }); });
  }

  _distant() {
    // sea stacks and a far island on the horizon, a cliff headland framing the bay
    const mat = this.rockMat;
    const island = (x, z, s, sy, seed, green = true) => {
      const g = makeRockGeometry(seed, { detail: 5, flat: 1, rough: 1.2, palette: 'cliff' });
      if (green) {
        const col = g.attributes.color, nrm = g.attributes.normal;
        const grass = new THREE.Color(0x6f9a45);
        const c = new THREE.Color();
        for (let i = 0; i < col.count; i++) {
          const ny = nrm.getY(i);
          const t = smoothstep(0.55, 0.85, ny);
          c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(grass, t * 0.85);
          col.setXYZ(i, c.r, c.g, c.b);
        }
      }
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, -s * 0.15, z);
      m.scale.set(s, sy, s * 0.8);
      m.rotation.y = x * 0.01;
      m.castShadow = false;
      m.receiveShadow = false;
      this.group.add(m);
      return m;
    };
    island(-160, -760, 120, 95, 501);
    island(-60, -820, 60, 40, 502);
    island(260, -640, 70, 120, 503);
    island(320, -700, 26, 60, 504, false);
    island(-420, -520, 90, 55, 505);
    // headland cliffs beyond the left boulders
    island(-110, -50, 34, 26, 506);
    island(-140, -10, 40, 34, 507);
    island(-95, -88, 26, 18, 508);
  }

  _applyObstacles() {
    const sim = this.sim;
    for (const c of this.colliders) {
      if (c.kind !== 'rock' || !c.big) continue;
      const r = c.r * 0.8;
      const i0 = Math.floor((c.x - r - X0) / CELL), i1 = Math.ceil((c.x + r - X0) / CELL);
      const j0 = Math.floor((c.z - r - Z0) / CELL), j1 = Math.ceil((c.z + r - Z0) / CELL);
      for (let j = Math.max(1, j0); j <= Math.min(sim.H - 2, j1); j++) {
        for (let i = Math.max(1, i0); i <= Math.min(sim.W - 2, i1); i++) {
          const x = X0 + i * CELL, z = Z0 + j * CELL;
          const d2 = ((x - c.x) ** 2 + (z - c.z) ** 2) / (r * r);
          if (d2 > 1) continue;
          const k = j * sim.W + i;
          const top = c.h - sim.h[k];
          sim.obst[k] = Math.max(sim.obst[k], top * Math.sqrt(1 - d2));
          sim.obstRock[k] = sim.obst[k];
          sim.bed[k] = Math.max(sim.bed[k], sim.h[k] - 0.05); // can't dig under rocks
        }
      }
    }
  }

  // Hide small decorative props (pebbles, shells, grass) inside a circle.
  clearArea(x, z, r) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const touched = new Set();
    for (const c of this.clearables || []) {
      if (c.cleared) continue;
      if ((c.x - x) ** 2 + (c.z - z) ** 2 < r * r) {
        c.mesh.setMatrixAt(c.i, zero);
        c.cleared = true;
        touched.add(c.mesh);
      }
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }

  nearestCollider(x, z, r = 0) {
    let best = null, bd = Infinity;
    for (const c of this.colliders) {
      const d = Math.hypot(c.x - x, c.z - z) - c.r - r;
      if (d < bd) { bd = d; best = c; }
    }
    return { collider: best, dist: bd };
  }
}

function aSwayMissing(geo) {
  return !geo.attributes.aSway;
}
function addSwayAttrs(geo, sway = 0) {
  const n = geo.attributes.position.count;
  if (!geo.attributes.aSway) geo.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(n).fill(sway), 1));
  if (!geo.attributes.aLeaf) geo.setAttribute('aLeaf', new THREE.BufferAttribute(new Float32Array(n), 1));
}
function setVertexColor(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const nrm = geo.attributes.normal;
  for (let i = 0; i < n; i++) {
    const k = 0.85 + (nrm ? nrm.getY(i) : 1) * 0.15;
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}
