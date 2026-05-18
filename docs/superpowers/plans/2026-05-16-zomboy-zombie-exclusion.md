# 僵尸互斥 + 感染生成异地化 + AI 不胆小 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 破除"不可摧贴边墙"规则缺陷——僵尸不得正交相邻(移动/召唤/感染生成)、感染生成异地化(靠最近存活幸存者、确定性选点),并配套 AI 进攻 retune 使整体平衡仍健康。

**Architecture:** 在 `rules.ts` 加纯函数 `zombieMayOccupy` 作单一约束源,`legalMoves`(僵尸)/召唤/`runInfection` 全部接它;`pickInfectionSpawn` 确定性选生成点;`ai.ts` 的 `enumerateZombie`/`simulate` 走同函数自动继承;新增 `zombieOffense` + 调 `killable` 惩罚补偿削弱,用 `scripts/simulate.ts` harness 调到验收门槛。

**Tech Stack:** Vite + TypeScript(无框架);测试 = 独立 `npx tsx scripts/test_*.ts` 脚本(沿用 `test_card_modal.ts` 模式,失败 `process.exit(1)`);平衡 harness = `npx tsx scripts/simulate.ts`。

**Spec:** `docs/superpowers/specs/2026-05-16-zomboy-zombie-exclusion-design.md`(R1/R2/S-1..S-4/G1..G5)。

---

### Task 1: `zombieMayOccupy` 单一约束谓词 (S-1)

**Files:**
- Modify: `src/game/rules.ts`(在 `emptyCells` 之后新增导出函数)
- Test: `scripts/test_zombie_rules.ts`(新建)

- [ ] **Step 1: 写失败测试**

新建 `scripts/test_zombie_rules.ts`:

```ts
// 僵尸互斥 + 感染生成异地化 规则契约测试
// Run: npx tsx scripts/test_zombie_rules.ts
import type { State, Piece } from "../src/game/types";
import { zombieMayOccupy } from "../src/game/rules";

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
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: FAIL — `zombieMayOccupy` 未从 rules.ts 导出(import/类型错误或断言失败)。

- [ ] **Step 3: 实现**

在 `src/game/rules.ts` 中 `emptyCells` 函数之后插入:

```ts
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
  if (occ && occ.id !== ignoreId) return false;
  for (const [dr, dc] of ORTHO) {
    const n = pieceAt(state, r + dr, c + dc);
    if (n && n.side === "zombie" && n.id !== ignoreId) return false;
  }
  return true;
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: PASS — `ALL PASS`，exit 0。

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit`
Expected: 无输出(干净)。

- [ ] **Step 6: Commit**

```bash
git add src/game/rules.ts scripts/test_zombie_rules.ts
git commit -m "feat(rules): zombieMayOccupy — R1 单一约束谓词 + 契约测试"
```

---

### Task 2: `legalMoves` 僵尸接入 R1

**Files:**
- Modify: `src/game/rules.ts:30-42`(`legalMoves`)
- Test: `scripts/test_zombie_rules.ts`(追加一节)

- [ ] **Step 1: 追加失败测试**

在 `scripts/test_zombie_rules.ts` 的 `console.log(failures === 0 ...)` 之前插入:

```ts
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
```

并把测试文件顶部 import 改为同时引入 `legalMoves`:

```ts
import { zombieMayOccupy, legalMoves } from "../src/game/rules";
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: FAIL — `僵尸不可走到与另一僵尸正交相邻格` 断言失败(当前 legalMoves 未接 R1)。

- [ ] **Step 3: 实现**

把 `src/game/rules.ts` 的 `legalMoves` 改为(在原有过滤后,对僵尸追加 R1 判定):

```ts
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
```

> `zombieMayOccupy` 在同文件已定义于 `legalMoves` 之后;函数提升使前向引用合法(运行时调用时已定义)。无需移动定义。

- [ ] **Step 4: 运行,确认通过**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: PASS — `ALL PASS`。

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit`
Expected: 干净。

- [ ] **Step 6: Commit**

```bash
git add src/game/rules.ts scripts/test_zombie_rules.ts
git commit -m "feat(rules): legalMoves 僵尸接入 R1(不得正交相邻)"
```

---

### Task 3: `zombieHasAnyLegalAction`(死锁兜底基元)

**Files:**
- Modify: `src/game/rules.ts`(在 `zombieMayOccupy` 之后新增)
- Test: `scripts/test_zombie_rules.ts`(追加一节)

- [ ] **Step 1: 追加失败测试**

测试文件 import 行改为:

```ts
import { zombieMayOccupy, legalMoves, zombieHasAnyLegalAction } from "../src/game/rules";
```

在末尾汇总行前追加:

```ts
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
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: FAIL — `zombieHasAnyLegalAction` 未导出。

