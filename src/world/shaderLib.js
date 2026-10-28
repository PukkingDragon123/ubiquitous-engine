// Shared GLSL snippets + global uniforms referenced by many materials.
import * as THREE from 'three';
import { GRID_W, GRID_H, CELL, X0, Z0 } from './config.js';

export const globalUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.4, 0.8, -0.3).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.9, 0.75) },
  uCloudCover: { value: 0.3 },
  uWind: { value: new THREE.Vector2(1.2, 0.5) },
  uSeaLevel: { value: 0 },
  uGridOrigin: { value: new THREE.Vector2(X0, Z0) },
  uGridSize: { value: new THREE.Vector2(GRID_W, GRID_H) },
  uCell: { value: CELL },
  uNight: { value: 0 },
};

export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// gradient noise with analytic derivative (returns value, d/dx, d/dy)
vec3 gnoised(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = hash22(i) * 2.0 - 1.0;
  vec2 gb = hash22(i + vec2(1, 0)) * 2.0 - 1.0;
  vec2 gc = hash22(i + vec2(0, 1)) * 2.0 - 1.0;
  vec2 gd = hash22(i + vec2(1, 1)) * 2.0 - 1.0;
  float va = dot(ga, f), vb = dot(gb, f - vec2(1, 0)), vc = dot(gc, f - vec2(0, 1)), vd = dot(gd, f - vec2(1, 1));
  return vec3(va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd),
    ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) +
    du * (u.yx * (va - vb - vc + vd) + vec2(vb, vc) - va));
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
// cellular noise: x = distance to nearest feature, y = random id of that cell
vec2 voronoi(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float md = 8.0; float id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(n + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; id = hash12(n + g + 7.7); }
  }
  return vec2(sqrt(md), id);
}
`;

export const CLOUD_GLSL = /* glsl */ `
uniform float uCloudCover;
uniform vec2 uWind;
float cloudShadow(vec3 wp) {
  vec2 p = wp.xz * 0.012 + uWind * uTime * 0.004;
  float n = fbm(p) * 0.65 + fbm(p * 2.7 + 3.1) * 0.35;
  float c = smoothstep(1.0 - uCloudCover - 0.12, 1.0 - uCloudCover + 0.22, n);
  return 1.0 - c * 0.42;
}
`;

// Manual bilinear fetch from an unfiltered float texture laid out on the sim grid.
export const SIMFETCH_GLSL = /* glsl */ `
uniform vec2 uGridOrigin;
uniform vec2 uGridSize;
uniform float uCell;
vec4 simBilinear(sampler2D tex, vec2 wxz) {
  vec2 g = clamp((wxz - uGridOrigin) / uCell, vec2(0.0), uGridSize - 1.001);
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  vec4 a = texelFetch(tex, i, 0);
  vec4 b = texelFetch(tex, i + ivec2(1, 0), 0);
  vec4 c = texelFetch(tex, i + ivec2(0, 1), 0);
  vec4 d = texelFetch(tex, i + ivec2(1, 1), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
ivec2 simCell(vec2 wxz) {
  return ivec2(clamp(floor((wxz - uGridOrigin) / uCell + 0.5), vec2(0.0), uGridSize - 1.0));
}
`;
