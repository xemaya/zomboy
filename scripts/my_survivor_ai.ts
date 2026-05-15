// My survivor AI v3 — 2-ply lookahead: I move → zombie responds → evaluate.
import { newState, clickCell } from "../src/game/state";
import { generateMap } from "../src/game/mapgen";
import { planTurn, planCardResolution, type Level } from "../src/game/ai";
import { legalMoves, legalJumps, pieceAt, pieceById, emptyCells, ORTHO, EIGHT, runInfection, checkWinner } from "../src/game/rules";
import type { State, Piece } from "../src/game/types";

const inBounds = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
const manhattan = (a: { r: number; c: number }, b: { r: number; c: number }) =>
  Math.abs(a.r - b.r) + Math.abs(a.c - b.c);

function orthoZNeighbors(state: State, r: number, c: number): number {
  let n = 0;
  for (const [dr, dc] of ORTHO) {
    const p = pieceAt(state, r + dr, c + dc);
    if (p && p.side === "zombie") n++;
  }
  return n;
}

function cloneState(s: State): State {
  return {
    ...s,
    pieces: s.pieces.map((p) => ({ ...p })),
    map: {
      ...s.map,
      terrain: s.map.terrain.map((row) => row.slice()),
      houses: s.map.houses.map((h) => ({ ...h })),
      starts: s.map.starts.map((h) => ({ ...h })),
    },
    housesConsumed: new Set(s.housesConsumed),
    deck: s.deck.slice(),
    zombieTurn: { mode: null, movesLeft: 0 },
    pendingCard: null,
    selectedPieceId: null,
    log: [],
  };
}

// Simulate: survivor moves (svId to nr,nc), then zombie takes best response
// Return the state after both turns complete
function simSurvivorThenZombie(state: State, svId: string, nr: number, nc: number, zLevel: Level): State {
  const s = cloneState(state);
  
  // Apply survivor move
  const sv = pieceById(s, svId)!;
  sv.r = nr;
  sv.c = nc;
  
  // Check if this was a jump kill
  const origPiece = pieceById(state, svId)!;
  const jumps = legalJumps(state, origPiece);
  const jump = jumps.find((j) => j.destR === nr && j.destC === nc);
  if (jump) {
    const killed = pieceAt(s, jump.killR, jump.killC);
    if (killed) {
      s.pieces = s.pieces.filter((p) => p.id !== killed.id);
      s.survivorKills += 1;
    }
  }
  
  // Run infection
  runInfection(s);
  
  // Check winner
  if (checkWinner(s)) return s;
  
  // Switch to zombie turn
  s.turnSide = "zombie";
  if (s.turnSide === "zombie") {
    s.zombieTurn = { mode: null, movesLeft: 0 };
  }
  s.turnNumber += 1;
  
  // Zombie AI response — simulate by calling planTurn on a CLONE
  // But planTurn reads real state. Let's just apply the planTurn clicks directly.
  const zClicks = planTurn(s, "zombie", zLevel);
  for (const { r: zr, c: zc } of zClicks) {
    if (checkWinner(s)) break;
    // Simulate zombie click without going through clickCell
    simulateZombieClick(s, zr, zc);
  }
  
  // Run infection after zombie turn
  runInfection(s);
  
  return s;
}

