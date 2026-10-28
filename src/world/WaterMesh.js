// Water rendering: the simulated shallow water over the beach grid and the far
// ocean ring out to the horizon. Both are PBR (reflections, sun glints, shadows)
// with custom depth-based colour, flow-mapped ripples, foam and sediment murk.
import * as THREE from 'three';
import { GRID_W, GRID_H, baseHeight } from './config.js';
import { buildGridGeometry, buildRingGeometry } from './TerrainMesh.js';
import { globalUniforms, NOISE_GLSL, CLOUD_GLSL, SIMFETCH_GLSL } from './shaderLib.js';
import { hexToLinear } from '../core/math.js';

const MAXW = 4;

const WATER_COMMON = /* glsl */ `
uniform vec3 uShallow, uMid, uDeep, uAbyss, uMurk;
uniform float uOceanTime;
uniform vec4 uWaveA[${MAXW}];
uniform vec2 uWaveD[${MAXW}];
uniform vec4 uPulse[${MAXW}];
uniform float uPulseW[${MAXW}];

vec2 waterDetail(vec2 p, float t) {
  vec3 a = gnoised(p * 0.9 + t * vec2(0.21, 0.34));
  vec3 b = gnoised(p * 2.3 - t * vec2(0.45, -0.18) + 3.7);
  vec3 c = gnoised(p * 5.7 + t * vec2(-0.3, 0.71) + 8.1);
  vec3 d = gnoised(p * 13.0 + t * vec2(0.9, 0.5) + 1.3);
  return a.yz * 0.9 * 0.055 + b.yz * 2.3 * 0.022 + c.yz * 5.7 * 0.008 + d.yz * 13.0 * 0.0028;
}
vec2 flowDetail(vec2 p, vec2 flow, float t) {
  float ph0 = fract(t * 0.35), ph1 = fract(t * 0.35 + 0.5);
  float w = abs((0.5 - ph0) / 0.5);
  vec2 g0 = waterDetail(p - flow * ph0 * 1.1, t);
  vec2 g1 = waterDetail(p - flow * ph1 * 1.1 + vec2(0.37, 0.71), t);
  return mix(g0, g1, w);
}
float foamPattern(vec2 p, float t) {
  float n = fbm(p * 1.6 + vec2(t * 0.07, -t * 0.05));
  vec2 v = voronoi(p * 3.2 + vec2(0.0, t * 0.1));
  float bubbles = smoothstep(0.25, 0.55, v.x);
  return clamp(n * 0.75 + bubbles * 0.45, 0.0, 1.0);
}
vec3 waterBody(float depth, out float alpha) {
  vec3 c = mix(uShallow, uMid, smoothstep(0.0, 1.3, depth));
  c = mix(c, uDeep, smoothstep(0.9, 4.2, depth));
  c = mix(c, uAbyss, smoothstep(4.0, 14.0, depth));
  alpha = 1.0 - exp(-depth * 1.35);
  return c;
}
float oceanEta(vec2 xz) {
  float e = 0.0;
  for (int i = 0; i < ${MAXW}; i++) {
    vec4 w = uWaveA[i];
    e += w.x * sin(w.y * dot(uWaveD[i], xz) - w.z * uOceanTime + w.w);
  }
  for (int i = 0; i < ${MAXW}; i++) {
    vec4 p = uPulse[i];
    float s = xz.x * p.y + xz.y * p.z;
    float u = (s - p.w) / uPulseW[i];
    e += p.x * exp(-u * u);
  }
  return e;
}
`;

function waterUniforms() {
  return {
    uShallow: { value: new THREE.Vector3(...hexToLinear(0x8fe8da)) },
    uMid: { value: new THREE.Vector3(...hexToLinear(0x2cbccc)) },
    uDeep: { value: new THREE.Vector3(...hexToLinear(0x0f78a8)) },
    uAbyss: { value: new THREE.Vector3(...hexToLinear(0x0a4778)) },
    uMurk: { value: new THREE.Vector3(...hexToLinear(0xc7ad7c)) },
    uOceanTime: { value: 0 },
    uWaveA: { value: Array.from({ length: MAXW }, () => new THREE.Vector4()) },
    uWaveD: { value: Array.from({ length: MAXW }, () => new THREE.Vector2(0, 1)) },
    uPulse: { value: Array.from({ length: MAXW }, () => new THREE.Vector4()) },
    uPulseW: { value: new Array(MAXW).fill(1) },
  };
}

