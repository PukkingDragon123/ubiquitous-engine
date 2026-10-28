// Soldier brains, the king's self-defence, garrisons and defensive buildings.
import * as THREE from 'three';
import { rnd, clamp, smoothstep } from '../core/math.js';

const _v = new THREE.Vector3();
const onShore = (e) => !e.offshore;

export class CombatAI {
  constructor(game) {
    this.game = game;
    this.rally = null; // default gathering point for idle troops
  }

  isSoldier(u) {
    return u.alive && u.type !== 'worker' && u.type !== 'king' && !u.puppet;
  }

  command(units, x, z) {
    const n = units.length;
    const cols = Math.ceil(Math.sqrt(n));
    const sp = 0.85;
    units.forEach((u, i) => {
      if (u === this.game.king) return;
      const r = Math.floor(i / cols), c = i % cols;
      const ox = (c - (cols - 1) / 2) * sp, oz = (r - (Math.ceil(n / cols) - 1) / 2) * sp;
      if (u.garrisoned) this.ungarrison(u);
      u.order = { type: 'attackMove', x: x + ox, z: z + oz };
      u.target = null;
      u.shout = 0.5;
    });
  }

  ungarrison(u) {
    const b = u.garrisoned;
    if (!b) return;
    b.garrison = b.garrison.filter((o) => o !== u);
    u.garrisoned = null;
    u.sit = null;
    const d = b.doorPoint(_v);
    u.pos.set(d.x, this.game.sim.heightAt(d.x, d.z), d.z);
    for (const i of u.p) if (i >= 0) this.game.verlet.teleport(i, d.x, u.pos.y + 0.5, d.z);
  }

  garrison(u, b) {
    const slots = b.model.slots.garrison;
    if (!slots || b.garrison.length >= slots.length) return false;
    const idx = b.garrison.length;
    b.garrison.push(u);
    u.garrisoned = b;
    const sl = slots[idx];
    const p = b.worldPoint(sl.x, sl.z);
    u.sit = null;
    u.perch = { x: p.x, y: b.baseY + sl.y, z: p.z };
    u.pos.set(p.x, b.baseY + sl.y, p.z);
    for (const i of u.p) if (i >= 0) this.game.verlet.teleport(i, p.x, b.baseY + sl.y + 0.4, p.z);
    u.order = null;
    return true;
  }