- [ ] **Step 3: 实现**

在 `src/game/rules.ts` 的 `zombieMayOccupy` 之后插入:

```ts
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
```

- [ ] **Step 4: 运行,确认通过**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: PASS。

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit`
Expected: 干净。

- [ ] **Step 6: Commit**

```bash
git add src/game/rules.ts scripts/test_zombie_rules.ts
git commit -m "feat(rules): zombieHasAnyLegalAction — R1.4 死锁兜底基元"
```

---

### Task 4: 召唤接入 R1(state.ts 人玩 + ai.ts AI)

**Files:**
- Modify: `src/game/state.ts`(import + `handleZombieClick` 召唤分支,约 296-305 行)
- Modify: `src/game/ai.ts`(import + `enumerateZombie` summon 候选,约 106-118 行)
- Test: `scripts/test_zombie_rules.ts`(追加一节,验证 AI 召唤候选过滤)

- [ ] **Step 1: 追加失败测试**

测试文件追加(新 import 用相对子模块,避免引入 main.ts 的 DOM 副作用):

在 import 区追加:

```ts
import { planTurn } from "../src/game/ai";
```

在汇总行前追加:

```ts
console.log("召唤接入 R1 (AI enumerate)");
{
  // 仅 1 个空策略点会与现有僵尸正交相邻;AI 召唤不应选它。
  // 构造:Z1(0,0);四周布置使 (0,1)(1,0) 与 Z1 正交相邻属非法召唤。
  const st = mkState([Z("Z1", 0, 0), S("S1", 0, 2)], { reserve: 3 });
  st.turnSide = "zombie";
  // 跑若干次,任何一次 AI 的召唤落点都必须满足 R1
  let ok = true;
  for (let i = 0; i < 30; i++) {
    const clicks = planTurn(st, "zombie", "easy");
    if (clicks.length === 1) {
      const { r, c } = clicks[0]; // 单点 = 召唤
      if (!zombieMayOccupy(st, r, c)) ok = false;
    }
  }
  check("AI 召唤落点恒满足 R1", ok);
}
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: FAIL — 现 `enumerateZombie` 召唤候选用裸 `emptyCells`,会产出违反 R1 的落点。

- [ ] **Step 3a: 实现 ai.ts 召唤过滤**

`src/game/ai.ts` 顶部 import 增加 `zombieMayOccupy`:

```ts
import {
  legalMoves,
  legalJumps,
  emptyCells,
  pieceAt,
  pieceById,
  runInfection,
  zombieMayOccupy,
  ORTHO,
} from "./rules";
```

把 `enumerateZombie` 召唤分支(当前):

```ts
  if (s.zombieReserve > 0) {
    for (const e of empties) if (near(e.r, e.c, 4)) out.push({ kind: "summon", r: e.r, c: e.c });
    if (out.length === 0) for (const e of empties) out.push({ kind: "summon", r: e.r, c: e.c });
  }
```

改为:

```ts
  if (s.zombieReserve > 0) {
    const placeable = empties.filter((e) => zombieMayOccupy(s, e.r, e.c));
    for (const e of placeable) if (near(e.r, e.c, 4)) out.push({ kind: "summon", r: e.r, c: e.c });
    if (out.length === 0) for (const e of placeable) out.push({ kind: "summon", r: e.r, c: e.c });
  }
```

- [ ] **Step 3b: 实现 state.ts 召唤门禁(人玩)**

`src/game/state.ts` 顶部 import(从 "./rules")增加 `zombieMayOccupy`(并入现有 import 列表)。

把 `handleZombieClick` 末尾召唤分支(当前):

```ts
  if (state.zombieReserve > 0) {
    const id = nextZombieId(state);
    state.pieces.push({ id, side: "zombie", r, c });
    state.zombieReserve -= 1;
    state.log.push(`召唤 ${id} 到 (${r},${c})（库存剩 ${state.zombieReserve}）`);
    setFlavor(state, "summon");
    endZombieTurn(state);
  }
```

