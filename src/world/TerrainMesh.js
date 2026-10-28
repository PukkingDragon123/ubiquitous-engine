// Terrain rendering: the simulated sand grid (heights streamed from the sim via
// a float texture) plus a static outer ring that continues the coast to the
// horizon. Both share one sand shader built on MeshStandardMaterial.
import * as THREE from 'three';
import { GRID_W, GRID_H, CELL, X0, Z0, baseHeight } from './config.js';
import { globalUniforms, NOISE_GLSL, CLOUD_GLSL, SIMFETCH_GLSL } from './shaderLib.js';
import { hexToLinear } from '../core/math.js';

export function buildGridGeometry(W, H, heightFn) {
  const pos = new Float32Array(W * H * 3);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = (j * W + i) * 3;
      const x = X0 + i * CELL, z = Z0 + j * CELL;
      pos[k] = x; pos[k + 1] = heightFn ? heightFn(x, z) : 0; pos[k + 2] = z;
    }
  }
  const idx = new Uint32Array((W - 1) * (H - 1) * 6);
  let n = 0;
  for (let j = 0; j < H - 1; j++) {
    for (let i = 0; i < W - 1; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      // alternate diagonals for a less directional look
      if ((i + j) & 1) { idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d; }
      else { idx[n++] = a; idx[n++] = c; idx[n++] = d; idx[n++] = a; idx[n++] = d; idx[n++] = b; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(W * H * 3).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 200);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(X0, -20, Z0), new THREE.Vector3(-X0, 30, -Z0));
  return g;
}

