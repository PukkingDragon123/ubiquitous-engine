// Building catalogue. `size` is the footprint radius in world units.
export const BUILDINGS = {
  keep: {
    name: "The King's Castle", short: 'Castle',
    desc: 'Where the Sand King sits on his shell throne. If it falls and the king with it, the kingdom is lost.',
    size: 3.9, cost: {}, hp: 950, work: 30, pop: 4, storage: true, placeable: false, unlocked: true,
    trains: ['worker'], icon: '🏰',
  },
  camp: {
    name: 'Worker Camp', short: 'Camp',
    desc: 'Seaweed tents around a driftwood fire. Houses 4 sandlings, trains workers and stores what they gather.',
    size: 2.9, cost: { shells: 10, driftwood: 3 }, hp: 240, work: 14, pop: 4, storage: true, unlocked: true,
    trains: ['worker'], icon: '⛺',
  },
  house: {
    name: 'Sand Hut', short: 'Hut',
    desc: 'A cosy dome with a conch-shell roof. +4 population.',
    size: 1.55, cost: { shells: 8 }, hp: 170, work: 10, pop: 4, unlocked: true, icon: '🛖',
  },
  wall: {
    name: 'Sand Wall', short: 'Wall',
    desc: 'Drag to raise a crenellated wall. Holds back crabs — and small waves.',
    size: 1.0, cost: { shells: 2 }, hp: 160, work: 4, line: true, unlocked: true, icon: '🧱',
  },
  tower: {
    name: 'Archer Tower', short: 'Tower',
    desc: 'A tall bucket tower with a driftwood lookout. Archers garrisoned on top shoot toothpicks at anything with claws.',
    size: 1.3, cost: { shells: 14, driftwood: 4 }, hp: 280, work: 16, garrison: 3, unlocked: true,
    trains: ['archer'], icon: '🗼',
  },
  barracks: {
    name: 'Barracks', short: 'Barracks',
    desc: 'A sand hall under a plank roof. Trains toothpick knights and spear sandlings.',
    size: 2.6, cost: { shells: 18, pebbles: 6, driftwood: 3 }, hp: 340, work: 20, unlocked: false,
    trains: ['knight', 'spearman'], icon: '⚔️',
  },
  cannon: {
    name: 'Pebble Cannon', short: 'Cannon',
    desc: 'A paper-straw barrel on a driftwood carriage. Fires pebbles that knock crabs flying and dent the beach.',
    size: 1.1, cost: { pebbles: 10, driftwood: 3 }, hp: 200, work: 12, unlocked: false,
    defense: { kind: 'cannon', range: 17, dmg: 22, cooldown: 3.0, splash: 1.4 }, icon: '💣',
  },
  catapult: {
    name: 'Spoon Catapult', short: 'Catapult',
    desc: 'A wooden spoon and a rubber band. Lobs rocks far out into the surf.',
    size: 1.3, cost: { driftwood: 7, shells: 10 }, hp: 170, work: 14, unlocked: false,
    defense: { kind: 'catapult', range: 26, minRange: 5, dmg: 34, cooldown: 5.2, splash: 2.6 }, icon: '🥄',
  },
  shelter: {
    name: 'Rock Shelter', short: 'Shelter',
    desc: 'A cairn of pebbles. Sandlings hide inside when the sea rises instead of turning to mush.',
    size: 1.6, cost: { pebbles: 12 }, hp: 450, work: 12, shelter: 8, unlocked: false, icon: '🪨',
  },
  bridge: {
    name: 'Driftwood Bridge', short: 'Bridge',
    desc: 'Planks across a trench or moat so your sandlings can cross without swimming.',
    size: 2.1, cost: { driftwood: 4 }, hp: 120, work: 6, bridge: true, unlocked: false, icon: '🌉',
  },
  trap: {
    name: 'Toothpick Trap', short: 'Trap',
    desc: 'Sharpened toothpicks hidden in the sand. Crabs hate it.',
    size: 0.9, cost: { driftwood: 2 }, hp: 70, work: 4, trap: { dmg: 14, cooldown: 1.2 }, unlocked: false, icon: '📌',
  },
  bucket: {
    name: 'Bucket Tower', short: 'Bucket tower',
    desc: 'A tower of wet sand stamped with a bucket. Click it again to stack it higher.',
    size: 0.7, cost: {}, hp: 90, work: 1, unlocked: true, placeable: false, icon: '🪣',
  },
  reservoir: {
    name: 'Tide Reservoir', short: 'Reservoir',
    desc: 'A shell-lined basin that fills with sea water. Open the sluice to send a flash flood down your trenches and wash the crabs away.',
    size: 1.7, cost: { shells: 14, pebbles: 6, driftwood: 3 }, hp: 260, work: 12, reservoir: true, unlocked: false, icon: '💧',
  },
  stable: {
    name: 'Seahorse Stable', short: 'Stable',
    desc: 'A stick corral with a shell trough. Trains Shell Riders on sand-sculpted seahorses.',
    size: 2.6, cost: { shells: 24, seaweed: 10, pebbles: 6 }, hp: 320, work: 20, unlocked: false,
    trains: ['cavalry'], icon: '🐴',
  },
  roost: {
    name: 'Dragon Roost', short: 'Roost',
    desc: 'A spiral spire studded with sea glass and a seaweed nest. Hatches tiny sand dragons.',
    size: 1.7, cost: { gems: 8, shells: 30, pebbles: 16 }, hp: 460, work: 28, unlocked: false,
    trains: ['dragon'], icon: '🐉',
  },
};

// Order in the blueprint bottle rack.
export const BLUEPRINT_ORDER = ['camp', 'house', 'wall', 'tower', 'barracks', 'cannon', 'shelter', 'bridge', 'trap', 'reservoir', 'catapult', 'stable', 'roost'];

export const RES_INFO = {
  shells: { label: 'Shells', icon: 'shell' },
  pebbles: { label: 'Pebbles', icon: 'pebble' },
  driftwood: { label: 'Driftwood', icon: 'wood' },
  seaweed: { label: 'Seaweed', icon: 'weed' },
  gems: { label: 'Sea glass', icon: 'gem' },
  treasure: { label: 'Treasure', icon: 'coin' },
};

// Kingdom-wide upgrades bought at the castle.
export const TECHS = {
  sharp: { name: 'Sharper Toothpicks', desc: '+30% melee damage', cost: { shells: 20, pebbles: 8 }, at: 'keep' },
  caps: { name: 'Bottle-cap Armour', desc: 'Soldiers take 20% less damage', cost: { shells: 24, treasure: 4 }, at: 'keep' },
  bows: { name: 'Long Twig Bows', desc: '+25% archer range and damage', cost: { driftwood: 10, shells: 12 }, at: 'keep' },
  mortar: { name: 'Wet-sand Mortar', desc: '+40% building strength, slower wave erosion', cost: { shells: 30, seaweed: 8 }, at: 'keep' },
  boots: { name: 'Flip-flop Training', desc: 'Workers run 25% faster', cost: { seaweed: 10, shells: 10 }, at: 'keep' },
};