  _nearestEnemy(x, z, r, filter) {
    let best = null, bd = r;
    for (const e of this.game.enemies) {
      if (!e.alive) continue;
      if (filter && !filter(e)) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z) - e.radius;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  update(dt) {
    const game = this.game;
    for (const u of game.units) {
      if (!u.alive || u.puppet || u.possessed || u.hidden) continue;
      if (u.type === 'king') this._king(u, dt);
      else if (u.type !== 'worker') this._soldier(u, dt);
    }
    for (const b of game.buildings.list) {
      if (!b.alive || b.state !== 'built') continue;
      if (b.def.defense) this._defense(b, dt);
      if (b.def.trap) this._trap(b, dt);
      if (b.def.garrison) this._fillGarrison(b);
    }
  }

  _fillGarrison(b) {
    if (b.garrison.length >= (b.model.slots.garrison || []).length) return;
    // idle archers nearby climb up
    const a = this.game.units.find((u) => u.type === 'archer' && u.alive && !u.garrisoned && !u.order && !u.possessed && u.pos.distanceTo(b.pos) < 14);
    if (a) {
      const d = b.doorPoint(_v);
      if (a.pos.distanceTo(d) < 1.2) this.garrison(a, b);
      else a.moveTo(d.x, d.z, 0.8);
    }
  }

  _king(u, dt) {
    const game = this.game;
    if (game.state !== 'play') return;
    // defend himself when crabs reach him, then sit back down
    const e = this._nearestEnemy(u.pos.x, u.pos.z, 2.2, onShore);
    const throne = game.keep && game.keep.alive ? game.keep.slot('throne') : null;
    if (e) {
      if (u.sit) {
        u.sit = null;
        u.pos.set(u.pos.x, game.sim.heightAt(u.pos.x, u.pos.z), u.pos.z);
        game.events.emit('kingStands', u);
      }
      this._melee(u, e, dt);
    } else if (throne && !u.sit) {
      const d = Math.hypot(throne.x - u.pos.x, throne.z - u.pos.z);
      if (d < 0.6 || !game.keep.registered) { u.sit = throne; u.stop(); }
      else u.moveTo(throne.x, throne.z, 0.4);
    } else if (!throne) {
      u.sit = null;
    }
  }

  _soldier(u, dt) {
    const game = this.game;
    if (!u.isActive) return;
    // garrisoned archers shoot from their perch
    if (u.garrisoned) {
      if (!u.garrisoned.alive) { u.garrisoned = null; u.perch = null; return; }
      const pr = u.perch;
      u.pos.set(pr.x, pr.y, pr.z);
      const range = u.def.range * 1.35 * (game.economy.tech.bows ? 1.25 : 1);
      const e = this._nearestEnemy(u.pos.x, u.pos.z, range);
      if (e) this._shoot(u, e, dt);
      return;
    }
    const range = u.def.ranged ? u.def.range * (game.economy.tech.bows ? 1.25 : 1) : u.def.range;
    const aggro = u.def.ranged ? range + 2 : 7.5;
    // keep the current target if still valid
    if (!u.target || !u.target.alive || Math.hypot(u.target.pos.x - u.pos.x, u.target.pos.z - u.pos.z) > aggro + 3) {
      u.target = this._nearestEnemy(u.pos.x, u.pos.z, aggro, u.def.ranged ? null : onShore);
    }
    const o = u.order;
    if (o && o.type === 'move') {
      if (Math.hypot(o.x - u.pos.x, o.z - u.pos.z) < 0.6) u.order = null; else u.moveTo(o.x, o.z, 0.5);
      return;
    }
    if (u.target) {
      if (u.def.ranged) this._shoot(u, u.target, dt);
      else this._melee(u, u.target, dt);
      return;
    }
    if (o && o.type === 'attackMove') {
      if (Math.hypot(o.x - u.pos.x, o.z - u.pos.z) < 0.6) { u.order = { type: 'hold', x: o.x, z: o.z }; u.stop(); }
      else u.moveTo(o.x, o.z, 0.5);
      return;
    }
    if (o && o.type === 'hold') {
      if (Math.hypot(o.x - u.pos.x, o.z - u.pos.z) > 1.5) u.moveTo(o.x, o.z, 0.5);
      return;
    }
    // no orders: stand guard near the castle facing the sea; drift toward the fight when the sea rises
    const keep = game.keep;
    if (keep && keep.alive) {
      if (!u.guard) {
        const a = rnd(-1.2, 1.2);
        u.guard = { x: keep.pos.x + Math.sin(a) * (keep.radius + 3.5), z: keep.pos.z - Math.cos(a) * (keep.radius + 3.5) };
      }
      const fight = this._nearestEnemy(keep.pos.x, keep.pos.z, 22, u.def.ranged ? null : onShore);
      if (fight) { u.moveTo(fight.pos.x, fight.pos.z, range * 0.8); return; }
      if (Math.hypot(u.guard.x - u.pos.x, u.guard.z - u.pos.z) > 1.2) u.moveTo(u.guard.x, u.guard.z, 0.6);
      else { u.lookAt = _v.set(u.pos.x, 0, u.pos.z - 5).clone(); u.setAnim('idle'); }
    }
  }

  _melee(u, e, dt) {
    const game = this.game;
    const dx = e.pos.x - u.pos.x, dz = e.pos.z - u.pos.z;
    const d = Math.hypot(dx, dz) - e.radius;
    const reach = u.def.range * u.scale;
    if (d > reach) {
      u.moveTo(e.pos.x - (dx / (d + e.radius)) * (e.radius + reach * 0.6), e.pos.z - (dz / (d + e.radius)) * (e.radius + reach * 0.6), 0.25);
      u.lookAt = null;
      return;
    }
    u.stop();
    u.lookAt = e.pos;
    if (u.attackT < 0) {
      if (u.startAttack()) game.events.emit('swing', u);
    } else if (u.attackT > 0.48 && !u.struck) {
      u.struck = true;
      // resolve the hit at the strike frame
      if (d <= reach + 0.45 && e.alive) {
        const n = Math.hypot(dx, dz) || 1;
        let dmg = u.def.dmg * (game.economy.tech.sharp ? 1.3 : 1) * (u.possessed ? 1.6 : 1);
        let knock = u.type === 'knight' ? 6 : u.type === 'cavalry' ? 8 : u.type === 'spearman' ? 5 : 4;
        if (u.type === 'cavalry') dmg *= 1 + clamp((u.speed || 0) / 5, 0, 0.8);
        e.hit(dmg, (dx / n) * knock, knock * 0.5 + 1, (dz / n) * knock, { source: u, pierce: u.type === 'spearman' });
        game.events.emit('meleeHit', u, e);
      }
    }
    if (u.attackT < 0) u.struck = false;
  }

  _shoot(u, e, dt) {
    const game = this.game;
    const dx = e.pos.x - u.pos.x, dz = e.pos.z - u.pos.z;
    const d = Math.hypot(dx, dz);
    const range = u.def.range * (u.garrisoned ? 1.35 : 1) * (game.economy.tech.bows ? 1.25 : 1);
    if (!u.garrisoned) {
      if (d > range) { u.moveTo(e.pos.x, e.pos.z, range * 0.85); u.lookAt = null; return; }
      if (d < 3.2) {
        // kite away from claws
        u.moveTo(u.pos.x - (dx / d) * 2.5, u.pos.z - (dz / d) * 2.5, 0.4);
        return;
      }
      u.stop();
    }
    u.lookAt = e.pos;
    u.goalYaw = Math.atan2(dx, dz);
    if (u.attackT < 0) {
      u.startAttack();
      u.loosed = false;
    } else if (u.attackT > 0.72 && !u.loosed) {
      u.loosed = true;
      const hand = u.joint(4, new THREE.Vector3()) || u.pos.clone().setY(u.pos.y + 0.7);
      game.projectiles.arrow(hand, e, u.def.dmg * (u.possessed ? 1.5 : 1), { color: u.garrisoned ? 0x6bc8ff : 0xff6b6b });
    }
  }

  _defense(b, dt) {
    const game = this.game;
    const d = b.def.defense;
    b.cooldown -= dt;
    const range = d.range * (1 + (b.level - 1) * 0.15);
    const tgt = this._nearestEnemy(b.pos.x, b.pos.z, range, (e) => !d.minRange || Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z) > d.minRange);
    // aim the barrel / arm
    if (tgt) {
      const want = Math.atan2(tgt.pos.x - b.pos.x, tgt.pos.z - b.pos.z);
      let da = want - b.group.rotation.y;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (d.kind === 'cannon') b.group.rotation.y += da * Math.min(1, dt * 4);
      else b.group.rotation.y += da * Math.min(1, dt * 2);
      b.rot = b.group.rotation.y;
    }
    if (d.kind === 'catapult') {
      // spoon arm animation
      b.armT = Math.max(0, (b.armT || 0) - dt * 3);
      b.liftGroup.rotation.x = -b.armT * 1.4;
    }
    if (!tgt || b.cooldown > 0) return;
    b.cooldown = d.cooldown * (1 - (b.level - 1) * 0.12);
    const dmg = d.dmg * (1 + (b.level - 1) * 0.3);
    const lead = tgt.vel ? _v.copy(tgt.pos).addScaledVector(tgt.vel, 0.6) : _v.copy(tgt.pos);
    lead.y = game.sim.heightAt(lead.x, lead.z) + 0.3;
    if (d.kind === 'cannon') {
      const m = b.slot('muzzle');
      const from = new THREE.Vector3(m ? m.x : b.pos.x, m ? m.y : b.baseY + 1.1, m ? m.z : b.pos.z);
      game.projectiles.cannon(from, lead.clone(), dmg, d.splash);
      b.liftGroup.position.z = -0.25;
      setTimeout(() => { if (b.liftGroup) b.liftGroup.position.z = 0; }, 120);
    } else {
      const from = new THREE.Vector3(b.pos.x, b.baseY + 1.6, b.pos.z);
      game.projectiles.rock(from, lead.clone(), dmg, d.splash);
      b.armT = 1;
    }
  }

  _trap(b, dt) {
    b.cooldown -= dt;
    if (b.cooldown > 0) return;
    for (const e of this.game.enemies) {
      if (!e.alive) continue;
      if (Math.hypot(e.pos.x - b.pos.x, e.pos.z - b.pos.z) < b.radius + e.radius * 0.5) {
        e.hit(b.def.trap.dmg * (1 + (b.level - 1) * 0.4), 0, 4, 0, { trap: true, knock: true });
        b.cooldown = b.def.trap.cooldown;
        b.damage(4, 'wear');
        this.game.events.emit('trapSnap', b, e);
        break;
      }
    }
  }
}
