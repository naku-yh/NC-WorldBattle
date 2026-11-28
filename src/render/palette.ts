import type { Terrain } from '../game/types';

/** Two shades per terrain for the board's checker, plus the colour the minimap uses. */
export const TERRAIN_COLORS: Record<Terrain, { a: string; b: string; mini: string }> = {
  plain: { a: '#4e8b50', b: '#559155', mini: '#4f8f52' },
  forest: { a: '#2d6639', b: '#34713f', mini: '#1f6233' },
  hill: { a: '#7f7658', b: '#89805f', mini: '#94886a' },
  water: { a: '#1b4b7a', b: '#1f5485', mini: '#2f86d6' },
  lake: { a: '#1f5a8c', b: '#236297', mini: '#3b96e2' },
  bridge: { a: '#8a5a2b', b: '#94622f', mini: '#d9a441' },
};

/** The water itself, under the sheet that shimmers over it. */
export const WATER = '#1c4e7f';

/** Supply lanes trucks drive on. */
export const LANE_COLOR = 'rgba(164,138,98,0.88)';
export const DEPOT_COLOR = 'rgba(128,136,148,0.92)';
