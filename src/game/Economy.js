// Stockpile of resources, population and kingdom upgrades.
export class Economy {
  constructor(game) {
    this.game = game;
    this.res = { shells: 0, pebbles: 0, driftwood: 0, seaweed: 0, gems: 0, treasure: 0 };
    this.tech = {};
    this.unlocked = new Set(['camp', 'house', 'wall', 'tower']);
    this.totalGathered = 0;
  }

  canAfford(cost, mult = 1) {
    for (const k in cost) if ((this.res[k] || 0) < Math.ceil(cost[k] * mult)) return false;
    return true;
  }

  missing(cost, mult = 1) {
    const out = {};
    for (const k in cost) {
      const need = Math.ceil(cost[k] * mult) - (this.res[k] || 0);
      if (need > 0) out[k] = need;
    }
    return out;
  }

  spend(cost, mult = 1) {
    if (!this.canAfford(cost, mult)) return false;
    for (const k in cost) this.res[k] -= Math.ceil(cost[k] * mult);
    this.game.events.emit('resources', this.res);
    return true;
  }

  refund(cost, frac = 1) {
    for (const k in cost) this.res[k] += Math.floor(cost[k] * frac);
    this.game.events.emit('resources', this.res);
  }

  add(k, n, at) {
    this.res[k] = (this.res[k] || 0) + n;
    this.totalGathered += n;
    this.game.events.emit('resources', this.res, k, n, at);
  }

  get popCap() {
    let cap = 0;
    for (const b of this.game.buildings.list) if (b.state === 'built' && b.def.pop) cap += b.def.pop + (b.level - 1) * 2;
    return cap;
  }

  get pop() {
    let n = 0;
    for (const u of this.game.units) if (u.alive && u.type !== 'king' && !u.puppet) n += u.def.pop || 1;
    for (const b of this.game.buildings.list) for (const q of b.queue) n += 1;
    return n;
  }
}
