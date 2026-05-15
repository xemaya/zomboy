// Pure (DOM-free) logic for the start-menu segmented buttons.
//
// The start overlay must NOT be torn down + recreated on every selection: the
// .start-overlay has `animation: fade-in` and recreating it replays the
// entrance every click → the reported 首页选项闪烁. So the renderer keeps the
// overlay mounted and only (a) re-highlights buttons or (b) rebuilds the small
// conditional rows. These two helpers encode that decision and are unit-tested.

import type { Side } from "../game/types";
import type { Level } from "../game/ai";

export type GameMode = "pvp" | "pve" | "aiai";

export interface StartCfg {
  mode: GameMode;
  humanSide: Side;
  zLevel: Level;
  sLevel: Level;
}

// The option value currently selected for a seg-button group. Note "aiLevel"
// is the AI side's level, and WHICH side is the AI flips with humanSide — get
// this wrong and the difficulty highlight points at the wrong button.
export function segCurrent(group: string, cfg: StartCfg): string {
  switch (group) {
    case "mode":
      return cfg.mode;
    case "humanSide":
      return cfg.humanSide;
    case "aiLevel": {
      const aiSide: Side = cfg.humanSide === "survivor" ? "zombie" : "survivor";
      return aiSide === "zombie" ? cfg.zLevel : cfg.sLevel;
    }
    case "zLevel":
      return cfg.zLevel;
    case "sLevel":
      return cfg.sLevel;
    default:
      return "";
  }
}

// Only mode / humanSide change which conditional rows + labels exist, so only
// they require rebuilding the (animation-free) #start-extra block. Difficulty
// groups must just re-toggle the `.on` class — zero DOM teardown, no flicker.
export function groupNeedsExtraRebuild(group: string): boolean {
  return group === "mode" || group === "humanSide";
}