改为:

```ts
  if (state.zombieReserve > 0) {
    if (!zombieMayOccupy(state, r, c)) return; // R1: 不可贴另一僵尸召唤
    const id = nextZombieId(state);
    state.pieces.push({ id, side: "zombie", r, c });
    state.zombieReserve -= 1;
    state.log.push(`召唤 ${id} 到 (${r},${c})（库存剩 ${state.zombieReserve}）`);
    setFlavor(state, "summon");
    endZombieTurn(state);
  }
```

- [ ] **Step 4: 运行,确认通过**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + 既有测试不回归**

Run: `npx tsc --noEmit && npx tsx scripts/test_card_modal.ts && npx tsx scripts/test_start_menu.ts`
Expected: tsc 干净;两套既有测试 `ALL PASS`。

- [ ] **Step 6: Commit**

```bash
git add src/game/state.ts src/game/ai.ts scripts/test_zombie_rules.ts
git commit -m "feat(rules): 召唤接入 R1(state 人玩门禁 + ai 候选过滤)"
```

---

### Task 5: `pickInfectionSpawn` 确定性选点 (S-2)

**Files:**
- Modify: `src/game/rules.ts`(在 `zombieHasAnyLegalAction` 之后新增)
- Test: `scripts/test_zombie_rules.ts`(追加一节)

- [ ] **Step 1: 追加失败测试**

import 行改为:

```ts
import { zombieMayOccupy, legalMoves, zombieHasAnyLegalAction, pickInfectionSpawn } from "../src/game/rules";
```

在汇总行前追加:

```ts
console.log("pickInfectionSpawn (S-2)");
{
  // 状态:已移除被感染者后的局面。施感染僵尸 Z1(4,3) Z2(4,5),
  // 幸存者 S1(0,0)。可用点须满足 R1 且离最近存活幸存者最近。
  const st = mkState([Z("Z1", 4, 3), Z("Z2", 4, 5), S("S1", 0, 0)]);
  const a = pickInfectionSpawn(st);
  const b = pickInfectionSpawn(mkState([Z("Z1", 4, 3), Z("Z2", 4, 5), S("S1", 0, 0)]));
  check("确定性:同输入同输出", a !== null && b !== null && a!.r === b!.r && a!.c === b!.c);
  check("结果满足 R1", a !== null && zombieMayOccupy(st, a!.r, a!.c) === true);
  // 离 S1(0,0) 最近的合法点应为 (0,0) 附近;(0,0) 被占,(0,1)/(1,0) 空且不邻僵尸 → 取 (0,1)((r,c) 字典序最小)
  check("取离最近幸存者最近 + (r,c) tie-break", a !== null && a!.r === 0 && a!.c === 1);
  // 无存活幸存者 → null
  check("无存活幸存者 → null", pickInfectionSpawn(mkState([Z("Z1", 4, 3)])) === null);
}
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: FAIL — `pickInfectionSpawn` 未导出。

- [ ] **Step 3: 实现**

在 `src/game/rules.ts` 的 `zombieHasAnyLegalAction` 之后插入:

```ts
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
```

- [ ] **Step 4: 运行,确认通过**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: PASS。

- [ ] **Step 5: typecheck**

Run: `npx tsc --noEmit`
Expected: 干净。

- [ ] **Step 6: Commit**

```bash
git add src/game/rules.ts scripts/test_zombie_rules.ts
git commit -m "feat(rules): pickInfectionSpawn — R2 确定性选点 + 契约测试"
```

---

### Task 6: `runInfection` 接入 R2(感染生成异地化)

**Files:**
- Modify: `src/game/rules.ts:87-111`(`runInfection`)
- Test: `scripts/test_zombie_rules.ts`(追加一节)

- [ ] **Step 1: 追加失败测试**

import 行改为:

```ts
import { zombieMayOccupy, legalMoves, zombieHasAnyLegalAction, pickInfectionSpawn, runInfection } from "../src/game/rules";
```

在汇总行前追加:

```ts
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
  const st2 = mkState([S("S9", 4, 4), Z("Z1", 3, 4), Z("Z2", 5, 4)], { reserve: 1, stones: [] });
  // 用石头铺满除施感染僵尸/幸存者外的全部格,制造"无可用点"
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) st2.map.terrain[r][c] = "stone";
  // 保留参与者所在格非石头(石头判定只影响空格候选)
  const before = st2.zombieReserve;
  runInfection(st2);
  check("无可用点 → 跳过生成、库存不减", st2.zombieReserve === before && st2.zombieKills === 1);
}
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: FAIL — 现 `runInfection` 在原地 `(p.r,p.c)` 生成,`新僵尸不在原地` 断言失败。

