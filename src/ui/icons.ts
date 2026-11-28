import type { AlienKey, BuildingKey, CityKind, Terrain, UnitKey } from '../game/types';
import { h } from './dom';

export type IconName = 'ore' | 'oil' | 'meat' | 'power' | 'hp' | 'atk' | 'def';

const PATHS: Record<IconName, string> = {
  ore: '<path d="M12 3 3 9l9 12 9-12-9-6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M3 9h18M12 3l-3 6 3 12 3-12-3-6z" fill="none" stroke="currentColor" stroke-width="1.2"/>',
  oil: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" fill="currentColor"/>',
  meat: '<path d="M15 3a6 6 0 0 1 0 12c-.9 0-1.8-.2-2.5-.6l-3.4 3.4a2.2 2.2 0 1 1-2.9-2.9l3.4-3.4A6 6 0 0 1 15 3z" fill="currentColor"/>',
  power: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor"/>',
  hp: '<path d="M12 21s-7-4.6-9.3-9A5.4 5.4 0 0 1 12 6.3 5.4 5.4 0 0 1 21.3 12C19 16.4 12 21 12 21z" fill="currentColor"/>',
  atk: '<path d="M14.5 3H21v6.5l-9.5 9.5-2-2L19 7.5V5h-2.5L7 14.5l-2-2L14.5 3zM4 15l5 5-2 2-1.5-1.5L4 22l-2-2 1.5-1.5L2 17l2-2z" fill="currentColor"/>',
  def: '<path d="M12 2 4 5v6c0 5.2 3.4 9.4 8 11 4.6-1.6 8-5.8 8-11V5l-8-3z" fill="currentColor"/>',
};

/** Inline SVG icon, drawn in `currentColor`. */
export function icon(name: IconName): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;
}

// ---------------------------------------------------------------------------
// Pictures of the units and buildings, drawn by hand for the menus.
// ---------------------------------------------------------------------------

const STEEL = '#9aa7b8';
const STEEL_D = '#5b6678';
const GUN = '#2b3240';
const OLIVE = '#8fae52';
const OLIVE_D = '#5f7436';
const OLIVE_DD = '#44552a';
const AMBER = '#f5b83d';
const CYAN = '#7dd3fc';
const SKIN = '#e9c39b';
const RED = '#ef4444';
const GLASS = '#dbe3ec';
const DOOR = '#151a22';

