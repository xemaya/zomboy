import { BOARD, type State } from "../game/types";
import { pieceAt } from "../game/rules";
import { selectionTargets } from "../game/state";
import { SPRITE, urlFor } from "./sprites";

const GRASS = urlFor(SPRITE.grass);
const STONE = urlFor(SPRITE.stone);
const HOUSE = urlFor(SPRITE.house);
const HOUSE_EMPTY = urlFor(SPRITE.houseEmpty);
const START = urlFor(SPRITE.start);
const SURVIVOR = urlFor(SPRITE.survivor);
const ZOMBIE = urlFor(SPRITE.zombie);

export function renderBoard(
  root: HTMLElement,
  state: State,
  onClick: (r: number, c: number) => void,
) {
  root.innerHTML = "";
  root.className = "board";

  const targets = selectionTargets(state);
  const targetSet = new Set(targets.map((t) => `${t.r},${t.c}`));

  // Decide highlight style based on context
  const card = state.pendingCard;
  const cardPhase = card?.phase;
  const isPickPiece =
    cardPhase === "pick-zombie" || cardPhase === "pick-survivor";

  // Pulse the active side's pieces while it's their plain turn (no overlay)
  const pulseSide = !card && !state.winner ? state.turnSide : null;

  for (let r = 0; r < BOARD; r++) {
    for (let c = 0; c < BOARD; c++) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.type = "button";

      const t = state.map.terrain[r][c];
      let bg = GRASS;
      if (t === "stone") {
        bg = STONE;
        cell.classList.add("stone");
      } else if (t === "house") {
        bg = state.housesConsumed.has(`${r},${c}`) ? HOUSE_EMPTY : HOUSE;
      } else if (t === "start") {
        bg = START;
      }
      cell.style.backgroundImage = bg;

      const p = pieceAt(state, r, c);
      if (p) {
        const piece = document.createElement("div");
        piece.className = "cell-piece";
        if (pulseSide && p.side === pulseSide) {
          piece.classList.add(`pulse-${p.side}`);
        }
        piece.style.backgroundImage = p.side === "survivor" ? SURVIVOR : ZOMBIE;
        cell.appendChild(piece);
        if (p.id === state.selectedPieceId) cell.classList.add("selected");
      }

      if (targetSet.has(`${r},${c}`)) {
        if (isPickPiece) cell.classList.add(cardPhase === "pick-survivor" ? "hi-survivor" : "hi-zombie");
        else cell.classList.add("target");
      }

      cell.addEventListener("click", () => onClick(r, c));
      root.appendChild(cell);
    }
  }
}
