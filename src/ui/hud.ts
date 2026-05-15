import type { State } from "../game/types";
import { hintText } from "../game/state";

const SURVIVOR_IMG = "/sprites/survivor.png";
const ZOMBIE_IMG = "/sprites/zombie.png";

export function renderHud(
  els: { hud: HTMLElement; log: HTMLElement },
  state: State,
  meta: { mode: "aiai" | "pve" | null; aiThinking: boolean; aiTurn: boolean } = {
    mode: null,
    aiThinking: false,
    aiTurn: false,
  },
) {
  const sLeft = state.pieces.filter((p) => p.side === "survivor").length;
  const zOnBoard = state.pieces.filter((p) => p.side === "zombie").length;
  const hint = hintText(state);
  const sideZh = state.turnSide === "survivor" ? "幸存者" : "僵尸";
  const tagText = meta.aiTurn ? `🤖 AI · ${sideZh}回合` : `▶ ${sideZh}回合`;

  els.hud.className = "hud";
  els.hud.innerHTML = `
    <div class="hud-scores">
      <div class="score-card survivor ${state.turnSide === "survivor" ? "active" : ""}">
        <img src="${SURVIVOR_IMG}" alt="" />
        <div class="score-block">
          <div class="score-main"><span class="kills">${state.survivorKills}</span><span class="of">/ 4</span></div>
          <div class="score-sub">幸存者 · 场上 ${sLeft}</div>
        </div>
      </div>
      <div class="score-card zombie ${state.turnSide === "zombie" ? "active" : ""}">
        <img src="${ZOMBIE_IMG}" alt="" />
        <div class="score-block">
          <div class="score-main"><span class="kills">${state.zombieKills}</span><span class="of">/ 4</span></div>
          <div class="score-sub">僵尸 · 场上 ${zOnBoard} · 库存 ${state.zombieReserve}</div>
        </div>
      </div>
    </div>
    <div class="hud-hint ${state.turnSide}">
      <div class="hint-top">
        <span class="hint-tag">${tagText}</span>
        <span class="hint-title">${escapeHtml(hint.title)}</span>
      </div>
      <div class="hint-detail">${markup(hint.detail)}</div>
    </div>
  `;

  // AI status lives in the fixed-height log line so the hint card never resizes
  els.log.className = "log-line" + (meta.aiThinking ? " ai" : "");
  els.log.innerHTML = meta.aiThinking
    ? `<span class="log-dot">🤖</span> AI 思考中…`
    : `<span class="log-dot">▍</span> ${escapeHtml(state.flavor)}`;
}

// Escape, then turn 【...】 into highlighted keyword chips.
function markup(s: string): string {
  return escapeHtml(s).replace(/【([^】]+)】/g, '<b class="kw">$1</b>');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]!));
}