function simulateZombieClick(state: State, r: number, c: number) {
  const piece = pieceAt(state, r, c);
  const terrain = state.map.terrain[r][c];

  // Teleport
  if (state.pendingTeleport && piece && piece.side === "zombie") {
    const { r: dr, c: dc } = state.pendingTeleport;
    piece.r = dr; piece.c = dc;
    state.pendingTeleport = null;
    state.zombieTurn = { mode: null, movesLeft: 0 };
    state.selectedPieceId = null;
    return;
  }

  // Click own zombie: enter move mode
  if (piece && piece.side === "zombie") {
    state.pendingTeleport = null;
    state.selectedPieceId = piece.id;
    if (state.zombieTurn.mode !== "move") {
      state.zombieTurn = { mode: "move", movesLeft: 2 };
    }
    return;
  }

  // Click stone/survivor — ignore
  if (terrain === "stone" || (piece && piece.side === "survivor")) return;

  // Empty cell
  const inMoveMode = state.zombieTurn.mode === "move";
  const movesLeft = state.zombieTurn.movesLeft;
  const committed = inMoveMode && movesLeft < 2;

  if (inMoveMode && state.selectedPieceId) {
    const z = pieceById(state, state.selectedPieceId);
    if (z && legalMoves(state, z).some((t) => t.r === r && t.c === c)) {
      z.r = r; z.c = c;
      state.zombieTurn.movesLeft -= 1;
      if (state.zombieTurn.movesLeft <= 0) {
        state.selectedPieceId = null;
        state.zombieTurn = { mode: null, movesLeft: 0 };
      }
      return;
    }
    if (committed) return;
    state.selectedPieceId = null;
    state.zombieTurn = { mode: null, movesLeft: 0 };
  }

  // Summon
  if (state.zombieReserve > 0) {
    let n = 1;
    while (state.pieces.some((p) => p.id === `Z${n}`)) n++;
    state.pieces.push({ id: `Z${n}`, side: "zombie", r, c });
    state.zombieReserve -= 1;
    state.zombieTurn = { mode: null, movesLeft: 0 };
    state.selectedPieceId = null;
    return;
  }
  // Teleport dest
  state.pendingTeleport = { r, c };
}

// Evaluate state from survivor perspective
function evalSurvivor(state: State): number {
  if (state.survivorKills >= 4) return 1000000;
  if (state.zombieKills >= 4) return -1000000;
  
  let score = 0;
  const survivors = state.pieces.filter((p) => p.side === "survivor");
  const zombies = state.pieces.filter((p) => p.side === "zombie");
  
  // Score difference
  score += (state.survivorKills - state.zombieKills) * 10000;
  
  // Jump kill opportunities
  for (const sv of survivors) {
    score += legalJumps(state, sv).length * 800;
  }
  
  // Infection danger
  for (const sv of survivors) {
    const z = orthoZNeighbors(state, sv.r, sv.c);
    if (z >= 2) score -= 50000; // About to die
    else if (z === 1) score -= 300;
  }
  
  // Mobility
  for (const sv of survivors) {
    const moves = legalMoves(state, sv);
    const jumps = legalJumps(state, sv);
    if (moves.length + jumps.length === 0) score -= 5000;
    else score += (moves.length + jumps.length) * 30;
  }
  
  // Zombie proximity
  for (const sv of survivors) {
    let minZ = 99;
    for (const z of zombies) minZ = Math.min(minZ, manhattan(sv, z));
    score += minZ * 40;
  }
  
  // Spread
  for (let i = 0; i < survivors.length; i++) {
    for (let j = i + 1; j < survivors.length; j++) {
      const d = manhattan(survivors[i], survivors[j]);
      if (d <= 1) score -= 200;
    }
  }
  
  return score;
}

// My survivor AI with 2-ply lookahead
function mySurvivorPlan(state: State, zLevel: Level = "hard"): Array<{ r: number; c: number }> {
  const survivors = state.pieces.filter((p) => p.side === "survivor");
  if (survivors.length === 0) return [];

  let best: { sv: Piece; r: number; c: number; score: number } | null = null;
  let bestScore = -Infinity;

  for (const sv of survivors) {
    // Try all jumps
    for (const j of legalJumps(state, sv)) {
      const after = simSurvivorThenZombie(state, sv.id, j.destR, j.destC, zLevel);
      const sc = evalSurvivor(after);
      if (sc > bestScore) { bestScore = sc; best = { sv, r: j.destR, c: j.destC, score: sc }; }
    }
    // Try all moves
    for (const m of legalMoves(state, sv)) {
      const after = simSurvivorThenZombie(state, sv.id, m.r, m.c, zLevel);
      const sc = evalSurvivor(after);
      if (sc > bestScore) { bestScore = sc; best = { sv, r: m.r, c: m.c, score: sc }; }
    }
  }

  if (!best) return [];
  return [{ r: best.sv.r, c: best.sv.c }, { r: best.r, c: best.c }];
}

