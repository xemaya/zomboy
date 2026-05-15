import { generateMap } from "./game/mapgen";
import { clickCell, newState, endZombieTurnNow } from "./game/state";
import { planTurn, planCardResolution, type Level } from "./game/ai";
import { aiCardDecision } from "./game/aiCardFlow";
import { segCurrent, groupNeedsExtraRebuild } from "./ui/startMenu";
import { emptyCells, legalMoves, zombieMayOccupy, zombieHasAnyLegalAction } from "./game/rules";
import type { Side, State } from "./game/types";
import { renderBoard } from "./ui/board";
import { renderCardModal } from "./ui/cardModal";
import { renderHud } from "./ui/hud";
import { renderRulesModal } from "./ui/rulesModal";

let state: State = newState();
let cardRevealed = false;
let rulesOpen = false;

type Mode = "pvp" | "pve" | "aiai";
interface Cfg {
  mode: Mode;
  humanSide: Side; // pve: which side the human plays
  zLevel: Level; // zombie AI difficulty
  sLevel: Level; // survivor AI difficulty
}
const cfg: Cfg = { mode: "pve", humanSide: "survivor", zLevel: "easy", sLevel: "easy" };
let started = false;
let aiThinking = false;

// When the AI controls the survivor and steps on a house, the human opponent
// gets no clicks. Deliberately dwell so they can see what the computer drew
// (full card hold) and follow each resolution step. Faster in dev AI-vs-AI.
function aiCardRevealMs() { return cfg.mode === "aiai" ? 600 : 1900; }
function aiCardStepMs() { return cfg.mode === "aiai" ? 320 : 850; }

// AI-vs-AI is an internal testing mode — hidden from the normal UI, enabled
// only with ?aiai in the URL.
const DEV_AIAI = new URLSearchParams(location.search).has("aiai");

function root() { return document.getElementById("app")!; }

function aiControls(side: Side): boolean {
  if (!started) return false;
  if (cfg.mode === "pvp") return false;
  if (cfg.mode === "aiai") return true;
  return side !== cfg.humanSide; // pve
}

function shell() {
  root().innerHTML = `
    <div class="poster">
      <div class="title-row">
        <div class="title-logo"><div class="title-main">ZOM·BOY<span class="plus">+</span></div></div>
        <div class="top-actions">
          <button class="topbtn" id="btn-menu" title="回主菜单，换边 / 换模式">
            <span class="tb-txt">主菜单</span>
          </button>
          <button class="topbtn" id="btn-rules" title="查看完整规则与玩法">
            <span class="tb-txt">怎么玩</span>
          </button>
          <button class="topbtn" id="btn-regen" title="换一张障碍布局，并重新开局">
            <span class="tb-txt">换地图</span>
          </button>
          <button class="topbtn" id="btn-reset" title="保持当前地图，重新开始这一局">
            <span class="tb-txt">重来</span>
          </button>
        </div>
      </div>
      <div id="hud" class="hud"></div>
      <div class="board-shell"><div id="board" class="board"></div></div>
      <div id="log" class="log-line"></div>
    </div>
    <div id="start-root"></div>
    <div id="rules-root"></div>
    <div id="modal-root"></div>
    <div id="winner-root"></div>
  `;
  document.getElementById("btn-regen")?.addEventListener("click", regenMap);
  document.getElementById("btn-reset")?.addEventListener("click", resetGame);
  document.getElementById("btn-rules")?.addEventListener("click", openRules);
  document.getElementById("btn-menu")?.addEventListener("click", reopenStart);
}

function regenMap() {
  state = newState(generateMap());
  cardRevealed = false;
  aiThinking = false;
  render();
}
function resetGame() {
  state = newState(state.map);
  cardRevealed = false;
  aiThinking = false;
  render();
}
function openRules() { rulesOpen = true; render(); }
function closeRules() { rulesOpen = false; render(); }

function startGame() {
  // always begin a clean game with the chosen config (same map)
  state = newState(state.map);
  cardRevealed = false;
  started = true;
  aiThinking = false;
  render();
}
function reopenStart() {
  // back to the main menu — halt any AI and show the mode picker
  started = false;
  aiThinking = false;
  render();
}

function onCellClick(r: number, c: number) {
  if (aiThinking) return;
  if (aiControls(state.turnSide)) return; // not the human's turn
  // a survivor card is the survivor side's decision
  if (state.pendingCard && aiControls("survivor")) return;
  const hadPending = !!state.pendingCard;
  clickCell(state, r, c);
  if (state.pendingCard && !hadPending) cardRevealed = false;
  if (!state.pendingCard) cardRevealed = false;
  render();
}
function dismissDiceReveal() { cardRevealed = true; render(); }

