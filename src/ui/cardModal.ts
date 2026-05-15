import type { CardKind, State } from "../game/types";

const NAME: Record<CardKind, string> = {
  ghost: "鬼魂",
  shoes: "靴子",
  coffee: "咖啡",
};

const DESC: Record<CardKind, string> = {
  ghost: "把任意一只僵尸永久驱散——它从场上彻底消失，也不回库存。",
  shoes: "立刻让一个幸存者再走 1 格（普通规则，可跳杀）。",
  coffee: "立刻让一个幸存者连走 2 格。",
};

const ICON: Record<CardKind, string> = {
  ghost: "💀",
  shoes: "👟",
  coffee: "☕",
};

const STEP: Record<string, string> = {
  "pick-zombie": "选择一只僵尸",
  "pick-survivor": "选择一个幸存者",
  "pick-dest": "选择目标格",
  "pick-dest1": "选择第 1 步落点",
  "pick-dest2": "选择第 2 步落点",
};

// Identity of the currently-mounted card UI. Deliberately does NOT include the
// card *phase*: a single card walks through several phases (pick-survivor →
// pick-dest …) and the only thing that changes is one line of step text. If the
// phase were in the key, every phase transition (and every redundant render
// while the AI drives) would tear down + recreate the modal and replay the
// card-pop / fade-in / flip entrance animations — that is exactly the
// "卡出现两次 + 闪过" defect. Rebuild only on a real identity change:
// no-card→card, card kind change, or full-card↔toast switch.
export function cardModalKey(state: State, revealed: boolean): string | null {
  const pc = state.pendingCard;
  if (!pc) return null;
  return `${revealed ? "toast" : "card"}:${pc.kind}`;
}

export function renderCardModal(
  root: HTMLElement,
  state: State,
  revealed: boolean,
  onDismiss: () => void,
  aiAuto = false,
) {
  const pc = state.pendingCard;
  const key = cardModalKey(state, revealed);

  if (!pc || !key) {
    root.innerHTML = "";
    root.removeAttribute("data-card-key");
    return;
  }
  const kind = pc.kind;

  // Same card identity already on screen → update only the dynamic step text
  // in place. No DOM teardown, so the entrance animation does NOT replay.
  if (root.getAttribute("data-card-key") === key && root.firstElementChild) {
    const stepEl = root.querySelector(".js-step");
    if (stepEl) stepEl.textContent = STEP[pc.phase] ?? pc.phase;
    return;
  }

  root.innerHTML = "";
  root.setAttribute("data-card-key", key);

  if (!revealed) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-deck-row">
        <span class="deck-icon">🎴</span>
        <span class="deck-text">${aiAuto ? "电脑抽到事件卡" : "抽到事件卡"}（牌堆剩 ${state.deck.length}）</span>
      </div>
      <h2 class="card-title">${NAME[kind]}</h2>
      <div class="card-art">${ICON[kind]}</div>
      <p class="card-desc">${DESC[kind]}</p>
      <div class="card-action">
        <span class="step">▶ <span class="js-step">${STEP[pc.phase] ?? pc.phase}</span></span>
        ${
          aiAuto
            ? `<span class="auto-tag">⏳ 电脑自动演示中…</span>`
            : `<button id="card-ok">确 定</button>`
        }
      </div>
    `;
    backdrop.appendChild(card);
    root.appendChild(backdrop);
    if (!aiAuto) {
      card.querySelector<HTMLButtonElement>("#card-ok")?.addEventListener("click", onDismiss);
    }
    return;
  }

  const toast = document.createElement("div");
  toast.className = "step-toast";
  toast.innerHTML = `
    <span class="step-pip">${ICON[kind]}</span>
    <span class="step-name">${NAME[kind]}</span>
    <span class="step-arrow">▶</span>
    <span class="step-msg js-step">${STEP[pc.phase] ?? pc.phase}</span>
  `;
  root.appendChild(toast);
}
