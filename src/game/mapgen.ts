import { BOARD, MapData, Terrain } from "./types";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ORTHO = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

function inBounds(r: number, c: number) {
  return r >= 0 && r < BOARD && c >= 0 && c < BOARD;
}

function neighbors(r: number, c: number) {
  const out: Array<[number, number]> = [];
  for (const [dr, dc] of ORTHO) {
    const nr = r + dr;
    const nc = c + dc;
    if (inBounds(nr, nc)) out.push([nr, nc]);
  }
  return out;
}

function houseCandidates() {
  const q = (rs: number[], cs: number[]) => {
    const out: Array<{ r: number; c: number }> = [];
    for (const r of rs) for (const c of cs) out.push({ r, c });
    return out;
  };
  return [
    q([1, 2], [1, 2]),
    q([1, 2], [5, 6]),
    q([5, 6], [1, 2]),
    q([5, 6], [5, 6]),
  ];
}

function bfsReachable(
  terrain: Terrain[][],
  start: { r: number; c: number },
): Set<string> {
  const seen = new Set<string>([`${start.r},${start.c}`]);
  const queue: Array<{ r: number; c: number }> = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [nr, nc] of neighbors(cur.r, cur.c)) {
      const k = `${nr},${nc}`;
      if (seen.has(k)) continue;
      if (terrain[nr][nc] === "stone") continue;
      seen.add(k);
      queue.push({ r: nr, c: nc });
    }
  }
  return seen;
}

function tryGenerate(seed: number, stoneRatio: number): MapData | null {
  const rand = rng(seed);
  const terrain: Terrain[][] = Array.from({ length: BOARD }, () =>
    Array<Terrain>(BOARD).fill("empty"),
  );

  const starts = [
    { r: 0, c: 0 },
    { r: 0, c: BOARD - 1 },
    { r: BOARD - 1, c: 0 },
    { r: BOARD - 1, c: BOARD - 1 },
  ];
  for (const s of starts) terrain[s.r][s.c] = "start";

  const houses: Array<{ r: number; c: number }> = [];
  const occupied = new Set<string>(starts.map((s) => `${s.r},${s.c}`));
  for (const cand of houseCandidates()) {
    const choices = cand.filter((p) => !occupied.has(`${p.r},${p.c}`));
    const h = pick(choices, rand);
    houses.push(h);
    occupied.add(`${h.r},${h.c}`);
    terrain[h.r][h.c] = "house";
  }

  const empties: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < BOARD; r++) {
    for (let c = 0; c < BOARD; c++) {
      if (!occupied.has(`${r},${c}`)) empties.push({ r, c });
    }
  }
  const stoneCount = Math.max(4, Math.round(empties.length * stoneRatio));
  const stones = shuffle(empties, rand).slice(0, stoneCount);
  for (const st of stones) terrain[st.r][st.c] = "stone";

  // Each START reaches every house and every other START via non-stone cells.
  for (const s of starts) {
    const reach = bfsReachable(terrain, s);
    for (const h of houses) {
      if (!reach.has(`${h.r},${h.c}`)) return null;
    }
    for (const s2 of starts) {
      if (s2 === s) continue;
      if (!reach.has(`${s2.r},${s2.c}`)) return null;
    }
  }

  // Each START must have at least 2 non-stone neighbors (for survivor to move).
  const stoneAt = (r: number, c: number) =>
    inBounds(r, c) && terrain[r][c] === "stone";
  const nonStoneNbrCount = (r: number, c: number) => {
    let n = 0;
    for (const [nr, nc] of neighbors(r, c)) if (!stoneAt(nr, nc)) n++;
    return n;
  };
  for (const s of starts) if (nonStoneNbrCount(s.r, s.c) < 2) return null;

  // Open-cell budget: must have enough room for at least 9 zombies + 4 survivors
  // plus headroom. Empties already excludes starts and houses; non-stone empties:
  const openCount = empties.length - stones.length;
  if (openCount < 9 + 4 + 6) return null;

  return { terrain, houses, starts };
}

export function generateMap(
  seed: number = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
): MapData {
  let s = seed >>> 0;
  for (const ratio of [0.18, 0.15, 0.12, 0.09, 0.06]) {
    for (let i = 0; i < 200; i++) {
      const m = tryGenerate(s + i, ratio);
      if (m) return m;
    }
    s = (s * 1103515245 + 12345) >>> 0;
  }
  throw new Error("mapgen: failed to produce a valid map");
}
