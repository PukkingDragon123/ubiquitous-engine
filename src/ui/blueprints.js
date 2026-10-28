// Renders each building model as an ink-on-parchment blueprint sketch, using
// the game's own renderer once into an offscreen target.
import * as THREE from 'three';
import { getModel } from '../buildings/Buildings.js';

const cache = new Map();

export function blueprintImage(renderer, type) {
  if (cache.has(type)) return cache.get(type);
  const W = 360, H = 270;
  const model = getModel(type);
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  const ink = new THREE.LineBasicMaterial({ color: 0x23406e, transparent: true, opacity: 0.9 });
  const ink2 = new THREE.LineBasicMaterial({ color: 0x23406e, transparent: true, opacity: 0.35 });
  const fill = new THREE.MeshBasicMaterial({ color: 0xf3e3c0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const geos = [...Object.values(model.parts), ...Object.values(model.lift)];
  if (model.flagGeo) geos.push(model.flagGeo);
  for (const g of geos) {
    group.add(new THREE.Mesh(g, fill));
    const edges = new THREE.EdgesGeometry(g, 28);
    group.add(new THREE.LineSegments(edges, ink));
    // second, slightly offset pass for a sketchy hand-drawn feel
    const l2 = new THREE.LineSegments(edges, ink2);
    l2.position.set(0.012, 0.01, -0.008);
    group.add(l2);
  }
  scene.add(group);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y * 1.2, size.z) * 0.62 + 0.3;
  const cam = new THREE.OrthographicCamera(-r * (W / H), r * (W / H), r, -r, 0.1, 100);
  cam.position.set(center.x + r * 1.6, center.y + r * 1.25, center.z + r * 2.0);
  cam.lookAt(center);
  const rt = new THREE.WebGLRenderTarget(W * 2, H * 2, { samples: 4 });
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const px = new Uint8Array(W * 2 * H * 2 * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W * 2, H * 2, px);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.toneMapping = prevTone;
  rt.dispose();
  const c = document.createElement('canvas');
  c.width = W * 2; c.height = H * 2;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W * 2, H * 2);
  // flip Y
  for (let y = 0; y < H * 2; y++) {
    const src = (H * 2 - 1 - y) * W * 2 * 4;
    img.data.set(px.subarray(src, src + W * 2 * 4), y * W * 2 * 4);
  }
  ctx.putImageData(img, 0, 0);
  // dimension marks in ink
  ctx.strokeStyle = 'rgba(35,64,110,0.55)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.moveTo(40, H * 2 - 40); ctx.lineTo(W * 2 - 40, H * 2 - 40); ctx.stroke();
  ctx.setLineDash([]);
  for (const x of [40, W * 2 - 40]) { ctx.beginPath(); ctx.moveTo(x, H * 2 - 52); ctx.lineTo(x, H * 2 - 28); ctx.stroke(); }
  const url = c.toDataURL('image/png');
  group.traverse((o) => { if (o.isLineSegments) o.geometry.dispose(); });
  cache.set(type, url);
  return url;
}
