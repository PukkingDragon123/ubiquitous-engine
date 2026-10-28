// Uniform grid for neighbour queries on the XZ plane (rebuilt every frame).
export class SpatialHash {
  constructor(cell = 2) {
    this.cell = cell;
    this.map = new Map();
  }
  clear() { this.map.clear(); }
  _key(cx, cz) { return ((cx + 2048) << 12) | (cz + 2048); }
  insert(obj, x, z) {
    const k = this._key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let l = this.map.get(k);
    if (!l) { l = []; this.map.set(k, l); }
    l.push(obj);
  }
  // Calls fn(obj) for objects in cells overlapping the radius.
  query(x, z, r, fn) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const l = this.map.get(this._key(cx, cz));
        if (!l) continue;
        for (let i = 0; i < l.length; i++) if (fn(l[i]) === false) return;
      }
    }
  }
}
