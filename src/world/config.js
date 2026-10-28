// World layout constants and the base beach profile shared by the simulation
// grid and the static outer terrain.
import { noise } from '../core/noise.js';
import { smoothstep } from '../core/math.js';

export const GRID_W = 256;
export const GRID_H = 192;
export const CELL = 0.4;
export const X0 = -((GRID_W - 1) * CELL) / 2; // world x of node (0, *)
export const Z0 = -((GRID_H - 1) * CELL) / 2; // world z of node (*, 0)
export const X1 = -X0;
export const Z1 = -Z0;
export const SEA_LEVEL = 0;

// Playable bounds (camera target + unit movement)
export const BOUNDS = { minX: X0 + 3, maxX: X1 - 3, minZ: Z0 + 3, maxZ: Z1 - 2 };

// Signed shoreline position along z for a given x. Ocean lies toward -z.
export function shoreZ(x) {
  let z = -12 + 5 * Math.sin(x * 0.035 - 0.4) + 1.6 * Math.sin(x * 0.13 + 2.0);
  // Outside the play grid the coast bends: a rocky headland far left, open bay far right.
  z -= smoothstep(56, 150, -x) * 70;
  z += smoothstep(60, 170, x) * 34;
  return z;
}

// Base (undisturbed) sand height at world (x, z).
export function baseHeight(x, z) {
  const s = z - shoreZ(x) + noise.fbm2(x * 0.02, z * 0.02, 3) * 2.5;
  let h;
  if (s >= 0) {
    // beach face → berm → back beach → dunes
    h = 0.07 * s;
    h += 0.28 * Math.exp(-(((s - 7) / 3.2) ** 2)); // berm crest
    h -= 0.12 * Math.exp(-(((s - 11) / 2.5) ** 2)); // runnel behind berm
    h += smoothstep(24, 46, s) * 2.6; // dunes
    h += smoothstep(30, 60, s) * noise.fbm2(x * 0.045, z * 0.045, 3) * 1.6;
    h += smoothstep(70, 160, s) * 16; // distant hills (outer terrain only)
  } else {
    // shoreface down to a flat seabed with a sandbar
    h = -3.7 * (1 - Math.exp(s / 9));
    h += 0.42 * Math.exp(-(((s + 10.5) / 3.0) ** 2));
    h -= smoothstep(-40, -120, s) * 6; // deep water far out
  }
  // gentle low-frequency undulation everywhere
  h += noise.fbm2(x * 0.06 + 11, z * 0.06 - 4, 3) * 0.22;
  return h;
}

// World <-> grid helpers
export const gx = (x) => (x - X0) / CELL;
export const gz = (z) => (z - Z0) / CELL;
export const wx = (i) => X0 + i * CELL;
export const wz = (j) => Z0 + j * CELL;
export const inGrid = (x, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1;