- [ ] **Step 3: 实现**

把 `src/game/rules.ts` 的 `runInfection` 中 spawn 块(当前):

```ts
    if (state.zombieReserve > 0) {
      state.zombieReserve -= 1;
      const newId = nextZombieId(state);
      state.pieces.push({ id: newId, side: "zombie", r: p.r, c: p.c });
      log.push(`新僵尸 ${newId} 在原地生成（库存剩 ${state.zombieReserve}）`);
    }
```

改为:

```ts
    if (state.zombieReserve > 0) {
      const spot = pickInfectionSpawn(state); // R2: 异地化、确定性
      if (spot) {
        state.zombieReserve -= 1;
        const newId = nextZombieId(state);
        state.pieces.push({ id: newId, side: "zombie", r: spot.r, c: spot.c });
        log.push(`新僵尸 ${newId} 在 (${spot.r},${spot.c}) 生成（库存剩 ${state.zombieReserve}）`);
      } else {
        log.push(`无可用点，本次感染未生成新僵尸`);
      }
    }
```

> `pickInfectionSpawn` 在 `runInfection` 上方已定义;调用合法。`state.pieces` 在本次 `state.pieces.filter(...)` 后已移除当前被感染者,故 `pickInfectionSpawn` 看到的"存活幸存者"正确;施感染僵尸仍在场,R1 自动避开其相邻格。多重感染逐个结算,后者反映前者结果(spec R2.3)。

- [ ] **Step 4: 运行,确认通过**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + 既有测试**

Run: `npx tsc --noEmit && npx tsx scripts/test_card_modal.ts && npx tsx scripts/test_start_menu.ts`
Expected: 干净 + 两套 `ALL PASS`。

- [ ] **Step 6: Commit**

```bash
git add src/game/rules.ts scripts/test_zombie_rules.ts
git commit -m "feat(rules): runInfection 接入 R2(感染生成异地化)"
```

---

### Task 7: 不变量回归守卫 — S-3(不破坏感染) + S-4(破墙)

**Files:**
- Test: `scripts/test_zombie_rules.ts`(追加两节,纯断言,无生产代码改动)

- [ ] **Step 1: 追加测试 S-3 + S-4**

import 行改为(加入 `legalJumps`):

```ts
import { zombieMayOccupy, legalMoves, zombieHasAnyLegalAction, pickInfectionSpawn, runInfection, legalJumps } from "../src/game/rules";
```

在汇总行前追加:

```ts
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
    // 先放 A,再验证 B 可占(R1 不应阻挡)
    const st = mkState([S("S1", 4, 4), Z("ZA", ar, ac)]);
    if (!zombieMayOccupy(st, br, bc)) allOk = false;
    // 反向同理
    const st2 = mkState([S("S1", 4, 4), Z("ZB", br, bc)]);
    if (!zombieMayOccupy(st2, ar, ac)) allOk = false;
  }
  check("6 种感染阵型 R1 全不阻挡(G-B 守卫)", allOk);
}

console.log("S-4 贴边墙不再免疫(G-A 守卫)");
{
  // R1 下贴边列只能成棋盘格:Z 在 (0,0)(2,0)(4,0),奇数行空。
  // 幸存者站墙列空格 (1,0),向南可跳杀 (2,0) 落 (3,0)。
  const st = mkState([
    Z("Z1", 0, 0), Z("Z2", 2, 0), Z("Z3", 4, 0),
    S("S1", 1, 0),
  ]);
  const jumps = legalJumps(st, st.pieces.find((p) => p.id === "S1")!);
  const killsCol0 = jumps.some((j) => j.killC === 0);
  check("间隔贴边墙可被跳杀", killsCol0);
  // 反证:连续实心贴边(R1 本就禁止形成)若出现亦无解 —— 仅作对照说明,不强求
}
```

- [ ] **Step 2: 运行,确认通过**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: PASS（S-3、S-4 均 ✓;这两节验证前序实现的不变量,应直接通过)。

