// Regression test for the "首页选项点选闪烁" bug.
// Run: npx tsx scripts/test_start_menu.ts
//
// The flicker came from renderStart tearing down + recreating .start-overlay
// (which has `animation: fade-in`) on every selection. The fix keeps the
// overlay mounted; difficulty toggles must only re-highlight (no DOM rebuild),
// and the highlight must follow cfg correctly — including the aiLevel↔side flip.

import { segCurrent, groupNeedsExtraRebuild, type StartCfg } from "../src/ui/startMenu";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
}

const base: StartCfg = { mode: "pve", humanSide: "survivor", zLevel: "easy", sLevel: "hard" };

console.log("segCurrent");
check("mode", segCurrent("mode", { ...base, mode: "aiai" }) === "aiai");
check("humanSide", segCurrent("humanSide", { ...base, humanSide: "zombie" }) === "zombie");

// The tricky one: aiLevel is the AI side's level; AI side flips with humanSide.
check(
  "aiLevel when human=survivor → AI is zombie → zLevel",
  segCurrent("aiLevel", { ...base, humanSide: "survivor", zLevel: "hard", sLevel: "easy" }) === "hard",
);
check(
  "aiLevel when human=zombie → AI is survivor → sLevel",
  segCurrent("aiLevel", { ...base, humanSide: "zombie", zLevel: "hard", sLevel: "easy" }) === "easy",
);
check("zLevel", segCurrent("zLevel", { ...base, zLevel: "hard" }) === "hard");
check("sLevel", segCurrent("sLevel", { ...base, sLevel: "easy" }) === "easy");

console.log("groupNeedsExtraRebuild");
// Core anti-flicker contract: difficulty groups must NOT trigger a rebuild.
check("mode → rebuild", groupNeedsExtraRebuild("mode") === true);
check("humanSide → rebuild", groupNeedsExtraRebuild("humanSide") === true);
check("aiLevel → NO rebuild (just re-highlight, no flicker)", groupNeedsExtraRebuild("aiLevel") === false);
check("zLevel → NO rebuild", groupNeedsExtraRebuild("zLevel") === false);
check("sLevel → NO rebuild", groupNeedsExtraRebuild("sLevel") === false);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