// Card resolution
function myCardPlan(state: State): Array<{ r: number; c: number }> {
  const pc = state.pendingCard;
  if (!pc) return [];
  const survivors = state.pieces.filter((p) => p.side === "survivor");
  const zombies = state.pieces.filter((p) => p.side === "zombie");
  if (survivors.length === 0) return [];

  if (pc.kind === "ghost") {
    let worstZ = zombies[0], worstThreat = -Infinity;
    for (const z of zombies) {
      let threat = 0;
      for (const sv of survivors) {
        const d = manhattan(z, sv);
        if (d === 1) threat += 1000;
        threat += Math.max(0, (5 - d)) * 100;
      }
      if (threat > worstThreat) { worstThreat = threat; worstZ = z; }
    }
    return [{ r: worstZ.r, c: worstZ.c }];
  }

  if (pc.kind === "shoes") {
    if (pc.phase === "pick-survivor") {
      let best: { sv: Piece; r: number; c: number } | null = null;
      let bestSc = -Infinity;
      for (const sv of survivors) {
        for (const j of legalJumps(state, sv)) {
          const after = simSurvivorThenZombie(state, sv.id, j.destR, j.destC, "hard");
          const sc = evalSurvivor(after) + 50000;
          if (sc > bestSc) { bestSc = sc; best = { sv, r: j.destR, c: j.destC }; }
        }
        for (const m of legalMoves(state, sv)) {
          const after = simSurvivorThenZombie(state, sv.id, m.r, m.c, "hard");
          const sc = evalSurvivor(after);
          if (sc > bestSc) { bestSc = sc; best = { sv, r: m.r, c: m.c }; }
        }
      }
      if (!best) return [];
      return [{ r: best.sv.r, c: best.sv.c }, { r: best.r, c: best.c }];
    }
    const sid = (pc as { survivorId?: string }).survivorId;
    if (!sid) return [];
    const sv = pieceById(state, sid);
    if (!sv) return [];
    let bestR = sv.r, bestC = sv.c, bestSc = -Infinity;
    for (const j of legalJumps(state, sv)) {
      const after = simSurvivorThenZombie(state, sv.id, j.destR, j.destC, "hard");
      const sc = evalSurvivor(after) + 50000;
      if (sc > bestSc) { bestSc = sc; bestR = j.destR; bestC = j.destC; }
    }
    for (const m of legalMoves(state, sv)) {
      const after = simSurvivorThenZombie(state, sv.id, m.r, m.c, "hard");
      const sc = evalSurvivor(after);
      if (sc > bestSc) { bestSc = sc; bestR = m.r; bestC = m.c; }
    }
    return [{ r: bestR, c: bestC }];
  }

  if (pc.phase === "pick-survivor") {
    let best: { sv: Piece; steps: Array<{ r: number; c: number }> } | null = null;
    let bestSc = -Infinity;
    for (const sv of survivors) {
      const moves1 = [...legalMoves(state, sv)];
      const jumps1 = legalJumps(state, sv).map((j) => ({ r: j.destR, c: j.destC }));
      for (const m1 of [...moves1, ...jumps1]) {
        const oldR = sv.r, oldC = sv.c;
        sv.r = m1.r; sv.c = m1.c;
        const moves2 = legalMoves(state, sv);
        sv.r = oldR; sv.c = oldC;
        for (const m2 of moves2) {
          const sim = cloneState(state);
          pieceById(sim, sv.id)!.r = m2.r;
          pieceById(sim, sv.id)!.c = m2.c;
          runInfection(sim);
          const sc = evalSurvivor(sim);
          if (sc > bestSc) { bestSc = sc; best = { sv, steps: [{ r: m1.r, c: m1.c }, { r: m2.r, c: m2.c }] }; }
        }
      }
    }
    if (!best) return [];
    return [{ r: best.sv.r, c: best.sv.c }, best.steps[0], best.steps[1]];
  }

  const sid = (pc as { survivorId?: string }).survivorId;
  if (!sid) return [];
  const sv = pieceById(state, sid);
  if (!sv) return [];
  let bestR = sv.r, bestC = sv.c, bestSc = -Infinity;
  for (const m of legalMoves(state, sv)) {
    const after = simSurvivorThenZombie(state, sv.id, m.r, m.c, "hard");
    const sc = evalSurvivor(after);
    if (sc > bestSc) { bestSc = sc; bestR = m.r; bestC = m.c; }
  }
  return [{ r: bestR, c: bestC }];
}

