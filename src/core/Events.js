// Minimal event bus.
export class Events {
  constructor() { this.map = new Map(); }
  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, []);
    this.map.get(name).push(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) {
    const l = this.map.get(name);
    if (l) this.map.set(name, l.filter((f) => f !== fn));
  }
  emit(name, ...args) {
    const l = this.map.get(name);
    if (l) for (const f of l.slice()) f(...args);
  }
}
