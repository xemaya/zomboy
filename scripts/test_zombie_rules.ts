// 僵尸互斥 + 感染生成异地化 规则契约测试
// Run: npx tsx scripts/test_zombie_rules.ts
import type { State, Piece } from "../src/game/types";
import { zombieMayOccupy, legalMoves, zombieHasAnyLegalAction, pickInfectionSpawn, runInfection, legalJumps } from "../src/game/rules";
import { planTurn } from "../src/game/ai";
import { zombieOffense } from "../src/game/ai";

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
  // 孤立僵尸:4 格都应合法(legalMoves 必须把 piece.id 当 ignoreId,否则自身原格会误阻塞)
  const st0 = mkState([Z("Z1", 4, 4)]);
  const mv0 = legalMoves(st0, st0.pieces[0]).map((m) => `${m.r},${m.c}`);
  check("孤立僵尸有 4 个合法格(自身不误阻塞)", mv0.length === 4);
}

console.log("zombieHasAnyLegalAction (R1.4 兜底)");
{
  // 有库存且存在合法召唤点 → true
  check("有合法召唤点 → true", zombieHasAnyLegalAction(mkState([Z("Z1", 4, 4)], { reserve: 5 })) === true);
  // 无库存,但有僵尸能动 → true
  check("无库存但能移动 → true", zombieHasAnyLegalAction(mkState([Z("Z1", 4, 4)], { reserve: 0 })) === true);
  // 无库存且唯一僵尸被石头封死 → false
  const boxed = mkState([Z("Z1", 0, 0)], {
    reserve: 0,
    stones: [[0, 1], [1, 0]],
  });
  check("无库存且无路可走 → false", zombieHasAnyLegalAction(boxed) === false);
}

console.log("召唤接入 R1 (AI enumerate)");
{
  // 仅 1 个空策略点会与现有僵尸正交相邻;AI 召唤不应选它。
  const st = mkState([Z("Z1", 0, 0), S("S1", 0, 2)], { reserve: 3 });
  st.turnSide = "zombie";
  let ok = true;
  let sawSummon = false;
  for (let i = 0; i < 60; i++) {
    const clicks = planTurn(st, "zombie", "easy");
    if (clicks.length === 1) {
      sawSummon = true;
      const { r, c } = clicks[0]; // 单点 = 召唤
      if (!zombieMayOccupy(st, r, c)) ok = false;
    }
  }
  check("AI 召唤落点恒满足 R1", ok);
  check("60 轮内至少触发一次召唤(覆盖性,非空测)", sawSummon);
}

console.log("pickInfectionSpawn (S-2)");
{
  const st = mkState([Z("Z1", 4, 3), Z("Z2", 4, 5), S("S1", 0, 0)]);
  const a = pickInfectionSpawn(st);
  const b = pickInfectionSpawn(mkState([Z("Z1", 4, 3), Z("Z2", 4, 5), S("S1", 0, 0)]));
  check("确定性:同输入同输出", a !== null && b !== null && a!.r === b!.r && a!.c === b!.c);
  check("结果满足 R1", a !== null && zombieMayOccupy(st, a!.r, a!.c) === true);
  check("取离最近幸存者最近 + (r,c) tie-break", a !== null && a!.r === 0 && a!.c === 1);
  check("无存活幸存者 → null", pickInfectionSpawn(mkState([Z("Z1", 4, 3)])) === null);
}

console.log("runInfection 接入 R2");
{
  // S1(4,4) 被 Z1(3,4)+Z2(5,4) 夹击(正交2) → 感染。
  // 新僵尸不应在 (4,4) 原地;应在离最近存活幸存者最近的合法点。
  const st = mkState([S("S1", 4, 4), S("S2", 0, 0), Z("Z1", 3, 4), Z("Z2", 5, 4)], { reserve: 9 });
  const log = runInfection(st);
  check("感染计分 +1", st.zombieKills === 1);
  check("被感染者已移除", !st.pieces.some((p) => p.id === "S1"));
  const spawned = st.pieces.find((p) => p.side === "zombie" && p.id !== "Z1" && p.id !== "Z2");
  check("生成了新僵尸", !!spawned);
  check("新僵尸不在原地 (4,4)", !!spawned && !(spawned!.r === 4 && spawned!.c === 4));
  check("新僵尸满足 R1", !!spawned && zombieMayOccupy({ ...st, pieces: st.pieces.filter((p) => p !== spawned) } as any, spawned!.r, spawned!.c));
  check("库存 -1", st.zombieReserve === 8);
  check("日志含生成坐标", log.some((l) => l.includes("生成")));
  // 无可用点 → 跳过生成、库存不减
  const st2 = mkState([S("S9", 4, 4), Z("Z1", 3, 4), Z("Z2", 5, 4)], { reserve: 1 });
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) st2.map.terrain[r][c] = "stone";
  const before = st2.zombieReserve;
  runInfection(st2);
  check("无可用点 → 跳过生成、库存不减", st2.zombieReserve === before && st2.zombieKills === 1);
  // R2.3 多感染(spec 正确版):S1、S2 同回合被夹感染,S3 始终存活未被感染。
  // 两次感染都有存活幸存者 → 都应生成;且后一次 pickInfectionSpawn 看到前一次
  // 已生成的僵尸,故两只新僵尸不同格、彼此不正交相邻(确定性,R2.3)。
  const st3 = mkState([
    S("S1", 0, 1), S("S2", 7, 1), S("S3", 4, 4),
    Z("Z1", 0, 0), Z("Z2", 0, 2),   // 夹 S1
    Z("Z3", 7, 0), Z("Z4", 7, 2),   // 夹 S2
  ], { reserve: 9 });
  runInfection(st3);
  const newZs = st3.pieces.filter(
    (p) => p.side === "zombie" && !["Z1", "Z2", "Z3", "Z4"].includes(p.id));
  check("R2.3 双感染各生成一只(S3 始终存活)", newZs.length === 2);
  check("R2.3 两只新僵尸不同格", !(newZs[0].r === newZs[1].r && newZs[0].c === newZs[1].c));
  const adj = Math.abs(newZs[0].r - newZs[1].r) + Math.abs(newZs[0].c - newZs[1].c) === 1;
  check("R2.3 两只新僵尸不正交相邻(R1 跨次保持)", newZs.length === 2 && !adj);
  check("R2.3 两次感染均计分", st3.zombieKills === 2);
  // 确定性:同输入重跑结果一致
  const st3b = mkState([
    S("S1", 0, 1), S("S2", 7, 1), S("S3", 4, 4),
    Z("Z1", 0, 0), Z("Z2", 0, 2), Z("Z3", 7, 0), Z("Z4", 7, 2),
  ], { reserve: 9 });
  runInfection(st3b);
  const newZsB = st3b.pieces.filter((p) => p.side === "zombie" && !["Z1","Z2","Z3","Z4"].includes(p.id));
  check("R2.3 确定性:多感染同输入同输出",
    newZs.length === newZsB.length &&
    newZs.every((z, i) => z.r === newZsB[i].r && z.c === newZsB[i].c));
}

