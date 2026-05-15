import { generateMap } from "./mapgen";
import {
  ZOMBIE_RESERVE_START,
  STALE_PLY_CAP,
  type CardKind,
  type MapData,
  type PendingCard,
  type Piece,
  type State,
} from "./types";
import {
  checkWinner,
  legalJumps,
  legalMoves,
  nextZombieId,
  otherSide,
  pieceAt,
  pieceById,
  runInfection,
  zombieMayOccupy,
} from "./rules";

// ===== Fun flavor lines, keyed by event type =====
type FlavorKey =
  | "start"
  | "summon"
  | "kill"
  | "infect"
  | "teleport"
  | "card"
  | "bonus"
  | "zturn"
  | "sturn"
  | "winS"
  | "winZ";

const FLAVOR: Record<FlavorKey, string[]> = {
  start: [
    "🎮 新的一局，活下去！",
    "🌅 又是充满尸气的一天",
    "🧟 尸潮将至，做好准备",
    "🎬 开局！谁能笑到最后？",
  ],
  summon: [
    "🧟 僵尸大军又添新丁！",
    "🧟 人事招聘成功：+1 丧尸",
    "🪦 又一只从土里爬了出来…",
    "🧟 增员到位，尸潮更厚了",
    "📈 僵尸 KPI 达标，扩编一名",
  ],
  kill: [
    "🎯 漂亮！人类反杀一只！",
    "💥 跳劈！僵尸原地表演消失",
    "🔪 这一跳，带走一只丧尸",
    "🏆 人类得分，士气大振！",
    "🦵 一个飞跃，少一只僵尸",
  ],
  infect: [
    "☠️ 一个幸存者被拖进了尸群…",
    "🧟 又一个加入了它们…",
    "😱 包夹成功！人类少一人",
    "🩸 感染扩散中，情况不妙",
    "💀 它们又多了一个同伴",
  ],
  teleport: [
    "👻 鬼魂把僵尸挪了个窝",
    "🌀 空间一闪，僵尸瞬移了",
    "✨ 邪门，这僵尸说没就没了",
  ],
  card: [
    "🎴 房子里翻出一张事件卡！",
    "🎁 进屋探险，抽到点东西",
    "🚪 推开门，命运卡现身",
  ],
  bonus: [
    "👟 鞋带系紧，再冲一步！",
    "☕ 续了杯咖啡，手速翻倍",
    "⚡ 状态拉满，额外行动！",
  ],
  zturn: [
    "🧟 尸群蠢蠢欲动…",
    "🌫️ 轮到僵尸方搞事了",
    "🪤 它们在寻找包夹机会",
  ],
  sturn: [
    "🛡️ 幸存者深呼吸，准备行动",
    "🏃 该人类跑位了",
    "🧠 冷静，找跳杀的机会",
  ],
  winS: [
    "🎉 人类赢了！教科书级操作",
    "🏅 尸潮退散，幸存者凯旋！",
  ],
  winZ: [
    "🧟 全员沦陷…欢迎来到尸界",
    "💀 人类全灭，尸群狂欢",
  ],
};

function pickFlavor(k: FlavorKey): string {
  const pool = FLAVOR[k];
  return pool[Math.floor(Math.random() * pool.length)];
}

function setFlavor(state: State, k: FlavorKey) {
  state.flavor = pickFlavor(k);
}