function makeWaterMaterial(kind, sim, shared) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    depthWrite: true,
  });
  const uniforms = {
    ...shared,
    uSimA: { value: sim.texA },
    uSimB: { value: sim.texB },
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
  mat.customProgramCacheKey = () => 'water-' + kind;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.defines = { ...(shader.defines || {}), [kind === 'sim' ? 'SIM_WATER' : 'OCEAN_WATER']: '' };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform sampler2D uSimA;
        uniform float uSeaLevel;
        ${SIMFETCH_GLSL}
        ${NOISE_GLSL}
        ${WATER_COMMON}
        attribute float aExtra;
        varying vec3 vWorldPos;
        varying vec2 vInfo; // x: wet flag, y: bed height (ocean)
      `)
      .replace('#include <beginnormal_vertex>', /* glsl */ `
        float surf;
        #ifdef SIM_WATER
          ivec2 sc = simCell(position.xz);
          ivec2 mx = ivec2(uGridSize) - 1;
          vec4 sA = texelFetch(uSimA, sc, 0);
          float wetFlag = 0.0;
          if (sA.b > 0.003) { surf = sA.r + sA.b; wetFlag = 1.0; }
          else {
            float acc = 0.0, cnt = 0.0;
            for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
              vec4 n = texelFetch(uSimA, clamp(sc + ivec2(dx, dy), ivec2(0), mx), 0);
              if (n.b > 0.003) { acc += n.r + n.b; cnt += 1.0; }
            }
            if (cnt > 0.0) { surf = acc / cnt; wetFlag = 0.5; }
            else surf = sA.r - 0.6;
          }
          float sL, sR, sD, sU;
          vec4 nL = texelFetch(uSimA, clamp(sc + ivec2(-1, 0), ivec2(0), mx), 0);
          vec4 nR = texelFetch(uSimA, clamp(sc + ivec2(1, 0), ivec2(0), mx), 0);
          vec4 nD = texelFetch(uSimA, clamp(sc + ivec2(0, -1), ivec2(0), mx), 0);
          vec4 nU = texelFetch(uSimA, clamp(sc + ivec2(0, 1), ivec2(0), mx), 0);
          sL = nL.b > 0.003 ? nL.r + nL.b : surf;
          sR = nR.b > 0.003 ? nR.r + nR.b : surf;
          sD = nD.b > 0.003 ? nD.r + nD.b : surf;
          sU = nU.b > 0.003 ? nU.r + nU.b : surf;
          vec3 objectNormal = normalize(vec3(sL - sR, 2.0 * uCell, sD - sU));
          vInfo = vec2(wetFlag, 0.0);
        #else
          vec2 xz = position.xz;
          float edgeFade = smoothstep(4.0, 60.0, length(max(abs(xz) - vec2(${(GRID_W * 0.2).toFixed(1)}, ${(GRID_H * 0.2).toFixed(1)}), 0.0)));
          surf = uSeaLevel + oceanEta(xz);
          // long swells far out (for wide cinematic shots)
          float sw = sin(xz.y * 0.045 + xz.x * 0.012 - uOceanTime * 0.62) * 0.7 + sin(xz.y * 0.07 - xz.x * 0.03 - uOceanTime * 0.83 + 1.3) * 0.35;
          surf += sw * edgeFade * smoothstep(800.0, 200.0, length(xz));
          float e = 1.5;
          float hx = oceanEta(xz + vec2(e, 0.0)) - oceanEta(xz - vec2(e, 0.0));
          float hz = oceanEta(xz + vec2(0.0, e)) - oceanEta(xz - vec2(0.0, e));
          vec3 objectNormal = normalize(vec3(-hx, 2.0 * e, -hz));
          vInfo = vec2(1.0, aExtra);
        #endif
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif
      `)
      .replace('#include <begin_vertex>', /* glsl */ `
        vec3 transformed = vec3(position.x, surf, position.z);
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform sampler2D uSimA;
        uniform sampler2D uSimB;
        uniform float uTime, uSeaLevel;
        uniform vec3 uSunDir, uSunColor;
        ${SIMFETCH_GLSL}
        ${NOISE_GLSL}
        ${CLOUD_GLSL}
        ${WATER_COMMON}
        varying vec3 vWorldPos;
        varying vec2 vInfo;
        float gAlpha; float gFoam; float gDepth; vec2 gFlow; float gMurk;
      `)
      .replace('#include <color_fragment>', /* glsl */ `
        {
          vec3 wp = vWorldPos;
          #ifdef SIM_WATER
            vec4 sA = simBilinear(uSimA, wp.xz);
            vec4 sB = simBilinear(uSimB, wp.xz);
            gDepth = max(wp.y - sA.r, 0.0);
            gFlow = sB.xy;
            float simFoam = sA.a;
            gMurk = clamp(sB.z * 30.0, 0.0, 0.75);
          #else
            gDepth = max(wp.y - vInfo.y, 0.0);
            gFlow = vec2(0.0);
            float simFoam = 0.0;
            gMurk = 0.0;
          #endif
          float a;
          vec3 body = waterBody(gDepth, a);
          body = mix(body, uMurk, gMurk);
          a = mix(a, 1.0, gMurk * 0.55);
          // foam: shoreline swash edge + breaking-wave foam from the simulation
          float edge = 1.0 - smoothstep(0.0, 0.16, gDepth);
          float cover = clamp(edge * 0.95 + simFoam * 1.25, 0.0, 1.0);
          vec2 fp = wp.xz - gFlow * 0.6;
          float pat = foamPattern(fp, uTime);
          float foam = smoothstep(1.0 - cover, 1.0 - cover + 0.22, pat) * cover;
          foam = max(foam, smoothstep(0.03, 0.0, gDepth) * 0.0);
          // thin bright line right at the waterline
          foam = max(foam, smoothstep(0.05, 0.015, gDepth) * smoothstep(0.0, 0.006, gDepth) * 0.85);
          #ifdef OCEAN_WATER
            float crest = smoothstep(0.12, 0.38, wp.y - uSeaLevel);
            foam = max(foam, crest * smoothstep(0.55, 0.85, pat) * 0.8);
          #endif
          gFoam = foam;
          // fade to nothing on bare sand
          float edgeAlpha = smoothstep(0.0, 0.02, gDepth);
          gAlpha = max(a, foam) * edgeAlpha;
          diffuseColor.rgb = mix(body, vec3(0.97, 0.98, 1.0), foam);
          diffuseColor.a = gAlpha;
        }
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
        float roughnessFactor = mix(0.045, 0.75, gFoam);
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          float calm = 1.0 - gFoam;
          vec2 g = flowDetail(vWorldPos.xz, gFlow, uTime);
          float amp = smoothstep(0.0, 0.25, gDepth) * calm;
          vec3 nW = normalize(vec3(-g.x * amp, 1.0, -g.y * amp));
          normal = normalize(normal + (viewMatrix * vec4(nW - vec3(0.0, 1.0, 0.0), 0.0)).xyz);
        }
      `)
      .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
        {
          float cs = cloudShadow(vWorldPos);
          reflectedLight.directDiffuse *= cs;
          reflectedLight.directSpecular *= cs;
        }
      `)
      .replace('#include <opaque_fragment>', /* glsl */ `
        {
          // subsurface glow when looking toward the sun through thin water
          vec3 V = normalize(cameraPosition - vWorldPos);
          float back = pow(max(dot(-V, uSunDir), 0.0), 4.0) * smoothstep(0.1, 1.2, gDepth) * (1.0 - smoothstep(1.5, 5.0, gDepth));
          vec3 sss = uMid * uSunColor * back * 0.6 * smoothstep(0.0, 0.2, uSunDir.y);
          vec3 bodyLit = totalDiffuse + sss;
          float a = gAlpha;
          float specL = clamp(dot(totalSpecular, vec3(0.3333)), 0.0, 1.0);
          float edgeAlpha = smoothstep(0.0, 0.02, gDepth);
          float aOut = clamp(a + specL * (1.0 - a) * edgeAlpha, 0.0, 1.0);
          vec3 cOut = (bodyLit * a + totalSpecular * edgeAlpha) / max(aOut, 0.0001);
          gl_FragColor = vec4(cOut + totalEmissiveRadiance, aOut);
        }
      `);
  };
  return mat;
}