const svg = (art: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${art}</svg>`;

/** A cog with `teeth` teeth, as a filled path. */
function gear(cx: number, cy: number, r: number, teeth = 8): string {
  const pts: string[] = [];
  for (let i = 0; i < teeth * 4; i++) {
    // Teeth and the gaps between them each hold their radius for a short arc.
    const rr = i % 4 < 2 ? r : r * 0.74;
    const a = (i / (teeth * 4)) * Math.PI * 2;
    pts.push(`${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

const wheels = `<circle cx="5.6" cy="16.8" r="2.6" fill="${GUN}"/><circle cx="5.6" cy="16.8" r="1" fill="${STEEL}"/><circle cx="17.6" cy="16.8" r="2.6" fill="${GUN}"/><circle cx="17.6" cy="16.8" r="1" fill="${STEEL}"/>`;

const legs = `<rect x="7.8" y="18.4" width="2.4" height="4.4" rx="0.5" fill="${OLIVE_DD}"/><rect x="12.8" y="18.4" width="2.4" height="4.4" rx="0.5" fill="${OLIVE_DD}"/>`;

/** A tank's tracks and hull, pointing right. */
const hull = `<rect x="1.5" y="15.5" width="21" height="5.5" rx="2.75" fill="${GUN}"/><path d="M4.2 18.2h15.6" stroke="#4a5262" stroke-width="1"/><path d="M2.5 11.5h19l1.5 4h-22z" fill="${STEEL}"/>`;

/** The box-shaped turret that sits on it. */
const turret = `<path d="M7.5 7.5h8l2.2 4H6.4z" fill="${STEEL_D}"/>`;

const UNIT_ART: Record<UnitKey, string> = {
  truck: `<rect x="1.5" y="7.5" width="11.5" height="8.5" rx="1.2" fill="${STEEL}"/><rect x="3" y="9" width="8.5" height="5.5" rx="0.8" fill="${GLASS}"/><path d="M13 9.5h4.6l4.2 3.8v3.7H13z" fill="${STEEL_D}"/><path d="M14.3 10.8h2.9l2.4 2.2h-5.3z" fill="${CYAN}"/>${wheels}`,
  infantry: `<circle cx="10.5" cy="6.4" r="3" fill="${SKIN}"/><path d="M6.3 6.6a4.2 4.2 0 0 1 8.4 0v.9H6.3z" fill="${OLIVE_D}"/><path d="M7 10.4h7l1.3 8H5.7z" fill="${OLIVE}"/><rect x="6.2" y="14.8" width="8.6" height="1.8" rx="0.9" fill="${OLIVE_D}"/><rect x="8" y="12.2" width="12.2" height="1.7" rx="0.85" fill="${GUN}"/><rect x="18" y="11" width="3.2" height="4" rx="0.7" fill="${STEEL_D}"/>${legs}`,
  sniper: `<circle cx="8.6" cy="6.6" r="2.9" fill="${SKIN}"/><path d="M4.8 6.9a3.9 3.9 0 0 1 7.7-.7l-.5 1.5H5.1z" fill="${OLIVE_DD}"/><path d="M5.4 10.2h6.2l1.3 8H4.4z" fill="${OLIVE}"/><rect x="2.6" y="13.4" width="18.6" height="1.5" rx="0.75" fill="${GUN}"/><rect x="9.6" y="11.5" width="4.6" height="1.7" rx="0.85" fill="${AMBER}"/><rect x="6.2" y="18.2" width="2.4" height="4.6" rx="0.5" fill="${OLIVE_DD}"/><rect x="10.2" y="18.2" width="2.4" height="4.6" rx="0.5" fill="${OLIVE_DD}"/><circle cx="19" cy="5.2" r="3.1" fill="none" stroke="${AMBER}" stroke-width="1.3"/><path d="M19 1.2v2.2M19 7v2.2M15 5.2h2.2M20.8 5.2H23" stroke="${AMBER}" stroke-width="1.3" stroke-linecap="round"/>`,
  atSoldier: `<circle cx="10" cy="7.6" r="2.9" fill="${SKIN}"/><path d="M6.2 7.8a3.9 3.9 0 0 1 7.8 0v.9H6.2z" fill="#7a5230"/><path d="M6.6 11.4h6.8l1.3 7H5.5z" fill="${OLIVE}"/><g transform="rotate(-30 11 9)"><rect x="3.2" y="7.6" width="15.6" height="3" rx="1.5" fill="${GUN}"/><rect x="17.4" y="7.1" width="3.4" height="4" rx="0.9" fill="${RED}"/></g><rect x="7.6" y="18.4" width="2.4" height="4.4" rx="0.5" fill="${OLIVE_DD}"/><rect x="12.4" y="18.4" width="2.4" height="4.4" rx="0.5" fill="${OLIVE_DD}"/>`,
  tank: `${hull}${turret}<rect x="14.2" y="8.6" width="9.3" height="2.2" rx="1.1" fill="${GUN}"/>`,
  twinTank: `${hull}${turret}<rect x="14.2" y="7.5" width="9.3" height="1.7" rx="0.85" fill="${GUN}"/><rect x="14.2" y="10.2" width="9.3" height="1.7" rx="0.85" fill="${GUN}"/>`,
  aaTank: `${hull}<path d="M7 8h6l2 3.5H6z" fill="${STEEL_D}"/><path d="M10.6 9.6 15.6 2.6l1.7 1.2-4.6 6.6z" fill="${GUN}"/><path d="M13 10.6 19.6 4.4l1.4 1.5-6 6z" fill="${GUN}"/><path d="M5.6 9.4a2.8 2.8 0 0 1 2.8-2.8v2.8z" fill="${CYAN}"/>`,
  missileTank: `${hull}<rect x="6.2" y="9" width="8.4" height="3.4" rx="1" fill="${STEEL_D}"/><rect x="7.4" y="4.6" width="11.4" height="2" rx="1" fill="${GLASS}"/><rect x="7.4" y="7.2" width="11.4" height="2" rx="1" fill="${GLASS}"/><path d="M18.6 4.6h1.2l2.6 1-2.6 1h-1.2z" fill="${RED}"/><path d="M18.6 7.2h1.2l2.6 1-2.6 1h-1.2z" fill="${RED}"/>`,
  laserTank: `${hull}<path d="M6.6 11.5a5.2 5.2 0 0 1 10.4 0z" fill="${STEEL_D}"/><circle cx="15.2" cy="8.2" r="2.3" fill="${GUN}"/><circle cx="15.2" cy="8.2" r="1.1" fill="${CYAN}"/><rect x="17.2" y="7.4" width="6.2" height="1.6" rx="0.8" fill="${CYAN}" opacity="0.9"/>`,
  apocalypse: `<rect x="0.8" y="15.5" width="22.4" height="5.5" rx="2.75" fill="${GUN}"/><path d="M1.2 10.6h21.6l1.4 4.9H-0.2z" fill="${STEEL}"/><rect x="2.4" y="12.4" width="19.2" height="1.2" fill="${AMBER}" opacity="0.85"/><path d="M4.2 6.6h5.4l1.9 4H2.9z" fill="${STEEL_D}"/><rect x="9.8" y="7.7" width="6.2" height="1.8" rx="0.9" fill="${GUN}"/><path d="M11 4.4h6l2.2 4.4H9.7z" fill="${STEEL_D}"/><rect x="17.4" y="5.6" width="6.2" height="1.9" rx="0.95" fill="${GUN}"/>`,
  specOps: `<circle cx="10.5" cy="6.6" r="3.2" fill="${GUN}"/><path d="M7 6.4a3.6 3.6 0 0 1 7 0v.6H7z" fill="${STEEL_D}"/><rect x="8.2" y="6.2" width="4.8" height="1.5" rx="0.7" fill="${CYAN}"/><path d="M6.8 10.2h7.4l1.6 8.2H5.4z" fill="${OLIVE_DD}"/><rect x="6" y="14.8" width="9" height="1.8" rx="0.9" fill="${OLIVE_D}"/><rect x="7.6" y="12" width="13.4" height="2" rx="1" fill="${GUN}"/><rect x="10.4" y="14" width="2.6" height="2.4" rx="0.5" fill="${STEEL_D}"/><rect x="19.6" y="11.2" width="3" height="3.6" rx="0.7" fill="${STEEL_D}"/><rect x="7.8" y="18.4" width="2.4" height="4.4" rx="0.5" fill="${OLIVE_DD}"/><rect x="12.8" y="18.4" width="2.4" height="4.4" rx="0.5" fill="${OLIVE_DD}"/>`,
  mech: `<rect x="9.2" y="2.2" width="5.6" height="4" rx="0.8" fill="${STEEL_D}"/><rect x="10.2" y="3.4" width="3.6" height="1.3" rx="0.6" fill="${RED}"/><path d="M7.6 7h8.8l1.2 7.4H6.4z" fill="${STEEL}"/><rect x="9.4" y="8.6" width="5.2" height="1.6" rx="0.6" fill="${CYAN}"/><rect x="4.2" y="7.4" width="3" height="4.4" rx="0.6" fill="${STEEL_D}"/><rect x="16.8" y="7.4" width="3" height="4.4" rx="0.6" fill="${STEEL_D}"/><rect x="0.8" y="8.6" width="4" height="1.8" rx="0.8" fill="${GUN}"/><rect x="19.2" y="8.6" width="4" height="1.8" rx="0.8" fill="${GUN}"/><rect x="7.6" y="14.6" width="3.6" height="6.8" rx="0.8" fill="${STEEL_D}"/><rect x="12.8" y="14.6" width="3.6" height="6.8" rx="0.8" fill="${STEEL_D}"/><rect x="6.8" y="20.2" width="5" height="1.8" rx="0.6" fill="${GUN}"/><rect x="12.2" y="20.2" width="5" height="1.8" rx="0.6" fill="${GUN}"/>`,
  fighter: `<path d="M12 1.4c.9 0 1.6 2.7 1.7 6.8l8.4 5v2.4l-8.3-2.2-.4 4.4 2.6 2.3v1.7L12 20.4l-4 1.4v-1.7l2.6-2.3-.4-4.4L1.9 15.6v-2.4l8.4-5c.1-4.1.8-6.8 1.7-6.8z" fill="${STEEL}"/><path d="M12 3.4c.5 0 .9 1.8 1 4.4h-2c.1-2.6.5-4.4 1-4.4z" fill="${CYAN}"/>`,
  bomber: `<path d="M12 1.2c1 0 1.8 3.4 1.9 8.6l8.6 4.6v2.6l-8.5-2-.3 3.6 2.4 2.4v1.8L12 21.8l-4.1 1v-1.8l2.4-2.4-.3-3.6-8.5 2v-2.6l8.6-4.6c.1-5.2.9-8.6 1.9-8.6z" fill="${STEEL}"/><rect x="3.6" y="12.6" width="4.4" height="2.6" rx="1" fill="${STEEL_D}"/><rect x="16" y="12.6" width="4.4" height="2.6" rx="1" fill="${STEEL_D}"/><path d="M12 2.4c.5 0 .9 1.6 1.1 4h-2.2c.2-2.4.6-4 1.1-4z" fill="${CYAN}"/>`,
};

// The houses and towers of the larger maps.

const WALL = '#d9c7a3';
const ROOF = '#a14d3a';
const CONCRETE = '#b9bec8';

const CITY_ART: Record<CityKind, string> = {
  house: `<rect x="1.5" y="19.4" width="21" height="2.2" rx="0.6" fill="#9c9484"/><rect x="4" y="12" width="16" height="7.6" rx="0.6" fill="${WALL}"/><path d="M2.5 13 12 5.4 21.5 13v1.7h-19z" fill="${ROOF}"/><rect x="10.2" y="14.6" width="3.6" height="5" rx="0.5" fill="${DOOR}"/><rect x="5.4" y="14.2" width="3" height="2.6" rx="0.4" fill="${GLASS}"/><rect x="15.6" y="14.2" width="3" height="2.6" rx="0.4" fill="${GLASS}"/><rect x="15.2" y="6" width="2" height="3.6" rx="0.4" fill="#8a6552"/>`,
  tower: `<rect x="1.5" y="20" width="21" height="1.8" rx="0.5" fill="#8b8f98"/><rect x="6.5" y="4.4" width="11" height="15.8" rx="0.6" fill="${CONCRETE}"/><rect x="11.1" y="2" width="1.8" height="2.4" rx="0.3" fill="#9aa0aa"/>${[6.2, 9.4, 12.6, 15.8].map((y) => `<rect x="7.8" y="${y}" width="8.4" height="1.7" rx="0.3" fill="${GLASS}"/>`).join('')}<rect x="10.6" y="17.6" width="2.8" height="2.6" rx="0.3" fill="${DOOR}"/>`,
};

/** A house or tower of the larger maps. */
export function cityIcon(kind: CityKind): string {
  return svg(CITY_ART[kind]);
}

const gunBase = `<rect x="2.5" y="16.5" width="19" height="5" rx="2.5" fill="${GUN}"/>`;

/** One small star, centred on (12, `cy`). */
const star = (cy: number, r = 1): string =>
  `<path d="M12 7.6l1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z" fill="${AMBER}" transform="translate(12 ${cy}) scale(${r}) translate(-12 -11.6)"/>`;

/**
 * The force-field shield. Every rung of the net past the first marks it
 * further: a bright rim, then a gilt edge, then one star and then two.
 */
function shield(level: number): string {
  const outline = 'M12 1.6 3.2 5.2v6.3c0 5.4 3.8 9.4 8.8 11.3 5-1.9 8.8-5.9 8.8-11.3V5.2z';
  const grid = `<path d="M12 1.6v21.2M4.8 8.4h14.4M5.4 13.6h13.2M8.2 4.9v15M15.8 4.9v15" stroke="#bfdbfe" stroke-width="0.9" opacity="0.75" fill="none"/>`;
  const rim = level >= 2 ? `<path d="${outline}" fill="none" stroke="#93c5fd" stroke-width="1.3"/>` : '';
  const gilt = level >= 3 ? `<path d="${outline}" fill="none" stroke="${AMBER}" stroke-width="1.7"/>` : '';
  const marks = level >= 5 ? star(8.9, 0.62) + star(14.4, 0.62) : level >= 4 ? star(11.6) : '';
  return `<path d="${outline}" fill="#2563eb" opacity="0.92"/>${grid}${marks}${rim}${gilt}`;
}

const BUILDING_ART: Record<Exclude<BuildingKey, 'defenseNet'>, (level: number) => string> = {
  hq: () => `<rect x="1.5" y="12.5" width="21" height="9" rx="1.4" fill="${STEEL_D}"/><path d="M5.5 12.5a6.5 6.5 0 0 1 13 0z" fill="${STEEL}"/><path d="M12 7.6l.9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="${AMBER}"/><rect x="10" y="15.2" width="4" height="6.3" rx="0.7" fill="${DOOR}"/><rect x="11.6" y="1.6" width="0.9" height="6.4" fill="${GLASS}"/><path d="M12.5 1.9h6v3.6h-6z" fill="${AMBER}"/><rect x="3" y="14.4" width="3.2" height="2.2" rx="0.4" fill="${CYAN}"/><rect x="17.8" y="14.4" width="3.2" height="2.2" rx="0.4" fill="${CYAN}"/>`,
  powerPlant: () => `<rect x="1.5" y="10.5" width="11.5" height="11" rx="1.4" fill="${STEEL_D}"/><path d="M13.6 21.5c-1.3-4.2-1.3-9.3.2-13.6h5.5c1.5 4.3 1.5 9.4.2 13.6z" fill="${STEEL}"/><ellipse cx="16.6" cy="7.9" rx="2.9" ry="0.9" fill="${GLASS}"/><path d="M8.8 11.6 4.8 17.4h2.8l-1.3 4.8 4.3-5.9H7.9z" fill="${AMBER}"/><rect x="2.8" y="12.6" width="3" height="2.4" rx="0.4" fill="${CYAN}"/>`,
  factory: () => `<path d="M1.5 21.5V10l6 3.6V10l6 3.6V6.5h9v15z" fill="${STEEL_D}"/><path d="M13.5 6.5h9v3h-9z" fill="${STEEL}"/><rect x="2.8" y="15.8" width="3.6" height="5.7" rx="0.5" fill="${DOOR}"/><rect x="8.4" y="15.8" width="3.2" height="2.8" rx="0.4" fill="${CYAN}"/><rect x="14.6" y="12.2" width="2.6" height="2.6" rx="0.4" fill="${CYAN}"/><rect x="18.4" y="12.2" width="2.6" height="2.6" rx="0.4" fill="${CYAN}"/>`,
  barracks: () => `<path d="M1.5 20.8V11L12 5.6 22.5 11v9.8z" fill="${OLIVE}"/><path d="M12 5.6 22.5 11v1.9L12 7.7 1.5 12.9V11z" fill="${OLIVE_D}"/><rect x="9.9" y="13.8" width="4.2" height="7" rx="0.5" fill="#2f3a1c"/><rect x="4" y="15" width="3.2" height="3" rx="0.4" fill="${CYAN}"/><rect x="16.8" y="15" width="3.2" height="3" rx="0.4" fill="${CYAN}"/><rect x="12" y="1" width="0.8" height="5" fill="${GLASS}"/><path d="M12.8 1.2h5.2v3h-5.2z" fill="${AMBER}"/>`,
  warFactory: () => `<path d="M1.5 21.5V8.5h8.2l2-3.6H22.5v16.6z" fill="${STEEL_D}"/><rect x="3.4" y="13.6" width="17.2" height="7.9" rx="0.6" fill="${DOOR}"/><path d="M3.4 15.8h17.2M3.4 17.9h17.2" stroke="#3a4354" stroke-width="0.9"/><path d="${gear(17.2, 8.4, 3.5)}" fill="${AMBER}"/><circle cx="17.2" cy="8.4" r="1.5" fill="${STEEL_D}"/>`,
  airport: () => `<rect x="1" y="16" width="22" height="6" rx="1.3" fill="${GUN}"/><path d="M3 19h3.2M9.4 19h3.2M15.8 19h3.2M22 19h1" stroke="#e5e7eb" stroke-width="1.3" stroke-linecap="round"/><rect x="9.6" y="7.2" width="5.4" height="8.8" fill="${STEEL_D}"/><rect x="7.4" y="3.4" width="9.8" height="4.6" rx="1.3" fill="${STEEL}"/><rect x="8.6" y="4.5" width="7.4" height="2.1" rx="0.7" fill="${CYAN}"/>`,
  turret: (level) =>
    level === 2
      ? `${gunBase}<path d="M5.5 16.5a6.5 6.5 0 0 1 13 0z" fill="${STEEL}"/><path d="M6.29 13.4h11.42l.6 1.6H5.69z" fill="${AMBER}"/><rect x="12.2" y="7.6" width="10.8" height="1.8" rx="0.9" fill="${GUN}"/><rect x="12.2" y="10.4" width="10.8" height="1.8" rx="0.9" fill="${GUN}"/>`
      : `${gunBase}<path d="M5.5 16.5a6.5 6.5 0 0 1 13 0z" fill="${STEEL}"/><rect x="12.2" y="8.7" width="10.8" height="2.3" rx="1.15" fill="${GUN}"/><rect x="10.6" y="12.4" width="3" height="3" rx="0.5" fill="${CYAN}"/>`,
  aaGun: (level) =>
    level === 2
      ? `<rect x="3.6" y="18" width="16.8" height="4" rx="2" fill="${GUN}"/><rect x="9.4" y="13" width="5.2" height="5.4" fill="${STEEL_D}"/><g transform="rotate(-32 12 9.5)"><rect x="5.4" y="4.6" width="13.2" height="9.4" rx="1.4" fill="#56604c"/><circle cx="9" cy="7.3" r="1.5" fill="${DOOR}"/><circle cx="15" cy="7.3" r="1.5" fill="${DOOR}"/><circle cx="9" cy="11.4" r="1.5" fill="${DOOR}"/><circle cx="15" cy="11.4" r="1.5" fill="${DOOR}"/><circle cx="9" cy="7.3" r="0.6" fill="${RED}"/><circle cx="15" cy="7.3" r="0.6" fill="${RED}"/></g>`
      : `<rect x="3.6" y="18" width="16.8" height="4" rx="2" fill="${GUN}"/><rect x="9" y="12.4" width="6" height="6.2" rx="1.2" fill="${STEEL_D}"/><rect x="7.2" y="3" width="2.4" height="11" rx="1.2" fill="${GUN}"/><rect x="14.4" y="3" width="2.4" height="11" rx="1.2" fill="${GUN}"/><rect x="6.4" y="2.2" width="4" height="1.8" rx="0.6" fill="${STEEL}"/><rect x="13.6" y="2.2" width="4" height="1.8" rx="0.6" fill="${STEEL}"/>`,
};

// Pictures of the aliens, for their cards and the rulebook.

/** Four legs down one side; the others are the same four mirrored. */
const LEGS = ['M9.8 7.4 6.4 4.6 3 7.2', 'M9.4 9 4.8 7.8 2.2 11.4', 'M9.4 10.6 5 11.4 3 15.6', 'M9.8 12.2 6.6 15.4 5.8 20'];
const spiderLegs = (color: string, w: number): string =>
  LEGS.map(
    (d) =>
      `<path d="${d}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
      `<path d="${d}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none" transform="translate(24 0) scale(-1 1)"/>`,
  ).join('');

const SPIDER_BODY = `<circle cx="12" cy="7" r="2.7" fill="#3b2150"/><circle cx="10.9" cy="6.3" r=".65" fill="#ff2d55"/><circle cx="13.1" cy="6.3" r=".65" fill="#ff2d55"/><circle cx="11.4" cy="7.5" r=".5" fill="#ff2d55"/><circle cx="12.6" cy="7.5" r=".5" fill="#ff2d55"/>`;

const HAIR = '#2b2340';

const ALIEN_ART: Record<AlienKey, string> = {
  chloe: `<path d="M12 1.8c5.2 0 8.8 3.7 8.8 8.5 0 5.6-4.4 10-8.8 12.1C7.6 20.3 3.2 15.9 3.2 10.3c0-4.8 3.6-8.5 8.8-8.5z" fill="#7c3aed"/><ellipse cx="8.4" cy="10.6" rx="2.2" ry="1.2" fill="#4ade80" transform="rotate(-20 8.4 10.6)"/><ellipse cx="15.6" cy="10.6" rx="2.2" ry="1.2" fill="#4ade80" transform="rotate(20 15.6 10.6)"/>`,
  kuide: `<ellipse cx="12" cy="14" rx="4.8" ry="5.4" fill="#241631"/>${spiderLegs('#241631', 1.7)}<ellipse cx="12" cy="13" rx="2" ry="2.6" fill="#e879f9"/>${SPIDER_BODY}<path d="M11.1 9.4l-.4 1.3M12.9 9.4l.4 1.3" stroke="#eadfc8" stroke-width=".9" stroke-linecap="round"/>`,
  meiling: `<path d="M5.8 9.6c-1.9 2.4-2.6 5.8-2 9.6.15.9 1.5 1.05 1.85.15l.6-1.5c1.1-2.5 1.2-5.3.1-7.7z" fill="${HAIR}"/><path d="M18.2 9.6c1.9 2.4 2.6 5.8 2 9.6-.15.9-1.5 1.05-1.85.15l-.6-1.5c-1.1-2.5-1.2-5.3-.1-7.7z" fill="${HAIR}"/><path d="M7.2 9.4a4.8 4.8 0 0 1 9.6 0v3H7.2z" fill="${HAIR}"/><circle cx="12" cy="10.2" r="4.1" fill="#ffe3cf"/><path d="M7.9 9.8c.3-2.9 2-4.5 4.1-4.5s3.8 1.6 4.1 4.5c-1.3-1-2.7-1.5-4.1-1.5s-2.8.5-4.1 1.5z" fill="${HAIR}"/><circle cx="10.5" cy="10.6" r=".7" fill="#1f2430"/><circle cx="13.5" cy="10.6" r=".7" fill="#1f2430"/><circle cx="9.2" cy="12.2" r=".9" fill="#fb7185" opacity=".6"/><circle cx="14.8" cy="12.2" r=".9" fill="#fb7185" opacity=".6"/><circle cx="6" cy="9.3" r="1.1" fill="#fde047"/><circle cx="18" cy="9.3" r="1.1" fill="#fde047"/><path d="M8.6 15h6.8l2.2 6.2H6.4z" fill="#e11d48"/><path d="M18.4 15.8l1.6-4.6" stroke="#fbbf24" stroke-width="1.1" stroke-linecap="round"/><circle cx="20.3" cy="10.4" r="1.5" fill="#fb7185"/>`,
  shentan: `<rect x="1.6" y="14.6" width="20.8" height="5.4" rx="2.7" fill="#23272f"/><path d="M3.2 10.4h14.2l3.4 3.4v2.4H3.2z" fill="#3a3f4c"/><rect x="3.2" y="10.2" width="14.4" height="1" fill="#9f1239"/><rect x="6" y="6.6" width="8.4" height="3.6" rx=".9" fill="#24272f"/><rect x="13.6" y="7.6" width="9.6" height="1.7" rx=".85" fill="#4a5262"/><rect x="7.2" y="4.4" width="4.2" height="1.9" rx=".6" fill="#3a3f4c"/><rect x="11" y="4.9" width="4.6" height=".9" rx=".45" fill="#4a5262"/><circle cx="12.8" cy="7.7" r=".75" fill="#ff3b30"/><path d="M6 14.4h12" stroke="#f2c14e" stroke-width=".9"/>`,
  guimei: `<path d="M12 2.2c4.3 0 6.8 3.2 6.8 7.1v10.1l-2.1-1.7-2 1.9-2.7-1.9-2 1.9-2.7-1.7V9.3c0-3.9 2.5-7.1 6.7-7.1z" fill="#f8fafc"/><ellipse cx="9.7" cy="9.3" rx="1.15" ry="1.7" fill="#1e1b4b"/><ellipse cx="14.3" cy="9.3" rx="1.15" ry="1.7" fill="#1e1b4b"/><ellipse cx="12" cy="13" rx="1.2" ry="1.35" fill="#1e1b4b"/>`,
  // The hidden ones, each as it first shows itself.
  tuolong: `<path d="M7.6 12.6 1.4 9.8l1.2 3.8-1 3.4 6-2.2z" fill="#22c55e"/><path d="M7.2 10.4l1-2.4 1 2.2 1.1-2.7 1.1 2.5 1.1-2.7 1.1 2.6 1.1-2.3 1 2.8z" fill="#15803d"/><ellipse cx="11.4" cy="14" rx="5.2" ry="3.7" fill="#22c55e"/><path d="M8.2 17.2h2.1V21H8.2zM12.6 17.2h2.1V21h-2.1z" fill="#22c55e"/><path d="M14.6 13.2c.3-2.7 2-4.3 4.6-4.3 2.1.1 3.4 1.1 3.9 2.7l.3 1c.1.4-.2.9-.7.9l-3.7.2-.6 2.3h-2.3l.2-1.9z" fill="#22c55e"/><ellipse cx="11.2" cy="15.3" rx="3.9" ry="1.8" fill="#a7e08f"/><path d="M17.6 14.4l.5 1 .5-1 .5 1 .5-1 .5 1 .5-1" stroke="#f3f4d8" stroke-width=".75" fill="none" stroke-linejoin="round"/><circle cx="19.3" cy="11.2" r=".7" fill="#fde047"/>`,
  zecan: `<path d="M6.2 9.6 8.6 6.2l3.6-1.2 3.8 1 2.2 3-.4 5.4-2.6 2.8H9.2l-3-2.6z" fill="#74736a"/><path d="M5 9.8 2.6 12.8l.6 5.8 2.3 1.7 1-2.1-.4-4.3z" fill="#54534d"/><path d="M19.2 9.8l2.4 3-.6 5.8-2.3 1.7-1-2.1.4-4.3z" fill="#54534d"/><circle cx="4.6" cy="20" r="2" fill="#8f8e84"/><circle cx="19.6" cy="20" r="2" fill="#8f8e84"/><path d="M9.4 17.4h2.3v3.8H9.4zM12.5 17.4h2.3v3.8h-2.3z" fill="#54534d"/><rect x="10" y="4" width="4.6" height="3.6" rx=".9" fill="#54534d"/><circle cx="11.4" cy="5.7" r=".6" fill="#ffd166"/><circle cx="13.2" cy="5.7" r=".6" fill="#ffd166"/><path d="M10.2 9.4l.5 3 1.4 1.6M14.4 9l-.4 2.6-1.2 1.4M11.6 12.6l-1.5 2.4" stroke="#ff8a3d" stroke-width=".7" stroke-linecap="round" fill="none"/><path d="M8.6 7.6l1.6 1.2M15.6 7.2l-1.4 1.4" stroke="#8f8e84" stroke-width=".7" stroke-linecap="round"/>`,
  yaqian: `<circle cx="12" cy="12.4" r="10" fill="#ffffff" opacity=".13"/><circle cx="12" cy="12.4" r="9.6" fill="none" stroke="#ffffff" stroke-width=".9" opacity=".85"/><path d="M8 19 10.3 9.6h3.4L16 19z" fill="#f8fafc"/><rect x="10.5" y="7.6" width="3" height="2.7" rx=".9" fill="#f8fafc"/><path d="M10.3 8.6 6.8 10.6M13.7 8.6l3.5 2" stroke="#f8fafc" stroke-width="1.2" stroke-linecap="round"/><circle cx="12" cy="5.6" r="2.1" fill="#ffe9d6"/><path d="M9.9 5.3c0-1.7.9-2.8 2.1-2.8s2.1 1.1 2.1 2.8c-.6-.7-1.3-1-2.1-1s-1.5.3-2.1 1z" fill="#eef2ff"/><circle cx="11.4" cy="5.8" r=".38" fill="#4c1d95"/><circle cx="12.6" cy="5.8" r=".38" fill="#4c1d95"/><ellipse cx="12" cy="1.7" rx="2.7" ry=".7" fill="none" stroke="#fde68a" stroke-width=".8"/><path d="M9.4 10.6 7.4 7.8M14.6 10.6l2-2.8" stroke="#e0e7ff" stroke-width="1" stroke-linecap="round" opacity=".8"/>`,
};

const SPIDER_ART = `<ellipse cx="12" cy="13.4" rx="3.6" ry="4" fill="#241631"/>${spiderLegs('#241631', 1.3)}<circle cx="12" cy="8.8" r="2" fill="#3b2150"/><circle cx="11.3" cy="8.4" r=".55" fill="#ff2d55"/><circle cx="12.7" cy="8.4" r=".55" fill="#ff2d55"/>`;

export function unitIcon(key: UnitKey): string {
  return svg(UNIT_ART[key]);
}

export function buildingIcon(key: BuildingKey, level = 1): string {
  return svg(key === 'defenseNet' ? shield(level) : BUILDING_ART[key](level));
}

export function alienIcon(key: AlienKey): string {
  return svg(ALIEN_ART[key]);
}

export function spiderIcon(): string {
  return svg(SPIDER_ART);
}

const SKELETON_ART = `<g transform="translate(12 12.6) scale(1.5) translate(-12 -12.6)"><path d="M11 9.6h2V15h-2z" fill="#e7e5d8"/><path d="M10.3 10.6h3.4M10.3 11.7h3.4M10.6 12.8h2.8" stroke="#e7e5d8" stroke-width=".8" stroke-linecap="round"/><circle cx="12" cy="7.3" r="2.3" fill="#e7e5d8"/><rect x="10.7" y="8.7" width="2.6" height="1.3" rx=".5" fill="#e7e5d8"/><circle cx="11.1" cy="7.2" r=".55" fill="#1f2430"/><circle cx="12.9" cy="7.2" r=".55" fill="#1f2430"/><path d="M11 15l-.8 5M13 15l.8 5M10.8 10.4 9 13.8M13.2 10.4l1.8 3.2" stroke="#e7e5d8" stroke-width="1" stroke-linecap="round"/><path d="M15 13.8 18.6 10" stroke="#9aa2b1" stroke-width="1.1" stroke-linecap="round"/><path d="M14 14.6l2-2" stroke="#5b3a1e" stroke-width="1.2" stroke-linecap="round"/></g>`;

/** A skeleton soldier, for its card and the rulebook. */
export function skeletonIcon(): string {
  return svg(SKELETON_ART);
}

const TERRAIN_ART: Record<Terrain, string> = {
  plain: `<rect x="1" y="1" width="22" height="22" rx="5" fill="#4e8b50"/><path d="M6 18c1-3 1-5.5 0-8.5M10 18c1.5-2.5 1.5-5 0-7.5M14 18c-1-3-1-5.5 0-8.5M18 18c-1.5-2.5-1.5-5 0-7.5" stroke="#2b6236" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  hill: `<rect x="1" y="1" width="22" height="22" rx="5" fill="#89805f"/><path d="M1.5 19.5 9 7l4.2 6.4 2.4-3.4 7 9.5z" fill="#57503d"/><path d="M9 7l2.2 3.4-1.5.7-1.4-1.1z" fill="#ece7d8"/><path d="M15.6 10l1.6 2.4-1.5.3-.8-.9z" fill="#ece7d8"/>`,
  forest: `<rect x="1" y="1" width="22" height="22" rx="5" fill="#34713f"/><path d="M7.8 4.5 11.4 11H9.3l3.2 5.5H2.2L5.4 11H3.6z" fill="#1c5629"/><rect x="6.9" y="16.5" width="1.8" height="4" rx="0.4" fill="#5b3a1e"/><path d="M16.8 7.5 20 12.8h-1.7l2.4 4.2h-8.4l2.4-4.2H13z" fill="#277a3c"/><rect x="15.9" y="17" width="1.8" height="3.5" rx="0.4" fill="#5b3a1e"/>`,
  water: `<rect x="1" y="1" width="22" height="22" rx="5" fill="#1f5485"/><path d="M3 9c2-2.2 4-2.2 6 0s4 2.2 6 0 4-2.2 6 0M3 15c2-2.2 4-2.2 6 0s4 2.2 6 0 4-2.2 6 0" stroke="#9dd3f5" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  lake: `<rect x="1" y="1" width="22" height="22" rx="5" fill="#4f8f52"/><path d="M6.5 6.5c4-3 9-2.5 12 0s2.5 9-.5 12-9 3-12.5-.5-3-9 1-11.5z" fill="#236297"/><path d="M7.5 11c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0M9 15c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0" stroke="#9dd3f5" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  bridge: `<rect x="1" y="1" width="22" height="22" rx="5" fill="#1f5485"/><path d="M3 6c2-2 4-2 6 0M15 19c2-2 4-2 6 0" stroke="#9dd3f5" stroke-width="1.6" fill="none" stroke-linecap="round"/><rect x="1" y="9.2" width="22" height="6.6" fill="#9a6833"/><path d="M1 9.2h22M1 15.8h22" stroke="#5b3a1e" stroke-width="1.7"/><path d="M6.2 9.2v6.6M12 9.2v6.6M17.8 9.2v6.6" stroke="#6b4520" stroke-width="1.4"/>`,
};

export function terrainIcon(kind: Terrain): string {
  return svg(TERRAIN_ART[kind]);
}

// ---------------------------------------------------------------------------
// Line drawings for the menus, in `currentColor`.
// ---------------------------------------------------------------------------

export type Glyph = 'play' | 'save' | 'load' | 'restart' | 'quit' | 'back' | 'next' | 'trash' | 'menu' | 'check' | 'home' | 'book' | 'leave' | 'promote';

const GLYPHS: Record<Glyph, string> = {
  play: '<path d="M8 5.8v12.4a.6.6 0 0 0 .92.5l9.6-6.2a.6.6 0 0 0 0-1l-9.6-6.2A.6.6 0 0 0 8 5.8z"/>',
  save: '<path d="M5 3.5h11l4.5 4.5v11A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M8 3.5V9h8V3.5M7 20.5v-6.5h10v6.5"/>',
  load: '<path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.2l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  restart: '<path d="M21.5 4v5.5H16"/><path d="M19.6 14.5a8 8 0 1 1-1.9-8.3l3.8 3.3"/>',
  quit: '<path d="M13 4H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h7"/><path d="M11 12h9.5M17 8.5l3.5 3.5-3.5 3.5"/>',
  back: '<path d="M14.5 6l-6 6 6 6"/>',
  next: '<path d="M9.5 6l6 6-6 6"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"/><path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12"/><path d="M10 11v6M14 11v6"/>',
  menu: '<path d="M5 7h14M5 12h14M5 17h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5"/><path d="M10 20v-5.5h4V20"/>',
  // An open book, seen from above the spine.
  book: '<path d="M12 6.2C10.6 4.9 8.3 4.3 4.5 4.5v14.2c3.8-.2 6.1.4 7.5 1.7 1.4-1.3 3.7-1.9 7.5-1.7V4.5c-3.8-.2-6.1.4-7.5 1.7z"/><path d="M12 6.2v14.2"/>',
  // A building with a way out of it: soldiers leaving the house they hold.
  leave: '<path d="M3.5 11.5 10 6l6.5 5.5"/><path d="M5.5 10v9.5h5"/><path d="M13 15h8M18 12l3 3-3 3"/>',
  // Stripes of rank, and the way up past them.
  promote: '<path d="M5.5 12.5 12 6.5l6.5 6"/><path d="M5.5 18 12 12l6.5 6"/><path d="M7 21.5h10"/>',
};

/**
 * A rank's insignia: as many chevrons as the rank has, stacked, drawn in
 * `currentColor` so that the card can colour them and the box they sit in can be dark.
 */
export function rankIcon(rank: number): string {
  const n = Math.max(1, Math.min(3, rank));
  let art = '';
  for (let i = 0; i < n; i++) {
    // Kept to the middle of the square whether there is one chevron or three.
    const y = 5 + (3 - n) * 2.5 + i * 5;
    art += `<path d="M4 ${y + 3.4}L12 ${y - 1.6}l8 5-2.2 2.3L12 ${y + 1.2}l-5.8 4.5z" fill="currentColor"/>`;
  }
  return svg(art);
}

/** A line drawing for a menu button. */
export function glyph(name: Glyph): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</g></svg>`;
}

/** The icon box that sits at the left of a menu row. */
export function iconBox(art: string, color?: string): HTMLElement {
  return h('span', { class: 'icon', html: art, ...(color ? { style: `color:${color}` } : {}) });
}

/** Which of a 3x3 grid of pips are showing for each face. */
const PIPS: number[][] = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];

/** A die face drawn with CSS, so it stays crisp at any size. */
export function die(value: number, size: number): HTMLElement {
  const pips = PIPS[value] ?? [];
  return h(
    'span',
    { class: 'die', style: `--s:${size}px` },
    ...Array.from({ length: 9 }, (_, i) => h('i', { class: pips.includes(i) ? 'on' : '' })),
  );
}
