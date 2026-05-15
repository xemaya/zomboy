// 僵尸互斥 + 感染生成异地化 规则契约测试
// Run: npx tsx scripts/test_zombie_rules.ts
import type { State, Piece } from "../src/game/types";
import { zombieMayOccupy, legalMoves } from "../src/game/rules";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
}
function emptyTerrain() {
  return Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "empty"));
}
function mkState(pieces: Piece[], opts?: { reserve?: number; stones?: [number, number][] }): State {
  const terrain = emptyTerrain();
  for (const [r, c] of opts?.stones ?? []) terrain[r][c] = "stone";
  return {
    map: { terrain, houses: [], starts: [] },
    pieces: pieces.map((p) => ({ ...p })),
    housesConsumed: new Set(),
    zombieReserve: opts?.reserve ?? 9,
    survivorKills: 0, zombieKills: 0,
    turnSide: "zombie", turnNumber: 1,
    zombieTurn: { mode: null, movesLeft: 0 },
    deck: [], selectedPieceId: null, pendingCard: null,
    winner: null, killMark: 0, stalePlies: 0, log: [], flavor: "",
  } as unknown as State;
}
const Z = (id: string, r: number, c: number): Piece => ({ id, side: "zombie", r, c });
const S = (id: string, r: number, c: number): Piece => ({ id, side: "survivor", r, c });

console.log("zombieMayOccupy (S-1)");
{
  const st = mkState([Z("Z1", 4, 4)]);
  check("空格可占", zombieMayOccupy(st, 0, 0) === true);
  check("正交相邻另一僵尸 → 禁", zombieMayOccupy(st, 4, 5) === false);
  check("斜相邻另一僵尸 → 允许", zombieMayOccupy(st, 3, 5) === true);
  check("石头格 → 禁", zombieMayOccupy(mkState([], { stones: [[2, 2]] }), 2, 2) === false);
  check("界外 → 禁", zombieMayOccupy(st, -1, 0) === false && zombieMayOccupy(st, 8, 0) === false);
}
{
  const st = mkState([Z("Z1", 4, 4)]);
  check("ignoreId=自身则其原格相邻不算", zombieMayOccupy(st, 4, 5, "Z1") === true);
  check("被其他棋子占用 → 禁", zombieMayOccupy(mkState([S("S1", 3, 3)]), 3, 3) === false);
  check("与幸存者正交相邻不影响", zombieMayOccupy(mkState([S("S1", 4, 4)]), 4, 5) === true);
  check("ignoreId=自身时其本格视为可占(无冲突的 no-op 目标)", zombieMayOccupy(mkState([Z("Z1", 4, 4)]), 4, 4, "Z1") === true);
}

console.log("legalMoves 僵尸接入 R1");
{
  // Z1(4,4) 想动;Z2(4,6) 在场。Z1 不能走到 (4,5)(与 Z2 正交相邻),
  // 但可以走到 (3,4)/(5,4)/(4,3)。
  const st = mkState([Z("Z1", 4, 4), Z("Z2", 4, 6)]);
  const mv = legalMoves(st, st.pieces[0]).map((m) => `${m.r},${m.c}`);
  check("僵尸不可走到与另一僵尸正交相邻格", !mv.includes("4,5"));
  check("僵尸仍可走到不相邻的合法格", mv.includes("3,4") && mv.includes("4,3"));
  // 幸存者不受 R1 约束
  const st2 = mkState([S("S1", 4, 4), Z("Z1", 4, 6)]);
  const sm = legalMoves(st2, st2.pieces[0]).map((m) => `${m.r},${m.c}`);
  check("幸存者不受 R1 约束(可走到僵尸旁)", sm.includes("4,5"));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