> 若 S-3 失败 → R1 实现错误地阻挡了合法感染,必须回到 Task 1/2 修正。若 S-4 失败 → 破墙目标未达成,回查 R1 接入。

- [ ] **Step 3: Commit**

```bash
git add scripts/test_zombie_rules.ts
git commit -m "test(rules): S-3 感染不变量 + S-4 破墙 回归守卫"
```

---

### Task 8: 死锁兜底接入 main.ts(AI 不死循环)

**Files:**
- Modify: `src/game/state.ts`(导出 `endZombieTurnNow`)
- Modify: `src/main.ts`(`aiFallbackEndZombie` 遵守 R1 + 无合法手安全结束)

- [ ] **Step 1: 导出安全结束回合的入口**

`src/game/state.ts` 中 `endZombieTurn` 为内部函数。在其后新增导出包装:

```ts
// Exposed so the AI driver can safely end a (pathologically) stuck zombie
// turn instead of looping. Mirrors endZombieTurn.
export function endZombieTurnNow(state: State): void {
  endZombieTurn(state);
}
```

- [ ] **Step 2: 改 `aiFallbackEndZombie` 遵守 R1 + 兜底**

`src/main.ts` 顶部 import 增加:

```ts
import { emptyCells, legalMoves, zombieMayOccupy, zombieHasAnyLegalAction } from "./game/rules";
import { clickCell, newState, endZombieTurnNow } from "./game/state";
```

> 注:把 `zombieMayOccupy, zombieHasAnyLegalAction` 并入现有 `./game/rules` 的 import;把 `endZombieTurnNow` 并入现有 `./game/state` 的 import。不要新增重复 import 行。

把 `src/main.ts` 的 `aiFallbackEndZombie`(当前)整体替换为:

```ts
function aiFallbackEndZombie() {
  if (!zombieHasAnyLegalAction(state)) { endZombieTurnNow(state); return; }
  const empties = emptyCells(state).filter((e) => zombieMayOccupy(state, e.r, e.c));
  if (state.zombieReserve > 0 && empties.length) {
    clickCell(state, empties[0].r, empties[0].c);
    return;
  }
  const zs = state.pieces.filter((p) => p.side === "zombie");
  for (const z of zs) {
    const m = legalMoves(state, z);
    if (m.length >= 1) {
      clickCell(state, z.r, z.c);
      clickCell(state, m[0].r, m[0].c);
      const z2 = state.pieces.find((p) => p.id === z.id)!;
      const m2 = legalMoves(state, z2);
      if (m2.length) clickCell(state, m2[0].r, m2[0].c);
      if (state.turnSide !== "zombie") return;
    }
  }
  // 仍未结束(理论上 zombieHasAnyLegalAction 已保证有手;防御性收尾)
  if (state.turnSide === "zombie") endZombieTurnNow(state);
}
```

- [ ] **Step 3: typecheck + 全测试不回归**

Run: `npx tsc --noEmit && npx tsx scripts/test_zombie_rules.ts && npx tsx scripts/test_card_modal.ts && npx tsx scripts/test_start_menu.ts`
Expected: tsc 干净;三套测试全 `ALL PASS`。

- [ ] **Step 4: 浏览器冒烟(无死循环 / 无报错)**

Run: `npx vite --port 1424`(后台),浏览器开 `http://127.0.0.1:1424/?aiai`,选 AI 对战开局,观察 ≥30 秒:对局推进、无卡死、控制台 0 报错。停服。
Expected: AI-vs-AI 正常推进到分出胜负或推进若干回合,无 freeze、无 error。

- [ ] **Step 5: Commit**

```bash
git add src/game/state.ts src/main.ts
git commit -m "feat(ai): 死锁兜底接入 — aiFallbackEndZombie 遵守 R1 且无合法手安全结束"
```

---

### Task 9: AI 进攻 retune(zombieOffense + 削 killable 惩罚)

**Files:**
- Modify: `src/game/ai.ts`(新增 `zombieOffense`;改 `scoreAction`;改 `zombieScore` 的 killable 项)
- Test: `scripts/test_zombie_rules.ts`(追加 `zombieOffense` 纯单元)

- [ ] **Step 1: 追加失败测试(zombieOffense 单调性)**

import 行追加:

```ts
import { zombieOffense } from "../src/game/ai";
```

在汇总行前追加:

```ts
console.log("zombieOffense(进攻偏置,单调性)");
{
  // 同一幸存者:1 只正交贴住 应比 0 只贴住 得分高;压缩幸存者活动空间应加分。
  const far = mkState([S("S1", 4, 4), Z("Z1", 0, 0)]);
  const adj = mkState([S("S1", 4, 4), Z("Z1", 3, 4)]); // 正交贴住
  check("贴住比远离进攻分高", zombieOffense(adj) > zombieOffense(far));
}
```

- [ ] **Step 2: 运行,确认失败**

Run: `npx tsx scripts/test_zombie_rules.ts`
Expected: FAIL — `zombieOffense` 未导出。

- [ ] **Step 3: 实现 zombieOffense + 接 scoreAction + 削 killable**

`src/game/ai.ts`,在 `survivorOffense` 函数之后新增(起始权重为调参起点,后续 Task 10 按 harness 调整):

```ts
// Zombie aggression bias — mirror of survivorOffense. Applied AFTER the hard
// worst-case so the zombie commits to pincers / suffocation instead of hovering
// at distance 2. Starting weights; tuned to the harness gates in the next task.
export function zombieOffense(s: State): number {
  let b = 0;
  const zs = zombies(s);
  for (const sv of survivors(s)) {
    let ortho = 0;
    for (const [dr, dc] of ORTHO) {
      const p = pieceAt(s, sv.r + dr, sv.c + dc);
      if (p && p.side === "zombie") ortho++;
    }
    if (ortho === 1) b += 80;   // one ortho zombie = one step from infection
    if (ortho >= 2) b += 140;   // about to infect
    // suffocation: fewer escape squares for the survivor is good
    b += (8 - legalMoves(s, sv).length) * 6;
    // commit: zombies near the survivor (engage, don't hover)
    let near = 0;
    for (const z of zs) if (manhattan(z, sv) <= 2) near++;
    b += near * 14;
    // herd to wall/corner
    const edge = sv.r === 0 || sv.r === 7 || sv.c === 0 || sv.c === 7;
    const corner = (sv.r === 0 || sv.r === 7) && (sv.c === 0 || sv.c === 7);
    b += corner ? 36 : edge ? 16 : 0;
  }
  return b;
}
```

把 `zombieScore` 中:

```ts
  v += -killable.size * 160;
```

改为(对"有用的可跳杀僵尸"——本身正交贴住某幸存者者——惩罚减半,接受拼交换):

```ts
  let usefulKillable = 0;
  for (const sv of ss) {
    for (const [dr, dc] of ORTHO) {
      const p = pieceAt(s, sv.r + dr, sv.c + dc);
      if (p && p.side === "zombie" && killable.has(p.id)) usefulKillable++;
    }
  }
  // a killable zombie that is itself pincering a survivor is a fair trade
  // (lose 1 to set up an infection); only "useless" exposure stays harsh.
  v += -(killable.size - usefulKillable) * 160 - usefulKillable * 60;
```

把 `scoreAction` 中 hard 分支末尾:

```ts
    // aggression bias is a property of OUR move, applied after the worst-case
    if (side === "survivor") sc += survivorOffense(after);
```

改为:

```ts
    // aggression bias is a property of OUR move, applied after the worst-case
    if (side === "survivor") sc += survivorOffense(after);
    else sc += zombieOffense(after);
```

- [ ] **Step 4: 运行,确认通过 + typecheck + 不回归**

Run: `npx tsc --noEmit && npx tsx scripts/test_zombie_rules.ts && npx tsx scripts/test_card_modal.ts && npx tsx scripts/test_start_menu.ts`
Expected: tsc 干净;三套测试全 `ALL PASS`。

- [ ] **Step 5: Commit**

```bash
git add src/game/ai.ts scripts/test_zombie_rules.ts
git commit -m "feat(ai): zombieOffense 进攻偏置 + 削过强 killable 惩罚(起始权重)"
```

---

### Task 10: harness 验收门槛 G1–G4(测量 + 调参循环)

**Files:**
- Modify: `src/game/ai.ts`(仅按需微调 `zombieOffense`/killable 权重常数)

- [ ] **Step 1: 记录改前基线**