export class WaterMesh {
  constructor(scene, sim) {
    this.sim = sim;
    this.shared = waterUniforms();
    const geo = buildGridGeometry(GRID_W, GRID_H, null);
    this.material = makeWaterMaterial('sim', sim, this.shared);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    const ringGeo = buildRingGeometry({
      rings: 48,
      maxDist: 3200,
      heightFn: () => 0,
      extraAttr: (x, z) => baseHeight(x, z),
    });
    this.oceanMaterial = makeWaterMaterial('ocean', sim, this.shared);
    this.ocean = new THREE.Mesh(ringGeo, this.oceanMaterial);
    this.ocean.receiveShadow = true;
    this.ocean.frustumCulled = false;
    this.ocean.renderOrder = 1;
    scene.add(this.ocean);
  }

  update() {
    const sim = this.sim;
    const sh = this.shared;
    sh.uOceanTime.value = sim.time;
    const t = sim.time;
    const env = 0.75 + 0.25 * Math.sin(t * 0.11) * Math.sin(t * 0.047 + 1.0);
    for (let i = 0; i < MAXW; i++) {
      const w = sim.waves[i];
      if (w) {
        sh.uWaveA.value[i].set(w.A * sim.waveScale * env, w.k, w.om, w.ph);
        sh.uWaveD.value[i].set(w.dx, w.dz);
      } else sh.uWaveA.value[i].set(0, 0, 0, 0);
      const p = sim.pulses[i];
      if (p) {
        sh.uPulse.value[i].set(p.A, p.dx, p.dz, p.s0 + p.c * (t - p.t0));
        sh.uPulseW.value[i] = p.width;
      } else {
        sh.uPulse.value[i].set(0, 0, 1, -9999);
        sh.uPulseW.value[i] = 1;
      }
    }
  }
}