function freshDeck(): CardKind[] {
  return ["ghost", "ghost", "shoes", "shoes", "coffee"];
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newState(map?: MapData): State {
  const m = map ?? generateMap();
  const pieces: Piece[] = [];
  let nextId = 1;
  for (const s of m.starts) {
    pieces.push({ id: `S${nextId++}`, side: "survivor", r: s.r, c: s.c });
  }
  return {
    map: m,
    pieces,
    housesConsumed: new Set(),
    zombieReserve: ZOMBIE_RESERVE_START,
    survivorKills: 0,
    zombieKills: 0,
    turnSide: "zombie",
    turnNumber: 1,
    zombieTurn: { mode: null, movesLeft: 0 },
    deck: shuffle(freshDeck()),
    selectedPieceId: null,
    pendingCard: null,
    winner: null,
    killMark: 0,
    stalePlies: 0,
    log: ["新对局：僵尸先手。"],
    flavor: pickFlavor("start"),
  };
}

// What cells should highlight given the current state?
export function selectionTargets(state: State): Array<{ r: number; c: number }> {
  if (state.pendingCard) return pendingHighlights(state);

  if (state.turnSide === "zombie") {
    return zombieTargetCells(state);
  }

  // survivor
  if (!state.selectedPieceId) return [];
  const p = pieceById(state, state.selectedPieceId);
  if (!p || p.side !== "survivor") return [];
  const out = legalMoves(state, p);
  for (const j of legalJumps(state, p)) out.push({ r: j.destR, c: j.destC });
  return out;
}

function zombieTargetCells(state: State): Array<{ r: number; c: number }> {
  // Move mode with a zombie selected: show its legal moves
  if (state.zombieTurn.mode === "move" && state.selectedPieceId) {
    const z = pieceById(state, state.selectedPieceId);
    if (!z) return [];
    return legalMoves(state, z);
  }
  return [];
}

export interface Hint {
  title: string;   // short focus line
  detail: string;  // step-by-step guidance, may use 【】 to mark clickable things
}

// Instructional hint for the current state — taught for new players.
export function hintText(state: State): Hint {
  if (state.winner) {
    return state.winner === "survivor"
      ? { title: "幸存者胜利！", detail: "跳杀满 4 只僵尸。点右上「重来」再开一局。" }
      : { title: "僵尸胜利！", detail: "感染满 4 个幸存者。点右上「重来」再开一局。" };
  }

  if (state.pendingCard) {
    const map: Record<string, Hint> = {
      "pick-zombie": { title: "事件卡 · 鬼魂", detail: "点【任意一只僵尸】把它永久驱散（从场上彻底消失，不回库存）。" },
      "pick-survivor": { title: "事件卡生效", detail: "点【一个幸存者】，让他获得额外移动。" },
      "pick-dest": { title: "选落点", detail: "点【高亮格】完成这次效果。" },
      "pick-dest1": { title: "额外移动 1/2", detail: "点【高亮格】走第 1 步。" },
      "pick-dest2": { title: "额外移动 2/2", detail: "点【高亮格】走第 2 步。" },
    };
    return map[state.pendingCard.phase] ?? { title: "事件卡", detail: "" };
  }

  if (state.turnSide === "zombie") {
    if (state.zombieTurn.mode === "move") {
      const left = state.zombieTurn.movesLeft;
      if (state.selectedPieceId) {
        return { title: "移动僵尸", detail: `点【高亮格】走一步（本回合还剩 ${left} 步）。` };
      }
      return { title: "继续移动", detail: `再点一只僵尸走，或点同一只继续（还剩 ${left} 步）。` };
    }
    if (state.zombieReserve > 0) {
      return {
        title: "轮到僵尸 — 二选一",
        detail: "点【任意空地】= 召唤 1 只新僵尸；点【自己的僵尸】= 这回合移动 2 步。目标：包夹幸存者感染他。",
      };
    }
    return {
      title: "轮到僵尸 — 库存空了",
      detail: "新僵尸已用完。点【自己的僵尸】这回合移动 2 步去包夹幸存者。",
    };
  }

  // survivor
  if (state.selectedPieceId) {
    return {
      title: "移动 / 跳杀",
      detail: "点【高亮圆点】走 1 格（可斜走）。隔着 1 只僵尸、它背后是空地 → 跳过去吃掉它，得 1 分！",
    };
  }
  return {
    title: "轮到幸存者",
    detail: "点你的人（蓝色），再点高亮格移动。核心打法：隔 1 只僵尸跳过去吃掉它，跳杀满 4 只就赢。",
  };
}

// === Main click ===

export function clickCell(state: State, r: number, c: number): void {
  if (r < 0 || r >= 8 || c < 0 || c >= 8) return; // defensive: ignore OOB clicks
  if (state.winner) return;
  if (state.pendingCard) {
    resolvePendingCardClick(state, r, c);
    return;
  }
  if (state.turnSide === "zombie") {
    handleZombieClick(state, r, c);
  } else {
    handleSurvivorClick(state, r, c);
  }
}

function handleZombieClick(state: State, r: number, c: number) {
  const piece = pieceAt(state, r, c);
  const terrain = state.map.terrain[r][c];

  // Click own zombie: enter / continue move mode
  if (piece && piece.side === "zombie") {
    state.selectedPieceId = piece.id;
    if (state.zombieTurn.mode !== "move") {
      state.zombieTurn = { mode: "move", movesLeft: 2 };
    }
    return;
  }

  // Click stone or other-side piece — ignore
  if (terrain === "stone" || (piece && piece.side === "survivor")) return;

  // From here: click is on an EMPTY walkable cell.
  const inMoveMode = state.zombieTurn.mode === "move";
  const movesLeft = state.zombieTurn.movesLeft;
  const committed = inMoveMode && movesLeft < 2; // already made 1st move

  // Move-mode attempt: try to move selected zombie to (r,c)
  if (inMoveMode && state.selectedPieceId) {
    const z = pieceById(state, state.selectedPieceId);
    if (z && legalMoves(state, z).some((t) => t.r === r && t.c === c)) {
      applyMove(z, r, c);
      state.zombieTurn.movesLeft -= 1;
      state.log.push(
        `${z.id} → (${r},${c})${state.zombieTurn.movesLeft > 0 ? `（再走 ${state.zombieTurn.movesLeft} 次）` : ""}`,
      );
      if (state.zombieTurn.movesLeft <= 0) {
        state.selectedPieceId = null;
        endZombieTurn(state);
      }
      return;
    }
    // Click didn't hit a legal move target
    if (committed) {
      // After first move, can't summon anymore — only ignore (player must move again)
      return;
    }
    // Tentative move-mode (no move yet): cancel and try summon intent below
    state.selectedPieceId = null;
    state.zombieTurn = { mode: null, movesLeft: 0 };
  }

  // Summon a new zombie (only while reserve remains). When reserve is empty
  // the only legal action is moving — clicking empty does nothing.
  if (state.zombieReserve > 0) {
    if (!zombieMayOccupy(state, r, c)) return; // R1: 不可贴另一僵尸召唤
    const id = nextZombieId(state);
    state.pieces.push({ id, side: "zombie", r, c });
    state.zombieReserve -= 1;
    state.log.push(`召唤 ${id} 到 (${r},${c})（库存剩 ${state.zombieReserve}）`);
    setFlavor(state, "summon");
    endZombieTurn(state);
  }
}

function handleSurvivorClick(state: State, r: number, c: number) {
  if (state.selectedPieceId) {
    const p = pieceById(state, state.selectedPieceId);
    if (p && p.side === "survivor") {
      // Jump first
      const jumps = legalJumps(state, p);
      const jump = jumps.find((j) => j.destR === r && j.destC === c);
      if (jump) {
        const killed = pieceAt(state, jump.killR, jump.killC);
        if (killed) {
          state.pieces = state.pieces.filter((x) => x !== killed);
          state.survivorKills += 1;
          state.log.push(`${p.id} 跳杀 ${killed.id}！(survivor +1 = ${state.survivorKills})`);
          setFlavor(state, "kill");
        }
        applyMove(p, r, c);
        state.selectedPieceId = null;
        finishSurvivorAction(state, p, /*viaDice*/ false);
        return;
      }
      // Normal move
      const moves = legalMoves(state, p);
      if (moves.some((t) => t.r === r && t.c === c)) {
        applyMove(p, r, c);
        state.selectedPieceId = null;
        const onHouse =
          state.map.terrain[r][c] === "house" && !state.housesConsumed.has(`${r},${c}`);
        state.log.push(`${p.id} → (${r},${c})${onHouse ? "（房子！）" : ""}`);
        if (onHouse) {
          state.housesConsumed.add(`${r},${c}`);
          const card = state.deck.shift();
          if (card) {
            // ghost needs a zombie on the board; if none, the card fizzles
            if (card === "ghost" && !state.pieces.some((q) => q.side === "zombie")) {
              state.log.push(`抽到鬼魂，但场上没有僵尸 — 卡牌失效`);
            } else {
              state.pendingCard = startCard(card);
              state.log.push(`抽到事件卡：${cardLabel(card)}（牌堆剩 ${state.deck.length}）`);
              setFlavor(state, "card");
              return;
            }
          }
          state.log.push("房子已无牌可抽。");
        }
        finishSurvivorAction(state, p, /*viaDice*/ false);
        return;
      }
    }
  }
  // selection
  const p = pieceAt(state, r, c);
  if (p && p.side === "survivor") state.selectedPieceId = p.id;
}

function applyMove(p: Piece, r: number, c: number) {
  p.r = r;
  p.c = c;
}

function finishSurvivorAction(state: State, _p: Piece, _viaDice: boolean) {
  runEndOfTurn(state);
}

function startCard(kind: CardKind): PendingCard {
  if (kind === "ghost") return { kind: "ghost", phase: "pick-zombie" };
  if (kind === "shoes") return { kind: "shoes", phase: "pick-survivor" };
  return { kind: "coffee", phase: "pick-survivor" };
}

function cardLabel(k: CardKind): string {
  return { ghost: "鬼魂", shoes: "靴子", coffee: "咖啡" }[k];
}

function resolvePendingCardClick(state: State, r: number, c: number) {
  const pd = state.pendingCard!;

  if (pd.kind === "ghost") {
    // permanently remove the picked zombie (does NOT refund the reserve, so
    // it's cleanly survivor-favourable — a real material/tempo swing, but not
    // a survivor "kill" point).
    const t = pieceAt(state, r, c);
    if (!t || t.side !== "zombie") return;
    state.pieces = state.pieces.filter((p) => p.id !== t.id);
    state.log.push(`鬼魂驱散了 ${t.id}（永久移除）`);
    setFlavor(state, "teleport");
    state.pendingCard = null;
    runEndOfTurn(state);
    return;
  }

  if (pd.kind === "shoes") {
    if (pd.phase === "pick-survivor") {
      const t = pieceAt(state, r, c);
      if (!t || t.side !== "survivor") return;
      state.pendingCard = { kind: "shoes", phase: "pick-dest", survivorId: t.id };
      return;
    }
    const s = pieceById(state, pd.survivorId!);
    if (!s) return;
    if (!resolveSurvivorBonusStep(state, s, r, c)) return;
    state.log.push(`${s.id} 鞋子加速 → (${r},${c})`);
    setFlavor(state, "bonus");
    state.pendingCard = null;
    runEndOfTurn(state);
    return;
  }

  // coffee
  if (pd.phase === "pick-survivor") {
    const t = pieceAt(state, r, c);
    if (!t || t.side !== "survivor") return;
    state.pendingCard = { kind: "coffee", phase: "pick-dest1", survivorId: t.id };
    return;
  }
  if (pd.phase === "pick-dest1" || pd.phase === "pick-dest2") {
    const s = pieceById(state, pd.survivorId!);
    if (!s) return;
    if (!resolveSurvivorBonusStep(state, s, r, c)) return;
    state.log.push(`${s.id} 咖啡冲刺 → (${r},${c})`);
    setFlavor(state, "bonus");
    if (pd.phase === "pick-dest1") {
      state.pendingCard = { kind: "coffee", phase: "pick-dest2", survivorId: s.id };
      return;
    }
    state.pendingCard = null;
    runEndOfTurn(state);
    return;
  }
}

function resolveSurvivorBonusStep(state: State, s: Piece, r: number, c: number): boolean {
  const jumps = legalJumps(state, s);
  const j = jumps.find((j) => j.destR === r && j.destC === c);
  if (j) {
    const killed = pieceAt(state, j.killR, j.killC);
    if (killed) {
      state.pieces = state.pieces.filter((x) => x !== killed);
      state.survivorKills += 1;
      state.log.push(`${s.id} 跳杀 ${killed.id}！(survivor +1 = ${state.survivorKills})`);
      setFlavor(state, "kill");
    }
    applyMove(s, r, c);
    return true;
  }
  if (legalMoves(state, s).some((t) => t.r === r && t.c === c)) {
    applyMove(s, r, c);
    return true;
  }
  return false;
}

function endZombieTurn(state: State) {
  state.zombieTurn = { mode: null, movesLeft: 0 };
  state.selectedPieceId = null;
  runEndOfTurn(state);
}

// Exposed so the AI driver can safely end a (pathologically) stuck zombie
// turn instead of looping. Mirrors endZombieTurn.
export function endZombieTurnNow(state: State): void {
  endZombieTurn(state);
}

function runEndOfTurn(state: State) {
  const infLog = runInfection(state);
  if (infLog.length) {
    state.log.push(...infLog);
    setFlavor(state, "infect");
  }
  // progress tracking for the stalemate safety valve
  const tot = state.survivorKills + state.zombieKills;
  if (tot > state.killMark) {
    state.killMark = tot;
    state.stalePlies = 0;
  } else {
    state.stalePlies += 1;
  }

  const w = checkWinner(state);
  if (w) {
    state.winner = w;
    state.log.push(w === "survivor" ? "幸存者胜利！" : "僵尸胜利！");
    setFlavor(state, w === "survivor" ? "winS" : "winZ");
    return;
  }

  if (state.stalePlies >= STALE_PLY_CAP) {
    state.winner =
      state.survivorKills > state.zombieKills
        ? "survivor"
        : state.zombieKills > state.survivorKills
          ? "zombie"
          : "draw";
    const msg =
      state.winner === "draw"
        ? "长期无进展，平局！"
        : `长期无进展，按得分判 ${state.winner === "survivor" ? "幸存者" : "僵尸"} 胜！`;
    state.log.push(msg);
    setFlavor(
      state,
      state.winner === "survivor" ? "winS" : state.winner === "zombie" ? "winZ" : "start",
    );
    return;
  }

  if (state.turnSide === "survivor") {
    state.turnNumber += 1;
  }
  state.turnSide = otherSide(state.turnSide);
  if (state.turnSide === "zombie") {
    state.zombieTurn = { mode: null, movesLeft: 0 };
  }
  // Only set a turn-start flavor if no louder event already claimed this beat.
  if (!infLog.length) {
    setFlavor(state, state.turnSide === "zombie" ? "zturn" : "sturn");
  }
}

export function pendingHighlights(state: State): Array<{ r: number; c: number }> {
  const pd = state.pendingCard;
  if (!pd) return [];
  if (pd.kind === "ghost") {
    return state.pieces.filter((p) => p.side === "zombie").map(toRC);
  }
  if (pd.phase === "pick-survivor") {
    return state.pieces.filter((p) => p.side === "survivor").map(toRC);
  }
  const sid = (pd as { survivorId?: string }).survivorId;
  if (!sid) return [];
  const s = pieceById(state, sid);
  if (!s) return [];
  const out = legalMoves(state, s);
  for (const j of legalJumps(state, s)) out.push({ r: j.destR, c: j.destC });
  return out;
}

function toRC(p: { r: number; c: number }) {
  return { r: p.r, c: p.c };
}
