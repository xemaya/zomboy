import { BOARD, WIN_KILLS, Piece, Side, State } from "./types";

export function pieceAt(state: State, r: number, c: number): Piece | null {
  for (const p of state.pieces) if (p.r === r && p.c === c) return p;
  return null;
}

function inBounds(r: number, c: number) {
  return r >= 0 && r < BOARD && c >= 0 && c < BOARD;
}

export const ORTHO: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const DIAG: Array<[number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

export const EIGHT: Array<[number, number]> = [...ORTHO, ...DIAG];

// Legal one-step move cells. Zombies move orthogonally only;
// survivors move in all 8 directions.
export function legalMoves(state: State, piece: Piece): Array<{ r: number; c: number }> {
  const dirs = piece.side === "zombie" ? ORTHO : EIGHT;
  const out: Array<{ r: number; c: number }> = [];
  for (const [dr, dc] of dirs) {
    const nr = piece.r + dr;
    const nc = piece.c + dc;
    if (!inBounds(nr, nc)) continue;
    if (state.map.terrain[nr][nc] === "stone") continue;
    if (pieceAt(state, nr, nc)) continue;
    // R1: zombies cannot end orthogonally adjacent to another zombie.
    if (piece.side === "zombie" && !zombieMayOccupy(state, nr, nc, piece.id)) continue;
    out.push({ r: nr, c: nc });
  }
  return out;
}

// Survivor-only: jump over an adjacent zombie to the cell beyond (any of 8
// directions). Returns array of { dest, killR, killC }.
export interface JumpMove {
  destR: number;
  destC: number;
  killR: number;
  killC: number;
}

export function legalJumps(state: State, piece: Piece): JumpMove[] {
  if (piece.side !== "survivor") return [];
  const out: JumpMove[] = [];
  for (const [dr, dc] of EIGHT) {
    const midR = piece.r + dr;
    const midC = piece.c + dc;
    const dstR = piece.r + 2 * dr;
    const dstC = piece.c + 2 * dc;
    if (!inBounds(dstR, dstC)) continue;
    if (state.map.terrain[dstR][dstC] === "stone") continue;
    if (pieceAt(state, dstR, dstC)) continue;
    const mid = pieceAt(state, midR, midC);
    if (!mid || mid.side !== "zombie") continue;
    out.push({ destR: dstR, destC: dstC, killR: midR, killC: midC });
  }
  return out;
}

// Cells with no piece and not stone — used for "summon zombie" and "ghost dice".
export function emptyCells(state: State): Array<{ r: number; c: number }> {
  const out: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < BOARD; r++) {
    for (let c = 0; c < BOARD; c++) {
      if (state.map.terrain[r][c] === "stone") continue;
      if (pieceAt(state, r, c)) continue;
      out.push({ r, c });
    }
  }
  return out;
}

// R1: a zombie may only come to occupy a cell that is in-bounds, not stone,
// not occupied by another piece, and NOT orthogonally adjacent to another
// zombie. `ignoreId` excludes the moving zombie itself (its old cell is one
// ortho step from its destination, so without this every move is illegal).
// Single source of truth for move / summon / infection-spawn (R1).
export function zombieMayOccupy(
  state: State,
  r: number,
  c: number,
  ignoreId?: string,
): boolean {
  if (!inBounds(r, c)) return false;
  if (state.map.terrain[r][c] === "stone") return false;
  const occ = pieceAt(state, r, c);
  // Occupancy: only the move-mode caller passes ignoreId, and legalMoves only
  // offers empty destinations — so a cell holding the ignored zombie itself
  // (its own cell) is treated as occupiable (a harmless no-op target).
  if (occ && occ.id !== ignoreId) return false;
  for (const [dr, dc] of ORTHO) {
    const n = pieceAt(state, r + dr, c + dc);
    if (n && n.side === "zombie" && n.id !== ignoreId) return false;
  }
  return true;
}