`git stash` 不可行(改动已提交)。改为:`git log` 找到本计划首个 commit 之前的 SHA(`fb49ad6` 之后、本计划 Task1 之前),`git worktree add /tmp/zomboy-base <那个SHA>`,在该 worktree 跑 `npx tsx scripts/simulate.ts`,记录 easy/easy 与 hard/hard 的:幸存者胜率、平局率、Stalemates 比例。写进 `docs/superpowers/plans/2026-05-16-zomboy-zombie-exclusion.md` 末尾"基线"小节。完成后 `git worktree remove /tmp/zomboy-base`。

- [ ] **Step 2: 跑当前实现的 harness**

Run: `npx tsx scripts/simulate.ts`
记录:easy/easy 幸存者胜率、各配置平局率、`Stalemates (stalePlies >= 45)` 比例。

- [ ] **Step 3: 对照门槛判定**

逐条核对(spec §6):
- **G1**:`easy/easy` 幸存者胜率 ∈ [45%,55%] 且任一侧 ≤60%。
- **G2**:`easy/easy` 与 `hard/hard` 平局/僵局率**严格 < Step 1 基线**。
- **G3**:任一配置 zombieKills 分布非全 0(感染仍可达)。
- **G4**:S-4 测试 PASS(已在 Task 7)。

- [ ] **Step 4: 未达标则调参(单变量,逐次)**

仅调 `src/game/ai.ts` 中 `zombieOffense` 的权重常数与 `usefulKillable` 的 `-60`/`-160`:
- 幸存者胜率 >55%(僵尸太弱)→ 调高 `zombieOffense` 的 `ortho===1`(80→100)/`ortho>=2`(140→180)/`near*14`(→18);或把 `usefulKillable` 罚分 `-60`→`-40`。
- 幸存者胜率 <45%(僵尸过强)→ 反向回调。
- 平局率未降 → 调高 `suffocation`(`*6`→`*9`)与 `corner/edge` 项(逼迫收口、减少干耗)。
每次只改一个常数,重跑 Step 2–3,直到 G1–G3 全绿。

- [ ] **Step 5: 调参收敛后提交**

```bash
git add src/game/ai.ts
git commit -m "balance(ai): 调 zombieOffense/killable 权重至 harness 门槛 G1-G3 全绿"
```

- [ ] **Step 6: 若 ≥8 次迭代仍无法同时满足 G1+G2 → 升级用户决策**

不要无限调参或牺牲一项硬塞。停下,把"当前最佳数字 + 各项 trade-off + 2 个可选方向(如:接受 hard 略偏僵尸 / 进一步软化某规则)"用 `AskUserQuestion` 给用户定(遵循 [[feedback-balance-quantify]]:报真实数字、feel 决策给用户)。

---

### Task 11: 文档落定 + 全量验证收尾

**Files:**
- Modify: `CLAUDE.md`(平衡裁决章追加 R1/R2)
- Modify: `docs/superpowers/plans/2026-05-16-zomboy-zombie-exclusion.md`(填基线/最终数字)

- [ ] **Step 1: CLAUDE.md 追加裁决**

在 `CLAUDE.md` 的 `## 平衡裁决(有意为之,**不要回退**)` 列表末尾追加两条:

```markdown
- **僵尸互斥 (R1)**:僵尸经移动/召唤/感染生成都不得占据与另一僵尸正交相邻的格。破"不可摧贴边墙"规则缺陷(满列边墙 100% 免疫跳杀 → 强制平局)。不破坏感染(夹同一幸存者的 2 僵尸恒非正交相邻)。
- **感染生成异地化 (R2)**:被感染者不在原地复活僵尸,改在"离最近存活幸存者最近的 R1-合法点"确定性生成;无可用点则跳过。配套 `ai.ts` zombieOffense 进攻偏置补偿(harness 调至 easy/easy ~50:50、僵局率低于基线)。改这些前先看 `docs/superpowers/specs/2026-05-16-zomboy-zombie-exclusion-design.md`。
```

- [ ] **Step 2: 全量验证(verification-before-completion)**

Run: `npx tsc --noEmit && npx tsx scripts/test_zombie_rules.ts && npx tsx scripts/test_card_modal.ts && npx tsx scripts/test_start_menu.ts && npx vite build`
Expected: tsc 干净;三套测试全 `ALL PASS`;build 成功。

- [ ] **Step 3: 把基线与最终 harness 数字写入本 plan 文件末尾**

