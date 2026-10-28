// Renderer, scene, camera and the cinematic post-processing stack.
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, DepthOfFieldEffect,
  ToneMappingEffect, ToneMappingMode, VignetteEffect, Effect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

// Final colour grade: warmth, lift/gamma/gain, saturation, soft film grain and
// a gentle chromatic fringe toward the edges.
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
      uniform float uSaturation;
      uniform float uContrast;
      uniform vec3 uLift;
      uniform vec3 uGain;
      uniform float uGrain;
      uniform float uTimeG;
      uniform float uFade;
      uniform vec3 uFadeColor;
      uniform float uDesat;
      float gHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, uSaturation * (1.0 - uDesat));
        c = (c - 0.5) * uContrast + 0.5;
        c = c * uGain + uLift * (1.0 - c);
        float g = gHash(uv * 1000.0 + fract(uTimeG * 7.13)) - 0.5;
        c += g * uGrain;
        c = mix(c, uFadeColor, uFade);
        outputColor = vec4(max(c, 0.0), inputColor.a);
      }
    `, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uSaturation', new THREE.Uniform(1.12)],
        ['uContrast', new THREE.Uniform(1.04)],
        ['uLift', new THREE.Uniform(new THREE.Vector3(0.018, 0.012, 0.008))],
        ['uGain', new THREE.Uniform(new THREE.Vector3(1.02, 1.0, 0.97))],
        ['uGrain', new THREE.Uniform(0.025)],
        ['uTimeG', new THREE.Uniform(0)],
        ['uFade', new THREE.Uniform(0)],
        ['uFadeColor', new THREE.Uniform(new THREE.Vector3(0.98, 0.94, 0.86))],
        ['uDesat', new THREE.Uniform(0)],
      ]),
    });
  }
}

export class Engine {
  constructor(container) {
    this.container = container;
    const renderer = (this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    }));
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(this.maxPixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.08, 6000);
    this.camera.position.set(0, 30, 40);

    this.quality = 'high';
    this._setupComposer();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  _setupComposer() {
    const { renderer, scene, camera } = this;
    const composer = (this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 4,
    }));
    this.renderPass = new RenderPass(scene, camera);
    composer.addPass(this.renderPass);

    const ao = (this.ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight));
    ao.configuration.aoRadius = 1.6;
    ao.configuration.distanceFalloff = 1.2;
    ao.configuration.intensity = 2.6;
    ao.configuration.color = new THREE.Color(0x3a2618);
    ao.configuration.halfRes = true;
    ao.configuration.gammaCorrection = false;
    ao.setQualityMode('Medium');
    composer.addPass(ao);

    this.dof = new DepthOfFieldEffect(camera, {
      focusDistance: 40,
      focusRange: 18,
      bokehScale: 3.0,
      resolutionScale: 0.5,
    });
    this.bloom = new BloomEffect({
      mipmapBlur: true,
      intensity: 0.55,
      luminanceThreshold: 0.92,
      luminanceSmoothing: 0.25,
      radius: 0.72,
    });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    this.grade = new GradeEffect();
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });

    this.dofPass = new EffectPass(camera, this.dof);
    composer.addPass(this.dofPass);
    this.finalPass = new EffectPass(camera, this.bloom, this.tone, this.grade, this.vignette);
    composer.addPass(this.finalPass);
  }

  setQuality(q) {
    this.quality = q;
    const high = q === 'high';
    this.ao.enabled = q !== 'low';
    this.dofPass.enabled = q !== 'low';
    this.renderer.setPixelRatio(high ? this.maxPixelRatio : q === 'medium' ? Math.min(this.maxPixelRatio, 1.25) : 1);
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  render(dt) {
    this.grade.uniforms.get('uTimeG').value += dt;
    this.composer.render(dt);
  }
}
