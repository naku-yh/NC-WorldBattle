import { BoardIndex, RALLY_LOCAL, isFree, toWorld } from '../game/board';
import { ALIENS, ALIEN_KEYS, SPIDERLING, UNITS } from '../game/data';
import { createGame, reduce } from '../game/engine';
import type { BuildingKey, GameState, MoveMode, Pt, Unit, UnitKey } from '../game/types';

/** What each base in the picture has beyond what a match starts with. */
const EXTRA: BuildingKey[] = ['powerPlant', 'powerPlant', 'barracks', 'warFactory', 'airport', 'turret', 'aaGun'];
/** Drawn up outside each base, the heaviest first. */
const PARADE: UnitKey[] = ['apocalypse', 'tank', 'twinTank', 'aaTank', 'missileTank', 'laserTank', 'infantry', 'infantry', 'sniper', 'atSoldier', 'fighter'];

/**
 * The board behind the title screen: every base built up the way the rules
 * allow, an army drawn up outside it, and the alien in no-man's-land. Nothing
 * ever plays it; it only has to look like a match in full swing.
 */
export function diorama(seed: number, seats: ('human' | 'ai')[]): GameState {
  const s = createGame({ seats, totalTurns: 20, seed });
  s.phase = 'player';
  for (const p of s.players) {
    // The rules do the placing, so every base is laid out as it could be in a real match.
    s.currentPlayer = p.id;
    p.resources = { ore: 99999, oil: 99999, meat: 99999 };
    for (const k of EXTRA) reduce(s, { type: 'BUILD', key: k });
    const rally = toWorld(s.corners[p.corner], RALLY_LOCAL.u, RALLY_LOCAL.v);
    const ground = openGround(s, rally, PARADE.length - 1);
    let i = 0;
    for (const k of PARADE) {
      // Wings need no ground: the fighter circles above the rally point.
      const at = UNITS[k].unitClass === 'air' ? rally : ground[i++];
      const u: Unit = { id: s.nextId++, key: k, owner: p.id, x: at.x, y: at.y, hp: UNITS[k].hp, moveUsed: false, attackUsed: false };
      p.units.push(u);
    }
  }
  s.phase = 'roundStart';
  s.currentPlayer = 0;
  s.log = [];
  // All five aliens stand in no-man's-land, the spider queen with a few of her brood.
  const half = Math.floor(s.boardSize / 2);
  const dens = openGround(s, { x: half, y: half }, ALIEN_KEYS.length);
  s.aliens = ALIEN_KEYS.flatMap((key, i) => (dens[i] ? [{ id: s.nextId++, key, x: dens[i].x, y: dens[i].y, hp: ALIENS[key].hp, arrived: 6, hurt: {} }] : []));
  const queen = s.aliens.find((a) => a.key === 'kuide');
  if (queen) {
    for (const den of openGround(s, queen, 3).slice(1)) {
      s.brood.push({ id: s.nextId++, owner: queen.id, x: den.x, y: den.y, hp: SPIDERLING.hp });
    }
  }
  s.nextAlien = 999;
  return s;
}

/** Free tiles on square rings around `from`, nearest first. */
function openGround(s: GameState, from: Pt, count: number, mode: MoveMode = 'foot'): Pt[] {
  const idx = new BoardIndex(s);
  const out: Pt[] = [];
  for (let r = 0; r < s.boardSize && out.length < count; r++) {
    for (let dx = -r; dx <= r && out.length < count; dx++) {
      for (let dy = -r; dy <= r && out.length < count; dy++) {
        // Only the ring itself: everything inside was done at a smaller radius.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isFree(idx, s, from.x + dx, from.y + dy, mode)) out.push({ x: from.x + dx, y: from.y + dy });
      }
    }
  }
  return out;
}