// Drive whichever side(s) the AI controls. Re-entrant via aiThinking; chains
// through render() so AIvAI and the card-resolution continuation flow work.
function maybeRunAI() {
  if (!started || state.winner || aiThinking) return;

  // 1) AI must resolve a pending card if it controls survivors. Two beats:
  //    reveal  — hold the full card so the human opponent reads what the
  //              computer drew, then flip to the compact toast.
  //    resolve — play planCardResolution slowly, one visible step at a time.
  if (state.pendingCard) {
    const act = aiCardDecision({
      hasCard: true,
      aiSurvivor: aiControls("survivor"),
      revealed: cardRevealed,
    });
    if (act === "none") return;
    if (act === "reveal") {
      aiThinking = true; // freeze input + re-entry during the read dwell
      window.setTimeout(() => {
        cardRevealed = true;
        aiThinking = false;
        render();
      }, aiCardRevealMs());
      return;
    }
    const clicks = planCardResolution(state);
    runClicks(clicks, "survivor", aiCardStepMs());
    return;
  }

  // 2) Normal turn
  const side = state.turnSide;
  if (!aiControls(side)) return;
  const level = side === "zombie" ? cfg.zLevel : cfg.sLevel;
  const clicks = planTurn(state, side, level);
  runClicks(clicks, side);
}

function runClicks(clicks: Array<{ r: number; c: number }>, side: Side, stepMs?: number) {
  aiThinking = true;
  const delay = stepMs ?? (cfg.mode === "aiai" ? 300 : 420);
  const firstDelay = stepMs ? Math.round(stepMs * 0.7) : cfg.mode === "aiai" ? 360 : 480;
  let i = 0;
  const finish = () => {
    aiThinking = false;
    // Card fully resolved → arm the next AI card for a fresh reveal dwell.
    if (!state.pendingCard) cardRevealed = false;
    render();
  };
  const step = () => {
    if (!started || state.winner) { finish(); return; } // halted (e.g. back to menu)
    if (i >= clicks.length) {
      // sequence done. If still owing (card just appeared, or turn not flipped),
      // hand back to maybeRunAI via render()'s tail; otherwise guard against stalls.
      if (!state.pendingCard && state.turnSide === side && side === "zombie") {
        aiFallbackEndZombie();
      }
      finish();
      return;
    }
    const { r, c } = clicks[i++];
    clickCell(state, r, c);
    if (state.winner) { finish(); return; }
    render();
    window.setTimeout(step, delay);
  };
  window.setTimeout(step, firstDelay);
}

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

function render() {
  const board = document.getElementById("board");
  const hud = document.getElementById("hud");
  const log = document.getElementById("log");
  const modal = document.getElementById("modal-root");
  const winner = document.getElementById("winner-root");
  const rules = document.getElementById("rules-root");
  const startEl = document.getElementById("start-root");
  const boardShell = document.querySelector<HTMLElement>(".board-shell");
  if (!board || !hud || !log || !modal || !winner || !rules || !startEl || !boardShell) return;

  boardShell.className = `board-shell ${state.winner ? "" : `${state.turnSide}-turn`}`;

  const aiMeta = {
    mode: cfg.mode === "pvp" ? null : cfg.mode === "aiai" ? "aiai" : "pve",
    aiThinking,
    aiTurn: started && aiControls(state.turnSide),
  } as const;

  renderBoard(board, state, onCellClick);
  renderHud({ hud, log }, state, aiMeta);
  renderCardModal(modal, state, cardRevealed, dismissDiceReveal, started && aiControls("survivor"));
  renderRulesModal(rules, rulesOpen, closeRules);
  renderStart(startEl);
  renderWinner(winner, state);

  if (started) maybeRunAI();
}

const segHtml = (
  group: string,
  opts: Array<{ v: string; label: string }>,
  cur: string,
) =>
  `<div class="seg" data-group="${group}">` +
  opts
    .map(
      (o) =>
        `<button class="seg-btn ${o.v === cur ? "on" : ""}" data-group="${group}" data-val="${o.v}">${o.label}</button>`,
    )
    .join("") +
  `</div>`;

const LVLS = [
  { v: "easy", label: "简单" },
  { v: "hard", label: "困难" },
];

