// AI vs AI simulation — run N games and collect statistics INCLUDING card usage.
import { newState, clickCell } from "../src/game/state";
import { generateMap } from "../src/game/mapgen";
import { planTurn, planCardResolution, type Level } from "../src/game/ai";
import type { State, CardKind } from "../src/game/types";

interface GameResult {
  winner: "survivor" | "zombie" | "draw";
  totalMoves: number;
  survivorKills: number;
  zombieKills: number;
  stalePlies: number;
  finalSurvivors: number;
  finalZombies: number;
  // Card stats
  cardsDrawn: CardKind[];
  banished: number;  // number of zombies banished by ghost cards
}

function simulateOneGame(zLevel: Level, sLevel: Level, mapSeed: number): GameResult {
  const map = generateMap(mapSeed);
  const state: State = newState(map);
  let totalMoves = 0;
  let safetyCounter = 0;
  const cardsDrawn: CardKind[] = [];
  let banished = 0;

  while (!state.winner && safetyCounter < 5000) {
    safetyCounter++;

    // pending card resolution (AI survivor stepped on a house)
    if (state.pendingCard) {
      const cardKind = state.pendingCard.kind;
      cardsDrawn.push(cardKind);
      
      // Track banishes: ghost before and after zombie count
      let preGhostZombies = 0;
      if (cardKind === "ghost") {
        preGhostZombies = state.pieces.filter((p) => p.side === "zombie").length;
      }
      
      const clicks = planCardResolution(state);
      for (const { r, c } of clicks) {
        if (state.winner) break;
        clickCell(state, r, c);
        totalMoves++;
      }
      
      if (cardKind === "ghost") {
        const postGhostZombies = state.pieces.filter((p) => p.side === "zombie").length;
        banished += preGhostZombies - postGhostZombies;
      }
      continue;
    }

    const side = state.turnSide;
    const level = side === "zombie" ? zLevel : sLevel;
    const clicks = planTurn(state, side, level);

    for (const { r, c } of clicks) {
      if (state.winner) break;
      clickCell(state, r, c);
      totalMoves++;
    }
  }

  const finalS = state.pieces.filter((p) => p.side === "survivor").length;
  const finalZ = state.pieces.filter((p) => p.side === "zombie").length;

  return {
    winner: state.winner ?? "draw",
    totalMoves,
    survivorKills: state.survivorKills,
    zombieKills: state.zombieKills,
    stalePlies: state.stalePlies,
    finalSurvivors: finalS,
    finalZombies: finalZ,
    cardsDrawn,
    banished,
  };
}

// ===== Run simulations =====
const GAMES = 100;
const configs: Array<{ name: string; z: Level; s: Level }> = [
  { name: "easy vs easy", z: "easy", s: "easy" },
  { name: "hard vs hard", z: "hard", s: "hard" },
  { name: "hard zombie vs easy survivor", z: "hard", s: "easy" },
  { name: "easy zombie vs hard survivor", z: "easy", s: "hard" },
];

for (const cfg of configs) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Config: ${cfg.name} (${GAMES} games)`);
  console.log(`${"═".repeat(60)}`);

  const results: GameResult[] = [];
  for (let i = 0; i < GAMES; i++) {
    const seed = (Date.now() ^ (i * 0x6d2b79f5)) >>> 0;
    results.push(simulateOneGame(cfg.z, cfg.s, seed));
  }

  // Win rates
  const sWins = results.filter((r) => r.winner === "survivor").length;
  const zWins = results.filter((r) => r.winner === "zombie").length;
  const draws = results.filter((r) => r.winner === "draw").length;

  console.log(`\n  Win Rates:`);
  console.log(`    幸存者: ${(sWins / GAMES * 100).toFixed(1)}% (${sWins}/${GAMES})`);
  console.log(`    僵  尸: ${(zWins / GAMES * 100).toFixed(1)}% (${zWins}/${GAMES})`);
  console.log(`    平  局: ${(draws / GAMES * 100).toFixed(1)}% (${draws}/${GAMES})`);

  // Move count stats
  const moves = results.map((r) => r.totalMoves);
  const avgMoves = moves.reduce((a, b) => a + b, 0) / moves.length;
  const minMoves = Math.min(...moves);
  const maxMoves = Math.max(...moves);

  console.log(`\n  Game Length: avg ${avgMoves.toFixed(1)}  min ${minMoves}  max ${maxMoves}`);

  // Card usage stats
  console.log(`\n  ─── Card Usage ───`);
  const totalCards = results.reduce((a, r) => a + r.cardsDrawn.length, 0);
  const gamesWithCards = results.filter((r) => r.cardsDrawn.length > 0).length;
  console.log(`    Total cards drawn: ${totalCards} in ${gamesWithCards}/${GAMES} games`);
  
  const cardCounts: Record<string, number> = {};
  for (const r of results) for (const c of r.cardsDrawn) cardCounts[c] = (cardCounts[c] || 0) + 1;
  for (const [card, count] of Object.entries(cardCounts)) {
    const name = card === "ghost" ? "鬼魂" : card === "shoes" ? "靴子" : "咖啡";
    console.log(`      ${name}: ${count}`);
  }
  
  const totalBanished = results.reduce((a, r) => a + r.banished, 0);
  console.log(`    Zombies banished by ghost: ${totalBanished} (${(totalBanished / GAMES).toFixed(1)} per game)`);

  // Score distribution
  const skDist = results.map((r) => r.survivorKills);
  const zkDist = results.map((r) => r.zombieKills);
  const avgSK = skDist.reduce((a, b) => a + b, 0) / skDist.length;
  const avgZK = zkDist.reduce((a, b) => a + b, 0) / zkDist.length;

  console.log(`\n  Avg Final Score: 幸存者 ${avgSK.toFixed(2)} / 僵尸 ${avgZK.toFixed(2)}`);

  // Kill score histogram
  console.log(`\n  幸存者得分分布:`);
  const skHist: Record<number, number> = {};
  for (const k of skDist) skHist[k] = (skHist[k] || 0) + 1;
  for (const k of Object.keys(skHist).map(Number).sort((a, b) => a - b)) {
    const bar = "█".repeat(skHist[k]);
    console.log(`    ${k}: ${bar} (${skHist[k]})`);
  }

  console.log(`\n  僵尸得分分布:`);
  const zkHist: Record<number, number> = {};
  for (const k of zkDist) zkHist[k] = (zkHist[k] || 0) + 1;
  for (const k of Object.keys(zkHist).map(Number).sort((a, b) => a - b)) {
    const bar = "█".repeat(zkHist[k]);
    console.log(`    ${k}: ${bar} (${zkHist[k]})`);
  }

  // Stalemate rate
  const stalemates = results.filter((r) => r.stalePlies >= 45).length;
  console.log(`\n  Stalemates (stalePlies >= 45): ${stalemates}/${GAMES} (${(stalemates / GAMES * 100).toFixed(1)}%)`);
}

console.log(`\n${"═".repeat(60)}`);
console.log("  Simulation complete.");
console.log(`${"═".repeat(60)}\n`);
