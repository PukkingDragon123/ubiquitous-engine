// Materials for buildings: packed sand (construction reveal, wetness, cracks,
// erosion melt), driftwood, shells, pebbles, cloth, flags and the blueprint
// ghost used while placing.
import * as THREE from 'three';
import { globalUniforms, NOISE_GLSL, CLOUD_GLSL } from '../world/shaderLib.js';

const SAND_COL = new THREE.Color(0xe0bf8a);

// Packed-sand material. Each building creates its own instance (own uniforms);
// the compiled program is shared through the cache key.
export function makeBuildingSandMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.92, metalness: 0 });
  const u = {
    uReveal: { value: 1 },
    uBaseY: { value: 0 },
    uHeight: { value: 3 },
    uWet: { value: 0 },
    uDamage: { value: 0 },
    uErode: { value: 0 },
    uGlow: { value: 0 },
    uCutY: { value: 1e5 },
    uTint: { value: SAND_COL.clone() },
    uTime: globalUniforms.uTime,
    uCloudCover: globalUniforms.uCloudCover,
    uWind: globalUniforms.uWind,
    uSeaLevel: globalUniforms.uSeaLevel,
  };
  mat.userData.u = u;
  mat.customProgramCacheKey = () => 'bsand';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uBaseY, uHeight, uErode;
        varying vec3 vWB;
        float bHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          // wave erosion: the base slumps outward and the top sags
          vec4 wp0 = modelMatrix * vec4(transformed, 1.0);
          float h01 = clamp((wp0.y - uBaseY) / max(uHeight, 0.01), 0.0, 1.0);
          float wob = bHash(floor(transformed * 6.0)) * 0.5 + 0.5;
          float sag = uErode * (0.35 + 0.65 * h01) * (0.5 + 0.5 * wob);
          transformed.y -= sag * uHeight * 0.32;
          transformed.xz *= 1.0 + uErode * (1.0 - h01) * 0.25;
        }`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWB = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uReveal, uBaseY, uHeight, uWet, uDamage, uErode, uGlow, uTime, uSeaLevel, uCutY;
        uniform vec3 uTint;
        varying vec3 vWB;
        ${NOISE_GLSL}
        ${CLOUD_GLSL}
        float gBW; float gFresh;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float cutY = uBaseY + uHeight * uReveal;
        if (uReveal < 0.999 && vWB.y > cutY) discard;
        if (vWB.y > uCutY) discard; // dollhouse cutaway while inspecting`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 p = vWB;
          float g = vnoise(p.xz * 40.0 + p.y * 17.0) * 0.5 + vnoise(p.xy * 37.0) * 0.25 + vnoise(p.zy * 41.0) * 0.25;
          vec3 c = uTint * diffuseColor.rgb;
          c *= 0.9 + 0.18 * g;
          // bucket-packed layers
          float layer = smoothstep(0.42, 0.5, abs(fract(p.y * 3.2 + vnoise(p.xz * 2.0) * 0.4) - 0.5));
          c *= 1.0 - layer * 0.05;
          // pebble specks
          vec2 v = voronoi(p.xz * 6.0 + p.y * 5.0);
          c = mix(c, vec3(0.16, 0.13, 0.1), smoothstep(0.1, 0.05, v.x) * step(0.88, v.y) * 0.7);
          // freshly packed (still wet) band at the construction line
          float cutY = uBaseY + uHeight * uReveal;
          gFresh = uReveal < 0.999 ? (1.0 - smoothstep(0.0, 0.5, cutY - p.y)) : 0.0;
          // wetness rises from the base when waves hit
          float wetLine = uBaseY + uHeight * uWet * 0.8 + 0.2 * vnoise(p.xz * 3.0 + uTime * 0.1);
          gBW = max(gFresh, (1.0 - smoothstep(wetLine - 0.15, wetLine + 0.1, p.y)) * step(0.01, uWet));
          c *= mix(1.0, 0.6, gBW);
          // cracks from damage
          if (uDamage > 0.02) {
            vec2 cv = voronoi(p.xy * 2.2 + p.zx * 2.2);
            vec2 cv2 = voronoi(p.zy * 2.6 + 3.0);
            float edge = smoothstep(0.08, 0.0, abs(cv.x - cv2.x * 0.9) * 0.5);
            float crack = edge * step(1.0 - uDamage * 1.2, fract(cv.y * 7.0 + cv2.y * 3.0));
            c = mix(c, c * 0.35, crack * 0.85);
          }
          c += vec3(1.0, 0.85, 0.5) * uGlow * 0.25;
          // inside faces revealed by the cutaway: darker, cool packed sand + a bright cut edge
          if (!gl_FrontFacing) c *= vec3(0.55, 0.5, 0.48);
          if (uCutY < 1e4) c = mix(c, vec3(0.95, 0.82, 0.6), smoothstep(0.06, 0.0, uCutY - vWB.y) * 0.8);
          diffuseColor.rgb = c;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.45, gBW);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { float cs = cloudShadow(vWB); reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs; }`);
  };
  return mat;
}

// Flags: vertex-animated cloth (attribute aFlag = 0 at the pole → 1 at the tip).
export function makeFlagMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  mat.customProgramCacheKey = () => 'flag';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = globalUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        attribute float aFlag;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float w = aFlag;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float ph = uTime * 7.0 - w * 5.0 + wp.x * 0.7 + wp.z * 0.5;
          transformed.z += sin(ph) * 0.12 * w;
          transformed.y += cos(ph * 0.7) * 0.03 * w;
        }`);
  };
  return mat;
}

