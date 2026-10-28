// Thin wrapper around InstancedMesh for per-frame rebuilt instance lists.
import * as THREE from 'three';

export class InstancedLayer {
  constructor(parent, geometry, material, max, { cast = true, receive = true, colors = true, fx = false, order = 0 } = {}) {
    this.max = max;
    this.n = 0;
    if (fx) {
      this.fx = new Float32Array(max * 2);
      this.fxAttr = new THREE.InstancedBufferAttribute(this.fx, 2);
      this.fxAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aFx', this.fxAttr);
    }
    const mesh = (this.mesh = new THREE.InstancedMesh(geometry, material, max));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (colors) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = order;
    parent.add(mesh);
  }

  begin() { this.n = 0; }

  push(matrix, color, fx0 = 0, fx1 = 0) {
    if (this.n >= this.max) return -1;
    const i = this.n++;
    this.mesh.setMatrixAt(i, matrix);
    if (color && this.mesh.instanceColor) this.mesh.setColorAt(i, color);
    if (this.fx) { this.fx[i * 2] = fx0; this.fx[i * 2 + 1] = fx1; }
    return i;
  }

  end() {
    const m = this.mesh;
    m.count = this.n;
    m.instanceMatrix.clearUpdateRanges();
    m.instanceMatrix.addUpdateRange(0, this.n * 16);
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) {
      m.instanceColor.clearUpdateRanges();
      m.instanceColor.addUpdateRange(0, this.n * 3);
      m.instanceColor.needsUpdate = true;
    }
    if (this.fxAttr) {
      this.fxAttr.clearUpdateRanges();
      this.fxAttr.addUpdateRange(0, this.n * 2);
      this.fxAttr.needsUpdate = true;
    }
  }
}

// Sand-body material: grainy packed sand, per-instance wetness + hit flash, rim light.
export function makeSandBodyMaterial({ roughness = 0.9, rim = 0.1, stump = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0 });
  mat.customProgramCacheKey = () => 'sandbody' + (stump ? '-stump' : '') + rim;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aFx;
        varying vec2 vFx;
        varying vec3 vLocal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFx = aFx;
        vLocal = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vFx;
        varying vec3 vLocal;
        float sbHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float sbNoise(vec3 x) {
          vec3 i = floor(x), f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(sbHash(i), sbHash(i + vec3(1, 0, 0)), f.x), mix(sbHash(i + vec3(0, 1, 0)), sbHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(sbHash(i + vec3(0, 0, 1)), sbHash(i + vec3(1, 0, 1)), f.x), mix(sbHash(i + vec3(0, 1, 1)), sbHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        float gWetB;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          ${stump ? `
          float r = length(vLocal.xz) / 0.075;
          vec3 core = vec3(0.32, 0.24, 0.15);
          vec3 ring = vec3(0.62, 0.5, 0.34);
          diffuseColor.rgb = mix(core, ring, smoothstep(0.55, 0.85, r));
          float peb = step(0.82, sbNoise(vLocal * 120.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.85, 0.8), peb * 0.6 * (1.0 - smoothstep(0.5, 0.7, r)));
          ` : `
          float g = sbNoise(vLocal * 70.0) * 0.6 + sbNoise(vLocal * 23.0) * 0.4;
          diffuseColor.rgb *= 0.88 + 0.2 * g;
          float speck = step(0.93, sbNoise(vLocal * 95.0 + 3.1));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.16, 0.12), speck * 0.7);
          `}
          gWetB = vFx.x;
          diffuseColor.rgb *= mix(1.0, 0.58, gWetB);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.4, gWetB);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 Vv = normalize(vViewPosition);
          float rimF = pow(1.0 - clamp(dot(normalize(vNormal), Vv), 0.0, 1.0), 3.0);
          totalEmissiveRadiance += vec3(1.0, 0.82, 0.55) * rimF * ${rim.toFixed(2)} + vec3(1.0, 0.9, 0.75) * vFx.y * 0.9;
        }`);
  };
  return mat;
}
