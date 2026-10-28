// Hand-drawn style SVG icons (inline, no external assets).
const S = (body, vb = '0 0 48 48') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
const INK = '#3b2a1c';

export const ICONS = {
  shell: S(`<path d="M24 40 L10 18 Q24 4 38 18 Z" fill="#fbd9c1" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M24 40 L17 14 M24 40 L24 11 M24 40 L31 14 M24 40 L13 21 M24 40 L35 21" stroke="#d9906d" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M19 40 h10 l-2 4 h-6 z" fill="#f2b896" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`),
  pebble: S(`<path d="M9 30 Q8 18 22 15 Q38 12 40 26 Q41 38 26 38 Q11 39 9 30 Z" fill="#a9a29a" stroke="${INK}" stroke-width="2.4"/>
    <path d="M15 24 Q20 19 27 19" stroke="#e6e1da" stroke-width="2.4" fill="none" stroke-linecap="round"/>`),
  wood: S(`<path d="M6 30 Q6 22 13 21 L38 18 Q44 18 44 24 Q44 30 38 30 L13 33 Q6 34 6 30 Z" fill="#c9ad86" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <ellipse cx="39.5" cy="24" rx="4" ry="5.5" fill="#e4cfa9" stroke="${INK}" stroke-width="2"/>
    <path d="M14 26 L30 24 M18 30 L28 29" stroke="#8a6a46" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M20 21 L16 12" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`),
  weed: S(`<path d="M24 42 Q16 30 20 20 Q23 12 18 6" stroke="#4f7a36" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M25 42 Q32 32 28 22 Q26 15 31 8" stroke="#6f9a44" stroke-width="4" fill="none" stroke-linecap="round"/>
    <path d="M24 42 Q22 35 12 30" stroke="#3d6a2c" stroke-width="3.4" fill="none" stroke-linecap="round"/>
    <path d="M24 42 Q28 36 38 33" stroke="#5c8a3a" stroke-width="3.4" fill="none" stroke-linecap="round"/>`),
  gem: S(`<path d="M24 41 L8 20 L15 10 H33 L40 20 Z" fill="#8fe6d0" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="M8 20 H40 M15 10 L20 20 L24 41 L28 20 L33 10" stroke="#3a9a88" stroke-width="1.8" fill="none" stroke-linejoin="round"/>
    <path d="M18 14 L21 18" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`),
  coin: S(`<circle cx="24" cy="24" r="15" fill="#f6c94e" stroke="${INK}" stroke-width="2.4"/>
    <circle cx="24" cy="24" r="10" fill="none" stroke="#c9932a" stroke-width="2"/>
    <path d="M24 17 V31 M20 20 Q24 17 28 20 Q20 24 28 28 Q24 31 20 28" stroke="#9a6a1a" stroke-width="2" fill="none" stroke-linecap="round"/>`),
  pop: S(`<circle cx="24" cy="15" r="7" fill="#e3c28c" stroke="${INK}" stroke-width="2.4"/>
    <path d="M13 41 Q13 25 24 25 Q35 25 35 41 Z" fill="#e3c28c" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="21.5" cy="14" r="1.4" fill="${INK}"/><circle cx="26.5" cy="14" r="1.4" fill="${INK}"/>`),
  crab: S(`<ellipse cx="24" cy="28" rx="13" ry="8" fill="#e2553f" stroke="${INK}" stroke-width="2.4"/>
    <path d="M12 24 Q5 18 8 12 Q12 16 14 14 Q15 19 13 23 M36 24 Q43 18 40 12 Q36 16 34 14 Q33 19 35 23" fill="#e2553f" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M20 21 V16 M28 21 V16" stroke="${INK}" stroke-width="2.2"/><circle cx="20" cy="15" r="2.2" fill="${INK}"/><circle cx="28" cy="15" r="2.2" fill="${INK}"/>
    <path d="M13 31 L7 36 M15 34 L10 40 M35 31 L41 36 M33 34 L38 40" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`),
  wave: S(`<path d="M4 30 Q10 22 16 30 T28 30 T40 30 T52 30" stroke="#2cbccc" stroke-width="3.4" fill="none" stroke-linecap="round"/>
    <path d="M4 38 Q10 30 16 38 T28 38 T40 38" stroke="#0f78a8" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M10 22 Q14 14 22 18" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/>`),
  heart: S(`<path d="M24 40 Q8 28 9 18 Q10 10 17 10 Q22 10 24 16 Q26 10 31 10 Q38 10 39 18 Q40 28 24 40 Z" fill="#ff7a8a" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`),

  // tools
  hand: S(`<path d="M16 42 Q10 34 10 26 L10 19 Q10 16 13 16 Q16 16 16 19 V24 V11 Q16 8 19 8 Q22 8 22 11 V22 V9 Q22 6 25 6 Q28 6 28 9 V22 V12 Q28 9 31 9 Q34 9 34 12 V27 Q37 21 40 22 Q43 23 41 27 L35 38 Q32 43 26 43 Z" fill="#fff4e0" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`),
  shovel: S(`<path d="M30 6 L36 12 M27 9 L33 15" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <path d="M31 11 L17 25" stroke="#3a8fd8" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M18 22 L26 30 L16 40 Q8 44 6 42 Q4 40 8 32 Z" fill="#ff7a3a" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`),
  bucket: S(`<path d="M10 16 H38 L34 42 H14 Z" fill="#e8483c" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M10 16 Q24 2 38 16" stroke="${INK}" stroke-width="2.4" fill="none"/>
    <path d="M9 16 H39" stroke="#ffe066" stroke-width="4" stroke-linecap="round"/>
    <path d="M16 24 H32" stroke="#ff9a8a" stroke-width="2.4" stroke-linecap="round"/>`),
  rake: S(`<path d="M34 6 L18 28" stroke="#5fbf5a" stroke-width="4" stroke-linecap="round"/>
    <path d="M8 26 L24 38" stroke="#5fbf5a" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M10 28 L6 34 M15 31.5 L11 38 M20 35 L16 41.5" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M34 6 L18 28 M8 26 L24 38" stroke="${INK}" stroke-width="1.2" stroke-linecap="round" opacity=".5"/>`),
  bottle: S(`<path d="M20 4 H28 V10 Q36 14 36 24 V40 Q36 44 32 44 H16 Q12 44 12 40 V24 Q12 14 20 10 Z" fill="#bfeee0" fill-opacity=".85" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
    <rect x="19" y="2" width="10" height="6" rx="2" fill="#a9784a" stroke="${INK}" stroke-width="2.2"/>
    <rect x="17" y="22" width="14" height="16" rx="3" fill="#f6e7c4" stroke="${INK}" stroke-width="2" transform="rotate(-8 24 30)"/>
    <path d="M20 27 H28 M20 31 H27 M20 35 H25" stroke="#2b4a7a" stroke-width="1.6" stroke-linecap="round" transform="rotate(-8 24 30)"/>`),
  horn: S(`<path d="M6 20 Q14 22 22 18 L40 8 V40 L22 30 Q14 26 6 28 Z" fill="#f2c14e" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M10 20 V28" stroke="#c8323c" stroke-width="4" stroke-linecap="round"/>
    <path d="M40 8 Q46 24 40 40" stroke="${INK}" stroke-width="2.4" fill="none"/>`),
  pause: S(`<rect x="13" y="10" width="7" height="28" rx="3" fill="${INK}"/><rect x="28" y="10" width="7" height="28" rx="3" fill="${INK}"/>`),
  gear: S(`<circle cx="24" cy="24" r="7" fill="none" stroke="${INK}" stroke-width="3"/>
    <path d="M24 6 V12 M24 36 V42 M6 24 H12 M36 24 H42 M11 11 L15 15 M33 33 L37 37 M11 37 L15 33 M33 15 L37 11" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`),
  help: S(`<circle cx="24" cy="24" r="17" fill="none" stroke="${INK}" stroke-width="3"/>
    <path d="M18 19 Q18 12 24 12 Q30 12 30 18 Q30 22 24 25 V29" stroke="${INK}" stroke-width="3.4" fill="none" stroke-linecap="round"/>
    <circle cx="24" cy="35" r="2.2" fill="${INK}"/>`),
  sound: S(`<path d="M8 19 H16 L26 10 V38 L16 29 H8 Z" fill="${INK}"/>
    <path d="M32 17 Q36 24 32 31 M36 12 Q43 24 36 36" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  star: S(`<path d="M24 5 L29.5 18 L43 19 L32.5 28 L36 42 L24 34.5 L12 42 L15.5 28 L5 19 L18.5 18 Z" fill="#ffd34f" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`),
  lock: S(`<rect x="11" y="21" width="26" height="20" rx="4" fill="#d8c3a0" stroke="${INK}" stroke-width="2.6"/>
    <path d="M17 21 V15 Q17 8 24 8 Q31 8 31 15 V21" stroke="${INK}" stroke-width="2.8" fill="none"/>`),
};

export const RES_ICON = { shells: 'shell', pebbles: 'pebble', driftwood: 'wood', seaweed: 'weed', gems: 'gem', treasure: 'coin' };

export function costHTML(cost, eco) {
  return Object.entries(cost).map(([k, v]) => {
    const short = eco && (eco.res[k] || 0) < v;
    return `<span class="cost${short ? ' short' : ''}"><i>${ICONS[RES_ICON[k]]}</i>${v}</span>`;
  }).join('');
}
