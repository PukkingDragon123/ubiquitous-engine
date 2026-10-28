// The giant pocket stopwatch the sea washes ashore before each attack.
import * as THREE from 'three';

function faceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(256, 230, 40, 256, 256, 256);
  grd.addColorStop(0, '#fffaf0');
  grd.addColorStop(1, '#efe4cc');
  g.fillStyle = grd;
  g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3b2a1c';
  g.lineCap = 'round';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    const r0 = big ? 200 : 216, r1 = 232;
    g.lineWidth = big ? 9 : 3;
    g.beginPath();
    g.moveTo(256 + Math.sin(a) * r0, 256 - Math.cos(a) * r0);
    g.lineTo(256 + Math.sin(a) * r1, 256 - Math.cos(a) * r1);
    g.stroke();
  }
  g.fillStyle = '#3b2a1c';
  g.font = '700 46px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const n = i === 0 ? 60 : i * 5;
    g.fillText(String(n), 256 + Math.sin(a) * 160, 256 - Math.cos(a) * 160);
  }
  g.font = 'italic 600 30px Georgia, serif';
  g.fillStyle = '#a0412d';
  g.fillText('Tide & Co.', 256, 330);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Stopwatch {
  constructor(game) {
    this.game = game;
    const g = (this.group = new THREE.Group());
    const brass = new THREE.MeshStandardMaterial({ color: 0xe6c27a, roughness: 0.22, metalness: 1 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.4, metalness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd83a2c, roughness: 0.35, metalness: 0.3 });
    const R = 0.9;
    const caseG = new THREE.CylinderGeometry(R, R, 0.26, 48);
    const body = new THREE.Mesh(caseG, brass);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(R, 0.07, 12, 48), brass);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.y = 0.13;
    const face = new THREE.Mesh(new THREE.CircleGeometry(R * 0.92, 48), new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.5 }));
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.131;
    const glass = new THREE.Mesh(new THREE.SphereGeometry(R * 0.93, 32, 8, 0, Math.PI * 2, 0, 0.35), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.18, depthWrite: false }));
    glass.position.y = -0.18;
    glass.scale.y = 0.5;
    // crown + bow ring at "12"
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.22, 12), brass);
    stem.rotation.x = Math.PI / 2;
    stem.position.set(0, 0, -R - 0.08);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.14, 16), brass);
    crown.rotation.x = Math.PI / 2;
    crown.position.set(0, 0, -R - 0.22);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 10, 24), brass);
    ring.position.set(0, 0, -R - 0.42);
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 10), red);
    button.rotation.x = Math.PI / 2;
    button.rotation.z = -0.6;
    button.position.set(R * 0.55, 0, -R * 0.82);
    this.hand = new THREE.Group();
    const handMesh = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, R * 0.8), red);
    handMesh.position.z = -R * 0.35;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, R * 0.25), red);
    tail.position.z = R * 0.1;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), red);
    this.hand.add(handMesh, tail, hub);
    this.hand.position.y = 0.15;
    this.minute = new THREE.Group();
    const mm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, R * 0.5), steel);
    mm.position.z = -R * 0.22;
    this.minute.add(mm);
    this.minute.position.y = 0.145;
    g.add(body, bezel, face, glass, stem, crown, ring, button, this.hand, this.minute);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.visible = false;
    game.scene.add(g);
    this.item = null;
    this.remaining = 0;
    this.total = 60;
    this.tick = 0;
  }

  // Let the sea deliver it near x.
  arrive(x, total) {
    const game = this.game;
    this.total = total;
    this.remaining = total;
    this.item = game.items.washAshore('stopwatch', x);
    this.item.vel.z = 3.2;
    this.group.visible = true;
    this.scale = 0;
  }

  setRemaining(r) {
    this.remaining = r;
  }

  hide() {
    if (this.item) this.game.items.remove(this.item);
    this.item = null;
    this.group.visible = false;
  }

  update(dt) {
    if (!this.item) return;
    const it = this.item;
    this.scale = Math.min(1, (this.scale || 0) + dt * 2);
    this.group.position.copy(it.pos);
    this.group.position.y += 0.05;
    // lies face-up once on the sand, bobs and tilts in the water
    this.group.rotation.set(it.inWater ? Math.sin(it.age * 1.7) * 0.15 : 0, 0.4, it.inWater ? Math.cos(it.age * 1.3) * 0.15 : 0);
    this.group.scale.setScalar(this.scale * 1.15);
    // seconds hand ticks in discrete jumps, minute hand creeps
    const secs = Math.ceil(this.remaining);
    const prev = this.tickSec;
    this.tickSec = secs;
    this.hand.rotation.y = -((secs % 60) / 60) * Math.PI * 2;
    this.minute.rotation.y = -(this.remaining / (this.total * 1.0)) * Math.PI * 2 * (this.total / 60);
    if (prev !== undefined && secs !== prev && this.remaining > 0) this.game.events.emit('tick', secs);
  }

  get pos() { return this.item ? this.item.pos : null; }
}