// Ring of vertices expanding outward from the sim grid's perimeter.
export function buildRingGeometry({ rings = 46, maxDist = 2600, heightFn, extraAttr }) {
  const W = GRID_W, H = GRID_H;
  const per = [];
  for (let i = 0; i < W - 1; i++) per.push([i, 0, 0, -1]);
  for (let j = 0; j < H - 1; j++) per.push([W - 1, j, 1, 0]);
  for (let i = W - 1; i > 0; i--) per.push([i, H - 1, 0, 1]);
  for (let j = H - 1; j > 0; j--) per.push([0, j, -1, 0]);
  // corner normals
  for (const p of per) {
    const [i, j] = p;
    if (i === 0 && j === 0) { p[2] = -1; p[3] = -1; }
    if (i === W - 1 && j === 0) { p[2] = 1; p[3] = -1; }
    if (i === W - 1 && j === H - 1) { p[2] = 1; p[3] = 1; }
    if (i === 0 && j === H - 1) { p[2] = -1; p[3] = 1; }
  }
  const P = per.length;
  const R = rings + 1;
  const pos = new Float32Array(P * R * 3);
  const extra = extraAttr ? new Float32Array(P * R) : null;
  for (let r = 0; r < R; r++) {
    const t = r / rings;
    const o = r === 0 ? 0 : CELL * 1.2 * r + Math.pow(t, 2.6) * maxDist;
    for (let p = 0; p < P; p++) {
      const [i, j, nx, nz] = per[p];
      const bx = X0 + i * CELL, bz = Z0 + j * CELL;
      // blend from rectangle toward a rounded shape far away
      let dx = nx, dz = nz;
      const cx = bx, cz = bz;
      const rl = Math.hypot(cx, cz) || 1;
      const blend = Math.min(1, t * 1.6);
      dx = dx * (1 - blend) + (cx / rl) * blend * 1.4;
      dz = dz * (1 - blend) + (cz / rl) * blend * 1.4;
      const x = bx + dx * o, z = bz + dz * o;
      const k = (r * P + p) * 3;
      pos[k] = x; pos[k + 2] = z;
      pos[k + 1] = heightFn(x, z);
      if (extra) extra[r * P + p] = extraAttr(x, z);
    }
  }
  const idx = [];
  for (let r = 0; r < rings; r++) {
    for (let p = 0; p < P; p++) {
      const a = r * P + p, b = r * P + ((p + 1) % P), c = (r + 1) * P + p, d = (r + 1) * P + ((p + 1) % P);
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (extra) g.setAttribute('aExtra', new THREE.BufferAttribute(extra, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const SAND_UNIFORMS = () => ({
  uSandA: { value: new THREE.Vector3(...hexToLinear(0xe3c592)) },
  uSandB: { value: new THREE.Vector3(...hexToLinear(0xd6ae7e)) },
  uSandDune: { value: new THREE.Vector3(...hexToLinear(0xeed9b0)) },
  uSandWet: { value: new THREE.Vector3(...hexToLinear(0x8a6c4a)) },
});

// Builds the sand material. sim=true → heights come from the simulation texture.
export function createSandMaterial(sim, simTexA, simTexB) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const uniforms = {
    ...SAND_UNIFORMS(),
    uSimA: { value: simTexA || null },
    uSimB: { value: simTexB || null },
    uTime: globalUniforms.uTime,
    uSeaLevel: globalUniforms.uSeaLevel,
    uSunDir: globalUniforms.uSunDir,
    uSunColor: globalUniforms.uSunColor,
    uCloudCover: globalUniforms.uCloudCover,
    uWind: globalUniforms.uWind,
    uGridOrigin: globalUniforms.uGridOrigin,
    uGridSize: globalUniforms.uGridSize,
    uCell: globalUniforms.uCell,
  };
  mat.userData.uniforms = uniforms;
  mat.customProgramCacheKey = () => (sim ? 'sand-sim' : 'sand-static');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (sim) shader.defines = { ...(shader.defines || {}), SIM_TERRAIN: '' };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform sampler2D uSimA;
        uniform sampler2D uSimB;
        uniform float uSeaLevel;
        ${SIMFETCH_GLSL}
        varying vec3 vWorldPos;
        varying vec4 vSim; // wet, depth, foam, disturb
      `)
      .replace('#include <beginnormal_vertex>', /* glsl */ `
        #ifdef SIM_TERRAIN
          ivec2 sc = simCell(position.xz);
          ivec2 mx = ivec2(uGridSize) - 1;
          vec4 sA = texelFetch(uSimA, sc, 0);
          float hL = texelFetch(uSimA, clamp(sc + ivec2(-1, 0), ivec2(0), mx), 0).r;
          float hR = texelFetch(uSimA, clamp(sc + ivec2(1, 0), ivec2(0), mx), 0).r;
          float hD = texelFetch(uSimA, clamp(sc + ivec2(0, -1), ivec2(0), mx), 0).r;
          float hU = texelFetch(uSimA, clamp(sc + ivec2(0, 1), ivec2(0), mx), 0).r;
          vec3 objectNormal = normalize(vec3(hL - hR, 2.0 * uCell, hD - hU));
          float simH = sA.r;
          vSim = vec4(sA.g, sA.b, sA.a, texelFetch(uSimB, sc, 0).a);
        #else
          vec3 objectNormal = vec3(normal);
          float simH = position.y;
          vSim = vec4(clamp(1.0 - (position.y - uSeaLevel - 0.12) / 1.0, 0.0, 1.0) * 0.82, max(uSeaLevel - position.y, 0.0), 0.0, 0.0);
        #endif
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif
      `)
      .replace('#include <begin_vertex>', /* glsl */ `
        vec3 transformed = vec3(position.x, simH, position.z);
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform vec3 uSandA, uSandB, uSandDune, uSandWet;
        uniform float uTime, uSeaLevel;
        uniform vec3 uSunDir, uSunColor;
        varying vec3 vWorldPos;
        varying vec4 vSim;
        ${NOISE_GLSL}
        ${CLOUD_GLSL}
        float causticPattern(vec2 uv, float t) {
          vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
          vec2 i = p;
          float c = 1.0;
          float inten = 0.005;
          for (int n = 0; n < 4; n++) {
            float tt = t * (1.0 - (3.5 / float(n + 1)));
            i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
            c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
          }
          c /= 4.0;
          c = 1.17 - pow(c, 1.4);
          return pow(abs(c), 8.0);
        }
        float gWet; float gFilm; float gDepth; vec3 gAlbedo;
      `)
      .replace('#include <color_fragment>', /* glsl */ `
        {
          vec3 wp = vWorldPos;
          float wet = smoothstep(0.04, 0.95, vSim.x);
          gDepth = vSim.y;
          float elev = wp.y - uSeaLevel;
          float macro = fbm(wp.xz * 0.04);
          vec3 alb = mix(uSandA, uSandB, smoothstep(0.32, 0.72, macro));
          alb = mix(alb, uSandDune, smoothstep(1.2, 4.0, elev) * 0.6);
          // grain
          alb *= 0.92 + 0.16 * vnoise(wp.xz * 55.0) * vnoise(wp.xz * 13.0 + 3.0);
          // dark pebble speckles of varying size (sparser on the dunes)
          float pebDensity = mix(0.9, 0.95, smoothstep(1.0, 3.0, elev));
          vec2 v1 = voronoi(wp.xz * 2.4);
          float rad = 0.07 + 0.09 * fract(v1.y * 37.0);
          float speck = smoothstep(rad, rad - 0.035, v1.x) * step(pebDensity, v1.y);
          alb = mix(alb, mix(vec3(0.07, 0.06, 0.055), vec3(0.32, 0.27, 0.22), fract(v1.y * 91.0)), speck * 0.92);
          vec2 v3 = voronoi(wp.xz * 6.0 + 17.0);
          alb = mix(alb, vec3(0.12, 0.1, 0.09), smoothstep(0.1, 0.05, v3.x) * step(0.84, v3.y) * 0.8);
          // shell fragments
          vec2 v2 = voronoi(wp.xz * 1.6 + 31.0);
          float shell = smoothstep(0.075, 0.03, v2.x) * step(0.95, v2.y);
          alb = mix(alb, mix(vec3(0.98, 0.92, 0.86), vec3(0.96, 0.66, 0.55), fract(v2.y * 13.0)), shell * 0.9);
          // faint wrack line at the high-water mark
          float wrack = exp(-pow((elev - 0.95) / 0.12, 2.0)) * smoothstep(0.55, 0.75, fbm(wp.xz * 0.8 + 4.0));
          alb = mix(alb, vec3(0.3, 0.24, 0.15), wrack * 0.3 * (1.0 - wet));
          // freshly disturbed sand is clumpier and a touch darker
          float dist = vSim.w;
          alb *= 1.0 - dist * 0.12 * (0.6 + 0.4 * vnoise(wp.xz * 9.0));
          // moisture darkening
          vec3 wetCol = alb * uSandWet / max(uSandA, vec3(0.01));
          alb = mix(alb, wetCol, wet);
          // a glossy film just after the swash recedes
          gFilm = smoothstep(0.92, 1.0, vSim.x) * (1.0 - smoothstep(0.0, 0.05, gDepth));
          // foam lace left on the sand
          float lace = smoothstep(0.5, 0.8, fbm(wp.xz * 3.0 + uTime * 0.05)) * smoothstep(0.02, 0.4, vSim.z) * (1.0 - smoothstep(0.02, 0.3, gDepth));
          alb = mix(alb, vec3(0.92, 0.94, 0.95), lace * 0.7);
          gWet = wet;
          gAlbedo = alb;
          diffuseColor.rgb = alb;
        }
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
        float roughnessFactor = mix(0.93, 0.42, gWet);
        roughnessFactor = mix(roughnessFactor, 0.09, gFilm);
        roughnessFactor = mix(roughnessFactor, 0.6, smoothstep(0.02, 0.2, gDepth));
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 wp = vWorldPos;
          float elev = wp.y - uSeaLevel;
          vec2 grad = vec2(0.0);
          // fine grain
          vec3 gn = gnoised(wp.xz * 22.0);
          grad += gn.yz * 0.012 * (1.0 - gFilm);
          // wave ripple marks in the intertidal / shallow zone
          float rip = (1.0 - smoothstep(0.6, 1.6, elev)) * smoothstep(-3.0, -0.4, elev);
          vec3 warp = gnoised(wp.xz * 0.35);
          float ph = wp.z * 2.6 + wp.x * 0.35 + warp.x * 3.0;
          grad += vec2(0.35, 2.6) * cos(ph) * 0.045 * rip;
          // wind ripples on the dry upper beach
          float dune = smoothstep(1.4, 3.0, elev) * (1.0 - gWet);
          vec3 warp2 = gnoised(wp.xz * 0.21 + 7.0);
          float ph2 = wp.x * 1.4 - wp.z * 0.9 + warp2.x * 4.0;
          float saw = cos(ph2) + 0.35 * cos(ph2 * 2.0);
          grad += vec2(1.4, -0.9) * saw * 0.06 * dune;
          // clumps where sand was disturbed
          vec3 cl = gnoised(wp.xz * 6.0 + 9.0);
          grad += cl.yz * 0.05 * vSim.w;
          vec3 nW = normalize(vec3(-grad.x, 1.0, -grad.y));
          vec3 pertV = (viewMatrix * vec4(nW - vec3(0.0, 1.0, 0.0), 0.0)).xyz;
          normal = normalize(normal + pertV);
        }
      `)
      .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
        {
          float cs = cloudShadow(vWorldPos);
          reflectedLight.directDiffuse *= cs;
          reflectedLight.directSpecular *= cs;
          // caustics on the sea floor
          float under = smoothstep(0.02, 0.3, gDepth) * exp(-gDepth * 0.3);
          if (under > 0.001) {
            vec2 cuv = vWorldPos.xz * 0.11;
            float c = causticPattern(cuv, uTime * 0.55) + causticPattern(cuv * 1.3 + 0.37, uTime * 0.43 + 4.0) * 0.6;
            float sunUp = smoothstep(0.0, 0.25, uSunDir.y);
            reflectedLight.directDiffuse += gAlbedo * uSunColor * c * under * 1.8 * sunUp * cs;
          }
        }
      `);
  };
  return mat;
}

export class TerrainMesh {
  constructor(scene, sim) {
    this.sim = sim;
    const geo = buildGridGeometry(GRID_W, GRID_H, baseHeight);
    this.material = createSandMaterial(true, sim.texA, sim.texB);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    // matching displacement for the shadow pass
    this.mesh.customDepthMaterial = createSimDepthMaterial(sim.texA);
    scene.add(this.mesh);

    const ringGeo = buildRingGeometry({ rings: 44, maxDist: 2400, heightFn: (x, z) => baseHeight(x, z) });
    this.outerMaterial = createSandMaterial(false);
    this.outer = new THREE.Mesh(ringGeo, this.outerMaterial);
    this.outer.receiveShadow = true;
    this.outer.castShadow = false;
    scene.add(this.outer);
  }
}

function createSimDepthMaterial(simTexA) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSimA = { value: simTexA };
    shader.uniforms.uGridOrigin = globalUniforms.uGridOrigin;
    shader.uniforms.uGridSize = globalUniforms.uGridSize;
    shader.uniforms.uCell = globalUniforms.uCell;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uSimA;
        ${SIMFETCH_GLSL}`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position.x, texelFetch(uSimA, simCell(position.xz), 0).r, position.z);`);
  };
  m.customProgramCacheKey = () => 'sand-sim-depth';
  return m;
}