// ===== SIMULATION =====
interface GameResult {
  winner: "survivor" | "zombie" | "draw";
  totalMoves: number;
  survivorKills: number;
  zombieKills: number;
  finalSurvivors: number;
  finalZombies: number;
  stalePlies: number;
  log: string[];
}

function simulateOneGame(zLevel: Level, mapSeed: number): GameResult {
  const map = generateMap(mapSeed);
  const state: State = newState(map);
  let totalMoves = 0;
  let safetyCounter = 0;

  while (!state.winner && safetyCounter < 5000) {
    safetyCounter++;

    if (state.pendingCard) {
      const clicks = myCardPlan(state);
      for (const { r, c } of clicks) {
        if (state.winner) break;
        clickCell(state, r, c);
        totalMoves++;
      }
      continue;
    }

    if (state.turnSide === "zombie") {
      const clicks = planTurn(state, "zombie", zLevel);
      for (const { r, c } of clicks) {
        if (state.winner) break;
        clickCell(state, r, c);
        totalMoves++;
      }
    } else {
      const clicks = mySurvivorPlan(state, zLevel);
      for (const { r, c } of clicks) {
        if (state.winner) break;
        clickCell(state, r, c);
        totalMoves++;
      }
    }
  }

  const finalS = state.pieces.filter((p) => p.side === "survivor").length;
  const finalZ = state.pieces.filter((p) => p.side === "zombie").length;

  return {
    winner: state.winner ?? "draw",
    totalMoves,
    survivorKills: state.survivorKills,
    zombieKills: state.zombieKills,
    finalSurvivors: finalS,
    finalZombies: finalZ,
    stalePlies: state.stalePlies,
    log: state.log.slice(-20),
  };
}

const GAMES = 10;

console.log(`\n${"═".repeat(60)}`);
console.log("  My Survivor AI v3 (2-ply lookahead) vs Built-in Zombie AI (hard)");
console.log(`  ${GAMES} games`);
console.log(`${"═".repeat(60)}`);

const results: GameResult[] = [];
for (let i = 0; i < GAMES; i++) {
  const seed = (Date.now() ^ (i * 0x6d2b79f5)) >>> 0;
  const r = simulateOneGame("hard", seed);
  results.push(r);

  const w = r.winner === "survivor" ? "✅ 幸存者胜" : r.winner === "zombie" ? "❌ 僵尸胜" : "⚪ 平局";
  console.log(`\n  Game ${i + 1}: ${w}  (${r.totalMoves} moves)`);
  console.log(`    Score: S=${r.survivorKills} Z=${r.zombieKills} | Survivors: ${r.finalSurvivors} | Zombies: ${r.finalZombies}`);
  const keyEvents = r.log.filter((l) => l.includes("跳杀") || l.includes("感染") || l.includes("胜利") || l.includes("无进展") || l.includes("驱散"));
  console.log(`    Key: ${keyEvents.join(" | ")}`);
}

const sWins = results.filter((r) => r.winner === "survivor").length;
const zWins = results.filter((r) => r.winner === "zombie").length;
const draws = results.filter((r) => r.winner === "draw").length;

console.log(`\n${"─".repeat(60)}`);
console.log(`  Summary:`);
console.log(`    幸存者: ${sWins}/${GAMES} (${(sWins / GAMES * 100).toFixed(0)}%)`);
console.log(`    僵  尸: ${zWins}/${GAMES} (${(zWins / GAMES * 100).toFixed(0)}%)`);
console.log(`    平  局: ${draws}/${GAMES} (${(draws / GAMES * 100).toFixed(0)}%)`);
const avgSK = results.reduce((a, r) => a + r.survivorKills, 0) / results.length;
const avgZK = results.reduce((a, r) => a + r.zombieKills, 0) / results.length;
console.log(`    Avg score: S=${avgSK.toFixed(1)} Z=${avgZK.toFixed(1)}`);
console.log(`    Avg moves: ${(results.reduce((a, r) => a + r.totalMoves, 0) / results.length).toFixed(0)}`);
console.log(`${"═".repeat(60)}\n`);