export function makeFlagGeometry(flags) {
  const list = [];
  for (const f of flags) {
    const s = f.size;
    const g = new THREE.PlaneGeometry(0.75 * s, 0.42 * s, 6, 2);
    const p = g.attributes.position;
    const af = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + 0.375 * s;
      // swallowtail notch
      const y = p.getY(i);
      if (x > 0.6 * s) p.setX(i, p.getX(i) - Math.max(0, 0.12 * s - Math.abs(y) * 0.6) * 0.0);
      af[i] = x / (0.75 * s);
      p.setX(i, x);
    }
    g.setAttribute('aFlag', new THREE.BufferAttribute(af, 1));
    g.translate(f.x, f.y - 0.21 * s, f.z);
    const c = new THREE.Color(f.color);
    const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.deleteAttribute('uv');
    list.push(g.toNonIndexed());
  }
  return list;
}

export function makeSharedBuildingMaterials() {
  const flat = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, ...o });
  const shell = flat({ roughness: 0.6 });
  return {
    wood: flat({ roughness: 0.82 }),
    shell,
    throne: shell.clone(),
    interior: flat({ roughness: 0.75 }),
    stone: flat({ roughness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24170f, roughness: 1 }),
    cloth: flat({ roughness: 0.92, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ color: 0xea5a4a, roughness: 0.4 }),
    gem: flat({ roughness: 0.05, emissive: 0x3a8a7a, emissiveIntensity: 0.8 }),
    flag: makeFlagMaterial(),
  };
}

// Blueprint ghost: translucent, hand-drawn-looking blue lines.
export function makeGhostMaterial() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: globalUniforms.uTime, uValid: { value: 1 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uValid;
      varying vec3 vN; varying vec3 vW; varying vec3 vV;
      void main() {
        float fr = pow(1.0 - abs(dot(vN, vV)), 2.0);
        vec3 grid = abs(fract(vW * 2.0) - 0.5);
        float line = 1.0 - smoothstep(0.0, 0.05, min(min(grid.x, grid.y), grid.z));
        float scan = 0.5 + 0.5 * sin(vW.y * 12.0 - uTime * 4.0);
        vec3 col = mix(vec3(1.0, 0.38, 0.3), vec3(0.42, 0.72, 1.0), uValid);
        float a = 0.1 + fr * 0.45 + line * 0.3 + scan * 0.05;
        gl_FragColor = vec4(col * (0.75 + line * 0.6), a);
      }`,
  });
  return mat;
}