在本文件末尾追加"## 实测数字"小节,列出:基线 vs 最终的 easy/easy 胜率、平局率、Stalemates 比例,证明 G1/G2 达成(真实数字,不写主观判断)。

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-05-16-zomboy-zombie-exclusion.md
git commit -m "docs: CLAUDE.md 平衡裁决追加 R1/R2 + plan 实测数字收尾"
```

- [ ] **Step 5: 部署/推送门(对外动作,需用户确认)**

不要自动部署或 push。汇总改动 + 最终 harness 数字,询问用户是否(a)部署上线(走 OPS.local.md 流程,收尾吊销临时 key)+(b)推 GitHub。等用户决定。

---

## Self-Review

**Spec coverage**:R1 → Task1/2/4;R1.4 死锁 → Task3/8;R2 → Task5/6;R2 多重感染顺序 → Task6 实现说明;S-1 → Task1;S-2 → Task5;S-3 → Task7;S-4 → Task7;§7 AI retune → Task9;G1–G5 → Task10/11;CLAUDE.md 裁决 → Task11。无遗漏。

**Placeholder scan**:无 TBD/TODO;AI 权重为"起始值 + 明确测量调参程序 + 升级条款",非占位;每个代码步给出完整代码与确切命令/期望。

**Type consistency**:`zombieMayOccupy(state,r,c,ignoreId?)`、`zombieHasAnyLegalAction(state)`、`pickInfectionSpawn(state):{r,c}|null`、`zombieOffense(state):number`、`endZombieTurnNow(state)` 五个新符号在定义与调用处签名一致;`legalMoves`/`runInfection`/`scoreAction`/`enumerateZombie`/`aiFallbackEndZombie` 改动点与现有代码精确对齐。

---

## 实测数字(harness, 100 局/配置;simulate.ts 随机种子,±~10 噪声,多轮取势)

### 基线(33ea661,实施前 = 无 R1/R2/zombieOffense)
| 配置 | 幸存者 | 僵尸 | 平局 | Stalemate |
|---|---|---|---|---|
| easy/easy | 52% | 46% | 2% | 4% |
| hard/hard | 0% | 98% | 2% | **59%** |
| hardZ/easyS | 0% | 100% | 0% | 17% |
| easyZ/hardS | 74% | 25% | 1% | 1% |

退化贴边墙病态主要在 hard/hard:**59% 僵局 + 0% 幸存者胜**(hard AI 龟缩进不可摧贴边墙)。

### 最终(7abdd44,R1+R2+反龟缩激进组,4 轮稳定)
| 配置 | 幸存者 | 僵尸 | Stalemate | 对比基线 |
|---|---|---|---|---|
| easy/easy | ~88% | ~12% | **0%** | 僵局 4%→0% |
| hard/hard | ~89% | ~4% | **~8%** | **僵局 59%→8%** |
| hardZ/easyS | ~49% | ~50% | ~1% | 0:100 → ~均衡 |
| easyZ/hardS | ~100% | ~0% | 0% | — |

### 门槛判定(诚实)
- **G2 反僵局 — 达成(核心目标)**:hard/hard 僵局 59%→~8%,easy/easy 4%→0%。退化平局/龟缩病态根除。不可摧贴边墙经 **S-4 测试独立证实已死**。
- **G3 感染仍可达 — 达成**:僵尸仍能赢(easy/easy ~12%、hardZ/easyS ~50%),感染机制正常。
- **G4 破墙 — 达成**:S-4 通过。
- **G1 easy/easy ∈ [45,55] — 未达成,且证明纯权重不可达成**:架构天花板——survivor 跳杀是 10⁵-scale,hard `scoreAction` 的 worst-case minimax 让任何"靠近=可被跳杀"的着法 worst-case≈-10⁵,zombieOffense(~10³)无法翻越。激进权重→僵尸交火被跳杀(易胜~88%);保守权重→僵尸龟缩(hard/hard 60% 僵局)。无单一权重同时满足。**用户拍板:优先反龟缩(锁激进组),接受 ~88% 与已知架构天花板。**真要 ~50:50 须改 hard worst-case 架构(单独立项)。

### 后续(已知限制,非本次范围)
hard `scoreAction` 的纯 worst-case minimax 是 hard/hard 残留偏斜与"~50:50 不可调"的根因。若要彻底:给 worst-case 击杀项设上限 / worst-case 与均值混合 / 把进攻偏置纳入 worst-case 评估内。需单独 spec+plan。