console.log("S-3 R1 不阻挡任何合法感染阵型");
{
  // 幸存者在 (4,4);6 种"2 僵尸正交夹击"配对,两僵尸均须满足 zombieMayOccupy。
  const pairs: [[number, number], [number, number]][] = [
    [[3, 4], [5, 4]], // N+S
    [[4, 3], [4, 5]], // W+E
    [[3, 4], [4, 5]], // N+E
    [[3, 4], [4, 3]], // N+W
    [[5, 4], [4, 5]], // S+E
    [[5, 4], [4, 3]], // S+W
  ];
  let allOk = true;
  for (const [[ar, ac], [br, bc]] of pairs) {
    const st = mkState([S("S1", 4, 4), Z("ZA", ar, ac)]);
    if (!zombieMayOccupy(st, br, bc)) allOk = false;
    const st2 = mkState([S("S1", 4, 4), Z("ZB", br, bc)]);
    if (!zombieMayOccupy(st2, ar, ac)) allOk = false;
  }
  check("6 种感染阵型 R1 全不阻挡(G-B 守卫)", allOk);
}

console.log("S-4 贴边墙不再免疫(G-A 守卫)");
{
  // 真正的回归守卫:R1 必须禁止"密集贴边"——(0,0)、(2,0) 有僵尸时,
  // (1,0) 不可再放僵尸,故连续实心贴边列无法形成。若 R1 被移除,
  // zombieMayOccupy 会返回 true,此断言失败 → 守住核心目标。
  const contiguous = mkState([Z("Z1", 0, 0), Z("Z2", 2, 0)]);
  check("R1 禁止密集贴边(移除 R1 则此断言失败)", zombieMayOccupy(contiguous, 1, 0) === false);

  // 在 R1 允许的"棋盘格"贴边布局下,幸存者能真的跳杀掉边列僵尸:
  // S1(1,0) 向南跨过 Z2(2,0) 落 (3,0)。精确钉死跳杀目标与落点。
  const st = mkState([
    Z("Z1", 0, 0), Z("Z2", 2, 0), Z("Z3", 4, 0),
    S("S1", 1, 0),
  ]);
  const jumps = legalJumps(st, st.pieces.find((p) => p.id === "S1")!);
  const exact = jumps.some(
    (j) => j.killR === 2 && j.killC === 0 && j.destR === 3 && j.destC === 0,
  );
  check("间隔贴边墙可被精确跳杀(杀(2,0)落(3,0))", exact);
}

console.log("zombieHasAnyLegalAction 补充分支(reserve>0 但无合法召唤、僵尸仍可动 → true)");
{
  // 全棋盘石头,只留 Z1 与一个相邻空格 B:
  //  - 所有空格(仅 B)都与 Z1 正交相邻 → 无任何合法召唤点(summon 子句假)
  //  - 但 Z1 能走到 B(legalMoves 子句真)→ 整体应为 true
  const st = mkState([Z("Z1", 0, 0)], { reserve: 4 });
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) st.map.terrain[r][c] = "stone";
  st.map.terrain[0][0] = "empty"; // Z1 本格
  st.map.terrain[0][1] = "empty"; // 唯一空格 B,正交相邻 Z1
  // 自检:无合法召唤点(B 与 Z1 正交相邻 → zombieMayOccupy 假)
  check("构造:无任何合法召唤点", zombieMayOccupy(st, 0, 1) === false);
  // Z1 仍可走到 B
  check("构造:Z1 可移动到 B", legalMoves(st, st.pieces[0]).some((m) => m.r === 0 && m.c === 1));
  check("reserve>0 无召唤但能动 → true", zombieHasAnyLegalAction(st) === true);
}

console.log("zombieOffense(进攻偏置,单调性)");
{
  const far = mkState([S("S1", 4, 4), Z("Z1", 0, 0)]);
  const adj = mkState([S("S1", 4, 4), Z("Z1", 3, 4)]); // 正交贴住
  check("贴住比远离进攻分高", zombieOffense(adj) > zombieOffense(far));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
