// Camera controller: RTS orbit (miniature tilt as you zoom), cinematic paths,
// third-person follow for possession, and inspection orbits around buildings.
import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, smoothstep } from './math.js';
import { BOUNDS } from '../world/config.js';
import { noise } from './noise.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class CameraRig {
  constructor(camera, sim) {
    this.camera = camera;
    this.sim = sim;
    this.mode = 'rts';
    this.target = new THREE.Vector3(0, 1, 6);
    this.goal = this.target.clone();
    this.yaw = 0;
    this.goalYaw = 0;
    this.dist = 46;
    this.goalDist = 46;
    this.pitchOffset = 0;
    this.goalPitchOffset = 0;
    this.minDist = 4.5;
    this.maxDist = 150;
    this.trauma = 0;
    this.shakeTime = 0;
    this.lookPos = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    // cinematic
    this.cine = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 34, blend: 0 };
    // follow (possession)
    this.followTarget = null;
    this.followYaw = 0;
    this.followPitch = 0.25;
    this.followDist = 3.2;
    this._blend = 1; // 0..1 transition blend between previous pose and new mode
    this._fromPos = new THREE.Vector3();
    this._fromLook = new THREE.Vector3();
    this.fov = 34;
    this.focusPoint = new THREE.Vector3();
  }

  get pitch() {
    // closer → flatter, more cinematic; farther → more top-down
    const t = smoothstep(this.minDist, 110, this.dist);
    return clamp(lerp(0.36, 1.08, Math.pow(t, 0.7)) + this.pitchOffset, 0.12, 1.45);
  }

  setMode(mode, opts = {}) {
    this._fromPos.copy(this.camera.position);
    this._fromLook.copy(this.lookPos);
    this._blend = opts.instant ? 1 : 0;
    this._blendSpeed = opts.blendSpeed || 1.6;
    this.mode = mode;
  }

  focusOn(pos, dist, yaw) {
    this.goal.set(pos.x, pos.y, pos.z);
    if (dist !== undefined) this.goalDist = dist;
    if (yaw !== undefined) this.goalYaw = yaw;
  }

  snap() {
    this.target.copy(this.goal);
    this.dist = this.goalDist;
    this.yaw = this.goalYaw;
    this.pitchOffset = this.goalPitchOffset;
    this._blend = 1;
  }

  pan(dx, dz) {
    // pan relative to the view yaw, scaled with zoom
    const s = this.dist * 0.0018;
    const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    this.goal.x += (dx * c + dz * sn) * s;
    this.goal.z += (-dx * sn + dz * c) * s;
    this._clampGoal();
  }

  panWorld(dx, dz) {
    this.goal.x += dx;
    this.goal.z += dz;
    this._clampGoal();
  }

  zoom(f) {
    this.goalDist = clamp(this.goalDist * f, this.minDist, this.maxDist);
  }

  rotate(dYaw, dPitch) {
    this.goalYaw += dYaw;
    this.goalPitchOffset = clamp(this.goalPitchOffset + dPitch, -0.3, 0.5);
  }

  addShake(a) {
    this.trauma = Math.min(1, this.trauma + a);
  }

  _clampGoal() {
    this.goal.x = clamp(this.goal.x, BOUNDS.minX, BOUNDS.maxX);
    this.goal.z = clamp(this.goal.z, BOUNDS.minZ - 8, BOUNDS.maxZ);
  }

  update(dt, keys) {
    const cam = this.camera;
    if (this.mode === 'rts' || this.mode === 'inspect') {
      if (keys && this.mode === 'rts') {
        const sp = 900 * dt;
        let px = 0, pz = 0;
        if (keys.KeyW || keys.ArrowUp) pz -= sp;
        if (keys.KeyS || keys.ArrowDown) pz += sp;
        if (keys.KeyA || keys.ArrowLeft) px -= sp;
        if (keys.KeyD || keys.ArrowRight) px += sp;
        if (px || pz) this.pan(px, pz);
        if (keys.KeyQ) this.goalYaw += dt * 1.5;
        if (keys.KeyE) this.goalYaw -= dt * 1.5;
        if (keys.KeyR) this.zoom(1 - dt * 1.2);
        if (keys.KeyF) this.zoom(1 + dt * 1.2);
      }
      const k = this.mode === 'inspect' ? 3.2 : 7;
      this.target.x = damp(this.target.x, this.goal.x, k, dt);
      this.target.z = damp(this.target.z, this.goal.z, k, dt);
      const groundY = Math.max(this.sim.heightAt(this.target.x, this.target.z), this.sim.seaLevel);
      this.goal.y = this.mode === 'inspect' ? this.goal.y : groundY + 0.4;
      this.target.y = damp(this.target.y, this.goal.y, 4, dt);
      this.dist = damp(this.dist, this.goalDist, this.mode === 'inspect' ? 3 : 6, dt);
      this.yaw = dampAngle(this.yaw, this.goalYaw, 6, dt);
      this.pitchOffset = damp(this.pitchOffset, this.goalPitchOffset, 6, dt);
      const p = this.pitch;
      _v.set(Math.sin(this.yaw) * Math.cos(p), Math.sin(p), Math.cos(this.yaw) * Math.cos(p)).multiplyScalar(this.dist);
      this.camPos.copy(this.target).add(_v);
      this.lookPos.copy(this.target);
      this.fov = damp(this.fov, 34, 3, dt);
    } else if (this.mode === 'cinematic') {
      this.camPos.copy(this.cine.pos);
      this.lookPos.copy(this.cine.look);
      this.fov = this.cine.fov;
    } else if (this.mode === 'follow' && this.followTarget) {
      const f = this.followTarget;
      const head = f.cameraAnchor ? f.cameraAnchor(_v2) : _v2.copy(f.pos);
      const p = this.followPitch;
      _v.set(Math.sin(this.followYaw) * Math.cos(p), Math.sin(p), Math.cos(this.followYaw) * Math.cos(p));
      this.camPos.copy(head).addScaledVector(_v, this.followDist);
      this.camPos.x += Math.cos(this.followYaw) * 0.45;
      this.camPos.z -= Math.sin(this.followYaw) * 0.45;
      this.lookPos.copy(head).addScaledVector(_v, -3).setY(head.y + 0.2 - p * 1.5);
      this.fov = damp(this.fov, 50, 4, dt);
    }

    // keep the camera above sand and water
    const minY = Math.max(this.sim.heightAt(this.camPos.x, this.camPos.z), this.sim.seaLevel + 0.15) + (this.mode === 'follow' ? 0.35 : 0.8);
    if (this.camPos.y < minY) this.camPos.y = minY;

    // blend between modes
    if (this._blend < 1) {
      this._blend = Math.min(1, this._blend + dt * this._blendSpeed);
      const b = this._blend * this._blend * (3 - 2 * this._blend);
      cam.position.lerpVectors(this._fromPos, this.camPos, b);
      _v.lerpVectors(this._fromLook, this.lookPos, b);
      cam.lookAt(_v);
      this.focusPoint.copy(_v);
    } else {
      cam.position.copy(this.camPos);
      cam.lookAt(this.lookPos);
      this.focusPoint.copy(this.lookPos);
    }

    // trauma shake
    this.shakeTime += dt;
    if (this.trauma > 0.001) {
      const s = this.trauma * this.trauma;
      const t = this.shakeTime * 22;
      cam.rotation.x += noise.noise2(t, 1.3) * 0.02 * s;
      cam.rotation.y += noise.noise2(t, 7.1) * 0.02 * s;
      cam.rotation.z += noise.noise2(t, 13.7) * 0.03 * s;
      this.trauma = Math.max(0, this.trauma - dt * 1.4);
    }
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
