export const BOARD = 8;
export const WIN_KILLS = 4;
export const ZOMBIE_RESERVE_START = 9;

export type Terrain = "empty" | "stone" | "house" | "start";
export type Side = "survivor" | "zombie";

export interface Piece {
  id: string;
  side: Side;
  r: number;
  c: number;
}

export interface MapData {
  terrain: Terrain[][];
  houses: Array<{ r: number; c: number }>;
  starts: Array<{ r: number; c: number }>;
}

// Zombie turn sub-state. Mode is INFERRED from the first click:
//   - click empty cell (reserve>0) → summon a new zombie
//   - click own zombie → enter move mode (movesLeft = 2)
// When reserve is empty the only action is moving (no teleport).
export type ZombieMode = "summon" | "move";

export interface ZombieTurn {
  mode: ZombieMode | null;
  movesLeft: number;
}

// Drawn-card effect. Deck is shuffled at game start; each house consumes 1 card.
export type CardKind = "ghost" | "shoes" | "coffee";

export type PendingCard =
  | { kind: "ghost"; phase: "pick-zombie" } // banish a zombie back to reserve
  | { kind: "shoes"; phase: "pick-survivor" | "pick-dest"; survivorId?: string }
  | { kind: "coffee"; phase: "pick-survivor" | "pick-dest1" | "pick-dest2"; survivorId?: string };

export type Winner = "survivor" | "zombie" | "draw" | null;

// If this many half-turns pass with no new kill of either kind, the game is
// called (leader wins; tie = draw). Real games score well within this; it only
// rescues pathological stalemates (e.g. two evasive AIs in AI-vs-AI).
export const STALE_PLY_CAP = 50;

export interface State {
  map: MapData;
  pieces: Piece[];
  housesConsumed: Set<string>;

  zombieReserve: number;        // unplaced zombies, starts at 9
  survivorKills: number;        // zombies the survivor team has jumped
  zombieKills: number;          // survivors the zombie team has infected

  turnSide: Side;               // zombies first
  turnNumber: number;           // informational

  zombieTurn: ZombieTurn;       // valid when turnSide === 'zombie'

  deck: CardKind[];             // shuffled at game start; house draws from top

  selectedPieceId: string | null;
  pendingCard: PendingCard | null;

  winner: Winner;
  killMark: number;             // survivorKills+zombieKills at last progress
  stalePlies: number;           // half-turns since the last kill
  log: string[];
  flavor: string;               // fun rotating status line shown at the bottom
}