// The mode-dependent rows. Lives in an animation-free #start-extra block so it
// can be rebuilt on mode/side change without touching .start-overlay.
function extraRowsHtml(): string {
  if (cfg.mode === "pve") {
    return `
      <div class="start-row"><span class="start-lbl">你扮演</span>
        ${segHtml("humanSide", [{ v: "survivor", label: "幸存者" }, { v: "zombie", label: "僵尸" }], cfg.humanSide)}
      </div>
      <div class="start-row"><span class="start-lbl">AI 难度</span>
        ${segHtml("aiLevel", LVLS, segCurrent("aiLevel", cfg))}
      </div>`;
  }
  if (cfg.mode === "aiai") {
    return `
      <div class="start-row"><span class="start-lbl">僵尸 AI</span>
        ${segHtml("zLevel", LVLS, cfg.zLevel)}
      </div>
      <div class="start-row"><span class="start-lbl">幸存者 AI</span>
        ${segHtml("sLevel", LVLS, cfg.sLevel)}
      </div>`;
  }
  return "";
}

function applySegChange(g: string, v: string) {
  if (g === "mode") cfg.mode = v as Mode;
  else if (g === "humanSide") cfg.humanSide = v as Side;
  else if (g === "aiLevel") {
    const aiSide: Side = cfg.humanSide === "survivor" ? "zombie" : "survivor";
    if (aiSide === "zombie") cfg.zLevel = v as Level;
    else cfg.sLevel = v as Level;
  } else if (g === "zLevel") cfg.zLevel = v as Level;
  else if (g === "sLevel") cfg.sLevel = v as Level;
}

// Re-highlight every seg button from cfg WITHOUT rebuilding the overlay (so the
// fade-in entrance never replays → no flicker).
function syncSegOn(overlay: HTMLElement) {
  overlay.querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((b) => {
    b.classList.toggle("on", b.dataset.val === segCurrent(b.dataset.group!, cfg));
  });
}

function bindSegs(scope: HTMLElement, overlay: HTMLElement) {
  scope.querySelectorAll<HTMLButtonElement>(".seg-btn").forEach((b) => {
    if ((b as HTMLButtonElement & { _bound?: boolean })._bound) return;
    (b as HTMLButtonElement & { _bound?: boolean })._bound = true;
    b.addEventListener("click", () => {
      const g = b.dataset.group!;
      applySegChange(g, b.dataset.val!);
      // Only mode/side change which rows exist → rebuild just that block.
      if (groupNeedsExtraRebuild(g)) {
        const ex = overlay.querySelector<HTMLElement>("#start-extra");
        if (ex) {
          ex.innerHTML = extraRowsHtml();
          bindSegs(ex, overlay);
        }
      }
      syncSegOn(overlay);
    });
  });
}

function renderStart(el: HTMLElement) {
  if (started) {
    el.innerHTML = "";
    return;
  }
  // Already mounted → just refresh highlight. Never tear the overlay down:
  // recreating it replays the fade-in entrance (the 选项闪烁 bug).
  const mounted = el.querySelector<HTMLElement>(".start-overlay");
  if (mounted) {
    syncSegOn(mounted);
    return;
  }

  const modeOpts = [
    { v: "pvp", label: "人 vs 人" },
    { v: "pve", label: "人 vs AI" },
  ];
  if (DEV_AIAI) modeOpts.push({ v: "aiai", label: "AI 对战" });

  const ov = document.createElement("div");
  ov.className = "start-overlay";
  ov.innerHTML = `
    <div class="start-card">
      <div class="start-title">ZOM·BOY<span class="plus">+</span></div>
      <div class="start-sub">选择对战模式</div>
      <div class="start-row">${segHtml("mode", modeOpts, cfg.mode)}</div>
      <div id="start-extra">${extraRowsHtml()}</div>
      <button class="start-go" id="start-go">▶ 开 始</button>
    </div>
  `;
  el.appendChild(ov);
  bindSegs(ov, ov);
  ov.querySelector<HTMLButtonElement>("#start-go")?.addEventListener("click", startGame);
}

function renderWinner(el: HTMLElement, st: State) {
  el.innerHTML = "";
  if (!st.winner) return;
  const w = st.winner;
  const title = w === "draw" ? "平局" : w === "survivor" ? "幸存者胜利" : "僵尸胜利";
  const sub =
    w === "draw"
      ? `长期无进展 · 比分 幸存者 ${st.survivorKills} : ${st.zombieKills} 僵尸`
      : w === "survivor"
        ? "跳杀 4 个僵尸达成"
        : "感染 4 个幸存者达成";
  const overlay = document.createElement("div");
  overlay.className = "winner-overlay";
  overlay.innerHTML = `
    <h1>${title}</h1>
    <div class="sub">${sub}</div>
    <div class="win-actions">
      <button id="winner-restart">▶ 再来一局</button>
      <button id="winner-mode" class="ghost">切换模式</button>
    </div>
  `;
  el.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>("#winner-restart")?.addEventListener("click", regenMap);
  overlay.querySelector<HTMLButtonElement>("#winner-mode")?.addEventListener("click", () => {
    regenMap();
    reopenStart();
  });
}

shell();
render();