// R1.4: does the zombie side have ANY legal action this turn? Used to safely
// skip a (pathologically) stuck zombie turn instead of looping forever.
export function zombieHasAnyLegalAction(state: State): boolean {
  if (state.zombieReserve > 0) {
    for (let r = 0; r < BOARD; r++)
      for (let c = 0; c < BOARD; c++)
        if (zombieMayOccupy(state, r, c)) return true;
  }
  for (const p of state.pieces)
    if (p.side === "zombie" && legalMoves(state, p).length > 0) return true;
  return false;
}

// R2: pick the cell for an infection-spawned zombie. Deterministic: among all
// R1-legal placeable cells, the one with min Manhattan distance to the nearest
// surviving survivor; tie-break = lexicographic (r, then c). Returns null when
// no survivor remains or no legal cell exists (caller then skips the spawn).
export function pickInfectionSpawn(
  state: State,
): { r: number; c: number } | null {
  const survs = state.pieces.filter((p) => p.side === "survivor");
  if (survs.length === 0) return null;
  let best: { r: number; c: number } | null = null;
  let bestD = Infinity;
  for (let r = 0; r < BOARD; r++) {
    for (let c = 0; c < BOARD; c++) {
      if (!zombieMayOccupy(state, r, c)) continue;
      let d = Infinity;
      for (const s of survs) {
        const md = Math.abs(s.r - r) + Math.abs(s.c - c);
        if (md < d) d = md;
      }
      if (d < bestD) {
        bestD = d;
        best = { r, c };
      }
      // scan order is r-major then c-major, and we only replace on strictly
      // smaller distance, so the first (smallest r, then c) wins ties.
    }
  }
  return best;
}

// End-of-turn infection scan. Any survivor with >=2 orthogonal zombie neighbors
// is infected: removed, zombie kill count goes up. If reserve > 0, a new zombie
// spawns in the vacated cell. Returns log messages.
export function runInfection(state: State): string[] {
  const log: string[] = [];
  const infected: Piece[] = [];
  for (const p of state.pieces) {
    if (p.side !== "survivor") continue;
    let z = 0;
    for (const [dr, dc] of ORTHO) {
      const n = pieceAt(state, p.r + dr, p.c + dc);
      if (n && n.side === "zombie") z++;
    }
    if (z >= 2) infected.push(p);
  }
  for (const p of infected) {
    state.pieces = state.pieces.filter((x) => x !== p);
    state.zombieKills += 1;
    log.push(`${p.id} 在 (${p.r},${p.c}) 被感染！(zombie +1 = ${state.zombieKills})`);
    if (state.zombieReserve > 0) {
      // R2: spawn relocated. pickInfectionSpawn requires this infected
      // survivor to already be removed from state.pieces (done above) and the
      // infecting zombies still in place — so call it HERE, post-removal.
      const spot = pickInfectionSpawn(state);
      if (spot) {
        state.zombieReserve -= 1;
        const newId = nextZombieId(state);
        state.pieces.push({ id: newId, side: "zombie", r: spot.r, c: spot.c });
        log.push(`新僵尸 ${newId} 在 (${spot.r},${spot.c}) 生成（库存剩 ${state.zombieReserve}）`);
      } else {
        log.push(`无可用点，本次感染未生成新僵尸`);
      }
    }
  }
  return log;
}

export function nextZombieId(state: State): string {
  let n = 1;
  while (state.pieces.some((p) => p.id === `Z${n}`)) n++;
  return `Z${n}`;
}

export function checkWinner(state: State): "survivor" | "zombie" | null {
  // Canonical rule: first side to collect WIN_KILLS of opponent's pieces wins.
  if (state.survivorKills >= WIN_KILLS) return "survivor";
  if (state.zombieKills >= WIN_KILLS) return "zombie";
  return null;
}

export function pieceById(state: State, id: string): Piece | null {
  return state.pieces.find((p) => p.id === id) ?? null;
}

export function otherSide(s: Side): Side {
  return s === "survivor" ? "zombie" : "survivor";
}
